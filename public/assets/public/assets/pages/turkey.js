import { mountShell } from '../shell.js';
import { api, esc, gbp, toast, niceDate } from '../market-ui.js';

/**
 * Shop from Turkey: the customer's Turkish warehouse address, parcels on the way and in the
 * warehouse, and the boxes we send to the UK (price, pay, tracking).
 */
const root = document.createElement('div');
root.className = 'tr-page';
root.style.cssText = 'display:flex;flex-direction:column;gap:22px';
const S = { d: null, me: null, tab: 'here', sel: new Set(), form: null, ship: false, calc: null, pick: {}, busy: false };

const PKG = { expected: 'On the way', received: 'In warehouse', requested: 'In a box', shipped: 'Sent', discarded: 'Discarded' };
const BOX = { requested: 'Packing', quoted: 'Ready to pay', paid: 'Paid', shipped: 'On its way', delivered: 'Delivered', cancelled: 'Cancelled' };
const STEPS = [['requested', 'Requested'], ['quoted', 'Packed & priced'], ['paid', 'Paid'], ['shipped', 'On its way'], ['delivered', 'Delivered']];
const ORDER = STEPS.map(([k]) => k);
const SHOPS = [['Trendyol', 'https://www.trendyol.com'], ['Hepsiburada', 'https://www.hepsiburada.com'], ['Amazon.com.tr', 'https://www.amazon.com.tr'], ['N11', 'https://www.n11.com'], ['Koton', 'https://www.koton.com'], ['LC Waikiki', 'https://www.lcw.com']];
const kg = (v) => (v == null ? '' : `${Number(v).toFixed(2).replace(/\.?0+$/, '')} kg`);
const tl = (v) => (v == null ? '' : `${Number(v).toLocaleString('tr-TR')} TL`);

function addressCard() {
  const d = S.d, a = d.address;
  if (!a) {
    return `<section class="tr-card"><h2 class="tr-flag"><i>TR</i>Your Turkish address</h2>
      <div class="tr-info">We are opening our Istanbul warehouse. Your code is ready: <b>${esc(d.suite)}</b>. The full address will appear here, and we will email you when it does.</div></section>`;
  }
  const rows = [['Ad Soyad (name)', a.name, true], ['Adres', a.line1], ['Adres 2', a.line2, true], ['İlçe (district)', a.district], ['İl (city)', a.city], ['Posta kodu', a.postcode], ['Telefon', a.phone], ['Ülke', a.country]].filter((r) => r[1]);
  const mark = (v) => esc(v).replace(esc(d.suite), `<mark>${esc(d.suite)}</mark>`);
  return `<div class="tr-addr">
    <section class="tr-card"><h2 class="tr-flag"><i>TR</i>Your Turkish address</h2>
      <span class="muted" style="font-size:14px">Use this as the delivery address when you buy from a Turkish shop.</span>
      <div class="tr-rows">${rows.map(([k, v]) => `<div class="tr-row"><span>${esc(k)}</span><b>${mark(v)}</b><button type="button" class="tr-copy" data-copy="${esc(v)}">Copy</button></div>`).join('')}</div>
      <button type="button" class="btn ghost" data-copy="${esc(rows.map((r) => r[1]).join('\n'))}">Copy the whole address</button>
    </section>
    <section class="tr-card"><span class="muted" style="font-size:13px;font-weight:700">YOUR CODE</span><span class="tr-code">${esc(d.suite)}</span>
      <div class="tr-warn"><b>Always put ${esc(d.suite)} after your name.</b> It is how we know the parcel is yours. A parcel without it can take days to match.</div>
      <div class="tr-info">Storage is free for <b>${d.fees.freeDays} days</b>. Wait for more orders and we pack them into one box, so you pay one shipping price.</div>
      <span class="muted" style="font-size:13px;font-weight:700;margin-top:4px">START SHOPPING</span>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${SHOPS.map(([n, u]) => `<a class="btn ghost sm" href="${u}" target="_blank" rel="noopener">${n}</a>`).join('')}</div>
      <span class="tr-break">At checkout, choose delivery to an address in Türkiye and paste your Turkish address. Stuck at checkout? Ask us in Help.</span>
    </section></div>`;
}

const how = () => `<div class="tr-steps">
  <div><em>1</em><b>Shop</b>Buy on Trendyol, Hepsiburada, Amazon.com.tr or any Turkish shop, with your address above.</div>
  <div><em>2</em><b>Tell us</b>Add the order here: shop, what it is, price and tracking number.</div>
  <div><em>3</em><b>We receive it</b>We weigh it and email you. Keep it, or wait and combine more parcels.</div>
  <div><em>4</em><b>Send to the UK</b>Choose the parcels, we pack and price the box. Pick a courier, pay, track.</div></div>`;

function pkgForm() {
  const f = S.form;
  if (!f) return '';
  return `<section class="tr-card" id="pform"><h2>${f.id ? 'Edit the order' : 'Tell us about an order'}</h2>
    <div class="grid2">
      <label class="fld">Shop<select class="inp" name="store">${S.d.stores.map((s) => `<option ${s === (f.store || 'Trendyol') ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
      <label class="fld">Order number <em>(optional)</em><input class="inp" name="orderNo" value="${esc(f.orderNo || '')}" maxlength="60"></label>
      <label class="fld">What is it? <em>(for customs, in English)</em><input class="inp" name="description" value="${esc(f.description || '')}" placeholder="e.g. 2 cotton T-shirts" maxlength="300"></label>
      <label class="fld">Price you paid (TL)<input class="inp" name="valueTry" inputmode="numeric" value="${esc(f.valueTry || '')}" placeholder="e.g. 1250"></label>
      <label class="fld">Tracking number in Turkey <em>(add it when the shop sends it)</em><input class="inp" name="tracking" value="${esc(f.tracking || '')}" placeholder="Trendyol Express, Yurtiçi, Aras…" maxlength="60"></label>
    </div>
    <div class="actions" style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn" data-act="savePkg" ${S.busy ? 'disabled' : ''}>${f.id ? 'Save' : 'Add order'}</button><button type="button" class="btn ghost" data-act="closeForm">Cancel</button></div>
  </section>`;
}

function pkgRow(p, selectable) {
  const bits = [p.store, p.orderNo ? `Order ${p.orderNo}` : '', tl(p.valueTry)].filter(Boolean).join(' · ');
  const info = p.status === 'expected'
    ? (p.tracking ? `Tracking ${esc(p.tracking)}` : '<span style="color:#9A5B00">Add the tracking number when you get it</span>')
    : p.status === 'received'
      ? `Arrived ${esc(niceDate(p.receivedAt))} · ${kg(p.weightKg)}${p.dims ? ` · ${esc(p.dims)} cm` : ''} · ${p.storagePence ? `<b style="color:#B42318">Storage ${gbp(p.storagePence)}</b>` : `free until ${esc(niceDate(p.freeUntil))}`}`
      : '';
  return `<div class="tr-item ${S.sel.has(p.id) ? 'sel' : ''}">
    ${selectable ? `<input type="checkbox" data-sel="${p.id}" ${S.sel.has(p.id) ? 'checked' : ''} aria-label="Choose ${esc(p.description || p.store)}">` : ''}
    <div class="m"><b>${esc(p.description || 'Parcel (please add what is in it)')}</b><span>${esc(bits)}</span><span>${info}</span>${p.status === 'received' && (!p.valueTry || !p.description) ? '<span style="color:#B42318;font-weight:700">Add what it is and the price you paid (Edit) before sending: customs needs it.</span>' : ''}${p.note ? `<span>Warehouse note: ${esc(p.note)}</span>` : ''}</div>
    <div class="s"><span class="badge ${p.status}">${p.hold && p.status === 'received' ? 'Keeping' : PKG[p.status] || p.status}</span>
      ${['expected', 'received'].includes(p.status) ? `<button type="button" class="btn ghost sm" data-edit="${p.id}">Edit</button>` : ''}
      ${p.status === 'received' ? `<button type="button" class="btn ghost sm" data-hold="${p.id}">${p.hold ? 'Ready to send' : 'Keep for now'}</button>` : ''}
      ${p.status === 'expected' ? `<button type="button" class="btn ghost sm" data-remove="${p.id}">Remove</button>` : ''}</div>
  </div>`;
}

function shipForm() {
  if (!S.ship) return '';
  const chosen = S.d.packages.filter((p) => S.sel.has(p.id));
  const f = S.d.fees, n = chosen.length;
  const me = S.me || {};
  return `<section class="tr-card" id="sform"><h2>Send ${n} parcel${n > 1 ? 's' : ''} to the UK</h2>
    <div class="tr-info">${n > 1 ? `We pack them into <b>one box</b> (${gbp(f.consolidatePence)} per extra parcel), so you pay one shipping price.` : 'We check and pack it.'}
      Then we weigh the box and send you the price for each courier. You pay only when you have chosen.</div>
    <div class="grid2">
      <label class="fld">Full name<input class="inp" name="name" value="${esc(me.name || '')}" autocomplete="name"></label>
      <label class="fld">Phone<input class="inp" name="phone" value="${esc(me.phone || '')}" autocomplete="tel" placeholder="07…"></label>
      <label class="fld">Address line 1<input class="inp" name="line1" autocomplete="address-line1"></label>
      <label class="fld">Address line 2 <em>(optional)</em><input class="inp" name="line2" autocomplete="address-line2"></label>
      <label class="fld">Town or city<input class="inp" name="city" autocomplete="address-level2"></label>
      <label class="fld">Postcode<input class="inp" name="postcode" autocomplete="postal-code" style="text-transform:uppercase"></label>
    </div>
    <label class="fld">Note for the warehouse <em>(optional)</em><input class="inp" name="note" placeholder="e.g. remove the shoe boxes to save space" maxlength="500"></label>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn big" data-act="sendBox" ${S.busy ? 'disabled' : ''}>Ask for the price</button><button type="button" class="btn ghost" data-act="closeShip">Cancel</button></div>
  </section>`;
}

function boxCard(s) {
  const at = ORDER.indexOf(s.status);
  const addr = [s.address.name, s.address.line1, s.address.city, s.address.postcode].filter(Boolean).join(', ');
  let body = '';
  if (s.status === 'requested') body = '<div class="tr-info">We are packing your box. You get an email with the prices as soon as it is weighed, usually within 1 working day.</div>';
  if (s.status === 'quoted') {
    const pick = S.pick[s.id] || s.quotes[0]?.courierId;
    const q = s.quotes.find((x) => x.courierId === pick) || s.quotes[0];
    body = `<span class="muted" style="font-size:14px">Box: ${kg(s.weightKg)}, ${esc(s.dims || '')} cm. Choose a courier:</span>
      <div class="tr-opts">${s.quotes.map((x) => `<label class="tr-opt"><input type="radio" name="c_${s.id}" value="${x.courierId}" data-pick="${s.id}" ${x.courierId === pick ? 'checked' : ''}>
        <span class="n"><b>${esc(x.name)}</b><span>${x.daysMin}–${x.daysMax} working days · charged as ${x.chargeableKg} kg</span>
        <span class="tr-break">Shipping ${gbp(x.breakdown.shipping + x.breakdown.fuel)} · handling ${gbp(x.breakdown.handling)}${x.breakdown.consolidation ? ` · combining ${gbp(x.breakdown.consolidation)}` : ''}${x.breakdown.storage ? ` · storage ${gbp(x.breakdown.storage)}` : ''}</span></span>
        <span class="p">${gbp(x.pence)}</span></label>`).join('')}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn big" data-pay="${s.id}" data-with="card" ${S.busy ? 'disabled' : ''}>Pay ${gbp(q.pence)} by card</button>
        <button type="button" class="btn ghost" data-pay="${s.id}" data-with="wallet" ${S.busy ? 'disabled' : ''}>Pay from wallet</button>
        <button type="button" class="btn ghost" data-cancel="${s.id}">Cancel, keep my parcels</button></div>
      <span class="tr-break">UK import VAT (and duty over £135) may be due: the courier asks you for it before delivery.</span>`;
  }
  if (s.status === 'paid') body = `<div class="tr-info">Paid ${gbp(s.pricePence)} for ${esc(s.courierName)}. We hand it to the courier the same or next working day and email you the tracking number.</div>`;
  if (s.status === 'shipped' || s.status === 'delivered') {
    body = `<div class="kvs"><div><span>Courier</span><b>${esc(s.courierName)}</b></div><div><span>Tracking number</span><b>${esc(s.trackingNo)}</b></div><div><span>Sent</span><b>${esc(niceDate(s.shippedAt))}</b></div></div>
      ${s.trackingUrl ? `<a class="btn" href="${esc(s.trackingUrl)}" target="_blank" rel="noopener">Track on ${esc(s.courierName)}</a>` : ''}`;
  }
  return `<article class="tr-box"><div class="tr-box-h"><b>${esc(s.ref)}</b><span class="badge ${s.status}">${BOX[s.status] || s.status}</span></div>
    ${s.status !== 'cancelled' ? `<div class="tr-track">${STEPS.map(([k, l], i) => `<div class="${i <= at ? 'on' : ''}">${l}</div>`).join('')}</div>` : ''}
    <span class="muted" style="font-size:14px">To ${esc(addr)} · asked ${esc(niceDate(s.createdAt))}</span>${body}</article>`;
}

function calcCard() {
  if (!S.calc) return '';
  const c = S.calc;
  return `<section class="tr-card" id="calc"><h2>How much to send?</h2>
    <div class="tr-calc"><label class="fld">Weight (kg)<input class="inp" name="ckg" inputmode="decimal" value="${esc(c.kg || '')}" placeholder="e.g. 2"></label>
      <label class="fld">Box size cm <em>(optional)</em><input class="inp" name="cdims" value="${esc(c.dims || '')}" placeholder="40x30x20"></label>
      <label class="fld">Parcels<input class="inp" name="cpar" inputmode="numeric" value="${esc(c.parcels || 1)}"></label>
      <button type="button" class="btn" data-act="calc">Show prices</button></div>
    ${c.quotes ? (c.quotes.length ? `<div class="tr-opts">${c.quotes.map((x) => `<div class="tr-opt"><span class="n"><b>${esc(x.name)}</b><span>${x.daysMin}–${x.daysMax} working days · ${x.chargeableKg} kg</span></span><span class="p">${gbp(x.pence)}</span></div>`).join('')}</div>
      <span class="tr-break">Estimate including handling. The final price comes from the weight and size of your packed box.</span>` : '<div class="tr-warn">No price for this size yet. Ask us in Help.</div>') : ''}
  </section>`;
}

function render() {
  const d = S.d;
  const by = (st) => d.packages.filter((p) => st.includes(p.status));
  const onWay = by(['expected']), here = by(['received']), boxes = d.shipments.filter((s) => s.status !== 'cancelled' || S.tab === 'boxes');
  const openBoxes = d.shipments.filter((s) => ['requested', 'quoted', 'paid', 'shipped'].includes(s.status)).length;
  const tabs = [['here', 'In warehouse', here.length], ['way', 'On the way', onWay.length], ['boxes', 'My boxes', openBoxes]];
  const list = S.tab === 'way' ? onWay : S.tab === 'here' ? here : [];
  const chosen = here.filter((p) => S.sel.has(p.id));
  const toPay = d.shipments.filter((s) => s.status === 'quoted');
  root.innerHTML = `<div class="tr-h"><div><h1>Shop from Turkey</h1><p>Buy from Turkish shops with your own Istanbul address. We send it to your door in the UK.</p></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn" data-act="newPkg">+ Tell us about an order</button><button type="button" class="btn ghost" data-act="openCalc">Price calculator</button></div></div>
    ${toPay.length ? `<div class="tr-warn"><b>${toPay.length} box${toPay.length > 1 ? 'es are' : ' is'} packed and waiting for you.</b> Choose a courier and pay in My boxes. <button type="button" class="btn sm" data-tab="boxes" style="margin-left:6px">Open</button></div>` : ''}
    ${addressCard()}
    ${pkgForm()}${calcCard()}
    ${d.packages.length || d.shipments.length ? '' : how()}
    <div class="tabs" role="tablist">${tabs.map(([k, l, n]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}${n ? `<span class="n">${n}</span>` : ''}</button>`).join('')}</div>
    ${S.tab === 'boxes'
    ? `<div class="tr-list">${boxes.length ? boxes.map(boxCard).join('') : '<div class="empty-box"><b>No boxes yet</b><span>Choose parcels in "In warehouse" and press Send.</span></div>'}</div>`
    : `<div class="tr-list">${list.length ? list.map((p) => pkgRow(p, S.tab === 'here')).join('')
      : S.tab === 'here' ? '<div class="empty-box"><b>Nothing in the warehouse yet</b><span>When your parcels arrive we weigh them and they show up here.</span></div>'
        : '<div class="empty-box"><b>No orders on the way</b><span>Bought something? Add it so we can match it when it arrives.</span><button type="button" class="btn" data-act="newPkg">+ Tell us about an order</button></div>'}</div>`}
    ${S.tab === 'here' && here.length ? `<div class="tr-bar"><span class="t"><b>${chosen.length ? `${chosen.length} chosen · ${kg(chosen.reduce((a, p) => a + (p.weightKg || 0), 0))}` : 'Choose the parcels to send'}</b>${chosen.length > 1 ? 'They go in one box.' : 'Tick more to combine them in one box.'}</span>
      <button type="button" class="btn ghost" data-act="all" style="color:#FFFFFF;background:transparent;border-color:#3B4A63">${chosen.length === here.length ? 'Clear' : 'Choose all'}</button>
      <button type="button" class="btn" data-act="openShip" ${chosen.length ? '' : 'disabled'}>${chosen.length > 1 ? 'Combine and send' : 'Send now'}</button></div>` : ''}
    ${shipForm()}
    <p class="muted" style="font-size:13px;margin:0">Not allowed: batteries on their own, perfume and aerosols over courier limits, weapons, medicines, food that spoils. Ask us in Help if you are not sure.</p>`;
}

async function load() {
  S.d = await api('/api/tr');
  const ids = new Set(S.d.packages.filter((p) => p.status === 'received').map((p) => p.id));
  for (const id of [...S.sel]) if (!ids.has(id)) S.sel.delete(id);
  render();
}
const val = (sel, name) => root.querySelector(`${sel} [name="${name}"]`)?.value ?? '';
async function busy(fn) {
  if (S.busy) return;
  S.busy = true; render();
  try { await fn(); } catch (e) { toast(e.message); }
  S.busy = false; render();
}

root.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.sel) { t.checked ? S.sel.add(t.dataset.sel) : S.sel.delete(t.dataset.sel); render(); }
  if (t.dataset.pick) { S.pick[t.dataset.pick] = t.value; render(); }
});
root.addEventListener('click', async (e) => {
  const b = e.target.closest('button, [data-copy]');
  if (!b) return;
  const ds = b.dataset;
  if (ds.copy != null) { try { await navigator.clipboard.writeText(ds.copy); toast('Copied'); } catch { toast(ds.copy); } return; }
  if (ds.tab) { S.tab = ds.tab; render(); return; }
  if (ds.edit) { S.form = { ...S.d.packages.find((p) => p.id === ds.edit) }; render(); root.querySelector('#pform')?.scrollIntoView({ behavior: 'smooth' }); return; }
  if (ds.hold) { const p = S.d.packages.find((x) => x.id === ds.hold); await busy(async () => { await api(`/api/tr/packages/${p.id}`, { method: 'POST', body: { hold: !p.hold } }); await load(); }); return; }
  if (ds.remove) { await busy(async () => { await api(`/api/tr/packages/${ds.remove}/remove`, { method: 'POST', body: {} }); await load(); toast('Removed'); }); return; }
  if (ds.cancel) { await busy(async () => { await api(`/api/tr/shipments/${ds.cancel}/cancel`, { method: 'POST', body: {} }); await load(); toast('Cancelled. Your parcels are back in the warehouse.'); }); return; }
  if (ds.pay) {
    const s = S.d.shipments.find((x) => x.id === ds.pay);
    const courierId = S.pick[s.id] || s.quotes[0]?.courierId;
    await busy(async () => {
      const r = await api(`/api/tr/shipments/${s.id}/pay`, { method: 'POST', body: { courierId, payWith: ds.with } });
      if (r.url && !r.url.includes('/app/turkey')) { location.href = r.url; return; }
      await load(); toast('Paid. We send it the same or next working day.');
    });
    return;
  }
  switch (ds.act) {
    case 'newPkg': S.form = {}; render(); root.querySelector('#pform')?.scrollIntoView({ behavior: 'smooth' }); break;
    case 'closeForm': S.form = null; render(); break;
    case 'savePkg': {
      const body = Object.fromEntries(['store', 'orderNo', 'description', 'valueTry', 'tracking'].map((k) => [k, val('#pform', k)]));
      body.valueTry = Number(String(body.valueTry).replace(/[^\d]/g, '')) || 0;
      await busy(async () => {
        await api(S.form.id ? `/api/tr/packages/${S.form.id}` : '/api/tr/packages', { method: 'POST', body: S.form.id ? { description: body.description, valueTry: body.valueTry, tracking: body.tracking, orderNo: body.orderNo } : body });
        S.form = null; if (S.tab === 'boxes') S.tab = 'way'; await load(); toast('Saved. We will match it when it arrives.');
      });
      break;
    }
    case 'all': { const here = S.d.packages.filter((p) => p.status === 'received'); if (S.sel.size === here.length) S.sel.clear(); else here.forEach((p) => S.sel.add(p.id)); render(); break; }
    case 'openShip': S.ship = true; render(); root.querySelector('#sform')?.scrollIntoView({ behavior: 'smooth' }); break;
    case 'closeShip': S.ship = false; render(); break;
    case 'sendBox': {
      const address = Object.fromEntries(['name', 'phone', 'line1', 'line2', 'city', 'postcode'].map((k) => [k, val('#sform', k)]));
      const note = val('#sform', 'note');
      await busy(async () => {
        const r = await api('/api/tr/shipments', { method: 'POST', body: { packageIds: [...S.sel], address, note } });
        S.ship = false; S.sel.clear(); S.tab = 'boxes'; await load(); toast(`Box ${r.ref} requested. We email you the price once it is packed.`);
      });
      break;
    }
    case 'openCalc': S.calc = S.calc ? null : { parcels: 1 }; render(); break;
    case 'calc': {
      const c = { kg: val('#calc', 'ckg'), dims: val('#calc', 'cdims'), parcels: val('#calc', 'cpar') || 1 };
      await busy(async () => { const r = await api(`/api/tr/estimate?kg=${encodeURIComponent(c.kg)}&dims=${encodeURIComponent(c.dims)}&parcels=${encodeURIComponent(c.parcels)}`); S.calc = { ...c, quotes: r.quotes }; });
      break;
    }
    default:
  }
});

(async () => {
  try { const sh = await mountShell('tr'); S.me = sh.me; sh.main.append(root); } catch { location.href = `/login?next=${encodeURIComponent(location.pathname)}`; return; }
  root.innerHTML = '<div class="card center"><span class="spin" aria-hidden="true"></span><span class="muted">Loading…</span></div>';
  try {
    await load();
    const paid = new URLSearchParams(location.search).get('paid');
    if (paid) {
      history.replaceState(null, '', '/app/turkey'); S.tab = 'boxes';
      toast(`Payment for ${paid} received. Confirming…`);
      for (let i = 0; i < 10 && !S.d.shipments.some((s) => s.ref === paid && s.status !== 'quoted'); i++) { await new Promise((r) => setTimeout(r, 2000)); await load(); }
      render();
    }
  } catch (e) { root.innerHTML = `<div class="card center">${esc(e.message)}</div>`; }
})();
