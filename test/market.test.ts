import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.ts';
import { haversineMiles } from '../src/market/route.ts';

const home = (line1: string, city: string, postcode: string) => ({ line1, city, postcode, country: 'GB' });
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

test('market: customer posts a move, removal companies quote, customer accepts one and reviews it', async () => {
  const { app } = await makeApp();
  const m = app.market;
  const sent: string[] = [];
  m.notice = async (to, subject) => { sent.push(`${to}: ${subject}`); };

  const customer = await app.auth.register({ email: 'sam@example.com', password: 'correct-horse-1', name: 'Sam Jones', accountType: 'personal' });
  const a = await m.registerPartner({ email: 'a@movers.co.uk', password: 'correct-horse-1', name: 'Ann', company: 'Ann Removals', phone: '0161 000 0000', kind: 'removals' });
  const b = await m.registerPartner({ email: 'b@movers.co.uk', password: 'correct-horse-1', name: 'Bob', company: 'Bob Vans', phone: '0113 000 0000', kind: 'removals' });
  const f = await m.registerPartner({ email: 'f@haul.co.uk', password: 'correct-horse-1', name: 'Fay', company: 'Fay Haulage', phone: '020 0000 0000', kind: 'freight' });

  const job = await m.createJob(customer, {
    kind: 'removals', from: home('1 High St', 'Manchester', 'M1 1AE'), to: home('2 Park Rd', 'Leeds', 'LS1 5HD'), date: tomorrow(), phone: '07700 900123', distanceMiles: 44,
    details: { moveType: 'home', size: '2', packing: true, fromPlace: { floor: '2', lift: false, parking: 'permit' }, toPlace: { floor: 'ground' } },
  });
  assert.equal(job.title, '2 bedroom home move');
  assert.equal(job.status, 'open');
  assert.equal(sent.length, 2, 'both removal companies told, not the haulier');

  // Partners see the area but not the exact address or phone before they win.
  const seenByA = await m.partnerJob(a.customerId, job.id);
  assert.equal(seenByA.fromArea, 'Manchester M1');
  assert.equal((seenByA as Record<string, unknown>).from, undefined);
  assert.equal(seenByA.customer, null);
  await assert.rejects(m.partnerJob(f.customerId, job.id), /not found/i, 'freight company cannot see a home move');

  await m.makeOffer(a.customerId, job.id, { price: '650', message: 'Two men and a Luton van', vehicle: 'Luton van' });
  await m.makeOffer(b.customerId, job.id, { price: '£590.50' });
  await m.makeOffer(b.customerId, job.id, { price: '575' }); // update, not a second offer
  const mine = await m.customerJob(customer, job.id);
  assert.deepEqual(mine.offers.map((o) => [o.partner.company, o.pricePence]), [['Bob Vans', 57500], ['Ann Removals', 65000]]);
  assert.equal(mine.offers[0]!.partner.phone, '0113 000 0000', 'customer can call the company');

  const booked = await m.acceptOffer(customer, job.id, mine.offers[1]!.id);
  assert.equal(booked.status, 'booked');
  assert.deepEqual(booked.offers.map((o) => o.status).sort(), ['accepted', 'declined']);
  const won = await m.partnerJob(a.customerId, job.id);
  assert.equal(won.customer?.phone, '07700 900123', 'winner now sees the contact');
  assert.equal(won.from?.line1, '1 High St');
  await assert.rejects(m.acceptOffer(customer, job.id, mine.offers[0]!.id), /already/);
  await assert.rejects(m.makeOffer(b.customerId, job.id, { price: '500' }), /no longer/);

  const done = await m.review(customer, job.id, 5, 'Careful and on time');
  assert.equal(done.status, 'completed');
  const prof = await m.profile(a.id);
  assert.equal(prof.rating, 5);
  assert.equal(prof.reviewCount, 1);
  assert.equal(prof.reviews[0]!.author, 'Sam J.');
  await assert.rejects(m.review(customer, job.id, 4, 'again'), /already/);
});

test('market: freight requests validate the load and stay private to freight partners', async () => {
  const { app } = await makeApp();
  const m = app.market;
  const customer = await app.auth.register({ email: 'ops@shop.co.uk', password: 'correct-horse-1', name: 'Ops Team', accountType: 'business' });
  const f = await m.registerPartner({ email: 'f@haul.co.uk', password: 'correct-horse-1', name: 'Fay', company: 'Fay Haulage', phone: '020 0000 0000', kind: 'freight' });
  const base = { kind: 'freight', from: home('Unit 1', 'Leicester', 'LE1 1AA'), to: { line1: 'Rue 1', city: 'Lille', postcode: '59000', country: 'FR' }, date: tomorrow(), phone: '0116 000 0000' };
  await assert.rejects(m.createJob(customer, { ...base, details: { load: 'ltl', goods: 'Books', weightKg: 800 } }), /pallets/);
  const job = await m.createJob(customer, { ...base, details: { load: 'ltl', goods: 'Boxed books', weightKg: 800, pallets: 2, palletType: 'euro', tailLiftDelivery: true } });
  assert.equal(job.title, 'Part load · 2 pallets');
  assert.equal((await m.partnerFeed(f.customerId, 'open')).length, 1);
  await m.makeOffer(f.customerId, job.id, { price: 420 });
  assert.equal((await m.partnerFeed(f.customerId, 'open')).length, 0, 'quoted requests move to "my offers"');
  assert.equal((await m.partnerFeed(f.customerId, 'mine')).length, 1);
  await m.withdrawOffer(f.customerId, job.id);
  assert.equal((await m.customerJob(customer, job.id)).offers.length, 0);
  await assert.rejects(m.requirePartner(customer), /partner/);
});

test('market: straight-line distance is sensible', () => {
  const manchester = { lat: 53.4808, lng: -2.2426 }, leeds = { lat: 53.8008, lng: -1.5491 };
  const miles = haversineMiles(manchester, leeds);
  assert.ok(miles > 30 && miles < 40, `${miles}`);
});
