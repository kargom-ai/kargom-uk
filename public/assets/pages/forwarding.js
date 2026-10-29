import { api, esc, gbp, wrapLabels } from '../market-ui.js';
import { OPTIONS, SEP, placeByCode, place } from '../countries.js';

/**
 * Parcel forwarding: shop in the USA (or UK, China…), we receive it at a warehouse and send it on.
 * Until the warehouse partner is live, the page shows a delivery estimate and takes sign-ups.
 */

const root = document.getElementById('root');
const qs = new URLSearchParams(location.search);
const SHOP_IN = ['US', 'GB', 'CN', 'DE', 'IT', 'FR', 'JP', 'TR'];
const S = {
  from: SHOP_IN.includes(qs.get('from')) ? qs.get('from') : 'US',
  to: placeByCode(qs.get('to') || '') ? qs.get('to') : 'GB',
  kg: qs.get('kg') || '', est: null, busy: false, err: '', me: null, email: '', joined: null,
};
const name = (c) => (c === 'GB' ? 'the UK' : c === 'US' ? 'the USA' : placeByCode(c)?.n || c);
const money = (p) => gbp(p).replace('.00', '');

const IC = {
  pin: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
  bag: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
  cam: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>',
  plane: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>',
};

function priceHtml() {
  const e = S.est;
  const body = S.busy ? '<div class="ldr"><span class="spin" aria-hidden="true"></span><b>Working out the price…</b></div>'
    : e ? `<div class="est"><span class="est-l">Estimated delivery to ${esc(name(S.to))}</span><b>${money(e.totalLowPence)} – ${money(e.totalHighPence)}</b>
        <span class="est-n">For a ${esc(S.kg)} kg parcel (box about ${e.box.l}×${e.box.w}×${e.box.h} cm) by DHL, UPS or FedEx, ${e.daysMin}–${e.daysMax} working days. Includes ${money(e.handlingPence)} for receiving, photos and repacking. Import VAT and any duty are extra.</span></div>`
    : S.err ? `<div class="err">${esc(S.err)}</div>` : '<p class="muted" style="margin:0">Enter the weight to see the price.</p>';
  return wrapLabels(`<section class="card fw-calc">
    <h2>How much to forward my parcel?</h2>
    <div class="fw-row">
      <label class="fld">Shop in<select class="inp" data-k="from">${SHOP_IN.map((c) => `<option value="${c}" ${c === S.from ? 'selected' : ''}>${esc(placeByCode(c)?.n || c)}</option>`).join('')}</select></label>
      <label class="fld">Deliver to<select class="inp" data-k="to">${OPTIONS.map((o) => (o === SEP ? `<option disabled>${SEP}</option>` : `<option value="${place(o).code}" data-n="${esc(o)}" ${o === placeByCode(S.to)?.n ? 'selected' : ''}>${esc(o)}</option>`)).join('')}</select></label>
      <label class="fld">Weight (kg)<input class="inp" data-k="kg" inputmode="decimal" value="${esc(S.kg)}" placeholder="e.g. 2"></label>
      <button type="button" class="btn" data-go>See price</button>
    </div>
    ${body}
  </section>`);
}

function joinHtml() {
  if (S.joined) return `<section class="card fw-join ok-box"><b>You are on the list</b><span>You are number ${S.joined} on the waiting list. We will email you your free Kargom ${S.from === 'US' ? 'US' : esc(placeByCode(S.from)?.n || '')} address as soon as it opens.</span></section>`;
  return `<section class="card fw-join"><div><b>Get your free ${S.from === 'US' ? 'US' : esc(placeByCode(S.from)?.n || '')} address</b>
      <span>Kargom forwarding opens soon. Join the waiting list and be first to get your address, with no membership fee.</span></div>
    <div class="fw-join-f"><input class="inp" type="email" data-k="email" value="${esc(S.email)}" placeholder="Your email" autocomplete="email" aria-label="Your email"><button type="button" class="btn" data-join>Join the waiting list</button></div></section>`;
}

function render() {
  root.className = 'wrap fw';
  root.innerHTML = `<section class="fw-hero">
      <h1>Shop in ${esc(name(S.from))}. We deliver it to ${esc(name(S.to))}.</h1>
      <p>Get a Kargom address at a warehouse in ${esc(name(S.from))}. Buy from any store there, from Amazon and Nike to small shops that do not ship abroad. We receive your parcels, send you photos, combine them into one box and deliver them to your door.</p>
    </section>
    <div class="fw-cols">${priceHtml()}${joinHtml()}</div>
    <section class="fw-steps"><h2>How it works</h2><div class="fw-grid">
      <div class="tile"><span class="ic">${IC.pin}</span><b>1. Get your address</b><span>Sign up and get your own address with a personal code, for example Suite KG-10234.</span></div>
      <div class="tile"><span class="ic">${IC.bag}</span><b>2. Shop and send it there</b><span>Use the address at checkout, like any local customer. Many stores give free delivery to it.</span></div>
      <div class="tile"><span class="ic">${IC.cam}</span><b>3. We receive and combine</b><span>We email you a photo and the weight. Buying from several stores? We put it all in one box to save you money.</span></div>
      <div class="tile"><span class="ic">${IC.plane}</span><b>4. Pay and we deliver</b><span>Compare DHL, UPS and FedEx prices, pay, and track your parcel to your door.</span></div>
    </div></section>
    <section class="fw-faq"><h2>Good to know</h2>
      <details><summary>Do I pay import VAT and duty?</summary><p>Usually, yes. In the UK, goods worth up to £135 have 20% VAT and no duty. Above £135 there is VAT and, for some goods, customs duty. The courier collects these before delivery. We put the real value on the customs form, as the law requires.</p></details>
      <details><summary>What can I not send?</summary><p>Anything couriers cannot fly: perfume and aftershave, aerosols, loose lithium batteries, weapons, cash and many liquids. Phones and laptops with their battery inside are usually fine.</p></details>
      <details><summary>How long do you keep my parcels?</summary><p>Up to 30 days free, so you have time to buy from several stores and combine them.</p></details>
    </section>`;
}

async function estimate() {
  const kg = Number(String(S.kg).replace(',', '.'));
  if (!(kg > 0)) { S.err = 'Enter the weight in kg.'; S.est = null; render(); return; }
  S.busy = true; S.err = ''; render();
  try {
    const r = await api(`/api/forwarding/estimate?${new URLSearchParams({ from: S.from, to: S.to, kg: String(kg) })}`);
    S.est = r.estimate; if (!r.estimate) S.err = 'We cannot price this route yet.';
    history.replaceState(null, '', `/forwarding?${new URLSearchParams({ from: S.from, to: S.to, kg: String(kg) })}`);
  } catch (e) { S.est = null; S.err = e.message; }
  S.busy = false; render();
}

async function join() {
  try {
    const r = await api('/api/forwarding/waitlist', { method: 'POST', body: { email: S.email, from: S.from, to: S.to } });
    S.joined = r.position; render();
  } catch (e) { S.err = e.message; render(); const box = document.querySelector('.fw-join'); if (box) box.insertAdjacentHTML('beforeend', `<div class="err">${esc(e.message)}</div>`); }
}

root.addEventListener('input', (e) => {
  const k = e.target.dataset?.k; if (!k) return;
  S[k] = e.target.value;
  if (k === 'from' || k === 'to') { S.est = null; if (S.kg) estimate(); else render(); }
});
root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset?.k === 'kg') estimate(); });
root.addEventListener('click', (e) => {
  if (e.target.closest('[data-go]')) estimate();
  if (e.target.closest('[data-join]')) join();
});

document.getElementById('top').insertAdjacentHTML('beforeend', '<a class="toplink" href="/login">Sign in</a>');
api('/api/me').then((me) => { S.me = me; if (me) { S.email = me.email || ''; const a = document.querySelector('#top .toplink'); if (a) { a.href = '/app'; a.textContent = 'My account'; } render(); } }).catch(() => {});
render();
if (S.kg) estimate();
