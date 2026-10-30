import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.ts';
import { SeoPrices } from '../src/seo/prices.ts';
import { CARRIERS, TRACK_PATTERNS } from '../src/seo/carriers.ts';
import { GUIDES } from '../src/seo/content.ts';
import { courierPage, destinationPage, guidePage, parcelPricesPage, robots, sitemap, trackPage } from '../src/seo/render.ts';

test('seo: price snapshots feed the guide pages, survive a restart, and the sitemap lists every page', async () => {
  const { app } = await makeApp();
  const prices = new SeoPrices(app);
  await prices.load();
  const n = await prices.refresh(0);
  assert.ok(n > 0, 'some prices fetched');

  const html = parcelPricesPage(prices);
  assert.match(html, /<h1>UK parcel prices by weight<\/h1>/);
  assert.match(html, /£\d+\.\d\d/, 'shows real prices');
  assert.match(html, /<link rel="canonical" href="[^"]+\/parcel-prices">/);
  assert.match(html, /Live prices checked/);

  for (const c of CARRIERS) {
    const p = courierPage(c, prices);
    assert.equal((p.match(/<h1>/g) ?? []).length, 1, `${c.slug}: one h1`);
    assert.match(p, /"@type":"FAQPage"/);
    assert.match(trackPage(c), new RegExp(`${c.name} tracking`));
  }
  assert.match(destinationPage('germany', prices), /Send a parcel to Germany/);
  for (const g of GUIDES) assert.doesNotMatch(guidePage(g, prices), /\{\{/, `${g.slug}: no template holes left`);

  // A second instance (a restart) reads the saved snapshots instead of starting empty.
  const again = new SeoPrices(app);
  assert.ok((await again.load()) >= n);
  assert.match(parcelPricesPage(again), /£\d+\.\d\d/);

  const map = sitemap(prices);
  const urls = [...map.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
  assert.equal(new Set(urls).size, urls.length, 'no duplicate URLs');
  assert.ok(urls.some((u) => u.endsWith('/couriers/evri')) && urls.some((u) => u.endsWith('/send-parcel-to/united-states')));
  assert.match(robots(), /Disallow: \/admin/);
  assert.match(robots(), /Sitemap: .+\/sitemap\.xml/);
});

test('seo: tracking numbers are matched to the right courier', () => {
  const guess = (n: string) => TRACK_PATTERNS.filter(([re]) => re.test(n)).map(([, k]) => k);
  assert.deepEqual(guess('AB123456789GB'), ['royal_mail']);
  assert.deepEqual(guess('1Z999AA10123456784'), ['ups']);
  assert.deepEqual(guess('PB1234567'), ['parcelforce']);
  assert.deepEqual(guess('15501234567890'), ['dpd']);
  assert.deepEqual(guess('1234567890'), ['dhl', 'dpd'], 'ambiguous numbers offer both');
  for (const c of CARRIERS) if (c.track.example) assert.ok(guess(c.track.example).includes(c.key), `${c.slug} example matches its own pattern`);
});

test('seo: courier tracking pages stay out of the sitemap until TRACK_PAGES=on', () => {
  delete process.env.TRACK_PAGES;
  assert.ok(!sitemap(new SeoPrices(null as never)).includes('/track/royal-mail'));
  process.env.TRACK_PAGES = 'on';
  assert.ok(sitemap(new SeoPrices(null as never)).includes('/track/royal-mail'));
  delete process.env.TRACK_PAGES;
});
