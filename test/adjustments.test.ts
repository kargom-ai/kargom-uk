import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, makeCustomer, ukReq } from './helpers.ts';

async function bookService(serviceCarrier: string, opts: { topUp: number }) {
  const ctx = await makeApp();
  const { app } = ctx;
  const c = await makeCustomer(app);
  if (opts.topUp) await app.wallet.topUp(c, opts.topUp, 'pi_seed');
  const q = (await app.quotes.quote(c, ukReq(2000))).quotes.find((x) => x.carrier === serviceCarrier)!;
  const r = await app.bookings.book({ customerId: c, quoteToken: q.token, payWith: 'wallet', idempotencyKey: 'b1' });
  assert.equal(r.kind, 'booked');
  return { ...ctx, c, shipment: r.shipment, quote: q };
}

test('heavier but same price band: recorded as no charge, no money moves (yellow)', async () => {
  // Royal Mail Tracked 48 is one price up to 10 kg.
  const { app, c, shipment } = await bookService('royal_mail', { topUp: 1000 });
  const before = await app.wallet.balance(c);
  const a = await app.adjustments.handleMeasurement({
    eventId: 'm1', trackingNumber: shipment.tracking_number!, measured: { weightGrams: 4000, lengthCm: 30, widthCm: 22, heightCm: 18 }, providerSurchargePence: null,
  });
  assert.equal(a!.status, 'no_charge');
  assert.equal(a!.diff_pence, 0);
  assert.equal(await app.wallet.balance(c), before);
});

test('heavier and dearer: difference comes out of the wallet (red)', async () => {
  const { app, c, shipment } = await bookService('evri', { topUp: 1000 });
  const before = await app.wallet.balance(c);
  const a = await app.adjustments.handleMeasurement({
    eventId: 'm2', trackingNumber: shipment.tracking_number!, measured: { weightGrams: 4000, lengthCm: 30, widthCm: 20, heightCm: 15 }, providerSurchargePence: null,
  });
  assert.equal(a!.status, 'charged');
  assert.equal(a!.method, 'wallet');
  assert.ok(a!.diff_pence > 0);
  assert.equal(await app.wallet.balance(c), before - a!.diff_pence);
  // Replaying the same webhook changes nothing.
  const again = await app.adjustments.handleMeasurement({
    eventId: 'm2', trackingNumber: shipment.tracking_number!, measured: { weightGrams: 4000, lengthCm: 30, widthCm: 20, heightCm: 15 }, providerSurchargePence: null,
  });
  assert.equal(again!.id, a!.id);
  assert.equal(await app.wallet.balance(c), before - a!.diff_pence);
  assert.equal(await app.ledger.trialBalance(), 0);
});

test('bigger box counts too: volumetric weight is priced', async () => {
  const { app, shipment } = await bookService('evri', { topUp: 1000 });
  const a = await app.adjustments.handleMeasurement({
    eventId: 'm3', trackingNumber: shipment.tracking_number!, measured: { weightGrams: 2000, lengthCm: 45, widthCm: 35, heightCm: 30 }, providerSurchargePence: null,
  });
  assert.equal(a!.status, 'charged');
});

test('wallet short: saved card is charged off-session', async () => {
  const { app, c, shipment, quote } = await bookService('evri', { topUp: 340 });
  assert.equal(await app.wallet.balance(c), 340 - quote.price);
  await app.db.run("UPDATE customers SET stripe_customer_id = 'cus_1', default_payment_method = 'pm_1' WHERE id = $1", [c]);
  const a = await app.adjustments.handleMeasurement({
    eventId: 'm4', trackingNumber: shipment.tracking_number!, measured: { weightGrams: 4500, lengthCm: 30, widthCm: 20, heightCm: 15 }, providerSurchargePence: null,
  });
  assert.equal(a!.status, 'charged');
  assert.equal(a!.method, 'card');
  assert.equal(await app.ledger.trialBalance(), 0);
});

test('wallet short and card declined: failed, and bookings pause once over £20', async () => {
  const { app, c, shipment, payments } = await bookService('dpd', { topUp: 660 });
  await app.db.run("UPDATE customers SET stripe_customer_id = 'cus_1', default_payment_method = 'pm_1' WHERE id = $1", [c]);
  payments.declineOffSession = true;
  const a = await app.adjustments.handleMeasurement({
    eventId: 'm5', trackingNumber: shipment.tracking_number!, measured: { weightGrams: 19000, lengthCm: 60, widthCm: 40, heightCm: 40 }, providerSurchargePence: null,
  });
  assert.equal(a!.status, 'failed');
  assert.ok(a!.diff_pence > 0);
  const paused = await app.db.get<{ bookings_paused: number }>('SELECT bookings_paused FROM customers WHERE id = $1', [c]);
  assert.equal(paused!.bookings_paused, a!.diff_pence > 2000 ? 1 : 0);
  // Admin waives it: account opens again.
  await app.adjustments.waive(a!.id);
  const after = await app.db.get<{ bookings_paused: number }>('SELECT bookings_paused FROM customers WHERE id = $1', [c]);
  assert.equal(after!.bookings_paused, 0);
});

test('provider-reported surcharge is used directly when available', async () => {
  const { app, shipment } = await bookService('evri', { topUp: 1000 });
  const a = await app.adjustments.handleMeasurement({
    eventId: 'm6', trackingNumber: shipment.tracking_number!, measured: { weightGrams: 2500, lengthCm: 30, widthCm: 20, heightCm: 15 }, providerSurchargePence: 0,
  });
  assert.equal(a!.status, 'no_charge');
});
