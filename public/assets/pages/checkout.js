import { DCLogic, mount, field, api, uid, CARRIER_LOGO, CARRIER_NAME } from '../dc.js';
import { openPaySheet } from '../pay.js';

/**
 * Guest checkout: buy one label without an account.
 * The chosen service comes from the prices page (sessionStorage 'kg_guest').
 */

const gbp = (p) => `£${(p / 100).toFixed(2)}`;
const read = (k) => { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const pick = read('kg_guest');
const saved = read('kg_guest_form') || {};
const UK_PC = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const HOW = { drop: 'Drop off at a shop', coll: 'Collected from your door', locker: 'Drop off at a locker' };

function setField(label, value) {
  const el = document.querySelector(`[aria-label="${label}"]`);
  if (el) { el.value = value || ''; el.dataset.dirty = '1'; }
}
const v = (label) => String(field(label) ?? '').trim();

function readAddr(px) {
  return { name: v(`${px}_name`), phone: v(`${px}_phone`), company: v(`${px}_company`), line1: v(`${px}_line1`), line2: v(`${px}_line2`),
    city: v(`${px}_city`), postcode: v(`${px}_postcode`).toUpperCase().replace(/\s+/g, ' '), country: 'GB' };
}
function addrError(a, who) {
  if (a.name.length < 2) return `Enter the ${who}'s full name.`;
  if (a.phone.replace(/\D/g, '').length < 7) return `Enter a phone number for the ${who}.`;
  if (a.line1.length < 2) return `Enter the first line of the ${who === 'sender' ? 'collection' : 'delivery'} address.`;
  if (a.city.length < 2) return 'Enter the town or city.';
  if (!UK_PC.test(a.postcode)) return 'Enter a full UK postcode, e.g. M1 1AE.';
  return '';
}
const oneLine = (a) => [a.name, a.line1, a.city, a.postcode].filter(Boolean).join(', ');

class Component extends DCLogic {
  constructor(p) {
    super(p);
    this.state = {
      step: 1, y: saved.y || { name: '', email: '' }, c: saved.c || {}, d: saved.d || {}, p: saved.p || { contents: '', value: '', terms: false },
      err: '', busy: false, toast: '', cfg: null, price: pick?.price ?? 0,
      lk: { c: { items: [], msg: '', bad: false, busy: false }, d: { items: [], msg: '', bad: false, busy: false } },
    };
    this.key = uid();
  }

  async mounted() {
    try { this.setState({ cfg: await api('/api/guest/config') }); } catch { /* shown on pay */ }
    // Signed-in customers book from their account instead.
    try { await api('/api/me'); location.href = '/app/send'; } catch { /* guest: stay */ }
  }

  say(t) { this.setState({ toast: t }); setTimeout(() => this.state.toast === t && this.setState({ toast: '' }), 4500); }
  persist(patch) { const s = { ...this.state, ...patch }; write('kg_guest_form', { y: s.y, c: s.c, d: s.d, p: s.p }); this.setState({ ...patch, err: '' }); }

  async pay() {
    const st = this.state;
    const value = Number(String(v('p_value')).replace(/[£,\s]/g, ''));
    const p = { contents: v('p_contents'), value: v('p_value'), terms: Boolean(field('p_terms')) };
    if (p.contents.length < 3) { this.setState({ err: 'Tell us what is inside (at least 3 characters).', p }); return; }
    if (!(value >= 0) || Number.isNaN(value)) { this.setState({ err: 'Enter the value in pounds, e.g. 25.', p }); return; }
    if (!p.terms) { this.setState({ err: 'Please tick the box to agree to the terms.', p }); return; }
    this.persist({ p });
    this.setState({ busy: true, err: '' });
    try {
      const r = await api('/api/guest/book', { method: 'POST', idempotencyKey: this.key, body: {
        email: st.y.email, name: st.y.name, from: st.c, to: st.d, parcel: pick.parcel, contents: p.contents, valuePence: Math.round(value * 100),
        carrier: pick.carrier, serviceCode: pick.serviceCode, expectedPricePence: pick.price } });
      const demo = st.cfg?.demoPayments;
      if (r.clientSecret && (st.cfg?.stripePk || demo)) {
        const res = await openPaySheet({ publishableKey: st.cfg.stripePk, clientSecret: r.clientSecret, amountTxt: gbp(r.pricePence),
          title: 'Pay and get your label', subtitle: `${pick.serviceName} · ${st.c.postcode} → ${st.d.postcode}`, payLabel: `Pay ${gbp(r.pricePence)}`,
          returnUrl: `${location.origin}/l/${r.token}`,
          ...(demo ? { demoPay: () => api(`/api/guest/demo-pay/${encodeURIComponent(r.token)}`, { method: 'POST', body: {} }) } : {}) });
        if (res === 'cancelled') { this.key = uid(); this.setState({ busy: false }); this.say('Payment cancelled. Nothing was charged.'); return; }
      } else if (r.clientSecret) {
        throw new Error('Card payments are being set up. Please try again in a few minutes.');
      }
      sessionStorage.removeItem('kg_guest_form');
      location.href = `/l/${r.token}`;
    } catch (e) {
      this.key = uid();
      const newPrice = e.code === 'quote_invalid' && /now £/.test(e.message);
      this.setState({ busy: false, err: e.message + (newPrice ? ' Go back to prices to book at the new price.' : '') });
    }
  }

  lookup(px) {
    const L = this.state.lk[px];
    const set = (patch) => this.setState({ lk: { ...this.state.lk, [px]: { ...this.state.lk[px], ...patch } } });
    const find = async () => {
      const pc = v(`${px}_find`);
      if (!pc) { set({ msg: 'Type a postcode first.', bad: true }); return; }
      set({ busy: true, msg: 'Looking up addresses…', bad: false, items: [] });
      try {
        const r = await api(`/api/guest/address?postcode=${encodeURIComponent(pc)}`);
        setField(`${px}_postcode`, r.postcode);
        if (r.town) setField(`${px}_city`, r.town);
        if (r.addresses.length) set({ busy: false, items: r.addresses, msg: '', bad: false });
        else if (r.suggestions?.length) set({ busy: false, msg: `Postcode not found. Did you mean ${r.suggestions.slice(0, 3).join(', ')}?`, bad: true });
        else if (r.town) set({ busy: false, msg: `Postcode found in ${r.town}. Type the street address below.`, bad: false });
        else set({ busy: false, msg: 'We could not find that postcode. Check it, or type the address below.', bad: true });
      } catch (e) { set({ busy: false, msg: e.message, bad: true }); }
    };
    return {
      key: (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } }, find,
      btn: L.busy ? 'Searching…' : 'Find address', has: L.items.length > 0,
      count: `${L.items.length} address${L.items.length === 1 ? '' : 'es'} found: choose one`,
      items: L.items.map((a, i) => ({ i: String(i), label: a.label })),
      msg: L.msg || (L.items.length ? '' : 'Or type the address in the boxes below.'), msgFg: L.bad ? '#B42318' : '#586579',
      pick: (e) => {
        const a = L.items[Number(e.target.value)];
        if (!a || e.target.value === '') return;
        setField(`${px}_line1`, a.line1); setField(`${px}_line2`, a.line2); setField(`${px}_city`, a.city); setField(`${px}_postcode`, a.postcode);
        if (a.company && !v(`${px}_company`)) setField(`${px}_company`, a.company);
      },
    };
  }

  renderVals() {
    const st = this.state;
    if (!pick) return { missing: true, ready: false, signInUrl: '/login', toast: false };
    const go = (n) => () => { this.setState({ step: n, err: '' }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    const steps = [
      () => {
        const y = { name: v('y_name'), email: v('y_email') };
        if (y.name.length < 2) return this.setState({ err: 'Enter your full name.', y });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(y.email)) return this.setState({ err: 'Enter a valid email address. Your label link goes here.', y });
        const c = st.c.name ? st.c : { ...st.c, name: y.name };
        this.persist({ y, c, step: 2 });
      },
      () => { const c = readAddr('c'); const e = addrError(c, 'sender'); if (e) return this.setState({ err: e, c }); this.persist({ c, step: 3 }); },
      () => {
        const d = readAddr('d'); const e = addrError(d, 'recipient'); if (e) return this.setState({ err: e, d });
        if (d.postcode === st.c.postcode && d.line1.toLowerCase() === (st.c.line1 || '').toLowerCase()) return this.setState({ err: 'The delivery address is the same as the collection address.', d });
        this.persist({ d, step: 4 });
      },
      () => this.pay(),
    ];
    const sums = [`${st.y.name} · ${st.y.email}`, oneLine(st.c), oneLine(st.d), ''];
    const S = (n) => ({
      state: st.step === n ? 'open' : st.step > n ? 'done' : 'todo', open: st.step === n, done: st.step > n, notDone: st.step <= n,
      canEdit: st.step > n && !st.busy, edit: go(n), sum: sums[n - 1], next: () => { if (!st.busy) steps[n - 1](); },
    });
    const parcel = pick.parcel;
    const kg = Math.round(parcel.weightGrams / 100) / 10;
    const k = pick.carrier;
    return {
      missing: false, ready: true, signInUrl: `/login?next=${encodeURIComponent('/app/send')}`,
      s1: S(1), s2: S(2), s3: S(3), s4: S(4),
      y: st.y, c: st.c, d: st.d, p: { ...st.p, terms: st.p.terms ? 'true' : 'false' },
      lk: { c: this.lookup('c'), d: this.lookup('d') },
      err: st.err, noErr: !st.err, busyTxt: st.busy ? 'true' : 'false',
      payTxt: st.busy ? 'Please wait…' : `Next: pay ${gbp(pick.price)}`,
      parcelTxt: `${kg} kg · ${parcel.lengthCm} × ${parcel.widthCm} × ${parcel.heightCm} cm`,
      routeTxt: st.c.postcode && st.d.postcode ? `${st.c.postcode} → ${st.d.postcode}` : 'UK to UK',
      backUrl: pick.backUrl || '/',
      q: { service: pick.serviceName, carrierName: CARRIER_NAME[k] || pick.carrierName, logo: CARRIER_LOGO[k] || '', hasLogo: Boolean(CARRIER_LOGO[k]),
        how: HOW[pick.type] || 'Drop off or collection', eta: pick.transitDays ? `${pick.transitDays} working day${pick.transitDays > 1 ? 's' : ''}` : '2–4 working days',
        exTxt: gbp(pick.priceExVat), vatTxt: gbp(pick.price - pick.priceExVat), priceTxt: gbp(pick.price) },
      toast: !!st.toast, toastTxt: st.toast,
    };
  }
}

mount(Component, document.getElementById('tpl').textContent, document.getElementById('root'));
