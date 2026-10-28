import { api, esc, wrapLabels, gbp, toast, resizeImage, drawMap, routeChips, niceDate, ago, stars, ratingHtml, logoHtml, detailsHtml, fullAddr, STATUS } from '../market-ui.js';

/**
 * Partner area for removal companies and road hauliers:
 * join / sign in, see new requests, send offers, see what they won, edit their public profile.
 */

const root = document.getElementById('root');
const path = location.pathname.replace(/\/+$/, '');
const reqId = (path.match(/^\/partner\/requests\/([\w-]+)/) || [])[1];
const S = { me: null, profile: null, stats: null, tab: new URLSearchParams(location.search).get('tab') || 'open', list: null, job: null, busy: false, auth: 'join', kind: 'removals', err: '' };
const html = (el, h) => { el.innerHTML = wrapLabels(h); };
const KIND = { removals: 'Removal company', freight: 'Road freight company' };

/* ---------------- sign up / sign in ---------------- */
function authView() {
  document.title = 'Partners: removal and freight companies — Kargom.co.uk';
  root.className = '';
  root.style.padding = '0';
  const join = S.auth === 'join';
  html(root, `<section class="p-hero"><div class="in">
    <div style="flex:1 1 380px">
      <h1>Win more moving and freight jobs</h1>
      <p>Customers on Kargom post their home moves, office moves, full loads and pallets. You see every request in your area and send your own price. No lead fees while we launch.</p>
      <ul><li>Free to join, no contract</li><li>See the job before you quote: size, floors, photos, distance</li><li>Customers call you straight from your profile</li><li>Reviews only from customers who booked you</li></ul>
    </div>
    <div class="authcard">
      <div class="tabs" role="tablist"><button type="button" role="tab" data-auth="join" aria-selected="${join}">Join as a partner</button><button type="button" role="tab" data-auth="login" aria-selected="${!join}">Partner sign in</button></div>
      <form id="af" novalidate>
        ${join ? `<div class="tiles sm">${Object.entries(KIND).map(([k, l]) => `<button type="button" class="tile" data-kind="${k}" aria-pressed="${S.kind === k}"><b>${l}</b><span>${k === 'removals' ? 'Home and office moves' : 'FTL, LTL and pallets'}</span></button>`).join('')}</div>
        <label class="fld">Company name<input class="inp" name="company" autocomplete="organization" required></label>
        <label class="fld">Your name<input class="inp" name="name" autocomplete="name" required></label>
        <div class="grid2"><label class="fld">Phone customers can call<input class="inp" name="phone" type="tel" autocomplete="tel" required></label>
        <label class="fld">Where you are based<input class="inp up" name="basePostcode" placeholder="Postcode, e.g. M1 1AE" autocomplete="postal-code"></label></div>` : ''}
        <label class="fld">Email<input class="inp" name="email" type="email" autocomplete="email" required></label>
        <label class="fld">Password<input class="inp" name="password" type="password" autocomplete="${join ? 'new-password' : 'current-password'}" required minlength="10"></label>
        ${join ? '<span class="hint">At least 10 characters.</span>' : ''}
        ${S.err ? `<div class="err" role="alert">${esc(S.err)}</div>` : ''}
        <button class="btn big" type="submit" style="align-self:stretch">${S.busy ? 'Please wait…' : join ? 'Create partner account' : 'Sign in'}</button>
        <span class="hint" style="text-align:center">Sending a parcel or moving home? <a href="/login">Customer sign in</a></span>
      </form>
    </div></div></section>`);
}

/* ---------------- dashboard ---------------- */
function head() {
  const p = S.profile;
  return `<div class="req-h"><div class="co">${logoHtml(p)}<div class="co-t"><h1>${esc(p.company)}</h1><span>${ratingHtml(p)} <span class="muted" style="font-size:13px">· ${KIND[p.kind]}</span></span></div></div>
    <a class="btn ghost sm m-hide-s" href="/partner?tab=profile">Edit profile</a></div>
    <div class="stats"><div class="stat"><span>New requests</span><b>${S.stats.open}</b></div><div class="stat"><span>Offers waiting</span><b>${S.stats.pending}</b></div>
    <div class="stat"><span>Jobs won</span><b>${S.stats.won}</b></div><div class="stat"><span>Value won</span><b>${gbp(S.stats.wonPence)}</b></div></div>`;
}
const TABS = [['open', 'New requests'], ['mine', 'My offers'], ['won', 'Won'], ['profile', 'Profile']];

function dashView() {
  root.className = 'wrap'; root.style.padding = '';
  const tabs = `<div class="tabs" role="tablist">${TABS.map(([k, l]) => `<a role="tab" href="/partner?tab=${k}" data-ptab="${k}" aria-selected="${S.tab === k}">${l}${k === 'open' && S.stats.open ? ` <span class="n">${S.stats.open}</span>` : ''}</a>`).join('')}</div>`;
  let body = '';
  if (S.tab === 'profile') body = profileForm();
  else if (!S.list) body = '<div class="card center"><span class="spin"></span></div>';
  else if (!S.list.length) body = `<div class="empty-box"><b style="font-size:18px">${S.tab === 'open' ? 'No new requests right now' : S.tab === 'mine' ? 'You have not sent any offers yet' : 'No jobs won yet'}</b><span>${S.tab === 'open' ? 'We email you as soon as a customer posts one. Make sure your profile is complete so customers trust your offers.' : 'Open a request and send your price.'}</span></div>`;
  else body = `<div class="list">${S.list.map((j) => `<a class="li" href="/partner/requests/${j.id}">
      <div class="li-main"><b>#${j.ref} · ${esc(j.title)}</b><span>${esc(j.fromArea)} → ${esc(j.toArea)}${j.distanceMiles ? ` · ≈ ${j.distanceMiles} miles` : ''}</span><span>${esc(niceDate(j.date))} · posted ${esc(ago(j.createdAt))} · ${j.offers} offer${j.offers === 1 ? '' : 's'}</span></div>
      <div class="li-side">${j.myStatus ? `<b>${gbp(j.myPricePence)}</b><span class="badge ${j.myStatus}">${j.myStatus === 'accepted' ? 'Won' : j.myStatus === 'declined' ? 'Not chosen' : j.myStatus === 'pending' ? 'Offer sent' : j.myStatus}</span>` : '<span class="btn sm">Send a price</span>'}</div></a>`).join('')}</div>`;
  html(root, `${head()}${tabs}${body}`);
}

function profileForm() {
  const p = S.profile;
  return `<div class="cols">
    <form id="pf" class="steps card" style="display:flex;flex-direction:column;gap:14px" novalidate>
      <h2 style="font-size:20px">Your public profile</h2>
      <div style="display:flex;align-items:center;gap:14px">${logoHtml(p, '80px')}
        <div style="display:flex;flex-direction:column;gap:6px"><label class="btn ghost sm" style="cursor:pointer">Upload logo<input type="file" accept="image/png,image/jpeg,image/webp" data-logo hidden></label>
        ${p.logoUrl ? '<button type="button" class="link" data-rmlogo style="padding:0;text-align:left">Remove logo</button>' : '<span class="hint">Square PNG or JPG works best.</span>'}</div></div>
      <div class="grid2">
        <label class="fld">Company name<input class="inp" name="company" value="${esc(p.company)}"></label>
        <label class="fld">Phone customers call<input class="inp" name="phone" type="tel" value="${esc(p.phone)}"></label>
        <label class="fld">Email for enquiries<input class="inp" name="email" type="email" value="${esc(p.email)}"></label>
        <label class="fld">Website <em>(optional)</em><input class="inp" name="website" value="${esc(p.website || '')}" placeholder="www.example.co.uk"></label>
        <label class="fld">Base postcode <em>(customers nearby see you first)</em><input class="inp up" name="basePostcode" value="${esc(p.basePostcode || '')}" placeholder="e.g. M1 1AE"></label>
      </div>
      <label class="fld">Areas you cover<input class="inp" name="areas" value="${esc(p.areas || '')}" placeholder="Greater Manchester, Cheshire, nationwide on request"></label>
      <label class="fld">Vehicles<input class="inp" name="fleet" value="${esc(p.fleet || '')}" placeholder="${p.kind === 'removals' ? '3 Luton vans, 1 7.5t lorry' : '2 x 18t curtainsiders with tail lift, 1 artic'}"></label>
      <label class="fld">About your company<textarea class="inp" name="about" maxlength="1500" placeholder="Years in business, insurance cover, what makes you different">${esc(p.about || '')}</textarea></label>
      <button class="btn big" type="submit">Save profile</button>
    </form>
    <aside class="summary"><div class="card" style="display:flex;flex-direction:column;gap:12px"><b>How customers see you</b>
      <div class="offer"><div class="offer-top"><div class="co">${logoHtml(p)}<div class="co-t"><b>${esc(p.company)}</b><span>${ratingHtml(p)}</span></div></div><div class="price"><b>£—</b><span>your price</span></div></div>
      <div class="acts"><span class="btn ghost sm">📞 ${esc(p.phone)}</span></div></div>
      <b>Reviews</b>${p.reviews.length ? p.reviews.map((r) => `<div class="review"><span>${stars(r.rating)} <b>${esc(r.author)}</b></span>${r.comment ? `<span>${esc(r.comment)}</span>` : ''}</div>`).join('') : '<span class="muted">Reviews appear after customers you win rate you.</span>'}
    </div></aside></div>`;
}

/* ---------------- one request ---------------- */
function jobView() {
  const j = S.job, mine = j.myOffer, won = mine?.status === 'accepted';
  root.className = 'wrap cols'; root.style.padding = '';
  html(root, `<div class="steps">
    <a href="/partner?tab=${won ? 'won' : mine ? 'mine' : 'open'}" class="muted" style="text-decoration:none">← Back</a>
    <div class="req-h"><div><h1>#${j.ref} · ${esc(j.title)}</h1><span class="muted">${esc(j.fromArea)} → ${esc(j.toArea)} · ${esc(niceDate(j.date))} · posted ${esc(ago(j.createdAt))}</span></div>
      <span class="badge ${won ? 'accepted' : j.status}">${won ? 'You won this job' : esc(STATUS[j.status] || j.status)}</span></div>
    ${won ? `<section class="card" style="display:flex;flex-direction:column;gap:12px;border-color:#16A34A"><h2 style="font-size:20px">Customer details</h2>
      <div class="kvs"><div><span>Name</span><b>${esc(j.customer.name)}</b></div><div><span>Phone</span><b><a href="tel:${esc(j.customer.phone.replace(/[^\d+]/g, ''))}">${esc(j.customer.phone)}</a></b></div><div><span>Email</span><b><a href="mailto:${esc(j.customer.email)}">${esc(j.customer.email)}</a></b></div></div>
      <div class="addr"><div><b>${j.kind === 'removals' ? 'Moving from' : 'Collection'}</b>${esc(fullAddr(j.from))}</div><div><b>${j.kind === 'removals' ? 'Moving to' : 'Delivery'}</b>${esc(fullAddr(j.to))}</div></div>
      <a class="btn green" href="tel:${esc(j.customer.phone.replace(/[^\d+]/g, ''))}" style="align-self:flex-start">📞 Call ${esc(j.customer.name.split(' ')[0])} to confirm</a></section>` : ''}
    <section class="card" style="display:flex;flex-direction:column;gap:14px"><h2 style="font-size:20px">The job</h2>${detailsHtml(j)}
      ${j.photos.length ? `<div class="photos">${j.photos.map((u, i) => `<a class="photo" href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="Photo ${i + 1}" loading="lazy"></a>`).join('')}</div>` : ''}
      ${won ? '' : '<span class="hint">The exact address and the customer\'s contact details are shared with you if they accept your offer.</span>'}</section>
    ${j.status === 'open' || mine ? `<form id="of" class="card" style="display:flex;flex-direction:column;gap:12px" novalidate>
      <h2 style="font-size:20px">${mine ? (won ? 'Your accepted offer' : 'Your offer') : 'Send your price'}</h2>
      <span class="muted">${j.offers} compan${j.offers === 1 ? 'y has' : 'ies have'} sent an offer so far.</span>
      <div class="grid2">
        <label class="fld">Total price (£, inc VAT) <i>*</i><input class="inp" name="price" inputmode="decimal" value="${mine ? (mine.pricePence / 100).toFixed(2) : ''}" ${won ? 'disabled' : ''} placeholder="e.g. 650"></label>
        <label class="fld">${j.kind === 'removals' ? 'Crew and vehicle' : 'Vehicle'} <em>(optional)</em><input class="inp" name="vehicle" value="${esc(mine?.vehicle || '')}" ${won ? 'disabled' : ''} placeholder="${j.kind === 'removals' ? '3 movers, Luton van' : '18t curtainsider with tail lift'}"></label>
        <label class="fld">Date you can do it <em>(optional)</em><input class="inp" type="date" name="availableDate" value="${esc(mine?.availableDate || j.date || '')}" ${won ? 'disabled' : ''}></label>
        <label class="fld">Offer valid until <em>(optional)</em><input class="inp" type="date" name="validUntil" value="${esc(mine?.validUntil || '')}" ${won ? 'disabled' : ''}></label>
      </div>
      <label class="fld">Message to the customer <em>(optional)</em><textarea class="inp" name="message" maxlength="1000" ${won ? 'disabled' : ''} placeholder="What is included: insurance, packing materials, waiting time…">${esc(mine?.message || '')}</textarea></label>
      ${mine && !won ? `<span class="badge ${mine.status}" style="align-self:flex-start">${mine.status === 'pending' ? 'Offer sent. You can change it until the customer chooses.' : mine.status === 'declined' ? 'The customer chose another company' : mine.status}</span>` : ''}
      ${j.status === 'open' ? `<div class="acts"><button class="btn" type="submit">${mine && mine.status === 'pending' ? 'Update offer' : 'Send offer'}</button>${mine?.status === 'pending' ? '<button type="button" class="btn danger" data-withdraw>Withdraw</button>' : ''}</div>` : ''}
    </form>` : ''}
  </div>
  <aside class="summary"><div class="card sum-card" style="flex-direction:column;align-items:stretch"><h2>Route</h2>
    <div class="route"><span class="pin a">A</span><span>${esc(j.fromArea)}</span></div><div class="route-line"></div><div class="route"><span class="pin b">B</span><span>${esc(j.toArea)}</span></div>
    <div class="mapbox" id="map"></div><div id="miles"></div></div></aside>`);
  drawMap(document.getElementById('map'), { from: j.fromPostcode, to: j.toPostcode, fc: j.fromCountry, tc: j.toCountry })
    .then((r) => { const el = document.getElementById('miles'); if (el) el.innerHTML = routeChips(r || (j.distanceMiles ? { miles: j.distanceMiles, source: 'estimate' } : null)); });
}

/* ---------------- events ---------------- */
root.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-auth],[data-kind],[data-withdraw],[data-rmlogo]');
  if (!t) return;
  if (t.dataset.auth) { S.auth = t.dataset.auth; S.err = ''; authView(); return; }
  if (t.dataset.kind) { S.kind = t.dataset.kind; for (const b of root.querySelectorAll('[data-kind]')) b.setAttribute('aria-pressed', String(b.dataset.kind === S.kind)); return; }
  try {
    if (t.dataset.withdraw !== undefined) { S.job = await api(`/api/partner/requests/${S.job.id}/withdraw`, { method: 'POST', body: {} }); toast('Offer withdrawn'); jobView(); }
    if (t.dataset.rmlogo !== undefined) { await api('/api/partner/logo', { method: 'PUT', body: { logo: null } }); await loadMe(); dashView(); }
  } catch (err) { toast(err.message); }
});

root.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, v = Object.fromEntries(new FormData(f));
  if (S.busy) return;
  S.busy = true;
  try {
    if (f.id === 'af') {
      S.err = '';
      if (S.auth === 'join') await api('/api/partner/register', { method: 'POST', body: { ...v, kind: S.kind } });
      else {
        const r = await api('/api/auth/login', { method: 'POST', body: { email: v.email, password: v.password } });
        if (!r.partner) { location.href = r.role === 'admin' ? '/admin' : '/app'; return; }
      }
      location.href = '/partner';
      return;
    }
    if (f.id === 'pf') { S.profile = await api('/api/partner/profile', { method: 'PUT', body: v }); toast('Profile saved'); dashView(); }
    if (f.id === 'of') { S.job = await api(`/api/partner/requests/${S.job.id}/offer`, { method: 'POST', body: v }); toast('Offer sent. We have told the customer.'); jobView(); }
  } catch (err) {
    if (f.id === 'af') { S.err = err.message; S.busy = false; authView(); return; }
    toast(err.message);
  } finally { S.busy = false; }
});

root.addEventListener('change', async (e) => {
  if (e.target.dataset.logo === undefined) return;
  const file = e.target.files[0];
  if (!file) return;
  try {
    let data = await resizeImage(file, 320, 'image/png');
    if (data.length > 190_000) data = await resizeImage(file, 320, 'image/jpeg', 0.85);
    await api('/api/partner/logo', { method: 'PUT', body: { logo: data } });
    await loadMe(); dashView(); toast('Logo updated');
  } catch (err) { toast(err.message); }
});

async function loadMe() {
  const r = await api('/api/partner/me');
  S.profile = r.profile; S.stats = r.stats;
}

(async () => {
  try { S.me = await api('/api/me'); } catch { S.me = null; }
  const top = document.getElementById('top');
  if (!S.me) { top.insertAdjacentHTML('beforeend', '<a class="toplink" href="/">Kargom for customers</a>'); authView(); return; }
  if (!S.me.partner) {
    top.insertAdjacentHTML('beforeend', '<a class="toplink" href="/app">My account</a>');
    root.innerHTML = `<div class="card center"><h1>This is a customer account</h1><p class="muted">Partner companies need their own account. Sign out, then join as a partner with your company email.</p><button type="button" class="btn" id="so">Sign out</button></div>`;
    document.getElementById('so').onclick = async () => { try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* */ } location.reload(); };
    return;
  }
  top.insertAdjacentHTML('beforeend', `<span class="who">${esc(S.me.partner.company)} · Partner</span><button type="button" class="toplink" id="so" style="background:none;border:0;cursor:pointer;font:inherit;font-weight:600">Sign out</button>`);
  document.getElementById('so').onclick = async () => { try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* */ } location.href = '/partner'; };
  try { await loadMe(); } catch (err) { root.innerHTML = `<div class="card center"><h1>Account paused</h1><p class="muted">${esc(err.message)}</p></div>`; return; }
  if (reqId) {
    try { S.job = await api(`/api/partner/requests/${reqId}`); } catch (err) { root.innerHTML = `<div class="card center"><h1>Not available</h1><p class="muted">${esc(err.message)}</p><a class="btn" href="/partner">All requests</a></div>`; return; }
    document.title = `Request #${S.job.ref} — Kargom Partners`;
    jobView(); return;
  }
  document.title = 'Partner dashboard — Kargom';
  dashView();
  if (S.tab !== 'profile') { S.list = (await api(`/api/partner/requests?filter=${S.tab}`)).requests; dashView(); }
})();
