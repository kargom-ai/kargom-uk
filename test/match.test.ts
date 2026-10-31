import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.ts';
import { board, boardJob, boardPhoto, catOf } from '../src/market/match.ts';

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDAoMDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

test('FreightMatch: a customer posts a sofa with only postcodes, every partner hears, the board hides private details', async () => {
  const { app } = await makeApp();
  const m = app.market;
  const sent: string[] = [];
  m.notice = async (to) => { sent.push(to); };
  await m.registerPartner({ email: 'a@movers.co.uk', password: 'correct-horse-1', name: 'Ann', company: 'Ann Removals', phone: '0161 000 0000', kind: 'removals' });
  await m.registerPartner({ email: 'f@haul.co.uk', password: 'correct-horse-1', name: 'Fay', company: 'Fay Haulage', phone: '020 0000 0000', kind: 'freight' });
  const customer = await app.auth.register({ email: 'sam@example.com', password: 'correct-horse-1', name: 'Sam Jones', accountType: 'personal' });

  const job = await m.createJob(customer, {
    kind: 'transport', from: { city: 'Manchester', postcode: 'M1 1AE', country: 'GB' }, to: { city: 'Leeds', postcode: 'LS1 5HD', country: 'GB' },
    date: tomorrow(), phone: '07700 900123', distanceMiles: 44, photos: [PHOTO],
    details: { category: 'furniture', what: 'three seater sofa and an armchair', qty: 2, access: { fromFloor: '2', lift: false }, notes: 'Call me on 07700 900123 before you come' },
  });
  assert.equal(job.title, 'Three seater sofa and an armchair');
  assert.equal(sent.length, 2, 'every active partner is told about a FreightMatch job');
  await assert.rejects(m.createJob(customer, { kind: 'transport', from: { city: 'Bath', postcode: 'M1 1AE' }, to: { city: 'York', postcode: 'LS1 5HD' }, date: tomorrow(), phone: '07700900123', details: { category: 'spaceship', what: 'rocket' } }), /Choose one of/);

  const b = await board(app.db, new URLSearchParams(), today());
  assert.equal(b.total, 1);
  const c = b.jobs[0]!;
  assert.equal(c.cat, 'furniture');
  assert.equal(c.fromArea, 'Manchester M1');
  assert.ok(c.estimate && c.estimate.lowPence > 0, 'a typical price is shown');
  assert.match(String(c.photo), /^\/api\/match\/jobs\/.+\/photos\//);
  assert.equal(JSON.stringify(c).includes('07700'), false, 'no phone number on the card');
  assert.equal(b.counts.furniture, 1);

  assert.equal((await board(app.db, new URLSearchParams({ cat: 'cars' }), today())).total, 0);
  assert.equal((await board(app.db, new URLSearchParams({ q: 'sofa' }), today())).total, 1);
  assert.equal((await board(app.db, new URLSearchParams({ q: 'piano' }), today())).total, 0);
  assert.equal((await board(app.db, new URLSearchParams({ from: 'leeds' }), today())).total, 0, 'collection area text must match');
  assert.equal((await board(app.db, new URLSearchParams({ max: '20' }), today())).total, 0);

  const detail = await boardJob(app.db, job.id);
  assert.match(detail.notes, /\[hidden\]/);
  assert.equal(JSON.stringify(detail).includes('Sam'), false);
  assert.equal(detail.photos.length, 1);
  const ph = await boardPhoto(app.db, job.id, detail.photos[0]!.split('/').pop()!);
  assert.equal(ph.type, 'image/jpeg');

  // A removal company can quote it even though it is not a "removals" request.
  const ann = (await app.auth.login('a@movers.co.uk', 'correct-horse-1')).principal.customerId;
  const offer = await m.makeOffer(ann, job.id, { price: '120', message: 'Two of us, Luton van' });
  assert.ok(offer);
  assert.equal((await board(app.db, new URLSearchParams(), today())).jobs[0]!.offers, 1);
});

test('FreightMatch: older removal and freight requests show under the right board category', () => {
  assert.equal(catOf('removals', { moveType: 'office' }), 'office');
  assert.equal(catOf('removals', { moveType: 'items' }), 'furniture');
  assert.equal(catOf('freight', { load: 'ltl' }), 'pallets');
  assert.equal(catOf('freight', { load: 'sea' }), 'international');
});
