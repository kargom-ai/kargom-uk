import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteDb } from '../src/db/sqlite.ts';
import { migrate } from '../src/db/migrate.ts';
import { loadMarketIndex, saveMarketIndex, marketSummary } from '../src/freight/market.ts';
import { freightRates, parseFreightQuery } from '../src/freight/rates.ts';
import { parseSailings, portFor, maerskSailings } from '../src/freight/maersk.ts';

test('weekly index: seeded, summarised and used by the sea estimate', async () => {
  const db = new SqliteDb(':memory:');
  await migrate(db);
  await loadMarketIndex(db);
  const m = await marketSummary(db) as any;
  assert.equal(m.week, '2026-10-29');
  assert.equal(m.lanes.find((l: any) => l.key === 'shaLax').changePct, -6.2);

  const q = parseFreightQuery(new URLSearchParams({ origin: 'Shanghai, China', destination: 'Felixstowe, United Kingdom', fromCountry: 'CN', toCountry: 'GB', load: 'container40', qty: '1' }));
  const before = (await freightRates(q, (async () => new Response('{}')) as any)).rates.find((r) => r.mode === 'FCL')!;
  await saveMarketIndex(db, { week: '2026-11-05', values: { shaRtm: '7,372' } });
  const after = await freightRates(q, (async () => new Response('{}')) as any);
  const fcl = after.rates.find((r) => r.mode === 'FCL')!;
  assert.ok(fcl.minPence > before.minPence * 1.5, 'doubling the index raises the FCL estimate');
  assert.match(after.basis, /Drewry World Container Index of 5 Nov 2026/);
  await assert.rejects(saveMarketIndex(db, { week: '2026-11-12', values: { shaRtm: '12' } }), /does not look like/);
});

test('ports from the customer town', () => {
  assert.equal(portFor('CN', 'Shenzhen'), 'Yantian');
  assert.equal(portFor('CN', ''), 'Shanghai');
  assert.equal(portFor('GB', 'London'), 'London Gateway');
  assert.equal(portFor('GB', ''), 'Felixstowe');
  assert.equal(portFor('ZZ', ''), null);
});

test('Maersk answer → sailings, whatever the nesting', () => {
  const j = { oceanProducts: [{ transportSchedules: [
    { departureDateTime: '2026-11-04T10:00:00', arrivalDateTime: '2026-12-08T06:00:00', firstDepartureVessel: { vesselName: 'MAERSK EINDHOVEN' }, transportLegs: [{ transport: { carrierServiceName: 'AE7' } }] },
    { departureDateTime: '2026-11-11T10:00:00', arrivalDateTime: '2026-12-14T06:00:00', transportLegs: [{ transport: { vessel: { vesselName: 'MSC ANNA' } } }, { transport: { vessel: { vesselName: 'FEEDER' } } }] },
    { departureDateTime: '2020-01-01', arrivalDateTime: '2020-02-01' },
  ] }] };
  const s = parseSailings(j, Date.parse('2026-10-30'));
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], { depart: '2026-11-04', arrive: '2026-12-08', days: 34, vessel: 'MAERSK EINDHOVEN', service: 'AE7', stops: 0 });
  assert.equal(s[1]!.vessel, 'MSC ANNA');
  assert.equal(s[1]!.stops, 1);
});

test('no key: schedules are switched off quietly', async () => {
  delete process.env.MAERSK_CONSUMER_KEY;
  assert.deepEqual(await maerskSailings('CN', '', 'GB', ''), { enabled: false });
  process.env.MAERSK_CONSUMER_KEY = 'k';
  let url = '';
  const f = (async (u: URL, init: any) => { url = String(u); assert.equal(init.headers['Consumer-Key'], 'k'); return new Response(JSON.stringify({ x: [{ departureDate: '2099-01-01', arrivalDate: '2099-02-05' }] })); }) as any;
  const r = await maerskSailings('CN', 'Ningbo', 'GB', '', f) as any;
  assert.match(url, /point-to-point-routes\?placeOfReceipt=CNNGB&placeOfDelivery=GBFXT/);
  assert.equal(r.sailings[0].days, 35);
  delete process.env.MAERSK_CONSUMER_KEY;
});

test('DCSA routes: dates from place of receipt and delivery, vessel from the first leg', () => {
  const j = [{ placeOfReceipt: { dateTime: '2026-11-06T08:00:00Z', location: { UNLocationCode: 'CNSHA' } }, placeOfDelivery: { dateTime: '2026-12-10T08:00:00Z' }, transitTime: 34,
    legs: [{ transport: { modeOfTransport: 'VESSEL', vesselName: 'MAERSK HONAM', servicePartners: [{ carrierServiceName: 'AE55' }] }, departure: { dateTime: '2026-11-06T08:00:00Z' } }] }];
  assert.deepEqual(parseSailings(j, Date.parse('2026-10-30')), [{ depart: '2026-11-06', arrive: '2026-12-10', days: 34, vessel: 'MAERSK HONAM', service: 'AE55', stops: 0 }]);
});

test('falls back to the next Maersk address when one is not switched on', async () => {
  process.env.MAERSK_CONSUMER_KEY = 'k';
  const seen: string[] = [];
  const f = (async (u: URL) => { seen.push(String(u).split('?')[0]!); return String(u).includes('ocean-products')
    ? new Response(JSON.stringify([{ departureDateTime: '2099-03-01', arrivalDateTime: '2099-04-02' }])) : new Response('{}', { status: 403 }); }) as any;
  const r = await maerskSailings('CN', '', 'US', 'Houston', f) as any;
  assert.equal(r.sailings.length, 1);
  assert.equal(seen.at(-1), 'https://api.maersk.com/products/ocean-products');
  delete process.env.MAERSK_CONSUMER_KEY;
});
