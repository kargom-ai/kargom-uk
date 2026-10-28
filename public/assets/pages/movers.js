import { api, esc, stars, logoHtml, estimateHtml } from '../market-ui.js';

/**
 * Homepage "Removals" search for visitors: companies near their postcode, with phone numbers
 * partly hidden. Calling or messaging a company leads to a free sign-up, then the quote form.
 */

const root = document.getElementById('root');
const qs = new URLSearchParams(location.search);
const from = (qs.get('from') || '').toUpperCase();
const to = (qs.get('to') || '').toUpperCase();
const size = qs.get('size') || '';
const SIZE = { studio: 'Studio flat', 1: '1 bedroom', 2: '2 bedrooms', 3: '3 bedrooms', 4: '4 bedrooms', 5: '5+ bedrooms' };
const next = `/app/quote?${new URLSearchParams({ type: 'removals', ...(from && { from }), ...(to && { to }), ...(size && { size }) })}`;
const signup = `/login?mode=register&next=${encodeURIComponent(next)}`;
const WA = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"></path></svg>';

function card(p) {
  const rating = p.rating ? `${stars(p.rating)}<span class="stars-n">${p.rating.toFixed(1)} · ${p.reviewCount} ${p.onKargom ? 'Kargom' : 'Google'} review${p.reviewCount === 1 ? '' : 's'}</span>` : '<span class="stars-n">No reviews yet</span>';
  const where = [p.basedIn ? `Based in ${p.basedIn}` : p.area, p.milesAway !== null && p.milesAway !== undefined ? `${p.milesAway} mile${p.milesAway === 1 ? '' : 's'} from you` : ''].filter(Boolean).join(' · ');
  return `<article class="offer ${p.onKargom ? 'best' : 'gplace'}">
    <div class="offer-top"><div class="co">${logoHtml(p)}<div class="co-t"><b>${esc(p.company)}</b><span>${rating}</span>${where ? `<span class="muted" style="font-size:13px">${esc(where)}</span>` : ''}</div></div>
      ${p.onKargom ? '<span class="badge booked">On Kargom</span>' : ''}</div>
    <div class="acts">
      ${p.whatsapp || p.onKargom ? `<a class="btn wa" href="${signup}">${WA}WhatsApp</a>` : ''}
      ${p.phone ? `<a class="btn ghost" href="${signup}" aria-label="Sign up free to see the full number">📞 ${esc(p.phone)}</a>` : ''}
      <a class="btn ghost" href="${signup}">Get a quote</a>
    </div>
  </article>`;
}

async function main() {
  document.getElementById('top').insertAdjacentHTML('beforeend', `<a class="toplink" href="/login?next=${encodeURIComponent(next)}">Sign in</a>`);
  document.title = `Removal companies near ${from || 'you'} — Kargom.co.uk`;
  root.className = 'wrap';
  if (!from) { location.href = '/'; return; }
  const head = `<div class="req-h"><div><h1>Removal companies near ${esc(from)}</h1>
      <span class="muted">${[to && `Moving to ${to}`, SIZE[size]].filter(Boolean).map(esc).join(' · ') || 'Compare local movers and get free quotes'}</span></div></div>
    <div class="cta-move"><div><b>Get free quotes from these companies</b><span>Create a free account and tell us about your move. Companies send you their prices and you choose. It takes about 2 minutes.</span></div>
      <a class="btn big" href="${signup}">Get free quotes</a></div>`;
  root.innerHTML = `${head}<div class="list" style="margin-top:16px"><p class="muted" style="margin:0">Finding companies near ${esc(from)}…</p></div>`;
  let r;
  try { r = await api(`/api/public/movers?${new URLSearchParams({ from, kind: 'removals', to, size })}`); } catch (e) {
    root.innerHTML = `${head}<div class="empty-box" style="margin-top:16px"><b>${esc(e.message)}</b><a class="btn" href="/">Back</a></div>`; return;
  }
  const all = [...r.partners, ...r.google];
  root.innerHTML = `${head}
    ${r.estimate ? `<div style="margin-top:16px">${estimateHtml(r.estimate, 'Get real quotes free and pick the best one.')}</div>` : ''}
    ${all.length ? `<div class="list" style="margin-top:16px">${all.map(card).join('')}</div>
      ${r.google.length ? '<p class="g-attr" style="margin-top:10px;justify-content:flex-end;display:flex">Listings from <b class="g-logo"><i>G</i><i>o</i><i>o</i><i>g</i><i>l</i><i>e</i></b></p>' : ''}
      <p class="muted" style="font-size:13px;margin-top:6px">Full phone numbers and WhatsApp are free for members. <a href="${signup}">Sign up free</a> or <a href="/login?next=${encodeURIComponent(next)}">sign in</a>.</p>`
    : `<div class="empty-box" style="margin-top:16px"><b>No companies listed near ${esc(from)} yet</b><span>Post your move and removal companies across the UK will send you prices.</span><a class="btn" href="${signup}">Get free quotes</a></div>`}`;
}
main();
