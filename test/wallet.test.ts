import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, makeCustomer } from './helpers.ts';
import { acct } from '../src/ledger/ledger.ts';

test('top-up, hold, capture and release keep the books balanced', async () => {
  const { app } = await makeApp();
  const c = await makeCustomer(app);
  await app.wallet.topUp(c, 5000, 'pi_1');
  await app.wallet.topUp(c, 5000, 'pi_1'); // Stripe retried the webhook
  assert.equal(await app.wallet.balance(c), 5000);

  const h1 = await app.wallet.hold(c, 329, 'shp_a', 'hold:shp_a');
  assert.equal(await app.wallet.balance(c), 4671);
  await app.wallet.capture(h1);
  await app.wallet.capture(h1); // idempotent
  assert.equal(await app.ledger.liability(acct.revenue), 274);
  assert.equal(await app.ledger.liability(acct.vatOutput), 55);

  const h2 = await app.wallet.hold(c, 1000, 'shp_b', 'hold:shp_b');
  await app.wallet.release(h2);
  assert.equal(await app.wallet.balance(c), 4671);
  assert.equal(await app.ledger.trialBalance(), 0);
});

test('cannot hold more than the balance', async () => {
  const { app } = await makeApp();
  const c = await makeCustomer(app);
  await app.wallet.topUp(c, 200, 'pi_2');
  await assert.rejects(app.wallet.hold(c, 239, 'shp_x', 'hold:shp_x'), { code: 'insufficient_funds' });
  assert.equal(await app.wallet.balance(c), 200);
});

test('concurrent holds cannot overspend the wallet', async () => {
  const { app } = await makeApp();
  const c = await makeCustomer(app);
  await app.wallet.topUp(c, 500, 'pi_3');
  const results = await Promise.allSettled([1, 2, 3].map((i) => app.wallet.hold(c, 239, `shp_${i}`, `hold:shp_${i}`)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
  assert.equal(await app.wallet.balance(c), 22);
});

test('unbalanced entries are refused', async () => {
  const { app } = await makeApp();
  await assert.rejects(app.ledger.post({ idempotencyKey: 'x', kind: 'credit', lines: [{ account: 'a', amount: 10 }, { account: 'b', amount: -9 }] }), /Unbalanced/);
  await assert.rejects(app.ledger.post({ idempotencyKey: 'y', kind: 'credit', lines: [{ account: 'a', amount: 1.5 }, { account: 'b', amount: -1.5 }] }), /integer/);
});
