import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestPostcode } from '../src/address/lookup.ts';

const reply = (result: unknown) => new Response(JSON.stringify({ status: 200, result }), { status: 200 });

test('location → nearest postcode', async () => {
  const urls: string[] = [];
  const f = (async (u: string) => { urls.push(u); return reply([{ postcode: 'M1 1AE', admin_district: 'Manchester' }]); }) as unknown as typeof fetch;
  assert.deepEqual(await nearestPostcode(53.4808, -2.2426, f), { postcode: 'M1 1AE', town: 'Manchester' });
  assert.match(urls[0]!, /lon=-2\.242600&lat=53\.480800&radius=300/);
});

test('widens the search when nothing is close', async () => {
  let n = 0;
  const f = (async () => (++n < 3 ? reply(null) : reply([{ postcode: 'IV27 4AA' }]))) as unknown as typeof fetch;
  assert.equal((await nearestPostcode(58.2, -5.0, f)).postcode, 'IV27 4AA');
  assert.equal(n, 3);
});

test('outside the UK is refused without calling out', async () => {
  const f = (async () => { throw new Error('should not call'); }) as unknown as typeof fetch;
  await assert.rejects(nearestPostcode(41.0, 29.0, f), /outside the UK/);
  await assert.rejects(nearestPostcode(NaN, 0, f), /could not read/);
});
