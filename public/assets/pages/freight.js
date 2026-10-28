import { api, esc, gbp, toast, wrapLabels, UK_PC } from '../market-ui.js';
import { OPTIONS, SEP, place, isUk } from '../countries.js';
import { AMAZON, TIKTOK } from '../warehouses.js';

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
  from: place(qs.get('from')) ? qs.get('from') : 'China', fromCity: qs.get('fromCity') || '',
  to: place(qs.get('to')) ? qs.get('to') : 'United Kingdom', toType: pick(qs.get('toType'), ['business', 'home', 'amazon', 'tiktok'], 'business'), toPlace: qs.get('toPlace') || '', fc: qs.get('fc') || '',
  load: pick(qs.get('load'), ['boxes', 'pallets', 'container'], 'boxes'), box: pick(qs.get('box'), ['container20', 'container40', 'container40HC'], 'container20'),
  qty: qs.get('qty') || '1', kg: qs.get('kg') || '', l: qs.get('l') || '', w: qs.get('w') || '', h: qs.get('h') || '',
  busy: false, res: null, err: '',
};
if (S.load === 'pallets') { S.l ||= '120'; S.w ||= '100'; S.h ||= '150'; }

const IC = {
  plane: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>',
  ship: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M19.4 17.4 21 12H3l1.6 5.4"/><path d="M12 12V3l7 6"/></svg>',
  truck: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>',
  box: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
};
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

function warehouses() {
  const c = code(S.to);
  if (S.toType === 'amazon') return (AMAZON[c] || []).map(([fc, town, pc]) => ({ v: fc, t: `${fc} · ${town}`, town, pc }));
  if (S.toType === 'tiktok') return (TIKTOK[c] || []).map(([town, pc]) => ({ v: town, t: `${town}`, town, pc }));
  return [];
}

function destination() {
  const p = place(S.to);
  if (S.toType === 'amazon' || S.toType === 'tiktok') {
    const w = warehouses().find((x) => x.v === S.fc);
    if (w) return { text: `${w.town} ${w.pc}, ${p.n === 'England' ? 'United Kingdom' : p.n}`, pc: w.pc };
  }
  const t = S.toPlace.trim();
  return { text: `${t || p.city}, ${isUk(S.to) ? 'United Kingdom' : p.n}`, pc: t };
}

function totals() {
  const n = Math.max(1, Number(S.qty) || 1), kg = Number(S.kg) || 0;
  const m3 = (Number(S.l) * Number(S.w) * Number(S.h)) / 1e6 * n;
  return [kg ? `${(kg * n).toLocaleString('en-GB')} kg in total` : '', m3 > 0 ? `${m3.toFixed(m3 < 10 ? 2 : 1)} m³` : ''].filter(Boolean).join(' · ');
}

function formHtml() {
  const wh = warehouses();
  const marketNote = (S.toType === 'amazon' || S.toType === 'tiktok') && !wh.length
    ? `<p class="hint" style="margin:0">${S.toType === 'amazon' ? 'Amazon' : 'TikTok Shop'} warehouses are listed for the UK and the USA. For ${esc(S.to)}, enter the warehouse postcode from your shipping plan below.</p>` : '';
  const toInput = wh.length
    ? `<label class="fld">${S.toType === 'amazon' ? 'Amazon fulfilment centre' : 'TikTok Shop warehouse'} <i>*</i><select class="inp" data-k="fc"><option value="">Choose…</option>${wh.map((w) => `<option value="${esc(w.v)}" ${w.v === S.fc ? 'selected' : ''}>${esc(w.t)}</option>`).join('')}</select></label>`
    : `<label class="fld">Town or postcode <em>(optional)</em><input class="inp" data-k="toPlace" value="${esc(S.toPlace)}" placeholder="e.g. ${esc(place(S.to)?.city || '')}"></label>`;
  const unit = S.load === 'boxes' ? 'boxes' : 'pallets';
  return wrapLabels(`<section class="card fr-form">
    <div class="fr-row">
      <div class="fr-side"><span class="lbl">From</span>
        <label class="fld">Country${countrySel('from', S.from)}</label>
        <label class="fld">Town, port or postcode <em>(optional)</em><input class="inp" data-k="fromCity" value="${esc(S.fromCity)}" placeholder="e.g. ${esc(place(S.from)?.city || '')}"></label>
      </div>
      <div class="fr-side"><span class="lbl">To</span>
        <label class="fld">Country${countrySel('to', S.to)}</label>
        <div class="chips">${chip('toType', 'business', 'Business', S.toType === 'business')}${chip('toType', 'home', 'Home', S.toType === 'home')}${chip('toType', 'amazon', 'Amazon FBA', S.toType === 'amazon')}${chip('toType', 'tiktok', 'TikTok Shop', S.toType === 'tiktok')}</div>
        ${toInput}${marketNote}
      </div>
    </div>
    <div class="fr-what"><span class="lbl">What are you shipping?</span>
      <div class="chips">${chip('load', 'boxes', `${IC.box} Boxes`, S.load === 'boxes')}${chip('load', 'pallets', 'Pallets', S.load === 'pallets')}${chip('load', 'container', `${IC.ship} Container`, S.load === 'container')}</div>
      ${S.load === 'container' ? `<div class="grid2">
          <label class="fld">Container size<select class="inp" data-k="box"><option value="container20" ${S.box === 'container20' ? 'selected' : ''}>20 ft (33 m³)</option><option value="container40" ${S.box === 'container40' ? 'selected' : ''}>40 ft (67 m³)</option><option value="container40HC" ${S.box === 'container40HC' ? 'selected' : ''}>40 ft High Cube (76 m³)</option></select></label>
          <label class="fld">How many?<input class="inp" data-k="qty" inputmode="numeric" value="${esc(S.qty)}"></label></div>`
      : `<div class="fr-dims">
          <label class="fld">How many ${unit}?<input class="inp" data-k="qty" inputmode="numeric" value="${esc(S.qty)}"></label>
          <label class="fld">Weight of one (kg) <i>*</i><input class="inp" data-k="kg" inputmode="decimal" value="${esc(S.kg)}" placeholder="${S.load === 'boxes' ? 'e.g. 15' : 'e.g. 300'}"></label>
          <label class="fld">Length (cm)<input class="inp" data-k="l" inputmode="decimal" value="${esc(S.l)}" placeholder="${S.load === 'boxes' ? '50' : '120'}"></label>
          <label class="fld">Width (cm)<input class="inp" data-k="w" inputmode="decimal" value="${esc(S.w)}" placeholder="${S.load === 'boxes' ? '40' : '100'}"></label>
          <label class="fld">Height (cm)<input class="inp" data-k="h" inputmode="decimal" value="${esc(S.h)}" placeholder="${S.load === 'boxes' ? '40' : '150'}"></label>
        </div><span class="muted fr-tot" id="tot">${esc(totals())}</span>`}
    </div>
    ${S.err ? `<div class="err">${esc(S.err)}</div>` : ''}
    <button type="button" class="btn big" data-go ${S.busy ? 'disabled' : ''}>${S.busy ? 'Finding rates…' : 'Compare freight rates'}</button>
  </section>`);
}

function quoteHref(mode) {
  const p = new URLSearchParams({ type: 'freight', load: QUOTE_LOAD[mode] || 'ltl', fromCountry: code(S.from), toCountry: code(S.to) });
  if (S.load !== 'container' && S.kg) p.set('weightKg', String(Math.round(Number(S.kg) * (Number(S.qty) || 1))));
  if (S.load === 'pallets') p.set('pallets', S.qty);
  return `/app/quote?${p}`;
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
    <div class="g-head"><h2 style="margin:0;font-size:22px">Freight rates</h2><span class="muted" style="font-size:13px">${esc(S.from)} → ${esc(destination().text)}</span></div>
    ${r.note ? `<p class="hint" style="margin:0">${esc(r.note)}</p>` : ''}
    <div class="list">${r.rates.map((x) => `<article class="offer fr-rate">
      <div class="offer-top"><div class="co"><span class="co-logo fr-ic">${MODE_IC[x.mode] || IC.box}</span><div class="co-t"><b>${esc(x.label)}</b><span class="muted" style="font-size:13px">${esc(MODE_TIP[x.mode] || '')}</span></div></div>
        <div class="fr-price"><span class="badge open">Estimated</span><b>${money(x.minPence, x.currency)} – ${money(x.maxPence, x.currency)}</b><span class="muted">${esc(days(x))}</span></div></div>
      <div class="acts"><a class="btn ghost sm" href="${quoteHref(x.mode)}">Get firm quotes</a></div>
    </article>`).join('')}</div>
    ${r.rates.length ? '' : `<div class="empty-box"><b>Get prices from freight companies</b><span>Tell us about the shipment and freight forwarders and hauliers send you their prices.</span><a class="btn" href="${quoteHref(S.load === 'container' ? 'FCL' : 'air')}">Get firm quotes</a></div>`}
    <p class="muted" style="font-size:12.5px;margin:0">Estimates by Kargom, based on ${esc(r.basis || 'current market rates')}. Door to door, excluding import duty and VAT. Real quotes can be higher or lower.</p>
  </section>`;
}

function render() {
  root.className = 'wrap';
  root.innerHTML = `<div class="steps-head"><h1>Compare freight rates</h1><span class="muted">Air, sea and road · free estimates in seconds</span></div>
    <div class="fr-cols">${formHtml()}${resultsHtml()}</div>`;
}

async function go() {
  const container = S.load === 'container';
  if (!container && !(Number(S.kg) > 0)) { S.err = 'Enter the weight of one box or pallet.'; render(); return; }
  if (S.load === 'boxes' && !(Number(S.l) > 0 && Number(S.w) > 0 && Number(S.h) > 0)) { S.err = 'Enter the size of one box (length, width and height in cm).'; render(); return; }
  if ((S.toType === 'amazon' || S.toType === 'tiktok') && warehouses().length && !S.fc) { S.err = `Choose the ${S.toType === 'amazon' ? 'Amazon fulfilment centre' : 'TikTok Shop warehouse'}.`; render(); return; }
  S.err = ''; S.busy = true; render();
  const from = place(S.from), dest = destination();
  const fromTxt = `${S.fromCity.trim() || from.city}, ${isUk(S.from) ? 'United Kingdom' : from.n}`;
  const q = new URLSearchParams({
    origin: fromTxt, destination: dest.text, fromCountry: from.code, toCountry: code(S.to), load: container ? S.box : S.load, qty: S.qty || '1',
    ...(container ? {} : { kg: S.kg, l: S.l, w: S.w, h: S.h }),
    ...(UK_PC.test(S.fromCity.trim()) ? { fromPostcode: S.fromCity.trim() } : {}), ...(UK_PC.test(dest.pc) ? { toPostcode: dest.pc } : {}),
  });
  try {
    S.res = await api(`/api/freight/rates?${q}`);
    const keep = new URLSearchParams({ from: S.from, to: S.to, toType: S.toType, load: S.load, qty: S.qty, ...(S.fromCity && { fromCity: S.fromCity }), ...(S.toPlace && { toPlace: S.toPlace }), ...(S.fc && { fc: S.fc }), ...(container ? { box: S.box } : { kg: S.kg, l: S.l, w: S.w, h: S.h }) });
    history.replaceState(null, '', `/freight?${keep}`);
  } catch (e) { S.res = null; S.err = e.message; }
  S.busy = false; render();
  document.querySelector('.fr-res')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

root.addEventListener('input', (e) => {
  const k = e.target.dataset?.k;
  if (!k) return;
  S[k] = e.target.value;
  if (k === 'from' || k === 'to' || k === 'fc' || k === 'box') { if (k === 'to') S.fc = ''; render(); return; }
  const t = document.getElementById('tot'); if (t) t.textContent = totals();
});
root.addEventListener('click', (e) => {
  const t = e.target.closest('[data-set],[data-go]');
  if (!t) return;
  if (t.dataset.go !== undefined) { go(); return; }
  S[t.dataset.set] = t.dataset.v;
  if (t.dataset.set === 'toType') S.fc = '';
  if (t.dataset.set === 'load') {
    if (t.dataset.v === 'pallets') { S.l = '120'; S.w = '100'; S.h = '150'; } else if (t.dataset.v === 'boxes') { S.l = ''; S.w = ''; S.h = ''; }
  }
  S.err = ''; render();
});

document.getElementById('top').insertAdjacentHTML('beforeend', '<a class="toplink" href="/login">Sign in</a>');
api('/api/me').then((me) => { const a = document.querySelector('#top .toplink'); if (a && me) { a.href = '/app'; a.textContent = 'My account'; } }).catch(() => {});
render();
if (qs.get('kg') || qs.get('box')) go();
