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
