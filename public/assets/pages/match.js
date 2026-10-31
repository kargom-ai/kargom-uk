import { api, esc, ago } from '../market-ui.js';
import { ICON, CAT_SHORT, catTile, priceRange, dayTxt } from '../match-ui.js';

/**
 * Kargom FreightMatch board: transport companies browse open jobs like a shop.
 * Every filter lives in the address bar, so a search can be bookmarked or shared.
 */
const root = document.getElementById('root');
const qs = new URLSearchParams(location.search);
const S = {
  q: qs.get('q') || '', from: qs.get('from') || '', to: qs.get('to') || '', radius: qs.get('radius') || '30',
  cat: (qs.get('cat') || '').split(',').filter(Boolean), when: qs.get('when') || 'any', min: qs.get('min') || '', max: qs.get('max') || '',
  sort: qs.get('sort') || 'newest', page: Number(qs.get('page')) || 1, data: null, busy: true, err: '', side: false,
};
const CAT_ORDER = ['furniture', 'home', 'office', 'boxes', 'pallets', 'cars', 'motorbikes', 'vehicles', 'boats', 'pianos', 'machinery', 'international', 'other'];

function params() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ q: S.q, from: S.from, to: S.to, cat: S.cat.join(','), when: S.when === 'any' ? '' : S.when, min: S.min, max: S.max, sort: S.sort === 'newest' ? '' : S.sort, page: S.page > 1 ? S.page : '' })) if (v) p.set(k, String(v));
  if ((S.from || S.to) && S.radius !== '30') p.set('radius', S.radius);
  return p;
}

let seq = 0;
async function load() {
  const my = ++seq;
  S.busy = true; paintResults();
  const p = params();
  history.replaceState(null, '', `/freightmatch${p.toString() ? `?${p}` : ''}`);
  try { const d = await api(`/api/match/board?${p}`); if (my !== seq) return; S.data = d; S.err = ''; }
  catch (e) { if (my !== seq) return; S.err = e.message; }
  S.busy = false; paintCats(); paintResults();
}

function shell() {
  root.innerHTML = `
  <section class="fm-hero"><div class="fm-hero-in">
    <div><h1>Delivery jobs, posted by real customers</h1>
      <p>Furniture, cars, motorbikes, pallets, pianos and home moves across the UK. Find work on your routes and send your price. Free to browse.</p></div>
    <form class="fm-search" id="sf">
      <label class="q">${ICON.search}<input name="q" value="${esc(S.q)}" placeholder="Search jobs, e.g. sofa, piano, Transit" aria-label="Search jobs"></label>
      <label>${ICON.pin}<input name="from" value="${esc(S.from)}" placeholder="Collect near (postcode)" aria-label="Collect near"></label>
      <label>${ICON.flag}<input name="to" value="${esc(S.to)}" placeholder="Deliver near" aria-label="Deliver near"></label>
      <label><select name="radius" aria-label="Within">${[10, 20, 30, 50, 100, 200].map((r) => `<option value="${r}" ${String(r) === S.radius ? 'selected' : ''}>${r} miles</option>`).join('')}</select></label>
      <button type="submit">${ICON.search}Search</button>
    </form>
    <div class="fm-hero-acts"><a class="btn light" href="/freightmatch/post">Post a job, it is free</a><a class="btn line" href="/partner">Transport company? Join free</a></div>
  </div></section>
  <div class="fm-body">
    <aside class="fm-side" id="side"></aside>
    <section><div class="fm-cats" id="cats"></div><div id="res"></div></section>
  </div>`;
  paintSide(); paintCats();
}

function paintSide() {
  const opt = (name, v, label, on) => `<label class="fm-opt"><input type="radio" name="${name}" value="${v}" ${on ? 'checked' : ''}>${label}</label>`;
  document.getElementById('side').innerHTML = `
    <h3>Job date</h3>
    <div class="fm-opts">${opt('when', 'any', 'Any date', S.when === 'any')}${opt('when', 'week', 'Next 7 days', S.when === 'week')}${opt('when', 'month', 'Next 31 days', S.when === 'month')}</div>
    <h3>Distance (miles)</h3>
    <div class="fm-range"><input name="min" inputmode="numeric" value="${esc(S.min)}" placeholder="Min" aria-label="Minimum miles"><input name="max" inputmode="numeric" value="${esc(S.max)}" placeholder="Max" aria-label="Maximum miles"></div>
    <span class="note">Use "Collect near" with a postcode, such as M1, to see jobs starting within your chosen miles.</span>
    <div class="fm-join"><b>Quote on these jobs</b><span>Join free as a transport company, send your price, and the customer's details are yours once they accept.</span><a class="btn sm" href="/partner">Join as a company</a></div>`;
}

function paintCats() {
  const counts = S.data?.counts || {};
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  document.getElementById('cats').innerHTML = `<button type="button" class="fm-cat" data-cat="" aria-pressed="${!S.cat.length}">${catTile('other', 30).replace(ICON.other, ICON.search)}All jobs <small>${S.data ? all : ''}</small></button>${CAT_ORDER.map((c) => `
    <button type="button" class="fm-cat" data-cat="${c}" aria-pressed="${S.cat.includes(c)}">${catTile(c, 30)}${esc(CAT_SHORT[c])} <small>${S.data ? counts[c] || 0 : ''}</small></button>`).join('')}`;
}

function card(j) {
  const fresh = Date.now() - new Date(j.createdAt).getTime() < 864e5;
  return `<a class="fm-card" href="/freightmatch/jobs/${esc(j.id)}">
    <div class="fm-card-img">${j.photo ? `<img src="${esc(j.photo)}" alt="" loading="lazy">` : catTile(j.cat, 72)}<span class="fm-card-cat">${esc(CAT_SHORT[j.cat] || 'Other')}</span>${fresh ? '<span class="fm-card-new">New</span>' : ''}</div>
    <div class="fm-card-main">
      <div class="fm-card-b"><h3>${esc(j.title)}</h3>
        ${j.facts.length ? `<span class="fm-facts">${esc(j.facts.join(' · '))}</span>` : ''}
        <div class="fm-route"><span class="a">${ICON.pin}<em>${esc(j.fromArea)}</em></span><span class="b">${ICON.flag}<em>${esc(j.toArea)}</em></span></div>
        <div class="fm-meta"><span>${ICON.cal}${esc(dayTxt(j.date))}</span>${j.miles ? `<span>${ICON.route}${j.miles} mi</span>` : ''}${j.away !== null && j.away !== undefined ? `<span>${j.away} mi from you</span>` : ''}</div></div>
      <div class="fm-card-f"><span class="fm-price">${j.estimate ? `<small>Typical price</small><b>${esc(priceRange(j.estimate))}</b>` : `<small>${j.offers ? 'Quotes so far' : 'Be the first'}</small><b>${j.offers} quote${j.offers === 1 ? '' : 's'}</b>`}</span>
        <span class="fm-quote">${j.offers ? `${j.offers} quote${j.offers === 1 ? '' : 's'} · ` : ''}Quote</span></div>
    </div></a>`;
}

function paintResults() {
  const el = document.getElementById('res');
  if (!el) return;
  const d = S.data;
  const head = `<div class="fm-res-h"><div><h2>${S.busy && !d ? 'Finding jobs…' : `${d?.total ?? 0} job${d?.total === 1 ? '' : 's'}`}</h2><span class="muted">${esc(describe())}</span></div>
    <div style="display:flex;gap:8px"><button type="button" class="fm-filter-btn" data-side>${ICON.filter}Filters</button>
    <select data-sort aria-label="Sort jobs">${[['newest', 'Newest first'], ['soonest', 'Soonest date'], ['nearest', 'Nearest to you'], ['distance', 'Longest distance'], ['offers', 'Fewest quotes']].map(([v, t]) => `<option value="${v}" ${S.sort === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>`;
  if (S.err) { el.innerHTML = `${head}<div class="fm-empty"><b>We could not load the jobs</b><span class="muted">${esc(S.err)}</span></div>`; return; }
  if (!d) { el.innerHTML = `${head}<div class="fm-grid">${'<div class="fm-sk"></div>'.repeat(6)}</div>`; return; }
  if (!d.jobs.length) {
    el.innerHTML = `${head}<div class="fm-empty">${catTile('boxes', 64)}<b>No jobs match these filters yet</b><span class="muted">Try a wider area or fewer filters. New jobs arrive every day.</span>
      <button type="button" class="btn ghost sm" data-clear>Clear filters</button></div>`;
    return;
  }
  el.innerHTML = `${head}<div class="fm-grid" style="opacity:${S.busy ? 0.55 : 1}">${d.jobs.map(card).join('')}</div>
    ${d.pages > 1 ? `<div class="fm-pages">${Array.from({ length: Math.min(d.pages, 10) }, (_, i) => `<button type="button" data-page="${i + 1}" aria-current="${d.page === i + 1}">${i + 1}</button>`).join('')}</div>` : ''}`;
}

function describe() {
  const bits = [];
  if (S.cat.length) bits.push(S.cat.map((c) => CAT_SHORT[c]).join(', '));
  if (S.from) bits.push(`collecting near ${S.from}`);
  if (S.to) bits.push(`delivering near ${S.to}`);
  if (S.q) bits.push(`matching "${S.q}"`);
  return bits.length ? bits.join(' · ') : 'Open jobs across the UK';
}

root.addEventListener('submit', (e) => {
  if (e.target.id !== 'sf') return;
  e.preventDefault();
  const f = new FormData(e.target);
  S.q = String(f.get('q') || '').trim(); S.from = String(f.get('from') || '').trim(); S.to = String(f.get('to') || '').trim(); S.radius = String(f.get('radius') || '30');
  S.page = 1; load();
});
root.addEventListener('click', (e) => {
  const t = e.target.closest('[data-cat],[data-page],[data-clear],[data-side]');
  if (!t) return;
  if (t.dataset.side !== undefined) { document.getElementById('side').classList.toggle('open'); return; }
  if (t.dataset.clear !== undefined) { Object.assign(S, { q: '', from: '', to: '', cat: [], when: 'any', min: '', max: '', page: 1 }); shell(); load(); return; }
  if (t.dataset.page) { S.page = Number(t.dataset.page); load(); window.scrollTo({ top: document.getElementById('cats').offsetTop - 10, behavior: 'smooth' }); return; }
  const c = t.dataset.cat;
  S.cat = !c ? [] : S.cat.includes(c) ? S.cat.filter((x) => x !== c) : [...S.cat, c];
  S.page = 1; paintCats(); load();
});
let timer = 0;
root.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.sort !== undefined) { S.sort = t.value; S.page = 1; load(); return; }
  if (t.name === 'when') { S.when = t.value; S.page = 1; load(); }
});
root.addEventListener('input', (e) => {
  const t = e.target;
  if (t.name !== 'min' && t.name !== 'max') return;
  S[t.name] = t.value.replace(/\D/g, ''); S.page = 1;
  clearTimeout(timer); timer = setTimeout(load, 500);
});

shell();
load();
