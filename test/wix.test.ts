import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { makeApp, makeCustomer, ukReq } from './helpers.ts';
import { readSignedInstance } from '../src/integrations/wix.ts';

const SECRET = 'wix-secret';
process.env.WIX_APP_ID = 'app-123';
process.env.WIX_APP_SECRET = SECRET;
process.env.PUBLIC_URL = 'https://kargom.test';
const INSTANCE = '7f3b1a2c-1111-4222-8333-444455556666';

const signed = (payload: object) => {
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${createHmac('sha256', SECRET).update(p).digest('base64url')}.${p}`;
};

const ORDER = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001', number: '10023', createdDate: '2026-10-30T10:00:00Z', status: 'APPROVED', paymentStatus: 'PAID', fulfillmentStatus: 'NOT_FULFILLED',
  currency: 'GBP', weightUnit: 'KG', buyerInfo: { email: 'sam@example.com' },
  shippingInfo: { logistics: { shippingDestination: { address: { addressLine1: '4 Mill Lane', city: 'Bath', postalCode: 'ba1 1aa', country: 'GB' }, contactDetails: { firstName: 'Sam', lastName: 'Hill', phone: '07700900333' } } } },
  lineItems: [{ id: 'li-1', productName: { original: 'Tote bag' }, quantity: 3, price: { amount: '15.00' }, physicalProperties: { weight: 0.2, shippable: true } },
    { id: 'li-2', productName: { original: 'Gift card' }, quantity: 1, price: { amount: '10' }, physicalProperties: { shippable: false } }],
  priceSummary: { total: { amount: '55.00' } },
};

function fakeWix() {
  const calls: Array<{ url: string; body: any; auth: string | null }> = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body, auth: new Headers(init.headers).get('authorization') });
    const j = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
    if (url.endsWith('/oauth/access')) return body.code === 'good' ? j({ access_token: 'code-token', refresh_token: 'r' }) : j({ message: 'bad code' }, 400);
    if (url.endsWith('/oauth2/token')) return body.instance_id === INSTANCE ? j({ access_token: 'cc-token', expires_in: 14400 }) : j({ message: 'unknown instance' }, 404);
    if (url.endsWith('/apps/v1/instance')) return j({ instance: { instanceId: INSTANCE }, site: { siteDisplayName: 'Sam Totes', url: 'https://samtotes.co.uk' } });
    if (url.endsWith('/ecom/v1/orders/search')) return j({ orders: [ORDER, { ...ORDER, id: 'pickup-1', shippingInfo: {} }] });
    if (url.includes('/create-fulfillment')) return j({ fulfillmentId: 'f1' });
    return j({ message: 'nope' }, 404);
  }) as unknown as typeof fetch;
  return { calls, f };
}

test('Wix signed instance links are checked with the app secret and expire', () => {
  const now = Date.parse('2026-10-31T12:00:00Z');
  assert.deepEqual(readSignedInstance(signed({ instanceId: INSTANCE, signDate: '2026-10-31T11:00:00Z' }), SECRET, now), { instanceId: INSTANCE });
  assert.equal(readSignedInstance(signed({ instanceId: INSTANCE, signDate: '2026-10-29T11:00:00Z' }), SECRET, now), null);
  assert.equal(readSignedInstance(signed({ instanceId: INSTANCE }).replace(/^./, 'x'), SECRET, now), null);
  assert.equal(readSignedInstance('nonsense', SECRET, now), null);
});

test('Wix: install → code → which site → paid orders with weights → ship → fulfillment with tracking', async () => {
  const { app } = await makeApp();
  const { calls, f } = fakeWix();
  app.wix.fetch = f;
  const c = await makeCustomer(app);

  const url = new URL(await app.wix.installUrl(c, 'https://kargom.test'));
  assert.equal(url.origin + url.pathname, 'https://www.wix.com/installer/install');
  assert.equal(url.searchParams.get('redirectUrl'), 'https://kargom.test/api/shop/wix/callback');
  const state = url.searchParams.get('state')!;
  await assert.rejects(app.wix.callback(new URLSearchParams({ state: 'x' }), null), /sign in/);
  await assert.rejects(app.wix.callback(new URLSearchParams({ state, code: 'bad' }), null), /did not give access/);

  const state2 = new URL(await app.wix.installUrl(c, 'https://kargom.test')).searchParams.get('state')!;
  await app.wix.callback(new URLSearchParams({ state: state2, code: 'good', instanceId: 'ignored-unsigned' }), null);

  const ov = await app.stores.overview(c);
  assert.deepEqual(ov.wix.stores.map((s) => [s.name, s.shop]), [['Sam Totes', INSTANCE]]);
  assert.equal(ov.orders.length, 1, 'pickup / no-address orders are skipped');
  const o = ov.orders[0]!;
  assert.deepEqual([o.platform, o.name, o.to.postcode, o.weightGrams, o.totalPence, o.items.length], ['wix', '#10023', 'BA1 1AA', 600, 5500, 1]);
  assert.equal(calls.find((x) => x.url.endsWith('/orders/search'))!.auth, 'cc-token');

  // another account cannot take the same site
  const other = await makeCustomer(app, 'o@kargom.test');
  await assert.rejects(app.wix.fromDashboard(signed({ instanceId: INSTANCE, signDate: new Date().toISOString() }), other), /another Kargom account/);

  await app.wallet.topUp(c, 5000, 'pi_x');
  const q = (await app.quotes.quote(c, ukReq())).quotes[0]!;
  const b = await app.bookings.book({ customerId: c, quoteToken: q.token, payWith: 'wallet', idempotencyKey: 'wix1' });
  const linked = await app.stores.link(c, o.id, b.shipment.id);
  assert.ok(linked.pushedAt, String(linked.pushError));
  const ff = calls.find((x) => x.url.includes(`/fulfillments/orders/${ORDER.id}/create-fulfillment`))!;
  assert.deepEqual(ff.body.fulfillment.lineItems, [{ id: 'li-1' }]);
  assert.ok(ff.body.fulfillment.trackingInfo.trackingNumber && ff.body.fulfillment.trackingInfo.shippingProvider);
  assert.equal(await app.stores.pushTracking(b.shipment.id), false, 'sent once only');
});
