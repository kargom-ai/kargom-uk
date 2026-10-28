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
