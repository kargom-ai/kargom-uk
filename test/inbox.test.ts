import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, makeCustomer } from './helpers.ts';

test('Inbox: updates land in the right area, and reading clears the counts', async () => {
  const { app } = await makeApp();
  const c = await makeCustomer(app);
  await app.turkey.saveCourier({ name: 'UPS', rates: '5 = 20' });
  await app.turkey.addPackage(c, { store: 'Trendyol', description: 'Shoes', valueTry: 900, tracking: 'T1' });
  await app.turkey.receive({ tracking: 'T1', weightKg: 1 });
  await new Promise((r) => setTimeout(r, 20));
  await app.inbox.add(c, 'help', 'New reply', null, '/app?view=help');
  let box = await app.inbox.list(c);
  assert.equal(box.unread.tr, 1);
  assert.equal(box.unread.help, 1);
  assert.equal(box.total, 2);
  assert.equal(box.items.find((i) => i.area === 'tr')!.link, '/app/turkey');
  box = await app.inbox.read(c, { area: 'tr' });
  assert.equal(box.unread.tr, 0);
  assert.equal(box.total, 1);
  box = await app.inbox.read(c, { id: box.items.find((i) => i.area === 'help')!.id });
  assert.equal(box.total, 0);
  const other = await makeCustomer(app, 'b@example.co.uk');
  assert.equal((await app.inbox.list(other)).items.length, 0);
});
