import { mountShell } from '../shell.js';
import { api, esc, wrapLabels, toast, resizeImage, drawMap, routeChips, getRoute, niceDate, L, UK_PC, COUNTRIES, cname, marketConfig } from '../market-ui.js';

/**
 * Get a quote: a moving request (removals) or a road-freight request (FTL / LTL).
 * Five short steps, a live A→B map on the side, then the request goes to every
 * partner company of that kind and the customer collects offers.
 */

const root = document.getElementById('root');
const qs = new URLSearchParams(location.search);
const todayIso = new Date().toISOString().slice(0, 10);
const blankAddr = () => ({ line1: '', line2: '', city: '', postcode: '', country: 'GB' });

const S = {
  me: null, type: ['removals', 'freight'].includes(qs.get('type')) ? qs.get('type') : null, step: 1, busy: false, err: '',
  d: {
    moveType: 'home', itemsText: '', size: ['studio', '1', '2', '3', '4', '5'].includes(qs.get('size')) ? qs.get('size') : '', items: [], packing: false, dismantling: false, storage: false,
    fromPlace: { floor: 'ground', lift: false, parking: 'easy' }, toPlace: { floor: 'ground', lift: false, parking: 'easy' }, dateFlex: 'exact',
    load: ['ftl', 'ltl', 'air', 'sea'].includes(qs.get('load')) ? qs.get('load') : 'ftl', vehicle: '', pallets: qs.get('pallets') || '', palletType: 'uk', goods: '', weightKg: qs.get('weightKg') || '', stackable: false,
    shipUnit: qs.get('load') === 'sea' ? 'container20' : 'boxes', units: qs.get('pallets') || '1', cbm: '', destType: 'business', fbaCode: '', adr: false, tempControlled: false,
    tailLiftCollection: false, tailLiftDelivery: false, collectWindow: 'any', deliverBy: '', notes: '',
  },
  from: { ...blankAddr(), postcode: (qs.get('from') || '').toUpperCase(), country: qs.get('fromCountry') || 'GB' }, to: { ...blankAddr(), postcode: (qs.get('to') || '').toUpperCase(), country: qs.get('toCountry') || 'GB' },
  date: '', phone: '', photos: [], route: null,
  lk: { from: { items: [], msg: '', busy: false, pc: '' }, to: { items: [], msg: '', busy: false, pc: '' } },
};

/* ---------------- small builders ---------------- */
const chip = (k, v, label, on) => `<button type="button" class="chip" data-set="${k}" data-v="${esc(v)}" aria-pressed="${on}">${esc(label)}</button>`;
const chips = (k, map, cur) => `<div class="chips">${(Array.isArray(map) ? map : Object.entries(map)).map(([v, l]) => chip(k, v, l, String(cur) === v)).join('')}</div>`;
const sw = (k, label, on) => `<label class="sw"><input type="checkbox" data-k="${k}" ${on ? 'checked' : ''}>${esc(label)}</label>`;
const get = (path) => path.split('.').reduce((o, p) => o?.[p], S);
const set = (path, v) => { const ps = path.split('.'); const last = ps.pop(); ps.reduce((o, p) => o[p], S)[last] = v; };
const ic = {
  home: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"></path></svg>',
  truck: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h12v10H2zM14 9h4l4 4v3h-8"></path><circle cx="6" cy="17.5" r="2"></circle><circle cx="17" cy="17.5" r="2"></circle></svg>',
};

/* ---------------- steps ---------------- */
function addressFields(who) {
  const a = S[who];
  const lk = S.lk[who];
  const gb = a.country === 'GB';
  const countrySel = S.type === 'freight'
    ? `<label class="fld">Country<select class="inp" data-k="${who}.country">${COUNTRIES.map(([c, n]) => `<option value="${c}" ${a.country === c ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : '';
  return `${countrySel}
  ${gb ? `<div class="finder">
    <label class="fld grow">Postcode<input class="inp up" data-k="lk.${who}.pc" value="${esc(lk.pc || a.postcode)}" placeholder="e.g. M1 1AE" autocomplete="postal-code" data-enter="find:${who}"></label>
    <button type="button" class="btn" data-act="find:${who}">${lk.busy ? 'Searching…' : 'Find address'}</button>
    ${lk.items.length ? `<label class="fld full">${lk.items.length} addresses found: choose one<select class="inp" data-pick="${who}"><option value="">Choose your address…</option>${lk.items.map((x, i) => `<option value="${i}">${esc(x.label)}</option>`).join('')}</select></label>` : ''}
    <span class="hint full">${esc(lk.msg || 'Or type the address in the boxes below.')}</span>
  </div>` : ''}
  <div class="grid2">
    <label class="fld">Address line 1 <i>*</i><input class="inp" data-k="${who}.line1" value="${esc(a.line1)}" autocomplete="address-line1"></label>
    <label class="fld">Address line 2 <em>(optional)</em><input class="inp" data-k="${who}.line2" value="${esc(a.line2)}" autocomplete="address-line2"></label>
    <label class="fld">Town or city <i>*</i><input class="inp" data-k="${who}.city" value="${esc(a.city)}" autocomplete="address-level2"></label>
    <label class="fld">Postcode <i>*</i><input class="inp up" data-k="${who}.postcode" value="${esc(a.postcode)}" autocomplete="postal-code"></label>
  </div>`;
}

function placeFields(who) {
  const p = S.d[`${who}Place`];
  return `<div class="row"><div><span class="lbl">Floor</span>${chips(`d.${who}Place.floor`, [['ground', 'Ground'], ['1', '1st'], ['2', '2nd'], ['3', '3rd'], ['4+', '4th or higher']], p.floor)}</div></div>
    <div class="toggles">${sw(`d.${who}Place.lift`, 'There is a lift', p.lift)}</div>
    <div><span class="lbl">Parking for the van</span>${chips(`d.${who}Place.parking`, L.parking, p.parking)}</div>`;
}

function photosField() {
  return `<div><span class="lbl">Photos <em class="muted" style="font-weight:500">(optional, up to 4: they help companies price accurately)</em></span>
    <div class="photos" style="margin-top:8px">${S.photos.map((p, i) => `<div class="photo"><img src="${p}" alt="Photo ${i + 1}"><button type="button" data-act="rmphoto:${i}" aria-label="Remove photo">×</button></div>`).join('')}
    ${S.photos.length < 4 ? '<label class="addphoto">+ Add photo<input type="file" accept="image/*" multiple data-photos></label>' : ''}</div></div>`;
}

const removalSteps = () => [
  {
    t: 'What are you moving?', sum: () => [L.moveType[S.d.moveType], S.d.size && L.size[S.d.size], S.d.moveType === 'items' && S.d.itemsText].filter(Boolean).join(' · '),
    body: () => `<div class="tiles sm">${Object.entries({ home: 'Flat or house', office: 'Desks, files, IT', items: 'Furniture or a few boxes' }).map(([v, sub]) =>
      `<button type="button" class="tile" data-set="d.moveType" data-v="${v}" aria-pressed="${S.d.moveType === v}"><b>${L.moveType[v]}</b><span>${sub}</span></button>`).join('')}</div>
      ${S.d.moveType === 'home' ? `<div><span class="lbl">Size of the home</span>${chips('d.size', [['studio', 'Studio'], ['1', '1 bed'], ['2', '2 bed'], ['3', '3 bed'], ['4', '4 bed'], ['5', '5+ bed']], S.d.size)}</div>` : ''}
      ${S.d.moveType === 'office' ? `<div><span class="lbl">Size of the office</span>${chips('d.size', [['small', 'Up to 10 desks'], ['medium', '10 to 30 desks'], ['large', '30+ desks']], S.d.size)}</div>` : ''}
      ${S.d.moveType === 'items' ? `<label class="fld">What needs moving? <i>*</i><input class="inp" data-k="d.itemsText" value="${esc(S.d.itemsText)}" placeholder="e.g. sofa, double bed, washing machine and 10 boxes"></label>` : ''}
      <div><span class="lbl">Extra help</span><div class="toggles" style="margin-top:8px">${sw('d.packing', 'Pack my things', S.d.packing)}${sw('d.dismantling', 'Take apart and rebuild furniture', S.d.dismantling)}${sw('d.storage', 'I need storage', S.d.storage)}</div></div>`,
    check: () => (S.d.moveType !== 'items' && !S.d.size ? 'Choose the size' : S.d.moveType === 'items' && String(S.d.itemsText).trim().length < 3 ? 'Tell us what needs moving' : ''),
  },
  { t: 'Moving from', sum: () => addrSum('from'), body: () => `${addressFields('from')}${placeFields('from')}`, check: () => addrCheck('from', 'moving from') },
  { t: 'Moving to', sum: () => addrSum('to'), body: () => `${addressFields('to')}${placeFields('to')}`, check: () => addrCheck('to', 'moving to') },
  {
    t: 'When are you moving?', sum: () => [niceDate(S.date), L.dateFlex[S.d.dateFlex], S.photos.length && `${S.photos.length} photos`].filter(Boolean).join(' · '),
    body: () => `<div class="row"><label class="fld">Moving date <i>*</i><input class="inp" type="date" min="${todayIso}" data-k="date" value="${esc(S.date)}"></label></div>
      <div><span class="lbl">How flexible is the date?</span>${chips('d.dateFlex', L.dateFlex, S.d.dateFlex)}</div>
      <label class="fld">Anything else companies should know? <em>(optional)</em><textarea class="inp" data-k="d.notes" maxlength="1000" placeholder="Narrow stairs, a piano on the 2nd floor, keys only from 2 pm…">${esc(S.d.notes)}</textarea></label>
      ${photosField()}`,
    check: () => (!S.date ? 'Choose the moving date' : S.date < todayIso ? 'The date is in the past' : ''),
  },
];

const intl = () => S.d.load === 'air' || S.d.load === 'sea';
const loadSum = () => (S.d.load === 'ftl' ? `FTL · ${L.vehicle[S.d.vehicle] || ''}` : S.d.load === 'ltl' ? `LTL · ${S.d.pallets || '?'} pallets`
  : `${L.load[S.d.load]} · ${S.d.units || 1} × ${L.shipUnit[S.d.shipUnit]}`);
const freightSteps = () => [
  {
    t: 'Your load', sum: () => [loadSum(), S.d.weightKg && `${S.d.weightKg} kg`].filter(Boolean).join(' · '),
    body: () => `<div class="tiles sm">
      <button type="button" class="tile" data-set="d.load" data-v="ftl" aria-pressed="${S.d.load === 'ftl'}"><b>Full truck load (FTL)</b><span>A whole vehicle just for your goods</span></button>
      <button type="button" class="tile" data-set="d.load" data-v="ltl" aria-pressed="${S.d.load === 'ltl'}"><b>Part load (LTL)</b><span>Pallets sharing a lorry: cheaper</span></button>
      <button type="button" class="tile" data-set="d.load" data-v="air" aria-pressed="${S.d.load === 'air'}"><b>Air freight</b><span>Fast, for boxes and pallets worldwide</span></button>
      <button type="button" class="tile" data-set="d.load" data-v="sea" aria-pressed="${S.d.load === 'sea'}"><b>Sea freight</b><span>Containers or shared container (LCL)</span></button></div>
      ${intl() ? `<div><span class="lbl">What are you shipping?</span>${chips('d.shipUnit', Object.entries(L.shipUnit).filter(([k]) => S.d.load === 'sea' || !k.startsWith('container')), S.d.shipUnit)}</div>
        <div class="row"><label class="fld">How many? <i>*</i><input class="inp" type="number" min="1" inputmode="numeric" data-k="d.units" value="${esc(S.d.units)}"></label>
          <label class="fld">Total volume (m³) <em>(optional)</em><input class="inp" inputmode="decimal" data-k="d.cbm" value="${esc(S.d.cbm)}" placeholder="e.g. 2.5"></label></div>`
      : S.d.load === 'ftl' ? `<div><span class="lbl">Vehicle</span>${chips('d.vehicle', L.vehicle, S.d.vehicle)}</div>`
        : `<div class="row"><label class="fld">Number of pallets <i>*</i><input class="inp" type="number" min="1" max="26" inputmode="numeric" data-k="d.pallets" value="${esc(S.d.pallets)}"></label></div>
           <div><span class="lbl">Pallet size</span>${chips('d.palletType', L.palletType, S.d.palletType)}</div>`}
      <div class="row"><label class="fld" style="flex:2 1 260px">What are the goods? <i>*</i><input class="inp" data-k="d.goods" value="${esc(S.d.goods)}" placeholder="${intl() ? 'e.g. phone cases, cotton t-shirts' : 'e.g. boxed books, machine parts'}"></label>
        <label class="fld">Total weight (kg) ${intl() && String(S.d.shipUnit).startsWith('container') ? '<em>(optional)</em>' : '<i>*</i>'}<input class="inp" type="number" min="1" inputmode="numeric" data-k="d.weightKg" value="${esc(S.d.weightKg)}"></label></div>
      <div class="toggles">${sw('d.stackable', 'Stackable', S.d.stackable)}${sw('d.adr', intl() ? 'Hazardous goods (batteries, liquids…)' : 'Hazardous goods (ADR)', S.d.adr)}${sw('d.tempControlled', 'Needs temperature control', S.d.tempControlled)}</div>`,
    check: () => (S.d.load === 'ftl' && !S.d.vehicle ? 'Choose a vehicle' : S.d.load === 'ltl' && !(Number(S.d.pallets) >= 1) ? 'Enter the number of pallets'
      : intl() && !(Number(S.d.units) >= 1) ? 'Enter how many'
      : intl() && S.d.load === 'air' && String(S.d.shipUnit).startsWith('container') ? 'Containers go by sea. Choose boxes or pallets'
      : String(S.d.goods).trim().length < 3 ? 'Describe the goods'
      : !(Number(S.d.weightKg) > 0) && !(intl() && String(S.d.shipUnit).startsWith('container')) ? 'Enter the total weight' : ''),
  },
  {
    t: 'Collection', sum: () => [addrSum('from'), niceDate(S.date)].filter(Boolean).join(' · '),
    body: () => `${addressFields('from')}
      <div class="row"><label class="fld">${intl() ? 'Goods ready on' : 'Collection date'} <i>*</i><input class="inp" type="date" min="${todayIso}" data-k="date" value="${esc(S.date)}"></label></div>
      ${intl() ? '' : `<div><span class="lbl">Collection time</span>${chips('d.collectWindow', L.collectWindow, S.d.collectWindow)}</div>
      <div class="toggles">${sw('d.tailLiftCollection', 'Needs a tail lift (no forklift on site)', S.d.tailLiftCollection)}</div>`}`,
    check: () => addrCheck('from', 'collection') || (!S.date ? 'Choose the collection date' : S.date < todayIso ? 'The date is in the past' : ''),
  },
  {
    t: 'Delivery', sum: () => [addrSum('to'), S.d.deliverBy && `by ${niceDate(S.d.deliverBy)}`].filter(Boolean).join(' · '),
    body: () => `${intl() ? `<div><span class="lbl">Delivering to</span>${chips('d.destType', L.destType, S.d.destType)}</div>
      ${S.d.destType === 'amazon' || S.d.destType === 'tiktok' ? `<label class="fld">${S.d.destType === 'amazon' ? 'Fulfilment centre code' : 'Warehouse'} <em>(optional)</em><input class="inp up" data-k="d.fbaCode" value="${esc(S.d.fbaCode)}" placeholder="${S.d.destType === 'amazon' ? 'e.g. LTN7 or BHX4' : 'e.g. Rugby'}"></label>` : ''}` : ''}
      ${addressFields('to')}
      ${intl() ? '' : `<div class="row"><label class="fld">Deliver by <em>(optional)</em><input class="inp" type="date" min="${S.date || todayIso}" data-k="d.deliverBy" value="${esc(S.d.deliverBy)}"></label></div>
      <div class="toggles">${sw('d.tailLiftDelivery', 'Needs a tail lift at delivery', S.d.tailLiftDelivery)}</div>`}`,
    check: () => addrCheck('to', 'delivery'),
  },
  {
    t: 'Notes and photos', sum: () => [S.d.notes && 'Notes added', S.photos.length && `${S.photos.length} photos`].filter(Boolean).join(' · ') || 'None',
    body: () => `<label class="fld">Anything else hauliers should know? <em>(optional)</em><textarea class="inp" data-k="d.notes" maxlength="1000" placeholder="Opening hours, booking-in reference, loading bay details…">${esc(S.d.notes)}</textarea></label>${photosField()}`,
    check: () => '',
  },
];

const steps = () => [...(S.type === 'removals' ? removalSteps() : freightSteps()), {
  t: 'Send to companies', sum: () => '',
  body: () => `<label class="fld">Your phone number <i>*</i><input class="inp" type="tel" data-k="phone" value="${esc(S.phone)}" autocomplete="tel" placeholder="07…"></label>
    <div class="noteb"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2463DB" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" style="flex:none;margin-top:2px"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16h.01"></path></svg>
    <span>Your request goes to every ${S.type === 'removals' ? 'removal company' : intl() ? 'freight forwarder' : 'road haulier'} on Kargom. They see the area and the details, <b>not</b> your phone number or exact address. You get each offer by email and on your request page, then you choose. Your details are shared only with the company you pick. It is free and you do not have to accept any offer.</span></div>`,
  check: () => (String(S.phone).replace(/\D/g, '').length < 7 ? 'Enter your phone number' : ''),
}];

const addrSum = (w) => { const a = S[w]; return a.line1 ? `${a.city} ${a.postcode}`.trim() : ''; };
function addrCheck(w, label) {
  const a = S[w];
  if (String(a.line1).trim().length < 2) return `Enter the first line of the ${label} address`;
  if (String(a.city).trim().length < 2) return `Enter the town or city for the ${label} address`;
  if (a.country === 'GB' && !UK_PC.test(String(a.postcode).trim())) return `Enter a full UK postcode for the ${label} address`;
  if (a.country !== 'GB' && !['HK', 'AE', 'SA', 'NG'].includes(a.country) && String(a.postcode).trim().length < 3) return `Enter the postcode for the ${label} address`;
  return '';
}

/* ---------------- render ---------------- */
const tick = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"></path></svg>';

function render() {
  if (!S.type) {
    root.className = 'wrap';
    root.innerHTML = `<div class="steps-head"><h1>Get a quote</h1><span class="muted">Free · companies send you prices · you choose</span></div>
      <div class="tiles" style="margin-top:16px">
        <a class="tile" href="?type=removals" data-type="removals"><span class="ic">${ic.home}</span><b>Get a moving quote</b><span>Home or office removals, or just a few big items. Local removal companies send you prices.</span></a>
        <a class="tile" href="?type=freight" data-type="freight"><span class="ic">${ic.truck}</span><b>Freight: road, air and sea</b><span>A lorry or pallets in the UK and Europe, or air and sea freight worldwide. Freight companies send you prices.</span></a>
      </div>
      <p class="muted" style="margin-top:18px">Sending a parcel instead? <a href="/app/send">Book a parcel</a> for an instant price.</p>`;
    return;
  }
  const list = steps();
  const cur = Math.min(S.step, list.length);
  root.className = 'wrap cols';
  root.innerHTML = wrapLabels(`<div class="steps">
    <div class="steps-head"><h1>${S.type === 'removals' ? 'Get a moving quote' : 'Freight quote'}</h1><a class="muted" href="/app/quote">Change type</a></div>
    ${list.map((st, i) => {
      const n = i + 1, state = n === cur ? 'open' : n < cur ? 'done' : 'todo';
      return `<section class="step" data-state="${state}">
        <div class="step-h"><span class="dot">${state === 'done' ? tick : n}</span>
          <div class="step-t"><h2>${esc(st.t)}</h2>${state === 'done' ? `<span class="sum">${esc(st.sum())}</span>` : ''}</div>
          ${state === 'done' && !S.busy ? `<button type="button" class="link" data-go="${n}">Change</button>` : ''}</div>
        ${state === 'open' ? `<div class="step-b">${st.body()}
          ${S.err ? `<div class="err" role="alert">${esc(S.err)}</div>` : ''}
          <button type="button" class="btn big" data-act="next" ${S.busy ? 'aria-disabled="true"' : ''}>${n === list.length ? (S.busy ? 'Sending…' : 'Send my request') : 'Continue'}</button></div>` : ''}
      </section>`;
    }).join('')}
  </div>
  <aside class="summary"><div class="card sum-card" style="flex-direction:column;align-items:stretch">
    <h2>${S.type === 'removals' ? 'Your move' : 'Your shipment'}</h2>
    <div class="route"><span class="pin a">A</span><span>${esc(addrSum('from') || (S.from.postcode ? S.from.postcode : 'Where from?'))}</span></div>
    <div class="route-line"></div>
    <div class="route"><span class="pin b">B</span><span>${esc(addrSum('to') || (S.to.postcode ? S.to.postcode : 'Where to?'))}</span></div>
    ${bothAddresses() ? `<div class="mapbox" id="map"><div class="empty">Loading the map…</div></div><div id="miles">${routeChips(S.route)}</div>` : tipsHtml()}
    ${S.date ? `<div class="kv"><span class="muted">${S.type === 'removals' ? 'Moving date' : 'Collection'}</span><b>${esc(niceDate(S.date))}</b></div>` : ''}
  </div></aside>`);
  refreshMap();
}

/** Map only once both addresses are filled in; until then, tips on getting a good price. */
const bothAddresses = () => !addrCheck('from', '') && !addrCheck('to', '');
const TI = {
  home: '<path d="M3 11l9-7 9 7v9H3z"></path>', pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"></path><circle cx="12" cy="10" r="2.5"></circle>',
  stairs: '<path d="M3 20h5v-5h5v-5h5V5h3"></path>', cal: '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"></path>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"></path><path d="M3 7l9 4 9-4M12 11v10"></path>', truck: '<path d="M2 6h12v10H2zM14 9h4l4 4v3h-8"></path><circle cx="6" cy="17.5" r="2"></circle><circle cx="17" cy="17.5" r="2"></circle>',
  scale: '<path d="M12 3v18M5 7h14M5 7l-3 7h6zM19 7l-3 7h6z"></path>', lift: '<path d="M4 20h16M6 20V8h8l4 4v8M10 12h4"></path>', warn: '<path d="M12 3l10 18H2z"></path><path d="M12 10v5M12 18h.01"></path>',
};
const ico = (k) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TI[k]}</svg>`;
function tipsHtml() {
  const rem = S.type === 'removals';
  const rows = rem ? [
    ['home', 'Size of your home', 'The biggest factor: how many rooms and how much furniture fills the van.'],
    ['pin', 'Distance', 'Miles between the two addresses and time on the road.'],
    ['stairs', 'Access at both ends', 'Stairs, lifts and parking change how long loading takes.'],
    ['cal', 'The date', 'Midweek and mid-month moves are often cheaper than Fridays and month-end.'],
    ['box', 'Extra help', 'Packing, taking furniture apart and storage are priced on top.'],
  ] : [
    ['truck', 'Space on the lorry', 'A full vehicle, or how many pallet spaces you use.'],
    ['scale', 'Weight', 'Heavier loads may need a bigger vehicle.'],
    ['pin', 'Distance and route', 'Miles, tolls and ferry crossings for Europe.'],
    ['lift', 'Loading and unloading', 'Tail lift, forklift on site and booked time slots.'],
    ['warn', 'Special goods', 'Hazardous (ADR) or temperature-controlled loads cost more.'],
  ];
  return `<div class="tips">
    <div class="tips-art" aria-hidden="true"><svg viewBox="0 0 220 110" width="100%" height="110">
      <rect x="0" y="96" width="220" height="3" rx="1.5" fill="#C9D6EA"></rect>
      <rect x="18" y="34" width="112" height="58" rx="8" fill="#2463DB"></rect><rect x="30" y="46" width="42" height="8" rx="4" fill="#BFD6FB"></rect><rect x="30" y="60" width="28" height="6" rx="3" fill="#BFD6FB"></rect>
      <path d="M130 50h34l20 20v22h-54z" fill="#1F4FB8"></path><path d="M138 56h22l14 14h-36z" fill="#BFD6FB"></path>
      <circle cx="48" cy="94" r="11" fill="#1F2A3C"></circle><circle cx="48" cy="94" r="4" fill="#C9D6EA"></circle><circle cx="160" cy="94" r="11" fill="#1F2A3C"></circle><circle cx="160" cy="94" r="4" fill="#C9D6EA"></circle>
      <rect x="150" y="10" width="30" height="26" rx="3" fill="#E8B26A"></rect><path d="M150 18h30" stroke="#C98F45" stroke-width="2"></path><rect x="184" y="20" width="24" height="16" rx="3" fill="#F0C48A"></rect>
    </svg></div>
    <b class="tips-h">${rem ? 'How removal companies price your move' : 'How hauliers price your load'}</b>
    <ul class="tips-l">${rows.map(([k, t, d]) => `<li><span class="tips-i">${ico(k)}</span><span><b>${t}</b>${d}</span></li>`).join('')}</ul>
    <div class="tips-photo"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h4l2-3h6l2 3h4v11H3z"></path><circle cx="12" cy="13" r="3.5"></circle></svg>
      <span><b>Add a few photos</b>${rem ? 'Photos of your rooms and any big items help companies give you an accurate price first time, with no surprises on the day.' : 'Photos of the goods and the loading area help hauliers send the right vehicle and a firm price.'}</span></div>
    <span class="hint">Fill in both addresses to see your route on the map.</span>
  </div>`;
}

async function refreshMap() {
  if (!bothAddresses()) return;
  const a = S.from, b = S.to;
  const okA = a.country === 'GB' ? UK_PC.test(a.postcode.trim()) : a.postcode.trim().length >= 3;
  const okB = b.country === 'GB' ? UK_PC.test(b.postcode.trim()) : b.postcode.trim().length >= 3;
  if (!okA || !okB) return;
  const r = await drawMap(document.getElementById('map'), { from: a.postcode.trim(), to: b.postcode.trim(), fc: a.country, tc: b.country });
  if (r && JSON.stringify(r) !== JSON.stringify(S.route)) { S.route = r; const el = document.getElementById('miles'); if (el) el.innerHTML = routeChips(r); }
}

/* ---------------- actions ---------------- */
async function find(who) {
  const lk = S.lk[who];
  const pc = String(lk.pc || S[who].postcode).trim();
  if (!pc) { lk.msg = 'Type a postcode first.'; render(); return; }
  lk.busy = true; lk.msg = 'Looking up addresses…'; render();
  try {
    const r = await api(`/api/address/lookup?postcode=${encodeURIComponent(pc)}`);
    S[who].postcode = r.postcode; if (r.town && !S[who].city) S[who].city = r.town;
    lk.items = r.addresses || [];
    lk.msg = lk.items.length ? '' : r.town ? `Postcode found in ${r.town}. Type the street address below.` : 'We could not find that postcode. Check it, or type the address below.';
  } catch (e) { lk.msg = e.message; }
  lk.busy = false; render();
}

async function next() {
  if (S.busy) return;
  const list = steps();
  const st = list[S.step - 1];
  const e = st.check();
  if (e) { S.err = e; render(); return; }
  S.err = '';
  if (S.step < list.length) { S.step += 1; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  S.busy = true; render();
  try {
    const items = S.d.moveType === 'items' ? String(S.d.itemsText).split(/[,\n]+| and /).map((x) => x.trim()).filter(Boolean) : [];
    const d = { ...S.d, items, pallets: Number(S.d.pallets) || 0, weightKg: Number(S.d.weightKg) || 0, units: Number(S.d.units) || 1, cbm: Number(String(S.d.cbm).replace(',', '.')) || 0, deliverBy: S.d.deliverBy || null };
    const job = await api('/api/jobs', { method: 'POST', body: { kind: S.type, from: S.from, to: S.to, date: S.date, phone: S.phone, photos: S.photos, details: d, distanceMiles: S.route?.miles } });
    location.href = `/app/requests/${job.id}?new=1`;
  } catch (err) { S.busy = false; S.err = err.message; render(); }
}

root.addEventListener('click', (e) => {
  const t = e.target.closest('[data-set],[data-act],[data-go]');
  if (!t) return;
  if (t.dataset.set) {
    const v = t.dataset.v;
    set(t.dataset.set, v);
    if (t.dataset.set === 'd.moveType') { S.d.size = ''; }
    render(); return;
  }
  if (t.dataset.go) { S.step = Number(t.dataset.go); S.err = ''; render(); return; }
  const [act, arg] = t.dataset.act.split(':');
  if (act === 'next') next();
  if (act === 'find') find(arg);
  if (act === 'rmphoto') { S.photos.splice(Number(arg), 1); render(); }
});
root.addEventListener('input', (e) => {
  const k = e.target.dataset.k;
  if (!k) return;
  set(k, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
});
root.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.k === 'from.country' || t.dataset.k === 'to.country') { render(); return; }
  if (t.dataset.k === 'date') render();
  if (t.dataset.pick) {
    const who = t.dataset.pick, a = S.lk[who].items[Number(t.value)];
    if (a) { Object.assign(S[who], { line1: a.line1, line2: a.line2, city: a.city, postcode: a.postcode }); S.lk[who].items = []; S.lk[who].msg = `Selected: ${a.label}`; render(); }
  }
  if (t.dataset.photos !== undefined) {
    const files = [...t.files].slice(0, 4 - S.photos.length);
    for (const f of files) { try { S.photos.push(await resizeImage(f)); } catch (err) { toast(err.message); } }
    render();
  }
  if (/^(from|to)\.(line1|city|postcode)$/.test(t.dataset.k || '')) { const had = !!document.getElementById('map'); if (bothAddresses() !== had) render(); else refreshMap(); }
});
root.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset.enter) { e.preventDefault(); const [, who] = e.target.dataset.enter.split(':'); S.lk[who].pc = e.target.value; find(who); }
});
window.addEventListener('popstate', () => { S.type = new URLSearchParams(location.search).get('type'); render(); });
root.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-type]');
  if (a) { e.preventDefault(); S.type = a.dataset.type; S.step = 1; history.pushState(null, '', `?type=${S.type}`); render(); window.scrollTo(0, 0); }
});

(async () => {
  try { const sh = await mountShell('quote'); S.me = sh.me; sh.main.append(root); } catch { location.href = `/login?mode=register&next=${encodeURIComponent(location.pathname + location.search)}`; return; }
  S.phone = S.me.phone || '';
  document.title = 'Get a quote — Kargom.co.uk';
  marketConfig();
  render();
})();
