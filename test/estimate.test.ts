import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimatePrice } from '../src/market/estimate.ts';
import { nearbyOnGoogle, placeLogo } from '../src/market/places.ts';

test('removal estimate grows with size, distance, extras and London', () => {
  const one = estimatePrice('removals', { moveType: 'home', size: '1' }, 10)!;
  assert.ok(one.lowPence >= 30000 && one.highPence <= 70000, JSON.stringify(one));
  const three = estimatePrice('removals', { moveType: 'home', size: '3' }, 10)!;
  assert.ok(three.lowPence > one.highPence);
  const far = estimatePrice('removals', { moveType: 'home', size: '1' }, 200)!;
  assert.ok(far.lowPence > one.lowPence);
  const extras = estimatePrice('removals', { moveType: 'home', size: '1', packing: true, fromPlace: { floor: '3', lift: false, parking: 'hard' } }, 10)!;
  assert.ok(extras.lowPence > one.lowPence);
  const london = estimatePrice('removals', { moveType: 'home', size: '1' }, 10, 'SW1A 1AA')!;
  assert.ok(london.lowPence > one.lowPence);
  assert.equal(estimatePrice('removals', { moveType: 'home' }, 10), null);
  const ftl = estimatePrice('freight', { load: 'ftl', vehicle: 'artic' }, 200)!;
  assert.ok(ftl.lowPence > 30000);
  assert.equal(estimatePrice('freight', { load: 'ltl', pallets: 2 }, null), null);
});

test('Google company picture: website icon first, then photo, never for unknown ids', async () => {
  process.env.GOOGLE_PLACES_API_KEY = 'k';
  const png = Buffer.alloc(600); png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(128, 16);
  const f = (async (url: string) => {
    if (url.includes('searchText')) return new Response(JSON.stringify({ places: [
      { id: 'A1', displayName: { text: 'Site Movers' }, websiteUri: 'https://sitemovers.co.uk/', photos: [{ name: 'places/A1/photos/p' }] },
      { id: 'B2', displayName: { text: 'Photo Movers' }, photos: [{ name: 'places/B2/photos/q' }] },
      { id: 'C3', displayName: { text: 'Plain Movers' } },
    ] }), { status: 200 });
    if (url.includes('s2/favicons')) return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    if (url.includes('/media')) return new Response(Buffer.from('jpegdata'), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    throw new Error(url);
  }) as typeof fetch;
  const list = await nearbyOnGoogle('removals', { label: 'ZZ9' }, f);
  assert.deepEqual(list.map((p) => p.hasLogo), [true, true, false]);
  assert.equal((await placeLogo('A1', f))?.type, 'image/png');
  assert.equal((await placeLogo('B2', f))?.type, 'image/jpeg');
  assert.equal(await placeLogo('C3', f), null);
  assert.equal(await placeLogo('nope', f), null);
  delete process.env.GOOGLE_PLACES_API_KEY;
});
