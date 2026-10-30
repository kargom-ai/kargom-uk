import { mountShell } from '../shell.js';
import { api, esc, gbp, toast } from '../market-ui.js';
import { postcodeHere } from '../here.js';
import { shrinkPhoto } from '../photo-address.js';
import { shopLogo, productThumb, threadHtml, composerHtml, readPhotos, courierLogo, WAREHOUSE_ICON, CHAT_ICON } from '../turkey-ui.js';

/**
 * Shop from Turkey (customer). Compact Istanbul address on top, one list of every order with
 * its stage, pay for packed boxes in place, and a side column with the UK address, a price
 * calculator and the shops. Forms open in a side drawer so the page never jumps around.
 */
const root = document.createElement('div');
root.className = 'tw';
const S = { d: null, me: null, stage: 'all', sel: new Set(), drawer: null, pick: {}, showLines: false, calc: { w: '', l: '', wd: '', h: '' }, calcQ: null, busy: false, lk: { items: [], msg: '', bad: false, busy: false }, paste: false };

const STAGE = {
  coming: ['On the way to us', '#FFF4E0', '#9A5B00'],
  here: ['In our warehouse', '#E6F4EA', '#166534'],
  pack: ['Being packed', '#EAF2FE', '#1D4FB8'],
  pay: ['Ready to pay', '#F1E9FE', '#5B2BB5'],
  ship: ['Paid, sending', '#E3F6F5', '#0F766E'],
  sent: ['On its way to you', '#E3F6F5', '#0F766E'],
  done: ['Delivered', '#EEF2F7', '#3E4A5C'],
};
const SHOPS = [['Trendyol', 'https://www.trendyol.com'], ['Hepsiburada', 'https://www.hepsiburada.com'], ['Amazon.com.tr', 'https://www.amazon.com.tr'], ['N11', 'https://www.n11.com'],
  ['Koton', 'https://www.koton.com'], ['LC Waikiki', 'https://www.lcw.com'], ['DeFacto', 'https://www.defacto.com.tr'], ['Boyner', 'https://www.boyner.com.tr']];
const kg = (v) => (v == null ? '–' : `${Number(v).toFixed(2).replace(/\.?0+$/, '')} kg`);
const tl = (v) => (v ? `${Number(v).toLocaleString('tr-TR')} TL` : '');
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const pill = (k) => `<span class="tw-pill" style="background:${STAGE[k][1]};color:${STAGE[k][2]}"><i></i>${STAGE[k][0]}</span>`;
const cell = (k, label, unit, v, dec) => `<label><small>${label}</small><span class="tw-unit" data-u="${unit}"><input class="tw-in" data-c="${k}" inputmode="${dec ? 'decimal' : 'numeric'}" value="${esc(v ?? '')}" aria-label="${label} in ${unit}"></span></label>`;
const logo = (store, size) => shopLogo(store, S.d?.shopLogos || [], size);
const thumb = (image, store, size) => productThumb(image, store, S.d?.shopLogos || [], size);
const notesFor = (id) => (S.d?.notes || []).filter((n) => n.packageId === id);
const BUY = { requested: ['Checking the price', '#FFF4E0', '#9A5B00'], quoted: ['Ready to pay', '#F1E9FE', '#5B2BB5'], paid: ['Paid, we are ordering', '#EAF2FE', '#1D4FB8'],
  ordered: ['Ordered', '#E6F4EA', '#166534'], rejected: ['Not possible', '#FDECEC', '#B42318'], cancelled: ['Cancelled', '#EEF2F7', '#586579'] };
/** Saved UK addresses we can offer: this page's, the last parcel booking, and the Send-a-parcel address book on this device. */
function savedAddresses() {
  const out = [];
  const add = (a) => { if (a?.line1 && a?.postcode && !out.some((x) => `${x.line1}|${x.postcode}`.toUpperCase() === `${a.line1}|${a.postcode}`.toUpperCase())) out.push(a); };
  add(S.d?.ukAddress); add(S.d?.suggestedAddress);
  try { for (const a of JSON.parse(localStorage.getItem('kg_senders') || '[]')) if (!a.country || a.country === 'GB') add(a); } catch { /* private mode */ }
  return out.slice(0, 6);
}
const addrLine = (a) => [a.line1, a.line2, a.city, a.postcode].filter(Boolean).join(', ');

function rows() {
  const ships = Object.fromEntries(S.d.shipments.map((s) => [s.id, s]));
  return S.d.packages.filter((p) => p.status !== 'discarded').map((p) => {
    const s = p.shipmentId ? ships[p.shipmentId] : null;
    let stage = p.status === 'expected' ? 'coming' : p.status === 'received' ? 'here' : 'pack';
    if (s) stage = { requested: 'pack', quoted: 'pay', paid: 'ship', shipped: 'sent', delivered: 'done', cancelled: 'here' }[s.status] || stage;
    return { p, s, stage };
  }).filter((r) => !['sent', 'done'].includes(r.stage)); // on its way to the UK: it is in the dashboard's shipments now
}

function addressCard() {
  const d = S.d, a = d.address;
  if (!a) return `<section class="tw-card"><div class="tc-addr"><span class="tc-code"><small>YOUR CODE</small><b>${esc(d.suite)}</b></span>
    <span class="txt"><span class="ttl"><span class="tc-wh">${WAREHOUSE_ICON}</span>Your Istanbul address is almost ready</span><span>We are opening the warehouse. Your address appears here and we email you as soon as it is ready.</span></span></div></section>`;
  const mark = (v) => esc(v).split(esc(d.suite)).join(`<mark>${esc(d.suite)}</mark>`);
  const lines = [['Ad Soyad', a.name], ['Adres', a.line1], ['Adres 2', a.line2], ['İlçe', a.district], ['İl', a.city], ['Posta kodu', a.postcode], ['Telefon', a.phone]].filter((r) => r[1]);
  return `<section class="tw-card"><div class="tc-addr">
    <span class="tc-code"><small>YOUR CODE</small><b>${esc(d.suite)}</b></span>
    <span class="txt"><span class="ttl"><span class="tc-wh">${WAREHOUSE_ICON}</span>Your Istanbul address</span>
      <span>${mark(a.name)} · ${mark([a.line1, a.line2].filter(Boolean).join(', '))} · ${esc([a.district, a.city].filter(Boolean).join(' / '))} ${esc(a.postcode)} · ${esc(a.phone)}</span>
      <span class="tw-muted">Put <b>${esc(d.suite)}</b> after your name on every order, so we know it is yours.</span></span>
    <span class="tw-acts"><button type="button" class="tw-btn" data-copy="${esc(lines.map((r) => r[1]).concat('Türkiye').join('\n'))}">Copy address</button>
      <button type="button" class="tw-btn ghost" data-act="lines" aria-expanded="${S.showLines}">${S.showLines ? 'Hide lines' : 'Copy line by line'}</button></span></div>
    ${S.showLines ? `<div class="tc-fields">${lines.map(([k, v]) => `<div class="tc-field"><span><small>${esc(k)}</small><b>${mark(v)}</b></span><button type="button" class="tc-copy" data-copy="${esc(v)}">Copy</button></div>`).join('')}</div>` : ''}
  </section>`;
}

function stats(all) {
  const tiles = [['coming', 'On the way to us'], ['here', 'In our warehouse'], ['pay', 'Ready to pay'], ['ship', 'Paid, sending']];
  return `<div class="tw-stats">${tiles.map(([k, l]) => {
    const n = k === 'pay' ? S.d.shipments.filter((s) => s.status === 'quoted').length : k === 'ship' ? S.d.shipments.filter((s) => s.status === 'paid').length : all.filter((r) => r.stage === k).length;
    return `<button type="button" class="tw-stat" data-stage="${k}" aria-pressed="${S.stage === k}"><span class="ic" style="background:${STAGE[k][1]}"><i style="background:${STAGE[k][2]}"></i></span><span>${l}<b>${n}</b></span></button>`;
  }).join('')}</div>`;
}

function payPanels() {
  const boxes = S.d.shipments.filter((s) => s.status === 'quoted');
  if (!boxes.length || !['all', 'pay'].includes(S.stage)) return '';
  return boxes.map((s) => {
    const pick = S.pick[s.id] || s.quotes[0]?.courierId;
    const q = s.quotes.find((x) => x.courierId === pick) || s.quotes[0];
    const items = S.d.packages.filter((p) => p.shipmentId === s.id);
    const n = items.length;
    const enough = S.d.balancePence >= q.pence;
    const names = items.map((p) => p.productTitle || p.description).filter(Boolean);
    return `<div class="tc-pay"><div class="tw-item"><span class="tw-logos" style="gap:6px">${items.slice(0, 4).map((p) => thumb(p.image, p.store, 44)).join('')}</span>
        <span class="two" style="display:flex;flex-direction:column;gap:2px;min-width:0"><b style="font-size:16px">${esc(names.slice(0, 3).join(', '))}${names.length > 3 ? ` and ${names.length - 3} more` : ''} ${n > 1 ? 'are' : 'is'} packed</b>
        <span class="tw-muted">Choose a courier and pay · ${n} parcel${n > 1 ? 's' : ''} in one box · ${kg(s.weightKg)} · ${esc(s.dims || '')} cm · to ${esc(s.address.city)} ${esc(s.address.postcode)}</span></span></div>
      <div class="tw-opts">${s.quotes.map((x) => `<label class="tw-opt"><input type="radio" name="c_${s.id}" value="${x.courierId}" data-pick="${s.id}" ${x.courierId === q.courierId ? 'checked' : ''}>${courierLogo(S.d.courierLogos?.[x.courierId])}
        <span class="n"><b>${esc(x.name)}</b><span>${x.daysMin}–${x.daysMax} working days · shipping ${gbp(x.breakdown.shipping + x.breakdown.fuel)} + handling ${gbp(x.breakdown.handling)}${x.breakdown.consolidation ? ` + combining ${gbp(x.breakdown.consolidation)}` : ''}${x.breakdown.storage ? ` + storage ${gbp(x.breakdown.storage)}` : ''}</span></span><span class="p">${gbp(x.pence)}</span></label>`).join('')}</div>
      <div class="tw-acts"><button type="button" class="tw-btn big" data-pay="${s.id}" data-with="card">Pay ${gbp(q.pence)} by card</button>
        <button type="button" class="tw-btn big ghost" data-pay="${s.id}" data-with="wallet" ${enough ? '' : 'disabled'} title="Wallet balance ${gbp(S.d.balancePence)}">Pay from wallet (${gbp(S.d.balancePence)})</button>
        <button type="button" class="tw-btn ghost" data-cancel="${s.id}" style="margin-left:auto">Cancel, keep my parcels</button></div>
      <span class="tw-muted">UK import VAT, and duty over £135, may be due: the courier asks you for it before delivery.</span></div>`;
  }).join('');
}

function msgBtn(p) {
  const n = notesFor(p.id);
  const fromUs = n.filter((x) => x.author === 'admin').length;
  return `<button type="button" class="tw-msgbtn ${fromUs ? 'has' : ''}" data-open="thread" data-id="${p.id}" aria-label="Messages about this parcel">${CHAT_ICON}${n.length ? n.length : ''}${n.some((x) => x.photos.length) ? ' 📷' : ''}</button>`;
}

function buyCard() {
  const list = S.d.buys || [];
  if (!list.length) return '';
  return `<section class="tw-card"><div class="tw-card-h"><h2>Buy it for me</h2><button type="button" class="tw-btn ghost sm" data-open="buy">+ New request</button></div>
    <div style="margin-top:8px">${list.map((b) => `<div class="tc-buy">${thumb(b.image, b.store, 56)}
      <span class="m"><a href="${esc(b.url)}" target="_blank" rel="noopener nofollow">${esc(b.title || b.details || b.url)}</a>
        ${b.title && b.details ? `<span class="tw-muted" style="color:#3E4A5C">${esc(b.details)}</span>` : ''}
        <span class="tw-muted">${esc(b.ref)} · ${esc(b.store || '')} · qty ${b.qty}${b.itemTry ? ` · shop price ${tl(b.itemTry)}` : ''}</span>${b.note ? `<span class="tw-muted" style="color:#3E4A5C">Kargom: ${esc(b.note)}</span>` : ''}</span>
      <span class="tw-pill" style="background:${BUY[b.status][1]};color:${BUY[b.status][2]}"><i></i>${BUY[b.status][0]}</span>
      ${b.status === 'quoted' ? `<span class="tw-acts-row"><button type="button" class="tw-btn" data-buypay="${b.id}" data-with="card">Pay ${gbp(b.pricePence)} by card</button>
        <button type="button" class="tw-btn ghost" data-buypay="${b.id}" data-with="wallet" ${S.d.balancePence >= b.pricePence ? '' : 'disabled'}>Wallet</button></span>` : ''}
      ${['requested', 'quoted'].includes(b.status) ? `<button type="button" class="tw-btn ghost sm" data-buycancel="${b.id}">Cancel</button>` : ''}</div>`).join('')}</div></section>`;
}

function listCard(all) {
  const chips = [['all', 'All'], ['coming', 'On the way to us'], ['here', 'In our warehouse'], ['pack', 'Being packed'], ['pay', 'Ready to pay'], ['ship', 'Paid, sending']];
  const inStage = (r, k) => k === 'all' || r.stage === k;
  const sentCount = S.d.shipments.filter((s) => ['shipped', 'delivered'].includes(s.status)).length;
  const list = all.filter((r) => inStage(r, S.stage));
  const count = (k) => k === 'all' ? all.length : new Set(all.filter((r) => inStage(r, k)).map((r) => (r.s && !['here', 'coming'].includes(r.stage) ? r.s.id : r.p.id))).size;
  const here = all.filter((r) => r.stage === 'here');
  const chosen = here.filter((r) => S.sel.has(r.p.id));
  const uk = S.d.ukAddress;
  const empty = S.stage === 'all'
    ? `<div class="tw-empty"><b>No orders yet</b>Bought something from a Turkish shop? Add it, so we can match it the moment it arrives.<button type="button" class="tw-btn" data-open="order">+ Add an order</button></div>`
    : '<div class="tw-empty"><b>Nothing here right now</b></div>';
  return `<section class="tw-card">
    <div class="tw-card-h"><h2>My orders</h2>${here.length ? `<button type="button" class="tw-btn ghost sm" data-act="all">${chosen.length === here.length ? 'Clear selection' : `Select all in warehouse (${here.length})`}</button>` : ''}</div>
    <div class="tw-chips">${chips.map(([k, l]) => `<button type="button" class="tw-chip" data-stage="${k}" aria-pressed="${S.stage === k}">${l} · ${count(k)}</button>`).join('')}</div>
    ${payPanels()}
    ${list.length ? `<div style="overflow-x:auto"><table class="tw-tbl"><thead><tr><th style="width:34px"></th><th>Item</th><th>Tracking</th><th>Weight</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map(({ p, s, stage }) => {
      const sub = stage === 'coming' ? (S.trk === p.id
        ? `<span class="tc-trk"><input class="tw-in" data-trkin="${p.id}" value="${esc(p.tracking || '')}" placeholder="Tracking number" aria-label="Tracking number"><button type="button" class="tw-btn sm" data-trksave="${p.id}">Save</button></span>`
        : `<button type="button" class="tc-trkbtn" data-trk="${p.id}" title="${p.tracking ? 'Change the tracking number' : 'Add the tracking number'}">${p.tracking ? `<span class="mono">${esc(p.tracking)}</span> ✎` : '+ Add the tracking number'}</button>`)
        : stage === 'here' ? `Arrived ${day(p.receivedAt)} · ${p.storagePence ? `<b style="color:#B42318">storage ${gbp(p.storagePence)}</b>` : `free until ${day(p.freeUntil)}`}`
          : s ? `<span class="mono">${esc(s.ref)}</span>${s.trackingNo ? ` · ${esc(s.courierName)} <span class="mono">${esc(s.trackingNo)}</span>` : ''}` : '';
      const act = stage === 'coming' ? `<button type="button" class="tw-btn ghost sm" data-open="order" data-id="${p.id}">Edit</button>`
        : stage === 'here' ? `<button type="button" class="tw-btn ghost sm" data-open="order" data-id="${p.id}">Edit</button><button type="button" class="tw-btn sm" data-sendone="${p.id}">Send</button>`
          : stage === 'sent' && s.trackingUrl ? `<a class="tw-btn sm" href="${esc(s.trackingUrl)}" target="_blank" rel="noopener">Track</a>` : '';
      const tags = p.autoSend && ['coming', 'here'].includes(stage) ? ` <span class="tw-tag blue">⚡ Sends on arrival</span>` : p.hold && stage === 'here' ? ' <span class="tw-tag">Keeping</span>' : '';
      return `<tr class="${S.sel.has(p.id) ? 'sel' : ''}"><td class="cb">${stage === 'here' ? `<input type="checkbox" data-sel="${p.id}" ${S.sel.has(p.id) ? 'checked' : ''} aria-label="Choose ${esc(p.description)}">` : ''}</td>
        <td><span class="tw-item">${thumb(p.image, p.store, 44)}<span class="two"><b>${esc(p.productTitle || p.description || 'Add what is in it')}</b>${p.productTitle && p.description ? `<small>${esc(p.description)}</small>` : ''}<small>${esc(p.store || '')}${p.valueTry ? ` · ${tl(p.valueTry)}` : ''}</small></span></span></td>
        <td><span class="two"><small style="color:var(--ink);font-size:13px">${sub}</small></span></td>
        <td>${p.weightKg ? kg(p.weightKg) : '<span class="tw-muted">–</span>'}</td>
        <td>${pill(stage)}${tags}</td><td><span class="tw-acts-row">${msgBtn(p)}${act}</span></td></tr>`;
    }).join('')}</tbody></table></div>` : empty}
    ${chosen.length ? `<div class="tc-bar"><span class="t"><b>${chosen.length} parcel${chosen.length > 1 ? 's' : ''} · ${kg(chosen.reduce((a, r) => a + (r.p.weightKg || 0), 0))}${chosen.length > 1 ? ' · packed into one box' : ''}</b>${uk ? `To ${esc(uk.name)}, ${esc(addrLine(uk))}` : 'Add your UK address next'}</span>
      <button type="button" class="tw-btn" data-open="send" style="min-height:44px">Send to the UK →</button></div>` : ''}
    ${sentCount ? `<p class="tw-muted" style="margin:0;padding:12px 20px;border-top:1px solid #EEF2F7">${sentCount} box${sentCount > 1 ? 'es' : ''} sent to the UK: track ${sentCount > 1 ? 'them' : 'it'} in <a href="/app">your dashboard</a>, under Recent shipments.</p>` : ''}
  </section>`;
}

function sideCol() {
  const uk = S.d.ukAddress, f = S.d.fees, c = S.calc;
  return `<div class="tc-side">
    <section class="tw-card"><div class="tw-card-h"><h2>Deliver to</h2><button type="button" class="tw-btn ghost sm" data-open="address">${uk ? 'Change' : 'Add'}</button></div>
      <div class="tw-pad">${uk ? `<span style="font-size:14px;line-height:1.5"><b>${esc(uk.name)}</b><br>${esc(addrLine(uk))}<br><span class="tw-muted">${esc(uk.phone)}</span></span>`
    : '<span class="tw-muted">Add your UK address once. We use it for every box, and for orders you want sent as soon as they arrive.</span>'}</div></section>
    <section class="tw-card" id="calc"><div class="tw-card-h"><h2>Price calculator</h2></div><div class="tw-pad">
      <div class="tw-dims">${cell('w', 'Weight', 'kg', c.w, 1)}${cell('l', 'Length', 'cm', c.l)}${cell('wd', 'Width', 'cm', c.wd)}${cell('h', 'Height', 'cm', c.h)}</div>
      <div class="tc-calc-res" id="calcres">${calcRes()}</div></div></section>
    <section class="tw-card"><div class="tw-card-h"><h2>Start shopping</h2></div><div class="tw-pad">
      <div class="tc-shops">${SHOPS.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${logo(n, 20)}${n}</a>`).join('')}</div>
      <button type="button" class="tw-btn ghost" data-open="buy" style="width:100%">Can't buy it yourself? <b style="margin-left:4px">Buy it for me</b></button>
      <div><div class="tc-kv"><span>Free storage</span><b>${f.freeDays} days</b></div><div class="tc-kv"><span>Handling per box</span><b>${gbp(f.handlingPence)}</b></div>
        <div class="tc-kv"><span>Each extra parcel in a box</span><b>${gbp(f.consolidatePence)}</b></div></div>
      <span class="tw-muted">Not allowed: loose batteries, perfume and aerosols over courier limits, weapons, medicines, food that spoils.</span></div></section>
  </div>`;
}
function calcRes() {
  if (!S.calcQ) return '<span class="tw-muted">Type the weight. Add the box size for a closer price.</span>';
  if (!S.calcQ.length) return '<span class="tw-muted">No price for this size yet. Ask us in Help.</span>';
  return `${S.calcQ.map((x) => `<div><span style="display:flex;align-items:center;gap:10px">${courierLogo(S.d.courierLogos?.[x.courierId])}<span>${esc(x.name)}<small>${x.daysMin}–${x.daysMax} working days · ${x.chargeableKg} kg</small></span></span><b>${gbp(x.pence)}</b></div>`).join('')}<span class="tw-muted">Includes handling. Your final price comes from the packed box.</span>`;
}

// ---------- drawers
function addrHelpers() {
  const saved = savedAddresses();
  const L = S.lk;
  return `${saved.length ? `<div class="tw-f">Your saved addresses<div class="tc-saved" style="margin-top:6px">${saved.map((a, i) => `<button type="button" data-saved="${i}">${esc(a.name || '')}${a.name ? ', ' : ''}${esc(addrLine(a))}</button>`).join('')}</div></div>` : ''}
    <div class="tw-f">Find by postcode<div class="tc-find" style="margin-top:6px"><input class="tw-in" data-find placeholder="e.g. LS1 5HD" value="${esc(L.pc || '')}" aria-label="Postcode to find"><button type="button" class="tw-btn" data-act="find">${L.busy ? 'Searching…' : 'Find address'}</button></div></div>
    ${L.items.length ? `<label class="tw-f">${L.items.length} addresses found: choose one<select class="tw-in" data-pickaddr><option value="">Choose your address…</option>${L.items.map((a, i) => `<option value="${i}">${esc(a.label)}</option>`).join('')}</select></label>` : ''}
    <div class="tc-helpers"><button type="button" class="tw-btn ghost" data-act="locate">📍 Use my location</button><button type="button" class="tw-btn ghost" data-act="paste">📋 Paste an address</button>
      <label class="tw-btn ghost">📷 From a photo<input type="file" accept="image/*" data-addrphoto hidden></label></div>
    ${S.paste ? `<div class="tw-compose"><textarea class="tw-in" data-pastebox rows="3" placeholder="Paste the address from a message or email"></textarea><button type="button" class="tw-btn sm" data-act="fillText" style="align-self:flex-start">Fill in the boxes</button></div>` : ''}
    ${L.msg ? `<span class="tw-muted" style="color:${L.bad ? '#B42318' : '#166534'}">${esc(L.msg)}</span>` : ''}`;
}
const addrFields = (a = {}) => `${addrHelpers()}<div class="tw-row"><label class="tw-f">Full name<input class="tw-in" name="name" value="${esc(a.name || S.me?.name || '')}" autocomplete="name"></label>
  <label class="tw-f">Phone<input class="tw-in" name="phone" value="${esc(a.phone || S.me?.phone || '')}" autocomplete="tel" placeholder="07…"></label></div>
  <label class="tw-f">Address<input class="tw-in" name="line1" value="${esc(a.line1 || '')}" autocomplete="address-line1"></label>
  <label class="tw-f">Address line 2 <em>(optional)</em><input class="tw-in" name="line2" value="${esc(a.line2 || '')}" autocomplete="address-line2"></label>
  <div class="tw-row"><label class="tw-f">Town or city<input class="tw-in" name="city" value="${esc(a.city || '')}" autocomplete="address-level2"></label>
  <label class="tw-f">Postcode<input class="tw-in" name="postcode" value="${esc(a.postcode || '')}" autocomplete="postal-code" style="text-transform:uppercase"></label></div>`;

/** The product card under a pasted link. */
function pvHtml(pv) {
  if (!pv) return '';
  if (pv.loading) return '<div class="tw-note" style="display:flex;align-items:center;gap:10px"><span class="spin" aria-hidden="true"></span>Reading the product page…</div>';
  if (!pv.known) return `<div class="tw-note warn">We can read links from Trendyol, Hepsiburada, Amazon.com.tr, N11 and other Turkish shops. For ${esc(pv.store || 'this site')}, please type the details.</div>`;
  if (!pv.title && !pv.image && !pv.priceTry) return '<div class="tw-note warn">We could not read this link. Please type the details below.</div>';
  return `<div class="tw-note tw-item" style="background:#F3F8FF;align-items:flex-start">${pv.image ? `<span class="tw-thumb" style="width:72px;height:72px"><img src="${esc(pv.image)}" alt=""></span>` : logo(pv.store, 48)}
    <span style="display:flex;flex-direction:column;gap:3px;min-width:0"><b style="font-size:15px;color:var(--ink)">${esc(pv.english || pv.title || pv.store)}</b>${pv.english && pv.title ? `<span class="tw-muted">${esc(pv.title)}</span>` : ''}
      <span class="tw-muted">${esc(pv.store)}${pv.priceTry ? ` · <b style="color:var(--ink);font-size:15px">${Number(pv.priceTry).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL</b>` : ''}</span></span></div>`;
}
let pvTimer, pvFor = '';
function readLink(input, now = false) {
  clearTimeout(pvTimer);
  const url = input.value.trim();
  if (!/^https?:\/\/\S+\.\S+/.test(url)) { if (S.drawer?.pv) { S.drawer.pv = null; const box = root.querySelector('#pv'); if (box) box.innerHTML = ''; } return; }
  if (url === pvFor) return;
  pvTimer = setTimeout(async () => {
    pvFor = url;
    const dr = S.drawer;
    dr.pv = { loading: true };
    const box = () => root.querySelector('#pv');
    if (box()) box().innerHTML = pvHtml(dr.pv);
    let pv;
    try { pv = await api('/api/tr/preview', { method: 'POST', body: { url } }); } catch (e) { pv = { known: true, store: '', error: e.message }; }
    if (S.drawer !== dr || pvFor !== url) return;
    dr.pv = pv;
    if (box()) box().innerHTML = pvHtml(pv);
    // fill what is still empty: shop, price paid
    const sel = root.querySelector('#dr [name="store"]');
    if (sel && pv.store && [...sel.options].some((o) => o.value === pv.store || o.text === pv.store)) sel.value = pv.store;
    const what = root.querySelector('#dr [name="description"]');
    if (what && !what.value && pv.english) what.value = pv.english;
  }, now ? 50 : 500);
}

function drawerHtml() {
  const dr = S.drawer;
  if (!dr) return '';
  let h = '', b = '', f = '';
  if (dr.kind === 'order') {
    const p = dr.id ? S.d.packages.find((x) => x.id === dr.id) : {};
    const v = { ...p, ...(dr.v || {}) };
    const auto = v.autoSend === true || v.autoSend === 'on';
    h = `<h2>${dr.id ? 'Edit order' : 'Add an order'}</h2><p>So we can match your parcel the moment it arrives, and fill in the customs form.</p>`;
    b = `${dr.id ? '' : `<label class="tw-f">Product link <em>(paste it: we fill in the name, price and picture)</em><input class="tw-in" name="productUrl" data-link value="${esc(v.productUrl || '')}" placeholder="https://www.trendyol.com/…" inputmode="url"></label>
      <div id="pv">${pvHtml(dr.pv)}</div>`}
      <div class="tw-row"><label class="tw-f">Shop<select class="tw-in" name="store" ${dr.id ? 'disabled' : ''}>${S.d.stores.map((s) => `<option ${s === (v.store || 'Trendyol') ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
        <label class="tw-f">Order number <em>(optional)</em><input class="tw-in" name="orderNo" value="${esc(v.orderNo || '')}"></label></div>
      <label class="tw-f">What is it? <em>(in English, for customs)</em><input class="tw-in" name="description" value="${esc(v.description || '')}" placeholder="e.g. 2 cotton T-shirts"></label>
      <div class="tw-row"><label class="tw-f">Tracking in Turkey <em>(add later)</em><input class="tw-in" name="tracking" value="${esc(v.tracking || '')}" placeholder="Yurtiçi, Aras, TEX…"></label></div>
      ${!dr.id || p.status === 'expected' ? `<label class="tw-switch"><input type="checkbox" name="autoSend" ${auto ? 'checked' : ''}><span><b>Send it as soon as it arrives</b>We weigh it, price it and send it to your UK address. If your wallet has enough money we take it from there, so nothing waits.</span></label>
      ${auto ? `<div class="tw-seg" role="radiogroup" aria-label="Courier choice"><label><input type="radio" name="autoPref" value="cheapest" ${v.autoPref !== 'fastest' ? 'checked' : ''}>Cheapest courier</label><label><input type="radio" name="autoPref" value="fastest" ${v.autoPref === 'fastest' ? 'checked' : ''}>Fastest courier</label></div>
        ${S.d.ukAddress ? `<span class="tw-muted">Sending to ${esc(S.d.ukAddress.name)}, ${esc(addrLine(S.d.ukAddress))} · wallet ${gbp(S.d.balancePence)}</span>` : `<b style="font-size:14px">Your UK address</b>${addrFields({ ...(S.d.suggestedAddress || savedAddresses()[0] || {}), ...v })}`}` : ''}` : ''}`;
    f = `<button type="button" class="tw-btn big" data-act="saveOrder">${dr.id ? 'Save' : 'Add order'}</button>${dr.id && p.status === 'expected' ? '<button type="button" class="tw-btn ghost" data-act="removeOrder" style="color:#B42318">Remove</button>' : ''}`;
  } else if (dr.kind === 'address') {
    h = '<h2>Your UK address</h2><p>Where we send your boxes from Turkey.</p>';
    b = addrFields({ ...(S.d.ukAddress || S.d.suggestedAddress || savedAddresses()[0] || {}), ...(dr.v || {}) });
    f = '<button type="button" class="tw-btn big" data-act="saveAddress">Save address</button>';
  } else if (dr.kind === 'send') {
    const chosen = S.d.packages.filter((p) => S.sel.has(p.id));
    const uk = S.d.ukAddress;
    h = `<h2>Send ${chosen.length} parcel${chosen.length > 1 ? 's' : ''} to the UK</h2><p>${chosen.length > 1 ? 'We pack them into one box, so you pay one shipping price.' : 'We check it and pack it.'}</p>`;
    b = `<div class="tw-note">${chosen.map((p) => `• ${esc(p.description)} <span class="tw-muted">(${esc(p.store)}, ${kg(p.weightKg)})</span>`).join('<br>')}</div>
      ${uk && !dr.edit ? `<div class="tw-f">Deliver to<span style="font-weight:500;color:var(--ink);font-size:14px;line-height:1.5">${esc(uk.name)}, ${esc(addrLine(uk))} · ${esc(uk.phone)} <button type="button" class="tw-btn ghost sm" data-act="editSendAddr">Change</button></span></div>` : addrFields({ ...(uk || S.d.suggestedAddress || savedAddresses()[0] || {}), ...(dr.v || {}) })}
      <label class="tw-f">Note for the warehouse <em>(optional)</em><input class="tw-in" name="note" value="${esc(dr.v?.note || '')}" placeholder="e.g. remove the shoe boxes to save space"></label>
      <div class="tw-note warn">Next: we weigh the packed box and send you the price of each courier, usually within 1 working day. You pay only after you choose.</div>`;
    f = '<button type="button" class="tw-btn big" data-act="sendBox">Ask for the price</button>';
  }
  if (dr.kind === 'thread') {
    const p = S.d.packages.find((x) => x.id === dr.id);
    h = `<div class="tw-item">${logo(p.store, 36)}<span><h2 style="font-size:18px">${esc(p.description || 'Your parcel')}</h2><p>${esc(p.store || '')} · messages with our warehouse</p></span></div>`;
    b = `${threadHtml(notesFor(p.id), 'customer')}${composerHtml(dr.v || {}, 'Write to our warehouse team about this parcel')}`;
    f = '<button type="button" class="tw-btn big" data-act="sendMsg">Send</button>';
  } else if (dr.kind === 'buy') {
    const v = dr.v || {};
    h = '<h2>Buy it for me</h2><p>Paste the product link. We check the price, you pay, and we order it for you. It then comes to our warehouse like any other order.</p>';
    b = `<label class="tw-f">Product link<input class="tw-in" name="url" data-link value="${esc(v.url || '')}" placeholder="https://www.trendyol.com/…" inputmode="url"></label>
      <div id="pv">${pvHtml(dr.pv)}</div>
      <label class="tw-f">Size, colour and anything else <em>(optional)</em><textarea class="tw-in" name="details" rows="3" placeholder="e.g. Size M, navy blue">${esc(v.details || '')}</textarea></label>
      <label class="tw-f" style="max-width:140px">Quantity<input class="tw-in" name="qty" inputmode="numeric" value="${esc(v.qty || 1)}"></label>
      <div class="tw-note">We reply with one price in £: the item, Turkish delivery to our warehouse and our service fee. Shipping to the UK is paid later, when you send your box.</div>`;
    f = '<button type="button" class="tw-btn big" data-act="sendBuy">Send request</button>';
  }
  return `<div class="tw-dim" data-dim><aside class="tw-drawer" role="dialog" aria-modal="true" id="dr">
    <div class="tw-drawer-h"><div>${h}</div><button type="button" class="tw-x" data-close aria-label="Close">×</button></div>
    <div class="tw-drawer-b">${b}</div><div class="tw-drawer-f">${f.replace(/<button /g, `<button ${S.busy ? 'disabled ' : ''}`)}</div></aside></div>`;
}

function render() {
  const all = rows();
  root.innerHTML = `<div class="tw-head"><div><h1>Shop from Turkey</h1><p>Buy from Turkish shops with your own Istanbul address. We send it to your door in the UK.</p></div>
      <div class="tw-acts"><button type="button" class="tw-btn big ghost" data-open="buy">Buy it for me</button><button type="button" class="tw-btn big" data-open="order">+ Add an order</button></div></div>
    ${addressCard()}${stats(all)}
    <div class="tc-cols"><div class="tw">${buyCard()}${listCard(all)}</div>${sideCol()}</div>${drawerHtml()}`;
}

async function load() {
  S.d = await api('/api/tr');
  const here = new Set(S.d.packages.filter((p) => p.status === 'received').map((p) => p.id));
  for (const id of [...S.sel]) if (!here.has(id)) S.sel.delete(id);
  render();
}
const form = () => {
  const o = {};
  for (const i of root.querySelectorAll('#dr [name]')) {
    if (i.type === 'checkbox') o[i.name] = i.checked;
    else if (i.type === 'radio') { if (i.checked) o[i.name] = i.value; } else o[i.name] = i.value;
  }
  return o;
};
const addrOf = (o) => ({ name: o.name, phone: o.phone, line1: o.line1, line2: o.line2, city: o.city, postcode: o.postcode });
async function run(fn, ok) {
  if (S.busy) return;
  if (S.drawer) S.drawer.v = { ...(S.drawer.v || {}), ...form() };
  S.busy = true; render();
  try { const m = await fn(); toast(m || ok); } catch (e) { toast(e.message); }
  S.busy = false; render();
}

let calcTimer;
function calc() {
  clearTimeout(calcTimer);
  const c = S.calc;
  if (!(Number(String(c.w).replace(',', '.')) > 0)) { S.calcQ = null; root.querySelector('#calcres').innerHTML = calcRes(); return; }
  const dims = [c.l, c.wd, c.h].every((x) => Number(x) > 0) ? `${c.l}x${c.wd}x${c.h}` : '';
  calcTimer = setTimeout(async () => {
    try { S.calcQ = (await api(`/api/tr/estimate?kg=${encodeURIComponent(String(c.w).replace(',', '.'))}&dims=${encodeURIComponent(dims)}`)).quotes; } catch { S.calcQ = []; }
    const el = root.querySelector('#calcres'); if (el) el.innerHTML = calcRes();
  }, 300);
}

root.addEventListener('input', (e) => {
  const k = e.target.dataset.c; if (k) { S.calc[k] = e.target.value; calc(); }
  if (e.target.matches('[data-link]')) readLink(e.target);
});
root.addEventListener('paste', (e) => { if (e.target.matches?.('[data-link]')) setTimeout(() => readLink(e.target, true), 0); });
root.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.sel) { t.checked ? S.sel.add(t.dataset.sel) : S.sel.delete(t.dataset.sel); render(); }
  if (t.dataset.pick) { S.pick[t.dataset.pick] = t.value; render(); }
  if (t.matches('[data-photos]')) { keep(); readPhotos(t.files, S.drawer.v?.photos || []).then((ph) => { S.drawer.v = { ...(S.drawer.v || {}), photos: ph }; render(); }).catch((err) => toast(err.message)); }
  if (t.matches('[data-pickaddr]') && t.value !== '') { const a = S.lk.items[Number(t.value)]; fillAddr(a); }
  if (t.matches('[data-addrphoto]') && t.files?.[0]) {
    const file = t.files[0]; keep(); S.lk = { ...S.lk, msg: 'Reading the address…', bad: false }; render();
    shrinkPhoto(file).then((image) => api('/api/address/from-image', { method: 'POST', body: { image } }))
      .then((r) => { if (r.found) fillAddr(r.address, 'Filled in from your photo. Please check it.'); else { S.lk = { ...S.lk, msg: 'We could not read an address in that image.', bad: true }; render(); } })
      .catch((err) => { S.lk = { ...S.lk, msg: err.message, bad: true }; render(); });
  }
  if (t.name === 'autoSend' || t.name === 'autoPref') { S.drawer.v = { ...(S.drawer.v || {}), ...form(), autoSend: t.name === 'autoSend' ? t.checked : form().autoSend }; render(); }
});
root.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.drawer) { S.drawer = null; render(); }
  if (e.key === 'Enter' && e.target.matches('[data-find]')) { e.preventDefault(); root.querySelector('[data-act="find"]')?.click(); }
  if (e.target.matches?.('[data-trkin]')) { if (e.key === 'Enter') { e.preventDefault(); saveTracking(e.target.dataset.trkin); } if (e.key === 'Escape') { S.trk = null; render(); } }
});
/** Save a tracking number typed straight into the list. */
async function saveTracking(id) {
  const v = root.querySelector(`[data-trkin="${id}"]`)?.value ?? '';
  S.trk = null;
  try { await api(`/api/tr/packages/${id}`, { method: 'POST', body: { tracking: v } }); await load(); toast(v.trim() ? 'Tracking number saved. We match it when it arrives.' : 'Tracking number removed'); }
  catch (e) { toast(e.message); render(); }
}
/** Keep what was typed in the drawer before re-drawing it. */
function keep() { if (S.drawer) S.drawer.v = { ...(S.drawer.v || {}), ...form() }; const f = root.querySelector('[data-find]'); if (f) S.lk.pc = f.value; }
/** Put an address into the drawer's boxes, never wiping what the customer typed if a part is missing. */
function fillAddr(a, msg = 'Address filled in. Please check it.') {
  keep();
  const v = S.drawer.v || {};
  const put = (k, x) => { if (x) v[k] = x; };
  put('name', a.name || a.company); put('phone', a.phone); put('line1', a.line1); put('line2', a.line2); put('city', a.city); put('postcode', a.postcode);
  S.drawer.v = v; S.lk = { ...S.lk, items: [], msg, bad: false }; S.paste = false; render();
}
root.addEventListener('click', async (e) => {
  if (e.target.matches('[data-dim]')) { S.drawer = null; render(); return; }
  const b = e.target.closest('button, [data-copy]');
  if (!b) return;
  const ds = b.dataset;
  if (ds.copy != null) { try { await navigator.clipboard.writeText(ds.copy); toast('Copied'); } catch { toast(ds.copy); } return; }
  if ('close' in ds) { S.drawer = null; render(); return; }
  if (ds.stage) { S.stage = S.stage === ds.stage && b.classList.contains('tw-stat') ? 'all' : ds.stage; render(); return; }
  if (ds.open) { pvFor = ''; S.drawer = { kind: ds.open, id: ds.id || null, v: null }; S.lk = { items: [], msg: '', bad: false, busy: false }; S.paste = false; render(); root.querySelector('#dr input:not([type=checkbox]), #dr select')?.focus(); return; }
  if (ds.cancel) { await run(async () => { await api(`/api/tr/shipments/${ds.cancel}/cancel`, { method: 'POST', body: {} }); await load(); }, 'Cancelled. Your parcels are back in the warehouse.'); return; }
  if (ds.pay) {
    const s = S.d.shipments.find((x) => x.id === ds.pay);
    const courierId = S.pick[s.id] || s.quotes[0]?.courierId;
    await run(async () => {
      const r = await api(`/api/tr/shipments/${s.id}/pay`, { method: 'POST', body: { courierId, payWith: ds.with } });
      if (r.url && !r.url.includes('/app/turkey')) { location.href = r.url; return 'Opening the secure payment page…'; }
      await load(); return 'Paid. We send it the same or next working day.';
    });
    return;
  }
  if (ds.trk) { S.trk = ds.trk; render(); const i = root.querySelector(`[data-trkin="${ds.trk}"]`); i?.focus(); i?.select(); return; }
  if (ds.trksave) { await saveTracking(ds.trksave); return; }
  if (ds.sendone) { S.sel = new Set([ds.sendone]); S.drawer = { kind: 'send', id: null, v: null }; S.lk = { items: [], msg: '', bad: false, busy: false }; render(); return; }
  if (ds.saved != null) { fillAddr(savedAddresses()[Number(ds.saved)], 'Saved address filled in.'); return; }
  if (ds.unphoto != null) { keep(); S.drawer.v.photos = (S.drawer.v.photos || []).filter((_, i) => i !== Number(ds.unphoto)); render(); return; }
  if (ds.buypay) {
    await run(async () => {
      const r = await api(`/api/tr/buy/${ds.buypay}/pay`, { method: 'POST', body: { payWith: ds.with } });
      if (r.url && !r.url.includes('/app/turkey')) { location.href = r.url; return 'Opening the secure payment page…'; }
      await load(); return 'Paid. We order it and it shows in your orders when it is on its way.';
    });
    return;
  }
  if (ds.buycancel) { await run(async () => { await api(`/api/tr/buy/${ds.buycancel}/cancel`, { method: 'POST', body: {} }); await load(); }, 'Request cancelled'); return; }
  const dr = S.drawer;
  switch (ds.act) {
    case 'find': {
      const pc = (root.querySelector('[data-find]')?.value || '').trim();
      keep();
      if (!pc) { S.lk = { ...S.lk, msg: 'Type a postcode first.', bad: true }; render(); break; }
      S.lk = { ...S.lk, pc, busy: true, msg: '', items: [] }; render();
      try {
        const r = await api(`/api/address/lookup?postcode=${encodeURIComponent(pc)}`);
        S.drawer.v = { ...(S.drawer.v || {}), postcode: r.postcode || pc, ...(r.town ? { city: r.town } : {}) };
        S.lk = { ...S.lk, busy: false, items: r.addresses || [], bad: !(r.addresses?.length || r.town),
          msg: r.addresses?.length ? '' : r.suggestions?.length ? `Postcode not found. Did you mean ${r.suggestions.slice(0, 3).join(', ')}?` : r.town ? `Found ${r.town}. Type the street address below.` : 'We could not find that postcode. Type the address below.' };
      } catch (err) { S.lk = { ...S.lk, busy: false, msg: err.message, bad: true }; }
      render(); break;
    }
    case 'locate': {
      keep(); S.lk = { ...S.lk, msg: 'Finding you…', bad: false }; render();
      try { const r = await postcodeHere(); S.lk.pc = r.postcode; render(); root.querySelector('[data-act="find"]')?.click(); } catch (err) { S.lk = { ...S.lk, msg: err.message, bad: true }; render(); }
      break;
    }
    case 'paste': {
      keep(); S.paste = !S.paste; render();
      if (S.paste) { try { const t = await navigator.clipboard?.readText?.(); const box = root.querySelector('[data-pastebox]'); if (t && box) box.value = t; } catch { /* the customer pastes */ } }
      break;
    }
    case 'fillText': {
      const text = root.querySelector('[data-pastebox]')?.value || '';
      if (!text.trim()) { toast('Paste the address first'); break; }
      try { const r = await api('/api/address/from-text', { method: 'POST', body: { text } }); if (r.found) fillAddr(r.address, 'Filled in from your text. Please check it.'); else { S.lk = { ...S.lk, msg: 'We could not find an address in that text.', bad: true }; render(); } } catch (err) { toast(err.message); }
      break;
    }
    case 'sendMsg': {
      const o = { body: root.querySelector('#dr [name="msg"]')?.value || '', photos: dr.v?.photos || [] };
      await run(async () => { await api(`/api/tr/packages/${dr.id}/messages`, { method: 'POST', body: o }); S.drawer = { kind: 'thread', id: dr.id, v: null }; await load(); }, 'Sent to our warehouse team');
      break;
    }
    case 'sendBuy': {
      const o = form();
      await run(async () => { const r = await api('/api/tr/buy', { method: 'POST', body: { url: o.url, details: o.details, qty: Number(o.qty) || 1 } }); S.drawer = null; await load(); return `Request ${r.ref} sent. We email you the price, usually within 1 working day.`; });
      break;
    }
    case 'lines': S.showLines = !S.showLines; render(); break;
    case 'all': { const here = S.d.packages.filter((p) => p.status === 'received'); if (S.sel.size === here.length) S.sel.clear(); else here.forEach((p) => S.sel.add(p.id)); render(); break; }
    case 'saveOrder': {
      const o = form();
      const body = { description: o.description, orderNo: o.orderNo, tracking: o.tracking };
      if ('autoSend' in o) { body.autoSend = Boolean(o.autoSend); body.autoPref = o.autoPref || 'cheapest'; }
      if (!dr.id) { body.store = o.store; body.productUrl = o.productUrl; }
      if (o.autoSend && !S.d.ukAddress) body.address = addrOf(o);
      await run(async () => {
        if (body.address && dr.id) { await api('/api/tr/address', { method: 'POST', body: body.address }); delete body.address; }
        await api(dr.id ? `/api/tr/packages/${dr.id}` : '/api/tr/packages', { method: 'POST', body });
        S.drawer = null; await load();
        return body.autoSend ? 'Saved. We send it as soon as it arrives.' : 'Saved. We match it as soon as it arrives.';
      });
      break;
    }
    case 'removeOrder': await run(async () => { await api(`/api/tr/packages/${dr.id}/remove`, { method: 'POST', body: {} }); S.drawer = null; await load(); }, 'Removed'); break;
    case 'saveAddress': { const a = addrOf(form()); await run(async () => { await api('/api/tr/address', { method: 'POST', body: a }); S.drawer = null; await load(); }, 'Address saved'); break; }
    case 'editSendAddr': S.drawer = { ...dr, edit: true, v: { ...(dr.v || {}), ...form() } }; render(); break;
    case 'sendBox': {
      const o = form();
      const body = { packageIds: [...S.sel], note: o.note, ...(o.line1 != null ? { address: addrOf(o) } : {}) };
      await run(async () => { const r = await api('/api/tr/shipments', { method: 'POST', body }); S.drawer = null; S.sel.clear(); S.stage = 'all'; await load(); return `Box ${r.ref} requested. We email you the price once it is packed.`; });
      break;
    }
    default:
  }
});

(async () => {
  try { const sh = await mountShell('tr'); S.me = sh.me; sh.main.append(root); } catch { location.href = `/login?next=${encodeURIComponent(location.pathname)}`; return; }
  root.innerHTML = '<div class="tw-empty"><b>Loading…</b></div>';
  try {
    await load();
    const paid = new URLSearchParams(location.search).get('paid');
    if (paid) {
      history.replaceState(null, '', '/app/turkey');
      toast(`Payment for ${paid} received. Confirming…`);
      for (let i = 0; i < 10 && (S.d.shipments.some((s) => s.ref === paid && s.status === 'quoted') || S.d.buys.some((b) => b.ref === paid && b.status === 'quoted')); i++) { await new Promise((r) => setTimeout(r, 2000)); await load(); }
    }
  } catch (e) { root.innerHTML = `<div class="tw-empty"><b>${esc(e.message)}</b></div>`; }
})();
