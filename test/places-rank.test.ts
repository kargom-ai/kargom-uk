import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankPlaces, relevant, nearbyOnGoogle } from '../src/market/places.ts';

test('a high rating with many reviews comes first', () => {
  const list = [
    { name: 'Few reviews', rating: 5, reviews: 2 },
    { name: 'No reviews', rating: null, reviews: 0 },
    { name: 'Big and good', rating: 4.8, reviews: 320 },
    { name: 'Big and poor', rating: 3.9, reviews: 400 },
    { name: 'Mid', rating: 4.9, reviews: 60 },
  ];
  assert.deepEqual(rankPlaces(list).map((p) => p.name), ['Big and good', 'Mid', 'Few reviews', 'Big and poor', 'No reviews']);
});

test('only removal companies for removals', () => {
  assert.equal(relevant('removals', { name: 'Smith Removals', types: [] }), true);
  assert.equal(relevant('removals', { name: 'ABC Ltd', types: ['moving_company'] }), true);
  assert.equal(relevant('removals', { name: 'Big Yellow Self Storage', types: ['storage', 'moving_company'] }), false);
  assert.equal(relevant('removals', { name: 'Enterprise Van Hire', types: ['car_rental'] }), false);
  assert.equal(relevant('removals', { name: 'Joe Man and Van', types: [] }), true);
  assert.equal(relevant('removals', { name: 'Tesco Express', types: ['grocery_store'] }), false);
});

test('search asks Google for moving companies only and ranks the answer', async () => {
  process.env.GOOGLE_PLACES_API_KEY = 'k';
  let sent: any;
  const place = (id: string, name: string, rating: number, n: number, types = ['moving_company']) => ({ id, displayName: { text: name }, rating, userRatingCount: n, types, location: { latitude: 53.48, longitude: -2.24 } });
  const f = (async (_u: string, init: any) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ places: [
    place('a', 'Tiny Removals', 5, 3), place('b', 'Star Movers', 4.9, 210), place('c', 'Self Storage Co', 4.9, 900, ['storage']), place('d', 'Far Removals', 4.9, 500),
  ] })); }) as unknown as typeof fetch;
  const out = await nearbyOnGoogle('removals', { label: 'M1 rank', lat: 53.48, lng: -2.24 }, f);
  assert.equal(sent.includedType, 'moving_company');
  assert.equal(sent.strictTypeFiltering, true);
  assert.deepEqual(out.map((p) => p.name), ['Far Removals', 'Star Movers', 'Tiny Removals']);
  assert.equal('types' in out[0]!, false);
  delete process.env.GOOGLE_PLACES_API_KEY;
});
