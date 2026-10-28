import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, ukReq } from './helpers.ts';
import { GuestCheckout } from '../src/guest/guest.ts';

const addr = (r: ReturnType<typeof ukReq>) => ({
  from: { ...r.from, phone: '07700900111' }, to: { ...r.to, phone: '07700900222' }, parcel: r.parcel,
});

test('guest checkout: buy a label without an account, then view and download it by link only', async () => {
  const { app } = await makeApp();
  const g = new GuestCheckout(app);
  const r = ukReq();
  const preview = (await app.quotes.quote('anonymous', r)).quotes[0]!;
  const out = await g.book({ email: 'Ann@Example.com', name: 'Ann Smith', ...addr(r), contents: 'Books', valuePence: 2000,
    carrier: preview.carrier, serviceCode: preview.serviceCode, expectedPricePence: preview.price, idempotencyKey: 'k1' });
  assert.equal(out.status, 'booked');
  const v = await g.view(out.token);
  assert.equal(v.email, 'ann@example.com');
  assert.ok(v.tracking && v.hasLabel);
  const pdf = await g.labelPdf(out.token);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  await assert.rejects(g.view('wrong-token'));
  // Same email again reuses the guest record; a real account with that email is never touched.
  const again = await g.book({ email: 'ann@example.com', name: 'Ann Smith', ...addr(r), contents: 'Books', valuePence: 2000,
    carrier: preview.carrier, serviceCode: preview.serviceCode, expectedPricePence: preview.price, idempotencyKey: 'k2' });
  const owners = await app.db.all<{ customer_id: string }>('SELECT DISTINCT customer_id FROM shipments');
  assert.equal(owners.length, 1);
  assert.notEqual(again.token, out.token);
  assert.equal(await app.ledger.trialBalance(), 0);
});

test('guest checkout never charges more than the price shown', async () => {
  const { app } = await makeApp();
  const g = new GuestCheckout(app);
  const r = ukReq();
  const preview = (await app.quotes.quote('anonymous', r)).quotes[0]!;
  await assert.rejects(g.book({ email: 'b@example.com', name: 'Bo Li', ...addr(r), contents: 'Shoes', valuePence: 0,
    carrier: preview.carrier, serviceCode: preview.serviceCode, expectedPricePence: preview.price - 1, idempotencyKey: 'k3' }), /price/);
  await assert.rejects(g.book({ email: 'not-an-email', name: 'Bo Li', ...addr(r), contents: 'Shoes', valuePence: 0,
    carrier: preview.carrier, serviceCode: preview.serviceCode, expectedPricePence: preview.price, idempotencyKey: 'k4' }), /email/);
});
