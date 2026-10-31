import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, makeCustomer, ukReq } from './helpers.ts';
import { normaliseSite } from '../src/integrations/woo.ts';

const KEY = 'ck_' + 'a'.repeat(40), SECRET = 'cs_' + 'b'.repeat(40);
const ORDERS = [
  { id: 41, number: '1041', status: 'processing', date_created_gmt: '2026-10-30T09:00:00', total: '29.50', currency: 'GBP',
    billing: { first_name: 'Ann', last_name: 'Lee', address_1: 'Bill St', city: 'Leeds', postcode: 'LS1 1AA', country: 'GB', email: 'ann@example.com', phone: '07700900111' },
    shipping: { first_name: 'Ann', last_name: 'Lee', company: '', address_1: '9 Ship Road', address_2: '', city: 'York', postcode: 'yo1 7hh', country: 'GB', phone: '' },
    line_items: [{ name: 'Candle', quantity: 2, sku: 'C1', price: 9.75, product_id: 7, variation_id: 0 }, { name: 'Soap', quantity: 1, sku: 'S1', price: 10, product_id: 8, variation_id: 81 }] },
  { id: 42, status: 'processing', billing: {}, shipping: {}, line_items: [] }, // no address: skipped
];

function fakeWoo() {
  const calls: Array<{ method: string; url: string; body: any; auth: string | null }> = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init.headers).get('authorization') });
    const j = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
    const u = new URL(url);
    const p = u.pathname.replace('/wp-json', '');
    if (p === '' || p === '/') return j({ name: 'Ann Candles' });
    if (p === '/wc/v3/orders') return j(ORDERS);
    if (p === '/wc/v3/settings/products/woocommerce_weight_unit') return j({ value: 'g' });
    if (p === '/wc/v3/products') return j([{ id: 7, weight: '300' }, { id: 8, weight: '' }]);
    if (p === '/wc/v3/products/8/variations/81') return j({ weight: '150' });
    if (p.startsWith('/wc-shipment-tracking/')) return j({ code: 'rest_no_route' }, 404);
    if (p === '/wc/v3/orders/41/notes') return j({ id: 1 }, 201);
    if (p === '/wc/v3/orders/41') return j({ id: 41, status: 'completed' });
    return j({ message: 'nope' }, 404);
  }) as unknown as typeof fetch;
  return { calls, f };
}

test('shop addresses: https only, public hosts only', () => {
  assert.equal(normaliseSite('www.ann-candles.co.uk'), 'https://www.ann-candles.co.uk');
  assert.equal(normaliseSite('https://ann.co.uk/wp-admin/admin.php?page=wc'), 'https://ann.co.uk');
  assert.equal(normaliseSite('https://ann.co.uk/store/'), 'https://ann.co.uk/store');
  for (const bad of ['http://ann.co.uk', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://ann.co.uk:8080', 'https://user:pw@ann.co.uk', 'ftp://ann.co.uk', 'intranet'])
    assert.throws(() => normaliseSite(bad), Error, bad);
});

test('WooCommerce: approve → key arrives → orders with weights → ship → tracking note + Completed', async () => {
  const { app } = await makeApp();
  const { calls, f } = fakeWoo();
  app.woo.fetch = f;
  app.woo.lookup = async () => ['93.184.216.34'];
  const c = await makeCustomer(app);

  const url = new URL(await app.woo.authorizeUrl(c, 'ann-candles.co.uk', 'https://kargom.test'));
  assert.equal(url.origin + url.pathname, 'https://ann-candles.co.uk/wc-auth/v1/authorize');
  assert.equal(url.searchParams.get('scope'), 'read_write');
  const state = url.searchParams.get('user_id')!;

  await assert.rejects(app.woo.callback(JSON.stringify({ user_id: 'guess', consumer_key: KEY, consumer_secret: SECRET })), /expired/);
  await app.woo.callback(JSON.stringify({ user_id: state, consumer_key: KEY, consumer_secret: SECRET, key_permissions: 'read_write' }));
  await assert.rejects(app.woo.callback(JSON.stringify({ user_id: state, consumer_key: KEY, consumer_secret: SECRET })), /expired/);
  const row = await app.db.get<{ token: string }>("SELECT token FROM shop_connections WHERE platform = 'woo'");
  assert.ok(row && !row.token.includes(KEY));

  await new Promise((r) => setTimeout(r, 50)); // background name + first sync
  const ov = await app.stores.overview(c);
  assert.equal(ov.woo.stores[0]!.name, 'Ann Candles');
  assert.equal(ov.orders.length, 1);
  const o = ov.orders[0]!;
  assert.deepEqual([o.platform, o.name, o.to.city, o.to.postcode, o.weightGrams, o.totalPence], ['woo', '#1041', 'York', 'YO1 7HH', 750, 2950]);
  assert.ok(calls.find((x) => x.url.includes('/wc/v3/orders?'))!.auth!.startsWith('Basic '));

  const pre = await app.stores.prefill(c, o.id);
  assert.equal(pre.platformName, 'WooCommerce');
  assert.equal(pre.to.phone, '07700900111');

  await app.wallet.topUp(c, 5000, 'pi_w');
  const q = (await app.quotes.quote(c, ukReq())).quotes[0]!;
  const b = await app.bookings.book({ customerId: c, quoteToken: q.token, payWith: 'wallet', idempotencyKey: 'woo1' });
  const linked = await app.stores.link(c, o.id, b.shipment.id);
  assert.ok(linked.pushedAt, String(linked.pushError));
  const note = calls.find((x) => x.url.endsWith('/orders/41/notes'))!;
  assert.equal(note.body.customer_note, true);
  assert.match(note.body.note, /Tracking number: /);
  assert.equal(calls.find((x) => x.method === 'PUT' && x.url.endsWith('/orders/41'))!.body.status, 'completed');
  assert.equal(await app.stores.pushTracking(b.shipment.id), false, 'sent once only');
});

test('WooCommerce: private addresses are refused before we call them', async () => {
  const { app } = await makeApp();
  app.woo.lookup = async () => ['10.0.0.5'];
  const c = await makeCustomer(app);
  await assert.rejects(app.woo.authorizeUrl(c, 'evil.example.com', 'https://kargom.test'), /could not reach/);
});
