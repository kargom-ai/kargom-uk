import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.ts';
import { freightRates, parseFreightQuery } from '../src/freight/rates.ts';
import { requestSheet } from '../src/market/sheet.ts';

const q = (o: Record<string, string>) => new URLSearchParams({ origin: 'Shenzhen, China', destination: 'Bedford, United Kingdom', ...o });
const tomorrow = () => new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const noNet = (async () => { throw new Error('no network'); }) as typeof fetch;
const modes = async (o: Record<string, string>) => (await freightRates(parseFreightQuery(q(o)), noNet)).rates;

test('freight query: boxes need size and weight, pallets get a default size, containers need neither', () => {
  assert.throws(() => parseFreightQuery(q({ load: 'boxes', kg: '10' })), /size/);
  assert.throws(() => parseFreightQuery(q({ load: 'boxes', l: '1', w: '1', h: '1' })), /weight/);
  const p = parseFreightQuery(q({ load: 'pallets', kg: '300', qty: '2' }));
  assert.deepEqual([p.lengthCm, p.widthCm, p.heightCm, p.quantity], [120, 100, 150, 2]);
  assert.equal(parseFreightQuery(q({ load: 'container40HC' })).weightKg, 0);
  assert.throws(() => parseFreightQuery(q({ load: 'truck' })), /boxes/);
});

test('freight rates: China to UK gives express, air and sea in a sensible order and size', async () => {
  const r = await modes({ load: 'boxes', qty: '10', kg: '15', l: '50', w: '40', h: '40', fromCountry: 'CN', toCountry: 'GB' });
  assert.deepEqual(r.map((x) => x.mode), ['express', 'air', 'LCL']);
  const [exp, air, lcl] = r;
  assert.ok(exp!.minPence > air!.minPence && air!.minPence > lcl!.minPence, 'faster costs more');
  assert.ok(lcl!.daysMin! > air!.daysMax!, 'sea is slower');
  for (const x of r) assert.ok(x.maxPence > x.minPence && x.currency === 'GBP');
  const small = await modes({ load: 'boxes', qty: '1', kg: '5', l: '30', w: '30', h: '30', fromCountry: 'CN', toCountry: 'GB' });
  assert.deepEqual(small.map((x) => x.mode), ['express'], 'a small box only makes sense by courier');
  const fcl = await modes({ load: 'container40HC', fromCountry: 'CN', toCountry: 'GB' });
  assert.equal(fcl[0]!.mode, 'FCL');
  assert.ok(fcl[0]!.minPence > 250000 && fcl[0]!.maxPence < 800000, JSON.stringify(fcl[0]));
  const us = await modes({ load: 'container40', fromCountry: 'CN', toCountry: 'US' });
  assert.ok(us[0]!.minPence > fcl[0]!.minPence, 'Asia to US costs more than Asia to Europe right now');
});

test('freight rates: UK and Europe go by road', async () => {
  const uk = await modes({ load: 'pallets', qty: '3', kg: '400', fromCountry: 'GB', toCountry: 'GB' });
  assert.deepEqual(uk.map((x) => x.mode), ['LTL']);
  const eu = await modes({ load: 'pallets', qty: '8', kg: '400', fromCountry: 'GB', toCountry: 'DE' });
  assert.deepEqual(eu.map((x) => x.mode), ['LTL', 'FTL']);
  assert.ok(eu[0]!.minPence > uk[0]!.minPence);
});

test('market: air and sea freight requests from China to an Amazon warehouse', async () => {
  const { app } = await makeApp();
  const customer = await app.auth.register({ email: 'seller@shop.co.uk', password: 'correct-horse-1', name: 'Tik Seller', accountType: 'business' });
  const base = { kind: 'freight', from: { line1: 'Factory 3, Bao An', city: 'Shenzhen', postcode: '518000', country: 'CN' }, to: { line1: 'Amazon LTN7', city: 'Bedford', postcode: 'MK43 9RT', country: 'GB' }, date: tomorrow(), phone: '07700 900123' };
  await assert.rejects(app.market.createJob(customer, { ...base, details: { load: 'air', shipUnit: 'container20', goods: 'Phone cases', units: 1 } }), /sea/);
  const job = await app.market.createJob(customer, { ...base, details: { load: 'sea', shipUnit: 'boxes', units: 40, goods: 'Phone cases', weightKg: 600, cbm: 3.2, destType: 'amazon', fbaCode: 'LTN7' } });
  assert.equal(job.title, 'Sea freight · 40 boxes');
  assert.equal(job.details.destType, 'amazon');
  assert.equal(job.estimate, null);
  const ctr = await app.market.createJob(customer, { ...base, details: { load: 'sea', shipUnit: 'container40HC', units: 1, goods: 'Garden furniture' } });
  assert.equal(ctr.title, 'Sea freight · 1 40 ft High Cube');
  const pdf = requestSheet({ ref: 1, kind: 'freight', title: job.title, details: job.details, from: base.from, to: base.to, date: base.date, distanceMiles: null, createdAt: new Date().toISOString(), contactName: 'Tik Seller', contactPhone: '07700 900123' }, []);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

test('freight forwarders: Google search anywhere, numbers hidden for visitors', async () => {
  const { freightForwarders } = await import('../src/freight/forwarders.ts');
  process.env.GOOGLE_PLACES_API_KEY = 'k';
  let body: any = null;
  const f = (async (_u: string, init: any) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ places: [{ id: 'P1', displayName: { text: 'Bao An Logistics' }, formattedAddress: 'Bao An, Shenzhen, Guangdong, China', nationalPhoneNumber: '0755 2345 6789', internationalPhoneNumber: '+86 755 2345 6789', rating: 4.7, userRatingCount: 31, websiteUri: 'https://baoan.example' }] }), { status: 200 });
  }) as typeof fetch;
  const guest = await freightForwarders('Shenzhen, China', 'CN', false, f);
  assert.equal(body.textQuery, 'freight forwarder in Shenzhen, China');
  assert.equal(body.regionCode, 'cn');
  const g = guest.places[0] as Record<string, unknown>;
  assert.equal(g.phone, '0755 2345 ****');
  assert.equal(g.whatsapp, true);
  assert.equal(g.website, undefined);
  assert.equal(g.intlPhone, undefined);
  const m = (await freightForwarders('Shenzhen, China', 'CN', true, f)).places[0] as Record<string, unknown>;
  assert.equal(m.intlPhone, '+86 755 2345 6789');
  assert.equal(m.website, 'https://baoan.example');
  await assert.rejects(freightForwarders('x', 'CN', false, f), /place/);
  delete process.env.GOOGLE_PLACES_API_KEY;
});

test('top forwarders: port cities merged, best rated with many reviews first', async () => {
  const { topForwarders } = await import('../src/freight/forwarders.ts');
  process.env.GOOGLE_PLACES_API_KEY = 'k2';
  const asked: string[] = [];
  const pl = (id: string, name: string, rating: number, n: number) => ({ id, displayName: { text: name }, formattedAddress: 'Port Rd, Felixstowe IP11, UK', rating, userRatingCount: n });
  const f = (async (_u: string, init: any) => {
    const q = JSON.parse(init.body).textQuery as string; asked.push(q);
    const places = q.includes('Felixstowe') ? [pl('A', 'Small Freight', 5, 2), pl('B', 'Big Freight', 4.8, 400)] : [pl('B', 'Big Freight', 4.8, 400), pl('C', 'Mid Freight', 4.6, 90)];
    return new Response(JSON.stringify({ places }), { status: 200 });
  }) as typeof fetch;
  const r = await topForwarders('Felixstowe, United Kingdom|Southampton, United Kingdom', 'GB', false, f);
  assert.equal(asked.length, 2);
  assert.deepEqual(r.places.map((p) => p.company), ['Big Freight', 'Mid Freight', 'Small Freight']);
  assert.equal((r.places[0] as Record<string, unknown>).city, 'Felixstowe');
  await assert.rejects(topForwarders('', 'GB', false, f), /place/);
  delete process.env.GOOGLE_PLACES_API_KEY;
});

test('forwarding: estimate for a US pair of shoes to the UK, and the waiting list', async () => {
  const { forwardingEstimate, joinForwardingWaitlist } = await import('../src/forwarding/forwarding.ts');
  const r = await forwardingEstimate('US', 'GB', '2');
  assert.ok(r.estimate && r.estimate.totalLowPence > 2000 && r.estimate.totalHighPence < 15000, JSON.stringify(r));
  await assert.rejects(forwardingEstimate('US', 'US', '2'), /different/);
  const { app } = await makeApp();
  assert.equal((await joinForwardingWaitlist(app.db, { email: 'A@b.co', from: 'US', to: 'GB' }, null, new Date().toISOString())).position, 1);
  assert.equal((await joinForwardingWaitlist(app.db, { email: 'a@b.co', from: 'US', to: 'TR' }, null, new Date().toISOString())).position, 1, 'same email once');
  await assert.rejects(joinForwardingWaitlist(app.db, { email: 'nope' }, null, ''), /email/);
});

test('cargoboard: live pallet prices for UK to Europe replace our road estimate', async () => {
  process.env.CARGOBOARD_API_KEY = 'k'; process.env.CARGOBOARD_ENV = 'sandbox';
  const seen: any[] = [];
  const f = (async (u: string, init: any) => {
    if (u.includes('cargoboard')) {
      const b = JSON.parse(init.body); seen.push({ u, b, key: init.headers['X-API-KEY'] });
      return new Response(JSON.stringify({ data: { id: 'q1', price: { amount: 200, grossAmount: 238, currency: 'EUR' }, runtime: { daysMin: 3, daysMax: 5 }, product: b.product } }), { status: 201 });
    }
    throw new Error('no network');
  }) as typeof fetch;
  const q = parseFreightQuery(new URLSearchParams({ load: 'pallets', qty: '2', kg: '300', origin: 'Manchester', destination: 'Berlin', fromCountry: 'GB', toCountry: 'DE', fromPostcode: 'M1 1AE', toPostcode: '10115', fromTown: 'Manchester', toTown: 'Berlin' }));
  const r = await freightRates(q, f);
  assert.equal(seen.length, 2);
  assert.match(seen[0].u, /^https:\/\/api-sandbox\.cargoboard\.com\/v1\/quotations$/);
  assert.equal(seen[0].key, 'k');
  assert.deepEqual(seen.map((x) => x.b.product).sort(), ['EXPRESS', 'STANDARD']);
  assert.equal(seen[0].b.lines[0].unitPackageType, 'EP');
  assert.equal(seen[0].b.lines[0].unitQuantity, 2);
  assert.equal(seen[0].b.consignee.address.postCode, '10115');
  const live = r.rates.filter((x) => x.live);
  assert.equal(live.length, 2);
  assert.equal(live[0]!.minPence, Math.round(238 * 0.85 * 100));
  assert.ok(!r.rates.some((x) => x.mode === 'LTL' && !x.live), 'our LTL estimate is replaced');
  // not used inside the UK, nor for Turkey
  seen.length = 0;
  await freightRates(parseFreightQuery(new URLSearchParams({ load: 'pallets', qty: '1', kg: '300', origin: 'a b', destination: 'c d', fromCountry: 'GB', toCountry: 'GB' })), f);
  await freightRates(parseFreightQuery(new URLSearchParams({ load: 'pallets', qty: '1', kg: '300', origin: 'a b', destination: 'c d', fromCountry: 'TR', toCountry: 'DE' })), f);
  assert.equal(seen.length, 0);
  delete process.env.CARGOBOARD_API_KEY; delete process.env.CARGOBOARD_ENV;
});

test('eurosender: live parcel and pallet prices, sandbox URL, no customer data in quotes', async () => {
  process.env.EUROSENDER_API_KEY = 'k'; process.env.EUROSENDER_ENV = 'sandbox';
  const seen: any[] = [];
  const f = (async (u: string, init: any) => {
    if (u.includes('eurosender')) {
      const b = JSON.parse(init.body); seen.push({ u, b, key: init.headers['x-api-key'] });
      const pal = Boolean(b.parcels.pallets);
      return new Response(JSON.stringify({ options: { serviceTypes: pal
        ? [{ name: 'freight', edt: '3-5', price: { original: { currencyCode: 'EUR', gross: 180, net: 150 } } }, { name: 'freight_priority_express', edt: '1-2', price: { original: { currencyCode: 'EUR', gross: 320, net: 266 } } }]
        : [{ name: 'selection', edt: '2-4', price: { original: { currencyCode: 'EUR', gross: 24.5, net: 20 } } }, { name: 'express', edt: '1', price: { original: { currencyCode: 'EUR', gross: 61, net: 50 } } }] } }), { status: 200 });
    }
    throw new Error('no network');
  }) as typeof fetch;
  const pal = await freightRates(parseFreightQuery(new URLSearchParams({ load: 'pallets', qty: '1', kg: '300', origin: 'a b', destination: 'c d', fromCountry: 'GB', toCountry: 'FR', fromPostcode: 'M1 1AE', toPostcode: '75001', fromTown: 'Manchester', toTown: 'Paris' })), f);
  assert.match(seen[0].u, /^https:\/\/sandbox-api\.eurosender\.com\/v1\/quotes$/);
  assert.equal(seen[0].key, 'k');
  assert.equal(seen[0].b.serviceType, 'freight');
  assert.ok(!JSON.stringify(seen[0].b).includes('@'), 'no email in quotes');
  const live = pal.rates.filter((x) => x.source === 'eurosender');
  assert.deepEqual(live.map((x) => x.label), ['Pallet · Standard', 'Pallet · Priority Express']);
  assert.deepEqual([live[0]!.minPence, live[0]!.daysMin, live[0]!.daysMax], [Math.round(180 * 0.85 * 100), 3, 5]);
  assert.ok(!pal.rates.some((x) => x.mode === 'LTL' && !x.live), 'estimate replaced');
  const box = await freightRates(parseFreightQuery(new URLSearchParams({ load: 'boxes', qty: '1', kg: '5', l: '40', w: '30', h: '20', origin: 'a b', destination: 'c d', fromCountry: 'GB', toCountry: 'DE' })), f);
  assert.ok(box.rates.some((x) => x.source === 'eurosender' && x.label === 'Standard' && x.mode === 'express'));
  assert.ok(!box.rates.some((x) => x.mode === 'express' && !x.live));
  seen.length = 0;
  await freightRates(parseFreightQuery(new URLSearchParams({ load: 'boxes', qty: '1', kg: '5', l: '40', w: '30', h: '20', origin: 'a b', destination: 'c d', fromCountry: 'CN', toCountry: 'GB' })), f);
  assert.equal(seen.length, 0, 'not called outside Europe');
  delete process.env.EUROSENDER_API_KEY; delete process.env.EUROSENDER_ENV;
});
