import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productPreview, isShopLink } from '../src/forwarding/preview.ts';
import { makeApp, makeCustomer } from './helpers.ts';

const JPEG = Buffer.alloc(2000, 7);
const fake = (pages: Record<string, () => Response>) => (async (url: string) => {
  const h = pages[url];
  if (!h) throw new Error(`unexpected fetch ${url}`);
  return h();
}) as unknown as typeof fetch;

test('Link preview: name and picture from a shop page, nothing else is fetched', async () => {
  assert.equal(isShopLink('https://www.trendyol.com/x-p-1'), true);
  assert.equal(isShopLink('http://www.trendyol.com/x'), false);
  assert.equal(isShopLink('https://evil.example/trendyol.com'), false);
  assert.equal(isShopLink('https://169.254.169.254/'), false);
  const html = `<html><head><title>x</title><meta property="og:title" content="Koton Kadın Elbise &amp; Kemer - Trendyol"><meta property="og:image" content="https://cdn.dsmcdn.com/ty1/p.jpg"></head></html>`;
  const f = fake({
    'https://ty.gl/abc': () => new Response(null, { status: 301, headers: { location: 'https://www.trendyol.com/koton/elbise-p-1' } }),
    'https://www.trendyol.com/koton/elbise-p-1': () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    'https://cdn.dsmcdn.com/ty1/p.jpg': () => new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }),
  });
  const pv = await productPreview('https://ty.gl/abc', f);
  assert.equal(pv.title, 'Koton Kadın Elbise & Kemer');
  assert.equal(pv.image?.type, 'image/jpeg');
  assert.equal(pv.image?.data.length, 2000);
  // a redirect to anywhere else is not followed; an image off the shop's CDN is not fetched
  const bad = fake({ 'https://www.trendyol.com/r': () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } }) });
  const r1 = await productPreview('https://www.trendyol.com/r', bad);
  assert.equal(r1.title, null); assert.equal(r1.image, null);
  assert.match(r1.log!.join(' '), /not a shop/);
  const offCdn = fake({ 'https://www.trendyol.com/p': () => new Response('<meta property="og:title" content="Shoe"><meta property="og:image" content="https://evil.example/x.jpg">', { headers: { 'content-type': 'text/html' } }) });
  const r2 = await productPreview('https://www.trendyol.com/p', offCdn);
  assert.equal(r2.title, 'Shoe'); assert.equal(r2.image, null);
  // price: schema.org Product data, and Trendyol's own page data
  const ld = fake({ 'https://www.hepsiburada.com/p': () => new Response('<script type="application/ld+json">{"@type":"Product","name":"Çanta","offers":{"price":"1299.90"}}</script>', { headers: { 'content-type': 'text/html' } }) });
  const r3 = await productPreview('https://www.hepsiburada.com/p', ld);
  assert.equal(r3.title, 'Çanta'); assert.equal(r3.priceTry, 1299.9);
  const ty = fake({ 'https://www.trendyol.com/q': () => new Response('<meta property="og:title" content="Elbise"><script>window.__S={"price":{"sellingPrice":{"value":549.99,"text":"549,99 TL"},"discountedPrice":{"value":499.99}}}</script>', { headers: { 'content-type': 'text/html' } }) });
  assert.equal((await productPreview('https://www.trendyol.com/q', ty)).priceTry, 499.99);
});

test('Buy for me: the request shows the product name and picture, and the parcel keeps them', async () => {
  const { app } = await makeApp();
  const t = app.turkey;
  t.preview = async () => ({ title: 'Navy cotton dress', priceTry: 899.9, image: { type: 'image/jpeg', data: JPEG } });
  const c = await makeCustomer(app);
  const b = await t.requestBuy(c, { url: 'https://www.trendyol.com/koton/elbise-p-1' });
  const ov = await t.overview(c);
  assert.equal(ov.buys[0]!.title, 'Navy cotton dress');
  assert.equal(ov.buys[0]!.image, `/api/tr/img/buy/${b.id}`);
  assert.equal(ov.buys[0]!.itemTry, 900);
  const lp = await t.linkPreview('https://www.trendyol.com/koton/elbise-p-1');
  assert.equal(lp.title, 'Navy cotton dress'); assert.equal(lp.priceTry, 899.9); assert.match(String(lp.image), /^data:image\/jpeg;base64,/);
  assert.equal((await t.productImage('buy', b.id, c)).data.length, 2000);
  const other = await makeCustomer(app, 'b@example.co.uk');
  await assert.rejects(t.productImage('buy', b.id, other), /not found/);
  await t.quoteBuy(b.id, { price: '20' });
  await app.wallet.topUp(c, 5000, 'pi_x');
  await t.payBuy(c, b.id, { payWith: 'wallet' }, 'https://x');
  const o = await t.orderedBuy(b.id, { description: 'Dress', valueTry: 899 });
  const p = (await t.overview(c)).packages.find((x) => x.id === o.packageId)!;
  assert.equal(p.productTitle, 'Navy cotton dress');
  assert.equal(p.image, `/api/tr/img/pkg/${o.packageId}`);
  // an order added with a product link gets the same
  const a = await t.addPackage(c, { store: 'Trendyol', description: 'Shoes', valueTry: 900, productUrl: 'https://www.trendyol.com/x-p-2' });
  assert.equal((await t.overview(c)).packages.find((x) => x.id === a.id)!.productTitle, 'Navy cotton dress');
});
