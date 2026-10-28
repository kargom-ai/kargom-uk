import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AddressLookup, normalisePostcode } from '../src/address/lookup.ts';

test('postcodes are normalised and junk is rejected', () => {
  assert.equal(normalisePostcode(' m11ae '), 'M1 1AE');
  assert.equal(normalisePostcode('sw1a2aa'), 'SW1A 2AA');
  assert.throws(() => normalisePostcode('12345'));
});

test('ideal postcodes results map to ShipStation-ready fields and are cached', async () => {
  let calls = 0;
  const fake = (async (url: string) => {
    calls++;
    assert.match(String(url), /\/postcodes\/M11AE\?api_key=ak_x/);
    return new Response(JSON.stringify({ result: [
      { line_1: 'Acme Ltd', line_2: '10 Piccadilly', line_3: '', post_town: 'MANCHESTER', postcode: 'M1 1AE', organisation_name: 'Acme Ltd' },
      { line_1: 'Flat 2', line_2: '12 Piccadilly', line_3: 'Northern Quarter', post_town: 'NEWCASTLE UPON TYNE', postcode: 'M1 1AE', organisation_name: '' },
    ] }), { status: 200 });
  }) as typeof fetch;
  const l = new AddressLookup('ak_x', fake);
  const r = await l.byPostcode('m1 1ae');
  assert.equal(r.addresses.length, 2);
  assert.deepEqual(r.addresses[1], { label: 'Flat 2, 12 Piccadilly, Northern Quarter, NEWCASTLE UPON TYNE', company: '', line1: 'Flat 2', line2: '12 Piccadilly, Northern Quarter', city: 'Newcastle upon Tyne', postcode: 'M1 1AE', country: 'GB' });
  await l.byPostcode('M11AE');
  assert.equal(calls, 1);
});

test('unknown postcode returns suggestions, not an error', async () => {
  const fake = (async () => new Response(JSON.stringify({ code: 4040, result: ['M1 1AD'] }), { status: 404 })) as unknown as typeof fetch;
  const r = await new AddressLookup('ak_x', fake).byPostcode('M1 1ZZ');
  assert.deepEqual(r.addresses, []);
  assert.deepEqual(r.suggestions, ['M1 1AD']);
});
