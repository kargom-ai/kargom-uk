import { api, esc, resizeImage, toast, UK_PC, wrapLabels } from '../market-ui.js';
import { ICON, CATS, VEHICLE_CATS, ACCESS_CATS, PLACEHOLDER, catTile, dayTxt } from '../match-ui.js';

/**
 * Post a job on Kargom FreightMatch in four short steps: what, where, when, and who you are.
 * The draft is kept in this browser tab, so a refresh or a sign-in never loses it.
 */
const root = document.getElementById('root');
const KEY = 'fm_draft_v1';
const today = new Date().toISOString().slice(0, 10);
const blank = () => ({
  step: 1, cat: new URLSearchParams(location.search).get('cat') || '', what: '', qty: '1', weightKg: '', size: '', make: '', model: '', runs: true,
  fromFloor: 'ground', toFloor: 'ground', lift: false, helpers: false, photos: [],
  fromPc: '', fromTown: '', toPc: '', toTown: '', date: '', flex: 'week', notes: '', name: '', email: '', phone: '', password: '', auth: 'join',
});
let D = blank();
try { const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (saved) D = { ...D, ...saved, password: '' }; } catch { /* private mode */ }
if (!(D.cat in CATS)) D.cat = '';
let me = null, busy = false, err = '';
const save = () => { try { const { password, ...rest } = D; sessionStorage.setItem(KEY, JSON.stringify(rest)); } catch { /* storage full or blocked */ } };

const STEPS = ['What', 'Where', 'When', 'Your details'];
const sel = (name, opts, v) => `<select class="inp" name="${name}">${opts.map(([k, t]) => `<option value="${k}" ${String(v) === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
const FLOORS = [['ground', 'Ground floor'], ['1', '1st floor'], ['2', '2nd floor'], ['3', '3rd floor'], ['4+', '4th or higher']];

function stepWhat() {
  const c = D.cat;
  const extra = !c ? '' : `
    <label class="fld">What needs moving? <i>*</i><input class="inp" name="what" value="${esc(D.what)}" maxlength="200" placeholder="${esc(PLACEHOLDER[c])}"></label>
    ${c === 'home' ? `<label class="fld">Home size${sel('size', [['studio', 'Studio flat'], ['1', '1 bedroom'], ['2', '2 bedrooms'], ['3', '3 bedrooms'], ['4', '4 bedrooms'], ['5', '5+ bedrooms']], D.size || '2')}</label>` : ''}
    ${c === 'office' ? `<label class="fld">Office size${sel('size', [['small', 'Small (up to 10 desks)'], ['medium', 'Medium (10 to 30 desks)'], ['large', 'Large (30+ desks)']], D.size || 'small')}</label>` : ''}
    ${VEHICLE_CATS.includes(c) ? `<div class="grid2"><label class="fld">Make<input class="inp" name="make" value="${esc(D.make)}" placeholder="e.g. Ford"></label><label class="fld">Model<input class="inp" name="model" value="${esc(D.model)}" placeholder="e.g. Fiesta"></label></div>
      <div class="fm-chips" role="group" aria-label="Does it run?"><button type="button" data-runs="1" aria-pressed="${D.runs}">It runs and drives</button><button type="button" data-runs="0" aria-pressed="${!D.runs}">Not running</button></div>` : ''}
    ${!['home', 'office'].includes(c) ? `<div class="grid2"><label class="fld">How many<input class="inp" name="qty" inputmode="numeric" value="${esc(D.qty)}"></label><label class="fld">Approx. weight (kg) <em>(optional)</em><input class="inp" name="weightKg" inputmode="numeric" value="${esc(D.weightKg)}" placeholder="If you know it"></label></div>` : ''}
    ${ACCESS_CATS.includes(c) ? `<div class="grid2"><label class="fld">Collection floor${sel('fromFloor', FLOORS, D.fromFloor)}</label><label class="fld">Delivery floor${sel('toFloor', FLOORS, D.toFloor)}</label></div>
      <div class="fm-chips"><button type="button" data-tog="lift" aria-pressed="${D.lift}">There is a lift</button><button type="button" data-tog="helpers" aria-pressed="${D.helpers}">Needs two people to carry</button></div>` : ''}
    <div class="fld"><span>Photos <em>(optional, they help companies price it)</em></span>
      <div class="fm-photos">${D.photos.map((p, i) => `<span class="ph"><img src="${p}" alt=""><button type="button" data-unphoto="${i}" aria-label="Remove photo">×</button></span>`).join('')}
      ${D.photos.length < 4 ? `<label class="add">${ICON.camera}Add photo<input type="file" accept="image/*" multiple data-photos hidden></label>` : ''}</div></div>`;
  return `<h1>What do you need moved?</h1><p class="sub">Pick the closest match. Transport companies filter jobs by these.</p>
    <div class="fm-tiles">${Object.entries(CATS).map(([k, t]) => `<button type="button" class="fm-tile" data-pick="${k}" aria-pressed="${D.cat === k}">${catTile(k, 44)}${esc(t)}</button>`).join('')}</div>${extra}`;
}

function stepWhere() {
  const pc = (side) => {
    const v = D[`${side}Pc`], town = D[`${side}Town`];
    return `<label class="fld">${side === 'from' ? 'Collection postcode' : 'Delivery postcode'} <i>*</i><input class="inp" name="${side}Pc" value="${esc(v)}" placeholder="${side === 'from' ? 'e.g. M1 1AE' : 'e.g. LS1 5HD'}" autocomplete="postal-code" style="text-transform:uppercase"></label>
      <span class="fm-pc" id="${side}Hint">${town ? `${ICON.check}${esc(town)}` : ''}</span>
      ${v && !town && UK_PC.test(v) ? `<label class="fld">Town<input class="inp" name="${side}Town" value="${esc(town)}" placeholder="Town or city"></label>` : ''}`;
  };
  return `<h1>Where is it going?</h1><p class="sub">Companies see only the town and the first half of the postcode until you accept a quote.</p>
    ${pc('from')}${pc('to')}
    <p class="muted" style="margin:0;font-size:14px">Moving goods abroad? <a href="/freight">Compare international freight</a>.</p>`;
}

function stepWhen() {
  return `<h1>When should it happen?</h1><p class="sub">Being flexible usually gets you cheaper quotes: companies can fit it into a trip they are already making.</p>
    <label class="fld">Collection date <i>*</i><input class="inp" type="date" name="date" min="${today}" value="${esc(D.date)}"></label>
    <div class="fm-chips" role="group" aria-label="How flexible">${[['exact', 'This date only'], ['week', 'Within a few days'], ['flexible', 'I am flexible']].map(([k, t]) => `<button type="button" data-flex="${k}" aria-pressed="${D.flex === k}">${t}</button>`).join('')}</div>
    <label class="fld">Anything else companies should know? <em>(optional)</em><textarea class="inp" name="notes" maxlength="1000" placeholder="Parking, narrow stairs, items that need wrapping…">${esc(D.notes)}</textarea></label>`;
}

function stepContact() {
  const sum = `<div class="fm-sum"><div><span>Job</span><b>${esc(D.what)}</b></div><div><span>Type</span><b>${esc(CATS[D.cat])}</b></div>
    <div><span>Route</span><b>${esc(D.fromTown || D.fromPc)} → ${esc(D.toTown || D.toPc)}</b></div><div><span>Date</span><b>${esc(dayTxt(D.date))}</b></div></div>`;
  if (me) return `<h1>Check and post your job</h1><p class="sub">Posting as ${esc(me.name)} (${esc(me.email)}).</p>${sum}
    <label class="fld">Mobile number <i>*</i><input class="inp" name="phone" type="tel" value="${esc(D.phone || me.phone || '')}" placeholder="07700 900123"></label>
    <span class="muted" style="font-size:13px">Your number is only shared with the company whose quote you accept.</span>`;
  const join = D.auth === 'join';
  return `<h1>Where should we send your quotes?</h1><p class="sub">${join ? 'Create a free account to see and compare quotes.' : 'Sign in to post this job.'}</p>${sum}
    ${join ? `<label class="fld">Your name <i>*</i><input class="inp" name="name" value="${esc(D.name)}" autocomplete="name"></label>` : ''}
    <label class="fld">Email <i>*</i><input class="inp" name="email" type="email" value="${esc(D.email)}" autocomplete="email"></label>
    ${join ? `<label class="fld">Mobile number <i>*</i><input class="inp" name="phone" type="tel" value="${esc(D.phone)}" placeholder="07700 900123" autocomplete="tel"></label>` : ''}
    <label class="fld">${join ? 'Choose a password' : 'Password'} <i>*</i><input class="inp" name="password" type="password" autocomplete="${join ? 'new-password' : 'current-password'}" placeholder="${join ? 'At least 8 characters' : ''}"></label>
    <button type="button" class="fm-switch" data-auth="${join ? 'login' : 'join'}">${join ? 'I already have a Kargom account' : 'New to Kargom? Create an account'}</button>
    ${!join ? `<label class="fld">Mobile number <i>*</i><input class="inp" name="phone" type="tel" value="${esc(D.phone)}" placeholder="07700 900123" autocomplete="tel"></label>` : ''}
    <span class="muted" style="font-size:12.5px">By posting you agree to the <a href="/terms">terms</a>. Your number is only shared with the company whose quote you accept.</span>`;
}

function render() {
  const body = [stepWhat, stepWhere, stepWhen, stepContact][D.step - 1]();
  root.innerHTML = wrapLabels(`<div class="fm-post"><div>
    <div class="fm-progress">${STEPS.map((t, i) => `<span class="${i < D.step ? 'on' : ''}">${i + 1}. ${t}</span>`).join('')}</div>
    <form class="fm-step" id="fs" novalidate>${body}
      <div class="err" ${err ? '' : 'hidden'}>${esc(err)}</div>
      <div class="fm-nav-b">${D.step > 1 ? '<button type="button" class="btn ghost" data-back>Previous</button>' : ''}<button type="submit" class="btn" ${busy ? 'aria-disabled="true"' : ''}>${busy ? 'Posting…' : D.step === 4 ? 'Post my job and get quotes' : 'Continue'}</button></div>
    </form></div>
    <aside class="fm-why"><b>Why post on FreightMatch</b><ul>
      <li>${ICON.check}<span>Free to post, no obligation to book.</span></li>
      <li>${ICON.check}<span>Quotes from rated removal companies, hauliers and couriers.</span></li>
      <li>${ICON.check}<span>See a typical price for your job before quotes arrive.</span></li>
      <li>${ICON.check}<span>Your phone number and address stay private until you accept.</span></li>
    </ul></aside></div>`);
}

/** Read the visible fields into the draft. */
function keep() {
  const f = document.getElementById('fs');
  if (!f) return;
  for (const el of f.querySelectorAll('input[name], select[name], textarea[name]')) {
    if (el.type === 'file') continue;
    D[el.name] = el.name.endsWith('Pc') ? el.value.toUpperCase().trim() : el.value;
  }
  save();
}

function check() {
  if (D.step === 1) {
    if (!D.cat) return 'Choose what you need moved';
    if (D.what.trim().length < 3) return 'Describe what needs moving';
  }
  if (D.step === 2) {
    if (!UK_PC.test(D.fromPc)) return 'Enter a full UK collection postcode, e.g. M1 1AE';
    if (!UK_PC.test(D.toPc)) return 'Enter a full UK delivery postcode, e.g. LS1 5HD';
    if (!D.fromTown || !D.toTown) return 'Enter the town for each postcode';
  }
  if (D.step === 3 && (!D.date || D.date < today)) return 'Choose a collection date from today';
  if (D.step === 4) {
    if (D.phone.replace(/\D/g, '').length < 10) return 'Enter your mobile number';
    if (!me) {
      if (D.auth === 'join' && D.name.trim().length < 2) return 'Enter your name';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(D.email)) return 'Enter a valid email';
      if (D.auth === 'join' && D.password.length < 8) return 'Choose a password of at least 8 characters';
      if (!D.password) return 'Enter your password';
    }
  }
  return '';
}

async function lookup(side) {
  const pc = D[`${side}Pc`];
  const hint = document.getElementById(`${side}Hint`);
  if (!UK_PC.test(pc)) { if (hint) { hint.className = 'fm-pc'; hint.innerHTML = ''; } return; }
  try {
    const r = await api(`/api/match/postcode?pc=${encodeURIComponent(pc)}`);
    if (D[`${side}Pc`] !== pc) return;
    D[`${side}Town`] = r.town || '';
    save();
    if (!r.town) { render(); return; }
    if (hint) { hint.className = 'fm-pc'; hint.innerHTML = `${ICON.check}${esc(r.town)}`; }
  } catch { render(); }
}

async function post() {
  busy = true; err = ''; render();
  try {
    if (!me) {
      if (D.auth === 'join') await api('/api/auth/register', { method: 'POST', body: { email: D.email, password: D.password, name: D.name, phone: D.phone, accountType: 'personal' } });
      await api('/api/auth/login', { method: 'POST', body: { email: D.email, password: D.password } });
    }
    const vehicle = VEHICLE_CATS.includes(D.cat) ? { make: D.make, model: D.model, runs: D.runs } : undefined;
    const access = ACCESS_CATS.includes(D.cat) ? { fromFloor: D.fromFloor, toFloor: D.toFloor, lift: D.lift, helpers: D.helpers } : undefined;
    const job = await api('/api/jobs', { method: 'POST', body: {
      kind: 'transport', date: D.date, phone: D.phone, photos: D.photos,
      from: { city: D.fromTown, postcode: D.fromPc, country: 'GB' }, to: { city: D.toTown, postcode: D.toPc, country: 'GB' },
      details: { category: D.cat, what: D.what, qty: D.qty, weightKg: D.weightKg, size: D.size, vehicle, access, dateFlex: D.flex, notes: D.notes },
    } });
    try { sessionStorage.removeItem(KEY); } catch { /* */ }
    location.href = `/app/requests/${job.id}?posted=1`;
  } catch (e) {
    busy = false; err = e.message;
    if (/already exists/i.test(err)) { D.auth = 'login'; err = 'You already have an account with this email. Enter your password to post.'; }
    try { me = await api('/api/me'); } catch { me = null; }
    render();
  }
}

root.addEventListener('submit', (e) => {
  e.preventDefault();
  keep();
  err = check();
  if (err) { render(); return; }
  if (D.step < 4) { D.step++; save(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  post();
});
root.addEventListener('click', (e) => {
  const t = e.target.closest('[data-pick],[data-back],[data-runs],[data-tog],[data-flex],[data-unphoto],[data-auth]');
  if (!t) return;
  keep(); err = '';
  if (t.dataset.pick) { if (D.cat !== t.dataset.pick) { D.cat = t.dataset.pick; D.size = ''; } }
  else if (t.dataset.back !== undefined) D.step = Math.max(1, D.step - 1);
  else if (t.dataset.runs) D.runs = t.dataset.runs === '1';
  else if (t.dataset.tog) D[t.dataset.tog] = !D[t.dataset.tog];
  else if (t.dataset.flex) D.flex = t.dataset.flex;
  else if (t.dataset.unphoto) D.photos.splice(Number(t.dataset.unphoto), 1);
  else if (t.dataset.auth) D.auth = t.dataset.auth;
  save(); render();
  if (t.dataset.pick) document.querySelector('[name="what"]')?.focus();
});
root.addEventListener('change', async (e) => {
  if (e.target.dataset.photos === undefined) return;
  keep();
  for (const f of [...e.target.files].slice(0, 4 - D.photos.length)) {
    try { D.photos.push(await resizeImage(f, 1280, 'image/jpeg', 0.72)); } catch (x) { toast(x.message); }
  }
  save(); render();
});
let timer = 0;
root.addEventListener('input', (e) => {
  const n = e.target.name;
  if (n !== 'fromPc' && n !== 'toPc') return;
  D[n] = e.target.value.toUpperCase().trim();
  const side = n.slice(0, -2);
  D[`${side}Town`] = '';
  clearTimeout(timer); timer = setTimeout(() => lookup(side), 350);
});

(async () => {
  try { me = await api('/api/me'); } catch { me = null; }
  render();
})();
