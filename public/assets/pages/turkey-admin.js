import { mountAdminShell } from '../admin-shell.js';
import { api, esc, gbp, toast } from '../market-ui.js';
import { shopLogo, productThumb, threadHtml, composerHtml, readPhotos, courierLogo, CHAT_ICON } from '../turkey-ui.js';
import { resizeImage } from '../market-ui.js';

/**
 * Admin: Turkey warehouse, inside the normal admin frame.
 * One list of every customer order with its stage; each stage has one clear action
 * (arrived → pack & price → ship → delivered). Couriers and settings live on their own tabs.
 */
let root, shell;
const S = { d: null, view: new URLSearchParams(location.search).get('tab') || 'list', stage: 'all', q: '', drawer: null, preview: null, busy: false };

const STAGE = {
  coming: ['Coming to warehouse', '#FFF4E0', '#9A5B00'],
  here: ['In warehouse', '#E6F4EA', '#166534'],
  pack: ['To pack', '#EAF2FE', '#1D4FB8'],
  pay: ['Awaiting payment', '#F1E9FE', '#5B2BB5'],
  ship: ['Ready to ship', '#FDECEC', '#B42318'],
  sent: ['Shipped', '#E3F6F5', '#0F766E'],
  done: ['Delivered', '#EEF2F7', '#3E4A5C'],
  gone: ['Discarded', '#EEF2F7', '#8593A8'],
};
const STAT_ORDER = ['coming', 'here', 'pack', 'pay', 'ship', 'sent'];
const kg = (v) => (v == null ? '–' : `${Number(v).toFixed(2).replace(/\.?0+$/, '')} kg`);
const tl = (v) => (v ? `${Number(v).toLocaleString('tr-TR')} TL` : '');
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const daysSince = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0);
const pill = (k) => `<span class="tw-pill" style="background:${STAGE[k][1]};color:${STAGE[k][2]}"><i></i>${STAGE[k][0]}</span>`;
const pounds = (p) => (p / 100).toFixed(2);
const logo = (store, size) => shopLogo(store, S.d?.shopLogos || [], size);
// Customer picture links → the admin's own picture route.
const thumb = (image, store, size) => productThumb(image ? image.replace('/api/tr/img/', '/api/admin/tr/img/') : null, store, S.d?.shopLogos || [], size);
const notesFor = (id) => (S.d?.notes || []).filter((n) => n.packageId === id);
const BUY = { requested: ['New request', '#FDECEC', '#B42318'], quoted: ['Priced, waiting for payment', '#F1E9FE', '#5B2BB5'], paid: ['Paid: order it', '#FFF4E0', '#9A5B00'],
  ordered: ['Ordered', '#E6F4EA', '#166534'], rejected: ['Rejected', '#EEF2F7', '#586579'], cancelled: ['Cancelled by customer', '#EEF2F7', '#586579'] };
const custLink = (id, name) => `<a class="tw-link" href="/admin?customer=${encodeURIComponent(id)}" title="Open customer profile">${esc(name)}</a>`;
function msgBtn(p) {
  const n = notesFor(p.id);
  const last = n[n.length - 1];
  return `<button type="button" class="tw-msgbtn ${last?.author === 'customer' ? 'has' : ''}" data-open="thread" data-id="${p.id}" title="${last?.author === 'customer' ? 'Customer wrote last' : 'Messages and photos'}">${CHAT_ICON}${n.length || ''}</button>`;
}

/** Boxes count once, loose parcels count each. */
const uniq = (list) => new Set(list.map((r) => (r.s && !['here', 'coming'].includes(r.stage) ? r.s.id : r.p.id))).size;

/** One row per customer order, with the stage of the box it is in. */
function rows() {
  const ships = Object.fromEntries(S.d.shipments.map((s) => [s.id, s]));
  return S.d.packages.map((p) => {
    const s = p.shipmentId ? ships[p.shipmentId] : null;
    let stage = p.status === 'expected' ? 'coming' : p.status === 'received' ? 'here' : p.status === 'discarded' ? 'gone' : 'pack';
    if (s) stage = { requested: 'pack', quoted: 'pay', paid: 'ship', shipped: 'sent', delivered: 'done', cancelled: 'here' }[s.status] || stage;
    const at = s ? (s.deliveredAt || s.shippedAt || s.paidAt || s.quotedAt || s.createdAt) : (p.receivedAt || p.createdAt);
    return { p, s, stage, at };
  });
}

function statCards(all) {
  const n = (k) => uniq(all.filter((r) => r.stage === k));
  return `<div class="tw-stats">${STAT_ORDER.map((k) => `<button type="button" class="tw-stat" data-stage="${k}" aria-pressed="${S.stage === k}">
    <span class="ic" style="background:${STAGE[k][1]}"><i style="background:${STAGE[k][2]}"></i></span><span>${STAGE[k][0]}<b>${n(k)}</b></span></button>`).join('')}</div>`;
}

function actionFor(r) {
  if (r.stage === 'coming') return `<button type="button" class="tw-btn sm" data-open="arrive" data-id="${r.p.id}">Arrived</button>`;
  if (r.stage === 'pack') return `<button type="button" class="tw-btn sm" data-open="pack" data-id="${r.s.id}">Pack &amp; price</button>`;
  if (r.stage === 'ship') return `<button type="button" class="tw-btn sm green" data-open="ship" data-id="${r.s.id}">Ship</button>`;
  if (r.stage === 'pay') return `<span class="tw-muted">${gbp(r.s.quotes?.[0]?.pence || 0)}+</span>`;
  if (r.stage === 'sent') return `<button type="button" class="tw-btn ghost sm" data-deliv="${r.s.id}">Delivered</button>`;
  if (r.stage === 'here') return `<button type="button" class="tw-btn ghost sm" data-open="note" data-id="${r.p.id}">Note</button>`;
  return '';
}

function listView() {
  const all = rows().filter((r) => r.stage !== 'gone' || S.stage === 'all');
  const q = S.q.trim().toLowerCase();
  let list = all.filter((r) => (S.stage === 'all' || r.stage === S.stage) && (!q || JSON.stringify([r.p, r.s?.ref, r.s?.trackingNo]).toLowerCase().includes(q)));
  // Work queues: oldest first. Everything else: newest first.
  const queue = ['coming', 'here', 'pack', 'ship'].includes(S.stage);
  list = list.sort((a, b) => (queue ? 1 : -1) * String(a.at).localeCompare(String(b.at)));
  const chips = [['all', 'All'], ...STAT_ORDER.map((k) => [k, STAGE[k][0]]), ['done', 'Delivered']];
  const count = (k) => (k === 'all' ? all.length : uniq(all.filter((r) => r.stage === k)));
  const hereView = S.stage === 'here';
  return `${statCards(all)}
  <section class="tw-card">
    <div class="tw-card-h"><h2>${S.stage === 'all' ? 'All shipments' : STAGE[S.stage][0]}</h2>
      <label class="tw-search"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8593A8" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-4-4"></path></svg>
        <input id="q" placeholder="Code, name, tracking, TR-…" value="${esc(S.q)}" aria-label="Search"></label></div>
    <div class="tw-chips">${chips.map(([k, l]) => `<button type="button" class="tw-chip" data-stage="${k}" aria-pressed="${S.stage === k}">${l} · ${count(k)}</button>`).join('')}</div>
    <div style="overflow-x:auto"><table class="tw-tbl"><thead><tr><th>Customer</th><th>Item</th><th>Tracking in Turkey</th><th>Weight · size</th><th>${hereView ? 'Waiting' : 'Box'}</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map((r) => {
      const p = r.p;
      const tags = [p.autoSend && ['coming', 'here'].includes(r.stage) ? `<span class="tw-tag blue">⚡ Send on arrival · ${p.autoPref}</span>` : '', p.hold && r.stage === 'here' ? '<span class="tw-tag">Keep</span>' : ''].join(' ');
      const wait = daysSince(p.receivedAt);
      return `<tr><td><span class="two"><b>${custLink(p.customerId, p.customer)}</b><small class="mono">${esc(p.suite || '')}</small></span></td>
        <td><span class="tw-item">${thumb(p.image, p.store, 40)}<span class="two"><b>${esc(p.description || 'No description yet')}</b><small>${p.productUrl ? `<a class="tw-link" style="font-weight:600" href="${esc(p.productUrl)}" target="_blank" rel="noopener nofollow">${esc(p.productTitle || p.store || 'Product')} ↗</a> · ` : `${esc(p.store || '')}`}${p.valueTry ? ` · ${tl(p.valueTry)}` : ''}</small></span></span></td>
        <td class="mono">${esc(p.tracking || '–')}</td>
        <td><span class="two"><b>${kg(p.weightKg)}</b><small>${esc(p.dims ? `${p.dims} cm` : '')}</small></span></td>
        <td>${hereView ? `<span class="two"><b style="color:${wait > S.d.settings.freeDays ? '#B42318' : 'inherit'}">${wait} day${wait === 1 ? '' : 's'}</b><small>since ${day(p.receivedAt)}</small></span>`
          : r.s ? `<span class="two"><b class="mono">${esc(r.s.ref)}</b><small>${r.s.courierName ? esc(r.s.courierName) : `${S.d.packages.filter((x) => x.shipmentId === r.s.id).length} parcel(s)`}</small></span>` : '<span class="tw-muted">–</span>'}</td>
        <td><span class="two" style="gap:4px;align-items:flex-start">${pill(r.stage)}${tags}</span></td>
        <td><span class="tw-acts-row">${msgBtn(p)}${actionFor(r)}</span></td></tr>`;
    }).join('') || `<tr><td colspan="7"><div class="tw-empty"><b>Nothing here</b>${S.q ? 'Try another search.' : 'New orders show up here as soon as customers add them.'}</div></td></tr>`}
    </tbody></table></div>
  </section>`;
}

const ratesText = (rates) => (rates || []).map(([k, p]) => `${k} = ${pounds(p)}`).join('\n');
function buyView() {
  const order = ['requested', 'paid', 'quoted', 'ordered', 'rejected', 'cancelled'];
  const list = [...(S.d.buys || [])].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || String(a.createdAt).localeCompare(String(b.createdAt)));
  return `<section class="tw-card"><div class="tw-card-h"><h2>Buy it for me</h2><span class="tw-muted">Customers paste a link, you price it, they pay, you order it.</span></div>
    <div style="overflow-x:auto;margin-top:12px"><table class="tw-tbl"><thead><tr><th>Customer</th><th>Product</th><th>Qty</th><th>Price</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map((b) => `<tr><td><span class="two"><b>${custLink(b.customerId, b.customer)}</b><small class="mono">${esc(b.ref)} · ${esc(b.suite || '')}</small></span></td>
      <td><span class="tw-item">${thumb(b.image, b.store, 52)}<span class="two" style="max-width:360px"><b><a class="tw-link" href="${esc(b.url)}" target="_blank" rel="noopener nofollow">${esc(b.title || b.store || 'Link')} ↗</a></b><small>${esc(b.details || b.url)}</small></span></span></td>
      <td>${b.qty}</td><td>${b.pricePence ? `<b>${gbp(b.pricePence)}</b>${b.itemTry ? `<br><small class="tw-muted">${tl(b.itemTry)}</small>` : ''}` : '–'}</td>
      <td><span class="tw-pill" style="background:${BUY[b.status][1]};color:${BUY[b.status][2]}"><i></i>${BUY[b.status][0]}</span></td>
      <td>${['requested', 'quoted'].includes(b.status) ? `<button type="button" class="tw-btn sm" data-open="buyquote" data-id="${b.id}">${b.status === 'quoted' ? 'Change price' : 'Price it'}</button>`
        : b.status === 'paid' ? `<button type="button" class="tw-btn sm green" data-open="buyorder" data-id="${b.id}">Ordered</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="6"><div class="tw-empty"><b>No requests yet</b>When a customer asks you to buy something, it shows here.</div></td></tr>'}</tbody></table></div></section>`;
}

function courView() {
  return `<section class="tw-card"><div class="tw-card-h"><h2>Couriers and prices</h2><button type="button" class="tw-btn" data-open="courier">+ Add courier</button></div>
    <p class="tw-muted" style="margin:6px 20px 0">The price list is what the customer pays for shipping. Handling, combining and storage from Settings are added on top.</p>
    <div style="overflow-x:auto;margin-top:12px"><table class="tw-tbl"><thead><tr><th>Courier</th><th>Shown to customers</th><th>Price list</th><th>Extra kg</th><th>Fuel</th><th>Days</th><th></th></tr></thead><tbody>
    ${S.d.couriers.map((c) => `<tr><td><span class="tw-item">${courierLogo(c.logoUrl) || '<span class="tw-clogo"><small class="tw-muted">no logo</small></span>'}<span class="two"><b>${esc(c.name)}</b><small>${esc(c.note || '')}</small></span></span></td>
      <td><span class="tw-item"><button type="button" class="tw-toggle" role="switch" aria-checked="${c.active}" data-active="${c.id}" aria-label="Show ${esc(c.name)} to customers"></button><span class="tw-muted">${c.active ? 'On' : 'Off'}</span></span></td>
      <td style="white-space:pre;font-size:13px">${esc(ratesText(c.rates))}</td><td>${c.extraKgPence ? gbp(c.extraKgPence) : '–'}</td><td>${c.fuelBp / 100}%</td><td>${c.daysMin}–${c.daysMax}</td>
      <td><button type="button" class="tw-btn ghost sm" data-open="courier" data-id="${c.id}">Edit</button></td></tr>`).join('')
      || '<tr><td colspan="7"><div class="tw-empty"><b>No couriers yet</b>Customers cannot get a price until you add one.</div></td></tr>'}</tbody></table></div></section>`;
}

function setView() {
  const s = S.d.settings;
  const f = (k, label, v, ph = '') => `<label class="tw-f">${label}<input class="tw-in" name="${k}" value="${esc(v)}" placeholder="${esc(ph)}"></label>`;
  return `<section class="tw-card" id="sf"><div class="tw-card-h"><h2>Warehouse address</h2></div><div class="tw-pad">
    <span class="tw-muted">Customers see this, with their own KG code added after their name and on address line 2.</span>
    <div class="tw-row">${f('whName', 'Warehouse name', s.whName)}${f('whPhone', 'Phone (shops ask for one)', s.whPhone, '+90 5xx xxx xx xx')}</div>
    <div class="tw-row">${f('whLine1', 'Address (mahalle, sokak, no)', s.whLine1)}${f('whLine2', 'Address 2 (bina, kat, depo)', s.whLine2)}</div>
    <div class="tw-row">${f('whDistrict', 'İlçe', s.whDistrict)}${f('whCity', 'İl', s.whCity)}${f('whPostcode', 'Posta kodu', s.whPostcode)}</div></div>
    <div class="tw-card-h" style="padding-top:4px"><h2>Fees</h2></div><div class="tw-pad">
    <div class="tw-row">${f('handlingPence', 'Handling per box (£)', pounds(s.handlingPence))}${f('consolidatePence', 'Combining, per extra parcel (£)', pounds(s.consolidatePence))}
      ${f('freeDays', 'Free storage (days)', s.freeDays)}${f('storagePencePerDay', 'Then per parcel per day (£)', pounds(s.storagePencePerDay))}</div>
    <div><button type="button" class="tw-btn big" data-act="saveSet">Save settings</button></div></div></section>
  <section class="tw-card"><div class="tw-card-h"><h2>Test a product link</h2></div><div class="tw-pad">
    <span class="tw-muted">Paste a Trendyol, Hepsiburada… link to see what our server can read from it (name, price, picture). If the shop blocks us, the steps show where.</span>
    <div class="tc-find"><input class="tw-in" id="pvurl" placeholder="https://www.trendyol.com/…" style="text-transform:none"><button type="button" class="tw-btn" data-act="pvtest">Test</button></div>
    ${S.pvtest ? `<div class="tw-note" style="font-family:ui-monospace,Menlo,monospace;font-size:12px;white-space:pre-wrap">${esc(S.pvtest)}</div>` : ''}</div></section>`;
}

// ---------- drawers
const cell = (attr, k, label, unit, v, dec) => `<label><small>${label}</small><span class="tw-unit" data-u="${unit}"><input class="tw-in" ${attr}="${k}" inputmode="${dec ? 'decimal' : 'numeric'}" value="${esc(v ?? '')}"></span></label>`;
const dimsHtml = (v) => (v = v || {}, `<div class="tw-dims">${cell('name', 'w', 'Weight', 'kg', v.w, 1)}${cell('name', 'l', 'Length', 'cm', v.l)}${cell('name', 'wd', 'Width', 'cm', v.wd)}${cell('name', 'h', 'Height', 'cm', v.h)}</div>`);
const quotesHtml = (qs) => (qs?.length ? `<div class="tw-opts">${qs.map((x) => `<div class="tw-opt">${courierLogo(S.d.couriers.find((c) => c.id === x.courierId)?.logoUrl)}<span class="n"><b>${esc(x.name)}</b><span>${x.chargeableKg} kg charged · ${x.daysMin}–${x.daysMax} days · shipping ${gbp(x.breakdown.shipping + x.breakdown.fuel)}, fees ${gbp(x.breakdown.handling + x.breakdown.consolidation + x.breakdown.storage)}</span></span><span class="p">${gbp(x.pence)}</span></div>`).join('')}</div>` : '');
const addrText = (a) => [a.name, a.line1, a.line2, a.city, a.postcode].filter(Boolean).join(', ');

function drawerHtml() {
  const dr = S.drawer;
  if (!dr) return '';
  const pkg = (id) => S.d.packages.find((p) => p.id === id);
  const shp = (id) => S.d.shipments.find((s) => s.id === id);
  let h = '', b = '', f = '';
  if (dr.kind === 'arrive') {
    const p = pkg(dr.id);
    h = `<h2>Parcel arrived</h2><p>${esc(p.customer)} · ${esc(p.suite)} · ${esc(p.store)}</p>`;
    b = `<div class="tw-note"><b>${esc(p.description)}</b><br>${tl(p.valueTry)}${p.tracking ? ` · tracking ${esc(p.tracking)}` : ''}</div>
      ${p.autoSend ? `<div class="tw-note warn">⚡ The customer asked to send this <b>as soon as it arrives</b> (${p.autoPref}). After you save, it is priced and paid from their wallet automatically, if the money is there.</div>` : ''}
      ${dimsHtml(dr.v)}
      <label class="tw-f">Item value <em>(for customs: check it on the shop page${p.productUrl ? ` · <a href="${esc(p.productUrl)}" target="_blank" rel="noopener nofollow">open the link ↗</a>` : ''})</em><span class="tw-unit" data-u="TL"><input class="tw-in" name="valueTry" inputmode="numeric" value="${esc(dr.v?.valueTry ?? p.valueTry ?? '')}"></span></label>
      <label class="tw-f">Note for the customer <em>(damage, missing items…)</em><input class="tw-in" name="note" value="${esc(dr.v?.note || '')}"></label>
      <div class="tw-f">Photos <em>(optional: damage, contents, label)</em>${dr.v?.photos?.length ? `<div class="tw-photos" style="margin-top:6px">${dr.v.photos.map((ph, i) => `<span class="tw-ph"><img src="${ph}" alt=""><button type="button" data-unphoto="${i}" aria-label="Remove photo">×</button></span>`).join('')}</div>` : ''}
        <label class="tw-btn ghost sm" style="margin-top:6px">📷 Add photos<input type="file" accept="image/*" multiple data-photos hidden></label></div>`;
    f = `<button type="button" class="tw-btn big" data-act="arrive">Mark as arrived</button>`;
  } else if (dr.kind === 'scan') {
    h = '<h2>Receive a parcel</h2><p>Scan the tracking number. It matches the customer\'s order by itself; if nobody told us about it, add the KG code from the label.</p>';
    const v = dr.v || {};
    b = `<label class="tw-f">Tracking number<input class="tw-in" name="tracking" value="${esc(v.tracking || '')}" autofocus></label>
      <label class="tw-f">KG code <em>(only if there was no order)</em><input class="tw-in" name="suite" value="${esc(v.suite || '')}" placeholder="KG12345" style="text-transform:uppercase"></label>
      ${dimsHtml(v)}
      <div class="tw-row"><label class="tw-f">Shop<select class="tw-in" name="store">${S.d.stores.map((s) => `<option ${s === v.store ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
      <label class="tw-f">What is in it<input class="tw-in" name="description" value="${esc(v.description || '')}"></label></div>
      <label class="tw-f">Item value <em>(for customs)</em><span class="tw-unit" data-u="TL"><input class="tw-in" name="valueTry" inputmode="numeric" value="${esc(v.valueTry || '')}"></span></label>
      <label class="tw-f">Note for the customer<input class="tw-in" name="note" value="${esc(v.note || '')}"></label>`;
    f = '<button type="button" class="tw-btn big" data-act="scan">Received</button>';
  } else if (dr.kind === 'note') {
    const p = pkg(dr.id);
    h = `<h2>${esc(p.description || 'Parcel')}</h2><p>${esc(p.customer)} · ${esc(p.suite)} · in the warehouse ${daysSince(p.receivedAt)} days</p>`;
    b = `<div class="tw-note">${esc(p.store)} · ${tl(p.valueTry)} · ${kg(p.weightKg)}${p.dims ? ` · ${esc(p.dims)} cm` : ''}${p.storagePence ? ` · storage owed ${gbp(p.storagePence)}` : ''}</div>
      <label class="tw-f">Note for the customer<input class="tw-in" name="note" value="${esc(p.note || '')}"></label>`;
    f = `<button type="button" class="tw-btn" data-act="saveNote">Save note</button><button type="button" class="tw-btn ghost" data-act="discard" style="color:#B42318">Discard parcel</button>`;
  } else if (dr.kind === 'pack') {
    const s = shp(dr.id);
    const pk = S.d.packages.filter((p) => p.shipmentId === s.id);
    h = `<h2>Pack &amp; price ${esc(s.ref)}</h2><p>${esc(s.customer)} · ${esc(s.suite)} · ${pk.length} parcel${pk.length > 1 ? 's' : ''}</p>`;
    const vals = dr.v?.vals || {};
    b = `<div class="tw-f">In the box: value of each item for customs <em>(check on the shop page)</em><div style="display:flex;flex-direction:column;gap:8px;margin-top:6px">${pk.map((p) => `<div class="tw-item" style="justify-content:space-between">
        <span class="tw-item" style="min-width:0">${thumb(p.image, p.store, 36)}<span class="two" style="display:flex;flex-direction:column"><b style="font-size:14px">${esc(p.productTitle || p.description)}</b><small class="tw-muted">${esc(p.description)} · ${kg(p.weightKg)}${p.productUrl ? ` · <a href="${esc(p.productUrl)}" target="_blank" rel="noopener nofollow">shop page ↗</a>` : ''}</small></span></span>
        <span class="tw-unit" data-u="TL" style="width:120px;flex:none"><input class="tw-in" data-val="${p.id}" inputmode="numeric" value="${esc(vals[p.id] ?? p.valueTry ?? '')}" aria-label="Value in TL" style="${p.valueTry || vals[p.id] ? '' : 'border-color:#E5484D'}"></span></div>`).join('')}</div></div>
      <div class="tw-muted">To: ${esc(addrText(s.address))} · ${esc(s.address.phone || '')}</div>
      ${s.note ? `<div class="tw-note warn">Customer note: ${esc(s.note)}</div>` : ''}
      ${dimsHtml(dr.v)}<div id="prev">${S.preview ? quotesHtml(S.preview) : '<span class="tw-muted">Enter the weight and size: prices appear here.</span>'}</div>`;
    f = `<button type="button" class="tw-btn big" data-act="measure">Send price to customer</button>`;
  } else if (dr.kind === 'ship') {
    const s = shp(dr.id);
    h = `<h2>Ship ${esc(s.ref)}</h2><p>${esc(s.customer)} · paid ${gbp(s.pricePence)} by ${esc(s.paidVia)}</p>`;
    b = `<div class="tw-note ok"><b>${esc(s.courierName)}</b> · ${kg(s.weightKg)} · ${esc(s.dims || '')} cm</div>
      <div class="kvs"><div class="tw-f">Deliver to<span style="font-weight:500;color:var(--ink)">${esc(addrText(s.address))}<br>${esc(s.address.phone || '')}</span></div></div>
      <label class="tw-f">${esc(s.courierName)} tracking number<input class="tw-in" name="trackingNo" value="${esc(dr.v?.trackingNo || '')}" autofocus></label>`;
    f = '<button type="button" class="tw-btn big green" data-act="ship">Mark as shipped</button>';
  } else if (dr.kind === 'thread') {
    const p = pkg(dr.id);
    h = `<div class="tw-item">${logo(p.store, 36)}<span><h2 style="font-size:18px">${esc(p.description || 'Parcel')}</h2><p>${custLink(p.customerId, p.customer)} · ${esc(p.suite)} · ${esc(p.store || '')}</p></span></div>`;
    b = `${threadHtml(notesFor(p.id), 'admin')}${composerHtml(dr.v || {}, 'Write to the customer about this parcel (they get an email)')}`;
    f = '<button type="button" class="tw-btn big" data-act="sendMsg">Send to customer</button>';
  } else if (dr.kind === 'buyquote') {
    const bq = S.d.buys.find((x) => x.id === dr.id);
    const v = { ...bq, price: bq.pricePence ? pounds(bq.pricePence) : '', ...(dr.v || {}) };
    h = `<h2>Price ${esc(bq.ref)}</h2><p>${custLink(bq.customerId, bq.customer)} · ${esc(bq.suite || '')}</p>`;
    b = `<div class="tw-note tw-item" style="align-items:flex-start">${thumb(bq.image, bq.store, 72)}<span style="min-width:0"><b>${esc(bq.title || bq.store || 'Product')}</b><br><a href="${esc(bq.url)}" target="_blank" rel="noopener nofollow" style="word-break:break-all;font-size:13px">${esc(bq.url)}</a><br>${esc(bq.details || 'No details')} · quantity ${bq.qty}</span></div>
      <div class="tw-row"><label class="tw-f">Shop<input class="tw-in" name="store" value="${esc(v.store || '')}"></label><label class="tw-f">Shop price<span class="tw-unit" data-u="TL"><input class="tw-in" name="itemTry" inputmode="numeric" value="${esc(v.itemTry || '')}"></span></label></div>
      <label class="tw-f">Price for the customer <em>(item + Turkish delivery + our fee)</em><span class="tw-unit" data-u="£"><input class="tw-in" name="price" inputmode="decimal" value="${esc(v.price || '')}" placeholder="24.90"></span></label>
      <label class="tw-f">Note for the customer <em>(optional)</em><input class="tw-in" name="note" value="${esc(v.note || '')}" placeholder="e.g. Size M in stock, arrives at our warehouse in 2–3 days"></label>`;
    f = '<button type="button" class="tw-btn big" data-act="buyQuote">Send price</button><button type="button" class="tw-btn ghost" data-act="buyReject" style="color:#B42318">Reject</button>';
  } else if (dr.kind === 'buyorder') {
    const bq = S.d.buys.find((x) => x.id === dr.id);
    const v = { store: bq.store, valueTry: bq.itemTry, ...(dr.v || {}) };
    h = `<h2>Order ${esc(bq.ref)}</h2><p>Paid ${gbp(bq.pricePence)} · ${custLink(bq.customerId, bq.customer)} · ${esc(bq.suite || '')}</p>`;
    b = `<div class="tw-note tw-item" style="align-items:flex-start">${thumb(bq.image, bq.store, 72)}<span style="min-width:0"><b>${esc(bq.title || bq.store || 'Product')}</b><br><a href="${esc(bq.url)}" target="_blank" rel="noopener nofollow" style="word-break:break-all;font-size:13px">${esc(bq.url)}</a><br>${esc(bq.details || 'No details')} · quantity ${bq.qty}</span></div>
      <div class="tw-note warn">Order it on the shop with the customer's warehouse address (code <b>${esc(bq.suite || '')}</b>), then fill this in. It becomes a parcel "Coming to warehouse".</div>
      <label class="tw-f">What is it <em>(in English, for customs)</em><input class="tw-in" name="description" value="${esc(v.description || '')}" placeholder="e.g. Blue cotton dress"></label>
      <div class="tw-row"><label class="tw-f">Shop<input class="tw-in" name="store" value="${esc(v.store || '')}"></label><label class="tw-f">Paid on the shop<span class="tw-unit" data-u="TL"><input class="tw-in" name="valueTry" inputmode="numeric" value="${esc(v.valueTry || '')}"></span></label></div>
      <div class="tw-row"><label class="tw-f">Shop order number<input class="tw-in" name="orderNo" value="${esc(v.orderNo || '')}"></label><label class="tw-f">Tracking <em>(if known)</em><input class="tw-in" name="tracking" value="${esc(v.tracking || '')}"></label></div>`;
    f = '<button type="button" class="tw-btn big green" data-act="buyOrdered">Ordered</button>';
  } else if (dr.kind === 'courier') {
    const e = dr.id ? S.d.couriers.find((c) => c.id === dr.id) : {};
    const v = { ...e, ...(dr.v || {}) };
    h = `<h2>${e.id ? `Edit ${esc(e.name)}` : 'Add a courier'}</h2><p>What customers pay for shipping, before our fees.</p>`;
    const logo = v.logo ?? '';
    const presets = [['dhl', 'DHL'], ['fedex', 'FedEx'], ['ups', 'UPS']];
    b = `<label class="tw-f">Name customers see<input class="tw-in" name="name" value="${esc(v.name || '')}" placeholder="UPS Express Saver"></label>
      <div class="tw-f">Logo <em>(customers see it next to the price)</em><input type="hidden" name="logo" value="${esc(logo)}">
        <div class="tw-logopick">${presets.map(([k, n]) => `<button type="button" data-logo="preset:${k}" aria-pressed="${logo === `preset:${k}`}" title="${n}"><img src="/assets/carriers/${k}.png" alt="${n}"></button>`).join('')}
          ${logo.startsWith('data:') ? `<button type="button" data-logo="${esc(logo)}" aria-pressed="true"><img src="${esc(logo)}" alt="Your logo"></button>` : ''}
          <label title="Upload a logo">⬆ Upload<input type="file" accept="image/png,image/jpeg,image/webp" data-logofile hidden></label>
          <button type="button" data-logo="" aria-pressed="${logo === ''}">Auto</button><button type="button" data-logo="none" aria-pressed="${logo === 'none'}">No logo</button></div>
        <span class="tw-muted" style="font-weight:500">Auto = DHL, FedEx or UPS logo when the name contains it.</span></div>
      <label class="tw-f">Price list <em>(one line each: kg = £)</em><textarea class="tw-in" name="rates" rows="7" placeholder="0.5 = 9.90&#10;1 = 12.50&#10;2 = 16.90&#10;5 = 27.50&#10;10 = 42.00">${esc(typeof v.rates === 'string' ? v.rates : ratesText(e.rates))}</textarea></label>
      <div class="tw-row"><label class="tw-f">Each extra kg (£)<input class="tw-in" name="extraKg" value="${esc(v.extraKg ?? (e.extraKgPence ? pounds(e.extraKgPence) : ''))}"></label>
        <label class="tw-f">Fuel (%)<input class="tw-in" name="fuelPct" value="${esc(v.fuelPct ?? (e.fuelBp ? e.fuelBp / 100 : ''))}"></label></div>
      <div class="tw-row"><label class="tw-f">Days from<input class="tw-in" name="daysMin" value="${esc(v.daysMin || 2)}"></label><label class="tw-f">Days to<input class="tw-in" name="daysMax" value="${esc(v.daysMax || 5)}"></label>
        <label class="tw-f">Max kg<input class="tw-in" name="maxKg" value="${esc(v.maxKg || 30)}"></label></div>
      <div class="tw-row"><label class="tw-f">Volumetric divisor<input class="tw-in" name="divisor" value="${esc(v.divisor || 5000)}"></label>
        <label class="tw-f">Shown to customers<select class="tw-in" name="active"><option value="true">Yes</option><option value="false" ${v.active === false || v.active === 'false' ? 'selected' : ''}>No, hidden</option></select></label></div>
      <label class="tw-f">Tracking link <em>({n} = tracking number)</em><input class="tw-in" name="trackingUrl" value="${esc(v.trackingUrl || '')}" placeholder="https://www.ups.com/track?tracknum={n}"></label>
      <label class="tw-f">Internal note<input class="tw-in" name="note" value="${esc(v.note || '')}" placeholder="Account no, contact, our cost…"></label>`;
    f = `<button type="button" class="tw-btn" data-act="saveCour">Save</button>${e.id ? '<button type="button" class="tw-btn ghost" data-act="delCour" style="color:#B42318">Delete</button>' : ''}`;
  }
  return `<div class="tw-dim" data-dim><aside class="tw-drawer" role="dialog" aria-modal="true" id="dr">
    <div class="tw-drawer-h"><div>${h}</div><button type="button" class="tw-x" data-close aria-label="Close">×</button></div>
    <div class="tw-drawer-b">${b}</div><div class="tw-drawer-f">${f.replace(/<button /g, `<button ${S.busy ? 'disabled ' : ''}`)}</div></aside></div>`;
}

function render() {
  const all = S.d ? rows() : [];
  const todo = all.filter((r) => ['coming', 'pack', 'ship'].includes(r.stage)).length;
  const openBuys = (S.d.buys || []).filter((b) => ['requested', 'paid'].includes(b.status)).length;
  shell?.setBadge('tr', all.filter((r) => ['pack', 'ship'].includes(r.stage)).length + openBuys);
  const warn = !S.d.settings.whLine1 ? '<div class="tw-note warn">Add the warehouse address in <b>Settings</b>. Until then customers see "coming soon" instead of their address.</div>'
    : !S.d.couriers.some((c) => c.active) ? '<div class="tw-note warn">Add at least one courier with a price list in <b>Couriers</b>, or boxes cannot be priced.</div>' : '';
  const focus = document.activeElement?.id === 'q' ? document.activeElement.selectionStart : null;
  root.innerHTML = `<div class="tw-head"><div><h1>Turkey warehouse</h1><p>${todo ? `${todo} job${todo > 1 ? 's' : ''} waiting: arrivals, boxes to pack and boxes to ship.` : 'All caught up.'}</p></div>
      <div class="tw-acts">${[['list', 'Shipments'], ['buy', `Buy for me${openBuys ? ` · ${openBuys}` : ''}`], ['cour', 'Couriers'], ['set', 'Settings']].map(([k, l]) => `<button type="button" class="tw-chip" data-view="${k}" aria-pressed="${S.view === k}" style="min-height:42px;${k === 'buy' && openBuys ? 'border-color:#E5484D;color:#B42318' : ''}">${l}</button>`).join('')}
        <button type="button" class="tw-btn" data-open="scan">+ Receive a parcel</button></div></div>
    ${warn}${S.view === 'buy' ? buyView() : S.view === 'cour' ? courView() : S.view === 'set' ? setView() : listView()}${drawerHtml()}`;
  if (focus != null) { const q = root.querySelector('#q'); q?.focus(); q?.setSelectionRange(focus, focus); }
}

async function load() { S.d = await api('/api/admin/tr'); render(); }
const val = (name) => root.querySelector(`#dr [name="${name}"]`)?.value ?? '';
const keepDrawer = () => {
  if (!S.drawer) return;
  const vals = Object.fromEntries([...root.querySelectorAll('#dr [data-val]')].map((i) => [i.dataset.val, i.value]));
  S.drawer.v = { ...(S.drawer.v || {}), ...Object.fromEntries([...root.querySelectorAll('#dr [name]')].map((i) => [i.name, i.value])), ...(Object.keys(vals).length ? { vals } : {}) };
};
const dimsOf = () => ({ weightKg: val('w'), dims: [val('l'), val('wd'), val('h')].every((x) => Number(x) > 0) ? `${val('l')}x${val('wd')}x${val('h')}` : '' });
async function run(fn, ok) {
  if (S.busy) return;
  keepDrawer(); S.busy = true; render();
  try { const msg = await fn(); toast(msg || ok); } catch (e) { toast(e.message); }
  S.busy = false; render();
}

let prevTimer;
function livePreview() {
  clearTimeout(prevTimer);
  const d = dimsOf();
  if (!(Number(String(d.weightKg).replace(',', '.')) > 0)) return;
  prevTimer = setTimeout(async () => {
    try { S.preview = (await api(`/api/admin/tr/shipments/${S.drawer.id}/measure`, { method: 'POST', body: { ...d, preview: true } })).quotes; } catch { S.preview = null; }
    const box = root.querySelector('#prev'); if (box) box.innerHTML = S.preview?.length ? quotesHtml(S.preview) : '<span class="tw-muted">No courier takes this size. Check Couriers.</span>';
  }, 350);
}

function bind() {
  root.addEventListener('input', (e) => {
    if (e.target.id === 'q') { S.q = e.target.value; render(); return; }
    if (S.drawer?.kind === 'pack' && ['w', 'l', 'wd', 'h'].includes(e.target.name)) livePreview();
  });
  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-logofile]') && e.target.files?.[0]) {
      keepDrawer();
      // Small PNG keeps transparent backgrounds; 240 px wide is plenty for a price row.
      resizeImage(e.target.files[0], 240, 'image/png').then((logo) => { S.drawer.v = { ...(S.drawer.v || {}), logo }; render(); }).catch((err) => toast(err.message));
      return;
    }
    if (!e.target.matches('[data-photos]')) return;
    keepDrawer();
    readPhotos(e.target.files, S.drawer.v?.photos || []).then((ph) => { S.drawer.v = { ...(S.drawer.v || {}), photos: ph }; render(); }).catch((err) => toast(err.message));
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.drawer) { S.drawer = null; render(); }
    if (e.key === 'Enter' && e.target.closest('#dr') && e.target.tagName === 'INPUT') root.querySelector('#dr .tw-drawer-f .tw-btn')?.click();
  });
  root.addEventListener('click', async (e) => {
    if (e.target.matches('[data-dim]')) { S.drawer = null; render(); return; }
    const b = e.target.closest('button');
    if (!b) return;
    const ds = b.dataset;
    if ('close' in ds) { S.drawer = null; render(); return; }
    if (ds.view) { S.view = ds.view; history.replaceState(null, '', ds.view === 'list' ? '/admin/turkey' : `/admin/turkey?tab=${ds.view}`); render(); load().catch(() => {}); return; }
    if (ds.stage) { S.stage = S.stage === ds.stage && b.classList.contains('tw-stat') ? 'all' : ds.stage; S.view = 'list'; render(); return; }
    if (ds.open) { S.drawer = { kind: ds.open, id: ds.id || null, v: null }; S.preview = null; render(); root.querySelector('#dr input, #dr textarea')?.focus(); return; }
    if (ds.deliv) { await run(async () => { await api(`/api/admin/tr/shipments/${ds.deliv}/delivered`, { method: 'POST', body: {} }); await load(); }, 'Marked as delivered'); return; }
    if (ds.active) {
      const c = S.d.couriers.find((x) => x.id === ds.active);
      await run(async () => { await api(`/api/admin/tr/couriers/${c.id}/active`, { method: 'POST', body: { active: !c.active } }); await load(); }, c.active ? `${c.name} is hidden from customers` : `${c.name} is shown to customers`);
      return;
    }
    if (ds.logo != null) { keepDrawer(); S.drawer.v = { ...(S.drawer.v || {}), logo: ds.logo }; render(); return; }
    if (ds.unphoto != null) { keepDrawer(); S.drawer.v.photos = (S.drawer.v.photos || []).filter((_, i) => i !== Number(ds.unphoto)); render(); return; }
    const dr = S.drawer;
    switch (ds.act) {
      case 'sendMsg': {
        const body = { body: val('msg'), photos: dr.v?.photos || [] };
        await run(async () => { await api(`/api/admin/tr/packages/${dr.id}/messages`, { method: 'POST', body }); S.drawer = { kind: 'thread', id: dr.id, v: null }; await load(); }, 'Sent. The customer got an email.');
        break;
      }
      case 'buyQuote': { const o = { price: val('price'), itemTry: val('itemTry'), store: val('store'), note: val('note') };
        await run(async () => { await api(`/api/admin/tr/buy/${dr.id}/quote`, { method: 'POST', body: o }); S.drawer = null; await load(); }, 'Price sent to the customer'); break; }
      case 'buyReject': { if (!confirm('Reject this request? The customer gets an email with your note.')) return; const o = { note: val('note') };
        await run(async () => { await api(`/api/admin/tr/buy/${dr.id}/reject`, { method: 'POST', body: o }); S.drawer = null; await load(); }, 'Rejected'); break; }
      case 'buyOrdered': { const o = { description: val('description'), store: val('store'), valueTry: val('valueTry'), orderNo: val('orderNo'), tracking: val('tracking') };
        await run(async () => { await api(`/api/admin/tr/buy/${dr.id}/ordered`, { method: 'POST', body: o }); S.drawer = null; await load(); }, 'Ordered. It is now in "Coming to warehouse".'); break; }
      case 'arrive': await run(async () => {
        const photos = dr.v?.photos || [];
        const r = await api('/api/admin/tr/receive', { method: 'POST', body: { packageId: dr.id, ...dimsOf(), note: val('note'), valueTry: val('valueTry') } });
        if (photos.length) await api(`/api/admin/tr/packages/${dr.id}/messages`, { method: 'POST', body: { body: val('note') || 'Photos of your parcel on arrival.', photos } });
        S.drawer = null; await load();
        return r.auto?.status === 'paid' ? `Arrived, priced and paid from the wallet (${gbp(r.auto.pence)}). It is in Ready to ship.`
          : r.auto?.status === 'quoted' ? `Arrived and priced (${gbp(r.auto.pence)}). Waiting for the customer to pay.` : 'Arrived. The customer got an email.';
      }); break;
      case 'scan': await run(async () => {
        const r = await api('/api/admin/tr/receive', { method: 'POST', body: { tracking: val('tracking'), suite: val('suite'), store: val('store'), description: val('description'), note: val('note'), valueTry: val('valueTry'), ...dimsOf() } });
        S.drawer = { kind: 'scan', v: null }; await load();
        return r.auto ? `Received and ${r.auto.status === 'paid' ? 'paid from the wallet' : 'priced for the customer'}.` : 'Received. Scan the next one.';
      }); break;
      case 'saveNote': await run(async () => { await api(`/api/admin/tr/packages/${dr.id}`, { method: 'POST', body: { note: val('note') } }); S.drawer = null; await load(); }, 'Note saved'); break;
      case 'discard': if (!confirm('Mark this parcel as discarded?')) return; await run(async () => { await api(`/api/admin/tr/packages/${dr.id}`, { method: 'POST', body: { discard: true } }); S.drawer = null; await load(); }, 'Discarded'); break;
      case 'measure': await run(async () => { await api(`/api/admin/tr/shipments/${dr.id}/measure`, { method: 'POST', body: { ...dimsOf(), values: S.drawer.v?.vals || {} } }); S.drawer = null; await load(); }, 'Price sent. The customer chooses a courier and pays.'); break;
      case 'ship': await run(async () => { await api(`/api/admin/tr/shipments/${dr.id}/ship`, { method: 'POST', body: { trackingNo: val('trackingNo') } }); S.drawer = null; await load(); }, 'Shipped. The customer got the tracking number.'); break;
      case 'saveCour': {
        const body = Object.fromEntries([...root.querySelectorAll('#dr [name]')].map((i) => [i.name, i.value]));
        await run(async () => { await api('/api/admin/tr/couriers', { method: 'POST', body: { ...body, id: dr.id || '' } }); S.drawer = null; await load(); }, 'Courier saved');
        break;
      }
      case 'delCour': if (!confirm('Delete this courier? Prices already sent to customers stay as they are.')) return; await run(async () => { await api(`/api/admin/tr/couriers/${dr.id}/delete`, { method: 'POST', body: {} }); S.drawer = null; await load(); }, 'Deleted'); break;
      case 'pvtest': {
        const url = root.querySelector('#pvurl')?.value || '';
        S.pvtest = 'Reading…'; render();
        try { const r = await api(`/api/admin/tr/preview-test?url=${encodeURIComponent(url)}`); S.pvtest = `Name: ${r.title || '–'}\nEnglish: ${r.english || '–'}\nPrice: ${r.priceTry ? `${r.priceTry} TL` : '–'}\nPicture: ${r.image ? 'yes' : 'no'}\n\n${r.steps.join('\n')}`; }
        catch (e) { S.pvtest = e.message; }
        render(); const i = root.querySelector('#pvurl'); if (i) i.value = url;
        break;
      }
      case 'saveSet': {
        const body = Object.fromEntries([...root.querySelectorAll('#sf [name]')].map((i) => [i.name, i.value]));
        await run(async () => { await api('/api/admin/tr/settings', { method: 'POST', body }); await load(); }, 'Settings saved');
        break;
      }
      default:
    }
  });
}

(async () => {
  try { shell = await mountAdminShell('tr', 'Turkey warehouse'); } catch { location.href = '/login?next=/admin/turkey'; return; }
  root = document.createElement('div'); root.className = 'tw'; shell.main.append(root);
  root.innerHTML = '<div class="tw-empty"><b>Loading…</b></div>';
  bind();
  try { await load(); } catch (e) { root.innerHTML = `<div class="tw-empty"><b>${esc(e.message)}</b></div>`; }
  setInterval(() => { if (!S.drawer && !S.busy && document.visibilityState === 'visible') load().catch(() => {}); }, 30_000);
})();
