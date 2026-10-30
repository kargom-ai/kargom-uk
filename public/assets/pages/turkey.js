import { mountShell } from '../shell.js';
import { api, esc, gbp, toast } from '../market-ui.js';

/**
 * Shop from Turkey (customer). Compact Istanbul address on top, one list of every order with
 * its stage, pay for packed boxes in place, and a side column with the UK address, a price
 * calculator and the shops. Forms open in a side drawer so the page never jumps around.
 */
const root = document.createElement('div');
root.className = 'tw';
const S = { d: null, me: null, stage: 'all', sel: new Set(), drawer: null, pick: {}, showLines: false, calc: { w: '', l: '', wd: '', h: '' }, calcQ: null, busy: false };

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
const addrLine = (a) => [a.line1, a.line2, a.city, a.postcode].filter(Boolean).join(', ');

function rows() {
  const ships = Object.fromEntries(S.d.shipments.map((s) => [s.id, s]));
  return S.d.packages.filter((p) => p.status !== 'discarded').map((p) => {
    const s = p.shipmentId ? ships[p.shipmentId] : null;
    let stage = p.status === 'expected' ? 'coming' : p.status === 'received' ? 'here' : 'pack';
    if (s) stage = { requested: 'pack', quoted: 'pay', paid: 'ship', shipped: 'sent', delivered: 'done', cancelled: 'here' }[s.status] || stage;
    return { p, s, stage };
  });
}

function addressCard() {
  const d = S.d, a = d.address;
  if (!a) return `<section class="tw-card"><div class="tc-addr"><span class="tc-code"><small>YOUR CODE</small><b>${esc(d.suite)}</b></span>
    <span class="txt"><span class="ttl"><span class="tc-flag">TR</span>Your Istanbul address is almost ready</span><span>We are opening the warehouse. Your address appears here and we email you as soon as it is ready.</span></span></div></section>`;
  const mark = (v) => esc(v).split(esc(d.suite)).join(`<mark>${esc(d.suite)}</mark>`);
  const lines = [['Ad Soyad', a.name], ['Adres', a.line1], ['Adres 2', a.line2], ['İlçe', a.district], ['İl', a.city], ['Posta kodu', a.postcode], ['Telefon', a.phone]].filter((r) => r[1]);
  return `<section class="tw-card"><div class="tc-addr">
    <span class="tc-code"><small>YOUR CODE</small><b>${esc(d.suite)}</b></span>
    <span class="txt"><span class="ttl"><span class="tc-flag">TR</span>Your Istanbul address</span>
      <span>${mark(a.name)} · ${mark([a.line1, a.line2].filter(Boolean).join(', '))} · ${esc([a.district, a.city].filter(Boolean).join(' / '))} ${esc(a.postcode)} · ${esc(a.phone)}</span>
      <span class="tw-muted">Put <b>${esc(d.suite)}</b> after your name on every order, so we know it is yours.</span></span>
    <span class="tw-acts"><button type="button" class="tw-btn" data-copy="${esc(lines.map((r) => r[1]).concat('Türkiye').join('\n'))}">Copy address</button>
      <button type="button" class="tw-btn ghost" data-act="lines" aria-expanded="${S.showLines}">${S.showLines ? 'Hide lines' : 'Copy line by line'}</button></span></div>
    ${S.showLines ? `<div class="tc-fields">${lines.map(([k, v]) => `<div class="tc-field"><span><small>${esc(k)}</small><b>${mark(v)}</b></span><button type="button" class="tc-copy" data-copy="${esc(v)}">Copy</button></div>`).join('')}</div>` : ''}
  </section>`;
}

function stats(all) {
  const tiles = [['coming', 'On the way to us'], ['here', 'In our warehouse'], ['pay', 'Ready to pay'], ['sent', 'On the way to you']];
  return `<div class="tw-stats">${tiles.map(([k, l]) => {
    const n = k === 'pay' ? S.d.shipments.filter((s) => s.status === 'quoted').length : k === 'sent' ? all.filter((r) => ['ship', 'sent'].includes(r.stage)).length : all.filter((r) => r.stage === k).length;
    return `<button type="button" class="tw-stat" data-stage="${k}" aria-pressed="${S.stage === k}"><span class="ic" style="background:${STAGE[k][1]}"><i style="background:${STAGE[k][2]}"></i></span><span>${l}<b>${n}</b></span></button>`;
  }).join('')}</div>`;
}

function payPanels() {
  const boxes = S.d.shipments.filter((s) => s.status === 'quoted');
  if (!boxes.length || !['all', 'pay'].includes(S.stage)) return '';
  return boxes.map((s) => {
    const pick = S.pick[s.id] || s.quotes[0]?.courierId;
    const q = s.quotes.find((x) => x.courierId === pick) || s.quotes[0];
    const n = S.d.packages.filter((p) => p.shipmentId === s.id).length;
    const enough = S.d.balancePence >= q.pence;
    return `<div class="tc-pay"><div class="tc-pay-h"><b>Box ${esc(s.ref)} is packed: choose a courier</b><span class="tw-muted">${n} parcel${n > 1 ? 's' : ''} · ${kg(s.weightKg)} · ${esc(s.dims || '')} cm · to ${esc(s.address.city)} ${esc(s.address.postcode)}</span></div>
      <div class="tw-opts">${s.quotes.map((x) => `<label class="tw-opt"><input type="radio" name="c_${s.id}" value="${x.courierId}" data-pick="${s.id}" ${x.courierId === q.courierId ? 'checked' : ''}>
        <span class="n"><b>${esc(x.name)}</b><span>${x.daysMin}–${x.daysMax} working days · shipping ${gbp(x.breakdown.shipping + x.breakdown.fuel)} + handling ${gbp(x.breakdown.handling)}${x.breakdown.consolidation ? ` + combining ${gbp(x.breakdown.consolidation)}` : ''}${x.breakdown.storage ? ` + storage ${gbp(x.breakdown.storage)}` : ''}</span></span><span class="p">${gbp(x.pence)}</span></label>`).join('')}</div>
      <div class="tw-acts"><button type="button" class="tw-btn big" data-pay="${s.id}" data-with="card">Pay ${gbp(q.pence)} by card</button>
        <button type="button" class="tw-btn big ghost" data-pay="${s.id}" data-with="wallet" ${enough ? '' : 'disabled'} title="Wallet balance ${gbp(S.d.balancePence)}">Pay from wallet (${gbp(S.d.balancePence)})</button>
        <button type="button" class="tw-btn ghost" data-cancel="${s.id}" style="margin-left:auto">Cancel, keep my parcels</button></div>
      <span class="tw-muted">UK import VAT, and duty over £135, may be due: the courier asks you for it before delivery.</span></div>`;
  }).join('');
}

function listCard(all) {
  const chips = [['all', 'All'], ['coming', 'On the way to us'], ['here', 'In our warehouse'], ['pay', 'Ready to pay'], ['sent', 'On the way to you'], ['done', 'Delivered']];
  const inStage = (r, k) => k === 'all' || r.stage === k || (k === 'sent' && r.stage === 'ship') || (k === 'pay' && r.stage === 'pay');
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
      const sub = stage === 'coming' ? (p.tracking ? `<span class="mono">${esc(p.tracking)}</span>` : '<span style="color:#9A5B00">Add the tracking number</span>')
        : stage === 'here' ? `Arrived ${day(p.receivedAt)} · ${p.storagePence ? `<b style="color:#B42318">storage ${gbp(p.storagePence)}</b>` : `free until ${day(p.freeUntil)}`}`
          : s ? `<span class="mono">${esc(s.ref)}</span>${s.trackingNo ? ` · ${esc(s.courierName)} <span class="mono">${esc(s.trackingNo)}</span>` : ''}` : '';
      const act = stage === 'coming' ? `<button type="button" class="tw-btn ghost sm" data-open="order" data-id="${p.id}">Edit</button>`
        : stage === 'here' ? `<button type="button" class="tw-btn ghost sm" data-open="order" data-id="${p.id}">Edit</button>`
          : stage === 'sent' && s.trackingUrl ? `<a class="tw-btn sm" href="${esc(s.trackingUrl)}" target="_blank" rel="noopener">Track</a>` : '';
      const tags = p.autoSend && ['coming', 'here'].includes(stage) ? ` <span class="tw-tag blue">⚡ Sends on arrival</span>` : p.hold && stage === 'here' ? ' <span class="tw-tag">Keeping</span>' : '';
      return `<tr class="${S.sel.has(p.id) ? 'sel' : ''}"><td class="cb">${stage === 'here' ? `<input type="checkbox" data-sel="${p.id}" ${S.sel.has(p.id) ? 'checked' : ''} aria-label="Choose ${esc(p.description)}">` : ''}</td>
        <td><span class="two"><b>${esc(p.description || 'Add what is in it')}</b><small>${esc(p.store || '')}${p.valueTry ? ` · ${tl(p.valueTry)}` : ''}</small></span></td>
        <td><span class="two"><small style="color:var(--ink);font-size:13px">${sub}</small></span></td>
        <td>${p.weightKg ? kg(p.weightKg) : '<span class="tw-muted">–</span>'}</td>
        <td>${pill(stage)}${tags}</td><td>${act}</td></tr>`;
    }).join('')}</tbody></table></div>` : empty}
    ${chosen.length ? `<div class="tc-bar"><span class="t"><b>${chosen.length} parcel${chosen.length > 1 ? 's' : ''} · ${kg(chosen.reduce((a, r) => a + (r.p.weightKg || 0), 0))}${chosen.length > 1 ? ' · packed into one box' : ''}</b>${uk ? `To ${esc(uk.name)}, ${esc(addrLine(uk))}` : 'Add your UK address next'}</span>
      <button type="button" class="tw-btn" data-open="send" style="min-height:44px">Send to the UK →</button></div>` : ''}
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
      <div class="tc-shops">${SHOPS.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${n}</a>`).join('')}</div>
      <div><div class="tc-kv"><span>Free storage</span><b>${f.freeDays} days</b></div><div class="tc-kv"><span>Handling per box</span><b>${gbp(f.handlingPence)}</b></div>
        <div class="tc-kv"><span>Each extra parcel in a box</span><b>${gbp(f.consolidatePence)}</b></div></div>
      <span class="tw-muted">Not allowed: loose batteries, perfume and aerosols over courier limits, weapons, medicines, food that spoils.</span></div></section>
  </div>`;
}
function calcRes() {
  if (!S.calcQ) return '<span class="tw-muted">Type the weight. Add the box size for a closer price.</span>';
  if (!S.calcQ.length) return '<span class="tw-muted">No price for this size yet. Ask us in Help.</span>';
  return `${S.calcQ.map((x) => `<div><span>${esc(x.name)}<small>${x.daysMin}–${x.daysMax} working days · ${x.chargeableKg} kg</small></span><b>${gbp(x.pence)}</b></div>`).join('')}<span class="tw-muted">Includes handling. Your final price comes from the packed box.</span>`;
}

// ---------- drawers
const addrFields = (a = {}) => `<div class="tw-row"><label class="tw-f">Full name<input class="tw-in" name="name" value="${esc(a.name || S.me?.name || '')}" autocomplete="name"></label>
  <label class="tw-f">Phone<input class="tw-in" name="phone" value="${esc(a.phone || S.me?.phone || '')}" autocomplete="tel" placeholder="07…"></label></div>
  <label class="tw-f">Address<input class="tw-in" name="line1" value="${esc(a.line1 || '')}" autocomplete="address-line1"></label>
  <label class="tw-f">Address line 2 <em>(optional)</em><input class="tw-in" name="line2" value="${esc(a.line2 || '')}" autocomplete="address-line2"></label>
  <div class="tw-row"><label class="tw-f">Town or city<input class="tw-in" name="city" value="${esc(a.city || '')}" autocomplete="address-level2"></label>
  <label class="tw-f">Postcode<input class="tw-in" name="postcode" value="${esc(a.postcode || '')}" autocomplete="postal-code" style="text-transform:uppercase"></label></div>`;

function drawerHtml() {
  const dr = S.drawer;
  if (!dr) return '';
  let h = '', b = '', f = '';
  if (dr.kind === 'order') {
    const p = dr.id ? S.d.packages.find((x) => x.id === dr.id) : {};
    const v = { ...p, ...(dr.v || {}) };
    const auto = v.autoSend === true || v.autoSend === 'on';
    h = `<h2>${dr.id ? 'Edit order' : 'Add an order'}</h2><p>So we can match your parcel the moment it arrives, and fill in the customs form.</p>`;
    b = `<div class="tw-row"><label class="tw-f">Shop<select class="tw-in" name="store" ${dr.id ? 'disabled' : ''}>${S.d.stores.map((s) => `<option ${s === (v.store || 'Trendyol') ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
        <label class="tw-f">Price paid<span class="tw-unit" data-u="TL"><input class="tw-in" name="valueTry" inputmode="numeric" value="${esc(v.valueTry || '')}" placeholder="1250"></span></label></div>
      <label class="tw-f">What is it? <em>(in English, for customs)</em><input class="tw-in" name="description" value="${esc(v.description || '')}" placeholder="e.g. 2 cotton T-shirts"></label>
      <div class="tw-row"><label class="tw-f">Order number <em>(optional)</em><input class="tw-in" name="orderNo" value="${esc(v.orderNo || '')}"></label>
        <label class="tw-f">Tracking in Turkey <em>(add later)</em><input class="tw-in" name="tracking" value="${esc(v.tracking || '')}" placeholder="Yurtiçi, Aras, TEX…"></label></div>
      ${!dr.id || p.status === 'expected' ? `<label class="tw-switch"><input type="checkbox" name="autoSend" ${auto ? 'checked' : ''}><span><b>Send it as soon as it arrives</b>We weigh it, price it and send it to your UK address. If your wallet has enough money we take it from there, so nothing waits.</span></label>
      ${auto ? `<div class="tw-seg" role="radiogroup" aria-label="Courier choice"><label><input type="radio" name="autoPref" value="cheapest" ${v.autoPref !== 'fastest' ? 'checked' : ''}>Cheapest courier</label><label><input type="radio" name="autoPref" value="fastest" ${v.autoPref === 'fastest' ? 'checked' : ''}>Fastest courier</label></div>
        ${S.d.ukAddress ? `<span class="tw-muted">Sending to ${esc(S.d.ukAddress.name)}, ${esc(addrLine(S.d.ukAddress))} · wallet ${gbp(S.d.balancePence)}</span>` : `<b style="font-size:14px">Your UK address</b>${addrFields(v)}`}` : ''}` : ''}`;
    f = `<button type="button" class="tw-btn big" data-act="saveOrder">${dr.id ? 'Save' : 'Add order'}</button>${dr.id && p.status === 'expected' ? '<button type="button" class="tw-btn ghost" data-act="removeOrder" style="color:#B42318">Remove</button>' : ''}`;
  } else if (dr.kind === 'address') {
    h = '<h2>Your UK address</h2><p>Where we send your boxes from Turkey.</p>';
    b = addrFields({ ...(S.d.ukAddress || {}), ...(dr.v || {}) });
    f = '<button type="button" class="tw-btn big" data-act="saveAddress">Save address</button>';
  } else if (dr.kind === 'send') {
    const chosen = S.d.packages.filter((p) => S.sel.has(p.id));
    const uk = S.d.ukAddress;
    h = `<h2>Send ${chosen.length} parcel${chosen.length > 1 ? 's' : ''} to the UK</h2><p>${chosen.length > 1 ? 'We pack them into one box, so you pay one shipping price.' : 'We check it and pack it.'}</p>`;
    b = `<div class="tw-note">${chosen.map((p) => `• ${esc(p.description)} <span class="tw-muted">(${esc(p.store)}, ${kg(p.weightKg)})</span>`).join('<br>')}</div>
      ${uk && !dr.edit ? `<div class="tw-f">Deliver to<span style="font-weight:500;color:var(--ink);font-size:14px;line-height:1.5">${esc(uk.name)}, ${esc(addrLine(uk))} · ${esc(uk.phone)} <button type="button" class="tw-btn ghost sm" data-act="editSendAddr">Change</button></span></div>` : addrFields({ ...(uk || {}), ...(dr.v || {}) })}
      <label class="tw-f">Note for the warehouse <em>(optional)</em><input class="tw-in" name="note" value="${esc(dr.v?.note || '')}" placeholder="e.g. remove the shoe boxes to save space"></label>
      <div class="tw-note warn">Next: we weigh the packed box and send you the price of each courier, usually within 1 working day. You pay only after you choose.</div>`;
    f = '<button type="button" class="tw-btn big" data-act="sendBox">Ask for the price</button>';
  }
  return `<div class="tw-dim" data-dim><aside class="tw-drawer" role="dialog" aria-modal="true" id="dr">
    <div class="tw-drawer-h"><div>${h}</div><button type="button" class="tw-x" data-close aria-label="Close">×</button></div>
    <div class="tw-drawer-b">${b}</div><div class="tw-drawer-f">${f.replace(/<button /g, `<button ${S.busy ? 'disabled ' : ''}`)}</div></aside></div>`;
}

function render() {
  const all = rows();
  root.innerHTML = `<div class="tw-head"><div><h1>Shop from Turkey</h1><p>Buy from Turkish shops with your own Istanbul address. We send it to your door in the UK.</p></div>
      <div class="tw-acts"><button type="button" class="tw-btn big" data-open="order">+ Add an order</button></div></div>
    ${addressCard()}${stats(all)}
    <div class="tc-cols">${listCard(all)}${sideCol()}</div>${drawerHtml()}`;
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

root.addEventListener('input', (e) => { const k = e.target.dataset.c; if (k) { S.calc[k] = e.target.value; calc(); } });
root.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.sel) { t.checked ? S.sel.add(t.dataset.sel) : S.sel.delete(t.dataset.sel); render(); }
  if (t.dataset.pick) { S.pick[t.dataset.pick] = t.value; render(); }
  if (t.name === 'autoSend' || t.name === 'autoPref') { S.drawer.v = { ...(S.drawer.v || {}), ...form(), autoSend: t.name === 'autoSend' ? t.checked : form().autoSend }; render(); }
});
root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.drawer) { S.drawer = null; render(); } });
root.addEventListener('click', async (e) => {
  if (e.target.matches('[data-dim]')) { S.drawer = null; render(); return; }
  const b = e.target.closest('button, [data-copy]');
  if (!b) return;
  const ds = b.dataset;
  if (ds.copy != null) { try { await navigator.clipboard.writeText(ds.copy); toast('Copied'); } catch { toast(ds.copy); } return; }
  if ('close' in ds) { S.drawer = null; render(); return; }
  if (ds.stage) { S.stage = S.stage === ds.stage && b.classList.contains('tw-stat') ? 'all' : ds.stage; render(); return; }
  if (ds.open) { S.drawer = { kind: ds.open, id: ds.id || null, v: null }; render(); root.querySelector('#dr input:not([type=checkbox]), #dr select')?.focus(); return; }
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
  const dr = S.drawer;
  switch (ds.act) {
    case 'lines': S.showLines = !S.showLines; render(); break;
    case 'all': { const here = S.d.packages.filter((p) => p.status === 'received'); if (S.sel.size === here.length) S.sel.clear(); else here.forEach((p) => S.sel.add(p.id)); render(); break; }
    case 'saveOrder': {
      const o = form();
      const body = { description: o.description, valueTry: Number(String(o.valueTry || '').replace(/[^\d]/g, '')) || 0, orderNo: o.orderNo, tracking: o.tracking };
      if ('autoSend' in o) { body.autoSend = Boolean(o.autoSend); body.autoPref = o.autoPref || 'cheapest'; }
      if (!dr.id) body.store = o.store;
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
      for (let i = 0; i < 10 && S.d.shipments.some((s) => s.ref === paid && s.status === 'quoted'); i++) { await new Promise((r) => setTimeout(r, 2000)); await load(); }
    }
  } catch (e) { root.innerHTML = `<div class="tw-empty"><b>${esc(e.message)}</b></div>`; }
})();
