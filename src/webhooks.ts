import type { Db, Queryable } from './db/db.ts';
import { newId } from './core/ids.ts';
import type { Clock } from './core/clock.ts';
import type { BookingService } from './bookings/bookings.ts';
import type { Wallet } from './wallet/wallet.ts';
import type { AdjustmentService } from './adjustments/adjustments.ts';
import type { ProviderEvent } from './providers/types.ts';

async function seen(db: Queryable, provider: string, eventId: string): Promise<boolean> {
  return Boolean(await db.get('SELECT 1 AS x FROM webhook_events WHERE provider = $1 AND event_id = $2', [provider, eventId]));
}

/**
 * Mark an event as processed. Called AFTER the work succeeded, so a crash
 * mid-way lets the provider's retry run it again (all handlers are idempotent).
 */
async function mark(db: Queryable, provider: string, eventId: string, clock: Clock): Promise<boolean> {
  // ON CONFLICT instead of catching the error: in Postgres a failed INSERT would abort the surrounding transaction.
  const r = await db.run('INSERT INTO webhook_events (provider, event_id, received_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [
    provider, eventId, clock.now().toISOString()]);
  return r.changes === 1;
}

type StripeEvent = {
  id: string;
  type: string;
  data: { object: { id: string; amount_received?: number; amount?: number; customer?: string | null; payment_method?: string | null; metadata?: Record<string, string> } };
};

export class WebhookHandlers {
  private readonly db: Db;
  private readonly clock: Clock;
  private readonly bookings: BookingService;
  private readonly wallet: Wallet;
  private readonly adjustments: AdjustmentService;

  constructor(deps: { db: Db; clock: Clock; bookings: BookingService; wallet: Wallet; adjustments: AdjustmentService }) {
    this.db = deps.db;
    this.clock = deps.clock;
    this.bookings = deps.bookings;
    this.wallet = deps.wallet;
    this.adjustments = deps.adjustments;
  }

  /** Stripe event (signature already verified by the router). */
  async stripe(ev: StripeEvent): Promise<void> {
    if (await seen(this.db, 'stripe', ev.id)) return;
    await this.handleStripe(ev);
    await mark(this.db, 'stripe', ev.id, this.clock);
  }

  private async handleStripe(ev: StripeEvent): Promise<void> {
    if (ev.type !== 'payment_intent.succeeded') return;
    const pi = ev.data.object;
    const md = pi.metadata ?? {};
    const amount = pi.amount_received ?? pi.amount ?? 0;
    const customerId = md.customer_id;
    if (!customerId) return;
    // Remember the card for future off-session charges (weight adjustments).
    if (pi.payment_method && pi.customer) {
      await this.db.run('UPDATE customers SET default_payment_method = $1, stripe_customer_id = COALESCE(stripe_customer_id, $2) WHERE id = $3', [
        pi.payment_method, pi.customer, customerId]);
    }
    if (md.purpose === 'topup') await this.wallet.topUp(customerId, amount, pi.id);
    if (md.purpose === 'booking' && md.shipment_id) await this.bookings.onCardPaid(md.shipment_id, pi.id, amount);
  }

  /** Normalised carrier/provider events (tracking + measurements). */
  async carrier(provider: string, events: ProviderEvent[]): Promise<void> {
    for (const ev of events) {
      if (await seen(this.db, provider, ev.eventId)) continue;
      if (ev.type === 'tracking') {
        const s = await this.db.get<{ id: string }>('SELECT id FROM shipments WHERE tracking_number = $1', [ev.trackingNumber]);
        if (!s) {
          await mark(this.db, provider, ev.eventId, this.clock);
          continue;
        }
        await this.db.tx(async (tx) => {
          if (!(await mark(tx, provider, ev.eventId, this.clock))) return;
          await tx.run('INSERT INTO tracking_events (id, shipment_id, status, description, occurred_at) VALUES ($1,$2,$3,$4,$5)', [
            newId('trk'), s.id, ev.status, ev.description, ev.occurredAt]);
          await tx.run("UPDATE shipments SET status = $1, updated_at = $2 WHERE id = $3 AND status NOT IN ('cancelled','failed')", [
            ev.status, this.clock.now().toISOString(), s.id]);
        });
      } else if (ev.type === 'label_update') {
        // The event only says "something changed"; ask the provider for the truth.
        const s = await this.db.get<{ id: string }>('SELECT id FROM shipments WHERE provider = $1 AND provider_label_id = $2', [provider, ev.providerLabelId]);
        if (s) await this.bookings.refreshPendingLabel(s.id);
        await mark(this.db, provider, ev.eventId, this.clock);
      } else {
        await this.adjustments.handleMeasurement(ev);
        await mark(this.db, provider, ev.eventId, this.clock);
      }
    }
  }
}
