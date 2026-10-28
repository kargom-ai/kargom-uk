import { CARRIERS, carrierByKey, carrierBySlug, TRACK_PATTERNS, type CarrierInfo, type Faq } from './carriers.ts';
import { GUIDES, guideBySlug, destinationNotes, type Guide } from './content.ts';
import { DESTINATIONS, INTL_WEIGHTS, SeoPrices, UK_WEIGHTS, cheapestByCarrier, type SeoQuote, type Snapshot } from './prices.ts';

/**
 * Server-rendered public pages for search engines and visitors: real HTML with the
 * content in it, live prices from the snapshot, one canonical URL each.
 */

export const base = () => (process.env.PUBLIC_URL || 'https://kargom.co.uk').replace(/\/+$/, '');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const gbp = (p: number) => `£${(p / 100).toFixed(2)}`;
const kgTxt = (kg: number) => (kg < 1 ? `${kg * 1000} g` : `${kg} kg`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '');
const days = (q: SeoQuote) => (q.transitDays ? (q.transitDays === 1 ? '1 working day' : `${q.transitDays} working days`) : '');
const jsonLd = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const an = (name: string) => (/^(Evri|InPost)/.test(name) ? `an ${name}` : `a ${name}`);
const trackTemplate = (c: CarrierInfo) => c.track.url('{n}').replace(/%7Bn%7D/gi, '{n}');

type Crumb = [string, string];
type PageOpts = { title: string; description: string; path: string; crumbs?: Crumb[]; ld?: unknown[]; body: string; noindex?: boolean; ogType?: string };

const verify = () => [
  process.env.GOOGLE_SITE_VERIFICATION ? `<meta name="google-site-verification" content="${esc(process.env.GOOGLE_SITE_VERIFICATION)}">` : '',
  process.env.BING_SITE_VERIFICATION ? `<meta name="msvalidate.01" content="${esc(process.env.BING_SITE_VERIFICATION)}">` : '',
].join('');

const ORG = () => ({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Kargom', url: `${base()}/`, logo: `${base()}/assets/logo.png` });

/** Head tags shared with the app pages (index, login...) so the whole site looks the same to Google. */
export function headTags(o: { title: string; description: string; path: string; noindex?: boolean; ogType?: string }) {
  const url = `${base()}${o.path}`;
  return `<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${esc(url)}">
${o.noindex ? '<meta name="robots" content="noindex, follow">' : '<meta name="robots" content="index, follow, max-image-preview:large">'}
<meta property="og:site_name" content="Kargom">
<meta property="og:type" content="${o.ogType ?? 'website'}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${base()}/assets/og.jpg">
<meta property="og:locale" content="en_GB">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#1F2A3C">
${verify()}`;
}

function page(o: PageOpts) {
  const crumbs: Crumb[] = [['Home', '/'], ...(o.crumbs ?? [])];
  const ld = [
    ...(o.crumbs?.length ? [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${base()}${path}` })) }] : []),
    ...(o.ld ?? []),
  ];
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${headTags(o)}
<link rel="icon" href="/assets/logo-white.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&amp;family=Plus+Jakarta+Sans:wght@400;500;600;700&amp;display=swap">
<link rel="stylesheet" href="/assets/seo.css">
<link rel="stylesheet" href="/assets/foot.css">
<script type="module" src="/assets/pages/seo.js"></script>
${ld.map(jsonLd).join('\n')}
</head>
<body>
${header()}
<main>
${o.crumbs?.length ? `<nav class="crumbs" aria-label="Breadcrumb"><div class="in">${crumbs.map(([n, p], i) => (i === crumbs.length - 1 ? `<span aria-current="page">${esc(n)}</span>` : `<a href="${p}">${esc(n)}</a>`)).join('<span aria-hidden="true">›</span>')}</div></nav>` : ''}
${o.body}
</main>
${footer()}
</body>
</html>`;
}

function header() {
  return `<header class="top"><div class="in">
<a href="/" class="brand" aria-label="Kargom home"><img src="/assets/logo-white.png" alt="Kargom.co.uk" width="150" height="28"></a>
<nav aria-label="Main menu" class="nav">
<a href="/parcel-prices">Prices</a><a href="/couriers">Couriers</a><a href="/track">Track</a><a href="/guides" class="hide-s">Guides</a><a href="/login" class="btn-s">Sign in</a>
</nav></div></header>`;
}

export function footer() {
  const col = (t: string, links: Array<[string, string]>) => `<div><b>${t}</b>${links.map(([n, h]) => `<a href="${h}">${esc(n)}</a>`).join('')}</div>`;
  return `<footer class="foot"><div class="in">
<div class="cols">
${col('Couriers', CARRIERS.map((c) => [c.name, `/couriers/${c.slug}`]))}
${col('Track a parcel', CARRIERS.filter((c) => c.key !== 'fedex').map((c) => [`${c.name} tracking`, `/track/${c.slug}`]))}
${col('Send abroad', Object.entries(DESTINATIONS).map(([slug, d]) => [`Parcel to ${d.name.replace(/^the /, '')}`, `/send-parcel-to/${slug}`]))}
${col('Guides and tools', [['UK parcel prices', '/parcel-prices'], ...GUIDES.map((g) => [g.title.replace(/\s*\(.*\)$/, ''), `/guides/${g.slug}`] as [string, string]), ['Volumetric weight calculator', '/tools/volumetric-weight-calculator']])}
</div>
<div class="legal"><img src="/assets/logo-white.png" alt="Kargom.co.uk" width="120" height="22" loading="lazy"><span>© ${new Date().getFullYear()} Kargom.co.uk · All prices include VAT</span></div>
</div></footer>`;
}

function quoteForm(o: { to?: string; kg?: number; title?: string }) {
  const options = ['United Kingdom', 'United States', 'Germany', 'France', 'Ireland', 'Netherlands', 'Spain', 'Italy', 'Australia', 'Canada', 'Turkey', 'Poland', 'Belgium'];
  return `<form class="qf" action="/quotes" method="get">
${o.title ? `<b class="qf-t">${esc(o.title)}</b>` : ''}
<input type="hidden" name="from" value="United Kingdom">
<label>Delivering to<select name="to">${options.map((c) => `<option${c === (o.to ?? 'United Kingdom') ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
<label>Weight (kg)<input name="kg" type="number" min="0.1" max="70" step="0.1" value="${o.kg ?? 2}" required inputmode="decimal"></label>
<button type="submit">Compare prices</button>
</form>`;
}

function faqBlock(faq: Faq[]) {
  if (!faq.length) return '';
  return `<section class="sec"><h2>Questions people ask</h2><div class="faq">${faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</div></section>`;
}
const faqLd = (faq: Faq[]) => ({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });

const checked = (iso: string | null, route: string) => (iso ? `<p class="note">Live prices checked ${esc(when(iso))} for a 30 × 20 × 15 cm parcel ${route}. Prices include VAT and change with size, weight and postcode.</p>` : '');

function logo(key: string) {
  const c = carrierByKey(key);
  return c ? `<img src="${c.logo}" alt="${esc(c.name)}" width="56" height="28" loading="lazy">` : '';
}

/** Weight × cheapest courier table for UK parcels. */
function ukCheapestTable(prices: SeoPrices) {
  const rows = UK_WEIGHTS.map((kg) => {
    const s = prices.get(SeoPrices.ukKey(kg));
    const best = [...cheapestByCarrier(s).values()].sort((a, b) => a.price - b.price)[0];
    return best ? `<tr><td>${kgTxt(kg)}</td><td class="c">${logo(best.carrier)}<span>${esc(best.serviceName)}</span></td><td class="p">${gbp(best.price)}</td><td><a href="/quotes?from=United+Kingdom&amp;to=United+Kingdom&amp;kg=${kg}">Compare all</a></td></tr>` : '';
  }).join('');
  if (!rows) return '';
  return `<div class="tblwrap"><table class="tbl"><thead><tr><th>Weight</th><th>Cheapest service</th><th>From</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>${checked(prices.latest(UK_WEIGHTS.map(SeoPrices.ukKey)), 'from London to Manchester')}`;
}

/** Weight × courier matrix. */
function ukMatrix(prices: SeoPrices) {
  const snaps = UK_WEIGHTS.map((kg) => [kg, cheapestByCarrier(prices.get(SeoPrices.ukKey(kg)))] as const);
  const carriers = CARRIERS.filter((c) => snaps.some(([, m]) => m.has(c.key)));
  if (!carriers.length) return '';
  return `<div class="tblwrap"><table class="tbl matrix"><thead><tr><th>Weight</th>${carriers.map((c) => `<th><a href="/couriers/${c.slug}">${esc(c.name)}</a></th>`).join('')}</tr></thead><tbody>
${snaps.filter(([, m]) => m.size).map(([kg, m]) => {
    const min = Math.min(...[...m.values()].map((q) => q.price));
    return `<tr><td>${kgTxt(kg)}</td>${carriers.map((c) => { const q = m.get(c.key); return `<td class="${q && q.price === min ? 'best' : ''}">${q ? gbp(q.price) : '—'}</td>`; }).join('')}</tr>`;
  }).join('')}
</tbody></table></div>`;
}

function hero(h1: string, lead: string, side = '') {
  return `<section class="hero"><div class="in"><div class="hero-t"><h1>${h1}</h1><p class="lead">${lead}</p></div>${side}</div></section>`;
}

/* ---------------- pages ---------------- */

export function parcelPricesPage(prices: SeoPrices) {
  const at = prices.latest(UK_WEIGHTS.map(SeoPrices.ukKey));
  const cheapest1 = [...cheapestByCarrier(prices.get(SeoPrices.ukKey(1))).values()].sort((a, b) => a.price - b.price)[0];
  const desc = `Live UK parcel prices from ${cheapest1 ? gbp(cheapest1.price) : 'a few pounds'} inc VAT. Compare Evri, Royal Mail, DPD, InPost, Yodel and Parcelforce by weight, updated every few hours.`;
  return page({
    title: 'UK Parcel Prices by Weight (Live, Updated Daily) | Kargom', description: desc, path: '/parcel-prices', crumbs: [['UK parcel prices', '/parcel-prices']],
    body: `${hero('UK parcel prices by weight', `Real prices we can book right now, checked every few hours. Find your weight, see who is cheapest, then compare every service for your exact parcel.`, quoteForm({ title: 'Price your parcel' }))}
<div class="in wrap">
<section class="sec"><h2>Cheapest courier for each weight</h2>${ukCheapestTable(prices) || '<p>Prices are being refreshed. Use the form above for a live quote.</p>'}</section>
<section class="sec"><h2>Every courier side by side</h2><p>The lowest price for each courier at each weight, inc VAT. The green cell is the cheapest.</p>${ukMatrix(prices)}</section>
<section class="sec prose"><h2>How to read these prices</h2>
<p>These are the lowest prices for a standard 30 × 20 × 15 cm box sent from London to Manchester. Your price can be lower or higher depending on the size of your parcel, the postcodes and whether you drop it off or book a collection. Enter your own details for an exact price. It takes a few seconds and you do not need an account.</p>
<p>Want to pay less? Read <a href="/guides/cheapest-way-to-send-a-parcel-uk">the cheapest way to send a parcel</a> and check your parcel's <a href="/tools/volumetric-weight-calculator">volumetric weight</a>.</p></section>
</div>`,
  });
}

export function couriersHub() {
  return page({
    title: 'UK Couriers Compared: Royal Mail, Evri, DPD, InPost and More | Kargom', path: '/couriers',
    description: 'Compare UK couriers side by side: how each one works, drop-off options, tracking and live prices for Royal Mail, Evri, DPD, InPost, Yodel, Parcelforce, UPS, DHL and FedEx.',
    crumbs: [['Couriers', '/couriers']],
    body: `${hero('Compare UK couriers', 'How each courier works, where you can drop off, how to track, and what it costs today.')}
<div class="in wrap"><div class="cards">${CARRIERS.map((c) => `<a class="card" href="/couriers/${c.slug}"><img src="${c.logo}" alt="" width="80" height="40" loading="lazy"><b>${esc(c.name)}</b><span>${esc(c.short)}</span></a>`).join('')}</div></div>`,
  });
}

export function courierPage(c: CarrierInfo, prices: SeoPrices) {
  const rows = UK_WEIGHTS.map((kg) => [kg, cheapestByCarrier(prices.get(SeoPrices.ukKey(kg))).get(c.key)] as const).filter(([, q]) => q);
  const at = prices.latest(UK_WEIGHTS.map(SeoPrices.ukKey));
  const from = rows.length ? Math.min(...rows.map(([, q]) => q!.price)) : 0;
  const intl = Object.entries(DESTINATIONS).map(([slug, d]) => [slug, d, cheapestByCarrier(prices.get(SeoPrices.intlKey(slug, 2))).get(c.key)] as const).filter(([, , q]) => q);
  const title = `${c.name} Parcel Delivery${from ? ` from ${gbp(from)}` : ''}: Compare Prices | Kargom`;
  const description = `${c.short} ${from ? `Book ${c.name} online from ${gbp(from)} inc VAT` : `Book ${c.name} online`}, print the label and track it. Compare with other couriers first.`;
  const others = CARRIERS.filter((o) => o.key !== c.key).slice(0, 5);
  const ld = [faqLd(c.faq)];
  return page({
    title, description, path: `/couriers/${c.slug}`, crumbs: [['Couriers', '/couriers'], [c.name, `/couriers/${c.slug}`]], ld,
    body: `${hero(`${esc(c.name)} parcel delivery`, `${esc(c.short)}${from ? ` Today from <b>${gbp(from)}</b> inc VAT.` : ''}`, quoteForm({ title: `Price ${an(c.name)} parcel` }))}
<div class="in wrap">
${rows.length ? `<section class="sec"><h2>${esc(c.name)} prices today</h2><div class="tblwrap"><table class="tbl"><thead><tr><th>Weight</th><th>Service</th><th>Delivery</th><th>From</th></tr></thead><tbody>
${rows.map(([kg, q]) => `<tr><td>${kgTxt(kg)}</td><td>${esc(q!.serviceName)}<small>${q!.dropOff ? 'Drop-off' : 'Collection'}</small></td><td>${days(q!)}</td><td class="p"><a href="/quotes?from=United+Kingdom&amp;to=United+Kingdom&amp;kg=${kg}">${gbp(q!.price)}</a></td></tr>`).join('')}
</tbody></table></div>${checked(at, 'from London to Manchester')}</section>` : ''}
<section class="sec prose"><h2>About ${esc(c.name)}</h2>${c.intro.map((p) => `<p>${esc(p)}</p>`).join('')}</section>
<section class="sec"><h2>How to send with ${esc(c.name)}</h2><ol class="steps"><li><b>Get a price</b><span>Enter the weight and size. We show every ${esc(c.name)} service your parcel fits, next to other couriers.</span></li><li><b>Pay and print</b><span>Pay by card or from your wallet. No account needed for a single parcel.</span></li><li><b>Hand it over</b><span>${c.ways.map(([t]) => esc(t)).join(', ').replace(/, ([^,]*)$/, ' or $1')}.</span></li></ol>
<div class="ways">${c.ways.map(([t, d]) => `<div><b>${esc(t)}</b><span>${esc(d)}</span></div>`).join('')}</div></section>
<section class="sec"><h2>Good for</h2><ul class="ticks">${c.goodFor.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></section>
${intl.length ? `<section class="sec"><h2>${esc(c.name)} abroad</h2><p>A 2 kg parcel today:</p><div class="chips">${intl.map(([slug, d, q]) => `<a href="/send-parcel-to/${slug}">${esc(d.name.replace(/^the /, ''))} <b>${gbp(q!.price)}</b></a>`).join('')}</div></section>` : ''}
<section class="sec"><h2>Track ${esc(an(c.name))} parcel</h2><p>${esc(c.track.format)} <a href="/track/${c.slug}">Track ${esc(an(c.name))} parcel</a>.</p></section>
${faqBlock(c.faq)}
<section class="sec"><h2>Compare with other couriers</h2><div class="chips">${others.map((o) => `<a href="/couriers/${o.slug}">${esc(o.name)}</a>`).join('')}<a href="/parcel-prices">All UK prices</a></div></section>
</div>`,
  });
}

function trackForm(c?: CarrierInfo) {
  const cfg = Object.fromEntries(CARRIERS.map((x) => [x.key, { name: x.name, url: trackTemplate(x), deep: x.track.deep }]));
  const pats = TRACK_PATTERNS.map(([re, key]) => [re.source, key]);
  return `<form class="tf" data-track='${esc(JSON.stringify({ carrier: c?.key ?? '', carriers: cfg, patterns: pats }))}'>
<label for="tn">${c ? `${esc(c.name)} tracking number` : 'Tracking number'}</label>
<div class="tf-row"><input id="tn" name="n" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${esc(c?.track.example ?? 'e.g. AB123456789GB')}" required><button type="submit">Track</button></div>
<p class="tf-out" role="status" aria-live="polite"></p>
</form>`;
}

export function trackHub() {
  return page({
    title: 'Track a Parcel: Royal Mail, Evri, DPD, Yodel, UPS and More | Kargom', path: '/track',
    description: 'Paste any tracking number and we work out the courier for you, then take you straight to the right tracking page. Royal Mail, Evri, DPD, Yodel, Parcelforce, UPS, DHL and FedEx.',
    crumbs: [['Track a parcel', '/track']],
    body: `${hero('Track a parcel', 'Not sure which courier has it? Paste the tracking number and we will recognise the courier from its format.', trackForm())}
<div class="in wrap">
<section class="sec"><h2>Tracking number formats</h2><div class="tblwrap"><table class="tbl"><thead><tr><th>Courier</th><th>What the number looks like</th></tr></thead><tbody>
${CARRIERS.map((c) => `<tr><td class="c">${logo(c.key)}<a href="/track/${c.slug}">${esc(c.name)}</a></td><td>${esc(c.track.format)}</td></tr>`).join('')}
</tbody></table></div></section>
<section class="sec prose"><h2>Cannot find your tracking number?</h2><p>If you booked with Kargom it is on your label and in your booking email. If you are waiting for something you bought online, it is usually in the shop's dispatch email, sometimes behind a "track my order" button. Marketplaces such as eBay and Vinted show it on the order page once the seller has added it.</p></section>
</div>`,
  });
}

export function trackPage(c: CarrierInfo) {
  const faq: Faq[] = [
    { q: `What does a ${c.name} tracking number look like?`, a: c.track.format },
    { q: `Where do I find my ${c.name} tracking number?`, a: c.track.where },
    { q: `My ${c.name} tracking has not updated. What should I do?`, a: 'Tracking can go quiet for a day while a parcel moves between depots, especially over weekends and bank holidays. If it has not changed for three working days, contact whoever sent it: the sender is the courier\'s customer and can open an enquiry.' },
  ];
  return page({
    title: `${c.name} Tracking: Track Your ${c.name} Parcel | Kargom`, path: `/track/${c.slug}`,
    description: `Track ${an(c.name)} parcel. ${c.track.format} What each ${c.name} tracking status means and what to do if it stops updating.`,
    crumbs: [['Track a parcel', '/track'], [`${c.name} tracking`, `/track/${c.slug}`]], ld: [faqLd(faq)],
    body: `${hero(`${esc(c.name)} tracking`, `Enter your ${esc(c.name)} tracking number and we will open ${esc(c.name)}'s tracking page for it.${c.track.deep ? '' : ' We copy the number for you so you can paste it.'}`, trackForm(c))}
<div class="in wrap">
<section class="sec"><h2>What the ${esc(c.name)} statuses mean</h2><dl class="dl">${c.track.statuses.map(([s, d]) => `<dt>${esc(s)}</dt><dd>${esc(d)}</dd>`).join('')}</dl></section>
${faqBlock(faq)}
<section class="sec cta"><div><h2>Sending with ${esc(c.name)}?</h2><p>Compare ${esc(c.name)} with every other courier for your parcel and book online in a minute.</p></div><a class="btn" href="/couriers/${c.slug}">${esc(c.name)} prices</a></section>
<section class="sec"><h2>Other couriers</h2><div class="chips">${CARRIERS.filter((o) => o.key !== c.key).map((o) => `<a href="/track/${o.slug}">${esc(o.name)} tracking</a>`).join('')}</div></section>
</div>`,
  });
}

export function destinationsHub(prices: SeoPrices) {
  return page({
    title: 'Send a Parcel Abroad from the UK: Live Prices by Country | Kargom', path: '/send-parcel-to',
    description: 'Live prices to send a parcel from the UK to the USA, Europe, Australia, Canada and Turkey, with customs tips for each destination.',
    crumbs: [['Send abroad', '/send-parcel-to']],
    body: `${hero('Send a parcel abroad', 'Live prices from the UK to popular destinations, and what to know about customs before you send.')}
<div class="in wrap"><div class="cards">${Object.entries(DESTINATIONS).map(([slug, d]) => {
      const q = [...cheapestByCarrier(prices.get(SeoPrices.intlKey(slug, 2))).values()].sort((a, b) => a.price - b.price)[0];
      return `<a class="card" href="/send-parcel-to/${slug}"><b>${esc(d.name.replace(/^the /, ''))}</b><span>${q ? `2 kg from <b>${gbp(q.price)}</b>` : 'Live prices'}</span></a>`;
    }).join('')}</div>
<p class="note">See also: <a href="/guides/sending-a-parcel-abroad-customs">customs explained</a>.</p></div>`,
  });
}

export function destinationPage(slug: string, prices: SeoPrices) {
  const d = DESTINATIONS[slug]!;
  const country = d.name.replace(/^the /, '');
  const snaps = INTL_WEIGHTS.map((kg) => [kg, prices.get(SeoPrices.intlKey(slug, kg))] as const);
  const at = prices.latest(INTL_WEIGHTS.map((kg) => SeoPrices.intlKey(slug, kg)));
  const all = snaps.flatMap(([kg, s]) => (s?.quotes ?? []).map((q) => ({ kg, q })));
  const from = all.length ? Math.min(...all.filter((x) => x.kg === INTL_WEIGHTS[0]).map((x) => x.q.price)) : 0;
  const fastest = all.filter((x) => x.kg === 2 && x.q.transitDays).sort((a, b) => a.q.transitDays! - b.q.transitDays! || a.q.price - b.q.price)[0];
  const to = slug === 'united-states' ? 'United States' : country;
  const notes = destinationNotes(d.code);
  const faq: Faq[] = [
    { q: `How much does it cost to send a parcel to ${d.name}?`, a: from ? `Today a small parcel to ${d.name} starts from ${gbp(from)} inc VAT. The price depends on weight, size and how fast you need it, so compare services for your exact parcel.` : `It depends on the weight, size and speed. Enter your parcel for live prices from several couriers.` },
    { q: `How long does a parcel take from the UK to ${d.name}?`, a: fastest ? `The fastest service we can book today aims for ${days(fastest.q)}. Economy services take longer and cost less.` : 'Express services are fastest; economy services take longer and cost less. Each price shows its expected delivery time.' },
    { q: `Do I need a customs declaration to send to ${d.name}?`, a: notes[0]! },
  ];
  const tableFor = (s: Snapshot | undefined) => [...cheapestByCarrier(s).values()].sort((a, b) => a.price - b.price);
  return page({
    title: `Send a Parcel to ${country}${from ? ` from ${gbp(from)}` : ''}: Compare Couriers | Kargom`, path: `/send-parcel-to/${slug}`,
    description: `Send a parcel from the UK to ${d.name}${from ? ` from ${gbp(from)} inc VAT` : ''}. Live prices from several couriers, delivery times and customs tips. Book online in a minute.`,
    crumbs: [['Send abroad', '/send-parcel-to'], [country, `/send-parcel-to/${slug}`]], ld: [faqLd(faq)],
    body: `${hero(`Send a parcel to ${esc(d.name)}`, `Live prices from the UK to ${esc(d.city)} and the rest of ${esc(d.name)}${from ? `, from <b>${gbp(from)}</b> inc VAT` : ''}.`, quoteForm({ to: to, title: `Price a parcel to ${country}` }))}
<div class="in wrap">
${all.length ? `<section class="sec"><h2>Prices to ${esc(d.name)} today</h2>${snaps.filter(([, s]) => s).map(([kg, s]) => `<h3>${kgTxt(kg)} parcel</h3><div class="tblwrap"><table class="tbl"><thead><tr><th>Courier</th><th>Service</th><th>Delivery</th><th>From</th></tr></thead><tbody>${tableFor(s).slice(0, 5).map((q) => `<tr><td class="c">${logo(q.carrier)}<span>${esc(carrierByKey(q.carrier)?.name ?? q.carrierName)}</span></td><td>${esc(q.serviceName)}</td><td>${days(q)}</td><td class="p">${gbp(q.price)}</td></tr>`).join('')}</tbody></table></div>`).join('')}${checked(at, `from London to ${d.city}`)}</section>` : ''}
<section class="sec prose"><h2>Customs for ${esc(d.name)}</h2>${notes.map((n) => `<p>${esc(n)}</p>`).join('')}<p>More detail in our guide to <a href="/guides/sending-a-parcel-abroad-customs">sending a parcel abroad</a>.</p></section>
${faqBlock(faq)}
<section class="sec"><h2>Other destinations</h2><div class="chips">${Object.entries(DESTINATIONS).filter(([s]) => s !== slug).map(([s, o]) => `<a href="/send-parcel-to/${s}">${esc(o.name.replace(/^the /, ''))}</a>`).join('')}</div></section>
</div>`,
  });
}

export function guidesHub() {
  return page({
    title: 'Parcel Delivery Guides and Tips | Kargom', path: '/guides',
    description: 'Practical guides to sending parcels in the UK and abroad: the cheapest way to send, volumetric weight, packaging, drop-off vs collection and customs.',
    crumbs: [['Guides', '/guides']],
    body: `${hero('Guides', 'Short, practical answers to the questions people ask before sending a parcel.')}
<div class="in wrap"><div class="cards">${GUIDES.map((g) => `<a class="card" href="/guides/${g.slug}"><b>${esc(g.h1)}</b><span>${esc(g.description)}</span></a>`).join('')}<a class="card" href="/tools/volumetric-weight-calculator"><b>Volumetric weight calculator</b><span>Work out whether your parcel will be charged by size or by weight.</span></a></div></div>`,
  });
}

export function guidePage(g: Guide, prices: SeoPrices) {
  const body = g.body.replace('{{UK_PRICES}}', ukCheapestTable(prices));
  const related = GUIDES.filter((o) => o.slug !== g.slug).slice(0, 3);
  return page({
    title: `${g.title} | Kargom`, description: g.description, path: `/guides/${g.slug}`, ogType: 'article',
    crumbs: [['Guides', '/guides'], [g.title.replace(/\s*\(.*\)$/, ''), `/guides/${g.slug}`]],
    ld: [{ '@context': 'https://schema.org', '@type': 'Article', headline: g.h1, description: g.description, dateModified: g.updated, datePublished: g.updated, author: { '@type': 'Organization', name: 'Kargom', url: `${base()}/` }, publisher: ORG(), mainEntityOfPage: `${base()}/guides/${g.slug}`, image: `${base()}/assets/og.jpg` }],
    body: `<article class="in wrap art">
<header class="art-h"><h1>${esc(g.h1)}</h1><p class="meta">Updated ${new Date(g.updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · ${g.minutes} min read</p></header>
<div class="art-cols"><div class="prose">${body}</div><aside>${quoteForm({ title: 'Get a live price' })}</aside></div>
<section class="sec"><h2>Related guides</h2><div class="cards">${related.map((o) => `<a class="card" href="/guides/${o.slug}"><b>${esc(o.h1)}</b><span>${esc(o.description)}</span></a>`).join('')}</div></section>
</article>`,
  });
}

export function calculatorPage() {
  const faq: Faq[] = [
    { q: 'How do you calculate volumetric weight?', a: 'Multiply length × width × height in centimetres and divide by 5,000. The answer is the volumetric weight in kilograms. Couriers charge whichever is higher, this or the real weight.' },
    { q: 'Why do couriers use volumetric weight?', a: 'Vans and planes run out of space before they run out of weight capacity, so large, light parcels are charged for the space they take up.' },
    { q: 'Do all couriers divide by 5,000?', a: 'Most UK and international parcel services use 5,000. A few use 4,000 or 6,000, so the calculator lets you change it.' },
  ];
  return page({
    title: 'Volumetric Weight Calculator (Free, Instant) | Kargom', path: '/tools/volumetric-weight-calculator',
    description: 'Free volumetric weight calculator. Enter your parcel size in cm and weight in kg to see the weight couriers will charge, and get live prices.',
    crumbs: [['Guides', '/guides'], ['Volumetric weight calculator', '/tools/volumetric-weight-calculator']], ld: [faqLd(faq)],
    body: `${hero('Volumetric weight calculator', 'Find out whether your parcel will be charged by its size or its weight.', `<form class="calc" id="calc">
<div class="g3"><label>Length (cm)<input name="l" type="number" min="1" step="0.5" value="30" inputmode="decimal"></label><label>Width (cm)<input name="w" type="number" min="1" step="0.5" value="20" inputmode="decimal"></label><label>Height (cm)<input name="h" type="number" min="1" step="0.5" value="15" inputmode="decimal"></label></div>
<div class="g2"><label>Real weight (kg)<input name="kg" type="number" min="0.1" step="0.1" value="1" inputmode="decimal"></label><label>Divisor<select name="d"><option>5000</option><option>4000</option><option>6000</option></select></label></div>
<output class="calc-out" for="calc" aria-live="polite"></output>
<a class="btn" id="calc-go" href="/quotes?from=United+Kingdom&amp;to=United+Kingdom&amp;kg=2&amp;l=30&amp;w=20&amp;h=15">Compare prices for this parcel</a>
</form>`)}
<div class="in wrap"><section class="sec prose"><h2>How it works</h2><p>Couriers charge for whichever is greater: what your parcel weighs on the scales, or its volumetric weight, which is length × width × height ÷ 5,000. A small heavy parcel is charged by weight. A big light one is charged by size.</p><p>Read the full explanation, with examples, in <a href="/guides/volumetric-weight-explained">volumetric weight explained</a>.</p></section>${faqBlock(faq)}</div>`,
  });
}

export function notFoundPage() {
  return page({ title: 'Page not found | Kargom', description: 'This page does not exist.', path: '/404', noindex: true,
    body: `${hero('Page not found', 'The page you were looking for is not here. Try one of these instead.')}<div class="in wrap"><div class="chips"><a href="/">Compare prices</a><a href="/couriers">Couriers</a><a href="/track">Track a parcel</a><a href="/guides">Guides</a></div></div>` });
}

/* ---------------- sitemap & robots ---------------- */

export function sitemap(prices: SeoPrices) {
  const uk = prices.latest(UK_WEIGHTS.map(SeoPrices.ukKey));
  const day = (iso: string | null) => (iso ?? new Date().toISOString()).slice(0, 10);
  const urls: Array<[string, string | null, string]> = [
    ['/', uk, '1.0'], ['/parcel-prices', uk, '0.9'], ['/partner', null, '0.5'], ['/couriers', uk, '0.8'], ['/track', null, '0.8'], ['/send-parcel-to', null, '0.7'], ['/guides', null, '0.6'],
    ['/tools/volumetric-weight-calculator', '2026-10-28T00:00:00Z', '0.6'],
    ...CARRIERS.map((c) => [`/couriers/${c.slug}`, uk, '0.8'] as [string, string | null, string]),
    ...CARRIERS.map((c) => [`/track/${c.slug}`, '2026-10-28T00:00:00Z', '0.7'] as [string, string | null, string]),
    ...Object.keys(DESTINATIONS).map((s) => [`/send-parcel-to/${s}`, prices.latest(INTL_WEIGHTS.map((kg) => SeoPrices.intlKey(s, kg))), '0.7'] as [string, string | null, string]),
    ...GUIDES.map((g) => [`/guides/${g.slug}`, `${g.updated}T00:00:00Z`, '0.6'] as [string, string | null, string]),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([p, at, pr]) => `<url><loc>${base()}${p}</loc><lastmod>${day(at)}</lastmod><priority>${pr}</priority></url>`).join('\n')}
</urlset>`;
}

export function robots() {
  return `User-agent: *
Allow: /
Disallow: /app
Disallow: /admin
Disallow: /checkout
Disallow: /l/
Disallow: /api/
Disallow: /quotes
Disallow: /partner/
Disallow: /movers

Sitemap: ${base()}/sitemap.xml
`;
}

export const resolve = { carrierBySlug, guideBySlug, DESTINATIONS };
