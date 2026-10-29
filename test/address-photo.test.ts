import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAddress, addressFromImage } from '../src/address/fromImage.ts';

const pick = (s: string) => { const a = parseAddress(s); return { name: a.name, phone: a.phone, email: a.email, line1: a.line1, line2: a.line2, city: a.city, postcode: a.postcode, country: a.country }; };

test('address from text: UK label with labels, flat, phone', () => {
  assert.deepEqual(pick('Ship to:\nJohn Smith\nFlat 4, 22 Baker Street\nLondon\nNW1 6XE\nUnited Kingdom\n+44 7700 900123'),
    { name: 'John Smith', phone: '+447700900123', email: '', line1: 'Flat 4, 22 Baker Street', line2: '', city: 'London', postcode: 'NW1 6XE', country: 'GB' });
});
test('address from text: one line with commas, and a message with email', () => {
  assert.deepEqual(pick('Alice Brown, 7 Rose Lane, Bristol, BS1 4DJ'), { name: 'Alice Brown', phone: '', email: '', line1: '7 Rose Lane', line2: '', city: 'Bristol', postcode: 'BS1 4DJ', country: 'GB' });
  const a = pick('Sarah Jones\n12 High Street, Didsbury, Manchester M20 6RT\n07700 900456\nsarah.j@example.com');
  assert.equal(a.email, 'sarah.j@example.com'); assert.equal(a.phone, '07700900456'); assert.equal(a.line2, 'Didsbury'); assert.equal(a.city, 'Manchester');
});
test('address from text: Turkey, Germany, USA', () => {
  const tr = pick('Mehmet Yılmaz\nAtatürk Cad. No: 15 D:3\nKadıköy\n34710 Istanbul\nTürkiye\n+90 532 123 45 67');
  assert.deepEqual([tr.country, tr.postcode, tr.city, tr.line1, tr.phone], ['TR', '34710', 'Istanbul', 'Atatürk Cad. No: 15 D:3', '+905321234567']);
  const de = pick('Hans Müller\nInvalidenstraße 117\n10115 Berlin\nGermany');
  assert.deepEqual([de.country, de.postcode, de.city, de.line1], ['DE', '10115', 'Berlin', 'Invalidenstraße 117']);
  const us = pick('Jane Doe\n350 5th Ave, Apt 12B\nNew York, NY 10118\nUSA');
  assert.deepEqual([us.country, us.postcode, us.city], ['US', '10118', 'New York']);
});
test('address from image: calls Vision with the image, never stores it', async () => {
  process.env.GOOGLE_VISION_API_KEY = 'v';
  let sent: any = null;
  const f = (async (u: string, init: any) => { sent = { u, b: JSON.parse(init.body) }; return new Response(JSON.stringify({ responses: [{ fullTextAnnotation: { text: 'Alice Brown\n7 Rose Lane\nBristol BS1 4DJ' } }] }), { status: 200 }); }) as typeof fetch;
  const r = await addressFromImage('data:image/jpeg;base64,AAAA', f);
  assert.match(sent.u, /vision\.googleapis\.com\/v1\/images:annotate\?key=v/);
  assert.equal(sent.b.requests[0].image.content, 'AAAA');
  assert.equal(r.found, true); assert.equal(r.address.postcode, 'BS1 4DJ'); assert.equal(r.address.city, 'Bristol');
  await assert.rejects(addressFromImage('data:application/pdf;base64,AAAA', f), /JPG/);
  delete process.env.GOOGLE_VISION_API_KEY;
});

test('address from image with AI (Claude): sends the picture, reads the JSON answer', async () => {
  process.env.ANTHROPIC_API_KEY = 'a';
  let sent: any = null;
  const f = (async (u: string, init: any) => {
    sent = { u, h: init.headers, b: JSON.parse(init.body) };
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Here you go:\n{"name":"Alice Brown","company":"","phone":"+447700900456","email":"","line1":"7 Rose Lane","line2":"","city":"Bristol","postcode":"bs1 4dj","country":"gb"}' }] }), { status: 200 });
  }) as typeof fetch;
  const r = await addressFromImage('data:image/png;base64,BBBB', f);
  assert.equal(sent.u, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent.h['x-api-key'], 'a');
  assert.equal(sent.b.messages[0].content[0].source.media_type, 'image/png');
  assert.equal(sent.b.messages[0].content[0].source.data, 'BBBB');
  assert.deepEqual([r.found, r.address.name, r.address.postcode, r.address.country, r.address.city], [true, 'Alice Brown', 'BS1 4DJ', 'GB', 'Bristol']);
  const none = (async () => new Response(JSON.stringify({ content: [{ type: 'text', text: '{"none":true}' }] }), { status: 200 })) as typeof fetch;
  assert.equal((await addressFromImage('data:image/png;base64,BBBB', none)).found, false);
  delete process.env.ANTHROPIC_API_KEY;
});

test('address from image: a restricted Google key gives a clear message', async () => {
  process.env.GOOGLE_VISION_API_KEY = 'v';
  const f = (async () => new Response(JSON.stringify({ error: { message: 'Requests to this API vision.googleapis.com method google.cloud.vision.v1.ImageAnnotator.BatchAnnotateImages are blocked.' } }), { status: 403 })) as typeof fetch;
  await assert.rejects(addressFromImage('data:image/jpeg;base64,AAAA', f), /restricted: add Cloud Vision API/);
  delete process.env.GOOGLE_VISION_API_KEY;
});
