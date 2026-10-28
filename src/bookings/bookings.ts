import type { Db, Queryable } from '../db/db.ts';
import { isUniqueViolation } from '../db/db.ts';
import { AppError } from '../core/errors.ts';
import { newId, shipmentRef } from '../core/ids.ts';
import type { Clock } from '../core/clock.ts';
import type { Pence } from '../core/money.ts';
import { acct, type Ledger } from '../ledger/ledger.ts';
import type { Wallet } from '../wallet/wallet.ts';
import type { PaymentGateway } from '../payments/stripe.ts';
import type { QuotePayload, QuoteSigner } from '../quotes/quotes.ts';
import type { ShippingProvider } from '../providers/types.ts';

export type PayWith = 'wallet' | 'card';

export type ShipmentRow = {
  id: string;
  ref: string;
  customer_id: string;
  idempotency_key: string;
  status: string;
  provider: string;
  provider_rate_id: string | null;
  provider_label_id: string | null;
  carrier: string;
  service_code: string;
  service_name: string;
  tracking_number: string | null;
  label_url: string | null;
  from_json: string;
  to_json: string;
  parcel_json: string;
  cost_pence: number;
  price_pence: number;
  vat_pence: number;
  pay_method: PayWith;
  payment_ref: string | null;
  created_at: string;
  updated_at: string;
};

export type BookResult =
  | { kind: 'booked'; shipment: ShipmentRow }
  | { kind: 'payment_required'; shipment: ShipmentRow; clientSecret: string; checkoutUrl?: string }
  | { kind: 'failed'; shipment: ShipmentRow; reason: string };

/**
 * Booking saga:
 *   1. verify the signed quote (price cannot be changed by the browser)
 *   2. create the shipment as `pending` and reserve the money
 *        wallet → hold in the same DB transaction (fails cleanly if short)
 *        card   → Stripe PaymentIntent; the hold is funded by the
 *                 payment_intent.succeeded webhook, then we continue
 *   3. buy the label from the provider (only one worker can move pending → purchasing)
 *   4. success → capture the hold as revenue and record our provider cost
 *      failure → release the hold to the wallet, or refund the card
 * Every step is idempotent, so retries (double clicks, webhook redeliveries) are safe.
 */
export class BookingService {
  private readonly db: Db;
  private readonly ledger: Ledger;
  private readonly wallet: Wallet;
  private readonly payments: PaymentGateway;
  private readonly signer: QuoteSigner;
  private readonly providers: (id: string) => ShippingProvider | undefined;
  private readonly clock: Clock;

  /** Called after a label exists (instant = bought on the spot; otherwise it arrived later). */
  onLabelReady?: (shipmentId: string, instant: boolean) => void;

  constructor(deps: {
    db: Db; ledger: Ledger; wallet: Wallet; payments: PaymentGateway; signer: QuoteSigner;
    providers: (id: string) => ShippingProvider | undefined; clock: Clock;
  }) {
    this.db = deps.db;
    this.ledger = deps.ledger;
    this.wallet = deps.wallet;
    this.payments = deps.payments;
    this.signer = deps.signer;
    this.providers = deps.providers;
    this.clock = deps.clock;
  }

  private now() {
    return this.clock.now().toISOString();
  }

  async get(id: string, q?: Queryable): Promise<ShipmentRow> {
    const s = await (q ?? this.db).get<ShipmentRow>('SELECT * FROM shipments WHERE id = $1', [id]);
    if (!s) throw new AppError('not_found', 'Shipment not found');
    return s;
  }

  async book(input: { customerId: string; quoteToken: string; payWith: PayWith; idempotencyKey: string; returnBase?: string; successUrl?: string; cancelUrl?: string }): Promise<BookResult> {
    const quote = this.signer.verify(input.quoteToken, this.clock.now());
    if (quote.customerId !== input.customerId) throw new AppError('quote_invalid', 'This quote belongs to another account');
    if (!input.idempotencyKey || input.idempotencyKey.length > 100) throw new AppError('bad_request', 'Idempotency-Key header is required');
    const idemKey = `${input.customerId}:${input.idempotencyKey}`;

    const prior = await this.db.get<ShipmentRow>('SELECT * FROM shipments WHERE idempotency_key = $1', [idemKey]);
    if (prior) return this.resultFor(prior);

    const customer = await this.db.get<{ bookings_paused: number; stripe_customer_id: string | null; email: string; name: string }>(
      'SELECT bookings_paused, stripe_customer_id, email, name FROM customers WHERE id = $1', [input.customerId]);
    if (!customer) throw new AppError('not_found', 'Customer not found');
    if (customer.bookings_paused) throw new AppError('bookings_paused', 'Bookings are paused on this account. Please settle the unpaid balance in Help.');

    const id = newId('shp');
    let shipment: ShipmentRow;
    try {
      shipment = await this.createPending(id, idemKey, input, quote);
    } catch (e) {
      // Same Idempotency-Key sent twice at the same moment: return the winner.
      if (isUniqueViolation(e)) {
        const winner = await this.db.get<ShipmentRow>('SELECT * FROM shipments WHERE idempotency_key = $1', [idemKey]);
        if (winner) return this.resultFor(winner);
      }
      throw e;
    }

    // Cards are saved on the Stripe customer, so weight adjustments can be charged later.
    let stripeId = customer.stripe_customer_id;
    if (input.payWith === 'card' && !stripeId) {
      stripeId = (await this.payments.createCustomer({ email: customer.email, name: customer.name, idempotencyKey: `cus:${input.customerId}` })).id;
      await this.db.run('UPDATE customers SET stripe_customer_id = $1 WHERE id = $2', [stripeId, input.customerId]);
    }
    if (input.payWith === 'card' && input.returnBase) {
      // Stripe Checkout: the customer pays on Stripe's page and comes back to /app/send.
      const cs = await this.payments.createCheckout({
        amount: quote.price, customerStripeId: stripeId, description: `${quote.rate.carrierName} ${quote.rate.serviceName} · ${shipment.ref}`,
        metadata: { purpose: 'booking', shipment_id: id, customer_id: input.customerId },
        successUrl: input.successUrl ?? `${input.returnBase}/app/send?paid=${id}`, cancelUrl: input.cancelUrl ?? `${input.returnBase}/app/send?cancelled=${id}`,
        idempotencyKey: `cs:${id}`, saveCard: true,
      });
      await this.db.run('UPDATE shipments SET payment_ref = $1, updated_at = $2 WHERE id = $3', [cs.id, this.now(), id]);
      return { kind: 'payment_required', shipment: await this.get(id), clientSecret: '', checkoutUrl: cs.url };
    }
    if (input.payWith === 'card') {
      // Card form on our own page (Stripe Payment Element) confirms this PaymentIntent.
      const pi = await this.payments.createPaymentIntent({
        amount: quote.price,
        customerStripeId: stripeId,
        metadata: { purpose: 'booking', shipment_id: id, customer_id: input.customerId },
        idempotencyKey: `pi:${id}`,
        saveCard: true,
      });
      await this.db.run('UPDATE shipments SET payment_ref = $1, updated_at = $2 WHERE id = $3', [pi.id, this.now(), id]);
      return { kind: 'payment_required', shipment: await this.get(id), clientSecret: pi.clientSecret };
    }

    return this.purchase(shipment.id, quote.req);
  }

  private createPending(id: string, idemKey: string, input: { customerId: string; payWith: PayWith }, quote: QuotePayload): Promise<ShipmentRow> {
    return this.db.tx(async (tx) => {
      const seq = await tx.get<{ n: number }>('UPDATE shipment_seq SET n = n + 1 RETURNING n');
      const now = this.now();
      await tx.run(
        `INSERT INTO shipments (id, ref, customer_id, idempotency_key, status, provider, provider_rate_id, carrier, service_code, service_name,
           from_json, to_json, parcel_json, cost_pence, price_pence, vat_pence, pay_method, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [id, shipmentRef(seq!.n), input.customerId, idemKey, input.payWith === 'wallet' ? 'pending' : 'awaiting_payment',
          quote.rate.provider, quote.rate.providerRateId, quote.rate.carrier, quote.rate.serviceCode, quote.rate.serviceName,
          JSON.stringify(quote.req.from), JSON.stringify(quote.req.to), JSON.stringify(quote.req.parcel),
          quote.rate.cost, quote.price, quote.vat, input.payWith, now, now],
      );
      if (input.payWith === 'wallet') {
        const holdId = await this.wallet.hold(input.customerId, quote.price, id, `hold:${id}`, tx);
        await tx.run('UPDATE shipments SET payment_ref = $1 WHERE id = $2', [holdId, id]);
      }
      return this.get(id, tx);
    });
  }

  /** Called from the Stripe webhook when a booking's card payment succeeded. */
  async onCardPaid(shipmentId: string, paymentIntentId: string, amount: Pence): Promise<BookResult> {
    const s = await this.get(shipmentId);
    if (s.status !== 'awaiting_payment') return this.resultFor(s);
    if (amount !== s.price_pence) throw new AppError('payment_failed', `Paid ${amount} but the label costs ${s.price_pence}`);
    await this.db.tx(async (tx) => {
      const holdId = newId('hold');
      const existing = await tx.get<{ id: string }>('SELECT id FROM holds WHERE ref = $1', [shipmentId]);
      if (!existing) {
        await tx.run('INSERT INTO holds (id, customer_id, amount, status, ref, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [
          holdId, s.customer_id, amount, 'held', shipmentId, this.now()]);
        await this.ledger.post({
          idempotencyKey: `card:${paymentIntentId}`, kind: 'card_sale', ref: shipmentId,
          lines: [{ account: acct.cashStripe, amount }, { account: acct.hold(s.customer_id), amount: -amount }],
        }, tx);
      }
      await tx.run('UPDATE shipments SET status = $1, payment_ref = $2, updated_at = $3 WHERE id = $4 AND status = $5', ['pending', paymentIntentId, this.now(), shipmentId, 'awaiting_payment']);
    });
    const req = { from: JSON.parse(s.from_json), to: JSON.parse(s.to_json), parcel: JSON.parse(s.parcel_json) };
    return this.purchase(shipmentId, req);
  }

  private async purchase(shipmentId: string, req: import('../providers/types.ts').ShipmentRequest): Promise<BookResult> {
    // Claim the shipment: only one caller can move it from pending to purchasing.
    const claim = await this.db.run('UPDATE shipments SET status = $1, updated_at = $2 WHERE id = $3 AND status = $4', ['purchasing', this.now(), shipmentId, 'pending']);
    const s = await this.get(shipmentId);
    if (claim.changes !== 1) return this.resultFor(s);

    const provider = this.providers(s.provider);
    const hold = await this.db.get<{ id: string }>('SELECT id FROM holds WHERE ref = $1', [shipmentId]);
    try {
      if (!provider) throw new AppError('provider_failed', `Provider ${s.provider} is not connected`);
      const label = await provider.buyLabel(
        { provider: s.provider, providerRateId: s.provider_rate_id ?? '', carrier: s.carrier, carrierName: s.carrier, serviceCode: s.service_code, serviceName: s.service_name, cost: s.cost_pence, transitDays: null, dropOff: false },
        req,
        `label:${shipmentId}`,
      );
      await this.db.tx(async (tx) => {
        // A provider that issues the label later (Packlink) leaves the shipment in awaiting_label.
        await tx.run(
          'UPDATE shipments SET status = $1, provider_label_id = $2, tracking_number = $3, label_url = $4, cost_pence = $5, updated_at = $6 WHERE id = $7',
          [label.pending ? 'awaiting_label' : 'booked', label.providerLabelId, label.trackingNumber || null, label.labelUrl || null, label.cost, this.now(), shipmentId],
        );
        if (hold) await this.wallet.capture(hold.id, tx);
        await this.ledger.post({
          idempotencyKey: `cost:${shipmentId}`, kind: 'provider_cost', ref: shipmentId,
          lines: [{ account: acct.providerCost(s.provider), amount: label.cost }, { account: acct.providerPayable(s.provider), amount: -label.cost }],
        }, tx);
      });
      if (!label.pending) this.onLabelReady?.(shipmentId, true);
      return { kind: 'booked', shipment: await this.get(shipmentId) };
    } catch (e) {
      const reason = (e as Error).message;
      await this.undoPayment(s, hold?.id);
      await this.db.run('UPDATE shipments SET status = $1, updated_at = $2 WHERE id = $3', ['failed', this.now(), shipmentId]);
      return { kind: 'failed', shipment: await this.get(shipmentId), reason };
    }
  }

  /** Give the money back after a failed label purchase. */
  private async undoPayment(s: ShipmentRow, holdId: string | undefined) {
    if (!holdId) return;
    if (s.pay_method === 'wallet') {
      await this.wallet.release(holdId);
      return;
    }
    // Card: refund through Stripe, then reverse the ledger (hold → cash).
    if (s.payment_ref) await this.payments.refund({ paymentIntentId: s.payment_ref, idempotencyKey: `refund:${s.id}` });
    await this.db.tx(async (tx) => {
      await this.ledger.post({
        idempotencyKey: `cardrefund:${s.id}`, kind: 'refund', ref: s.id,
        lines: [{ account: acct.hold(s.customer_id), amount: s.price_pence }, { account: acct.cashStripe, amount: -s.price_pence }],
      }, tx);
      await tx.run('UPDATE holds SET status = $1 WHERE id = $2', ['released', holdId]);
    });
  }

  private resultFor(s: ShipmentRow): BookResult {
    if (s.status === 'failed') return { kind: 'failed', shipment: s, reason: 'Label purchase failed earlier' };
    if (s.status === 'awaiting_payment') return { kind: 'payment_required', shipment: s, clientSecret: '' };
    return { kind: 'booked', shipment: s };
  }

  /**
   * Labels that arrive later: ask the provider again. Ready → booked with the label;
   * failed → refunded in full. Safe to call any number of times.
   */
  async refreshPendingLabel(shipmentId: string): Promise<string> {
    const s = await this.get(shipmentId);
    if (s.status !== 'awaiting_label' || !s.provider_label_id) return s.status;
    const provider = this.providers(s.provider);
    if (!provider?.checkLabel) return s.status;
    const r = await provider.checkLabel(s.provider_label_id);
    if (r.state === 'ready') {
      await this.db.run("UPDATE shipments SET status = 'booked', label_url = $1, tracking_number = $2, updated_at = $3 WHERE id = $4 AND status = 'awaiting_label'",
        [r.labelUrl, r.trackingNumber, this.now(), shipmentId]);
      this.onLabelReady?.(shipmentId, false);
      return 'booked';
    }
    if (r.state === 'failed') {
      await this.refundUnissued(s, r.detail);
      return 'failed';
    }
    return s.status;
  }

  /** The provider will never issue this label: give the customer all their money back. */
  async refundUnissued(s: ShipmentRow, reason: string) {
    const claim = await this.db.run("UPDATE shipments SET status = 'failed', updated_at = $1 WHERE id = $2 AND status = 'awaiting_label'", [this.now(), s.id]);
    if (claim.changes !== 1) return;
    await this.db.tx(async (tx) => {
      // Reverse the sale and the provider cost booked when the order was accepted.
      await this.ledger.post({ idempotencyKey: `unissued-cost:${s.id}`, kind: 'provider_cost', ref: s.id, memo: reason,
        lines: [{ account: acct.providerCost(s.provider), amount: -s.cost_pence }, { account: acct.providerPayable(s.provider), amount: s.cost_pence }] }, tx);
    });
    if (s.pay_method === 'card' && s.payment_ref) {
      await this.payments.refund({ paymentIntentId: s.payment_ref, idempotencyKey: `refund-unissued:${s.id}` });
      await this.ledger.post({ idempotencyKey: `unissued-sale:${s.id}`, kind: 'refund', ref: s.id, memo: reason,
        lines: [{ account: acct.revenue, amount: s.price_pence - s.vat_pence }, { account: acct.vatOutput, amount: s.vat_pence }, { account: acct.cashStripe, amount: -s.price_pence }] });
    } else {
      await this.ledger.post({ idempotencyKey: `unissued-sale:${s.id}`, kind: 'refund', ref: s.id, memo: reason,
        lines: [{ account: acct.revenue, amount: s.price_pence - s.vat_pence }, { account: acct.vatOutput, amount: s.vat_pence }, { account: acct.wallet(s.customer_id), amount: -s.price_pence }] });
    }
  }

  async listForCustomer(customerId: string, limit = 500) {
    // A card payment the customer abandoned is not a shipment yet, so it stays out of their list.
    return this.db.all<ShipmentRow>("SELECT * FROM shipments WHERE customer_id = $1 AND status <> 'awaiting_payment' ORDER BY created_at DESC LIMIT $2", [customerId, limit]);
  }
}
