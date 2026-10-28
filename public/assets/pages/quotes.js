import { DCLogic, mount, api, SAMPLE_POSTCODE, CARRIER_LOGO, CARRIER_NAME } from '../dc.js';

const params = new URLSearchParams(location.search);
const from = params.get('from') || 'United Kingdom';
const to = params.get('to') || 'United Kingdom';
const kg = Number(params.get('kg')) || 1;
const dims = [Number(params.get('l')) || 30, Number(params.get('w')) || 20, Number(params.get('h')) || 15];

/** The homepage only knows areas and countries, so we price with a typical postcode for each. */
function request() {
  const [fc, fp] = SAMPLE_POSTCODE[from] || ['GB', 'M1 1AE'];
  const [tc, tp] = SAMPLE_POSTCODE[to] || ['GB', 'LS1 5HD'];
  const req = {
    from: { name: 'Quote', line1: 'Quote', city: 'Quote', postcode: fp === tp ? 'EC1A 1BB' : fp, country: fc === 'JE' ? 'GB' : fc },
    to: { name: 'Quote', line1: 'Quote', city: 'Quote', postcode: tp, country: tc === 'JE' ? 'GB' : tc },
    parcel: { weightGrams: Math.round(kg * 1000), lengthCm: dims[0], widthCm: dims[1], heightCm: dims[2] },
  };
  if (req.to.country !== 'GB') req.customs = { contents: 'merchandise', items: [{ description: 'Goods', quantity: 1, valuePence: 2000, originCountry: 'GB' }] };
  return req;
}

const T = { drop: 'Drop-off at a shop', coll: 'Collected from your door', locker: 'Drop-off at a locker' };

class Component extends DCLogic {
  constructor(p) { super(p); this.state = { sort: 'cheap', speed: 'all', toff: {}, coff: {}, data: null, error: '', filters: false, slow: 0 }; }
  async mounted() {
    // Reassure while couriers answer: the message changes if it takes a while.
    const t1 = setTimeout(() => this.state.data === null && this.setState({ slow: 1 }), 3500);
    const t2 = setTimeout(() => this.state.data === null && this.setState({ slow: 2 }), 8000);
    this.stopTimers = () => { clearTimeout(t1); clearTimeout(t2); };
    api('/api/me').then(() => { this.signedIn = true; }, () => { this.signedIn = false; });
    try {
      const { quotes } = await api('/api/quotes/preview', { method: 'POST', body: request() });
      this.setState({ data: quotes.map((q) => ({
        c: CARRIER_NAME[q.carrier] || q.carrierName, carrier: q.carrier, s: q.serviceName,
        t: q.carrier === 'inpost' ? 'locker' : q.dropOff ? 'drop' : 'coll',
        d: q.transitDays ? [q.transitDays, q.transitDays] : [2, 4],
        v: q.price / 100, ex: q.priceExVat / 100, q,
      })) });
    } catch (e) {
      this.setState({ data: [], error: e.message });
    }
  }
  book(r, e) {
    e.preventDefault();
    const req = request();
    // Not signed in and UK to UK: buy straight away as a guest, no account needed.
    if (!this.signedIn && req.from.country === 'GB' && req.to.country === 'GB') {
      const q = r.q;
      sessionStorage.setItem('kg_guest', JSON.stringify({ carrier: q.carrier, carrierName: q.carrierName, serviceCode: q.serviceCode, serviceName: q.serviceName,
        price: q.price, priceExVat: q.priceExVat, transitDays: q.transitDays, type: r.t, parcel: req.parcel, backUrl: location.pathname + location.search }));
      location.href = '/checkout';
      return;
    }
    sessionStorage.setItem('kg_pending', JSON.stringify({ parcel: req.parcel, toCountry: req.to.country, serviceName: r.s, carrier: r.carrier }));
    location.href = '/app/send';
  }
  renderVals() {
    const st = this.state;
    const DATA = st.data || [];
    const gbp = (v) => '£' + v.toFixed(2);
    const etaTxt = (d) => (d[0] === d[1] ? (d[0] === 1 ? 'Next working day' : d[0] + ' working days') : d[0] + '–' + d[1] + ' working days');
    let rows = DATA.filter((r) => !st.toff[r.t] && !st.coff[r.c]);
    if (st.speed === 'next') rows = rows.filter((r) => r.d[1] === 1);
    if (st.speed === '2') rows = rows.filter((r) => r.d[1] <= 2);
    const score = (r) => r.v + r.d[1] * 0.9 + (r.t === 'coll' ? -0.6 : 0);
    const cheapest = rows.slice().sort((a, b) => a.v - b.v)[0];
    const fastest = rows.slice().sort((a, b) => a.d[1] - b.d[1] || a.v - b.v)[0];
    const recommended = rows.slice().sort((a, b) => score(a) - score(b))[0];
    const ord = { cheap: (a, b) => a.v - b.v, fast: (a, b) => a.d[1] - b.d[1] || a.v - b.v, rec: (a, b) => score(a) - score(b) };
    rows.sort(ord[st.sort]);
    const sorts = [['cheap', 'Cheapest', cheapest], ['fast', 'Fastest', fastest], ['rec', 'Recommended', recommended]].map(([id, label, r]) => ({
      label, on: st.sort === id ? 'true' : 'false', bg: st.sort === id ? '#FFFFFF' : '#F8FAFD', bar: st.sort === id ? '#2463DB' : 'transparent',
      price: r ? gbp(r.v) : '—', sub: r ? r.s + ' · ' + etaTxt(r.d) : '', pick: () => this.setState({ sort: id }) }));
    const results = rows.map((r) => {
      const badge = r === cheapest ? 'Cheapest' : r === fastest ? 'Fastest' : r === recommended ? 'Recommended' : '';
      const logo = CARRIER_LOGO[r.carrier];
      return { logo: logo || '', hasLogo: !!logo, noLogo: !logo, courier: r.c, service: r.s, typeLabel: T[r.t], eta: etaTxt(r.d), cover: 'Standard cover', tracked: true,
        price: gbp(r.v), exVat: gbp(r.ex), hasBadge: !!badge, badge, book: (e) => this.book(r, e) };
    });
    const present = Object.keys(T).filter((k) => DATA.some((r) => r.t === k));
    const typeFilters = present.map((k) => ({ label: { drop: 'Drop-off', coll: 'Collection', locker: 'Locker' }[k], on: !st.toff[k],
      min: gbp(Math.min(...DATA.filter((r) => r.t === k).map((r) => r.v))), toggle: () => this.setState({ toff: { ...st.toff, [k]: !st.toff[k] } }) }));
    const speedFilters = [['all', 'Any speed'], ['2', 'Within 2 days'], ['next', 'Next working day']].map(([id, label]) => ({ label, on: st.speed === id, pick: () => this.setState({ speed: id }) }));
    const names = [...new Set(DATA.map((r) => r.c))];
    const courierFilters = names.map((n) => ({ name: n, on: !st.coff[n], toggle: () => this.setState({ coff: { ...st.coff, [n]: !st.coff[n] } }) }));
    const loading = st.data === null;
    return {
      filtersOpen: st.filters ? 'true' : 'false', filterBtn: st.filters ? 'Hide filters' : 'Filter results', toggleFilters: () => this.setState({ filters: !st.filters }),
      sorts, results, typeFilters, speedFilters, courierFilters,
      count: loading ? 'Finding' : results.length, loading, loaded: !loading,
      headTxt: loading ? 'Finding the best prices' : `${results.length} delivery services`,
      loadTitle: ['Comparing live prices…', 'Still checking couriers…', 'Nearly there…'][st.slow],
      loadTxt: ['Asking Royal Mail, Evri, DPD, InPost and more for this parcel.', 'Some couriers take a few seconds to answer. Hang on.', 'The slowest courier is still answering. Your prices are almost ready.'][st.slow], empty: !loading && results.length === 0,
      emptyTxt: st.error || (DATA.length ? 'No services match these filters. Try widening them.' : 'No courier could quote for this parcel. Try a different weight or size.'),
      route: `${from} → ${to}`, parcelTxt: `1 parcel · ${kg} kg`,
    };
  }
}

mount(Component, document.getElementById('tpl').textContent, document.getElementById('root'));
