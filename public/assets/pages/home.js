import { DCLogic, mount, field, api } from '../dc.js';

const UK_AREAS = ['United Kingdom', 'Northern Ireland', 'Channel Islands', 'Scottish Highlands & Islands'];
const COUNTRIES = ['United States', 'Germany', 'France', 'Ireland', 'Netherlands', 'Spain', 'Italy', 'Australia', 'Canada', 'Turkey'];
const LOGOS = { 'Royal Mail': 'royalmail', Evri: 'evri', DPD: 'dpd', InPost: 'inpost', UPS: 'ups', DHL: 'dhl', FedEx: 'fedex', Parcelforce: 'parcelforce', Yodel: 'yodel' };

function toast(text) {
  const t = document.createElement('div');
  t.className = 'kg-toast';
  t.setAttribute('role', 'status');
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

class Component extends DCLogic {
  constructor(p) { super(p); this.state = { mode: 'uk', dims: false, video: false, me: null }; }
  mounted() {
    api('/api/me').then((me) => this.setState({ me })).catch(() => {});
    api('/api/guest/config').then((c) => this.setState({ vid: c.homeVideo || null })).catch(() => {});
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.state.video) this.setState({ video: false }); });
  }

  getQuotes(e) {
    const st = this.state;
    if (st.mode !== 'uk' && st.mode !== 'intl') return;
    e.preventDefault();
    const kg = Number(String(field('Parcel weight')).replace(',', '.'));
    if (!(kg > 0 && kg <= 70)) { toast('Enter the parcel weight in kg (up to 70 kg).'); return; }
    const q = new URLSearchParams({
      mode: st.mode,
      from: st.mode === 'uk' ? field('Collect from') : 'United Kingdom',
      to: field('Delivering to'),
      kg: String(kg),
    });
    if (st.dims) {
      const l = Number(field('Length (cm)')), w = Number(field('Width (cm)')), h = Number(field('Height (cm)'));
      if (l > 0 && w > 0 && h > 0) { q.set('l', String(l)); q.set('w', String(w)); q.set('h', String(h)); }
    }
    location.href = `/quotes?${q}`;
  }

  renderVals() {
    const st = this.state;
    const MODES = [['uk', 'UK to UK'], ['intl', 'International'], ['pallet', 'Pallets'], ['track', 'Tracking']];
    const modes = MODES.map(([id, label], i) => ({ label, on: st.mode === id ? 'true' : 'false',
      bg: st.mode === id ? '#FFFFFF' : '#1F2A3C', fg: st.mode === id ? '#1F2A3C' : '#FFFFFF',
      radius: i === 0 ? '6px 0 0 0' : i === MODES.length - 1 ? '0 6px 0 0' : '0',
      pick: () => this.setState({ mode: id, dims: false }) }));
    const b = { isSelect: false, isLocked: false, isInput: false, isRadio: false, options: [], value: '', placeholder: '', unit: '', mode: 'text', flex: '1 1 170px', bg: '#FFFFFF' };
    const weight = { ...b, label: 'Parcel weight', isInput: true, placeholder: 'e.g. 1', unit: 'kg', mode: 'decimal', flex: '1 1 140px' };
    const dims = { ...b, label: 'I will fill in dimensions', isRadio: true, flex: '1 1 170px' };
    const F = {
      uk: [{ ...b, label: 'Collect from', isSelect: true, options: UK_AREAS }, { ...b, label: 'Delivering to', isSelect: true, options: UK_AREAS }, weight, dims],
      intl: [{ ...b, label: 'Collect from', isLocked: true, value: 'United Kingdom', flex: '1 1 170px', bg: '#F7F9FC' }, { ...b, label: 'Delivering to', isSelect: true, options: COUNTRIES }, weight, dims],
      pallet: [{ ...b, label: 'Collection postcode', isInput: true, placeholder: 'e.g. M1 1AE' }, { ...b, label: 'Delivery postcode', isInput: true, placeholder: 'e.g. B1 1AA' },
        { ...b, label: 'Number of pallets', isInput: true, placeholder: 'e.g. 1', mode: 'numeric', flex: '1 1 140px' }],
      track: [{ ...b, label: 'Tracking number', isInput: true, placeholder: 'Enter your tracking number', flex: '999 1 400px' }],
    };
    const CTA = { uk: ['Get quotes', '/quotes'], intl: ['Get quotes', '/quotes'], pallet: ['Get a pallet quote', '/app?view=help'], track: ['Track', 'https://kargoradari.com'] };
    const LINKS = { uk: ['Need same-day delivery?', 'Parcel larger than 1m?', 'Send multiple parcels'], intl: ['Customs and duties explained', 'Sending to Turkey'], pallet: ['Pallet sizes guide'], track: ['Where is my tracking number?'] };
    const couriers = [['Royal Mail', 'Tracked 24 / 48'], ['Evri', 'Drop-off & collection'], ['DPD', 'Next day, 1-hour window'], ['InPost', '24/7 lockers'],
      ['Yodel', 'Drop-off'], ['Parcelforce', 'Heavy parcels'], ['UPS', 'UK & worldwide'], ['DHL', 'UK & worldwide'], ['FedEx', 'Worldwide express']]
      .map(([name, note]) => ({ name, note, logo: LOGOS[name] ? `/assets/carriers/${LOGOS[name]}.png` : '', hasLogo: !!LOGOS[name], noLogo: !LOGOS[name] }));
    const steps = [
      { n: '1', t: 'Compare quotes', d: 'Enter the weight, see every courier and service side by side, sorted by price or speed.' },
      { n: '2', t: 'Book and print', d: 'Pay securely, then print your label at home or show a QR code at the drop-off point.' },
      { n: '3', t: 'Drop off or get collected', d: 'Hand it to a local shop or locker, or book a collection from your door, and track it to delivery.' },
    ];
    const isParcel = st.mode === 'uk' || st.mode === 'intl';
    const me = st.me;
    return {
      modes, fields: F[st.mode], cta: { label: CTA[st.mode][0], href: CTA[st.mode][1], go: (e) => this.getQuotes(e) }, links: LINKS[st.mode],
      showDims: isParcel && st.dims, laterOn: !st.dims, nowOn: st.dims,
      dimsLater: () => this.setState({ dims: false }), dimsNow: () => this.setState({ dims: true }),
      video: st.video, vidYt: st.vid?.kind === 'youtube', vidFile: st.vid?.kind === 'file', vidNone: !st.vid, vidSrc: st.vid?.src || '', openVideo: () => this.setState({ video: true }), closeVideo: () => this.setState({ video: false }),
      couriers, steps,
      nav1: me ? { href: me.role === 'admin' ? '/admin' : '/app', label: me.role === 'admin' ? 'Admin' : 'My account' } : { href: '/login?mode=register', label: 'Sign up' },
      nav2: me ? { href: '/app', label: me.name.split(' ')[0] } : { href: '/login', label: 'Log in' },
    };
  }
}

mount(Component, document.getElementById('tpl').textContent, document.getElementById('root'));
