import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { makeApp, makeCustomer, ukReq } from './helpers.ts';
import { normaliseShop, validQueryHmac, validWebhookHmac } from '../src/integrations/shopify.ts';

const SECRET = 'shpss_test_secret';
process.env.SHOPIFY_API_KEY = 'key123';
process.env.SHOPIFY_API_SECRET = SECRET;
process.env.PUBLIC_URL = 'https://kargom.test';

const sign = (p: URLSearchParams) => {
  const msg = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  p.set('hmac', createHmac('sha256', SECRET).update(msg).digest('hex'));
  return p;
};

const ORDER = {
  id: 'gid://shopify/Order/555', name: '#1001', createdAt: '2026-10-30T10:00:00Z', email: 'buyer@example.com', displayFulfillmentStatus: 'UNFULFILLED', displayFinancialStatus: 'PAID', cancelledAt: null,
  totalWeight: 1800, currentTotalPriceSet: { shopMoney: { amount: '24.99', currencyCode: 'GBP' } },
  shippingAddress: { name: 'Jo Buyer', company: null, address1: '1 High Street', address2: '', city: 'Leeds', zip: 'ls1 1aa', countryCodeV2: 'GB', phone: '07700900123' },
  lineItems: { nodes: [{ name: 'Mug', quantity: 2, sku: 'MUG', originalUnitPriceSet: { shopMoney: { amount: '9.99' } } }] },
  fulfillmentOrders: { nodes: [{ id: 'gid://shopify/FulfillmentOrder/77', status: 'OPEN' }, { id: 'gid://shopify/FulfillmentOrder/78', status: 'CLOSED' }] },
};

function fakeShopify() {
  const calls: Array<{ url: string; body: any; token?: string }> = [];
  const f = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body ?? '{}'));
    calls.push({ url, body, token: new Headers(init.headers).get('x-shopify-access-token') ?? undefined });
    if (url.endsWith('/admin/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'shpat_abc', scope: 'read_orders' }));
    const q = String(body.query);
    if (q.includes('shop { name }')) return new Response(JSON.stringify({ data: { shop: { name: 'Jo Mugs' } } }));
    if (q.includes('webhookSubscriptionCreate')) return new Response(JSON.stringify({ data: { webhookSubscriptionCreate: { userErrors: [] } } }));
    if (q.includes('orders(')) return new Response(JSON.stringify({ data: { orders: { nodes: [ORDER] } } }));
    if (q.includes('fulfillmentCreate')) return new Response(JSON.stringify({ data: { fulfillmentCreate: { fulfillment: { id: 'gid://shopify/Fulfillment/1' }, userErrors: [] } } }));
    return new Response(JSON.stringify({ errors: [{ message: 'unexpected' }] }), { status: 400 });
  }) as unknown as typeof fetch;
  return { calls, f };
}

test('shop addresses and Shopify signatures are checked', () => {
  assert.equal(normaliseShop('Jo-Mugs'), 'jo-mugs.myshopify.com');
  assert.equal(normaliseShop('https://jo-mugs.myshopify.com/admin/orders'), 'jo-mugs.myshopify.com');
  assert.throws(() => normaliseShop('evil.com'), /Shopify address/);
  assert.throws(() => normaliseShop('a.myshopify.com.evil.com'), /Shopify address/);
  const p = sign(new URLSearchParams({ shop: 'jo-mugs.myshopify.com', code: 'c', state: 's', timestamp: '1' }));
  assert.equal(validQueryHmac(p, SECRET), true);
  p.set('shop', 'other.myshopify.com');
  assert.equal(validQueryHmac(p, SECRET), false);
  const raw = '{"a":1}';
  assert.equal(validWebhookHmac(raw, createHmac('sha256', SECRET).update(raw).digest('base64'), SECRET), true);
  assert.equal(validWebhookHmac(raw, 'nope', SECRET), false);
});

test('connect → orders come in → ship → tracking is written back to Shopify once', async () => {
  const { app } = await makeApp();
  const { calls, f } = fakeShopify();
  app.shopify.fetch = f;
  const c = await makeCustomer(app);

  const url = new URL(await app.shopify.installUrl(c, 'jo-mugs', 'https://kargom.test'));
  assert.equal(url.host, 'jo-mugs.myshopify.com');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://kargom.test/api/shop/shopify/callback');
  const state = url.searchParams.get('state')!;

  // a forged reply is refused
  await assert.rejects(app.shopify.callback(new URLSearchParams({ shop: 'jo-mugs.myshopify.com', code: 'x', state, hmac: 'bad' })), /verified/);
  const done = await app.shopify.callback(sign(new URLSearchParams({ shop: 'jo-mugs.myshopify.com', code: 'x', state, timestamp: '1' })));
  assert.equal(done.customerId, c);
  // the state works once only
  await assert.rejects(app.shopify.callback(sign(new URLSearchParams({ shop: 'jo-mugs.myshopify.com', code: 'x', state, timestamp: '2' }))), /expired/);

  // token is stored sealed, never in plain text
  const row = await app.db.get<{ token: string }>('SELECT token FROM shop_connections');
  assert.ok(row && !row.token.includes('shpat_abc'));

  const ov = await app.shopify.overview(c);
  assert.equal(ov.stores[0]!.name, 'Jo Mugs');
  assert.equal(ov.orders.length, 1);
  const o = ov.orders[0]!;
  assert.deepEqual([o.name, o.to.postcode, o.weightGrams, o.totalPence], ['#1001', 'LS1 1AA', 1800, 2499]);
  assert.ok(calls.some((x) => x.token === 'shpat_abc'));

  // syncing again does not duplicate
  await app.shopify.sync(c);
  assert.equal((await app.shopify.overview(c)).orders.length, 1);

  // another customer cannot see or ship it
  const other = await makeCustomer(app, 'other@kargom.test');
  await assert.rejects(app.shopify.prefill(other, o.id), /not found/i);

  const pre = await app.shopify.prefill(c, o.id);
  assert.equal(pre.to.name, 'Jo Buyer');

  // book a real Kargom label, then link it
  await app.wallet.topUp(c, 5000, 'pi_s');
  const q = (await app.quotes.quote(c, ukReq())).quotes[0]!;
  const b = await app.bookings.book({ customerId: c, quoteToken: q.token, payWith: 'wallet', idempotencyKey: 'shop1' });
  const linked = await app.shopify.link(c, o.id, b.shipment.id);
  assert.equal(linked.status, 'shipped');
  const fc = calls.filter((x) => String(x.body.query).includes('fulfillmentCreate'));
  assert.equal(fc.length, 1);
  const fin = fc[0]!.body.variables.f;
  assert.deepEqual(fin.lineItemsByFulfillmentOrder, [{ fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/77' }]);
  assert.equal(fin.notifyCustomer, true);
  assert.ok(fin.trackingInfo.number);
  assert.ok(linked.pushedAt);
  // label-ready hook calling again does nothing
  assert.equal(await app.shopify.pushTracking(b.shipment.id), false);
  assert.equal(calls.filter((x) => String(x.body.query).includes('fulfillmentCreate')).length, 1);
});

test('uninstall and privacy webhooks remove the store data', async () => {
  const { app } = await makeApp();
  const { f } = fakeShopify();
  app.shopify.fetch = f;
  const c = await makeCustomer(app);
  const state = new URL(await app.shopify.installUrl(c, 'jo-mugs', 'https://kargom.test')).searchParams.get('state')!;
  await app.shopify.callback(sign(new URLSearchParams({ shop: 'jo-mugs.myshopify.com', code: 'x', state, timestamp: '1' })));
  await app.shopify.webhook('customers/redact', 'jo-mugs.myshopify.com', JSON.stringify({ customer: { email: 'buyer@example.com' }, orders_to_redact: [555] }));
  assert.equal((await app.shopify.overview(c)).orders.length, 0);
  await app.shopify.sync(c);
  await app.shopify.webhook('app/uninstalled', 'jo-mugs.myshopify.com', '{}');
  const ov = await app.shopify.overview(c);
  assert.equal(ov.stores.length, 0);
  assert.equal(ov.orders.length, 0);
  await app.shopify.webhook('shop/redact', 'jo-mugs.myshopify.com', '{}');
  assert.equal((await app.db.all('SELECT * FROM shop_connections')).length, 0);
});
