import type { Db } from '../db/db.ts';
import { AppError } from '../core/errors.ts';
import { newId } from '../core/ids.ts';
import type { Clock } from '../core/clock.ts';
import { splitVat, type Pence } from '../core/money.ts';
import { acct, type Ledger, type Line } from '../ledger/ledger.ts';
import type { Wallet } from '../wallet/wallet.ts';
import type { PaymentGateway } from '../payments/stripe.ts';
import { priceFromCost, type PricingRules } from '../pricing/pricing.ts';
import type { Parcel, ShippingProvider } from '../providers/types.ts';
import type { ShipmentRow } from '../bookings/bookings.ts';

export const PAUSE_THRESHOLD_PENCE = 2000; // pause bookings when unpaid adjustments exceed £20

export type AdjustmentStatus = 'pending' | 'no_charge' | 'charged' | 'failed' | 'waived' | 'disputed';

export type AdjustmentRow = {
  id: string;
  shipment_id: string;
  source_event_id: string;
  measured_json: string;
  old_price_pence: number;
  new_price_pence: number;
  diff_pence: number;
  status: AdjustmentStatus;
  method: string | null;
  payment_ref: string | null;
  created_at: string;
};

/**
 * A courier re-weighed or re-measured a parcel.
 *
 * Rule: we only charge when the measured parcel COSTS more. We re-price the
 * same service at the measured size; if the price is the same (same weight
 * band), the adjustment is recorded as `no_charge` and shown to the customer
 * in yellow. If it costs more, the difference is taken from the wallet first,
 * then the saved card. If both fail it is `failed`, and bookings pause once
 * the unpaid total passes £20.
 */
export class AdjustmentService {
  private readonly db: Db;
  private readonly ledger: Ledger;
  private readonly wallet: Wallet;
  private readonly payments: PaymentGateway;
  private readonly pricing: PricingRules;
  private readonly providers: (id: string) => ShippingProvider | undefined;
  private readonly clock: Clock;

  constructor(deps: {
    db: Db; ledger: Ledger; wallet: Wallet; payments: PaymentGateway; pricing: PricingRules;
    providers: (id: string) => ShippingProvider | undefined; clock: Clock;
  }) {
    this.db = deps.db;
    this.ledger = deps.ledger;
    this.wallet = deps.wallet;
    this.payments = deps.payments;
    this.pricing = deps.pricing;
    this.providers = deps.providers;
    this.clock = deps.clock;
  }

  /** What the measured parcel costs us on the same service. */
  private async newCost(s: ShipmentRow, measured: Parcel, surcharge: Pence | null): Promise<Pence> {
    if (surcharge !== null) return s.cost_pence + Math.max(0, surcharge);
    const provider = this.providers(s.provider);
    if (!provider) throw new AppError('provider_failed', `Provider ${s.provider} not connected`);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const rates = await provider.getRates({ from: JSON.parse(s.from_json), to: JSON.parse(s.to_json), parcel: measured }, ctrl.signal);
      const same = rates.find((r) => r.carrier === s.carrier && r.serviceCode === s.service_code);
      if (!same) throw new AppError('provider_failed', 'Could not re-price this service at the measured size');
      return same.cost;
    } finally {
      clearTimeout(timer);
    }
  }

  async handleMeasurement(ev: { eventId: string; trackingNumber: string; measured: Parcel; providerSurchargePence: Pence | null }): Promise<AdjustmentRow | null> {
    const s = await this.db.get<ShipmentRow>('SELECT * FROM shipments WHERE tracking_number = $1', [ev.trackingNumber]);
    if (!s) return null;
    const existing = await this.db.get<AdjustmentRow>('SELECT * FROM adjustments WHERE shipment_id = $1 AND source_event_id = $2', [s.id, ev.eventId]);
    if (existing) return existing;

    const customer = await this.db.get<{ pricing_discount_bp: number }>('SELECT pricing_discount_bp FROM customers WHERE id = $1', [s.customer_id]);
    const rule = await this.pricing.rule(s.carrier, s.service_code);
    const newCost = await this.newCost(s, ev.measured, ev.providerSurchargePence);
    // Compare like with like: both prices with today's rule, so a markup change
    // since booking never shows up as a customer charge.
    const oldPrice = priceFromCost(s.cost_pence, rule, customer?.pricing_discount_bp ?? 0).gross;
    const newPrice = priceFromCost(newCost, rule, customer?.pricing_discount_bp ?? 0).gross;
    const diff = newCost > s.cost_pence ? Math.max(0, newPrice - oldPrice) : 0;

    const id = newId('adj');
    await this.db.tx(async (tx) => {
      await tx.run(
        `INSERT INTO adjustments (id, shipment_id, source_event_id, measured_json, old_price_pence, new_price_pence, diff_pence, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, s.id, ev.eventId, JSON.stringify(ev.measured), oldPrice, oldPrice + diff, diff, diff > 0 ? 'pending' : 'no_charge', this.clock.now().toISOString()],
      );
      // We owe the provider the extra whether or not the customer pays.
      if (newCost > s.cost_pence) {
        const extra = newCost - s.cost_pence;
        await this.ledger.post({
          idempotencyKey: `adjcost:${id}`, kind: 'provider_cost', ref: id,
          lines: [{ account: acct.providerCost(s.provider), amount: extra }, { account: acct.providerPayable(s.provider), amount: -extra }],
        }, tx);
      }
    });
    if (diff > 0) await this.collect(id);
    return this.get(id);
  }

  async get(id: string): Promise<AdjustmentRow> {
    const a = await this.db.get<AdjustmentRow>('SELECT * FROM adjustments WHERE id = $1', [id]);
    if (!a) throw new AppError('not_found', 'Adjustment not found');
    return a;
  }

  /** Try wallet, then card. Safe to call again (admin "Retry card"). */
  async collect(adjustmentId: string): Promise<AdjustmentRow> {
    const a = await this.get(adjustmentId);
    if (a.status !== 'pending' && a.status !== 'failed' && a.status !== 'disputed') return a;
    const s = await this.db.get<ShipmentRow>('SELECT * FROM shipments WHERE id = $1', [a.shipment_id]);
    if (!s) throw new AppError('not_found', 'Shipment not found');

    // 1. wallet
    try {
      await this.wallet.debitAsRevenue(s.customer_id, a.diff_pence, `adj:${a.id}`, a.id);
      await this.db.run('UPDATE adjustments SET status = $1, method = $2 WHERE id = $3', ['charged', 'wallet', a.id]);
      await this.refreshPause(s.customer_id);
      return this.get(a.id);
    } catch (e) {
      if (!(e instanceof AppError) || e.code !== 'insufficient_funds') throw e;
    }

    // 2. saved card
    const c = await this.db.get<{ stripe_customer_id: string | null; default_payment_method: string | null }>(
      'SELECT stripe_customer_id, default_payment_method FROM customers WHERE id = $1', [s.customer_id]);
    if (c?.stripe_customer_id && c.default_payment_method) {
      const attempt = await this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ledger_entries WHERE ref = $1 AND kind = 'adjustment'", [a.id]);
      const r = await this.payments.chargeOffSession({
        amount: a.diff_pence, customerStripeId: c.stripe_customer_id, paymentMethodId: c.default_payment_method,
        metadata: { purpose: 'adjustment', adjustment_id: a.id, shipment_id: s.id },
        idempotencyKey: `adjcard:${a.id}:${this.clock.now().toISOString().slice(0, 10)}:${attempt?.n ?? 0}`,
      });
      if (r.status === 'succeeded') {
        const { net, vat } = splitVat(a.diff_pence);
        const lines: Line[] = [{ account: acct.cashStripe, amount: a.diff_pence }, { account: acct.revenue, amount: -net }];
        if (vat) lines.push({ account: acct.vatOutput, amount: -vat });
        await this.ledger.post({ idempotencyKey: `adjcard:${a.id}`, kind: 'adjustment', ref: a.id, lines });
        await this.db.run('UPDATE adjustments SET status = $1, method = $2, payment_ref = $3 WHERE id = $4', ['charged', 'card', r.id, a.id]);
        await this.refreshPause(s.customer_id);
        return this.get(a.id);
      }
    }
    await this.db.run("UPDATE adjustments SET status = 'failed' WHERE id = $1", [a.id]);
    await this.refreshPause(s.customer_id);
    return this.get(a.id);
  }

  async waive(adjustmentId: string): Promise<AdjustmentRow> {
    const a = await this.get(adjustmentId);
    if (a.status === 'charged') {
      const s = await this.db.get<{ customer_id: string }>('SELECT customer_id FROM shipments WHERE id = $1', [a.shipment_id]);
      await this.wallet.credit(s!.customer_id, a.diff_pence, `waive:${a.id}`, 'Weight adjustment waived');
    }
    await this.db.run("UPDATE adjustments SET status = 'waived' WHERE id = $1", [a.id]);
    const s = await this.db.get<{ customer_id: string }>('SELECT customer_id FROM shipments WHERE id = $1', [a.shipment_id]);
    if (s) await this.refreshPause(s.customer_id);
    return this.get(a.id);
  }

  async dispute(adjustmentId: string, customerId: string): Promise<AdjustmentRow> {
    const a = await this.get(adjustmentId);
    const s = await this.db.get<{ customer_id: string }>('SELECT customer_id FROM shipments WHERE id = $1', [a.shipment_id]);
    if (s?.customer_id !== customerId) throw new AppError('not_found', 'Adjustment not found');
    if (a.diff_pence === 0) throw new AppError('bad_request', 'Nothing was charged for this measurement');
    await this.db.run("UPDATE adjustments SET status = 'disputed' WHERE id = $1 AND status IN ('charged','failed','pending')", [a.id]);
    return this.get(a.id);
  }

  async unpaidTotal(customerId: string): Promise<Pence> {
    const r = await this.db.get<{ s: number | null }>(
      `SELECT SUM(a.diff_pence) AS s FROM adjustments a JOIN shipments s ON s.id = a.shipment_id WHERE s.customer_id = $1 AND a.status IN ('failed','pending')`, [customerId]);
    return Number(r?.s ?? 0);
  }

  private async refreshPause(customerId: string) {
    const owed = await this.unpaidTotal(customerId);
    await this.db.run('UPDATE customers SET bookings_paused = $1 WHERE id = $2', [owed > PAUSE_THRESHOLD_PENCE ? 1 : 0, customerId]);
  }

  async listForCustomer(customerId: string) {
    return this.db.all<AdjustmentRow & { ref: string; service_name: string; parcel_json: string }>(
      `SELECT a.*, s.ref, s.service_name, s.parcel_json FROM adjustments a JOIN shipments s ON s.id = a.shipment_id
        WHERE s.customer_id = $1 ORDER BY a.created_at DESC`, [customerId]);
  }

  async listAll(status?: AdjustmentStatus) {
    return this.db.all<AdjustmentRow & { ref: string; customer_id: string; service_name: string }>(
      `SELECT a.*, s.ref, s.customer_id, s.service_name FROM adjustments a JOIN shipments s ON s.id = a.shipment_id
        ${status ? 'WHERE a.status = $1' : ''} ORDER BY a.created_at DESC LIMIT 200`, status ? [status] : []);
  }
}
