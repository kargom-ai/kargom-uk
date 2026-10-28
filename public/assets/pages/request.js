import { mountShell } from '../shell.js';
import { api, esc, gbp, toast, drawMap, routeChips, niceDate, ago, stars, ratingHtml, logoHtml, estimateHtml, profileDrawer, detailsHtml, fullAddr, STATUS } from '../market-ui.js';

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

const WA = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"></path></svg>';
const shareUrl = (j) => `${location.origin}${j.sharePath}`;
const shareText = (j, to) => {
  const first = (S.me?.name || '').split(' ')[0];
  const when = j.date ? ` on ${niceDate(j.date)}` : '';
  return `Hi${to ? ` ${to}` : ''}, I'm looking for a price for my ${j.title.toLowerCase()} from ${j.fromArea} to ${j.toArea}${when}. All the details${j.photos.length ? ' and photos' : ''} are in this PDF: ${shareUrl(j)}\nCould you send me your best price? Thanks${first ? `, ${first}` : ''}`;
};
const waLink = (p, j) => `https://wa.me/${p.intlPhone.replace(/\D/g, '')}?text=${encodeURIComponent(shareText(j, p.name))}`;

/* No offers yet: say so plainly, and list companies based near the start of the job. */
function noOffersHtml(j) {
  const who = j.kind === 'removals' ? 'removal companies' : 'hauliers';
  const near = S.near;
  const list = !near ? '<p class="muted" style="margin:0">Finding companies near you…</p>'
    : !near.partners.length ? `<p class="muted" style="margin:0">No ${who} have joined near ${esc(j.fromArea)} yet. Your request is still open to every ${j.kind === 'removals' ? 'removal company' : 'haulier'} on Kargom.</p>`
    : near.partners.map((p) => `<article class="offer">
        <div class="offer-top"><div class="co">${logoHtml(p)}<div class="co-t"><b>${esc(p.company)}</b><span>${ratingHtml(p)}</span>
          <span class="muted" style="font-size:13px">${p.basedIn ? `Based in ${esc(p.basedIn)}` : 'UK'}${p.milesAway !== null && p.milesAway !== undefined ? ` · ${p.milesAway} mile${p.milesAway === 1 ? '' : 's'} from you` : ''}${p.jobsWon ? ` · ${p.jobsWon} job${p.jobsWon > 1 ? 's' : ''} won` : ''}</span></div></div></div>
        ${p.areas ? `<span class="muted" style="font-size:14px">Covers: ${esc(p.areas)}</span>` : ''}
        <div class="acts"><a class="btn ghost" href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">📞 ${esc(p.phone)}</a><button type="button" class="btn ghost" data-near="${esc(p.id)}">Profile and reviews</button></div>
      </article>`).join('');
  const g = S.google;
  const gHtml = g && g.enabled && g.error ? `<p class="hint" style="margin:8px 0 0">Google listings could not load: ${esc(g.error)}</p>` : !g || !g.enabled || !g.places.length ? '' : `<div class="g-head"><h3 style="margin:0;font-size:18px">Other companies near you</h3><span class="g-attr">Listings from <b class="g-logo"><i>G</i><i>o</i><i>o</i><i>g</i><i>l</i><i>e</i></b></span></div>
    <p class="muted" style="margin:0;font-size:14px">These companies are not on Kargom yet, so they cannot send you an offer here. Call them, or send your request PDF on WhatsApp in one tap.</p>
    ${g.places.map((p) => `<article class="offer gplace">
      <div class="offer-top"><div class="co">${logoHtml({ company: p.name, logoUrl: p.hasLogo ? `/api/gplace/${encodeURIComponent(p.placeId)}/logo` : null })}<div class="co-t"><b>${esc(p.name)}</b>
        <span>${p.rating ? `${stars(p.rating)}<span class="stars-n">${p.rating.toFixed(1)} · ${p.reviews} Google review${p.reviews === 1 ? '' : 's'}</span>` : '<span class="stars-n">No Google reviews yet</span>'}</span>
        <span class="muted" style="font-size:13px">${esc(p.address)}${p.milesAway !== null ? ` · ${p.milesAway} mile${p.milesAway === 1 ? '' : 's'} from you` : ''}</span></div></div>
        <span class="badge cancelled">Not on Kargom yet</span></div>
      <div class="acts">${p.intlPhone ? `<a class="btn wa" href="${esc(waLink(p, j))}" target="_blank" rel="noopener" title="Send your request PDF on WhatsApp">${WA}WhatsApp</a>` : ''}
        ${p.phone ? `<a class="btn ghost" href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">📞 ${esc(p.phone)}</a>` : ''}
        ${p.website ? `<a class="btn ghost" href="${esc(p.website)}" target="_blank" rel="noopener nofollow">Website</a>` : ''}
        ${p.mapsUrl ? `<a class="btn ghost" href="${esc(p.mapsUrl)}" target="_blank" rel="noopener nofollow">View on Google Maps</a>` : ''}</div>
    </article>`).join('')}`;
  return `<div class="noff"><b>No offers yet</b><span>Your request has gone to ${who} on Kargom. Each offer appears here and in your email.</span></div>
    <h3 style="margin:8px 0 0;font-size:18px">${j.kind === 'removals' ? 'Removal companies' : 'Hauliers'} near ${esc(j.fromArea)}</h3>
    ${list}
    ${gHtml}`;
}
async function loadNear() {
  if (S.near || S.nearBusy) return;
  S.nearBusy = true;
  const [near, google] = await Promise.all([
    api(`/api/jobs/${S.job.id}/partners`).catch(() => ({ near: S.job.fromArea, partners: [] })),
    api(`/api/jobs/${S.job.id}/google`).catch(() => null),
  ]);
  S.near = near; S.google = google;
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
        ${estimateHtml(j.estimate)}
        ${detailsHtml(j)}
        <div class="addr"><div><b>${j.kind === 'removals' ? 'Moving from' : 'Collection'}</b>${esc(fullAddr(j.from))}</div><div><b>${j.kind === 'removals' ? 'Moving to' : 'Delivery'}</b>${esc(fullAddr(j.to))}</div></div>
        <div class="kv"><span class="muted">Your phone</span><b>${esc(j.contactPhone)}</b></div>
        <div class="sheet-box"><span class="sheet-ic">PDF</span><span class="sheet-t"><b>Your request as a PDF</b><span>One clear page with all the details${j.photos.length ? ' and your photos' : ''}. Send it to any company so they can price your ${j.kind === 'removals' ? 'move' : 'load'}.</span></span>
          <span class="acts"><a class="btn ghost sm" href="/api/jobs/${j.id}/pdf" target="_blank" rel="noopener">View</a><a class="btn ghost sm" href="/api/jobs/${j.id}/pdf?download=1">Download</a><button type="button" class="btn sm" data-share>Share</button></span></div>
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
    ${j.estimate ? `<div class="kv"><span class="muted">Estimated price</span><b>${gbp(j.estimate.lowPence).replace('.00', '')} – ${gbp(j.estimate.highPence).replace('.00', '')}</b></div>` : ''}
  </div></aside>`;
  drawMap(document.getElementById('map'), { from: j.fromPostcode, to: j.toPostcode, fc: j.fromCountry, tc: j.toCountry })
    .then((r) => { const el = document.getElementById('miles'); if (el) el.innerHTML = routeChips(r || (j.distanceMiles ? { miles: j.distanceMiles, source: 'estimate' } : null)); });
}

root.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-tab],[data-profile],[data-near],[data-invite],[data-share],[data-accept],[data-cancel],[data-star],[data-review]');
  if (!t || S.busy) return;
  const j = S.job;
  if (t.dataset.tab) { S.tab = t.dataset.tab; jobView(); if (S.tab === 'offers' && !S.job.offers.length) loadNear(); return; }
  if (t.dataset.share !== undefined) {
    const j = S.job, text = shareText(j, '');
    try {
      // Phones: share the PDF file itself (WhatsApp, email...). Elsewhere: share or copy the link.
      const blob = await fetch(`/api/jobs/${j.id}/pdf`, { credentials: 'same-origin' }).then((r) => r.blob());
      const file = new File([blob], `kargom-request-${j.ref}.pdf`, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
      if (navigator.share) { await navigator.share({ text, url: shareUrl(j) }); return; }
      await navigator.clipboard.writeText(text); toast('Message and PDF link copied. Paste it into WhatsApp or email.');
    } catch (err) { if (err?.name !== 'AbortError') { try { await navigator.clipboard.writeText(text); toast('Message and PDF link copied.'); } catch { toast(shareUrl(j)); } } }
    return;
  }
  if (t.dataset.invite) {
    const p = S.google?.places.find((x) => x.placeId === t.dataset.invite);
    if (!p) return;
    try { await api(`/api/jobs/${S.job.id}/invite`, { method: 'POST', body: { placeId: p.placeId, name: p.name, website: p.website, address: p.address } }); S.google.invited.push(p.placeId); jobView(); toast(`Thanks. We will invite ${p.name} to quote.`); } catch (err) { toast(err.message); }
    return;
  }
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
  try { const sh = await mountShell('req'); me = sh.me; S.me = me; sh.main.append(root); } catch { location.href = `/login?next=${encodeURIComponent(location.pathname)}`; return; }
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
