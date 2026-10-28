import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../core/errors.ts';
import { newId } from '../core/ids.ts';
import type { App } from '../app.ts';
import type { Address, ShipmentRequest } from '../providers/types.ts';
import { FakeGateway } from '../payments/stripe.ts';
import { minimalLabelPdf } from './pdf.ts';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type GuestBookInput = {
  email: string; name: string; from: Address; to: Address;
  parcel: ShipmentRequest['parcel']; contents: string; valuePence: number;
  carrier: string; serviceCode: string; expectedPricePence: number; idempotencyKey: string;
  /** Set when the on-page card form cannot be used: pay on Stripe's own page and come back to the label link. */
  hostedReturnBase?: string;
};

/**
 * Buy a label without an account. The guest gets a private link (/l/<token>) that
 * shows, prints and shares the label. Behind the scenes a guest customer record
 * (one per email) keeps the ledger, refunds and weight adjustments working as usual.
 */
export class GuestCheckout {
  private readonly app: App;
  constructor(app: App) { this.app = app; }

  private async guestCustomer(email: string, name: string, phone?: string): Promise<string> {
    // Internal address, so a guest never collides with (or takes over) a registered account.
    const internal = `guest+${sha256(email.toLowerCase()).slice(0, 20)}@guest.kargom.invalid`;
    const found = await this.app.db.get<{ id: string }>('SELECT id FROM customers WHERE email = $1', [internal]);
    if (found) {
      await this.app.db.run('UPDATE customers SET name = $1, phone = COALESCE($2, phone) WHERE id = $3', [name, phone ?? null, found.id]);
      return found.id;
    }
    const id = newId('cus');
    await this.app.db.run(
      `INSERT INTO customers (id, email, name, company, phone, account_type, role, password_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,'guest','customer','guest-no-login',$6)`,
      [id, internal, name, email.toLowerCase(), phone ?? null, this.app.clock.now().toISOString()]);
    return id;
  }

  async book(i: GuestBookInput): Promise<{ token: string; shipmentId: string; clientSecret: string | null; checkoutUrl: string | null; pricePence: number; status: string }> {
    const email = String(i.email ?? '').trim();
    const name = String(i.name ?? '').trim();
    if (!EMAIL.test(email) || email.length > 200) throw new AppError('bad_request', 'Please enter a valid email address');
    if (name.length < 2 || name.length > 120) throw new AppError('bad_request', 'Please enter your full name');
    const contents = String(i.contents ?? '').trim();
    if (contents.length < 3) throw new AppError('bad_request', 'Tell us what is in the parcel (at least 3 characters)');
    if (!i.from || !i.to || i.from.country !== 'GB' || i.to.country !== 'GB') throw new AppError('bad_request', 'Guest checkout is for UK to UK parcels. Sign in to send abroad.');
    for (const a of [i.from, i.to]) if (!a.phone || String(a.phone).replace(/\D/g, '').length < 7) throw new AppError('bad_request', 'A phone number is needed for the collection and delivery address');
    const from: Address = { ...i.from, email, country: 'GB' };
    const req: ShipmentRequest = { from, to: { ...i.to, country: 'GB' }, parcel: i.parcel, contents, valuePence: Math.max(0, Math.round(Number(i.valuePence) || 0)) };

    const customerId = await this.guestCustomer(email, name, from.phone);
    const { quotes } = await this.app.quotes.quote(customerId, req);
    const q = quotes.find((x) => x.carrier === i.carrier && x.serviceCode === i.serviceCode);
    if (!q) throw new AppError('quote_invalid', 'This service is no longer available for these addresses. Please choose another.');
    // Never charge more than the customer saw; a cheaper live price is fine.
    if (q.price > i.expectedPricePence) throw new AppError('quote_invalid', `The price for this route is now £${(q.price / 100).toFixed(2)}. Please check and try again.`, { pricePence: q.price });

    const token = randomBytes(24).toString('base64url');
    const base = i.hostedReturnBase;
    const r = await this.app.bookings.book({ customerId, quoteToken: q.token, payWith: 'card', idempotencyKey: `guest:${String(i.idempotencyKey ?? '').slice(0, 80)}`,
      ...(base ? { returnBase: base, successUrl: `${base}/l/${token}`, cancelUrl: `${base}/checkout?cancelled=1` } : {}) });
    const shipmentId = r.shipment.id;
    await this.app.db.run('INSERT INTO guest_links (token_hash, shipment_id, email, created_at) VALUES ($1,$2,$3,$4)', [
      sha256(token), shipmentId, email.toLowerCase(), this.app.clock.now().toISOString()]);

    const pr = r.kind === 'payment_required' ? r : null;
    return { token, shipmentId, clientSecret: pr?.clientSecret || null, checkoutUrl: pr?.checkoutUrl ?? null, pricePence: q.price, status: r.shipment.status };
  }

  /** Test mode only (no Stripe keys): the test payment sheet confirms the card payment here. */
  async demoPay(token: string) {
    if (!(this.app.payments instanceof FakeGateway)) throw new AppError('forbidden', 'Only available in test mode');
    const { s } = await this.shipmentFor(token);
    if (s.status !== 'awaiting_payment') return { status: s.status };
    await this.app.webhooks.stripe({ id: `evt_demo_${s.id}`, type: 'payment_intent.succeeded',
      data: { object: { id: s.payment_ref ?? `pi_fake_${s.id}`, amount_received: s.price_pence, metadata: { purpose: 'booking', shipment_id: s.id, customer_id: s.customer_id } } } });
    return { status: (await this.app.bookings.get(s.id)).status };
  }

  private async shipmentFor(token: string) {
    if (!token || token.length > 100) throw new AppError('not_found', 'Label not found');
    const link = await this.app.db.get<{ shipment_id: string; email: string }>('SELECT shipment_id, email FROM guest_links WHERE token_hash = $1', [sha256(token)]);
    if (!link) throw new AppError('not_found', 'Label not found');
    return { s: await this.app.bookings.get(link.shipment_id), email: link.email };
  }

  /** What the label page shows. Only what the link holder needs, never account data. */
  async view(token: string) {
    const { s, email } = await this.shipmentFor(token);
    const f = JSON.parse(s.from_json) as Address, t = JSON.parse(s.to_json) as Address, p = JSON.parse(s.parcel_json) as ShipmentRequest['parcel'];
    return {
      ref: s.ref, status: s.status, service: s.service_name, carrier: s.carrier, tracking: s.tracking_number,
      price: s.price_pence, createdAt: s.created_at, hasLabel: Boolean(s.label_url), email,
      from: { name: f.name, line1: f.line1, city: f.city, postcode: f.postcode },
      to: { name: t.name, line1: t.line1, city: t.city, postcode: t.postcode },
      parcel: p,
    };
  }

  /** The label PDF, fetched from the provider and served from our own domain (so it can be previewed and printed). */
  async labelPdf(token: string): Promise<Buffer> {
    const { s } = await this.shipmentFor(token);
    if (!s.label_url) throw new AppError('not_found', 'The label is not ready yet');
    if (s.provider === 'mock' || s.label_url.startsWith('https://labels.example/')) {
      const t = JSON.parse(s.to_json) as Address, f = JSON.parse(s.from_json) as Address;
      return minimalLabelPdf([`TEST LABEL - ${s.service_name}`, `Tracking: ${s.tracking_number ?? ''}`, `Ref: ${s.ref}`, '',
        'FROM:', f.name, f.line1, `${f.city} ${f.postcode}`, '', 'TO:', t.name, t.line1, ...(t.line2 ? [t.line2] : []), `${t.city} ${t.postcode}`]);
    }
    const url = new URL(s.label_url);
    if (url.protocol !== 'https:') throw new AppError('provider_failed', 'Label link is not secure');
    let res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    // ShipStation/ShipEngine downloads may want our API key; only ever send it to their own hosts.
    if ((res.status === 401 || res.status === 403) && /(^|\.)(shipstation|shipengine)\.com$/.test(url.hostname) && process.env.SHIPSTATION_API_KEY) {
      res = await fetch(url, { headers: { 'API-Key': process.env.SHIPSTATION_API_KEY }, signal: AbortSignal.timeout(15_000) });
    }
    if (!res.ok) throw new AppError('provider_failed', `Could not fetch the label (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
}
