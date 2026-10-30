import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, makeCustomer } from './helpers.ts';
import { chargeableKg, courierPrice, parseDims, parseRates, quoteAll, storageFor } from '../src/forwarding/turkey.ts';

const UK = { name: 'Ayşe Smith', line1: '18 Park Row', city: 'Leeds', postcode: 'LS1 5HD', phone: '07700 900123' };

test('Turkey pricing: rates, volumetric weight, fees', () => {
  assert.deepEqual(parseRates('0.5 = 8.50\n1 = £10,90\n2kg: 13.5'), [[0.5, 850], [1, 1090], [2, 1350]]);
  assert.throws(() => parseRates('hello'), /not understood/);
  assert.deepEqual(parseDims('40 x 30 × 20'), [40, 30, 20]);
  assert.equal(parseDims('40x30'), null);
  // 2.2 kg real, 40×30×20 / 5000 = 4.8 kg volumetric → 5 kg
  assert.equal(chargeableKg(2200, [40, 30, 20], 5000), 5);
  assert.equal(chargeableKg(1300, null, 5000), 1.5);
  const c = { rates: [[1, 1000], [5, 2500]] as Array<[number, number]>, extraKgPence: 300, maxKg: 30, fuelBp: 1000 };
  assert.deepEqual(courierPrice(c, 5), { shipping: 2500, fuel: 250 });
  assert.deepEqual(courierPrice(c, 7.5), { shipping: 2500 + 3 * 300, fuel: 340 });
  assert.equal(courierPrice({ ...c, extraKgPence: 0 }, 6), null);
  assert.equal(courierPrice(c, 31), null);
  const settings = { whName: '', whLine1: '', whLine2: '', whDistrict: '', whCity: '', whPostcode: '', whPhone: '', handlingPence: 300, consolidatePence: 200, freeDays: 30, storagePencePerDay: 10 };
  const q = quoteAll([{ id: 'a', name: 'A', active: true, divisor: 5000, daysMin: 2, daysMax: 4, trackingUrl: null, note: null, sort: 0, ...c },
    { id: 'b', name: 'Off', active: false, divisor: 5000, daysMin: 2, daysMax: 4, trackingUrl: null, note: null, sort: 0, ...c }], settings, { weightG: 900, dims: null, parcels: 3, storagePence: 50 });
  assert.equal(q.length, 1);
  assert.equal(q[0]!.pence, 1000 + 100 + 300 + 400 + 50);
  assert.equal(storageFor('2026-09-01T00:00:00Z', new Date('2026-10-11T00:00:00Z'), settings), 10 * 10);
  assert.equal(storageFor('2026-10-01T00:00:00Z', new Date('2026-10-11T00:00:00Z'), settings), 0);
});

test('Turkey warehouse: pre-alert, arrive, combine, price, pay from wallet, ship', async () => {
  const { app } = await makeApp();
  const t = app.turkey;
  const c = await makeCustomer(app);
  await t.saveSettings({ whLine1: 'Örnek Mah. Depo Sk. No:5', whDistrict: 'Esenyurt', whCity: 'İstanbul', whPostcode: '34510', whPhone: '+90 212 000 00 00', handlingPence: '3', consolidatePence: '2' });
  await t.saveCourier({ name: 'UPS Express', rates: '1 = 15\n5 = 30\n10 = 45', extraKg: '4', fuelPct: '10', daysMin: 2, daysMax: 4, trackingUrl: 'https://www.ups.com/track?tracknum={n}' });
  await t.saveCourier({ name: 'PTT Economy', rates: '2 = 12\n10 = 25', daysMin: 7, daysMax: 12 });

  const ov = await t.overview(c);
  assert.match(ov.suite, /^KG\d{5}$/);
  assert.equal(ov.address?.line2.endsWith(ov.suite), true);
  assert.equal((await t.overview(c)).suite, ov.suite, 'suite code stays the same');

  const a = await t.addPackage(c, { store: 'Trendyol', description: '2 cotton T-shirts', valueTry: 900, tracking: 'TY 123 456' });
  await t.addPackage(c, { store: 'Hepsiburada', description: 'Leather shoes', valueTry: 2500 });
  await assert.rejects(t.addPackage(c, { store: 'Trendyol', valueTry: 10 }), /customs/);

  // tracking match (spaces/case ignored), and an unannounced parcel by suite code
  const r1 = await t.receive({ tracking: 'ty123456', weightKg: '0.8', dims: '30x20x10' });
  assert.equal(r1.id, a.id);
  await assert.rejects(t.receive({ tracking: 'UNKNOWN1', weightKg: 1 }), /suite code/);
  const r2 = await t.receive({ tracking: 'UNKNOWN1', suite: ov.suite.toLowerCase(), weightKg: '1,4', store: 'Amazon.com.tr', description: 'Book' });
  assert.equal(r2.customerId, c);

  const other = await makeCustomer(app, 'b@example.co.uk');
  await assert.rejects(t.requestShipment(other, { packageIds: [a.id], address: UK }), /not found/);
  await assert.rejects(t.requestShipment(c, { packageIds: [a.id], address: { ...UK, postcode: 'XX' } }), /postcode/);

  await assert.rejects(t.requestShipment(c, { packageIds: [a.id, r2.id], address: UK }), /Customs/);
  await t.updatePackage(c, r2.id, { valueTry: 350 });
  const sh = await t.requestShipment(c, { packageIds: [a.id, r2.id], address: UK, note: 'Remove shoe boxes' });
  assert.match(sh.ref, /^TR-1000\d$/);
  await assert.rejects(t.requestShipment(c, { packageIds: [a.id], address: UK }), /warehouse/);

  const priced = await t.measure(sh.id, { weightKg: '2.1', dims: '40x30x20' });
  // 4.8 kg volumetric → 5 kg. UPS: £30 + 10% fuel + £3 handling + £2 for the second parcel = £38
  assert.deepEqual(priced.quotes.map((q) => [q.name, q.pence]), [['UPS Express', 3800], ['PTT Economy', 3000]].sort((x, y) => (x[1] as number) - (y[1] as number)));
  const ups = priced.quotes.find((q) => q.name === 'UPS Express')!;

  await assert.rejects(t.pay(c, sh.id, { courierId: ups.courierId, payWith: 'wallet' }, 'https://x'), /Not enough/);
  await app.wallet.topUp(c, 5000, 'pi_top');
  await t.pay(c, sh.id, { courierId: ups.courierId, payWith: 'wallet' }, 'https://x');
  assert.equal(await app.wallet.balance(c), 1200);
  assert.equal(await app.ledger.trialBalance(), 0);
  await assert.rejects(t.cancelShipment(c, sh.id), /paid/);

  const shipped = await t.ship(sh.id, { trackingNo: '1Z999' });
  assert.equal(shipped.trackingUrl, 'https://www.ups.com/track?tracknum=1Z999');
  const after = await t.overview(c);
  assert.equal(after.shipments[0]!.status, 'shipped');
  assert.equal(after.packages.filter((p) => p.status === 'shipped').length, 2);
  await t.delivered(sh.id);
});

test('Turkey warehouse: card payment via Stripe webhook, cancel puts parcels back', async () => {
  const { app, payments } = await makeApp();
  const t = app.turkey;
  const c = await makeCustomer(app);
  await t.saveCourier({ name: 'DHL', rates: '5 = 40' });
  await t.addPackage(c, { store: 'Trendyol', description: 'Dress', valueTry: 1500, tracking: 'A1' });
  const p = await t.receive({ tracking: 'A1', weightKg: 1 });

  const s1 = await t.requestShipment(c, { packageIds: [p.id], address: UK });
  await t.cancelShipment(c, s1.id);
  assert.equal((await t.overview(c)).packages[0]!.status, 'received');

  const s2 = await t.requestShipment(c, { packageIds: [p.id], address: UK });
  const { quotes } = await t.measure(s2.id, { weightKg: 1, dims: '20x20x10' });
  const r = await t.pay(c, s2.id, { courierId: quotes[0]!.courierId, payWith: 'card' }, 'https://kargom.co.uk');
  assert.ok('url' in r);
  const co = payments.checkouts.at(-1)!;
  assert.equal(co.metadata.purpose, 'fwd');
  assert.equal(co.amount, quotes[0]!.pence);
  const ev = { id: 'evt_fwd1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_fwd1', amount_received: co.amount, metadata: co.metadata } } };
  await app.webhooks.stripe(ev);
  await app.webhooks.stripe(ev); // retried
  const s = (await t.overview(c)).shipments.find((x) => x.id === s2.id)!;
  assert.equal(s.status, 'paid');
  assert.equal(s.paidVia, 'card');
  assert.equal(await app.ledger.trialBalance(), 0);
});

test('Turkey warehouse: "send as soon as it arrives" prices and pays from the wallet', async () => {
  const { app } = await makeApp();
  const t = app.turkey;
  const c = await makeCustomer(app);
  await t.saveCourier({ name: 'Cheap', rates: '5 = 10', daysMin: 7, daysMax: 10 });
  await t.saveCourier({ name: 'Fast', rates: '5 = 20', daysMin: 1, daysMax: 2 });
  await assert.rejects(t.addPackage(c, { store: 'Trendyol', description: 'Shoes', valueTry: 900, autoSend: true }), /UK address/);
  await t.saveUkAddress(c, UK);
  const fast = await t.addPackage(c, { store: 'Trendyol', description: 'Shoes', valueTry: 900, tracking: 'F1', autoSend: true, autoPref: 'fastest' });
  await t.addPackage(c, { store: 'Koton', description: 'Shirt', valueTry: 400, tracking: 'C1', autoSend: true });
  await assert.rejects(t.receive({ tracking: 'F1', weightKg: 1 }), /size/);
  // no money: priced, waiting for payment
  const r1 = await t.receive({ tracking: 'F1', weightKg: 1, dims: '20x20x10' });
  assert.equal(r1.id, fast.id);
  assert.equal(r1.auto?.status, 'quoted');
  assert.equal(r1.auto?.pence, 2000 + 300);
  // money in the wallet: paid straight away with the cheapest
  await app.wallet.topUp(c, 5000, 'pi_auto');
  const r2 = await t.receive({ tracking: 'C1', weightKg: 1, dims: '20x20x10' });
  assert.equal(r2.auto?.status, 'paid');
  const ov = await t.overview(c);
  const paid = ov.shipments.find((s) => s.status === 'paid')!;
  assert.equal(paid.courierName, 'Cheap');
  assert.equal(await app.wallet.balance(c), 5000 - 1300);
  assert.equal(await app.ledger.trialBalance(), 0);
  assert.equal(ov.ukAddress?.postcode, 'LS1 5HD');
});
