import { DCLogic, mount, field, api } from '../dc.js';

import { OPTIONS, SEP, isUk, place } from '../countries.js';

/** Country list for a <select>: the UK first, a gap, then the world. `sel` is pre-selected. */
const countryOpts = (sel = 'United Kingdom') => OPTIONS.map((t) => ({ t, sep: t === SEP, sel: t === sel }));
/** Freight 'Load' choices; the first (a 40 ft container) is selected by default. */
const LOADS = { 'Container 40 ft': ['container', 'container40'], 'Container 20 ft': ['container', 'container20'], Pallets: ['pallets'], Boxes: ['boxes'] };
const SHOP_IN = ['United States', 'United Kingdom', 'China', 'Germany', 'Italy', 'France', 'Japan', 'Turkey'];
const LOGOS = { 'Royal Mail': 'royalmail', Evri: 'evri', DPD: 'dpd', InPost: 'inpost', UPS: 'ups', DHL: 'dhl', FedEx: 'fedex', Parcelforce: 'parcelforce', Yodel: 'yodel' };

function toast(text) {
  const t = document.createElement('div');
  t.className = 'kg-toast';
  t.setAttribute('role', 'status');
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

const HOME_SIZE = { 'Studio flat': 'studio', '1 bedroom': '1', '2 bedrooms': '2', '3 bedrooms': '3', '4 bedrooms': '4', '5+ bedrooms': '5' };

class Component extends DCLogic {
  constructor(p) { super(p); this.state = { mode: 'uk', dims: false, video: false, me: null }; }
  mounted() {
    api('/api/me').then((me) => this.setState({ me })).catch(() => {});
    api('/api/guest/config').then((c) => this.setState({ vid: c.homeVideo || null, chat: Boolean(c.chat) })).catch(() => {});
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.state.video) this.setState({ video: false }); });
    // Close the video window by itself when the video finishes ('ended' does not bubble, so listen in the capture phase).
    document.addEventListener('ended', (e) => { if (e.target instanceof HTMLVideoElement && e.target.closest('[aria-label="Kargom video"]')) this.setState({ video: false }); }, true);
  }

  /** "Locate": phone position → nearest postcode in the box. */
  async locate(label) {
    if (this.state.locBusy) return;
    this.setState({ locBusy: true });
    try {
      const { postcodeHere } = await import('../here.js');
      const r = await postcodeHere();
      const el = document.querySelector(`[aria-label="${label}"]`);
      if (el) { el.value = r.postcode; el.dataset.dirty = '1'; }
      toast(`You are near ${r.postcode}.`);
    } catch (err) { toast(err.message); }
    this.setState({ locBusy: false });
  }

  getQuotes(e) {
    const st = this.state;
    if (st.mode === 'track') {
      e.preventDefault();
      const n = String(field('Tracking number') ?? '').trim();
      location.href = n ? `/track?n=${encodeURIComponent(n)}` : '/track';
      return;
    }
    if (st.mode === 'move') {
      e.preventDefault();
      const q = new URLSearchParams({ type: 'removals' });
      const a = String(field('Moving from (postcode)') ?? '').trim(), b = String(field('Moving to (postcode)') ?? '').trim();
      if (a) q.set('from', a); if (b) q.set('to', b);
      const size = HOME_SIZE[field('Home size')]; if (size) q.set('size', size);
      if (!a) { toast('Enter the postcode you are moving from.'); return; }
      // Visitors first see the companies near them; members go straight to the quote form.
      location.href = st.me ? `/app/quote?${q}` : `/movers?${q}`;
      return;
    }
    if (st.mode === 'fwd') {
      e.preventDefault();
      const from = place(field('Shop in'))?.code || 'US', to = place(field('Deliver to'))?.code || 'GB';
      const kg = Number(String(field('Weight') || '').replace(',', '.'));
      const q = new URLSearchParams({ from, to });
      if (kg > 0) q.set('kg', String(kg));
      location.href = `/forwarding?${q}`;
      return;
    }
    if (st.mode === 'freight') {
      e.preventDefault();
      const [load, box] = LOADS[field('Load')] || LOADS['Container 40 ft'];
      const q = new URLSearchParams({ from: field('Shipping from'), to: field('Shipping to'), load, ...(box && { box }) });
      location.href = `/freight?${q}`;
      return;
    }
    if (st.mode !== 'uk') return;
    e.preventDefault();
    const from = field('Collect from'), to = field('Delivering to');
    const kg = Number(String(field('Parcel weight')).replace(',', '.'));
    const dims = st.dims ? [Number(field('Length (cm)')), Number(field('Width (cm)')), Number(field('Height (cm)'))] : [];
    // Parcels are collected in the UK. From abroad (e.g. stock from China) the freight page prices it.
    if (!isUk(from)) {
      const q = new URLSearchParams({ from, to, load: 'boxes', qty: field('Parcels') || '1' });
      if (kg > 0) q.set('kg', String(kg));
      if (dims.length && dims.every((x) => x > 0)) { q.set('l', String(dims[0])); q.set('w', String(dims[1])); q.set('h', String(dims[2])); }
      location.href = `/freight?${q}`;
      return;
    }
    if (!(kg > 0 && kg <= 70)) { toast('Enter the parcel weight in kg (up to 70 kg).'); return; }
    const q = new URLSearchParams({ mode: isUk(to) ? 'uk' : 'intl', from, to, kg: String(kg) });
    if (dims.length && dims.every((x) => x > 0)) { q.set('l', String(dims[0])); q.set('w', String(dims[1])); q.set('h', String(dims[2])); }
    location.href = `/quotes?${q}`;
  }

  renderVals() {
    const st = this.state;
    const MODES = [['uk', 'Parcel'], ['freight', 'Freight'], ['move', 'Removals'], ['fwd', 'Forwarding']];
    const modes = MODES.map(([id, label], i) => ({ label, on: st.mode === id ? 'true' : 'false',
      bg: st.mode === id ? '#FFFFFF' : '#1F2A3C', fg: st.mode === id ? '#1F2A3C' : '#FFFFFF',
      radius: i === 0 ? '6px 0 0 0' : i === MODES.length - 1 ? '0 6px 0 0' : '0',
      pick: () => this.setState({ mode: id, dims: false }) }));
    const b = { isSelect: false, isLocked: false, isInput: false, isRadio: false, loc: false, locate: () => {}, locTxt: '', options: [], value: '', placeholder: '', unit: '', mode: 'text', flex: '1 1 170px', bg: '#FFFFFF' };
    const here = { loc: true, locTxt: st.locBusy ? '…' : 'Locate', locate: () => this.locate('Moving from (postcode)') };
    const weight = { ...b, label: 'Parcel weight', isInput: true, placeholder: 'e.g. 1', unit: 'kg', mode: 'decimal', flex: '1 1 140px' };
    const dims = { ...b, label: 'I will fill in dimensions', isRadio: true, flex: '1 1 170px' };
    const F = {
      uk: [{ ...b, label: 'Collect from', isSelect: true, options: countryOpts() }, { ...b, label: 'Delivering to', isSelect: true, options: countryOpts() }, weight, dims],
      freight: [{ ...b, label: 'Shipping from', isSelect: true, options: countryOpts('China') }, { ...b, label: 'Shipping to', isSelect: true, options: countryOpts() },
        { ...b, label: 'Load', isSelect: true, options: Object.keys(LOADS).map((t, i) => ({ t, sep: false, sel: i === 0 })), flex: '1 1 150px' }],
      move: [{ ...b, ...here, label: 'Moving from (postcode)', isInput: true, placeholder: 'e.g. M1 1AE' }, { ...b, label: 'Moving to (postcode)', isInput: true, placeholder: 'e.g. LS1 5HD' },
        { ...b, label: 'Home size', isSelect: true, options: Object.keys(HOME_SIZE).map((t) => ({ t, sep: false, sel: false })), flex: '1 1 150px' }],
      track: [{ ...b, label: 'Tracking number', isInput: true, placeholder: 'Enter your tracking number', flex: '999 1 400px' }],
      fwd: [{ ...b, label: 'Shop in', isSelect: true, options: SHOP_IN.map((t) => ({ t, sep: false, sel: false })) }, { ...b, label: 'Deliver to', isSelect: true, options: countryOpts() },
        { ...b, label: 'Weight', isInput: true, placeholder: 'e.g. 2', unit: 'kg', mode: 'decimal', flex: '1 1 120px' }],
    };
    const CTA = { uk: ['Get quotes', '/quotes'], freight: ['Compare rates', '/freight'], move: ['Get moving quotes', '/app/quote?type=removals'], track: ['Track', '/track'], fwd: ['See prices', '/forwarding'] };
    const L = (t, href) => ({ t, href });
    const LINKS = {
      uk: [L('Cheapest way to send a parcel', '/guides/cheapest-way-to-send-a-parcel-uk'), L('Volumetric weight calculator', '/tools/volumetric-weight-calculator'), L('UK prices by weight', '/parcel-prices'), L('Track a parcel', '/track')],
      freight: [L('China to Amazon FBA UK', '/freight?from=China&to=United+Kingdom&toType=amazon'), L('UK to Amazon USA', '/freight?from=United+Kingdom&to=United+States&toType=amazon'), L('Road freight: FTL / LTL', '/app/quote?type=freight'), L('Freight company? Join as a partner', '/partner')],
      move: [L('Removal company? Join as a partner', '/partner')],
      fwd: [L('Shop in Turkey, deliver to the UK', '/forwarding?from=TR&to=GB'), L('How parcel forwarding works', '/forwarding'), L('Shop in the USA, deliver to the UK', '/forwarding?from=US&to=GB'), L('Track a parcel', '/track')],
      track: [L('Where is my tracking number?', '/track'), L('Royal Mail tracking', '/track/royal-mail'), L('Evri tracking', '/track/evri')],
    };
    const SLUG = { 'Royal Mail': 'royal-mail', Evri: 'evri', DPD: 'dpd', InPost: 'inpost', Yodel: 'yodel', Parcelforce: 'parcelforce', UPS: 'ups', DHL: 'dhl', FedEx: 'fedex' };
    const couriers = [['Royal Mail', 'Tracked 24 / 48'], ['Evri', 'Drop-off & collection'], ['DPD', 'Next day, 1-hour window'], ['InPost', '24/7 lockers'],
      ['Yodel', 'Drop-off'], ['Parcelforce', 'Heavy parcels'], ['UPS', 'UK & worldwide'], ['DHL', 'UK & worldwide'], ['FedEx', 'Worldwide express']]
      .map(([name, note]) => ({ name, note, href: `/couriers/${SLUG[name]}`, logo: LOGOS[name] ? `/assets/carriers/${LOGOS[name]}.png` : '', hasLogo: !!LOGOS[name], noLogo: !LOGOS[name] }));
    const steps = [
      { n: '1', t: 'Compare quotes', d: 'Enter the weight, see every courier and service side by side, sorted by price or speed.' },
      { n: '2', t: 'Book and print', d: 'Pay securely, then print your label at home or show a QR code at the drop-off point.' },
      { n: '3', t: 'Drop off or get collected', d: 'Hand it to a local shop or locker, or book a collection from your door, and track it to delivery.' },
    ];
    const isParcel = st.mode === 'uk';
    const me = st.me;
    return {
      modes, fields: F[st.mode], cta: { label: CTA[st.mode][0], href: CTA[st.mode][1], go: (e) => this.getQuotes(e) }, links: LINKS[st.mode],
      showDims: isParcel && st.dims, laterOn: !st.dims, nowOn: st.dims,
      dimsLater: () => this.setState({ dims: false }), dimsNow: () => this.setState({ dims: true }),
      video: st.video, vidYt: st.vid?.kind === 'youtube', vidFile: st.vid?.kind === 'file', vidNone: !st.vid, hasVid: Boolean(st.vid), vidSrc: st.vid?.src || '', openVideo: () => this.setState({ video: true }), chatOn: Boolean(st.chat), noChat: !st.chat, openChat: () => import('../chat.js').then((m) => m.openChat()), closeVideo: () => this.setState({ video: false }),
      couriers, steps,
      nav1: me ? { href: me.role === 'admin' ? '/admin' : '/app', label: me.role === 'admin' ? 'Admin' : 'My account' } : { href: '/login?mode=register', label: 'Sign up' },
      nav2: me ? { href: '/app', label: me.name.split(' ')[0] } : { href: '/login', label: 'Log in' },
    };
  }
}

mount(Component, document.getElementById('tpl').textContent, document.getElementById('root'));
