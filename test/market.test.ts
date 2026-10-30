import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, makeCustomer } from './helpers.ts';
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

test('market: customers see companies based nearest to the start of their move', async () => {
  const { app } = await makeApp();
  const m = app.market;
  const coords: Record<string, [number, number]> = { M1: [53.48, -2.24], M4: [53.48, -2.23], LS1: [53.80, -1.55], SW1A: [51.50, -0.14] };
  const fake = (async (url: string) => {
    const k = decodeURIComponent(String(url).split('/').pop()!);
    const c = coords[k];
    return new Response(JSON.stringify(c ? { result: { latitude: c[0], longitude: c[1] } } : {}), { status: c ? 200 : 404 });
  }) as typeof fetch;
  const customer = await app.auth.register({ email: 'kim@example.com', password: 'correct-horse-1', name: 'Kim Lee', accountType: 'personal' });
  const london = await m.registerPartner({ email: 'l@m.co.uk', password: 'correct-horse-1', name: 'L', company: 'London Movers', phone: '020 0000 0000', kind: 'removals', basePostcode: 'SW1A 1AA' });
  await m.registerPartner({ email: 'n@m.co.uk', password: 'correct-horse-1', name: 'N', company: 'Northern Vans', phone: '0161 000 0000', kind: 'removals', basePostcode: 'm4' });
  await m.registerPartner({ email: 'h@m.co.uk', password: 'correct-horse-1', name: 'H', company: 'Haulier', phone: '0161 000 0001', kind: 'freight', basePostcode: 'M1' });
  await assert.rejects(m.updateProfile(london.customerId, { basePostcode: 'nowhere' }), /postcode/);
  const job = await m.createJob(customer, { kind: 'removals', from: home('1 High St', 'Manchester', 'M1 1AE'), to: home('2 Park Rd', 'Leeds', 'LS1 5HD'), date: tomorrow(), phone: '07700 900123',
    details: { moveType: 'home', size: '1' } });
  const near = await m.nearbyPartners(customer, job.id, fake);
  assert.deepEqual(near.partners.map((p) => p.company), ['Northern Vans', 'London Movers'], 'closest first, removal companies only');
  assert.equal(near.partners[0]!.basedIn, 'M4');
  assert.ok(near.partners[0]!.milesAway! < 5 && near.partners[1]!.milesAway! > 100);
});

test('market: companies from Google appear when there are no offers, and customers can invite them', async () => {
  const { app } = await makeApp();
  const m = app.market;
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  let asked: Record<string, any> | null = null;
  const fake = (async (url: string, init?: RequestInit) => {
    if (String(url).includes('postcodes.io')) return new Response(JSON.stringify({ result: { latitude: 53.48, longitude: -2.24 } }));
    asked = { url, headers: init?.headers, body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ places: [
      { id: 'p1', displayName: { text: 'Best Movers Manchester' }, formattedAddress: '5 Road, Manchester M4 1AA, UK', rating: 4.8, userRatingCount: 212, websiteUri: 'https://best.example', nationalPhoneNumber: '0161 234 5678', location: { latitude: 53.49, longitude: -2.23 } },
      { id: 'p2', displayName: { text: 'Kargom Partner Co' }, formattedAddress: 'x', location: { latitude: 53.5, longitude: -2.2 } },
      { id: 'p3', displayName: { text: 'Gone Ltd' }, businessStatus: 'CLOSED_PERMANENTLY' },
    ] }));
  }) as typeof fetch;
  try {
    const customer = await app.auth.register({ email: 'g@example.com', password: 'correct-horse-1', name: 'Gee Bee', accountType: 'personal' });
    await m.registerPartner({ email: 'k@p.co.uk', password: 'correct-horse-1', name: 'K', company: 'Kargom Partner Co', phone: '0161 000 0000', kind: 'removals' });
    const job = await m.createJob(customer, { kind: 'removals', from: home('1 High St', 'Manchester', 'M1 1AE'), to: home('2 Park Rd', 'Leeds', 'LS1 5HD'), date: tomorrow(), phone: '07700 900123', details: { moveType: 'home', size: '1' } });
    const g = await m.googleNearby(customer, job.id, fake);
    assert.equal(asked!.body.textQuery, 'removal company near Manchester M1, UK');
    assert.deepEqual(g.places.map((p) => p.name), ['Best Movers Manchester'], 'partners and closed businesses are left out');
    assert.equal(g.places[0]!.milesAway, 1);
    assert.equal(g.places[0]!.phone, '0161 234 5678');
    await m.invite(customer, job.id, { placeId: 'p1', name: 'Best Movers Manchester', website: 'https://best.example' });
    assert.equal((await m.invite(customer, job.id, { placeId: 'p1', name: 'Best Movers Manchester' })).already, true);
    assert.deepEqual((await m.googleNearby(customer, job.id, fake)).invited, ['p1']);
  } finally { delete process.env.GOOGLE_PLACES_API_KEY; }
});

test('market: straight-line distance is sensible', () => {
  const manchester = { lat: 53.4808, lng: -2.2426 }, leeds = { lat: 53.8008, lng: -1.5491 };
  const miles = haversineMiles(manchester, leeds);
  assert.ok(miles > 30 && miles < 40, `${miles}`);
});

test('market: the request PDF opens for the owner and by its secret link, with photos', async () => {
  const { app } = await makeApp();
  const m = app.market;
  const customer = await app.auth.register({ email: 'p@example.com', password: 'correct-horse-1', name: 'Pat Doe', accountType: 'personal' });
  // a 1x1 JPEG
  const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const job = await m.createJob(customer, { kind: 'removals', from: home('1 High St', 'Manchester', 'M1 1AE'), to: home('2 Park Rd', 'Leeds', 'LS1 5HD'), date: tomorrow(), phone: '07700 900123',
    details: { moveType: 'home', size: '3', notes: 'Piano → 2nd floor' }, photos: [jpeg] });
  const full = await m.customerJob(customer, job.id);
  assert.match(full.sharePath, /^\/r\/[\w-]{16,}$/);
  const own = await m.customerPdf(customer, job.id);
  assert.equal(own.pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(own.pdf.toString('latin1'), /\/DCTDecode/, 'photo embedded');
  const shared = await m.sharedPdf(full.sharePath.slice(3));
  assert.equal(shared.ref, job.ref);
  await assert.rejects(m.sharedPdf('not-a-real-token-123456'), /no longer|not found/i);
  assert.equal((await m.customerJob(customer, job.id)).sharePath, full.sharePath, 'the link stays the same');
});

test('market: visitors see nearby companies with phone numbers partly hidden', async () => {
  const { app } = await makeApp();
  const m = app.market;
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  const fake = (async (url: string) => {
    if (String(url).includes('postcodes.io')) return new Response(JSON.stringify({ result: { latitude: 52.48, longitude: -1.86 } }));
    return new Response(JSON.stringify({ places: [{ id: 'p1', displayName: { text: 'Brum Movers' }, formattedAddress: '1 Road, Birmingham B8 1AA, UK', nationalPhoneNumber: '0121 496 0123', internationalPhoneNumber: '+44 121 496 0123', websiteUri: 'https://x.example', rating: 4.6, userRatingCount: 80, location: { latitude: 52.49, longitude: -1.85 } }] }));
  }) as typeof fetch;
  try {
    await m.registerPartner({ email: 'b@m.co.uk', password: 'correct-horse-1', name: 'B', company: 'Kargom Movers', phone: '07700 900456', kind: 'removals', basePostcode: 'B8 2AA' });
    const r = await m.publicNearby('b8 1aa', 'removals', fake);
    assert.equal(r.near, 'B8');
    assert.equal(r.partners[0]!.phone, '07700 90****');
    assert.equal(r.google[0]!.phone, '0121 496 ****');
    assert.equal(r.google[0]!.whatsapp, true);
    assert.equal(JSON.stringify(r).includes('0123'), false, 'no full number anywhere');
    assert.equal(JSON.stringify(r).includes('x.example'), false, 'no website link');
    await assert.rejects(m.publicNearby('nowhere', 'removals', fake), /postcode/);
  } finally { delete process.env.GOOGLE_PLACES_API_KEY; }
});

test('sea freight: Google forwarders at the destination, port and FBA details kept', async () => {
  const { app } = await makeApp();
  const m = app.market;
  const customer = await makeCustomer(app, 'seller@example.co.uk');
  const job = await m.createJob(customer, {
    kind: 'freight', from: { line1: 'Port of Ningbo (CNNGB)', city: 'Ningbo', postcode: 'CNNGB', country: 'CN' }, to: { line1: 'Amazon BHX5', city: 'Rugby', postcode: 'CV23 0XF', country: 'GB' },
    date: tomorrow(), phone: '07700 900123',
    details: { load: 'sea', goods: 'Phone cases', shipUnit: 'container40', units: 1, originType: 'port', portFrom: 'cnngb', destType: 'amazon', fbaCode: 'BHX5', fbaLabelling: true, fbaPrep: true },
  });
  const d = (await m.customerJob(customer, job.id)).details as any;
  assert.deepEqual([d.originType, d.portFrom, d.destType, d.fbaLabelling, d.fbaPrep, d.fbaAppointment], ['port', 'CNNGB', 'amazon', true, true, false]);
  process.env.GOOGLE_PLACES_API_KEY = 'k';
  let body: any = null;
  const f = (async (url: string, init: any) => { if (String(url).includes('searchText')) body = JSON.parse(init.body); return new Response(JSON.stringify({ places: [] })); }) as any;
  const g = await m.googleNearby(customer, job.id, f) as any;
  assert.equal(body.textQuery, 'freight forwarder in Rugby');
  assert.equal(body.regionCode, 'gb');
  assert.equal(g.searched, 'Rugby');
  delete process.env.GOOGLE_PLACES_API_KEY;
});
