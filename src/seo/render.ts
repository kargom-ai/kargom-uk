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
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<link rel="icon" href="/assets/icon-96.png" sizes="96x96" type="image/png">
<link rel="apple-touch-icon" href="/assets/icon-180.png">
<link rel="manifest" href="/assets/site.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;500;600;700;800&amp;display=swap">
<link rel="stylesheet" href="/assets/seo.css">
<link rel="stylesheet" href="/assets/foot.css">
<script type="module" src="/assets/pages/seo.js"></script>
<script async src="https://www.googletagmanager.com/gtag/js?id=AW-18548186219"></script>
<script src="/assets/consent.js" defer></script>
<script src="/assets/livechat.js" defer></script>
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

/**
 * Courier tracking guide pages (/track/royal-mail …) are switched off while Google reviews the site,
 * because brand tracking pages on a new domain look like delivery scams to its classifier.
 * Set TRACK_PAGES=on in Render to bring them back.
 */
export const trackPagesOn = () => process.env.TRACK_PAGES === 'on';
const trackHref = (slug: string) => (trackPagesOn() ? `/track/${slug}` : '/track');

export function footer() {
  const col = (t: string, links: Array<[string, string]>) => `<div><b>${t}</b>${links.map(([n, h]) => `<a href="${h}">${esc(n)}</a>`).join('')}</div>`;
  return `<footer class="foot"><div class="in">
<div class="cols">
${col('Couriers', CARRIERS.map((c) => [c.name, `/couriers/${c.slug}`]))}
${trackPagesOn() ? col('Track a parcel', CARRIERS.filter((c) => c.key !== 'fedex').map((c) => [`${c.name} tracking`, `/track/${c.slug}`])) : col('Track a parcel', [['Track any parcel', '/track']])}
${col('Send abroad', Object.entries(DESTINATIONS).map(([slug, d]) => [`Parcel to ${d.name.replace(/^the /, '')}`, `/send-parcel-to/${slug}`]))}
${col('Freight and moving', [['Compare freight rates', '/freight'], ['Find removal companies', '/movers'], ...GUIDES.filter((g) => g.cat === 'freight' || g.cat === 'moving').slice(0, 7).map((g) => [g.title.replace(/\s*[(:].*$/, ''), `/guides/${g.slug}`] as [string, string])])}
${col('Guides and tools', [['UK parcel prices', '/parcel-prices'], ...GUIDES.filter((g) => !g.cat || g.cat === 'parcels').map((g) => [g.title.replace(/\s*\(.*\)$/, ''), `/guides/${g.slug}`] as [string, string]), ['Volumetric weight calculator', '/tools/volumetric-weight-calculator']])}
</div>
<p style="margin:18px 0 0;font-size:12.5px;line-height:1.55;opacity:.8">Kargom.co.uk compares live prices from leading UK and international couriers and books your label in minutes. Pay by card or with your Kargom wallet, print at home or drop off nearby, and get help from our UK team in your account.</p>
${(() => { const c = company(); return `<p style="margin:8px 0 0;font-size:12.5px;line-height:1.55;opacity:.8">Kargom.co.uk is a trading name of ${esc(c.name)}, registered in England and Wales${c.number ? `, company no. ${esc(c.number)}` : ''}${c.address ? `. Registered office: ${esc(c.address)}` : ''}.${c.email ? ` Contact: <a href="mailto:${esc(c.email)}" style="color:inherit">${esc(c.email)}</a>.` : ''}<br><a href="/about" style="color:inherit">About us</a> · <a href="/terms" style="color:inherit">Terms and conditions</a> · <a href="/privacy" style="color:inherit">Privacy policy</a> · <a href="/cookies" style="color:inherit">Cookie policy</a> · <a href="/cookies" data-cookie-settings style="color:inherit">Cookie settings</a></p>`; })()}
<div class="legal"><div class="brandrow"><img src="/assets/logo-white.png" alt="Kargom.co.uk" width="120" height="22" loading="lazy">
<span class="fbadges"><img src="/assets/badges/amazon-spn.png" alt="Amazon SPN Verified Service Provider" width="144" height="26" loading="lazy"><img src="/assets/badges/nvidia-inception.png" alt="NVIDIA Inception Program member" width="123" height="26" loading="lazy"></span></div><span>© ${new Date().getFullYear()} Kargom.co.uk · All prices include VAT</span></div>
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
${notCourier(c.name)}
<div class="in wrap">
${rows.length ? `<section class="sec"><h2>${esc(c.name)} prices today</h2><div class="tblwrap"><table class="tbl"><thead><tr><th>Weight</th><th>Service</th><th>Delivery</th><th>From</th></tr></thead><tbody>
${rows.map(([kg, q]) => `<tr><td>${kgTxt(kg)}</td><td>${esc(q!.serviceName)}<small>${q!.dropOff ? 'Drop-off' : 'Collection'}</small></td><td>${days(q!)}</td><td class="p"><a href="/quotes?from=United+Kingdom&amp;to=United+Kingdom&amp;kg=${kg}">${gbp(q!.price)}</a></td></tr>`).join('')}
</tbody></table></div>${checked(at, 'from London to Manchester')}</section>` : ''}
<section class="sec prose"><h2>About ${esc(c.name)}</h2>${c.intro.map((p) => `<p>${esc(p)}</p>`).join('')}</section>
<section class="sec"><h2>How to send with ${esc(c.name)}</h2><ol class="steps"><li><b>Get a price</b><span>Enter the weight and size. We show every ${esc(c.name)} service your parcel fits, next to other couriers.</span></li><li><b>Pay and print</b><span>Pay by card or from your wallet. No account needed for a single parcel.</span></li><li><b>Hand it over</b><span>${c.ways.map(([t]) => esc(t)).join(', ').replace(/, ([^,]*)$/, ' or $1')}.</span></li></ol>
<div class="ways">${c.ways.map(([t, d]) => `<div><b>${esc(t)}</b><span>${esc(d)}</span></div>`).join('')}</div></section>
<section class="sec"><h2>Good for</h2><ul class="ticks">${c.goodFor.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></section>
${intl.length ? `<section class="sec"><h2>${esc(c.name)} abroad</h2><p>A 2 kg parcel today:</p><div class="chips">${intl.map(([slug, d, q]) => `<a href="/send-parcel-to/${slug}">${esc(d.name.replace(/^the /, ''))} <b>${gbp(q!.price)}</b></a>`).join('')}</div></section>` : ''}
<section class="sec"><h2>Track ${esc(an(c.name))} parcel</h2><p>${esc(c.track.format)} <a href="${trackHref(c.slug)}">Track ${esc(an(c.name))} parcel</a>.</p></section>
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
    body: `${hero('Track a parcel', 'Not sure which courier has it? Paste the tracking number and we will recognise the courier and open its own tracking page.', trackForm())}
${notCourier('')}
<div class="in wrap">
<section class="sec"><h2>Tracking number formats</h2><div class="tblwrap"><table class="tbl"><thead><tr><th>Courier</th><th>What the number looks like</th></tr></thead><tbody>
${CARRIERS.map((c) => `<tr><td class="c">${trackPagesOn() ? `${logo(c.key)}<a href="/track/${c.slug}">${esc(c.name)}</a>` : esc(c.name)}</td><td>${esc(c.track.format)}</td></tr>`).join('')}
</tbody></table></div></section>
<section class="sec prose"><h2>Cannot find your tracking number?</h2><p>If you booked with Kargom it is on your label and in your booking email. If you are waiting for something you bought online, it is usually in the shop's dispatch email, sometimes behind a "track my order" button. Marketplaces such as eBay and Vinted show it on the order page once the seller has added it.</p></section>
</div>`,
  });
}

/** Said plainly on every courier page: we are not the courier, and we never charge to release a parcel. */
function notCourier(name: string) {
  if (!name) return `<div class="in wrap"><p style="margin:14px 0 0;padding:12px 16px;border-radius:12px;background:#FFF8E6;border:1px solid #F5D48A;color:#5C4300;font-size:14px;line-height:1.5"><b>Kargom is an independent price comparison site, not a courier.</b> We are not part of, or endorsed by, any courier. Tracking opens on the courier's own website. We never ask you to pay a fee to release, redeliver or track a parcel: if a text or email asks you to, it is a scam. Forward scam texts to 7726.</p></div>`;
  return `<div class="in wrap"><p style="margin:14px 0 0;padding:12px 16px;border-radius:12px;background:#FFF8E6;border:1px solid #F5D48A;color:#5C4300;font-size:14px;line-height:1.5"><b>Kargom is an independent price comparison site, not ${esc(name)}.</b> We are not part of, or endorsed by, ${esc(name)}. Tracking opens on ${esc(name)}'s own website. We never ask you to pay a fee to release, redeliver or track a parcel: if a text or email asks you to, it is a scam. Report it to ${esc(name)} and forward scam texts to 7726.</p></div>`;
}

export function trackPage(c: CarrierInfo) {
  const faq: Faq[] = [
    { q: `What does a ${c.name} tracking number look like?`, a: c.track.format },
    { q: `Where do I find my ${c.name} tracking number?`, a: c.track.where },
    { q: `My ${c.name} tracking has not updated. What should I do?`, a: 'Tracking can go quiet for a day while a parcel moves between depots, especially over weekends and bank holidays. If it has not changed for three working days, contact whoever sent it: the sender is the courier\'s customer and can open an enquiry.' },
  ];
  return page({
    title: `${c.name} Tracking Guide: How to Track a ${c.name} Parcel | Kargom`, path: `/track/${c.slug}`,
    description: `Track ${an(c.name)} parcel. ${c.track.format} What each ${c.name} tracking status means and what to do if it stops updating.`,
    crumbs: [['Track a parcel', '/track'], [`${c.name} tracking`, `/track/${c.slug}`]], ld: [faqLd(faq)],
    body: `${hero(`${esc(c.name)} tracking guide`, `Enter your ${esc(c.name)} tracking number and we will open ${esc(c.name)}'s own tracking page for it.${c.track.deep ? '' : ' We copy the number for you so you can paste it.'}`, trackForm(c))}
${notCourier(c.name)}
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

const GUIDE_SECTIONS: Array<[NonNullable<Guide['cat']>, string, string]> = [
  ['freight', 'Importing, freight and Amazon FBA', 'Shipping stock from China and beyond, customs, VAT and Amazon fulfilment centres.'],
  ['moving', 'Moving home and office', 'What removals cost and how to plan a move.'],
  ['parcels', 'Sending parcels', 'Prices, packaging, customs and the cheapest way to send.'],
];
const catOf = (g: Guide) => g.cat ?? 'parcels';
const guideCard = (o: Guide) => `<a class="card" href="/guides/${o.slug}"><b>${esc(o.h1)}</b><span>${esc(o.description)}</span></a>`;

export function guidesHub() {
  return page({
    title: 'Shipping, Freight and Moving Guides | Kargom', path: '/guides',
    description: 'Practical guides to sending parcels, importing from China, shipping to Amazon FBA in the UK, USA and EU, freight costs and moving home or office.',
    crumbs: [['Guides', '/guides']],
    body: `${hero('Guides', 'Short, practical answers for people sending parcels, importing stock and moving home or office.')}
<div class="in wrap">${GUIDE_SECTIONS.map(([cat, h, lead]) => `<section class="sec"><h2>${esc(h)}</h2><p class="lead2">${esc(lead)}</p><div class="cards">${GUIDES.filter((g) => catOf(g) === cat).map(guideCard).join('')}${cat === 'parcels' ? '<a class="card" href="/tools/volumetric-weight-calculator"><b>Volumetric weight calculator</b><span>Work out whether your parcel will be charged by size or by weight.</span></a>' : ''}</div></section>`).join('')}</div>`,
  });
}

/** This week's container market box for the freight guides (nothing when no week is entered). */
function marketBox(prices: SeoPrices) {
  const m = prices.market;
  const lane = m?.lanes.find((l) => l.key === 'shaRtm');
  if (!m || !lane) return '';
  const others = m.lanes.filter((l) => ['shaGoa', 'shaLax', 'shaNyc'].includes(l.key));
  const chg = (p: number | null) => (p === null ? '' : `<span class="wci-c ${p > 0 ? 'up' : p < 0 ? 'down' : ''}">${p > 0 ? '▲' : p < 0 ? '▼' : '•'} ${Math.abs(p)}% on last week</span>`);
  const week = new Date(`${m.week}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `<div class="wci"><span class="wci-k">Container market this week · ${esc(week)}</span>
<div class="wci-main"><span><b>China → UK / North Europe</b><small>One 40 ft container, port to port, Shanghai → Rotterdam benchmark</small></span><span class="wci-p"><b>$${lane.usd.toLocaleString('en-GB')}</b>${chg(lane.changePct)}</span></div>
${others.length ? `<div class="wci-o">${others.map((l) => `<span>${esc(l.label)} <b>$${l.usd.toLocaleString('en-GB')}</b></span>`).join('')}</div>` : ''}
<p class="note">Spot price in US dollars from the Drewry World Container Index. <a href="/freight?from=China&amp;to=United%20Kingdom&amp;load=container&amp;box=container40&amp;qty=1">Turn it into a door-to-door estimate</a>.</p></div>`;
}

/** Sidebar: a freight search for importers, a removals search for movers, a parcel quote otherwise. */
function guideAside(g: Guide) {
  if (catOf(g) === 'freight') {
    const from = ['China', 'United Kingdom', 'Turkey', 'India', 'Vietnam', 'United States', 'Germany'];
    const to = ['United Kingdom', 'United States', 'Germany', 'France', 'Ireland'];
    const def = g.slug.includes('usa') ? ['United Kingdom', 'United States'] : g.slug.includes('europe') ? ['United Kingdom', 'Germany'] : ['China', 'United Kingdom'];
    return `<form class="qf" action="/freight" method="get"><b class="qf-t">Compare freight rates</b>
<label>From<select name="from">${from.map((c) => `<option${c === def[0] ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
<label>To<select name="to">${to.map((c) => `<option${c === def[1] ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
<label>Shipping<select name="load"><option value="container">Container</option><option value="pallets">Pallets</option><option value="boxes">Boxes</option></select></label>
<button type="submit">See freight rates</button></form>`;
  }
  if (catOf(g) === 'moving') {
    return `<form class="qf" action="/movers" method="get"><b class="qf-t">Find removal companies</b>
<label>Moving from (postcode)<input name="from" required placeholder="e.g. M1 1AE" autocomplete="postal-code"></label>
<label>Moving to (postcode)<input name="to" placeholder="e.g. LS1 4AP"></label>
<label>Home size<select name="size"><option value="studio">Studio flat</option><option value="1">1 bedroom</option><option value="2" selected>2 bedrooms</option><option value="3">3 bedrooms</option><option value="4">4 bedrooms</option><option value="5">5+ bedrooms</option></select></label>
<button type="submit">Find movers</button></form>`;
  }
  return quoteForm({ title: 'Get a live price' });
}

export function guidePage(g: Guide, prices: SeoPrices) {
  const body = g.body.replace(/<table class="tbl">([\s\S]*?)<\/table>/g, '<div class="tblwrap"><table class="tbl">$1</table></div>')
    .replace('{{UK_PRICES}}', ukCheapestTable(prices)).replace('{{WCI}}', marketBox(prices));
  const related = [...GUIDES.filter((o) => o.slug !== g.slug && catOf(o) === catOf(g)), ...GUIDES.filter((o) => catOf(o) !== catOf(g))].slice(0, 3);
  const faq = g.faq ?? [];
  const sources = g.sources ?? [];
  return page({
    title: `${g.title} | Kargom`, description: g.description, path: `/guides/${g.slug}`, ogType: 'article',
    crumbs: [['Guides', '/guides'], [g.title.replace(/\s*\(.*\)$/, ''), `/guides/${g.slug}`]],
    ld: [{ '@context': 'https://schema.org', '@type': 'Article', headline: g.h1, description: g.description, dateModified: g.updated, datePublished: g.updated, author: { '@type': 'Organization', name: 'Kargom', url: `${base()}/` }, publisher: ORG(), mainEntityOfPage: `${base()}/guides/${g.slug}`, image: `${base()}/assets/og.jpg` },
      ...(faq.length ? [faqLd(faq)] : [])],
    body: `<article class="in wrap art">
<header class="art-h"><h1>${esc(g.h1)}</h1><p class="meta">Updated ${new Date(g.updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · ${g.minutes} min read</p></header>
<div class="art-cols"><div class="prose">${body}${sources.length ? `<h2>Sources</h2><ul class="src">${sources.map(([t, u]) => `<li><a href="${esc(u)}" rel="noopener" target="_blank">${esc(t)}</a></li>`).join('')}</ul>` : ''}</div><aside>${guideAside(g)}</aside></div>
${faqBlock(faq)}
<section class="sec"><h2>Related guides</h2><div class="cards">${related.map(guideCard).join('')}</div></section>
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

/** Who we are, from Render settings, so the legal pages never carry made-up details. */
function company() {
  const admins = (process.env.ADMIN_EMAILS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return {
    name: process.env.COMPANY_LEGAL_NAME || 'CURACAVI LTD',
    number: process.env.COMPANY_NUMBER || '17412069',
    address: process.env.COMPANY_ADDRESS || '',
    email: process.env.PRIVACY_EMAIL || admins[0] || '',
  };
}

export function aboutPage() {
  const c = company();
  const body = `
<p><b>Kargom.co.uk</b> is the UK website of Kargom, an online courier company. Through Kargom.com we have helped customers in Turkey send parcels for about six years. Kargom.co.uk brings the same service to the UK. Kargom.co.uk is a trading name of ${esc(c.name)}, a company registered in England and Wales.</p>
<h2>What we do</h2>
<ul>
<li><b>Parcels:</b> compare prices from UK and international couriers, book online, pay and print your own label.</li>
<li><b>Freight:</b> estimates for air, sea and road freight, and requests that freight forwarders can price.</li>
<li><b>Removals:</b> post a move and get prices from removal companies.</li>
</ul>
<h2>How we work</h2>
<ul>
<li>We are an <b>independent</b> comparison and booking service. We are not Royal Mail, Evri, DPD, InPost, Yodel, Parcelforce, UPS, DHL or FedEx, and we are not endorsed by them. We book their services for you at the prices shown.</li>
<li>Card payments are taken by <b>Stripe</b> on its own secure form. We never see or store your card details.</li>
<li>We never send texts or emails asking you to pay to release, redeliver or track a parcel. If you get one, it is a scam: forward texts to 7726.</li>
</ul>
<h2>Company details</h2>
<p>${esc(c.name)}${c.number ? `<br>Registered in England and Wales, company number ${esc(c.number)}` : ''}${c.address ? `<br>${esc(c.address)}` : ''}${c.email ? `<br>Email: <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''}</p>
<p>Signed-in customers can also contact us from the Help page in their account. Read our <a href="/terms">terms and conditions</a>, <a href="/privacy">privacy policy</a> and <a href="/cookies">cookie policy</a>.</p>`;
  return page({
    title: 'About Kargom | Online Courier Company', description: 'Who runs Kargom.co.uk, what we do and how we work: an independent courier comparison and booking service with payments by Stripe.', path: '/about',
    crumbs: [['About us', '/about']],
    body: `<article class="in wrap art"><header class="art-h"><h1>About Kargom</h1></header><div class="prose" style="max-width:760px">${body}</div></article>`,
  });
}


/** A plain legal page: title, date, prose. */
function legalPage(o: { title: string; h1: string; description: string; path: string; updated: string; body: string }) {
  return page({
    title: o.title, description: o.description, path: o.path, crumbs: [[o.h1, o.path]],
    body: `<article class="in wrap art">
<header class="art-h"><h1>${esc(o.h1)}</h1><p class="meta">Last updated ${new Date(o.updated + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p></header>
<div class="prose" style="max-width:760px">${o.body}</div>
</article>`,
  });
}

export function termsPage() {
  const c = company();
  const mail = c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : 'the Help page in your account';
  const body = `
<p>These terms apply when you use Kargom.co.uk to compare and book parcel delivery, or to request moving or freight quotes. Please read them before you book. By booking or creating an account you agree to them.</p>

<h2>1. Who we are</h2>
<p>Kargom.co.uk is a trading name of ${esc(c.name)}, a company registered in England and Wales${c.number ? ` (company number ${esc(c.number)})` : ''}${c.address ? `, registered office ${esc(c.address)}` : ''}. In these terms "Kargom", "we" and "us" mean ${esc(c.name)}. You can contact us at ${mail}.</p>

<h2>2. What we do</h2>
<p>We compare delivery services from couriers and book the one you choose on your behalf. <b>We are not the courier.</b> The courier collects, carries and delivers your parcel under its own terms of carriage, which form part of your booking and which you can read on the courier's website. Where these terms and the courier's terms differ about the carriage of your parcel, the courier's terms apply to the carriage.</p>
<p>For removals and freight, we pass your request to independent companies and show you their offers. If you accept an offer, your contract for the move or the shipment is with that company, not with us.</p>

<h2>3. Your account</h2>
<p>You must be 18 or over to book. Keep your login details safe; you are responsible for bookings made from your account. Tell us straight away if you think someone else has used it.</p>

<h2>4. Prices and payment</h2>
<ul>
<li>Prices are shown in pounds sterling and include VAT where it applies.</li>
<li>The price is based on the weight, size, collection and delivery addresses and service you give us. Weight is the greater of the actual weight and the volumetric weight the courier uses.</li>
<li>Card payments are processed by Stripe. We do not see or store your full card details. You can also pay from your Kargom wallet.</li>
<li>Duties, import VAT and fees charged by customs abroad are not included and are payable by you or your recipient.</li>
</ul>

<h2>5. Your responsibilities</h2>
<ul>
<li>Give an accurate weight, size, description and value, and full, correct addresses and phone numbers.</li>
<li>Pack each parcel so it can survive normal handling, including being stacked, dropped from a short height and moved on conveyors. Use a strong box and enough padding; parcels that are not suitably packed may not be covered for loss or damage.</li>
<li>Attach the correct label for each parcel and remove old labels.</li>
<li>Do not send prohibited items (see section 6), and complete customs information truthfully for parcels leaving the UK.</li>
</ul>

<h2>6. Prohibited and restricted items</h2>
<p>You must not send anything illegal or dangerous, including: weapons, ammunition and replicas; explosives and fireworks; flammable liquids, gases and aerosols; corrosive, toxic or radioactive substances; loose lithium batteries; drugs and controlled substances; cash, bank cards and negotiable items; live animals; human or animal remains; perishable food without suitable service; and counterfeit goods. Couriers have their own lists of prohibited and restricted items, which also apply. If you send a prohibited item, the courier may refuse, return or destroy it, you will not be covered for loss or damage, and you are responsible for any costs or fines that result.</p>

<h2>7. If the courier re-weighs or re-measures your parcel</h2>
<p>Couriers check parcels in their network. If the courier finds a parcel heavier or larger than you declared and the price for its actual size or weight is higher, we will charge you the difference: from your wallet, or to the card you paid with. If the price band does not change, there is no extra charge. We will show you the courier's measurements, and you can dispute a charge by contacting us within 14 days. While an adjustment is unpaid we may pause new bookings on your account.</p>

<h2>8. Cancellations and refunds</h2>
<ul>
<li>You can cancel a label you have not used from your account before the courier collects or scans the parcel. We refund it to your wallet once the courier confirms the label is void.</li>
<li>Under the Consumer Contracts Regulations you normally have 14 days to cancel a service bought online. Because a delivery booking starts as soon as you print the label or the courier collects, you agree that the service starts straight away, and you lose the right to cancel once the parcel has been collected or handed in.</li>
<li>You can ask for your wallet balance to be refunded to you at any time; we refund it within 14 days.</li>
</ul>

<h2>9. Delivery times</h2>
<p>Delivery times shown are the courier's estimates, not guarantees, unless the service is sold as guaranteed. Delays can happen because of weather, strikes, customs checks, incorrect addresses or other events outside our and the courier's control. If a guaranteed service is late and the courier refunds it, we pass that refund to you.</p>

<h2>10. Loss and damage</h2>
<ul>
<li>Each service includes the courier's standard cover for loss or damage, up to the amount shown when you book. Where we offer extra cover, you can buy it when you book. Cover never exceeds the value of the goods (cost price for business sellers) and is subject to the courier's terms.</li>
<li>Some items are not covered by most couriers, such as glass, ceramics, liquids, jewellery, precious metals, antiques, artwork, electrical items without original packaging, and anything that was not suitably packed.</li>
<li>Report damage within 7 days of delivery and loss within 28 days of the expected delivery date, keeping the packaging and damaged item. We make the claim to the courier for you and pay you what the courier pays.</li>
</ul>

<h2>11. Our liability to you</h2>
<p>We are responsible for the services we provide with reasonable care and skill. We are not responsible for losses that were not foreseeable, for business losses (such as lost profit or lost sales), or for the courier's acts or omissions beyond what we can recover from the courier for you. Our total liability for any booking is limited to the price you paid for it plus any compensation we recover from the courier. Nothing in these terms limits liability for death or personal injury caused by negligence, for fraud, or for anything else that cannot be limited by law, and nothing affects your statutory rights as a consumer.</p>

<h2>12. Moving and freight requests</h2>
<p>Estimates on Kargom are guides based on market data, not offers. Companies on Kargom set their own prices and terms. We check that partner companies give us their business details, but we do not guarantee their work. We share your contact details only with the company whose offer you accept.</p>

<h2>13. Using the site</h2>
<p>Do not misuse the site: no automated scraping, no attempts to break its security, and no false or fraudulent bookings. We may suspend accounts that break these terms or that we reasonably suspect of fraud.</p>

<h2>14. Complaints</h2>
<p>If something goes wrong, contact us at ${mail} with your booking reference. We aim to reply within 2 working days and to resolve complaints within 14 days. If you are not happy with our answer, you can also take your complaint to the courier's own complaints process.</p>

<h2>15. Changes and law</h2>
<p>We may update these terms; the version shown when you book applies to that booking. These terms are governed by the law of England and Wales. If you are a consumer living in Scotland or Northern Ireland, you can also bring proceedings in your local courts.</p>`;
  return legalPage({ title: 'Terms and Conditions | Kargom', h1: 'Terms and conditions', description: 'The terms for comparing and booking parcel delivery, removals and freight quotes on Kargom.co.uk.', path: '/terms', updated: '2026-10-30', body });
}

export function cookiesPage() {
  const c = company();
  const mail = c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : 'the Help page in your account';
  const row = (name: string, who: string, why: string, how: string) => `<tr><td><b>${name}</b></td><td>${who}</td><td>${why}</td><td>${how}</td></tr>`;
  const body = `
<p>This policy explains the cookies and similar storage used on Kargom.co.uk, which is run by ${esc(c.name)}.</p>

<h2>Our approach</h2>
<p>Most of our cookies are strictly necessary for the site to work, such as keeping you signed in and taking payments securely. UK law (the Privacy and Electronic Communications Regulations) allows these without consent. We also use <b>Google Ads cookies</b> to see which of our ads bring visitors. These cookies are set <b>only if you click Accept</b> on our cookie banner. Our pages load Google's tag in "consent mode": until you accept, it writes no cookies and stores nothing on your device, and only sends Google basic, cookieless signals (such as that a page was viewed).</p>

<h2>Cookies we use</h2>
<div class="tblwrap"><table class="tbl"><thead><tr><th>Name</th><th>Set by</th><th>Purpose</th><th>How long</th></tr></thead><tbody>
${row('kg_session', 'Kargom', 'Keeps you signed in to your account', '30 days, or until you sign out')}
${row('kg_gstate', 'Kargom', 'Protects "Sign in with Google" from forged requests', '10 minutes')}
${row('__stripe_mid, __stripe_sid', 'Stripe', 'Fraud prevention when you pay by card', 'Up to 1 year and 30 minutes')}
${row('_gcl_au, _gcl_aw, IDE, test_cookie', 'Google (only if you accept)', 'Measuring which of our Google ads led to a visit or a booking', 'Up to 13 months')}
</tbody></table></div>

<h2>Storage on your device</h2>
<p>Our pages also keep some information in your browser's local or session storage, for example a booking you have not finished, your saved parcel sizes, or the booking chat. This stays on your device, is used only to make the site work for you, and can be cleared in your browser settings.</p>

<h2>Other services on our pages</h2>
<ul>
<li><b>Videos</b> are played from YouTube's privacy-enhanced mode (youtube-nocookie.com), which does not set cookies until you play a video.</li>
<li><b>Maps</b> on request pages use OpenStreetMap or Google Maps, which receive your IP address to load the map.</li>
<li><b>Fonts</b> are loaded from Google Fonts, which receives your IP address but sets no cookies.</li>
</ul>

<h2>Managing cookies</h2>
<p>You can change your choice at any time: <a href="/cookies" data-cookie-settings>open cookie settings</a>. You can also block or delete cookies in your browser settings. If you block the necessary cookies, you will not be able to sign in or pay.</p>

<h2>Contact</h2>
<p>Questions about cookies: ${mail}. See also our <a href="/privacy">privacy policy</a>.</p>`;
  return legalPage({ title: 'Cookie Policy | Kargom', h1: 'Cookie policy', description: 'The cookies Kargom.co.uk uses: only what is strictly necessary to sign in and pay. No advertising or tracking cookies.', path: '/cookies', updated: '2026-10-30', body });
}

export const PRIVACY_UPDATED = '2026-10-30';
export function privacyPage() {
  const c = company();
  const who = `${esc(c.name)}, trading as Kargom${c.number ? `, a company registered in England and Wales (company number ${esc(c.number)})` : ''}${c.address ? `, registered office ${esc(c.address)}` : ''}`;
  const mail = c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : 'the Help page in your account';
  const body = `
<p>This notice explains what personal information Kargom.co.uk collects, why, who we share it with and your rights. The site is run by ${who} ("Kargom", "we"). We are the controller of your personal data under UK data protection law (UK GDPR and the Data Protection Act 2018). Questions or requests: ${mail}.</p>

<h2>What we collect</h2>
<ul>
<li><b>Account details:</b> your name, email address, phone number, company name if you give one, and your password (stored only as a secure hash). If you sign in with Google, we receive your name and verified email address from Google. We do not receive your Google password.</li>
<li><b>Shipping details:</b> sender and recipient names, addresses, phone numbers and emails, parcel sizes, weights, contents and values, and customs details for shipments abroad.</li>
<li><b>Moving and freight requests:</b> the addresses, dates, goods, photos and notes you add to a request.</li>
<li><b>Payments:</b> card payments are taken by Stripe. Your card number goes to Stripe, never to us. We keep a record of what you paid and your wallet balance.</li>
<li><b>Photos and pasted text you ask us to read an address from</b>, and messages you write to our booking chat assistant.</li>
<li><b>Your location, only if you press "Use my location"</b> and allow it in your browser. We use it once to find the nearest postcode and do not store it.</li>
<li><b>Technical data:</b> your IP address and browser details in our server logs, kept for security and to stop abuse.</li>
</ul>

<h2>Why we use it (and our legal basis)</h2>
<ul>
<li>To give you prices, book your shipments, print labels, track parcels and send your requests to removal and freight companies: <b>to perform our contract with you</b>.</li>
<li>To take payment, keep accounts and meet tax and accounting rules: <b>contract and legal obligation</b>.</li>
<li>To keep the site secure, prevent fraud and improve our service: <b>legitimate interests</b>.</li>
<li>To send you service emails about your bookings and requests: <b>contract</b>. We send marketing emails only if you agree, and you can stop them at any time.</li>
</ul>

<h2>Who we share it with</h2>
<p>We share only what each one needs to do its job:</p>
<ul>
<li><b>Couriers and shipping platforms</b> (for example Royal Mail, Evri, DPD, InPost, UPS, DHL, FedEx, and booking platforms such as ShipStation, Packlink, Eurosender and Cargoboard): the shipment and address details needed to collect and deliver.</li>
<li><b>Removal and freight companies on Kargom:</b> the details of your request. Your phone number and exact address are shared only with the company whose offer you accept.</li>
<li><b>Stripe</b> for payments; <b>Google</b> for sign-in, maps, address and company search, and reading text from photos; <b>Anthropic</b> to run the address reading and booking chat assistant; <b>postcodes.io</b> and our address lookup provider for postcode searches; our email provider to send emails; and <b>Render</b>, which hosts the site.</li>
<li>Customs authorities and couriers abroad when you send a parcel outside the UK, and authorities where the law requires it.</li>
</ul>
<p>We never sell your personal data.</p>

<h2>International transfers</h2>
<p>Some of these providers process data outside the UK, for example in the USA or the EU, and a shipment abroad goes to the destination country. Where data leaves the UK we rely on UK adequacy regulations or the UK International Data Transfer Agreement or Addendum, as the law requires.</p>

<h2>How long we keep it</h2>
<ul>
<li>Bookings, payments and invoices: 6 years, as UK tax law requires.</li>
<li>Your account: until you ask us to close it, then removed except what we must keep by law.</li>
<li>Moving and freight requests: up to 2 years after the move date.</li>
<li>Photos and text read for addresses and chat messages: not kept after the answer is returned, except what you save to a booking.</li>
<li>Server logs: up to 90 days.</li>
</ul>

<h2>Cookies</h2>
<p>We use cookies that are strictly necessary to run the site. With your consent only, we also use Google Ads cookies to measure which of our ads bring visitors; Google then processes your IP address and browsing data on this site for that purpose. Full details are in our <a href="/cookies">cookie policy</a>.</p>

<h2>Your rights</h2>
<p>You can ask to see the personal data we hold about you, correct it, delete it, restrict or object to how we use it, or receive a copy to take elsewhere. Contact ${mail}. We reply within one month. If you are unhappy with how we handle your data, you can complain to the Information Commissioner's Office (ico.org.uk, 0303 123 1113).</p>

<h2>Changes</h2>
<p>We update this notice when our service changes. The date at the top shows the latest version.</p>`;
  return page({
    title: 'Privacy Policy | Kargom', description: 'How Kargom.co.uk collects, uses and protects your personal data, who we share it with and your rights.', path: '/privacy',
    crumbs: [['Privacy policy', '/privacy']],
    body: `<article class="in wrap art">
<header class="art-h"><h1>Privacy policy</h1><p class="meta">Last updated ${new Date(PRIVACY_UPDATED + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p></header>
<div class="prose" style="max-width:760px">${body}</div>
</article>`,
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
    ['/', uk, '1.0'], ['/parcel-prices', uk, '0.9'], ['/about', null, '0.4'], ['/terms', null, '0.2'], ['/privacy', null, '0.2'], ['/cookies', null, '0.2'], ['/partner', null, '0.5'], ['/freight', null, '0.8'], ['/forwarding', null, '0.7'], ['/couriers', uk, '0.8'], ['/track', null, '0.8'], ['/send-parcel-to', null, '0.7'], ['/guides', null, '0.6'],
    ['/tools/volumetric-weight-calculator', '2026-10-28T00:00:00Z', '0.6'],
    ...CARRIERS.map((c) => [`/couriers/${c.slug}`, uk, '0.8'] as [string, string | null, string]),
    ...(trackPagesOn() ? CARRIERS.map((c) => [`/track/${c.slug}`, '2026-10-28T00:00:00Z', '0.7'] as [string, string | null, string]) : []),
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
