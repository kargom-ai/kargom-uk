import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, makeCustomer, ukReq, stripeSign } from './helpers.ts';
import { MockProvider } from '../src/providers/mock.ts';
import type { ProviderRate, ShipmentRequest } from '../src/providers/types.ts';
import { acct } from '../src/ledger/ledger.ts';

class CheaperProvider extends MockProvider {
  override async getRates(req: ShipmentRequest, signal: AbortSignal): Promise<ProviderRate[]> {
    return (await super.getRates(req, signal)).map((r) => (r.carrier === 'evri' ? { ...r, cost: r.cost - 20 } : r));
  }
}

test('quotes: cheapest provider wins per service, a slow provider is skipped', async () => {
  const { app } = await makeApp();
  const c = await makeCustomer(app);
  app.registry.addStatic(new CheaperProvider('cheap'));
  const slow = new MockProvider('slow');
  slow.latencyMs = 5000;
  app.registry.addStatic(slow);
  const { quotes, failures } = await app.quotes.quote(c, ukReq());
  const evri = quotes.find((q) => q.carrier === 'evri')!;
  assert.equal(evri.provider, 'cheap');
  assert.deepEqual(failures.map((f) => f.provider), ['slow']);
  assert.equal(quotes[0]!.serviceName, 'InPost Locker to Locker');
  assert.equal(quotes[0]!.price, 239);
});

test('a quote cannot be tampered with or used after it expires', async () => {
  const { app, clock } = await makeApp();
  const c = await makeCustomer(app);
  const { quotes } = await app.quotes.quote(c, ukReq());
  const t = quotes[0]!.token;
  const [body, mac] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), price: 1 })).toString('base64url');
  await assert.rejects(app.bookings.book({ customerId: c, quoteToken: `${forged}.${mac}`, payWith: 'wallet', idempotencyKey: 'k1' }), { code: 'quote_invalid' });
  clock.advance(16 * 60_000);
  await assert.rejects(app.bookings.book({ customerId: c, quoteToken: t, payWith: 'wallet', idempotencyKey: 'k2' }), { code: 'quote_expired' });
});

test('wallet booking: label bought, money captured, cost recorded, double click is harmless', async () => {
  const { app } = await makeApp();
  const c = await makeCustomer(app);
  await app.wallet.topUp(c, 1000, 'pi_t');
  const q = (await app.quotes.quote(c, ukReq())).quotes.find((x) => x.carrier === 'evri')!;
  const [r1, r2] = await Promise.all([
    app.bookings.book({ customerId: c, quoteToken: q.token, payWith: 'wallet', idempotencyKey: 'click-1' }),
    app.bookings.book({ customerId: c, quoteToken: q.token, payWith: 'wallet', idempotencyKey: 'click-1' }),
  ]);
  assert.equal(r1.kind, 'booked');
  assert.equal(r1.shipment.id, r2.shipment.id);
  assert.ok(r1.shipment.tracking_number);
  assert.equal(await app.wallet.balance(c), 1000 - q.price);
  assert.equal(await app.ledger.sum(acct.providerCost('mock')), 231);
  assert.equal(await app.ledger.trialBalance(), 0);
});

test('wallet booking: if the provider refuses the label the money goes straight back', async () => {
  const { app, mock } = await makeApp();
  const c = await makeCustomer(app);
  await app.wallet.topUp(c, 1000, 'pi_t');
  const q = (await app.quotes.quote(c, ukReq())).quotes[0]!;
  mock.failNextLabel = true;
  const r = await app.bookings.book({ customerId: c, quoteToken: q.token, payWith: 'wallet', idempotencyKey: 'f1' });
  assert.equal(r.kind, 'failed');
  assert.equal(await app.wallet.balance(c), 1000);
  assert.equal(await app.ledger.trialBalance(), 0);
});

test('not enough in the wallet: nothing is created', async () => {
  const { app } = await makeApp();
  const c = await makeCustomer(app);
  const q = (await app.quotes.quote(c, ukReq())).quotes[0]!;
  await assert.rejects(app.bookings.book({ customerId: c, quoteToken: q.token, payWith: 'wallet', idempotencyKey: 'n1' }), { code: 'insufficient_funds' });
  assert.equal((await app.bookings.listForCustomer(c)).length, 0);
});

test('card booking: Stripe webhook completes it, and a retried webhook does nothing', async () => {
  const { app, clock } = await makeApp();
  const c = await makeCustomer(app);
  const q = (await app.quotes.quote(c, ukReq())).quotes[0]!;
  const r = await app.bookings.book({ customerId: c, quoteToken: q.token, payWith: 'card', idempotencyKey: 'c1' });
  assert.equal(r.kind, 'payment_required');
  const ev = {
    id: 'evt_1', type: 'payment_intent.succeeded',
    data: { object: { id: r.shipment.payment_ref!, amount_received: q.price, customer: 'cus_x', payment_method: 'pm_card', metadata: { purpose: 'booking', shipment_id: r.shipment.id, customer_id: c } } },
  };
  const now = Math.floor(clock.now().getTime() / 1000);
  const { verifyStripeSignature } = await import('../src/payments/stripe.ts');
  const raw = JSON.stringify(ev);
  verifyStripeSignature(raw, stripeSign(raw, now), 'whsec_test_secret', now);
  await app.webhooks.stripe(ev);
  await app.webhooks.stripe(ev);
  const s = await app.bookings.get(r.shipment.id);
  assert.equal(s.status, 'booked');
  assert.equal(await app.ledger.liability(acct.revenue), q.priceExVat);
  const saved = await app.db.get<{ default_payment_method: string }>('SELECT default_payment_method FROM customers WHERE id = $1', [c]);
  assert.equal(saved?.default_payment_method, 'pm_card');
  assert.equal(await app.ledger.trialBalance(), 0);
});

test('paused accounts cannot book', async () => {
  const { app } = await makeApp();
  const c = await makeCustomer(app);
  await app.db.run('UPDATE customers SET bookings_paused = 1 WHERE id = $1', [c]);
  const q = (await app.quotes.quote(c, ukReq())).quotes[0]!;
  await assert.rejects(app.bookings.book({ customerId: c, quoteToken: q.token, payWith: 'card', idempotencyKey: 'p1' }), { code: 'bookings_paused' });
});

test('Stripe signatures: wrong secret and old events are rejected', async () => {
  const { verifyStripeSignature } = await import('../src/payments/stripe.ts');
  const raw = '{"id":"evt"}';
  const now = 1_800_000_000;
  assert.throws(() => verifyStripeSignature(raw, stripeSign(raw, now, 'other'), 'whsec_test_secret', now), /does not match/);
  assert.throws(() => verifyStripeSignature(raw, stripeSign(raw, now - 1000), 'whsec_test_secret', now), /too old/);
  assert.throws(() => verifyStripeSignature(raw + ' ', stripeSign(raw, now), 'whsec_test_secret', now), /does not match/);
});
