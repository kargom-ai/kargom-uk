import { api, esc, gbp, toast, niceDate } from '../market-ui.js';

/**
 * Admin: Turkey warehouse. Receive parcels, pack and price boxes, send them, and manage the
 * courier price lists and warehouse settings.
 */
const root = document.getElementById('root');
root.classList.add('tr-admin');
const TABS = [['recv', 'Receive'], ['wh', 'In warehouse'], ['box', 'Boxes'], ['cour', 'Couriers'], ['set', 'Settings']];
const S = { d: null, tab: new URLSearchParams(location.search).get('tab') || 'recv', q: '', recv: {}, preview: {}, draft: {}, edit: null, busy: false };
const BOX = { requested: 'To pack', quoted: 'Waiting for payment', paid: 'Paid: send it', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };
const kg = (v) => (v == null ? '–' : `${Number(v).toFixed(2).replace(/\.?0+$/, '')} kg`);
const pounds = (p) => (p / 100).toFixed(2);
const match = (o) => !S.q || JSON.stringify(o).toLowerCase().includes(S.q.toLowerCase());

function recvTab() {
  const exp = S.d.packages.filter((p) => p.status === 'expected' && match(p));
  const r = S.recv;
  return `<section class="tr-card" id="rf"><h2>Receive a parcel</h2>
    <span class="muted" style="font-size:14px">Scan or type the tracking number. If the customer told us about it, it matches by itself. If not, type the KG code from the label.</span>
    <div class="grid2">
      <label class="fld">Tracking number<input class="inp" name="tracking" value="${esc(r.tracking || '')}" autofocus></label>
      <label class="fld">Suite code <em>(only if not matched)</em><input class="inp" name="suite" value="${esc(r.suite || '')}" placeholder="KG12345" style="text-transform:uppercase"></label>
      <label class="fld">Weight (kg)<input class="inp" name="weightKg" inputmode="decimal" value="${esc(r.weightKg || '')}"></label>
      <label class="fld">Size cm <em>(L x W x H)</em><input class="inp" name="dims" value="${esc(r.dims || '')}" placeholder="40x30x20"></label>
      <label class="fld">Shop <em>(new parcels)</em><select class="inp" name="store">${S.d.stores.map((s) => `<option ${s === r.store ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
      <label class="fld">What is in it <em>(new parcels)</em><input class="inp" name="description" value="${esc(r.description || '')}"></label>
    </div>
    <label class="fld">Note for the customer <em>(damage, missing items…)</em><input class="inp" name="note" value="${esc(r.note || '')}"></label>
    ${r.packageId ? `<div class="tr-info">Receiving the pre-alert for <b>${esc(r.label)}</b>. <button type="button" class="btn ghost sm" data-act="clearRecv">Clear</button></div>` : ''}
    <button type="button" class="btn big" data-act="receive" ${S.busy ? 'disabled' : ''}>Received</button>
  </section>
  <section class="tr-card"><h2>Expected (${exp.length})</h2>
    <div class="tr-scroll"><table class="tr-tbl"><tr><th>Code</th><th>Customer</th><th>Shop</th><th>What</th><th>Tracking</th><th>Value</th><th>Told us</th><th></th></tr>
    ${exp.map((p) => `<tr><td><b>${esc(p.suite)}</b></td><td>${esc(p.customer)}</td><td>${esc(p.store)}</td><td>${esc(p.description)}</td><td>${esc(p.tracking || '–')}</td><td>${p.valueTry ? `${p.valueTry.toLocaleString('tr-TR')} TL` : ''}</td><td>${esc(niceDate(p.createdAt))}</td>
      <td><button type="button" class="btn sm" data-recv="${p.id}">Receive</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nothing expected.</td></tr>'}</table></div></section>`;
}

function whTab() {
  const here = S.d.packages.filter((p) => p.status === 'received' && match(p));
  return `<section class="tr-card"><h2>In the warehouse (${here.length})</h2>
    <div class="tr-scroll"><table class="tr-tbl"><tr><th>Code</th><th>Customer</th><th>Parcel</th><th>Weight / size</th><th>Arrived</th><th>Storage</th><th>Note</th><th></th></tr>
    ${here.map((p) => `<tr><td><b>${esc(p.suite)}</b></td><td>${esc(p.customer)}<br><span class="muted">${esc(p.email)}</span></td><td>${esc(p.store)}: ${esc(p.description || '–')}${p.hold ? '<br><span class="badge expected">Customer: keep</span>' : ''}</td>
      <td>${kg(p.weightKg)}<br>${esc(p.dims || '')}</td><td>${esc(niceDate(p.receivedAt))}</td><td>${p.storagePence ? gbp(p.storagePence) : 'free'}</td>
      <td><input class="inp" data-note="${p.id}" value="${esc(p.note || '')}" style="min-width:160px"></td>
      <td><button type="button" class="btn ghost sm" data-discard="${p.id}">Discard</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Empty.</td></tr>'}</table></div></section>`;
}

function quoteList(quotes) {
  return quotes?.length ? `<div class="tr-opts">${quotes.map((x) => `<div class="tr-opt"><span class="n"><b>${esc(x.name)}</b><span>${x.chargeableKg} kg charged · ${x.daysMin}–${x.daysMax} days</span>
    <span class="tr-break">shipping ${gbp(x.breakdown.shipping)} + fuel ${gbp(x.breakdown.fuel)} + handling ${gbp(x.breakdown.handling)}${x.breakdown.consolidation ? ` + combining ${gbp(x.breakdown.consolidation)}` : ''}${x.breakdown.storage ? ` + storage ${gbp(x.breakdown.storage)}` : ''}</span></span><span class="p">${gbp(x.pence)}</span></div>`).join('')}</div>` : '';
}

function boxCard(s) {
  const a = s.address;
  const pk = s.packages.map((p) => `<li>${esc(p.store)}: ${esc(p.description || '–')} · ${p.valueTry ? `${p.valueTry.toLocaleString('tr-TR')} TL` : 'no value'} · ${kg(p.weightKg)}${p.dims ? ` · ${esc(p.dims)}` : ''}</li>`).join('');
  const total = s.packages.reduce((x, p) => x + (p.valueTry || 0), 0);
  let act = '';
  if (s.status === 'requested' || s.status === 'quoted') {
    act = `<div class="grid2"><label class="fld">Packed weight (kg)<input class="inp" data-w="${s.id}" inputmode="decimal" value="${esc(S.draft[s.id]?.weightKg ?? s.weightKg ?? '')}"></label>
      <label class="fld">Box size cm<input class="inp" data-d="${s.id}" value="${esc(S.draft[s.id]?.dims ?? s.dims ?? '')}" placeholder="40x30x20"></label></div>
      ${quoteList(S.preview[s.id] || (s.status === 'quoted' ? s.quotes : null))}
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn ghost" data-prev="${s.id}">Preview prices</button>
      <button type="button" class="btn" data-measure="${s.id}" ${S.busy ? 'disabled' : ''}>${s.status === 'quoted' ? 'Update the price' : 'Send price to customer'}</button></div>`;
  }
  if (s.status === 'paid') {
    act = `<div class="tr-info">Paid <b>${gbp(s.pricePence)}</b> by ${esc(s.paidVia)} · <b>${esc(s.courierName)}</b> · ${kg(s.weightKg)} · ${esc(s.dims)} cm</div>
      <div class="tr-calc"><label class="fld">${esc(s.courierName)} tracking number<input class="inp" data-t="${s.id}"></label><button type="button" class="btn" data-ship="${s.id}" ${S.busy ? 'disabled' : ''}>Mark as sent</button></div>`;
  }
  if (s.status === 'shipped') act = `<div class="tr-calc"><span>${esc(s.courierName)} · ${s.trackingUrl ? `<a href="${esc(s.trackingUrl)}" target="_blank" rel="noopener">${esc(s.trackingNo)}</a>` : esc(s.trackingNo)}</span><button type="button" class="btn ghost sm" data-deliv="${s.id}">Mark delivered</button></div>`;
  return `<article class="tr-box"><div class="tr-box-h"><b>${esc(s.ref)} · ${esc(s.suite)} · ${esc(s.customer)}</b><span class="badge ${s.status}">${BOX[s.status]}</span></div>
    <div class="kvs"><div><span>Deliver to</span><b>${esc([a.name, a.line1, a.line2, a.city, a.postcode].filter(Boolean).join(', '))}</b></div><div><span>Phone</span><b>${esc(a.phone || '–')}</b></div><div><span>Asked</span><b>${esc(niceDate(s.createdAt))}</b></div></div>
    ${s.note ? `<div class="tr-warn">Customer note: ${esc(s.note)}</div>` : ''}
    <div><b style="font-size:14px">${s.packages.length} parcel${s.packages.length > 1 ? 's' : ''} (customs: ${total.toLocaleString('tr-TR')} TL)</b><ul style="margin:6px 0 0;padding-left:20px;font-size:14px">${pk}</ul></div>
    ${act}</article>`;
}

function boxTab() {
  const order = ['requested', 'paid', 'quoted', 'shipped', 'delivered', 'cancelled'];
  const list = S.d.shipments.filter(match).sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  return `<div class="tr-list">${list.map(boxCard).join('') || '<div class="empty-box"><b>No boxes yet</b></div>'}</div>`;
}

const ratesText = (rates) => rates.map(([k, p]) => `${k} = ${pounds(p)}`).join('\n');
function courTab() {
  const e = S.edit;
  const form = e ? `<section class="tr-card" id="cf"><h2>${e.id ? `Edit ${esc(e.name)}` : 'Add a courier'}</h2>
    <div class="grid2">
      <label class="fld">Name (what customers see)<input class="inp" name="name" value="${esc(e.name || '')}" placeholder="UPS Express Saver"></label>
      <label class="fld">Show to customers<select class="inp" name="active"><option value="true" ${e.active !== false ? 'selected' : ''}>Yes</option><option value="false" ${e.active === false ? 'selected' : ''}>No (hidden)</option></select></label>
      <label class="fld">Price list (kg = £, our selling price)<textarea class="inp" name="rates" rows="8" placeholder="0.5 = 9.90&#10;1 = 12.50&#10;2 = 16.90&#10;5 = 27.50&#10;10 = 42.00">${esc(e.ratesRaw ?? (e.rates ? ratesText(e.rates) : ''))}</textarea></label>
      <div style="display:flex;flex-direction:column;gap:12px">
        <label class="fld">Each extra kg above the list (£) <em>(empty = not allowed)</em><input class="inp" name="extraKg" value="${e.extraKgPence ? pounds(e.extraKgPence) : ''}"></label>
        <label class="fld">Fuel surcharge (%)<input class="inp" name="fuelPct" value="${e.fuelBp ? e.fuelBp / 100 : ''}"></label>
        <label class="fld">Volumetric divisor <em>(5000 most couriers)</em><input class="inp" name="divisor" value="${esc(e.divisor || 5000)}"></label>
        <label class="fld">Max kg per box<input class="inp" name="maxKg" value="${esc(e.maxKg || 30)}"></label>
      </div>
      <label class="fld">Working days (from)<input class="inp" name="daysMin" value="${esc(e.daysMin || 2)}"></label>
      <label class="fld">Working days (to)<input class="inp" name="daysMax" value="${esc(e.daysMax || 5)}"></label>
      <label class="fld">Tracking link <em>({n} = tracking number)</em><input class="inp" name="trackingUrl" value="${esc(e.trackingUrl || '')}" placeholder="https://www.ups.com/track?tracknum={n}"></label>
      <label class="fld">Order on the list<input class="inp" name="sort" value="${esc(e.sort || 0)}"></label>
    </div>
    <label class="fld">Internal note<input class="inp" name="note" value="${esc(e.note || '')}" placeholder="Account no, contact, cost price…"></label>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn" data-act="saveCour" ${S.busy ? 'disabled' : ''}>Save</button><button type="button" class="btn ghost" data-act="closeCour">Cancel</button>
    ${e.id ? `<button type="button" class="btn ghost" data-delcour="${e.id}" style="margin-left:auto;color:#B42318">Delete</button>` : ''}</div></section>` : '';
  return `${form}<section class="tr-card"><div class="tr-box-h"><h2>Couriers (${S.d.couriers.length})</h2><button type="button" class="btn" data-act="newCour">+ Add courier</button></div>
    <span class="muted" style="font-size:14px">Prices here are what the customer pays for shipping. Handling, combining and storage fees from Settings are added on top.</span>
    <div class="tr-scroll"><table class="tr-tbl"><tr><th>Courier</th><th>Shown</th><th>Price list</th><th>Extra kg</th><th>Fuel</th><th>Days</th><th></th></tr>
    ${S.d.couriers.map((c) => `<tr><td><b>${esc(c.name)}</b>${c.note ? `<br><span class="muted">${esc(c.note)}</span>` : ''}</td><td>${c.active ? 'Yes' : 'Hidden'}</td>
      <td style="white-space:pre;font-size:13px">${esc(ratesText(c.rates))}</td><td>${c.extraKgPence ? gbp(c.extraKgPence) : '–'}</td><td>${c.fuelBp / 100}%</td><td>${c.daysMin}–${c.daysMax}</td>
      <td><button type="button" class="btn ghost sm" data-editcour="${c.id}">Edit</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No couriers yet. Customers cannot get a price until you add one.</td></tr>'}</table></div></section>`;
}

function setTab() {
  const s = S.d.settings;
  const f = (k, label, v, ph = '') => `<label class="fld">${label}<input class="inp" name="${k}" value="${esc(v)}" placeholder="${esc(ph)}"></label>`;
  return `<section class="tr-card" id="sf"><h2>Warehouse address</h2>
    <span class="muted" style="font-size:14px">Customers see this, with their own KG code added to the name and address line 2.</span>
    <div class="grid2">${f('whName', 'Warehouse name', s.whName)}${f('whPhone', 'Phone (shops need one)', s.whPhone, '+90 5xx xxx xx xx')}
      ${f('whLine1', 'Address (mahalle, sokak, no)', s.whLine1)}${f('whLine2', 'Address 2 (bina, kat, depo)', s.whLine2)}
      ${f('whDistrict', 'İlçe', s.whDistrict)}${f('whCity', 'İl', s.whCity)}${f('whPostcode', 'Posta kodu', s.whPostcode)}</div>
    <h2 style="margin-top:8px">Fees</h2>
    <div class="grid2">${f('handlingPence', 'Handling per box (£)', pounds(s.handlingPence))}${f('consolidatePence', 'Combining, per extra parcel (£)', pounds(s.consolidatePence))}
      ${f('freeDays', 'Free storage (days)', s.freeDays)}${f('storagePencePerDay', 'Storage after that, per parcel per day (£)', pounds(s.storagePencePerDay))}</div>
    <button type="button" class="btn big" data-act="saveSet" ${S.busy ? 'disabled' : ''}>Save settings</button></section>`;
}

function render() {
  const d = S.d;
  const counts = { recv: d.packages.filter((p) => p.status === 'expected').length, wh: d.packages.filter((p) => p.status === 'received').length,
    box: d.shipments.filter((s) => ['requested', 'paid'].includes(s.status)).length, cour: d.couriers.length };
  const warn = !d.settings.whLine1 ? '<div class="tr-warn">Add the warehouse address in Settings: until then customers see "coming soon".</div>'
    : !d.couriers.some((c) => c.active) ? '<div class="tr-warn">Add at least one courier with a price list, or boxes cannot be priced.</div>' : '';
  root.innerHTML = `<div class="tr-h"><div><h1>Turkey warehouse</h1><p>Receive, pack, price and send to the UK. <a href="/admin">Back to admin</a></p></div>
      ${['recv', 'wh', 'box'].includes(S.tab) ? `<input class="inp" id="q" placeholder="Search code, name, tracking…" value="${esc(S.q)}" style="max-width:280px">` : ''}</div>
    ${warn}
    <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}${counts[k] ? `<span class="n">${counts[k]}</span>` : ''}</button>`).join('')}</div>
    ${S.tab === 'recv' ? recvTab() : S.tab === 'wh' ? whTab() : S.tab === 'box' ? boxTab() : S.tab === 'cour' ? courTab() : setTab()}`;
}

async function load() { S.d = await api('/api/admin/tr'); render(); }
const val = (sel, name) => root.querySelector(`${sel} [name="${name}"]`)?.value ?? '';
const form = (sel) => Object.fromEntries([...root.querySelectorAll(`${sel} [name]`)].map((i) => [i.name, i.value]));
async function busy(fn, ok) {
  if (S.busy) return;
  S.busy = true; render();
  try { await fn(); if (ok) toast(ok); } catch (e) { toast(e.message); }
  S.busy = false; render();
}

root.addEventListener('input', (e) => {
  if (e.target.id === 'q') { S.q = e.target.value; const pos = e.target.selectionStart; render(); const q = root.querySelector('#q'); q.focus(); q.setSelectionRange(pos, pos); }
});
root.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.note) { try { await api(`/api/admin/tr/packages/${t.dataset.note}`, { method: 'POST', body: { note: t.value } }); toast('Note saved'); } catch (err) { toast(err.message); } }
});
root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest('#rf') && e.target.tagName === 'INPUT') root.querySelector('[data-act="receive"]')?.click(); });
root.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const ds = b.dataset;
  if (ds.tab) { S.tab = ds.tab; S.edit = null; history.replaceState(null, '', `/admin/turkey?tab=${ds.tab}`); render(); load().catch(() => {}); return; }
  if (ds.recv) { const p = S.d.packages.find((x) => x.id === ds.recv); S.recv = { packageId: p.id, tracking: p.tracking || '', label: `${p.suite} · ${p.customer} · ${p.store}: ${p.description}` }; render(); root.querySelector('#rf [name="weightKg"]')?.focus(); return; }
  if (ds.discard) { if (!confirm('Mark this parcel as discarded?')) return; await busy(async () => { await api(`/api/admin/tr/packages/${ds.discard}`, { method: 'POST', body: { discard: true } }); await load(); }, 'Discarded'); return; }
  const wd = (id) => ({ weightKg: root.querySelector(`[data-w="${id}"]`)?.value, dims: root.querySelector(`[data-d="${id}"]`)?.value });
  if (ds.prev) { const body = { ...wd(ds.prev), preview: true }; S.draft[ds.prev] = body; await busy(async () => { S.preview[ds.prev] = (await api(`/api/admin/tr/shipments/${ds.prev}/measure`, { method: 'POST', body })).quotes; }); return; }
  if (ds.measure) { const body = wd(ds.measure); S.draft[ds.measure] = body; await busy(async () => { await api(`/api/admin/tr/shipments/${ds.measure}/measure`, { method: 'POST', body }); delete S.preview[ds.measure]; await load(); }, 'Price sent to the customer'); return; }
  if (ds.ship) { const trackingNo = root.querySelector(`[data-t="${ds.ship}"]`)?.value; await busy(async () => { await api(`/api/admin/tr/shipments/${ds.ship}/ship`, { method: 'POST', body: { trackingNo } }); await load(); }, 'Marked as sent. The customer got the tracking number.'); return; }
  if (ds.deliv) { await busy(async () => { await api(`/api/admin/tr/shipments/${ds.deliv}/delivered`, { method: 'POST', body: {} }); await load(); }, 'Delivered'); return; }
  if (ds.editcour) { S.edit = { ...S.d.couriers.find((c) => c.id === ds.editcour) }; render(); root.querySelector('#cf')?.scrollIntoView({ behavior: 'smooth' }); return; }
  if (ds.delcour) { if (!confirm('Delete this courier? Prices already sent to customers stay as they are.')) return; await busy(async () => { await api(`/api/admin/tr/couriers/${ds.delcour}/delete`, { method: 'POST', body: {} }); S.edit = null; await load(); }, 'Deleted'); return; }
  switch (ds.act) {
    case 'clearRecv': S.recv = {}; render(); break;
    case 'receive': {
      const body = { ...form('#rf'), packageId: S.recv.packageId || '' };
      S.recv = { ...S.recv, ...body };
      await busy(async () => { await api('/api/admin/tr/receive', { method: 'POST', body }); S.recv = {}; await load(); root.querySelector('#rf [name="tracking"]')?.focus(); }, 'Received. The customer got an email.');
      break;
    }
    case 'newCour': S.edit = {}; render(); break;
    case 'closeCour': S.edit = null; render(); break;
    case 'saveCour': {
      const body = { ...form('#cf'), id: S.edit.id || '' };
      S.edit = { ...S.edit, ratesRaw: body.rates };
      await busy(async () => { await api('/api/admin/tr/couriers', { method: 'POST', body }); S.edit = null; await load(); }, 'Courier saved');
      break;
    }
    case 'saveSet': { const body = form('#sf'); await busy(async () => { await api('/api/admin/tr/settings', { method: 'POST', body }); await load(); }, 'Settings saved'); break; }
    default:
  }
});

(async () => {
  try { await load(); } catch { location.href = '/login?next=/admin/turkey'; }
})();
