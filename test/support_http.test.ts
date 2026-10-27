import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, makeCustomer, ukReq } from './helpers.ts';
import { startServer } from '../src/http/server.ts';
import type { AddressInfo } from 'node:net';

test('support: customers never see internal notes; agent replies flip the status', async () => {
  const { app } = await makeApp();
  const c = await makeCustomer(app);
  const agent = await makeCustomer(app, 'agent@kargom.co.uk', 'admin');
  const t = await app.support.open({ customerId: c, category: 'weight_adjustment', subject: 'Charged extra', body: 'My box was 2 kg' });
  assert.equal(t.status, 'waiting_us');
  assert.equal(t.ref, 'T-1001');
  await app.support.agentReply(t.id, agent, 'Checked the scan', { internal: true });
  await app.support.agentReply(t.id, agent, 'We have refunded it', { internal: false });
  const cv = await app.support.threadForCustomer(t.id, c);
  assert.deepEqual(cv.messages.map((m) => m.author_type), ['customer', 'agent']);
  assert.equal(cv.ticket.status, 'waiting_customer');
  const other = await makeCustomer(app, 'b@example.co.uk');
  await assert.rejects(app.support.threadForCustomer(t.id, other), { code: 'not_found' });
});

test('support queue: overdue and urgent first', async () => {
  const { app, clock } = await makeApp();
  const c = await makeCustomer(app);
  const low = await app.support.open({ customerId: c, category: 'billing', subject: 'VAT number', body: 'Please add it' });
  await app.db.run('UPDATE customers SET bookings_paused = 1 WHERE id = $1', [c]);
  const urgent = await app.support.open({ customerId: c, category: 'account', subject: 'Paused', body: 'Help' });
  clock.advance(45 * 60_000);
  const q = await app.support.queue('waiting_us');
  assert.equal(q[0]!.id, urgent.id);
  assert.equal(q[0]!.overdue, true);
  assert.equal(q[1]!.id, low.id);
});

test('HTTP: sign in, quote, book; customers cannot reach admin', async () => {
  const { app } = await makeApp();
  await makeCustomer(app, 'shop@example.co.uk');
  const server = await startServer(app, 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
      body: body ? JSON.stringify(body) : null,
    });
    return { status: r.status, json: (await r.json()) as any };
  };
  try {
    const bad = await call('POST', '/api/auth/login', { email: 'shop@example.co.uk', password: 'wrong password!' });
    assert.equal(bad.status, 401);
    const login = await call('POST', '/api/auth/login', { email: 'shop@example.co.uk', password: 'correct horse battery' });
    assert.equal(login.status, 200);
    const token = login.json.token as string;
    const me = (await app.auth.authenticate(token)).customerId;
    await app.wallet.topUp(me, 2000, 'pi_http');

    const quotes = await call('POST', '/api/quotes', ukReq(), token);
    assert.equal(quotes.status, 200);
    const first = quotes.json.quotes[0];
    assert.equal(first.cost, undefined, 'cost must never reach the browser');

    const noKey = await call('POST', '/api/bookings', { quoteToken: first.token }, token);
    assert.equal(noKey.status, 400);
    const booked = await call('POST', '/api/bookings', { quoteToken: first.token, payWith: 'wallet' }, token, { 'Idempotency-Key': 'web-1' });
    assert.equal(booked.status, 200);
    assert.equal(booked.json.kind, 'booked');

    const wallet = await call('GET', '/api/wallet', undefined, token);
    assert.equal(wallet.json.balancePence, 2000 - first.price);

    const admin = await call('GET', '/api/admin/overview', undefined, token);
    assert.equal(admin.status, 403);
    const anon = await call('GET', '/api/wallet');
    assert.equal(anon.status, 401);
    const hook = await call('POST', '/webhooks/carrier/mock/wrong-token', { events: [] });
    assert.equal(hook.status, 401);
  } finally {
    server.close();
  }
});

test('admin: customer profile gathers shipments, addresses and wallet', async () => {
  const { app } = await makeApp();
  const c = await makeCustomer(app);
  await app.wallet.topUp(c, 1000, 'pi_p');
  const q = (await app.quotes.quote(c, ukReq())).quotes[0]!;
  await app.bookings.book({ customerId: c, quoteToken: q.token, payWith: 'wallet', idempotencyKey: 'p' });
  const p = await app.admin.customerProfile(c);
  assert.equal(p.shipments.length, 1);
  assert.equal(p.walletPence, 1000 - q.price);
  assert.deepEqual(p.addresses.map((a) => a.kind).sort(), ['collection', 'recipient']);
  const f = await app.admin.finance();
  assert.equal(f.trialBalancePence, 0);
  assert.equal(f.customerWalletsPence, 1000 - q.price);
});
