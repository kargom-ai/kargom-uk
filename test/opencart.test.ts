import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, makeCustomer, ukReq } from './helpers.ts';

const ORDERS = [{
  order_id: '77', date_added: '2026-10-30 14:05:00', email: 'lee@example.com', telephone: '07700900444', firstname: 'Lee', lastname: 'Fox',
  shipping_firstname: 'Lee', shipping_lastname: 'Fox', shipping_company: '', shipping_address_1: '22 Quay St', shipping_address_2: '', shipping_city: 'Bristol', shipping_postcode: 'bs1 4dj', shipping_iso: 'GB',
  payment_address_1: 'x', total: '42.0000', currency_code: 'GBP', currency_value: '1.00000000', order_status_id: '2',
  products: [{ name: 'Teapot', model: 'TP1', quantity: '2', price: '15.0000', weight: '500.00000000', weight_unit: 'g' }, { name: 'Cups', model: 'C4', quantity: '1', price: '12', weight: '0.3', weight_unit: 'kg' }],
}, { order_id: '78', shipping_address_1: '', payment_address_1: '', products: [] }];

function fakeShop() {
  let key = '';
  let fileUp = false;
  const calls: Array<{ url: string; key: string | null; body: any }> = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const k = new Headers(init.headers).get('x-kargom-key');
    calls.push({ url, key: k, body: init.body ? JSON.parse(String(init.body)) : null });
    if (!fileUp) return new Response('<html>Not found</html>', { status: 404 });
    if (k !== key) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    const action = new URL(url).searchParams.get('action');
    if (action === 'ping') return new Response(JSON.stringify({ ok: true, name: 'Fox Tea Co', opencart: '3.0.3.8' }));
    if (action === 'orders') return new Response(JSON.stringify({ ok: true, orders: ORDERS }));
    if (action === 'ship') return new Response(JSON.stringify({ ok: true, order_id: 77, status_id: 3 }));
    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
  }) as unknown as typeof fetch;
  return { calls, f, upload: (php: string) => { key = /define\('KARGOM_KEY', '([0-9a-f]+)'\)/.exec(php)![1]!; fileUp = true; } };
}

test('OpenCart: connector file with a private key → check → orders with weights → ship → tracking in order history', async () => {
  const { app } = await makeApp();
  const shop = fakeShop();
  app.opencart.fetch = shop.f;
  app.opencart.lookup = async () => ['93.184.216.34'];
  const c = await makeCustomer(app);

  const { id } = await app.opencart.start(c, 'foxtea.co.uk');
  const php = await app.opencart.file(c, id);
  assert.match(php, /define\('KARGOM_KEY', '[0-9a-f]{48}'\)/);
  assert.ok(!php.includes('__KARGOM_KEY__'));
  const other = await makeCustomer(app, 'other@kargom.test');
  await assert.rejects(app.opencart.file(other, id), /not found/i);

  await assert.rejects(app.opencart.verify(c, id), /kargom-connect\.php/);
  assert.equal((await app.stores.overview(c)).opencart.pending.length, 1);
  shop.upload(php);
  await app.opencart.verify(c, id);
  const ov = await app.stores.overview(c);
  assert.equal(ov.opencart.pending.length, 0);
  assert.equal(ov.opencart.stores[0]!.name, 'Fox Tea Co');
  assert.equal(ov.orders.length, 1);
  const o = ov.orders[0]!;
  assert.deepEqual([o.platform, o.name, o.to.city, o.to.postcode, o.weightGrams, o.totalPence, o.items.length], ['opencart', '#77', 'Bristol', 'BS1 4DJ', 1300, 4200, 2]);

  // starting again for a working shop keeps its key, so the uploaded file keeps working
  await app.opencart.start(c, 'https://foxtea.co.uk/');
  assert.equal(await app.opencart.file(c, id), php);

  await app.wallet.topUp(c, 5000, 'pi_o');
  const q = (await app.quotes.quote(c, ukReq())).quotes[0]!;
  const b = await app.bookings.book({ customerId: c, quoteToken: q.token, payWith: 'wallet', idempotencyKey: 'oc1' });
  const linked = await app.stores.link(c, o.id, b.shipment.id);
  assert.ok(linked.pushedAt, String(linked.pushError));
  const ship = shop.calls.find((x) => x.url.includes('action=ship'))!;
  assert.equal(ship.body.order_id, 77);
  assert.match(ship.body.comment, /Tracking number: /);
  assert.equal(await app.stores.pushTracking(b.shipment.id), false, 'sent once only');
});
