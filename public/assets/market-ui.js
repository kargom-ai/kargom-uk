/* Shared bits for the moving & freight pages: formatting, images, the A→B map and company profiles. */
import { api } from './dc.js';

export { api };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const gbp = (p) => `£${(p / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
export const niceDate = (iso) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24); return d === 1 ? 'yesterday' : `${d} days ago`;
};
export const stars = (r) => { const n = Math.round(r || 0); return `<span class="stars" aria-label="${r ? `${r} out of 5` : 'No reviews yet'}">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`; };
export const UK_PC = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
export const COUNTRIES = [['GB', 'United Kingdom'], ['IE', 'Ireland'], ['FR', 'France'], ['DE', 'Germany'], ['NL', 'Netherlands'], ['BE', 'Belgium'], ['ES', 'Spain'], ['IT', 'Italy'],
  ['PL', 'Poland'], ['PT', 'Portugal'], ['AT', 'Austria'], ['DK', 'Denmark'], ['SE', 'Sweden'], ['CZ', 'Czechia']];
export const cname = (c) => (COUNTRIES.find((x) => x[0] === c) || [c, c])[1];

/** Keep "Label *" or "Label (optional)" on one line above its input (labels are flex columns). */
export const wrapLabels = (html) => html.replace(/(<label class="fld[^"]*"[^>]*>)([^<]+(?:<(?:i|em)>[^<]*<\/(?:i|em)>)?)/g, '$1<span>$2</span>');

export function toast(text) {
  const t = document.createElement('div');
  t.className = 'kg-toast'; t.setAttribute('role', 'status'); t.textContent = text;
  document.body.append(t); setTimeout(() => t.remove(), 4500);
}

/** Shrink a photo in the browser before upload (keeps requests small). */
export function resizeImage(file, max = 1280, type = 'image/jpeg', quality = 0.72) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) { reject(new Error('Choose an image file')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const ctx = c.getContext('2d');
      if (type === 'image/jpeg') { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL(type, quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}

/* ---------- A → B map ---------- */
let cfgP = null;
export const marketConfig = () => (cfgP ||= api('/api/market/config').catch(() => ({})));
let leafP = null;
function leaflet() {
  if (!leafP) {
    leafP = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
      document.head.append(css);
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      const fail = () => { leafP = null; reject(new Error('map')); };
      const timer = setTimeout(fail, 8000);
      s.onload = () => { clearTimeout(timer); resolve(window.L); }; s.onerror = () => { clearTimeout(timer); fail(); };
      document.head.append(s);
    });
  }
  return leafP;
}
const routes = new Map();
export function getRoute(from, to, fc = 'GB', tc = 'GB') {
  const k = `${from}|${to}|${fc}|${tc}`.toUpperCase();
  if (!routes.has(k)) routes.set(k, api(`/api/route?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&fc=${fc}&tc=${tc}`).catch(() => null));
  return routes.get(k);
}

/** Fill `el` with a map from A to B. Returns the route info (miles, minutes) or null. */
export async function drawMap(el, { from, to, fc = 'GB', tc = 'GB' }) {
  if (!el) return null;
  const key = `${from}|${to}|${fc}|${tc}`;
  if (el.dataset.key === key && el.dataset.done) return getRoute(from, to, fc, tc);
  el.dataset.key = key; el.dataset.done = '';
  el.innerHTML = '<div class="empty">Loading the map…</div>';
  const [cfg, route] = await Promise.all([marketConfig(), getRoute(from, to, fc, tc)]);
  if (el.dataset.key !== key) return route;
  if (cfg.mapsEmbedKey) {
    const q = new URLSearchParams({ key: cfg.mapsEmbedKey, origin: `${from}, ${cname(fc)}`, destination: `${to}, ${cname(tc)}`, mode: 'driving' });
    el.innerHTML = `<iframe title="Route from A to B" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps/embed/v1/directions?${q}"></iframe>`;
  } else if (route?.from && route?.to) {
    try {
      const L = await leaflet();
      if (el.dataset.key !== key) return route;
      el.innerHTML = '<div class="leaf"></div>';
      const map = L.map(el.firstChild, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
      const pin = (t, c) => L.divIcon({ className: '', html: `<div class="pinicon" style="background:${c}">${t}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
      const a = [route.from.lat, route.from.lng], b = [route.to.lat, route.to.lng];
      L.marker(a, { icon: pin('A', '#2463DB') }).addTo(map);
      L.marker(b, { icon: pin('B', '#16A34A') }).addTo(map);
      L.polyline([a, b], { color: '#2463DB', weight: 4, dashArray: '8 8' }).addTo(map);
      map.fitBounds([a, b], { padding: [36, 36] });
    } catch { el.innerHTML = '<div class="empty">The map could not load. The distance is below.</div>'; }
  } else {
    el.innerHTML = `<div class="empty">${esc(from)} → ${esc(to)}<br>The map appears for UK postcodes.</div>`;
  }
  el.dataset.done = '1';
  return route;
}

export function routeChips(r) {
  if (!r) return '';
  const h = r.minutes ? (r.minutes >= 60 ? `${Math.floor(r.minutes / 60)} h ${r.minutes % 60} min` : `${r.minutes} min`) : '';
  return `<div class="miles"><span>${r.source === 'google' ? '' : '≈ '}${r.miles.toLocaleString('en-GB')} miles</span>${h ? `<span>${r.source === 'google' ? '' : '≈ '}${h} drive</span>` : ''}</div>`;
}

/* ---------- company profile ---------- */
export function logoHtml(p, size = '') {
  const ini = (p.company || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return `<span class="co-logo" ${size ? `style="width:${size};height:${size}"` : ''}>${p.logoUrl ? `<img src="${esc(p.logoUrl)}" alt="${esc(p.company)} logo">` : esc(ini)}</span>`;
}
export function ratingHtml(p) {
  return p.reviewCount ? `${stars(p.rating)}<span class="stars-n">${p.rating.toFixed(1)} · ${p.reviewCount} review${p.reviewCount > 1 ? 's' : ''}</span>` : '<span class="stars-n">New on Kargom · no reviews yet</span>';
}
export function profileDrawer(p) {
  const bg = document.createElement('div');
  bg.className = 'drawer-bg';
  const since = new Date(p.memberSince).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  bg.innerHTML = `<div class="drawer" role="dialog" aria-modal="true" aria-label="${esc(p.company)}">
    <button type="button" class="x" aria-label="Close">×</button>
    <div class="co">${logoHtml(p, '72px')}<div class="co-t"><b style="font-size:22px;font-family:Outfit,sans-serif">${esc(p.company)}</b><span>${ratingHtml(p)}</span><span class="muted" style="font-size:13px">${p.kind === 'removals' ? 'Removal company' : 'Road freight company'} · on Kargom since ${esc(since)}</span></div></div>
    <div class="acts"><a class="btn" href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">📞 ${esc(p.phone)}</a><a class="btn ghost" href="mailto:${esc(p.email)}">Email</a>${p.website ? `<a class="btn ghost" href="${esc(p.website)}" target="_blank" rel="noopener nofollow">Website</a>` : ''}</div>
    <div class="kvs"><div><span>Jobs won on Kargom</span><b>${p.jobsWon}</b></div><div><span>Average rating</span><b>${p.reviewCount ? `${p.rating.toFixed(1)} / 5` : '—'}</b></div></div>
    ${p.about ? `<div><b>About</b><p style="margin:6px 0 0;line-height:1.55;color:#3E4A5C">${esc(p.about)}</p></div>` : ''}
    ${p.areas ? `<div><b>Areas covered</b><p style="margin:6px 0 0;color:#3E4A5C">${esc(p.areas)}</p></div>` : ''}
    ${p.fleet ? `<div><b>Vehicles</b><p style="margin:6px 0 0;color:#3E4A5C">${esc(p.fleet)}</p></div>` : ''}
    <div><b>Customer reviews</b>${p.reviews.length ? p.reviews.map((r) => `<div class="review"><span>${stars(r.rating)} <b>${esc(r.author)}</b> <span class="muted">· ${esc(new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))}</span></span>${r.comment ? `<span>${esc(r.comment)}</span>` : ''}</div>`).join('') : '<p class="muted" style="margin:6px 0 0">No reviews yet. Reviews come only from customers who booked this company through Kargom.</p>'}</div>
  </div>`;
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('.x')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  document.body.append(bg);
}

/** Human labels for what the customer filled in. */
export const L = {
  moveType: { home: 'Home move', office: 'Office move', items: 'A few items' },
  size: { studio: 'Studio flat', 1: '1 bedroom', 2: '2 bedrooms', 3: '3 bedrooms', 4: '4 bedrooms', 5: '5+ bedrooms', small: 'Small office (up to 10 desks)', medium: 'Medium office (10 to 30 desks)', large: 'Large office (30+ desks)' },
  floor: { ground: 'Ground floor', 1: '1st floor', 2: '2nd floor', 3: '3rd floor', '4+': '4th floor or higher' },
  parking: { easy: 'Easy parking outside', permit: 'Permit or paid parking', hard: 'Hard to park nearby' },
  dateFlex: { exact: 'This date only', week: 'Within a few days', flexible: 'Flexible' },
  load: { ftl: 'Full truck load (FTL)', ltl: 'Part load / pallets (LTL)' },
  vehicle: { van: 'Large van (up to 1.2 t)', '7.5t': '7.5 tonne lorry', '18t': '18 tonne rigid', '26t': '26 tonne rigid', artic: 'Articulated lorry (13.6 m)' },
  palletType: { uk: 'UK standard (120 × 100 cm)', euro: 'Euro (120 × 80 cm)', half: 'Half pallet', quarter: 'Quarter pallet', other: 'Other / mixed' },
  collectWindow: { any: 'Any time', am: 'Morning', pm: 'Afternoon' },
};

/** The details block used on both the customer's and the partner's request page. */
export function detailsHtml(job) {
  const d = job.details;
  const yes = (b, t) => (b ? `<span>${t}</span>` : '');
  if (job.kind === 'removals') {
    const place = (p, title) => `<div><span>${title}</span><b>${esc(L.floor[p.floor] || '')}${p.lift ? ', with lift' : ''}</b><span>${esc(L.parking[p.parking] || '')}</span></div>`;
    return `<div class="kvs">
      <div><span>Move</span><b>${esc(L.moveType[d.moveType])}</b>${d.size ? `<span>${esc(L.size[d.size])}</span>` : ''}</div>
      <div><span>Date</span><b>${esc(niceDate(job.date))}</b><span>${esc(L.dateFlex[d.dateFlex])}</span></div>
      ${place(d.fromPlace, 'Moving from')}${place(d.toPlace, 'Moving to')}
      ${job.distanceMiles ? `<div><span>Distance</span><b>≈ ${job.distanceMiles} miles</b></div>` : ''}
    </div>
    ${d.items?.length ? `<div><span class="lbl">Items</span><div class="tags" style="margin-top:6px">${d.items.map((i) => `<span>${esc(i)}</span>`).join('')}</div></div>` : ''}
    ${d.packing || d.dismantling || d.storage ? `<div><span class="lbl">Extra services</span><div class="tags" style="margin-top:6px">${yes(d.packing, 'Packing')}${yes(d.dismantling, 'Dismantle and reassemble furniture')}${yes(d.storage, 'Storage')}</div></div>` : ''}
    ${d.notes ? `<div><span class="lbl">Notes</span><p style="margin:6px 0 0;line-height:1.55">${esc(d.notes)}</p></div>` : ''}`;
  }
  return `<div class="kvs">
    <div><span>Load</span><b>${esc(L.load[d.load])}</b><span>${d.load === 'ftl' ? esc(L.vehicle[d.vehicle]) : `${d.pallets} × ${esc(L.palletType[d.palletType])}`}</span></div>
    <div><span>Goods</span><b>${esc(d.goods)}</b><span>${d.weightKg.toLocaleString('en-GB')} kg in total</span></div>
    <div><span>Collection</span><b>${esc(niceDate(job.date))}</b><span>${esc(L.collectWindow[d.collectWindow])}</span></div>
    <div><span>Deliver by</span><b>${d.deliverBy ? esc(niceDate(d.deliverBy)) : 'Flexible'}</b></div>
    ${job.distanceMiles ? `<div><span>Distance</span><b>≈ ${job.distanceMiles} miles</b></div>` : ''}
  </div>
  ${d.stackable || d.adr || d.tempControlled || d.tailLiftCollection || d.tailLiftDelivery ? `<div class="tags">${yes(d.stackable, 'Stackable')}${yes(d.adr, 'Hazardous (ADR)')}${yes(d.tempControlled, 'Temperature controlled')}${yes(d.tailLiftCollection, 'Tail lift at collection')}${yes(d.tailLiftDelivery, 'Tail lift at delivery')}</div>` : ''}
  ${d.notes ? `<div><span class="lbl">Notes</span><p style="margin:6px 0 0;line-height:1.55">${esc(d.notes)}</p></div>` : ''}`;
}
export const fullAddr = (a) => [a.line1, a.line2, a.city, a.postcode, a.country !== 'GB' ? cname(a.country) : ''].filter(Boolean).join(', ');
export const STATUS = { open: 'Waiting for offers', booked: 'Booked', completed: 'Completed', cancelled: 'Cancelled' };
