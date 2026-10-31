import { api, esc, ago, gbp } from '../market-ui.js';
import { ICON, CATS, catTile, priceRange, dayTxt } from '../match-ui.js';

/** One FreightMatch job as a transport company sees it before quoting. */
const root = document.getElementById('root');
const id = location.pathname.split('/').pop();
const FLOOR = { ground: 'Ground floor', 1: '1st floor', 2: '2nd floor', 3: '3rd floor', '4+': '4th floor or higher' };
const SIZE = { studio: 'Studio flat', 1: '1 bedroom', 2: '2 bedrooms', 3: '3 bedrooms', 4: '4 bedrooms', 5: '5+ bedrooms', small: 'Small office', medium: 'Medium office', large: 'Large office' };

function facts(j) {
  const d = j.details || {};
  const kv = [];
  if (j.kind === 'transport') {
    if (d.size) kv.push(['Size', SIZE[d.size] || d.size]);
    if (d.qty > 1) kv.push(['How many', String(d.qty)]);
    if (d.weightKg) kv.push(['Approx. weight', `${d.weightKg.toLocaleString('en-GB')} kg`]);
    if (d.vehicle) kv.push(['Vehicle', `${[d.vehicle.make, d.vehicle.model].filter(Boolean).join(' ') || 'Not given'}`], ['Runs and drives', d.vehicle.runs ? 'Yes' : 'No, needs loading help']);
    if (d.access) kv.push(['Collection', `${FLOOR[d.access.fromFloor] || ''}${d.access.lift ? ', with lift' : ''}`], ['Delivery', `${FLOOR[d.access.toFloor] || ''}${d.access.lift ? ', with lift' : ''}`]);
    if (d.access?.helpers) kv.push(['Help loading', 'Two people needed']);
  } else if (j.kind === 'removals') {
    kv.push(['Move', d.moveType === 'office' ? 'Office move' : d.moveType === 'items' ? 'A few items' : 'Home move']);
    if (d.size) kv.push(['Size', SIZE[d.size] || d.size]);
    if (d.items?.length) kv.push(['Items', d.items.join(', ')]);
  } else {
    if (d.goods) kv.push(['Goods', d.goods]);
    if (d.weightKg) kv.push(['Weight', `${Number(d.weightKg).toLocaleString('en-GB')} kg`]);
    if (d.pallets) kv.push(['Pallets', String(d.pallets)]);
  }
  kv.push(['Date', `${dayTxt(j.date)}${j.flex ? ` · ${j.flex}` : ''}`]);
  if (j.miles) kv.push(['Distance', `About ${j.miles} miles`]);
  return kv;
}

async function render() {
  let j;
  try { j = await api(`/api/match/jobs/${encodeURIComponent(id)}`); }
  catch (e) { root.innerHTML = `<div class="fm-job"><div class="fm-empty" style="grid-column:1/-1">${catTile('boxes', 64)}<b>This job is no longer on the board</b><span class="muted">${esc(e.message)}</span><a class="btn" href="/freightmatch">Browse other jobs</a></div></div>`; return; }
  document.title = `${j.title}: ${j.fromArea} to ${j.toArea} | Kargom FreightMatch`;
  let who = null;
  try { who = await api('/api/me'); } catch { /* signed out */ }
  const partner = Boolean(who?.partner);
  const quoteHref = `/partner/requests/${encodeURIComponent(j.id)}`;
  const cta = j.status !== 'open'
    ? '<p class="muted" style="margin:0">This job has been booked. Browse other jobs on the board.</p><a class="btn" href="/freightmatch">More jobs</a>'
    : partner ? `<a class="btn" href="${quoteHref}" style="align-self:stretch;min-height:52px;font-size:16px">Send your price</a>`
      : who ? '<p class="muted" style="margin:0">Quoting is for transport companies. Join with your company email to send prices.</p><a class="btn" href="/partner">Join as a transport company</a>'
        : `<a class="btn" href="${quoteHref}" style="align-self:stretch;min-height:52px;font-size:16px">Sign in or join free to quote</a><span class="muted" style="font-size:13px">Joining is free. You only see the customer's name, address and phone once they accept your price.</span>`;

  root.innerHTML = `<div class="fm-job">
    <div class="fm-job-main">
      <a class="fm-back" href="/freightmatch">‹ All jobs</a>
      <div class="fm-job-h">${catTile(j.cat, 60)}<div><h1>${esc(j.title)}</h1>
        <div class="fm-tags"><span>${esc(CATS[j.cat] || 'International freight')}</span><span>Job #${j.ref}</span><span>Posted ${esc(ago(j.createdAt))}</span></div></div></div>
      ${j.photos.length ? `<div class="fm-gal">${j.photos.map((p) => `<a href="${esc(p)}" target="_blank" rel="noopener"><img src="${esc(p)}" alt="Photo of the items" loading="lazy"></a>`).join('')}</div>` : ''}
      <div class="fm-route-big"><div><small>Collect from</small><b>${esc(j.fromArea)}</b></div>
        <div class="mid">${ICON.route}${j.miles ? `${j.miles} mi` : ''}</div>
        <div style="text-align:right"><small>Deliver to</small><b>${esc(j.toArea)}</b></div></div>
      <div class="fm-kv">${facts(j).map(([k, v]) => `<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div>
      ${j.notes ? `<div class="card"><b>Notes from the customer</b><p style="margin:8px 0 0;line-height:1.6">${esc(j.notes)}</p></div>` : ''}
    </div>
    <aside class="fm-act">
      <div class="card">
        ${j.estimate ? `<span class="muted" style="font-size:13px;font-weight:700">Typical price for this job</span><span class="big">${esc(priceRange(j.estimate))}</span>` : ''}
        <span style="font-size:14px">${j.offers ? `<b>${j.offers} quote${j.offers === 1 ? '' : 's'}</b> so far${j.lowestPence ? `, lowest ${esc(gbp(j.lowestPence))}` : ''}` : '<b>No quotes yet.</b> Be the first.'}</span>
        ${cta}
      </div>
      <div class="card"><ul>
        <li>${ICON.check}<span>Customers compare quotes and accept one.</span></li>
        <li>${ICON.check}<span>No fee to join or to quote.</span></li>
        <li>${ICON.check}<span>Contact details are shared once your price is accepted.</span></li>
      </ul></div>
    </aside>
  </div>`;
}
render();
