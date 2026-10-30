import { api, esc, gbp, toast, wrapLabels, UK_PC, stars, logoHtml } from '../market-ui.js';
import { OPTIONS, SEP, place, isUk } from '../countries.js';
import { AMAZON, TIKTOK } from '../warehouses.js';
import { portsFor, portByCode } from '../ports.js';

/**
 * Compare freight rates: air, sea (LCL / FCL) and road price ranges for stock moving between
 * countries, e.g. a TikTok or Amazon seller bringing goods from China into an FBA warehouse.
 * Estimates are our own, from published market indices (Drewry WCI, Freightos Air Index) plus typical charges.
 * Kept short on purpose: where from, where to, what and how heavy.
 */

const root = document.getElementById('root');
const qs = new URLSearchParams(location.search);
const pick = (v, list, d) => (list.includes(v) ? v : d);
const S = {
  from: place(qs.get('from')) ? qs.get('from') : 'China', fromCity: '',
  to: place(qs.get('to')) ? qs.get('to') : 'United Kingdom', toPlace: qs.get('toPlace') || '',
  // where the goods start and end: a door (factory, business, home, warehouse, fulfilment centre) or a port / airport
  origin: pick(qs.get('origin'), ['factory', 'port', 'business', 'home'], 'factory'),
  dest: pick(qs.get('dest'), ['port', 'warehouse', 'fc', 'business', 'home'], { amazon: 'fc', tiktok: 'fc', home: 'home' }[qs.get('toType')] || 'business'),
  fromPort: qs.get('fromPort') || '', toPort: qs.get('toPort') || '',
  fc: (() => { const v = qs.get('fc') || ''; return !v || /^[AT]:/.test(v) ? v : `${qs.get('toType') === 'tiktok' ? 'T' : 'A'}:${v}`; })(),
  load: pick(qs.get('load'), ['boxes', 'pallets', 'container'], 'container'), box: pick(qs.get('box'), ['container20', 'container40', 'container40HC'], 'container40'),
  qty: qs.get('qty') || '1', kg: qs.get('kg') || '', l: qs.get('l') || '', w: qs.get('w') || '', h: qs.get('h') || '',
  busy: false, res: null, err: '', me: null, fwd: null, best: null, sort: 'rec', fopen: '',
};

const IC = {
  plane: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>',
  ship: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M19.4 17.4 21 12H3l1.6 5.4"/><path d="M12 12V3l7 6"/></svg>',
  truck: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>',
  box: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
};
const FX = {
  out: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13v5a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h5"/><path d="M15 3h6v6M10 14L21 3"/></svg>',
  in: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 15v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3"/></svg>',
  factory: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21V10l5 3V10l5 3V10l5 3V5h3v16z"/><path d="M7 17h2M12 17h2M17 17h1"/></svg>',
  building: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10.5 21v-3h3v3"/></svg>',
  home: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>',
  anchor: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="2.5"/><path d="M12 7.5V21M5 12H2a10 10 0 0 0 20 0h-3"/></svg>',
  pin: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  pallet: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="12" rx="1"/><path d="M4 9h16M2 15h20M3 15v5M12 15v5M21 15v5M2 20h20"/></svg>',
  cont: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="13" rx="1.5"/><path d="M6 9v7M10 9v7M14 9v7M18 9v7"/></svg>',
  hash: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 9h15M4 15h15M10 3 8 21M16 3l-2 18"/></svg>',
  chev: '<svg class="fx-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  arrow: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};
/** The "O" from our logo (ring with the arrow). `white` for use on a blue button. */
const goIcon = (white = false) => `<svg class="go-ic" width="20" height="20" viewBox="0 0 512 512" aria-hidden="true">${white ? '' : '<defs><linearGradient id="goG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1D4ED8"/><stop offset="1" stop-color="#38BDF8"/></linearGradient></defs>'}<circle cx="256" cy="256" r="170" fill="none" stroke="${white ? '#FFFFFF' : 'url(#goG)'}" stroke-width="64"/><path d="M352 160 L176 236 L250 262 L276 336 Z" fill="${white ? '#FFFFFF' : 'url(#goG)'}" stroke="${white ? '#FFFFFF' : 'url(#goG)'}" stroke-width="12" stroke-linejoin="round"/></svg>`;
const FLAGS = ['gb', 'us', 'de', 'fr', 'ie', 'cn', 'tr'];
/** Flag for a country: our own picture for the common ones, the phone's flag emoji for the rest. */
function flagHtml(name) {
  const c = (place(name)?.code || '').toLowerCase();
  if (FLAGS.includes(c)) return `<img class="fx-flag" src="/assets/flags/${c}.svg" alt="">`;
  if (!/^[a-z]{2}$/.test(c)) return FX.pin;
  return `<span class="fx-emoji" aria-hidden="true">${String.fromCodePoint(...[...c.toUpperCase()].map((ch) => 0x1F1E6 + ch.charCodeAt(0) - 65))}</span>`;
}
/** An input or select with an icon on the left (and an arrow for selects). */
const fx = (icon, control) => `<span class="fx">${icon}${control}${control.startsWith('<select') ? FX.chev : ''}</span>`;
const PLACE_IC = { factory: FX.factory, port: FX.anchor, business: FX.building, home: FX.home, warehouse: FX.factory, fc: FX.building };
const secHead = (icon, title, sub) => `<div class="fx-h"><span class="fx-hi">${icon}</span><span><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span></div>`;

const MODE_IC = { air: IC.plane, express: IC.box, LCL: IC.ship, FCL: IC.ship, LTL: IC.truck, FTL: IC.truck };
const MODE_TIP = {
  express: 'Door to door with DHL, UPS or FedEx. Best for small, urgent shipments.',
  air: 'Airport to airport plus collection and delivery. Good for stock you need within two weeks.',
  LCL: 'Your boxes or pallets share a container. The cheapest way for a few cubic metres.',
  FCL: 'A whole container just for you. Best value from about 13 m³.',
  LTL: 'Your pallets share a lorry with other loads.',
  FTL: 'A whole lorry just for your goods.',
};
const QUOTE_LOAD = { air: 'air', express: 'air', LCL: 'sea', FCL: 'sea', LTL: 'ltl', FTL: 'ftl' };

const countrySel = (k, v) => `<select class="inp" data-k="${k}" aria-label="${k === 'from' ? 'Shipping from' : 'Shipping to'}">${OPTIONS.map((o) => (o === SEP ? `<option disabled>${SEP}</option>` : `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`)).join('')}</select>`;
const code = (name) => place(name)?.code || 'GB';
const chip = (k, v, label, on) => `<button type="button" class="chip" data-set="${k}" data-v="${v}" aria-pressed="${on}">${label}</button>`;

/** Amazon and TikTok Shop fulfilment centres in the destination country. */
function warehouses() {
  const c = code(S.to);
  return [...(AMAZON[c] || []).map(([fc, town, pc]) => ({ v: `A:${fc}`, t: `${fc} · ${town}`, town, pc, group: 'Amazon FBA' })),
    ...(TIKTOK[c] || []).map(([town, pc]) => ({ v: `T:${town}`, t: town, town, pc, group: 'TikTok Shop' }))];
}
/** 'amazon' | 'tiktok' | 'home' | 'business', for the texts sent to forwarders. */
const toKind = () => (S.dest === 'fc' ? (S.fc.startsWith('T:') ? 'tiktok' : 'amazon') : S.dest === 'home' ? 'home' : 'business');
const countryName = (name) => (isUk(name) ? 'United Kingdom' : place(name).n);

function originPlace() {
  const p = place(S.from);
  const port = S.origin === 'port' ? portByCode(p.code, S.fromPort) : null;
  return port ? { text: `${port[1]}, ${countryName(S.from)}`, town: port[1].replace(/ \(.*\)$/, ''), pc: '', port } : { text: `${p.city}, ${countryName(S.from)}`, town: '', pc: '' };
}
function destination() {
  const p = place(S.to);
  if (S.dest === 'fc') {
    const w = warehouses().find((x) => x.v === S.fc);
    if (w) return { text: `${w.town} ${w.pc}, ${countryName(S.to)}`, pc: w.pc, town: w.town.replace(/,.*$| \(.*\)$/, '') };
  }
  if (S.dest === 'port') {
    const port = portByCode(p.code, S.toPort);
    if (port) return { text: `${port[1]}, ${countryName(S.to)}`, pc: '', town: port[1].replace(/ \(.*\)$/, ''), port };
  }
  const t = S.toPlace.trim();
  return { text: `${t || p.city}, ${countryName(S.to)}`, pc: t };
}

function totals() {
  const n = Math.max(1, Number(S.qty) || 1), kg = Number(S.kg) || 0;
  const m3 = (Number(S.l) * Number(S.w) * Number(S.h)) / 1e6 * n;
  return [kg ? `${(kg * n).toLocaleString('en-GB')} kg in total` : '', m3 > 0 ? `${m3.toFixed(m3 < 10 ? 2 : 1)} m³` : ''].filter(Boolean).join(' · ');
}

function formHtml() {
  const opt = (v, label, on) => `<option value="${v}" ${on ? 'selected' : ''}>${label}</option>`;
  const portSel = (k, country, val) => {
    const list = portsFor(country);
    if (!list.length) return '';
    const grp = (kind, label) => { const l = list.filter((x) => x[2] === kind); return l.length ? `<optgroup label="${label}">${l.map(([c, n]) => opt(c, `${esc(n)} (${c})`, c === val)).join('')}</optgroup>` : ''; };
    return `<label class="fld">Port or airport${fx(FX.anchor, `<select class="inp" data-k="${k}"><option value="">Choose…</option>${grp('sea', 'Sea ports')}${grp('air', 'Airports')}</select>`)}</label>`;
  };
  const wh = warehouses();
  const destField = S.dest === 'port' ? portSel('toPort', code(S.to), S.toPort)
    : S.dest === 'fc' ? (wh.length
      ? `<label class="fld">Fulfilment centre <i>*</i>${fx(FX.building, `<select class="inp" data-k="fc"><option value="">Choose…</option>${['Amazon FBA', 'TikTok Shop'].map((g) => { const l = wh.filter((w) => w.group === g); return l.length ? `<optgroup label="${g}">${l.map((w) => opt(esc(w.v), esc(w.t), w.v === S.fc)).join('')}</optgroup>` : ''; }).join('')}</select>`)}</label>`
      : `<label class="fld">Fulfilment centre postcode <em>(optional)</em>${fx(FX.pin, `<input class="inp" data-k="toPlace" value="${esc(S.toPlace)}" placeholder="From your shipping plan">`)}</label>`)
    : `<label class="fld">Postcode <em>(optional)</em>${fx(FX.pin, `<input class="inp" data-k="toPlace" value="${esc(S.toPlace)}" placeholder="e.g. ${isUk(S.to) ? 'M1 1AE' : esc(place(S.to)?.pc || '')}">`)}</label>`;
  const unit = S.load === 'boxes' ? 'boxes' : 'pallets';
  return wrapLabels(`<section class="card fr-form">
    <div class="fr-row">
      <div class="fr-side">${secHead(FX.out, 'From', 'Where are you shipping from?')}
        <label class="fld">Country${fx(flagHtml(S.from), countrySel('from', S.from))}</label>
        <label class="fld">Origin${fx(PLACE_IC[S.origin] || FX.factory, `<select class="inp" data-k="origin">${opt('factory', 'Factory / warehouse', S.origin === 'factory')}${opt('port', 'Port / airport', S.origin === 'port')}${opt('business', 'Business address', S.origin === 'business')}${opt('home', 'Residential address', S.origin === 'home')}</select>`)}</label>
        ${S.origin === 'port' ? portSel('fromPort', place(S.from).code, S.fromPort) : ''}
      </div>
      <div class="fr-side">${secHead(FX.in, 'To', 'Where are you shipping to?')}
        <label class="fld">Country${fx(flagHtml(S.to), countrySel('to', S.to))}</label>
        <label class="fld">Destination${fx(PLACE_IC[S.dest] || FX.building, `<select class="inp" data-k="dest">${opt('port', 'Port / airport', S.dest === 'port')}${opt('warehouse', 'Warehouse', S.dest === 'warehouse')}${opt('fc', 'Fulfilment centre (Amazon, TikTok)', S.dest === 'fc')}${opt('business', 'Business address', S.dest === 'business')}${opt('home', 'Residential address', S.dest === 'home')}</select>`)}</label>
        ${destField}
      </div>
    </div>
    <div class="fr-what">${secHead(IC.box, 'What are you shipping?', '')}
      <div class="chips fx-seg">${chip('load', 'boxes', `${IC.box} Boxes`, S.load === 'boxes')}${chip('load', 'pallets', `${FX.pallet} Pallets`, S.load === 'pallets')}${chip('load', 'container', `${IC.ship} Container`, S.load === 'container')}</div>
      ${S.load === 'container' ? `<div class="grid2 fx-g2">
          <label class="fld">Container size${fx(FX.cont, `<select class="inp" data-k="box"><option value="container20" ${S.box === 'container20' ? 'selected' : ''}>20 ft (33 m³)</option><option value="container40" ${S.box === 'container40' ? 'selected' : ''}>40 ft (67 m³)</option><option value="container40HC" ${S.box === 'container40HC' ? 'selected' : ''}>40 ft High Cube (76 m³)</option></select>`)}</label>
          <label class="fld">How many?${fx(FX.hash, `<input class="inp" data-k="qty" inputmode="numeric" value="${esc(S.qty)}">`)}</label></div>`
      : `<div class="fr-dims">
          <label class="fld">How many ${unit}?<input class="inp" data-k="qty" inputmode="numeric" value="${esc(S.qty)}"></label>
          <label class="fld">Weight of one (kg) <i>*</i><input class="inp" data-k="kg" inputmode="decimal" value="${esc(S.kg)}" placeholder="${S.load === 'boxes' ? 'e.g. 15' : 'e.g. 300'}"></label>
          <label class="fld">Length (cm)<input class="inp" data-k="l" inputmode="decimal" value="${esc(S.l)}" placeholder="${S.load === 'boxes' ? '50' : '120'}"></label>
          <label class="fld">Width (cm)<input class="inp" data-k="w" inputmode="decimal" value="${esc(S.w)}" placeholder="${S.load === 'boxes' ? '40' : '100'}"></label>
          <label class="fld">Height (cm)<input class="inp" data-k="h" inputmode="decimal" value="${esc(S.h)}" placeholder="${S.load === 'boxes' ? '40' : '150'}"></label>
        </div><span class="muted fr-tot" id="tot">${esc(totals())}</span>`}
    </div>
    <div class="err" id="fr-err" ${S.err ? '' : 'hidden'}>${esc(S.err)}</div>
    <button type="button" class="btn big fx-go" data-go ${S.busy ? 'disabled' : ''}>${S.busy ? 'Finding rates…' : `Compare freight rates ${FX.arrow}`}</button>
  </section>`);
}

function quoteHref(mode) {
  const p = new URLSearchParams({ type: 'freight', load: QUOTE_LOAD[mode] || 'ltl', fromCountry: code(S.from), toCountry: code(S.to), origin: S.origin, dest: S.dest,
    ...(S.origin === 'port' && S.fromPort && { fromPort: S.fromPort }), ...(S.dest === 'port' && S.toPort && { toPort: S.toPort }), ...(S.dest === 'fc' && S.fc && { fc: S.fc }) });
  if (S.load === 'container') { p.set('unit', S.box); p.set('units', S.qty || '1'); }
  else {
    p.set('unit', S.load); p.set('units', S.qty || '1');
    if (S.kg) p.set('weightKg', String(Math.round(Number(S.kg) * (Number(S.qty) || 1))));
    if (S.load === 'pallets') p.set('pallets', S.qty);
  }
  return `/app/quote?${p}`;
}

/* ---------- this week's container market (Drewry WCI) and real Maersk sailings ---------- */
const niceDay = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
/** The WCI lane that matches the customer's route, named the way they think of it ("China → UK"). */
const ASIA = ['CN', 'HK', 'VN', 'TW', 'KR', 'JP', 'TH', 'MY', 'SG', 'IN', 'BD', 'PK', 'ID', 'PH', 'LK'];
const NEU = ['GB', 'IE', 'NL', 'BE', 'DE', 'FR', 'DK', 'SE', 'NO', 'FI', 'PL', 'LU', 'EE', 'LV', 'LT', 'IS'];
const MED = ['IT', 'ES', 'PT', 'GR', 'TR', 'HR', 'SI', 'MT', 'CY', 'RO', 'BG', 'AL', 'IL', 'EG'];
function routeLanes(fromC, toC) {
  const fromName = fromC === 'CN' ? 'China' : ASIA.includes(fromC) ? place(S.from).n : '';
  const toName = toC === 'GB' ? 'UK' : place(S.to)?.n || '';
  if (ASIA.includes(fromC)) {
    if (toC === 'US') return [['shaLax', `${fromName} → USA West Coast`], ['shaNyc', `${fromName} → USA East Coast`]];
    if (MED.includes(toC)) return [['shaGoa', `${fromName} → ${toName}`]];
    if (NEU.includes(toC) || toC === 'GB') return [['shaRtm', `${fromName} → ${toName}`]];
  }
  if ((NEU.includes(fromC) || MED.includes(fromC)) && ASIA.includes(toC)) return [['rtmSha', `${fromC === 'GB' ? 'UK' : place(S.from).n} → ${toC === 'CN' ? 'China' : place(S.to).n}`]];
  if ((NEU.includes(fromC) || MED.includes(fromC)) && toC === 'US') return [['rtmNyc', `${fromC === 'GB' ? 'UK' : place(S.from).n} → USA`]];
  if (fromC === 'US' && (NEU.includes(toC) || MED.includes(toC))) return [['nycRtm', `USA → ${toName}`]];
  return [];
}
const BENCH = { shaRtm: 'Shanghai → Rotterdam', shaGoa: 'Shanghai → Genoa', shaLax: 'Shanghai → Los Angeles', shaNyc: 'Shanghai → New York', rtmSha: 'Rotterdam → Shanghai', rtmNyc: 'Rotterdam → New York', nycRtm: 'New York → Rotterdam' };
function marketHtml() {
  const m = S.market;
  if (!m || !m.enabled) return '';
  const by = Object.fromEntries(m.lanes.map((l) => [l.key, l]));
  const mine = routeLanes(code(S.from), code(S.to)).filter(([k]) => by[k]);
  const chg = (l, big) => l.changePct === null ? '' : `<span style="white-space:nowrap;font-weight:700;font-size:${big ? 15 : 13}px;color:${l.changePct > 0 ? '#B42318' : l.changePct < 0 ? '#166534' : '#586579'}">${l.changePct > 0 ? '▲' : l.changePct < 0 ? '▼' : '•'} ${Math.abs(l.changePct)}% on last week</span>`;
  const top = mine.map(([k, name]) => { const l = by[k]; return `<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 14px;padding:12px 14px;border-radius:10px;background:#EEF4FF">
      <span><b style="font-size:17px">${esc(name)}</b><span class="muted" style="display:block;font-size:12px">40 ft container, port to port · benchmark ${esc(BENCH[k])}</span></span>
      <span style="display:flex;gap:12px;align-items:baseline"><b style="font-size:22px">$${l.usd.toLocaleString('en-GB')}</b>${chg(l, true)}</span></div>`; }).join('');
  const others = ['shaRtm', 'shaGoa', 'shaLax', 'shaNyc'].filter((k) => by[k] && !mine.some(([x]) => x === k)).map((k) => { const l = by[k];
    return `<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 14px;font-size:14px"><span class="muted">${esc(BENCH[k])}</span><span style="display:flex;gap:10px"><b>$${l.usd.toLocaleString('en-GB')}</b>${chg(l, false).replace(' on last week', '')}</span></div>`; }).join('');
  return `<section class="card fr-market" style="display:flex;flex-direction:column;gap:6px">
    <span style="font-size:12px;font-weight:700;letter-spacing:.04em;color:#2463DB">CONTAINER MARKET THIS WEEK · ${esc(new Date(m.week + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase())}</span>
    ${top || '<b style="font-size:17px">Container spot prices</b>'}
    ${others ? `${top ? '<span class="muted" style="font-size:12px;margin:6px 0 0 14px">Other main routes</span>' : ''}<div style="display:flex;flex-direction:column">${others}</div>` : ''}
    <span class="muted" style="font-size:12px">Spot price in US dollars for one 40 ft container. Source: Drewry World Container Index. UK ports price at the North Europe benchmark. Our sea-freight estimates use these figures.</span>
  </section>`;
}
function sailingsHtml() {
  const s = S.sail;
  if (!s || !s.sailings?.length) return '';
  return `<div class="card" style="display:flex;flex-direction:column;gap:8px;padding:14px 16px">
    <b style="font-size:16px">🚢 Next ships · ${esc(s.from)} → ${esc(s.to)}</b>
    ${s.sailings.map((x) => `<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;padding:8px 0;border-top:1px solid #E5E9F0">
      <span><b>${esc(niceDay(x.depart))}</b> → ${esc(niceDay(x.arrive))}${x.vessel ? `<span class="muted" style="font-size:13px"> · ${esc(x.vessel)}</span>` : ''}</span>
      <span class="muted" style="font-size:13px">${x.days} days port to port${x.stops === 0 ? ' · direct' : x.stops ? ` · ${x.stops} stop${x.stops > 1 ? 's' : ''}` : ''}</span></div>`).join('')}
    <span class="muted" style="font-size:12px">Live Maersk schedule. Allow about a week more for collection, customs and delivery.</span>
  </div>`;
}

/** Small carrier icons on the sea cards: who sails this route. Prices are our estimate, not theirs. */
function carriersHtml(list) {
  return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:2px">
    <span class="muted" style="font-size:12px;margin-right:2px">Carriers on this route:</span>
    ${list.map((c) => `<span title="${esc(c.name)}" style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px 3px 4px;border:1px solid #E5E9F0;border-radius:99px;background:#FFFFFF;font-size:12px;font-weight:600;color:#1F2A3C">
      <img src="/api/carrier-logo/${esc(c.id)}" alt="" width="18" height="18" loading="lazy" style="width:18px;height:18px;border-radius:4px;object-fit:contain">${esc(c.name)}</span>`).join('')}
  </div>`;
}

function resultsHtml() {
  if (S.busy) return `<section class="card fr-res"><div class="ldr"><span class="spin" aria-hidden="true"></span><span><b>Checking air, sea and road rates…</b><span class="muted">This can take up to 10 seconds.</span></span></div></section>`;
  const r = S.res;
  if (!r) return `<section class="card fr-res fr-tips"><b class="tips-h">How freight is priced</b>
    <div class="tip"><span class="ic">${IC.plane}</span><span><b>Air</b>Charged by weight or size, whichever is bigger (1 m³ counts as 167 kg). Fast: about 5 to 10 days door to door.</span></div>
    <div class="tip"><span class="ic">${IC.ship}</span><span><b>Sea</b>Charged by volume. Much cheaper for heavy or bulky stock, but slow: about 30 to 45 days from China to the UK.</span></div>
    <div class="tip"><span class="ic">${IC.box}</span><span><b>Amazon and TikTok warehouses</b>Choose the warehouse from your shipping plan. Label every box with its FBA or FBT label before collection.</span></div>
    <div class="tip"><span class="ic">${IC.truck}</span><span><b>Duties and VAT</b>Goods coming into the UK pay import VAT (20%) and sometimes duty. These are not in the estimates.</span></div></section>`;
  const days = (x) => (x.daysMin ? `${x.daysMin}${x.daysMax && x.daysMax !== x.daysMin ? `–${x.daysMax}` : ''} days` : '');
  const money = (p, c) => (c === 'GBP' ? gbp(p).replace('.00', '') : `${(p / 100).toLocaleString('en-GB', { style: 'currency', currency: c, maximumFractionDigits: 0 })}`);
  return `<section class="fr-res">
    <div class="g-head"><h2 style="margin:0;font-size:22px">Freight rates</h2><span class="muted" style="font-size:13px">${esc(originPlace().text)} → ${esc(destination().text)}${r.scope ? ` · <b style="color:#2463DB">${esc(r.scope[0].toUpperCase() + r.scope.slice(1))}</b>` : ''}</span></div>
    ${S.stale ? '<div style="padding:10px 14px;border-radius:10px;background:#FFF7E6;border:1px solid #F5C26B;color:#7A4B00;font-size:14px;font-weight:600">You changed the details. Press <b>Compare freight rates</b> to update these prices.</div>' : ''}
    ${r.note ? `<p class="hint" style="margin:0">${esc(r.note)}</p>` : ''}
    <div class="list">${r.rates.map((x) => `<article class="offer fr-rate">
      <div class="offer-top"><div class="co"><span class="co-logo fr-ic">${MODE_IC[x.mode] || IC.box}</span><div class="co-t"><b>${esc(x.label)}</b><span class="muted" style="font-size:13px">${esc(MODE_TIP[x.mode] || '')}</span></div></div>
        <div class="fr-price">${x.live ? `<span class="badge booked">Live price${x.carrier ? ` · ${esc(x.carrier)}` : ''}</span>` : '<span class="badge open">Estimated</span>'}<b>${x.minPence === x.maxPence ? money(x.minPence, x.currency) : `${money(x.minPence, x.currency)} – ${money(x.maxPence, x.currency)}`}</b><span class="muted">${esc(days(x))}</span></div></div>
      ${(x.mode === 'FCL' || x.mode === 'LCL') && r.carriers?.length ? carriersHtml(r.carriers) : ''}
      <div class="acts"><a class="btn ghost sm go-btn" href="${quoteHref(x.mode)}">Get firm quotes ${goIcon()}</a></div>
    </article>`).join('')}</div>
    ${sailingsHtml()}
    ${r.rates.length ? '' : `<div class="empty-box"><b>Get prices from freight companies</b><span>Tell us about the shipment and freight forwarders and hauliers send you their prices.</span><a class="btn go-btn" href="${quoteHref(S.load === 'container' ? 'FCL' : 'air')}">Get firm quotes ${goIcon(true)}</a></div>`}
    <p class="muted" style="font-size:12.5px;margin:0">Estimates by Kargom, based on ${esc(r.basis || 'current market rates')}. ${esc(r.scope ? r.scope[0].toUpperCase() + r.scope.slice(1) : 'Door to door')}, excluding import duty and VAT. Real quotes can be higher or lower.${r.rates.some((x) => x.live) ? ' Live prices come straight from the carrier and include VAT.' : ''}</p>
  </section>`;
}

/* ---------- freight forwarders on Google, at both ends ---------- */
const placeLabel = (name, town) => { const p = place(name); return `${town || p.city}, ${isUk(name) ? 'United Kingdom' : p.n}`; };
function fwdPlaces() {
  const o = originPlace(), d = destination();
  return [{ side: 'from', label: placeLabel(S.from, o.town), country: place(S.from).code }, { side: 'to', label: placeLabel(S.to, d.town || ''), country: code(S.to) }];
}
function shipText() {
  const what = S.load === 'container' ? `${S.qty || 1} x ${{ container20: '20 ft', container40: '40 ft', container40HC: '40 ft High Cube' }[S.box]} container`
    : `${S.qty || 1} ${S.load === 'boxes' ? 'boxes' : 'pallets'}, ${S.kg} kg each${S.l && S.w && S.h ? `, ${S.l}x${S.w}x${S.h} cm` : ''}`;
  const dest = destination().text + (toKind() === 'amazon' && S.fc ? ` (Amazon ${S.fc.slice(2)})` : toKind() === 'tiktok' ? ' (TikTok Shop warehouse)' : '');
  return `Hello, I found you on Kargom.co.uk. Could you quote me for this shipment?\n\nFrom: ${originPlace().text}\nTo: ${dest}\nGoods: ${what}\n\nPlease send your best price for air and sea, door to door. Thank you.`;
}
function fwdCard(p, where = '') {
  const signup = `/login?mode=register&next=${encodeURIComponent(location.pathname + location.search)}`;
  const rating = p.rating ? `${stars(p.rating)}<span class="stars-n">${p.rating.toFixed(1)} · ${p.reviewCount} Google review${p.reviewCount === 1 ? '' : 's'}</span>` : '<span class="stars-n">No reviews yet</span>';
  const member = Boolean(S.me);
  const tel = p.phone ? `<a class="btn ghost sm" href="${member ? `tel:${esc(String(p.intlPhone || p.phone).replace(/[^\d+]/g, ''))}` : signup}">📞 ${member ? esc(p.phone) : 'Sign up to see number'}</a>` : '';
  const more = member ? `${p.website ? `<a class="btn ghost sm" href="${esc(p.website)}" target="_blank" rel="noopener nofollow">Website</a>` : ''}${p.mapsUrl ? `<a class="btn ghost sm" href="${esc(p.mapsUrl)}" target="_blank" rel="noopener">Map</a>` : ''}` : '';
  const ourQuote = `<a class="btn sm go-btn" href="${quoteHref(S.res?.rates?.[0]?.mode || (S.load === 'container' ? 'FCL' : 'air'))}">${goIcon(true)}Free instant quote</a>`;
  return `<article class="offer gplace"><div class="offer-top"><div class="co">${logoHtml(p)}<div class="co-t"><b>${esc(p.company)}</b><span>${rating}</span>${where ? `<span class="fr-where">${esc(where)}</span>` : ''}${p.area ? `<span class="muted" style="font-size:13px">${esc(p.area)}</span>` : ''}</div></div></div>
    <div class="acts">${ourQuote}${tel}${more}</div></article>`;
}
/** Best first: good rating with enough reviews to trust it (same idea as the server's ranking). */
const fwdScore = (p) => (p.rating ? (p.rating * (p.reviewCount || 0) + 4.2 * 15) / ((p.reviewCount || 0) + 15) : -1);
const pickKey = (p) => p.placeId || `${p.company}|${p.phone || ''}`;
const signupHref = () => `/login?mode=register&next=${encodeURIComponent(location.pathname + location.search)}`;
const bestMode = () => S.res?.rates?.[0]?.mode || (S.load === 'container' ? 'FCL' : 'air');
const googleFoot = () => `<div class="fr-fwd-foot"><span class="g-attr">Listings from <b class="g-logo"><i>G</i><i>o</i><i>o</i><i>g</i><i>l</i><i>e</i></b></span>
  ${S.me ? '' : `<span class="muted">Phone numbers are free for members. <a href="${signupHref()}">Sign up free</a></span>`}</div>`;

/**
 * Where to look for the best forwarders at the destination. For sea freight the strongest
 * forwarders sit in the container-port cities, so those come first whatever the delivery town.
 */
function bestCities() {
  const c = code(S.to), country = countryName(S.to);
  const ports = [...new Set(portsFor(c).filter((x) => x[2] === 'sea').map((x) => x[1].replace(/\s*\(.*\)$/, '').replace(/\s*\/.*$/, '')))];
  const town = destination().town || place(S.to).city;
  const list = S.load === 'container' || !town ? ports.slice(0, 3) : [town, ...ports.filter((x) => x !== town).slice(0, 2)];
  return (list.length ? list : [town]).filter(Boolean).map((x) => `${x}, ${country}`);
}

/** Phones: the 2 best at the destination and the best at the origin, right under the prices. */
function topPicks() {
  const dest = (S.best?.places || []).slice(0, 2).map((p) => ({ p, where: `In ${countryName(S.to)}` }));
  const g = S.fwd?.[0];
  const orig = g ? [...g.places].sort((a, b) => fwdScore(b) - fwdScore(a)).slice(0, 1).map((p) => ({ p, where: `In ${g.label.split(', ').pop()}` })) : [];
  return [...dest, ...orig];
}
function topHtml() {
  if (!S.res || (!S.fwd && !S.best)) return '';
  const busy = S.best?.busy || S.fwd?.some((g) => g.busy);
  const picks = topPicks();
  const mobile = busy ? '<section class="card fr-top fr-only-m"><b class="fr-top-h">Recommended forwarders</b><p class="muted" style="margin:0">Finding companies…</p></section>'
    : picks.length ? `<section class="fr-top fr-only-m"><div class="fr-top-head"><h2>Recommended forwarders</h2><span class="muted">Best rated on Google at both ends of your route</span></div>
    <div class="list">${picks.map(({ p, where }) => fwdCard(p, where)).join('')}</div>${googleFoot()}</section>` : '';
  return mobile + bestListHtml();
}

/** Computer screens: the 10 best forwarders at the destination, as bookable rows (no prices). */
function bestListHtml() {
  const b = S.best;
  if (!b || (!b.busy && !b.places.length)) return '';
  const head = `<div class="fl-head"><span><h2>Forwarders &amp; rates</h2><span class="muted">The best rated freight forwarders in ${esc(countryName(S.to))}${S.load === 'container' ? ', in the main container-port cities' : ''}</span></span>
    ${b.busy ? '' : `<label class="fl-sort">Sort by<span class="fx">${`<select class="inp" data-sort>${[['rec', 'Recommended'], ['rating', 'Highest rating'], ['reviews', 'Most reviews']].map(([v, l]) => `<option value="${v}" ${S.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`}${FX.chev}</span></label>`}</div>`;
  if (b.busy) return `<section class="fl fr-only-d">${head}<div class="card fl-busy"><span class="spin" aria-hidden="true"></span>Finding the best forwarders…</div></section>`;
  const list = [...b.places];
  if (S.sort === 'rating') list.sort((x, y) => (y.rating || 0) - (x.rating || 0) || y.reviewCount - x.reviewCount);
  if (S.sort === 'reviews') list.sort((x, y) => y.reviewCount - x.reviewCount);
  const what = S.load === 'container' ? `FCL · ${S.qty || 1} × ${{ container20: '20 ft', container40: '40 ft', container40HC: '40 ft High Cube' }[S.box]}` : `${S.qty || 1} ${S.load}`;
  const top3 = new Set(b.places.slice(0, 3).map(pickKey));
  const ports = new Set(portsFor(code(S.to)).filter((x) => x[2] === 'sea').map((x) => x[1].replace(/\s*\(.*\)$/, '').replace(/\s*\/.*$/, '')));
  const rows = list.map((p) => {
    const k = pickKey(p), open = S.fopen === k;
    const tel = p.phone ? `<a class="btn ghost sm" href="${S.me ? `tel:${esc(String(p.intlPhone || p.phone).replace(/[^\d+]/g, ''))}` : signupHref()}">📞 ${S.me ? esc(p.phone) : 'Sign up to see number'}</a>` : '';
    const more = S.me ? `${p.website ? `<a class="btn ghost sm" href="${esc(p.website)}" target="_blank" rel="noopener nofollow">Website</a>` : ''}${p.mapsUrl ? `<a class="btn ghost sm" href="${esc(p.mapsUrl)}" target="_blank" rel="noopener">Map</a>` : ''}` : '';
    return `<article class="fl-row"><span class="fl-logo">${logoHtml(p)}</span>
      <div class="fl-mid"><span class="fl-name"><b>${esc(p.company)}</b>${top3.has(k) ? '<span class="fl-rec">Recommended</span>' : ''}</span>
        <span class="fl-sub">${esc(what)} · ${esc(originPlace().text.split(',')[0])} → ${esc(destination().text.split(',')[0])}</span>
        <span class="fl-rate">${p.rating ? `${stars(p.rating)}<span class="stars-n">${p.rating.toFixed(1)} · ${p.reviewCount} Google review${p.reviewCount === 1 ? '' : 's'}</span>` : '<span class="stars-n">No reviews yet</span>'}</span>
        <span class="fl-chips">${p.city && ports.has(p.city) ? `<span>${FX.anchor}Near ${esc(p.city)} port</span>` : ''}${p.area ? `<span>${FX.pin}${esc(p.area)}</span>` : ''}</span></div>
      <div class="fl-act"><a class="btn fl-book go-btn" href="${quoteHref(bestMode())}">${goIcon(true)}Book</a>
        <button type="button" class="fl-more" data-fopen="${esc(k)}" aria-expanded="${open}" aria-label="More about ${esc(p.company)}">${FX.chev}</button></div>
      ${open ? `<div class="fl-extra">${tel}${more}${!tel && !more ? '<span class="muted">No phone number listed on Google.</span>' : ''}</div>` : ''}</article>`;
  }).join('');
  return `<section class="fl fr-only-d">${head}<div class="card fl-list">${rows}</div>${googleFoot()}</section>`;
}
/** The page ends with the form: nothing listed below it. */
function fwdHtml() { return ''; }
let fwdKey = '';
async function loadForwarders() {
  const origin = fwdPlaces()[0];
  const cities = bestCities();
  const key = `${origin.label}${origin.country}|${cities.join('|')}|${code(S.to)}`;
  if (key === fwdKey && (S.fwd || S.best)) return;
  fwdKey = key;
  S.fwd = [{ ...origin, busy: true, places: [], error: null }];
  S.best = { busy: true, places: [] };
  S.fopen = '';
  paint();
  await Promise.all([
    (async () => {
      const g = S.fwd[0];
      try {
        const r = await api(`/api/freight/forwarders?${new URLSearchParams({ place: g.label, country: g.country })}`);
        if (!r.enabled) { S.fwd = null; return; }
        g.places = r.places; g.error = r.error || null;
      } catch (e) { g.error = e.message; }
      g.busy = false;
    })(),
    (async () => {
      try {
        const r = await api(`/api/freight/forwarders/top?${new URLSearchParams({ cities: cities.join('|'), country: code(S.to) })}`);
        S.best = r.enabled ? { busy: false, places: r.places } : null;
      } catch { S.best = { busy: false, places: [] }; }
    })(),
  ]);
  paint();
}

function render() {
  root.className = 'wrap';
  root.innerHTML = `<div class="steps-head"><h1>Compare freight rates</h1><span class="muted">Air, sea and road · free estimates in seconds</span></div>
    <div class="fr-cols ${S.res || S.busy ? 'has-res' : ''}"><div id="fr-form">${formHtml()}</div><div id="fr-out">${marketHtml()}${resultsHtml()}</div><div id="fr-top">${topHtml()}</div></div><div id="fr-fwd">${fwdHtml()}</div>`;
}
/** Update the prices, market box and forwarders without touching the form (keeps the cursor where it is). */
function paint() {
  const out = document.getElementById('fr-out'), fw = document.getElementById('fr-fwd');
  if (!out || !fw) { render(); return; }
  out.innerHTML = marketHtml() + resultsHtml();
  fw.innerHTML = fwdHtml();
  const top = document.getElementById('fr-top'); if (top) top.innerHTML = topHtml();
  root.querySelector('.fr-cols')?.classList.toggle('has-res', Boolean(S.res || S.busy));
  const btn = root.querySelector('[data-go]');
  if (btn) { btn.disabled = S.busy; btn.innerHTML = S.busy ? 'Finding rates…' : `Compare freight rates ${FX.arrow}`; }
  const err = document.getElementById('fr-err'); if (err) err.textContent = S.err || '';
}

/**
 * Searches cost money (Google listings, carrier APIs), so a change never searches by itself:
 * it only marks the prices as out of date until the customer presses "Compare freight rates".
 */
let timer = null, seq = 0;
function auto() {
  if (!S.res || S.stale) return;
  S.stale = true; paint();
}

const looksLikePostcode = (t) => /\d/.test(t) && t.length <= 10;
const postcodeOf = (typed, p) => { const t = String(typed || '').trim(); return UK_PC.test(t) || (p.code !== 'GB' && looksLikePostcode(t)) ? t : p.pc; };
const townOf = (typed, p) => { const t = String(typed || '').trim(); return t && !looksLikePostcode(t) ? t : p.city; };

/** Sample sizes so prices show straight away; the customer changes them to their own. */
function sample() {
  if (S.load === 'boxes') { S.kg ||= '20'; S.l ||= '50'; S.w ||= '40'; S.h ||= '40'; }
  if (S.load === 'pallets') { S.kg ||= '300'; S.l ||= '120'; S.w ||= '100'; S.h ||= '150'; }
}

async function go({ auto: quiet = false } = {}) {
  const fail = (msg) => { if (!quiet) { S.err = msg; paint(); } };
  const container = S.load === 'container';
  if (!container && !(Number(S.kg) > 0)) return fail('Enter the weight of one box or pallet.');
  if (S.load === 'boxes' && !(Number(S.l) > 0 && Number(S.w) > 0 && Number(S.h) > 0)) return fail('Enter the size of one box (length, width and height in cm).');
  if (S.dest === 'fc' && warehouses().length && !S.fc) return fail('Choose the fulfilment centre.');
  const my = ++seq;
  S.err = ''; S.busy = true; S.stale = false; paint();
  const from = place(S.from), dest = destination(), o = originPlace();
  const fromTxt = o.text;
  const q = new URLSearchParams({
    origin: fromTxt, destination: dest.text, fromCountry: from.code, toCountry: code(S.to), load: container ? S.box : S.load, qty: S.qty || '1',
    ...(container ? {} : { kg: S.kg, l: S.l, w: S.w, h: S.h }),
    // a postcode and town at each end (the customer's, or a sample for the country) so pallet networks can price it
    fromPostcode: from.pc, toPostcode: postcodeOf(dest.pc, place(S.to)),
    fromTown: o.town || from.city, toTown: townOf(dest.town || S.toPlace, place(S.to)),
    fromType: S.origin === 'port' ? 'port' : 'door', toType: S.dest === 'port' ? 'port' : 'door',
  });
  try {
    const res = await api(`/api/freight/rates?${q}`);
    if (my !== seq) return; // a newer search has started
    S.res = res;
    const keep = new URLSearchParams({ from: S.from, to: S.to, origin: S.origin, dest: S.dest, load: S.load, qty: S.qty, ...(S.fromPort && { fromPort: S.fromPort }), ...(S.toPort && { toPort: S.toPort }), ...(S.toPlace && { toPlace: S.toPlace }), ...(S.fc && { fc: S.fc }), ...(container ? { box: S.box } : { kg: S.kg, l: S.l, w: S.w, h: S.h }) });
    history.replaceState(null, '', `/freight?${keep}`);
  } catch (e) { if (my !== seq) return; S.res = null; S.err = e.message; }
  S.busy = false; paint();
  if (!quiet) document.querySelector('.fr-res')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (S.res) { loadForwarders(); loadSailings(); }
}

async function loadSailings() {
  S.sail = null;
  const o = originPlace(), dest = destination();
  const want = `${S.from}|${S.fromPort}|${S.to}|${S.toPort}|${S.toPlace}|${S.fc}`;
  if (!S.res?.rates?.some((x) => x.mode === 'LCL' || x.mode === 'FCL')) return;
  try {
    const r = await api(`/api/freight/sailings?${new URLSearchParams({ from: place(S.from).code, fromTown: o.town, to: code(S.to), toTown: dest.town || S.toPlace || '' })}`);
    if (r.enabled && r.sailings?.length && want === `${S.from}|${S.fromPort}|${S.to}|${S.toPort}|${S.toPlace}|${S.fc}`) { S.sail = r; paint(); }
  } catch { /* schedules are a bonus */ }
}

root.addEventListener('input', (e) => {
  if (e.target.dataset?.sort !== undefined) { S.sort = e.target.value; paint(); return; }
  const k = e.target.dataset?.k;
  if (!k) return;
  S[k] = e.target.value;
  if (['from', 'to', 'fc', 'box', 'origin', 'dest', 'fromPort', 'toPort'].includes(k)) {
    if (k === 'from') S.fromPort = '';
    if (k === 'to' || k === 'dest') { S.fc = ''; S.toPort = ''; }
    render(); auto(0); return;
  }
  const t = document.getElementById('tot'); if (t) t.textContent = totals();
  auto(k === 'toPlace' ? 900 : 600);
});/** "Use my location" for UK collections: phone position → nearest postcode. */
async function locate() {
  if (S.locating) return;
  S.locating = true; render();
  try {
    const { postcodeHere } = await import('../here.js');
    const r = await postcodeHere();
    S.fromCity = r.postcode; toast(`You are near ${r.postcode}.`); auto(0);
  } catch (err) { toast(err.message); }
  S.locating = false; render();
}

root.addEventListener('click', (e) => {
  const fo = e.target.closest('[data-fopen]');
  if (fo) { S.fopen = S.fopen === fo.dataset.fopen ? '' : fo.dataset.fopen; paint(); return; }
  const t = e.target.closest('[data-set],[data-go],[data-here]');
  if (!t) return;
  if (t.dataset.here !== undefined) { locate(); return; }
  if (t.dataset.go !== undefined) { clearTimeout(timer); go(); return; }
  S[t.dataset.set] = t.dataset.v;
  if (t.dataset.set === 'load') {
    S.kg = ''; S.l = ''; S.w = ''; S.h = '';
  }
  sample(); S.err = ''; render(); auto(0);
});

document.getElementById('top').insertAdjacentHTML('beforeend', '<a class="toplink" href="/login">Sign in</a>');
api('/api/me').then((me) => { S.me = me; const a = document.querySelector('#top .toplink'); if (a && me) { a.href = '/app'; a.textContent = 'My account'; } if (S.fwd) render(); }).catch(() => {});
sample();
render();
api('/api/freight/market').then((m) => { S.market = m; paint(); }).catch(() => {});
// a search from the homepage runs once on arrival; a bare /freight visit waits for the button
if (qs.get('from')) go({ auto: true });
