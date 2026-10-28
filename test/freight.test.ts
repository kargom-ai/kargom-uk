import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.ts';
import { freightRates, parseFreightQuery, parseFreightos, resetFreightCache } from '../src/freight/freightos.ts';
import { requestSheet } from '../src/market/sheet.ts';

const q = (o: Record<string, string>) => new URLSearchParams(o);
const tomorrow = () => new Date(Date.now() + 864e5).toISOString().slice(0, 10);

test('freight query: boxes need size and weight, pallets get a default size, containers need neither', () => {
  assert.throws(() => parseFreightQuery(q({ load: 'boxes', origin: 'Shenzhen, China', destination: 'MK43 9RT, United Kingdom', kg: '10' })), /size/);
  assert.throws(() => parseFreightQuery(q({ load: 'boxes', origin: 'Shenzhen, China', destination: 'X1', l: '1', w: '1', h: '1' })), /weight/);
  const p = parseFreightQuery(q({ load: 'pallets', origin: 'Shenzhen, China', destination: 'Bedford, United Kingdom', kg: '300', qty: '2' }));
  assert.deepEqual([p.lengthCm, p.widthCm, p.heightCm, p.quantity], [120, 100, 150, 2]);
  const c = parseFreightQuery(q({ load: 'container40HC', origin: 'Ningbo, China', destination: 'Felixstowe, United Kingdom' }));
  assert.equal(c.weightKg, 0);
  assert.throws(() => parseFreightQuery(q({ load: 'truck', origin: 'a b', destination: 'c d' })), /boxes/);
});

test('freightos answers: a list of modes, a single mode, or an error', () => {
  const one = { response: { estimatedFreightRates: { numQuotes: 1, mode: { mode: 'LCL', price: { min: { moneyAmount: { amount: 410.5, currency: 'GBP' } }, max: { moneyAmount: { amount: 620, currency: 'GBP' } } }, transitTimes: { min: 32, max: 41, unit: 'days' } } } } };
  const r = parseFreightos(one);
  assert.deepEqual(r.rates[0], { mode: 'LCL', label: 'Sea freight · shared container (LCL)', minPence: 41050, maxPence: 62000, currency: 'GBP', daysMin: 32, daysMax: 41, source: 'freightos' });
  const many = { response: { estimatedFreightRates: { mode: [one.response.estimatedFreightRates.mode, { mode: 'air', price: { min: { amount: 900, currency: 'GBP' }, max: { amount: 1300, currency: 'GBP' } }, transitTimes: { min: 5, max: 9 } }] } } };
  assert.equal(parseFreightos(many).rates.length, 2);
  assert.equal(parseFreightos({ response: { errors: { error: { message: 'Origin not found' } } } }).error, 'Origin not found');
});

test('freight rates: calls Freightos once, caches, sorts, and adds a UK road estimate for pallets', async () => {
  resetFreightCache();
  let calls = 0, url = '';
  const f = (async (u: string) => {
    if (u.includes('freightos')) {
      calls++; url = u;
      return new Response(JSON.stringify({ response: { estimatedFreightRates: { mode: [
        { mode: 'FTL', price: { min: { moneyAmount: { amount: 500, currency: 'GBP' } }, max: { moneyAmount: { amount: 700, currency: 'GBP' } } }, transitTimes: { min: 1, max: 2 } },
        { mode: 'air', price: { min: { moneyAmount: { amount: 900, currency: 'GBP' } }, max: { moneyAmount: { amount: 1300, currency: 'GBP' } } }, transitTimes: { min: 1, max: 3 } },
      ] } } }), { status: 200 });
    }
    if (u.includes('postcodes.io')) {
      const pc = decodeURIComponent(u.split('/').pop()!);
      return new Response(JSON.stringify({ result: pc.startsWith('M') ? { latitude: 53.48, longitude: -2.24 } : { latitude: 51.5, longitude: -0.12 } }), { status: 200 });
    }
    throw new Error(u);
  }) as typeof fetch;
  const query = parseFreightQuery(q({ load: 'pallets', qty: '2', kg: '300', origin: 'M1 1AE, United Kingdom', destination: 'EC1A 1BB, United Kingdom', fromCountry: 'GB', toCountry: 'GB', fromPostcode: 'M1 1AE', toPostcode: 'EC1A 1BB' }));
  const r = await freightRates(query, f);
  assert.match(url, /estimate=true/); assert.match(url, /currency=GBP/); assert.match(url, /loadtype=pallets/); assert.match(url, /length=120/);
  assert.deepEqual(r.rates.map((x) => x.mode), ['air', 'LTL', 'FTL'], 'FTL from Freightos wins over ours; our LTL is added');
  assert.equal(r.rates.find((x) => x.mode === 'LTL')!.source, 'kargom');
  await freightRates(query, f);
  assert.equal(calls, 1, 'cached');
});

test('freight rates: a failure gives a friendly note, not an error', async () => {
  resetFreightCache();
  const f = (async () => { throw new Error('down'); }) as typeof fetch;
  const r = await freightRates(parseFreightQuery(q({ load: 'boxes', kg: '5', l: '30', w: '30', h: '30', origin: 'Shenzhen, China', destination: 'Bedford, United Kingdom' })), f);
  assert.equal(r.rates.length, 0);
  assert.match(r.note!, /could not load/);
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
  assert.ok(pdf.subarray(0, 5).toString() === '%PDF-');
});
