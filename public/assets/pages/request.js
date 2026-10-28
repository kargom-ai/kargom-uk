import { mountShell } from '../shell.js';
import { api, esc, gbp, toast, drawMap, routeChips, niceDate, ago, stars, ratingHtml, logoHtml, profileDrawer, detailsHtml, fullAddr, STATUS } from '../market-ui.js';

/** The customer's moving & freight requests: the list, and one request with its offers. */

const root = document.getElementById('root');
const id = (location.pathname.match(/^\/app\/requests\/([\w-]+)/) || [])[1];
const S = { job: null, tab: 'offers', rating: 0, busy: false };

function listView(jobs) {
  root.className = 'wrap';
  root.innerHTML = `<div class="req-h"><div><h1>Moving & freight requests</h1><span class="muted">Prices from removal companies and hauliers</span></div><a class="btn" href="/app/quote">+ Get a quote</a></div>
  <div class="list" style="margin-top:18px">${jobs.length ? jobs.map((j) => `<a class="li" href="/app/requests/${j.id}">
      <div class="li-main"><b>#${j.ref} · ${esc(j.title)}</b><span>${esc(j.fromArea)} → ${esc(j.toArea)} · ${esc(niceDate(j.date))}</span></div>
      <div class="li-side"><span class="badge ${j.status}">${esc(STATUS[j.status] || j.status)}</span>
        <span class="muted" style="font-size:14px">${j.offers ? `${j.offers} offer${j.offers > 1 ? 's' : ''} · from <b style="font:inherit;color:#1F2A3C">${gbp(j.bestPence)}</b>` : j.status === 'open' ? 'No offers yet' : ''}</span></div></a>`).join('')
    : `<div class="empty-box"><b style="font-size:18px">No requests yet</b><span>Moving home, or need a lorry? Tell us what you need and companies send you prices.</span><a class="btn" href="/app/quote">Get a quote</a></div>`}</div>`;
}

function offerCard(o, j, best) {
  const p = o.partner;
  const tel = p.phone.replace(/[^\d+]/g, '');
  const won = o.status === 'accepted';
  return `<article class="offer ${won ? 'won' : best ? 'best' : ''}">
    <div class="offer-top">
      <div class="co">${logoHtml(p)}<div class="co-t"><b>${esc(p.company)}</b><span>${ratingHtml(p)}</span>${p.jobsWon ? `<span class="muted" style="font-size:13px">${p.jobsWon} job${p.jobsWon > 1 ? 's' : ''} won on Kargom</span>` : ''}</div></div>
      <div class="price"><b>${gbp(o.pricePence)}</b><span>total inc VAT</span>${best && !won ? '<span class="badge booked pbadge">Best price</span>' : ''}${o.status !== 'pending' ? `<span class="badge ${o.status} pbadge">${o.status === 'accepted' ? 'Booked' : o.status === 'declined' ? 'Not chosen' : o.status}</span>` : ''}</div>
    </div>
    ${o.message ? `<div class="offer-msg">${esc(o.message)}</div>` : ''}
    ${o.vehicle || o.availableDate || o.validUntil ? `<div class="tags">${o.vehicle ? `<span>🚚 ${esc(o.vehicle)}</span>` : ''}${o.availableDate ? `<span>Available ${esc(niceDate(o.availableDate))}</span>` : ''}${o.validUntil ? `<span>Valid until ${esc(niceDate(o.validUntil))}</span>` : ''}</div>` : ''}
    <div class="acts">
      <a class="btn ghost" href="tel:${esc(tel)}" aria-label="Call ${esc(p.company)}">📞 ${esc(p.phone)}</a>
      <a class="btn ghost" href="mailto:${esc(p.email)}?subject=${encodeURIComponent(`Kargom request #${j.ref}`)}">Email</a>
      <button type="button" class="btn ghost" data-profile="${esc(o.id)}">Profile and reviews</button>
      ${j.status === 'open' && o.status === 'pending' ? `<button type="button" class="btn green" data-accept="${esc(o.id)}">Accept ${gbp(o.pricePence)}</button>` : ''}
    </div>
    <span class="muted" style="font-size:12px">Offer sent ${esc(ago(o.createdAt))}</span>
  </article>`;
}

/* No offers yet: say so plainly, and list companies based near the start of the job. */
function noOffersHtml(j) {
  const who = j.kind === 'removals' ? 'removal companies' : 'hauliers';
  const near = S.near;
  const list = !near ? '<p class="muted" style="margin:0">Finding companies near you…</p>'
    : !near.partners.length ? `<p class="muted" style="margin:0">No ${who} have joined near ${esc(j.fromArea)} yet. Your request is still open to every ${j.kind === 'removals' ? 'removal company' : 'haulier'} on Kargom.</p>`
    : near.partners.map((p) => `<article class="offer">
        <div class="offer-top"><div class="co">${logoHtml(p)}<div class="co-t"><b>${esc(p.company)}</b><span>${ratingHtml(p)}</span>
          <span class="muted" style="font-size:13px">${p.basedIn ? `Based in ${esc(p.basedIn)}` : 'UK'}${p.milesAway !== null && p.milesAway !== undefined ? ` · ${p.milesAway} miles from you` : ''}${p.jobsWon ? ` · ${p.jobsWon} job${p.jobsWon > 1 ? 's' : ''} won` : ''}</span></div></div></div>
        ${p.areas ? `<span class="muted" style="font-size:14px">Covers: ${esc(p.areas)}</span>` : ''}
        <div class="acts"><a class="btn ghost" href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">📞 ${esc(p.phone)}</a><button type="button" class="btn ghost" data-near="${esc(p.id)}">Profile and reviews</button></div>
      </article>`).join('');
  return `<div class="noff"><b>No offers yet</b><span>Your request has gone to ${who} on Kargom. Each offer appears here and in your email.</span></div>
    <h3 style="margin:8px 0 0;font-size:18px">${j.kind === 'removals' ? 'Removal companies' : 'Hauliers'} near ${esc(j.fromArea)}</h3>
    ${list}`;
}
async function loadNear() {
  if (S.near || S.nearBusy) return;
  S.nearBusy = true;
  try { S.near = await api(`/api/jobs/${S.job.id}/partners`); } catch { S.near = { near: S.job.fromArea, partners: [] }; }
  S.nearBusy = false;
  if (S.tab === 'offers') jobView();
}

function jobView() {
  const j = S.job;
  const won = j.offers.find((o) => o.status === 'accepted');
  const pending = j.offers.filter((o) => o.status === 'pending');
  const best = pending.length > 1 ? pending[0].id : null;
  root.className = 'wrap cols';
  root.innerHTML = `<div class="steps">
    <a href="/app/requests" class="muted" style="text-decoration:none">← All requests</a>
    <div class="req-h"><div><h1>#${j.ref} · ${esc(j.title)}</h1><span class="muted">${esc(j.fromArea)} → ${esc(j.toArea)} · ${esc(niceDate(j.date))}</span></div><span class="badge ${j.status}">${esc(STATUS[j.status] || j.status)}</span></div>
    ${new URLSearchParams(location.search).get('new') ? `<div class="ok">Request sent. Companies are being told now. We email you as each offer arrives, usually within a few hours.</div>` : ''}
    ${won ? `<div class="ok">You booked <b>${esc(won.partner.company)}</b> for ${gbp(won.pricePence)}. They now have your phone number and addresses and will call you to confirm. You can call them on <a href="tel:${esc(won.partner.phone.replace(/[^\d+]/g, ''))}">${esc(won.partner.phone)}</a>. Pay them directly as you agree.</div>` : ''}
    <div class="tabs" role="tablist">
      <button type="button" role="tab" data-tab="details" aria-selected="${S.tab === 'details'}">Request details</button>
      <button type="button" role="tab" data-tab="offers" aria-selected="${S.tab === 'offers'}">Offers <span class="n">${j.offers.length}</span></button>
    </div>
    ${S.tab === 'offers' ? `<div class="list">${j.offers.length ? j.offers.map((o) => offerCard(o, j, o.id === best)).join('')
      : j.status === 'open' ? noOffersHtml(j)
      : '<div class="empty-box">No offers.</div>'}</div>` : `
      <section class="card" style="display:flex;flex-direction:column;gap:14px">
        ${detailsHtml(j)}
        <div class="addr"><div><b>${j.kind === 'removals' ? 'Moving from' : 'Collection'}</b>${esc(fullAddr(j.from))}</div><div><b>${j.kind === 'removals' ? 'Moving to' : 'Delivery'}</b>${esc(fullAddr(j.to))}</div></div>
        <div class="kv"><span class="muted">Your phone</span><b>${esc(j.contactPhone)}</b></div>
        ${j.photos.length ? `<div class="photos">${j.photos.map((u, i) => `<a class="photo" href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="Photo ${i + 1}" loading="lazy"></a>`).join('')}</div>` : ''}
        ${j.status === 'open' ? '<button type="button" class="btn danger" data-cancel style="align-self:flex-start">Cancel this request</button>' : ''}
      </section>`}
    ${won && !j.review ? `<section class="card" style="display:flex;flex-direction:column;gap:10px"><h2 style="font-size:20px">How did ${esc(won.partner.company)} do?</h2>
      <span class="muted">Your review helps other customers choose. Leave it after the job is done.</span>
      <div class="starpick" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="${S.rating === n}" class="${S.rating >= n ? 'on' : ''}" data-star="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}</div>
      <textarea class="inp" id="rv" maxlength="1000" placeholder="What went well? Anything they could do better?"></textarea>
      <button type="button" class="btn" data-review style="align-self:flex-start">Post review</button></section>` : ''}
    ${j.review ? `<section class="card"><b>Your review</b><div style="margin-top:6px">${stars(j.review.rating)}</div>${j.review.comment ? `<p style="margin:6px 0 0">${esc(j.review.comment)}</p>` : ''}</section>` : ''}
  </div>
  <aside class="summary"><div class="card sum-card" style="flex-direction:column;align-items:stretch">
    <h2>Route</h2>
    <div class="route"><span class="pin a">A</span><span>${esc(j.fromArea)}</span></div><div class="route-line"></div>
    <div class="route"><span class="pin b">B</span><span>${esc(j.toArea)}</span></div>
    <div class="mapbox" id="map"></div><div id="miles"></div>
    ${pending.length ? `<div class="kv total"><span>Best offer</span><b>${gbp(pending[0].pricePence)}</b></div>` : ''}
  </div></aside>`;
  drawMap(document.getElementById('map'), { from: j.fromPostcode, to: j.toPostcode, fc: j.fromCountry, tc: j.toCountry })
    .then((r) => { const el = document.getElementById('miles'); if (el) el.innerHTML = routeChips(r || (j.distanceMiles ? { miles: j.distanceMiles, source: 'estimate' } : null)); });
}

root.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-tab],[data-profile],[data-near],[data-accept],[data-cancel],[data-star],[data-review]');
  if (!t || S.busy) return;
  const j = S.job;
  if (t.dataset.tab) { S.tab = t.dataset.tab; jobView(); if (S.tab === 'offers' && !S.job.offers.length) loadNear(); return; }
  if (t.dataset.near) { const p = S.near?.partners.find((x) => x.id === t.dataset.near); if (p) profileDrawer(p); return; }
  if (t.dataset.profile) { const o = j.offers.find((x) => x.id === t.dataset.profile); if (o) profileDrawer(o.partner); return; }
  if (t.dataset.star) { S.rating = Number(t.dataset.star); const txt = document.getElementById('rv')?.value; jobView(); if (txt) document.getElementById('rv').value = txt; return; }
  try {
    S.busy = true;
    if (t.dataset.accept) {
      const o = j.offers.find((x) => x.id === t.dataset.accept);
      if (!confirmBox(`Accept ${o.partner.company}'s offer of ${gbp(o.pricePence)}? We will share your phone number and addresses with them, and tell the other companies.`)) return;
      S.job = await api(`/api/jobs/${j.id}/offers/${o.id}/accept`, { method: 'POST', body: {} });
      toast(`Booked ${o.partner.company}. They will call you to confirm.`);
    }
    if (t.dataset.cancel) {
      if (!confirmBox('Cancel this request? Companies can no longer send offers.')) return;
      S.job = await api(`/api/jobs/${j.id}/cancel`, { method: 'POST', body: {} });
    }
    if (t.dataset.review !== undefined) {
      if (!S.rating) { toast('Choose 1 to 5 stars.'); return; }
      S.job = await api(`/api/jobs/${j.id}/review`, { method: 'POST', body: { rating: S.rating, comment: document.getElementById('rv')?.value || '' } });
      toast('Thank you for your review.');
    }
    jobView();
  } catch (err) { toast(err.message); } finally { S.busy = false; }
});
// A plain confirm keeps this simple and accessible on every phone.
const confirmBox = (msg) => window.confirm(msg);

(async () => {
  let me;
  try { const sh = await mountShell(id ? 'req' : 'req'); me = sh.me; sh.main.append(root); } catch { location.href = `/login?next=${encodeURIComponent(location.pathname)}`; return; }
  if (!id) { document.title = 'Moving & freight requests — Kargom.co.uk'; listView((await api('/api/jobs')).jobs); return; }
  try { S.job = await api(`/api/jobs/${id}`); } catch (e) { root.innerHTML = `<div class="card center"><h1>Request not found</h1><a class="btn" href="/app/requests">All requests</a></div>`; return; }
  S.tab = new URLSearchParams(location.search).get('tab') === 'offers' ? 'offers' : 'details';
  document.title = `Request #${S.job.ref} — Kargom.co.uk`;
  jobView();
  // New offers arrive while the customer waits: check every 30 seconds while the page is open.
  setInterval(async () => {
    if (document.hidden || S.busy || S.job.status !== 'open') return;
    try {
      const fresh = await api(`/api/jobs/${id}`);
      if (fresh.offers.length !== S.job.offers.length) { const txt = document.getElementById('rv')?.value; S.job = fresh; jobView(); if (txt) document.getElementById('rv').value = txt; toast('New offer received'); }
    } catch { /* next time */ }
  }, 30_000);
})();
