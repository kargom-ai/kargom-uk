import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, makeCustomer, ukReq } from './helpers.ts';
import { PacklinkProvider } from '../src/providers/packlink.ts';

/** A fake Packlink API that behaves like the one Packlink's shop plugins call. */
function fakePacklink() {
  const calls: Array<{ method: string; url: string; body: any; auth: string | null }> = [];
  let state = 'AWAITING_COMPLETION';
  const f = (async (url: string, init: RequestInit) => {
    const u = String(url);
    calls.push({ method: String(init.method), url: u, body: init.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init.headers).get('authorization') });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (u.includes('/v1/services?')) return json([
      { id: 20945, carrier_name: 'Evri', name: 'Drop Off', currency: 'GBP', dropoff: true, delivery_to_parcelshop: false, transit_hours: '48', price: { total_price: 2.16, tax_price: 0.36, base_price: 1.80 } },
      { id: 777, carrier_name: 'InPost', name: 'Locker to Locker', currency: 'GBP', dropoff: true, delivery_to_parcelshop: true, price: { base_price: 1.5 } },
    ]);
    if (u.endsWith('/v1/shipments') && init.method === 'POST') return json({ reference: 'UK2026PRO0001' });
    if (u.endsWith('/v1/shipments/UK2026PRO0001')) return json({ state, trackings: state === 'READY_TO_PRINT' ? ['H01234567890'] : [] });
    if (u.endsWith('/v1/shipments/UK2026PRO0001/labels')) return json(['https://packlink.example/label.pdf']);
    return json({ message: 'not found' }, 404);
  }) as unknown as typeof fetch;
  return { f, calls, setState: (s: string) => { state = s; } };
}

test('packlink: rates map to our services; parcel-shop delivery is left out', async () => {
  const fk = fakePacklink();
  const p = new PacklinkProvider({ apiKey: 'pl_key', fetchImpl: fk.f });
  const rates = await p.getRates(ukReq(), AbortSignal.timeout(1000));
  assert.equal(rates.length, 1);
  assert.deepEqual({ carrier: rates[0]!.carrier, code: rates[0]!.serviceCode, cost: rates[0]!.cost, later: rates[0]!.labelTiming, days: rates[0]!.transitDays },
    { carrier: 'evri', code: 'pl-20945', cost: 180, later: 'later', days: 2 });
  assert.equal(fk.calls[0]!.auth, 'pl_key');
  assert.match(fk.calls[0]!.url, /from%5Bzip%5D=M17\+1AA|from\[zip\]=M17/);
});

test('packlink: paid booking waits for the label, then becomes booked when Packlink issues it', async () => {
  const { app } = await makeApp();
  const fk = fakePacklink();
  app.registry.addStatic(new PacklinkProvider({ apiKey: 'k', fetchImpl: fk.f }));
  const c = await makeCustomer(app);
  await app.wallet.topUp(c, 1000, 'pi_t');
  const q = (await app.quotes.quote(c, { ...ukReq(), contents: 'Books', valuePence: 2500 })).quotes.find((x) => x.provider === 'packlink')!;
  assert.equal(q.labelLater, true);
  const r = await app.bookings.book({ customerId: c, quoteToken: q.token, payWith: 'wallet', idempotencyKey: 'p1' });
  assert.equal(r.shipment.status, 'awaiting_label');
  const draft = fk.calls.find((x) => x.method === 'POST')!.body;
  assert.equal(draft.service_id, 20945);
  assert.equal(draft.content, 'Books');
  assert.equal(draft.contentvalue, 25);
  assert.equal(draft.to.zip_code, 'LS1 5HD');
  assert.equal(await app.bookings.refreshPendingLabel(r.shipment.id), 'awaiting_label');
  fk.setState('READY_TO_PRINT');
  await app.webhooks.carrier('packlink', [{ type: 'label_update', eventId: 'e1', providerLabelId: 'UK2026PRO0001' }]);
  const s = await app.bookings.get(r.shipment.id);
  assert.equal(s.status, 'booked');
  assert.equal(s.label_url, 'https://packlink.example/label.pdf');
  assert.equal(s.tracking_number, 'H01234567890');
  assert.equal(await app.ledger.trialBalance(), 0);
});

test('packlink: a label that is never issued is refunded in full', async () => {
  const { app } = await makeApp();
  const fk = fakePacklink();
  app.registry.addStatic(new PacklinkProvider({ apiKey: 'k', fetchImpl: fk.f }));
  const c = await makeCustomer(app);
  await app.wallet.topUp(c, 1000, 'pi_t');
  const q = (await app.quotes.quote(c, ukReq())).quotes.find((x) => x.provider === 'packlink')!;
  const r = await app.bookings.book({ customerId: c, quoteToken: q.token, payWith: 'wallet', idempotencyKey: 'p2' });
  fk.setState('CANCELED');
  assert.equal(await app.bookings.refreshPendingLabel(r.shipment.id), 'failed');
  assert.equal(await app.wallet.balance(c), 1000);
  assert.equal(await app.ledger.trialBalance(), 0);
});
