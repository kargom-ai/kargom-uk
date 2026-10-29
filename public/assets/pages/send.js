import { DCLogic, mount, field, api, uid, CARRIER_LOGO, CARRIER_NAME } from '../dc.js';
import { openPaySheet } from '../pay.js';
import { NAV } from '../shell.js';
import { shrinkPhoto, clipboardText, postcodeHere } from '../photo-address.js';

/** Send a parcel: the approved 5-step design, booking real labels through the API. */

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k) || '') ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const PRESET_PARCELS = [
  { id: 'small', name: 'Small box', kg: 2, l: 30, w: 20, h: 15 },
  { id: 'env', name: 'Document envelope', kg: 0.5, l: 35, w: 25, h: 2 },
  { id: 'med', name: 'Medium box', kg: 5, l: 45, w: 35, h: 30 },
];
const COUNTRIES = [['US', 'United States'], ['DE', 'Germany'], ['FR', 'France'], ['IE', 'Ireland'], ['NL', 'Netherlands'], ['ES', 'Spain'], ['IT', 'Italy'],
  ['AU', 'Australia'], ['CA', 'Canada'], ['TR', 'Turkey'], ['BE', 'Belgium'], ['PL', 'Poland'], ['GB', 'United Kingdom']];
const cname = (code) => (COUNTRIES.find((c) => c[0] === code) || [code, code])[1];
const gbp = (p) => '£' + (p / 100).toFixed(2);
const THUMBS = ['#2463DB', '#33AEEF', '#1D3593', '#16A34A', '#E89B12'];
const addrKey = (a) => `${a.name}|${a.line1}|${a.postcode}`.toLowerCase();
const town = (a) => (a.country && a.country !== 'GB' ? `${a.city}, ${a.country}` : `${a.city} ${String(a.postcode).split(' ')[0]}`);
const oneLine = (a) => [a.line1, a.line2, a.city, a.postcode, a.country !== 'GB' ? cname(a.country) : ''].filter(Boolean).join(', ');

function toast(text) {
  const t = document.createElement('div');
  t.className = 'kg-toast';
  t.setAttribute('role', 'status');
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), 4000);
}

/** Put a value into a form box and keep it through re-renders. */
function setField(label, value) {
  const el = document.querySelector(`[aria-label="${label}"]`);
  if (el) { el.value = value || ''; el.dataset.dirty = '1'; }
}

const pending = (() => { try { return JSON.parse(sessionStorage.getItem('kg_pending') || 'null'); } catch { return null; } })();
sessionStorage.removeItem('kg_pending');

class Component extends DCLogic {
  constructor(p) {
    super(p);
    const custom = pending?.parcel ? [{ id: 'quoted', name: 'Parcel from your quote', kg: pending.parcel.weightGrams / 1000, l: pending.parcel.lengthCm, w: pending.parcel.widthCm, h: pending.parcel.heightCm }] : [];
    this.state = {
      mode: pending?.toCountry && pending.toCountry !== 'GB' ? 'intl' : 'uk', step: 1,
      parcel: custom[0]?.id || '', sender: '', recip: '', items: {}, courier: '', sort: 'cheap',
      newParcel: false, newAddr: false, newItem: false, done: null, pay: 'wallet',
      me: null, bal: 0, history: [], parcels: [...custom, ...store.get('kg_parcels', []), ...PRESET_PARCELS],
      mySenders: store.get('kg_senders', []), myRecips: store.get('kg_recips', []), savedItems: store.get('kg_items', []),
      lk: { sa: { items: [], msg: '', bad: false, busy: false }, ra: { items: [], msg: '', bad: false, busy: false } },
      ph: { sa: { busy: false, msg: '', bad: false, paste: false }, ra: { busy: false, msg: '', bad: false, paste: false } },
      quotes: null, quoteError: '', busy: false, preferService: pending?.serviceName || '',
    };
    this.key = uid();
  }

  async mounted() {
    try {
      const me = await api('/api/me');
      const [w, s] = await Promise.all([api('/api/wallet'), api('/api/shipments')]);
      this.setState({ me, bal: w.balancePence, history: s.shipments });
    } catch {
      location.href = `/login?next=${encodeURIComponent('/app/send')}`;
      return;
    }
    const qs = new URLSearchParams(location.search);
    if (qs.get('cancelled')) { history.replaceState(null, '', '/app/send'); toast('Payment cancelled. Nothing was charged.'); }
    const paid = qs.get('paid');
    if (paid) {
      history.replaceState(null, '', '/app/send');
      await this.waitForPaid(paid);
    }
  }

  /** Label that the courier issues later (Packlink): refresh the done screen when it arrives. */
  async watchLabel(id) {
    for (let i = 0; i < 480; i++) {
      await new Promise((r) => setTimeout(r, 15000));
      try {
        const { shipment } = await api(`/api/shipments/${encodeURIComponent(id)}`);
        if (shipment.status !== 'awaiting_label') {
          if (this.state.done?.shipment.id === id) this.setState({ done: { ...this.state.done, shipment } });
          if (shipment.status === 'booked') toast('Your label is ready.');
          return;
        }
      } catch { /* keep trying */ }
    }
  }

  /** Stripe's webhook books the label after the card payment; wait for it (normally a few seconds). */
  async waitForPaid(shipmentId) {
    this.setState({ busy: true });
    toast('Payment received. Creating your label…');
    for (let i = 0; i < 30; i++) {
      try {
        const { shipment } = await api(`/api/shipments/${encodeURIComponent(shipmentId)}`);
        if (shipment.status === 'failed') { toast('The courier could not create this label. Your card payment has been refunded.'); break; }
        if (!['awaiting_payment', 'pending', 'purchasing'].includes(shipment.status)) {
          if (shipment.status === 'awaiting_label') this.watchLabel(shipment.id);
          this.setState({ done: { shipment, quote: { dropOff: /drop|shop|locker|post office/i.test(shipment.service_name) } }, busy: false });
          window.scrollTo(0, 0);
          return;
        }
      } catch { break; }
      await new Promise((r) => setTimeout(r, 2000));
    }
    this.setState({ busy: false });
    if (this.state.done === null) toast('Your payment is being confirmed. The label will appear under Shipments shortly.');
  }

  senders() {
    const map = new Map();
    for (const a of this.state.mySenders) map.set(addrKey(a), { ...a, tag: 'Saved' });
    for (const s of this.state.history) { const a = JSON.parse(s.from_json); if (!map.has(addrKey(a))) map.set(addrKey(a), { ...a, tag: 'Used before' }); }
    return [...map.values()].map((a, i) => ({ ...a, id: addrKey(a), tag: i === 0 ? 'Default' : a.tag }));
  }

  recipients() {
    const intl = this.state.mode === 'intl';
    const map = new Map();
    for (const a of this.state.myRecips) map.set(addrKey(a), { ...a, tag: 'Saved' });
    for (const s of this.state.history) { const a = JSON.parse(s.to_json); if (!map.has(addrKey(a))) map.set(addrKey(a), { ...a, tag: 'Recent' }); }
    return [...map.values()].filter((a) => (intl ? a.country !== 'GB' : a.country === 'GB')).map((a) => ({ ...a, id: addrKey(a) }));
  }

  request() {
    const st = this.state;
    const P = st.parcels.find((p) => p.id === st.parcel);
    const S = this.senders().find((a) => a.id === st.sender);
    const R = this.recipients().find((a) => a.id === st.recip);
    const clean = (a) => ({ name: a.name, phone: a.phone || undefined, email: a.email || undefined, line1: a.line1, line2: a.line2 || undefined, city: a.city, postcode: String(a.postcode).toUpperCase(), country: a.country });
    const req = { from: clean(S), to: clean(R), parcel: { weightGrams: Math.round(P.kg * 1000), lengthCm: P.l, widthCm: P.w, heightCm: P.h } };
    if (st.mode === 'intl') {
      const items = st.savedItems.filter((i) => (st.items[i.id] || 0) > 0).map((i) => ({ description: i.name, quantity: st.items[i.id], valuePence: Math.round(i.value * 100) * st.items[i.id], hsCode: i.hs || undefined, originCountry: i.origin }));
      req.customs = { contents: field('customs_reason') || 'merchandise', items };
    }
    return req;
  }

  async loadQuotes() {
    this.setState({ quotes: null, quoteError: '', courier: '', qSlow: 0 });
    // Reassure while couriers answer: the message changes if it takes a while.
    const t1 = setTimeout(() => this.state.quotes === null && this.setState({ qSlow: 1 }), 3500);
    const t2 = setTimeout(() => this.state.quotes === null && this.setState({ qSlow: 2 }), 8000);
    try {
      const { quotes } = await api('/api/quotes', { method: 'POST', body: this.request() });
      const prefer = quotes.find((q) => q.serviceName === this.state.preferService);
      this.setState({ quotes, courier: prefer ? prefer.token : '' });
    } catch (e) {
      this.setState({ quotes: [], quoteError: e.message });
      toast(e.message);
    } finally { clearTimeout(t1); clearTimeout(t2); }
  }

  async book() {
    const st = this.state;
    const q = (st.quotes || []).find((x) => x.token === st.courier);
    if (!q) return;
    this.setState({ busy: true });
    try {
      const me = st.me || {};
      const r = await api('/api/bookings', { method: 'POST', body: { quoteToken: q.token, payWith: st.pay === 'wallet' ? 'wallet' : 'card', flow: (me.stripePk || me.demoPayments) ? 'embedded' : 'hosted' }, idempotencyKey: this.key });
      if (r.kind === 'booked') {
        this.setState({ done: { shipment: r.shipment, quote: q }, busy: false, bal: st.pay === 'wallet' ? st.bal - q.price : st.bal });
        if (r.shipment.status === 'awaiting_label') this.watchLabel(r.shipment.id);
        window.scrollTo(0, 0);
      } else if (r.kind === 'failed') {
        this.key = uid();
        toast(`The courier could not create this label (${r.reason}). Your money has been returned.`);
        this.setState({ busy: false });
      } else if (r.clientSecret && (me.stripePk || me.demoPayments)) {
        // Card form on our page: the customer never leaves Kargom.
        const res = await openPaySheet({ publishableKey: me.stripePk, clientSecret: r.clientSecret, amountTxt: gbp(r.shipment.price_pence),
          title: 'Pay and book', subtitle: `${r.shipment.service_name} · ${r.shipment.ref}`, payLabel: `Pay ${gbp(r.shipment.price_pence)} and book`,
          returnUrl: `${location.origin}/app/send?paid=${r.shipment.id}`,
          ...(me.demoPayments ? { demoPay: () => api(`/api/dev/card-paid/${encodeURIComponent(r.shipment.id)}`, { method: 'POST', body: {} }) } : {}) });
        this.key = uid();
        if (res === 'cancelled') { toast('Payment cancelled. Nothing was charged.'); this.setState({ busy: false }); return; }
        await this.waitForPaid(r.shipment.id);
      } else if (r.checkoutUrl) {
        // Card / Apple Pay / Google Pay on Stripe's secure page; it returns to /app/send?paid=…
        location.href = r.checkoutUrl;
      } else {
        this.key = uid();
        toast('Card payment is not connected yet. Please pay from your wallet.');
        this.setState({ busy: false });
      }
    } catch (e) {
      this.key = uid();
      toast(e.message);
      this.setState({ busy: false });
    }
  }

  renderVals() {
    const st = this.state;
    const me = st.me || { name: '', account_type: 'personal', demoPayments: true };
    const intl = st.mode === 'intl';
    const sel = (on) => ({ on: on ? 'true' : 'false', border: on ? '#2463DB' : '#E1E7EF', bg: on ? '#F5F9FF' : '#FFFFFF', ring: on ? '#2463DB' : '#9FB0C8', dot: on ? '#2463DB' : 'transparent' });

    const parcels = st.parcels.map((p, i) => ({ name: p.name, kg: p.kg + ' kg', dims: `L ${p.l} · W ${p.w} · H ${p.h} cm`, tag: p.id === 'quoted' ? 'From your quote' : i === 0 ? 'Most used' : '',
      ...sel(st.parcel === p.id), pick: () => this.setState({ parcel: p.id, quotes: null }) }));
    const P = st.parcels.find((p) => p.id === st.parcel);

    const SENDERS = this.senders();
    const RECIPS = this.recipients();
    const senders = SENDERS.map((a) => ({ label: a.company || a.name, name: a.name, phone: a.phone || '—', line: oneLine(a), town: town(a), tag: a.tag, ...sel(st.sender === a.id), pick: () => this.setState({ sender: a.id, quotes: null }) }));
    const recips = RECIPS.map((a) => ({ label: a.name, name: a.name, phone: a.phone || '—', line: oneLine(a), town: town(a), tag: a.tag, ...sel(st.recip === a.id), pick: () => this.setState({ recip: a.id, quotes: null }) }));
    const S = SENDERS.find((a) => a.id === st.sender), R = RECIPS.find((a) => a.id === st.recip);

    const items = st.savedItems.map((it, i) => { const q = st.items[it.id] || 0, on = q > 0;
      const setQ = (n) => this.setState({ items: { ...st.items, [it.id]: Math.max(0, n) }, quotes: null });
      return { name: it.name, ini: it.name[0]?.toUpperCase() || '?', thumb: THUMBS[i % THUMBS.length], qty: q,
        meta: gbp(Math.round(it.value * 100)) + ' each' + (intl ? ` · ${it.hs ? 'HS ' + it.hs + ' · ' : ''}Made in ${cname(it.origin)}` : ''),
        on: on ? 'true' : 'false', border: on ? '#2463DB' : '#E1E7EF', bg: on ? '#F5F9FF' : '#FFFFFF', ring: on ? '#2463DB' : '#9FB0C8', box: on ? '#2463DB' : '#FFFFFF',
        toggle: () => setQ(on ? 0 : 1), minus: () => setQ(q - 1), plus: () => setQ(q + 1) }; });
    const picked = st.savedItems.filter((i) => (st.items[i.id] || 0) > 0);
    const declaredV = picked.reduce((a, i) => a + Math.round(i.value * 100) * st.items[i.id], 0);
    const nItems = picked.reduce((a, i) => a + st.items[i.id], 0);

    // live quotes
    const Q = (st.quotes || []).map((q) => ({ id: q.token, k: q.carrier, carrier: CARRIER_NAME[q.carrier] || q.carrierName, service: q.serviceName, p: q.price, ex: q.priceExVat,
      later: Boolean(q.labelLater), eta: q.transitDays ? (q.transitDays === 1 ? 'Next day' : `${q.transitDays} days`) : 'Varies', how: q.carrier === 'inpost' ? 'Drop off at a locker' : q.dropOff ? 'Drop off at a shop' : 'Collected from your door', speed: q.transitDays || 9 }));
    const cheapest = Math.min(...Q.map((q) => q.p)), fastest = Math.min(...Q.map((q) => q.speed));
    if (st.sort === 'cheap') Q.sort((a, b) => a.p - b.p);
    if (st.sort === 'fast') Q.sort((a, b) => a.speed - b.speed || a.p - b.p);
    if (st.sort === 'best') Q.sort((a, b) => (a.p / 100 + a.speed) - (b.p / 100 + b.speed));
    const nt = st.me?.notify || {};
    const chans = [nt.email && 'email', nt.sms && 'SMS', nt.whatsapp && 'WhatsApp'].filter(Boolean);
    const laterTxt = chans.length ? `Sent to you by ${chans.length > 1 ? chans.slice(0, -1).join(', ') + ' & ' + chans[chans.length - 1] : chans[0]} and shown here when ready` : 'Appears here and under Shipments when ready';
    const quotes = Q.map((q) => { const fast = q.speed === fastest, cheap = q.p === cheapest;
      return { ...sel(st.courier === q.id), carrier: q.carrier, service: q.service, logo: CARRIER_LOGO[q.k] || '', eta: q.eta, how: q.how, instant: !q.later, later: q.later, laterTxt, price: gbp(q.p), ex: gbp(q.ex),
        badge: cheap ? 'Cheapest' : fast ? 'Fastest' : '', badgeBg: cheap ? '#E6F4EA' : fast ? '#EAF2FE' : 'transparent', badgeFg: cheap ? '#166534' : '#1D4FB8',
        pick: () => this.setState({ courier: q.id }) }; });
    const C = Q.find((q) => q.id === st.courier);
    const sorts = [['cheap', 'Cheapest'], ['fast', 'Fastest'], ['best', 'Best value']].map(([id, label]) => ({ label, on: st.sort === id ? 'true' : 'false',
      bg: st.sort === id ? '#1F2A3C' : '#FFFFFF', fg: st.sort === id ? '#FFFFFF' : '#3E4A5C', border: st.sort === id ? '#1F2A3C' : '#C9D6EA', pick: () => this.setState({ sort: id }) }));

    const ready = { 1: !!P, 2: !!S, 3: !!R, 4: intl ? nItems > 0 : true, 5: !!C && !st.busy };
    const sums = { 1: P ? `${P.name} · ${P.kg} kg` : '', 2: S ? `${S.company || S.name} · ${town(S)}` : '', 3: R ? `${R.name} · ${town(R)}` : '',
      4: nItems ? `${nItems} item${nItems > 1 ? 's' : ''} · ${gbp(declaredV)}` : intl ? '' : 'Optional for UK parcels', 5: C ? `${C.service} · ${gbp(C.p)}` : '' };
    const step = (n) => { const active = st.step === n, past = st.step > n;
      return { open: active, canEdit: past && !active, edit: () => this.setState({ step: n, newAddr: false, newParcel: false, newItem: false }),
        num: past ? '✓' : String(n), cBg: active || past ? '#2463DB' : '#FFFFFF', cFg: active || past ? '#FFFFFF' : '#8593A8',
        ring: active ? '0 0 0 5px #BFD6FB' : past ? 'none' : 'inset 0 0 0 2px #C9D6EA', line: past ? '#2463DB' : '#DCE4F2',
        size: active ? '24px' : '17px', tFg: active || past ? '#1F2A3C' : '#8593A8', sum: active ? '' : sums[n] }; };

    const price = C ? C.p : 0;
    const short = st.step === 5 && C && st.pay === 'wallet' && price > st.bal;
    const PM = [['wallet', 'Wallet', 'Balance ' + gbp(st.bal), 'W', '#2463DB'],
      ['card', me.has_card ? 'Saved card' : 'Card', me.demoPayments ? 'Test mode card' : 'Visa, Mastercard', 'CARD', '#1A1F71'],
      ['newcard', 'Apple Pay', me.demoPayments ? 'Test mode' : 'Pay securely with Stripe', '+', '#33AEEF']];
    const payMethods = PM.map(([id, label, note, icon, iconBg]) => { const on = st.pay === id; const low = id === 'wallet' && C && price > st.bal;
      return { label, icon, iconBg, note: low ? note + ' · not enough' : note, noteFg: low ? '#B42318' : '#586579',
        on: on ? 'true' : 'false', border: on ? '#2463DB' : '#E1E7EF', bg: on ? '#F5F9FF' : '#FFFFFF', ring: on ? '#2463DB' : '#9FB0C8', dot: on ? '#2463DB' : 'transparent',
        pick: () => this.setState({ pay: id }) }; });
    const cardBlocked = false;
    const can = ready[st.step] && !short && !cardBlocked;
    const next = () => {
      if (!can) return;
      if (st.step === 4) { this.setState({ step: 5 }); this.loadQuotes(); return; }
      if (st.step < 5) return this.setState({ step: st.step + 1, newAddr: false, newParcel: false, newItem: false });
      this.book();
    };
    const reset = () => { this.key = uid(); this.setState({ pay: 'wallet', step: 1, sender: st.sender, recip: '', items: {}, courier: '', done: null, quotes: null, newAddr: false, newParcel: false }); };

    const modes = [['uk', 'UK to UK'], ['intl', 'International']].map(([id, label]) => ({ label, on: st.mode === id ? 'true' : 'false',
      bg: st.mode === id ? '#2463DB' : 'transparent', fg: st.mode === id ? '#FFFFFF' : '#3E4A5C',
      pick: () => this.setState({ mode: id, recip: '', courier: '', quotes: null, step: Math.min(st.step, 3) }) }));

    // ---- saving new parcels / addresses / items
    const need = (pairs) => { for (const [k, label] of pairs) if (!String(field(k) || '').trim()) { toast(`Please fill in ${label}.`); return false; } return true; };
    const saveParcel = () => {
      const p = { id: uid(), name: String(field('np_name') || 'Parcel'), kg: Number(String(field('np_kg')).replace(',', '.')), l: Number(field('np_l')), w: Number(field('np_w')), h: Number(field('np_h')) };
      if (!(p.kg > 0 && p.l > 0 && p.w > 0 && p.h > 0)) { toast('Enter the weight and all three sides.'); return; }
      const mine = [p, ...store.get('kg_parcels', [])].slice(0, 20);
      store.set('kg_parcels', mine);
      this.setState({ parcels: [p, ...st.parcels.filter((x) => x.id !== p.id)], parcel: p.id, newParcel: false, quotes: null });
    };
    const lookup = (px) => {
      const L = st.lk[px];
      const set = (patch) => this.setState({ lk: { ...this.state.lk, [px]: { ...this.state.lk[px], ...patch } } });
      const find = async () => {
        const pc = String(field(`${px}_find`) || '').trim();
        if (!pc) { set({ msg: 'Type a postcode first.', bad: true }); return; }
        set({ busy: true, msg: 'Looking up addresses…', bad: false, items: [] });
        try {
          const r = await api(`/api/address/lookup?postcode=${encodeURIComponent(pc)}`);
          setField(`${px}_postcode`, r.postcode);
          if (r.town) setField(`${px}_city`, r.town);
          if (r.addresses.length) set({ busy: false, items: r.addresses, msg: '', bad: false });
          else if (r.suggestions?.length) set({ busy: false, items: [], msg: `Postcode not found. Did you mean ${r.suggestions.slice(0, 3).join(', ')}?`, bad: true });
          else if (!r.fullList && r.town) set({ busy: false, items: [], msg: `Postcode found in ${r.town}. Type the street address below.`, bad: false });
          else set({ busy: false, items: [], msg: 'We could not find that postcode. Check it, or type the address below.', bad: true });
        } catch (e) { set({ busy: false, msg: e.message, bad: true }); }
      };
      return {
        key: (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } },
        find, btn: L.busy ? 'Searching…' : 'Find address', has: L.items.length > 0,
        count: `${L.items.length} address${L.items.length === 1 ? '' : 'es'} found: choose one`,
        items: L.items.map((a, i) => ({ i: String(i), label: a.label })),
        msg: L.msg || (L.items.length ? '' : 'Or type the address in the boxes below.'), msgFg: L.bad ? '#B42318' : '#586579',
        pick: (e) => {
          const a = L.items[Number(e.target.value)];
          if (!a || e.target.value === '') return;
          setField(`${px}_line1`, a.line1); setField(`${px}_line2`, a.line2); setField(`${px}_city`, a.city); setField(`${px}_postcode`, a.postcode);
          if (a.company && !String(field(`${px}_name`) || '').trim()) setField(`${px}_name`, a.company);
        },
      };
    };
    const saveSender = () => {
      if (!need([['sa_name', 'the name'], ['sa_line1', 'the address'], ['sa_city', 'the town'], ['sa_postcode', 'the postcode']])) return;
      const a = { name: field('sa_name'), phone: field('sa_phone'), line1: field('sa_line1'), line2: field('sa_line2'), city: field('sa_city'), postcode: String(field('sa_postcode')).toUpperCase(), country: 'GB' };
      const mine = [a, ...st.mySenders.filter((x) => addrKey(x) !== addrKey(a))].slice(0, 30);
      store.set('kg_senders', mine);
      this.setState({ mySenders: mine, sender: addrKey(a), newAddr: false, quotes: null });
    };
    /** Photo or screenshot of an address: read it on the server and fill the boxes. */
    const photo = (px) => {
      const P = st.ph[px];
      const set = (patch) => this.setState({ ph: { ...this.state.ph, [px]: { ...this.state.ph[px], ...patch } } });
      return {
        busy: P.busy, msg: P.msg, msgFg: P.bad ? '#B42318' : '#166534', btn: P.busy ? 'Reading the address…' : 'Fill from a photo',
        locBtn: P.locating ? 'Finding you…' : 'Use my location',
        locate: async () => {
          if (P.locating) return;
          set({ locating: true, msg: '', bad: false });
          try {
            const r = await postcodeHere();
            set({ locating: false, msg: `You are near ${r.postcode}. Choose your address from the list.`, bad: false });
            setField(`${px}_find`, r.postcode); lookup(px).find();
          } catch (err) { set({ locating: false, msg: err.message, bad: true }); }
        },
        pasteOpen: Boolean(P.paste),
        togglePaste: async () => {
          if (P.paste) { set({ paste: false }); return; }
          set({ paste: true, msg: '', bad: false });
          const t = await clipboardText();
          if (t) setTimeout(() => setField(`${px}_paste`, t), 0);
        },
        fillText: async () => {
          const text = String(field(`${px}_paste`) || '').trim();
          if (!text) { set({ msg: 'Paste the address in the box first.', bad: true }); return; }
          set({ busy: true, msg: '', bad: false });
          try {
            const r = await api('/api/address/from-text', { method: 'POST', body: { text } });
            if (!r.found) { set({ busy: false, msg: 'We could not find an address in that text. Check it, or type it below.', bad: true }); return; }
            apply(r.address, 'text', true);
          } catch (err) { set({ busy: false, msg: err.message, bad: true }); }
        },
        pick: async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          set({ busy: true, msg: '', bad: false });
          try {
            const image = await shrinkPhoto(file);
            const r = await api('/api/address/from-image', { method: 'POST', body: { image } });
            if (!r.found) { set({ busy: false, msg: 'We could not read an address in that image. Try a closer photo, or type it below.', bad: true }); return; }
            apply(r.address, 'photo', false);
          } catch (err) { set({ busy: false, msg: err.message, bad: true }); }
        },
      };
      // fill only what was read, never wipe what the customer already typed
      function apply(a, from, closePaste) {
        const put = (k, v) => { if (v) setField(k, v); };
        put(`${px}_name`, px === 'sa' ? (a.company || a.name) : (a.name || a.company));
        put(`${px}_phone`, a.phone);
        if (px === 'ra') put('ra_email', a.email);
        put(`${px}_line1`, a.line1); put(`${px}_line2`, a.line2); put(`${px}_city`, a.city); put(`${px}_postcode`, a.postcode);
        if (px === 'ra' && intl && a.country && a.country !== 'GB') {
          const sel = document.querySelector('[aria-label="ra_country"]');
          if (sel && [...sel.options].some((o) => o.value === a.country)) setField('ra_country', a.country);
        }
        const got = ['name', 'phone', 'line1', 'city', 'postcode'].filter((k) => a[k] || (k === 'name' && a.company)).length;
        const ukMismatch = px === 'ra' && !intl && a.country && a.country !== 'GB';
        set({ busy: false, bad: Boolean(ukMismatch), ...(closePaste ? { paste: false } : {}), msg: ukMismatch ? 'This looks like an address outside the UK. Switch to International at the top to send there.'
          : got >= 4 ? `Filled in from your ${from}. Please check the details.` : 'We filled in what we could read. Please complete the rest.' });
        // UK: show the exact addresses at that postcode so a small reading error is easy to fix
        if (a.country === 'GB' && a.postcode && document.querySelector(`[aria-label="${px}_find"]`)) { setField(`${px}_find`, a.postcode); lookup(px).find(); }
      }
    };
    const saveRecip = () => {
      if (!need([['ra_name', 'the name'], ['ra_line1', 'the address'], ['ra_city', 'the town'], ['ra_postcode', 'the postcode']])) return;
      const a = { name: field('ra_name'), phone: field('ra_phone'), email: field('ra_email'), line1: field('ra_line1'), line2: field('ra_line2'), city: field('ra_city'),
        postcode: String(field('ra_postcode')).toUpperCase(), country: intl ? (field('ra_country') || 'US') : 'GB' };
      const mine = [a, ...st.myRecips.filter((x) => addrKey(x) !== addrKey(a))].slice(0, 50);
      store.set('kg_recips', mine);
      this.setState({ myRecips: mine, recip: addrKey(a), newAddr: false, quotes: null });
    };
    const saveItem = () => {
      const value = Number(String(field('ni_value')).replace(',', '.'));
      if (!String(field('ni_name')).trim() || !(value >= 0)) { toast('Enter what it is and its value.'); return; }
      const it = { id: uid(), name: String(field('ni_name')).trim(), value, hs: String(field('ni_hs') || '').trim(), origin: field('ni_origin') || 'GB' };
      const mine = [it, ...st.savedItems].slice(0, 100);
      store.set('kg_items', mine);
      this.setState({ savedItems: mine, items: { ...st.items, [it.id]: 1 }, newItem: false, quotes: null });
    };

    const D = st.done;
    const doneTo = D ? JSON.parse(D.shipment.to_json) : null;
    return {
      signOut: async () => { try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* already out */ } location.href = '/'; },
      nav: NAV.map(([, label, href]) => ({ label, href })),
      modes, intl, flow: !D, done: !!D,
      s1: step(1), s2: step(2), s3: step(3), s4: step(4), s5: step(5),
      parcels, senders, recips, items, quotes, sorts,
      qLoading: st.quotes === null && st.step === 5,
      loadTitle: ['Comparing live prices…', 'Still checking couriers…', 'Nearly there…'][st.qSlow || 0],
      loadTxt: ['Asking Royal Mail, Evri, DPD, InPost and more for this parcel.', 'Some couriers take a few seconds to answer. Hang on.', 'The slowest courier is still answering. Your prices are almost ready.'][st.qSlow || 0],
      quoteHead: st.quotes === null ? 'Finding the best prices for your parcel…' : st.quoteError ? 'No services could quote. ' + st.quoteError : `${Q.length} services compared for your parcel. Prices include VAT.`,
      quoteCount: st.quotes === null ? 'Comparing' : st.quoteError ? 'No' : Q.length,
      newParcel: st.newParcel, toggleNewParcel: () => this.setState({ newParcel: !st.newParcel }), saveParcel,
      lk: { sa: lookup('sa'), ra: lookup('ra') }, ph: { sa: photo('sa'), ra: photo('ra') }, ukRecip: !intl,
      newAddr: st.newAddr, toggleNewAddr: () => this.setState({ newAddr: !st.newAddr }), saveSender, saveRecip,
      newItem: st.newItem, toggleNewItem: () => this.setState({ newItem: !st.newItem }), saveItem,
      itemsNote: st.savedItems.length ? `${st.savedItems.length} saved item${st.savedItems.length > 1 ? 's' : ''}` : 'Add your first item with New item',
      countries: COUNTRIES.filter(([c]) => c !== 'GB' || !intl).map(([code, name]) => ({ code, name })),
      postLabel: intl ? 'ZIP / postcode' : 'Postcode', postPh: intl ? 'e.g. 10118' : 'e.g. LS1 5HD',
      customsHint: intl ? ' and the customs form' : '', declared: gbp(declaredV),
      balTxt: gbp(st.bal), afterTxt: C ? gbp(st.bal - price) : '–', afterFg: short ? '#B42318' : '#1F2A3C', short,
      modeLabel: intl ? 'International' : 'UK to UK',
      barParcel: P ? P.kg + ' kg' : '– kg', barFrom: S ? town(S) : '–', barTo: R ? town(R) : '–', barCourier: C ? C.carrier : '–',
      canBack: st.step > 1, back: () => this.setState({ step: st.step - 1, newAddr: false, newParcel: false, newItem: false }),
      next, nextDisabled: can ? 'false' : 'true', nextBg: can ? '#2463DB' : '#3B4A63', nextFg: can ? '#FFFFFF' : '#8593A8', nextCursor: can ? 'pointer' : 'not-allowed',
      nextLabel: st.busy ? 'Booking…' : st.step < 4 ? 'Continue' : st.step === 4 ? 'Compare prices' : (C ? 'Book and pay ' + gbp(price) : st.quotes === null ? 'Comparing couriers…' : 'Choose a courier'),
      priceTxt: D ? gbp(D.shipment.price_pence) : '', again: reset, payMethods,
      paidLabel: D ? (D.shipment.pay_method === 'wallet' ? 'Paid from wallet' : 'Paid by card') : '',
      doneLine: D ? (D.shipment.status === 'awaiting_label' ? `Paid. ${D.shipment.service_name} to ${doneTo.name}, ${town(doneTo)}. The courier issues this label shortly, usually within an hour: it appears here and under Shipments by itself${st.me?.notify?.email || st.me?.notify?.sms || st.me?.notify?.whatsapp ? `, and we send it to you ${[st.me.notify.email && 'by email', st.me.notify.sms && 'by SMS', st.me.notify.whatsapp && 'on WhatsApp'].filter(Boolean).join(' and ')}` : ''}.` : `${D.shipment.service_name} to ${doneTo.name}, ${town(doneTo)}. Print the label and ${D.quote.dropOff ? 'drop it off at the shop or locker.' : 'have the parcel ready for collection.'}`) : '',
      doneRef: D ? D.shipment.ref : '', doneTracking: D ? (D.shipment.tracking_number || '') : '',
      labelUrl: D?.shipment.label_url || '#', trackUrl: D?.shipment.tracking_number ? `https://kargoradari.com/?q=${encodeURIComponent(D.shipment.tracking_number)}` : '#',
      meName: me.name, meIni: (me.name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(), meType: me.account_type === 'business' ? 'Business account' : 'Personal account',
    };
  }
}

mount(Component, document.getElementById('tpl').textContent, document.getElementById('root'));
