import test from 'node:test';
import assert from 'node:assert/strict';
import { ShipEngineProvider } from '../src/providers/shipengine.ts';

test('shipstation test mode: a carrier without test labels gets our sample label instead of a failure', async () => {
  const f = (async () => new Response(JSON.stringify({ errors: [{ message: 'A shipping carrier error occurred: Test labels are not supported.' }] }), { status: 400 })) as unknown as typeof fetch;
  const rate = { providerRateId: 'se-1', carrier: 'royal_mail', carrierName: 'Royal Mail', serviceCode: 'x', serviceName: 'Tracked 48', cost: 399 } as never;
  const test = new ShipEngineProvider({ id: 'shipstation', baseUrl: 'https://api.example', apiKey: 'k', carrierIds: [], testLabels: true, fetchImpl: f });
  const l = await test.buyLabel(rate, {} as never, 'k1');
  assert.match(l.labelUrl, /^\/api\/test-label\/test-/);
  assert.match(l.trackingNumber, /^TEST/);
  assert.equal(await test.voidLabel(l.providerLabelId), true);
  const live = new ShipEngineProvider({ id: 'shipstation', baseUrl: 'https://api.example', apiKey: 'k', carrierIds: [], testLabels: false, fetchImpl: f });
  await assert.rejects(live.buyLabel(rate, {} as never, 'k2'), /Test labels are not supported/);
});

test('shipstation addresses: long line 1 split, UK phone format, sender email', async () => {
  const { splitLine, ukPhone } = await import('../src/providers/shipengine.ts');
  const parts = splitLine('Flat 12, Victoria House, 145 Long Street Industrial Estate');
  assert.ok(parts.every((p) => p.length <= 40), JSON.stringify(parts));
  assert.equal(parts.join(' ').replace(/,/g, ''), 'Flat 12 Victoria House 145 Long Street Industrial Estate');
  assert.equal(ukPhone('+44 7700 900123'), '447700900123');
  assert.equal(ukPhone('+44 (0)7700 900123'), '447700900123');
  assert.equal(ukPhone('7700900123'), '07700900123');
  assert.equal(ukPhone('07700 900123'), '07700900123');
  assert.equal(ukPhone('5342355555'), null);
  let body: any = null;
  const f = (async (_u: string, init: any) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ rate_response: { rates: [] } }), { status: 200 }); }) as unknown as typeof fetch;
  const p = new ShipEngineProvider({ id: 'shipstation', baseUrl: 'https://api.example', apiKey: 'k', carrierIds: ['c1'], fetchImpl: f });
  await p.getRates({ from: { name: 'A', line1: '1 High St', city: 'Leeds', postcode: 'LS1 1AA', country: 'GB' }, to: { name: 'B', line1: 'Unit 4, Canterbury Business Park, Very Long Industrial Road', city: 'Canterbury', postcode: 'CT1 1DX', country: 'GB', phone: '5342355555' },
    parcel: { weightGrams: 1000, lengthCm: 10, widthCm: 10, heightCm: 10 } } as never, AbortSignal.timeout(5000)).catch(() => {});
  const sh = body.shipment;
  assert.ok(sh.ship_to.address_line1.length <= 40 && sh.ship_to.address_line2, JSON.stringify(sh.ship_to));
  assert.match(sh.ship_to.phone, /^(0|44)/);
  assert.ok(sh.ship_from.email);
});
