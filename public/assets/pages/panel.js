import { DCLogic, mount, field, api, gbp as gbpP, shortDate, dateTime, CARRIER_LOGO, CARRIER_NAME, uid, trackLink } from '../dc.js';
import { openPaySheet } from '../pay.js';
import { loadInbox, readArea } from '../bell.js';

/** Customer account: same screens as the approved design, filled from the live API. */

const S = { print: ['Ready to print', '#FFF4E0', '#9A5B00'], coll: ['Processing', '#EEF2F7', '#3E4A5C'], transit: ['In transit', '#EAF2FE', '#1D4FB8'],
  deliv: ['Delivered', '#E6F4EA', '#166534'], issue: ['Issue', '#FDECEC', '#B42318'] };
const KEY = { booked: 'print', awaiting_label: 'coll', pending: 'coll', purchasing: 'coll', awaiting_payment: 'coll', collected: 'transit', in_transit: 'transit',
  out_for_delivery: 'transit', delivered: 'deliv', exception: 'issue', failed: 'issue', cancelled: 'issue' };
const STATUS_LABEL = { collected: 'Collected', out_for_delivery: 'Out for delivery', failed: 'Failed, refunded', cancelled: 'Cancelled', awaiting_payment: 'Awaiting payment' };
const HS = { waiting_us: ['Open · we will reply soon', '#FFF4E0', '#9A5B00'], waiting_customer: ['New reply', '#EAF2FE', '#1D4FB8'], solved: ['Solved', '#E6F4EA', '#166534'] };
const CATS = [['weight_adjustment', 'Weight adjustment', ''], ['where_is_my_parcel', 'Where is my parcel', ''], ['damaged_or_missing', 'Damaged or missing', 'Add photos of the box and the item: claims need them.'],
  ['billing', 'Billing and wallet', ''], ['account', 'My account', ''], ['other', 'Something else', '']];
const gbp = (v) => '£' + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const views = ['dash', 'ship', 'wallet', 'inv', 'addr', 'int', 'set', 'help'];
const startView = new URLSearchParams(location.search).get('view');

class Component extends DCLogic {
  constructor(p) {
    super(p);
    this.state = {
      nav: views.includes(startView) ? startView : 'dash', tab: 'all', txTab: 'all', topup: false, amt: 50, method: 'card', toast: '', auto: false, adj: '',
      hT: '', newT: false, cat: 'where_is_my_parcel', shipSel: {}, abTab: 'rec', setTab: 'profile',
      notif: { booked: [1, 0], collected: [1, 0], out: [0, 1], deliv: [1, 1], issue: [1, 1], low: [1, 0] }, fmt: 'a4', qr: true, cover: false, tfa: false,
      shop: null, me: null, bal: 0, statement: [], shipments: [], adjustments: [], tickets: [], jobs: [], fwd: [], inbox: { unread: {}, total: 0 }, thread: null, loaded: false,
    };
    this.draft = '';
  }

  async mounted() {
    try {
      const me = await api('/api/me');
      this.setState({ me });
    } catch {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    await this.reload();
    document.addEventListener('kg-inbox', (e) => this.setState({ inbox: e.detail }));
    loadInbox().then(() => { if (['ship', 'wallet', 'help'].includes(this.state.nav)) readArea(this.state.nav); });
    const sq = new URLSearchParams(location.search);
    for (const [k, name] of [['shopify', 'Shopify'], ['woo', 'WooCommerce'], ['wix', 'Wix']]) {
      if (!sq.get(k)) continue;
      history.replaceState(null, '', '/app?view=int');
      if (sq.get(k) === 'connected') {
        this.say(`${name} connected. Your orders will appear in a few seconds.`);
        setTimeout(() => api('/api/shop').then((shop) => this.setState({ shop })).catch(() => {}), 5000);
      } else this.say(sq.get('msg') || `${name} could not be connected. Please try again.`);
    }
    const back = new URLSearchParams(location.search).get('topup');
    if (back) {
      history.replaceState(null, '', '/app?view=wallet');
      if (back === 'cancelled') { this.say('Top-up cancelled. No money was taken.'); return; }
      await this.waitForTopup();
    }
  }

  /** Stripe's webhook adds the money; watch the balance until it moves (normally a few seconds). */
  async waitForTopup() {
    const before = this.state.bal;
    this.say('Payment received. Adding it to your wallet…');
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      await this.reload();
      if (this.state.bal > before) { this.say(`Wallet topped up. New balance ${gbp(this.state.bal)}`); return; }
    }
    this.say('Payment received. It can take a minute to show in your wallet.');
  }

  async reload() {
    const [w, s, a, t, j, fw] = await Promise.all([api('/api/wallet'), api('/api/shipments'), api('/api/adjustments'), api('/api/tickets'), api('/api/jobs').catch(() => ({ jobs: [] })), api('/api/tr/sent').catch(() => ({ boxes: [] }))]);
    this.setState({ bal: w.balancePence / 100, statement: w.statement, shipments: s.shipments, adjustments: a.adjustments, tickets: t.tickets, jobs: j.jobs, fwd: fw.boxes, loaded: true });
    api('/api/shop').then((shop) => this.setState({ shop })).catch(() => this.setState({ shop: { enabled: false, stores: [], orders: [] } }));
    if (this.state.nav === 'help' && !this.state.hT && t.tickets[0]) this.openTicket(t.tickets[0].id);
  }

  async openTicket(id) {
    const thread = await api(`/api/tickets/${id}`);
    this.setState({ hT: id, thread });
  }

  say(text) { this.setState({ toast: text }); setTimeout(() => this.state.toast === text && this.setState({ toast: '' }), 4000); }

  renderVals() {
    const st = this.state;
    const okShips = st.shipments.filter((s) => !['failed', 'cancelled', 'awaiting_payment'].includes(s.status));
    const avgLabel = okShips.length ? okShips.reduce((x, s) => x + s.price_pence, 0) / okShips.length / 100 : 2.39;
    const me = st.me || { name: '', account_type: 'personal', demoPayments: true };
    const first = (me.name || '').split(' ')[0];
    const hour = new Date().getHours();
    const now = new Date();
    const thisMonth = now.toISOString().slice(0, 7);

    // ---- shipments
    const adjBy = Object.fromEntries(st.adjustments.map((a) => [a.shipment_id, a]));
    const adjOf = (s) => {
      const a = adjBy[s.id];
      if (!a) return { adj: false, adjShort: '', aBg: '', aFg: '', aDot: '', openAdj: () => {} };
      const paid = a.diff_pence > 0;
      const kg = JSON.parse(a.measured_json).weightGrams / 1000;
      return { adj: true, adjShort: `${kg} kg measured${paid ? '' : ' · no extra charge'}`, aBg: paid ? '#FDECEC' : '#FFF4E0', aFg: paid ? '#B42318' : '#9A5B00', aDot: paid ? '#E5484D' : '#E89B12',
        openAdj: () => this.setState({ adj: a.id }) };
    };
    const shipRow = (s) => {
      const to = JSON.parse(s.to_json);
      const key = KEY[s.status] || 'coll';
      const on = !!st.shipSel[s.id];
      return { id: s.id, no: s.ref, to: to.name, city: `${to.city} ${to.postcode}`, logo: CARRIER_LOGO[s.carrier] || '', service: s.service_name, key,
        status: STATUS_LABEL[s.status] || S[key][0], sBg: S[key][1], sFg: S[key][2], price: gbp(s.price_pence / 100), date: shortDate(s.created_at),
        isShip: true, isJob: false, hasLogo: Boolean(CARRIER_LOGO[s.carrier]), noLogo: !CARRIER_LOGO[s.carrier], at: s.created_at,
        labelUrl: s.label_url || '#', trackUrl: s.tracking_number ? trackLink(s.carrier, s.tracking_number) : '#',
        ...adjOf(s), on: on ? 'true' : 'false', ring: on ? '#2463DB' : '#9FB0C8', box: on ? '#2463DB' : '#FFFFFF',
        toggle: () => this.setState({ shipSel: { ...st.shipSel, [s.id]: !on } }),
        ...card({ to: `${to.city} ${to.postcode}`, toFull: `${to.name}, ${to.city} ${to.postcode}`, carrier: CARRIER_NAME[s.carrier] || '', service: shortService(s.carrier, s.service_name), date: shortDate(s.created_at), price: gbp(s.price_pence / 100),
          act: key === 'print' ? 'Label' : 'Track', actCls: key === 'print' ? 'print' : '', actUrl: key === 'print' ? (s.label_url || '#') : (s.tracking_number ? trackLink(s.carrier, s.tracking_number) : '#'),
          moreUrl: s.tracking_number ? trackLink(s.carrier, s.tracking_number) : (s.label_url || '#') }) };
    };
    const all = st.shipments.map(shipRow);
    // Moving & freight requests sit in the same "Recent" list on the dashboard.
    const JOB = { open: ['Waiting for offers', '#FFF4E0', '#9A5B00'], booked: ['Booked', '#E6F4EA', '#166534'], completed: ['Completed', '#EAF2FE', '#1D4FB8'], cancelled: ['Cancelled', '#EEF2F7', '#586579'] };
    const jobRows = st.jobs.map((j) => {
      const [label, bg, fg] = JOB[j.status] || JOB.open;
      const offers = j.status === 'open' && j.offers ? `${j.offers} offer${j.offers > 1 ? 's' : ''}` : '';
      return { id: j.id, no: `#${j.ref}`, date: shortDate(j.createdAt), to: `${j.fromArea} → ${j.toArea}`, city: j.date ? `on ${new Date(`${j.date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : '',
        service: j.title, logo: '', hasLogo: false, noLogo: true, svc: j.kind === 'removals' ? 'Removals' : 'Freight', key: 'move', status: offers || label, sBg: offers ? '#E6F4EA' : bg, sFg: offers ? '#166534' : fg,
        price: j.bestPence ? `from ${gbp(j.bestPence / 100)}` : '—', isShip: false, isJob: true, jobUrl: `/app/requests/${j.id}`, at: j.createdAt,
        adj: false, adjShort: '', aBg: '', aFg: '', aDot: '', openAdj: () => {}, labelUrl: '#', trackUrl: '#',
        ...card({ to: `${j.fromArea} → ${j.toArea}`, service: shortJob(j.title), when: j.date ? `${shortDate(j.createdAt)} → ${new Date(`${j.date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : shortDate(j.createdAt),
          price: j.bestPence ? `from ${gbp(j.bestPence / 100)}` : '', icoShip: j.kind !== 'removals', icoTruck: j.kind === 'removals', act: 'View', actUrl: `/app/requests/${j.id}`, actTarget: '_self', moreUrl: `/app/requests/${j.id}`, moreTarget: '_self' }) };
    });
    // Boxes from the Turkey warehouse, once they leave for the UK, are shipments too.
    const fwdRows = st.fwd.map((b) => {
      const key = b.status === 'delivered' ? 'deliv' : 'transit';
      const what = b.items.map((i) => i.description).filter(Boolean);
      return { id: b.id, no: b.trackingNo || b.ref, date: shortDate(b.shippedAt || b.createdAt), to: b.address.name, city: `${b.address.city} ${b.address.postcode}`,
        service: `${b.courierName} · ${what.slice(0, 2).join(', ')}${what.length > 2 ? ` +${what.length - 2}` : ''}`, logo: b.courierLogo || '', hasLogo: Boolean(b.courierLogo), noLogo: !b.courierLogo, svc: 'TR → UK', key,
        status: b.status === 'delivered' ? 'Delivered' : 'In transit', sBg: S[key][1], sFg: S[key][2], price: gbp((b.pricePence || 0) / 100), isShip: false, isJob: true,
        jobUrl: b.trackingUrl || '/app/turkey', at: b.shippedAt || b.createdAt, adj: false, adjShort: '', aBg: '', aFg: '', aDot: '', openAdj: () => {}, labelUrl: '#', trackUrl: '#',
        ...card({ to: `${b.address.city} ${b.address.postcode}`, toFull: `${b.address.name}, ${b.address.city} ${b.address.postcode}`, carrier: b.courierName, service: `${b.courierName} · from Türkiye`, date: shortDate(b.shippedAt || b.createdAt), price: gbp((b.pricePence || 0) / 100),
          icoWh: !b.courierLogo, act: 'Track', actUrl: b.trackingUrl || '/app/turkey', actTarget: b.trackingUrl ? '_blank' : '_self', moreUrl: '/app/turkey', moreTarget: '_self' }) };
    });
    const dashAll = [...all, ...jobRows, ...fwdRows].sort((x, y) => (x.at < y.at ? 1 : -1));
    const rows = (st.tab === 'all' ? dashAll : dashAll.filter((r) => r.key === st.tab)).slice(0, 6);
    const tabDefs = [['all', 'All'], ['print', 'Ready to print'], ['coll', 'Processing'], ['transit', 'In transit'], ['deliv', 'Delivered'], ['issue', 'Issue']];
    const mkTabs = () => tabDefs.map(([id, label]) => ({
      label, n: id === 'all' ? all.length : [...all, ...fwdRows].filter((r) => r.key === id).length, on: st.tab === id ? 'true' : 'false',
      bg: st.tab === id ? '#1F2A3C' : '#FFFFFF', fg: st.tab === id ? '#FFFFFF' : '#3E4A5C', border: st.tab === id ? '#1F2A3C' : '#C9D6EA',
      pick: () => this.setState({ tab: id }) }));
    const tabs = [...mkTabs(), ...(jobRows.length ? [{ label: 'Moving & freight', n: jobRows.length, on: st.tab === 'move' ? 'true' : 'false',
      bg: st.tab === 'move' ? '#1F2A3C' : '#FFFFFF', fg: st.tab === 'move' ? '#FFFFFF' : '#3E4A5C', border: st.tab === 'move' ? '#1F2A3C' : '#C9D6EA', pick: () => this.setState({ tab: 'move' }) }] : [])];
    tabs[0].n = dashAll.length;
    const tiles = [['print', 'Ready to print'], ['coll', 'Processing'], ['transit', 'In transit'], ['deliv', 'Delivered'], ['issue', 'Issues']].map(([id, label]) => ({
      label, n: [...all, ...fwdRows].filter((r) => r.key === id).length, bg: S[id][1], fg: S[id][2], border: st.tab === id ? S[id][2] : '#E1E7EF',
      pick: () => this.setState({ tab: st.tab === id ? 'all' : id }) }));
    const shipRows = st.tab === 'all' ? all : all.filter((r) => r.key === st.tab);
    const shipTabs = mkTabs();
    const selCount = Object.values(st.shipSel).filter(Boolean).length;

    // ---- this month + chart
    const live = st.shipments.filter((s) => !['failed', 'cancelled', 'awaiting_payment'].includes(s.status));
    const monthShips = live.filter((s) => s.created_at.startsWith(thisMonth));
    const spent = monthShips.reduce((a, s) => a + s.price_pence, 0) / 100;
    const owed = st.adjustments.filter((a) => ['pending', 'failed'].includes(a.status));
    const month = [
      { label: 'Parcels sent', value: String(monthShips.length), color: '#1F2A3C' },
      { label: 'Spent', value: gbp(spent), color: '#1F2A3C' },
      { label: 'Weight adjustments', value: String(st.adjustments.filter((a) => a.created_at.startsWith(thisMonth)).length), color: '#9A5B00' },
      { label: 'Average label', value: monthShips.length ? gbp(spent / monthShips.length) : '—', color: '#1F2A3C' },
    ];
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const per = Array.from({ length: Math.min(daysInMonth, now.getDate()) }, (_, i) => monthShips.filter((s) => new Date(s.created_at).getDate() === i + 1).length);
    const maxPer = Math.max(1, ...per);
    const busiest = per.indexOf(Math.max(...per));
    const bars = per.map((n, i) => ({ h: Math.round(n / maxPer * 100) + '%', c: i === busiest && n ? '#2463DB' : '#8FB4F5',
      lab: i % 3 === 0 ? String(i + 1) : '', tip: `${i + 1} ${now.toLocaleString('en-GB', { month: 'short' })}: ${n} parcel${n === 1 ? '' : 's'}` }));

    // ---- needs attention
    const todo = [];
    if (me.bookings_paused) todo.push({ t: 'Bookings are paused', s: 'A weight adjustment is unpaid. Top up your wallet or open a Help request.', a: 'Help', bg: '#FDF2F2', dot: '#E5484D', go: (e) => { e.preventDefault(); this.setState({ nav: 'help' }); } });
    if (owed.length) todo.push({ t: `Weight adjustment on ${owed.length} parcel${owed.length > 1 ? 's' : ''}`, s: `Couriers measured them heavier than entered. ${gbp(owed.reduce((a, x) => a + x.diff_pence, 0) / 100)} to pay.`, a: 'Review', bg: '#FDF2F2', dot: '#E5484D', go: (e) => { e.preventDefault(); this.setState({ nav: 'ship' }); } });
    const toPrint = all.filter((r) => r.key === 'print').length;
    if (toPrint) todo.push({ t: `${toPrint} label${toPrint > 1 ? 's' : ''} not printed yet`, s: 'Print them before your drop-off or collection.', a: 'View', bg: '#FFF8EC', dot: '#E89B12', go: (e) => { e.preventDefault(); this.setState({ nav: 'ship', tab: 'print' }); } });
    for (const j of st.jobs.filter((x) => x.status === 'open' && x.offers > 0)) {
      todo.unshift({ t: `${j.offers} new offer${j.offers > 1 ? 's' : ''} for request #${j.ref}`, s: `${j.title}, ${j.fromArea} → ${j.toArea}. Best price so far ${gbp(j.bestPence / 100)}.`, a: 'Compare', bg: '#E6F4EA', dot: '#16A34A', go: (e) => { e.preventDefault(); location.href = `/app/requests/${j.id}`; } });
    }
    if (st.bal < 20) todo.push({ t: 'Wallet is running low', s: 'Top up so your next label is not held at checkout.', a: 'Top up', bg: '#EAF2FE', dot: '#2463DB', go: (e) => { e.preventDefault(); this.setState({ topup: true }); } });
    if (!todo.length) todo.push({ t: 'All clear', s: 'Nothing needs your attention right now.', a: 'Send a parcel', bg: '#F4F6FA', dot: '#16A34A', go: () => { location.href = '/app/send'; } });

    // ---- wallet
    const KIND = { hold: 'label', capture: 'label', topup: 'topup', credit: 'topup', release: 'refund', refund: 'refund', adjustment: 'adjust' };
    const TITLE = { label: 'Label', topup: 'Top-up', refund: 'Refund', adjust: 'Weight adjustment' };
    const shipRef = Object.fromEntries(st.shipments.map((s) => [s.id, s]));
    const adjRef = Object.fromEntries(st.adjustments.map((a) => [a.id, a]));
    let run = st.bal;
    const txAll = st.statement.map((t) => {
      const v = t.amount / 100;
      const after = run; run -= v;
      const kind = KIND[t.kind] || 'label';
      const K = { label: ['−', '#EEF2F7', '#3E4A5C'], topup: ['+', '#E6F4EA', '#166534'], refund: ['↺', '#EAF2FE', '#1D4FB8'], adjust: ['!', '#FDECEC', '#B42318'] }[kind];
      const s = shipRef[t.ref] || (adjRef[t.ref] ? shipRef[adjRef[t.ref].shipment_id] : null);
      const title = t.kind === 'credit' ? 'Credit from Kargom' : s && kind === 'label' ? s.service_name : TITLE[kind];
      return { date: shortDate(t.created_at), kind, title, sub: t.memo || (s ? s.ref : t.ref || ''), sign: K[0], iBg: K[1], iFg: K[2],
        amt: (v < 0 ? '−' : '+') + gbp(v), aFg: v < 0 ? '#1F2A3C' : '#166534', bal: gbp(after) };
    });
    const tx = st.txTab === 'all' ? txAll : txAll.filter((x) => x.kind === st.txTab);
    const txTabs = [['all', 'All'], ['topup', 'Top-ups'], ['label', 'Labels'], ['adjust', 'Adjustments'], ['refund', 'Refunds']].map(([id, label]) => ({ label, on: st.txTab === id ? 'true' : 'false',
      bg: st.txTab === id ? '#1F2A3C' : '#FFFFFF', fg: st.txTab === id ? '#FFFFFF' : '#3E4A5C', border: st.txTab === id ? '#1F2A3C' : '#C9D6EA',
      pick: () => this.setState({ txTab: id }) }));
    const monthTx = st.statement.filter((t) => t.created_at.startsWith(thisMonth));
    const sumIn = monthTx.filter((t) => t.amount > 0 && ['topup', 'credit'].includes(t.kind)).reduce((a, t) => a + t.amount, 0) / 100;
    const sumOut = -monthTx.filter((t) => t.amount < 0).reduce((a, t) => a + t.amount, 0) / 100;
    const byCarrier = {};
    for (const s of live) byCarrier[s.carrier] = (byCarrier[s.carrier] || 0) + s.price_pence / 100;
    const top = Object.entries(byCarrier).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const spend = top.map(([k, v]) => ({ name: CARRIER_NAME[k] || k, logo: CARRIER_LOGO[k] || '', v: gbp(v), w: Math.round(v / (top[0]?.[1] || 1) * 100) + '%' }));
    const how = [
      { n: '1', t: 'Top up', d: 'Add funds by card or Apple Pay. Money is ready instantly.' },
      { n: '2', t: 'Book labels', d: 'Each label price comes out of your balance the moment you book.' },
      { n: '3', t: 'Get refunds back', d: 'Cancelled or unused labels are credited back to your wallet.' },
    ];
    const amounts = [10, 20, 50, 100, 250, 500].map((a) => ({ label: '£' + a, note: a === 50 ? 'Most popular' : '≈ ' + Math.floor(a / 2.39) + ' parcels',
      on: st.amt === a ? 'true' : 'false', border: st.amt === a ? '#2463DB' : '#E1E7EF', bg: st.amt === a ? '#EAF2FE' : '#FFFFFF', pick: () => this.setState({ amt: a }) }));
    const methods = [['card', me.has_card ? 'Saved card' : 'Card', me.demoPayments ? 'Test mode' : 'Visa, Mastercard, Amex'], ['apple', 'Apple Pay / Google Pay', me.demoPayments ? '' : 'On the secure Stripe page'], ['bank', 'Pay by bank', 'Coming soon']].map(([id, label, note]) => ({ label, note,
      on: st.method === id ? 'true' : 'false', border: st.method === id ? '#2463DB' : '#E1E7EF', ring: st.method === id ? '#2463DB' : '#9FB0C8', dot: st.method === id ? '#2463DB' : 'transparent',
      pick: () => this.setState({ method: id }) }));
    const pay = async () => {
      if (st.method === 'bank') { this.say('Pay by bank is coming soon. Please use a card.'); return; }
      if (!me.demoPayments && me.stripePk) {
        // Card form on our own page (Stripe's secure fields), no redirect.
        try {
          const r = await api('/api/wallet/topups', { method: 'POST', body: { amountPence: st.amt * 100 }, idempotencyKey: uid() });
          this.setState({ topup: false });
          const res = await openPaySheet({ publishableKey: me.stripePk, clientSecret: r.clientSecret, amountTxt: gbp(st.amt), title: 'Top up your wallet',
            subtitle: 'Card, Apple Pay or Google Pay', summary: 'Amount to add', payLabel: `Add ${gbp(st.amt)} to wallet`, returnUrl: `${location.origin}/app?view=wallet&topup=paid` });
          if (res === 'cancelled') { this.say('Top-up cancelled. No money was taken.'); return; }
          await this.waitForTopup();
        } catch (e) { this.say(e.message); }
        return;
      }
      if (!me.demoPayments) {
        // No publishable key yet: fall back to Stripe's hosted page.
        try {
          const r = await api('/api/wallet/checkout', { method: 'POST', body: { amountPence: st.amt * 100 }, idempotencyKey: uid() });
          location.href = r.url;
        } catch (e) { this.say(e.message); }
        return;
      }
      // Test mode: same payment sheet with a simulated card.
      this.setState({ topup: false });
      const res = await openPaySheet({ amountTxt: gbp(st.amt), title: 'Top up your wallet', subtitle: 'Card, Apple Pay or Google Pay', summary: 'Amount to add',
        payLabel: `Add ${gbp(st.amt)} to wallet`, demoPay: () => api('/api/dev/topup', { method: 'POST', body: { amountPence: st.amt * 100 } }) });
      if (res === 'cancelled') { this.say('Top-up cancelled. No money was taken.'); return; }
      this.say(`${gbp(st.amt)} added to your wallet (test mode)`);
      await this.reload();
    };

    // ---- invoices (monthly, from shipments)
    const months = {};
    for (const s of live) { const m = s.created_at.slice(0, 7); (months[m] ||= { n: 0, total: 0, vat: 0 }); months[m].n++; months[m].total += s.price_pence; months[m].vat += s.vat_pence; }
    for (const a of st.adjustments.filter((x) => x.status === 'charged')) { const m = a.created_at.slice(0, 7); (months[m] ||= { n: 0, total: 0, vat: 0 }); months[m].total += a.diff_pence; months[m].vat += Math.round(a.diff_pence / 6); }
    const invoices = Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).map(([m, v]) => {
      const d = new Date(m + '-01T00:00:00Z');
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const open = m === thisMonth;
      return { no: `INV-UK-${m}`, period: `1–${last} ${d.toLocaleString('en-GB', { month: 'short', year: 'numeric' })}`, n: v.n, total: gbp(v.total / 100), net: gbp((v.total - v.vat) / 100), vat: gbp(v.vat / 100),
        status: open ? 'Open · issued at month end' : 'Issued', sBg: open ? '#FFF4E0' : '#E6F4EA', sFg: open ? '#9A5B00' : '#166534' };
    });
    const cm = months[thisMonth] || { n: 0, total: 0, vat: 0 };
    const invStats = [
      { label: 'Spent this month', value: gbp(cm.total / 100), note: 'Including VAT', color: '#1F2A3C' },
      { label: 'VAT you can reclaim', value: gbp(cm.vat / 100), note: 'If you are VAT registered', color: '#166534' },
      { label: 'Labels this month', value: String(cm.n), note: `Across ${new Set(monthShips.map((s) => s.carrier)).size} couriers`, color: '#1F2A3C' },
      { label: 'Next invoice', value: new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), note: 'Emailed to your account email', color: '#1F2A3C' },
    ];
    const billing = [{ k: 'Name', v: me.name || '—' }, { k: 'Company', v: me.company || '—' }, { k: 'Account', v: me.account_type === 'business' ? 'Business' : 'Personal' }, { k: 'Invoices sent to', v: me.email || '—' }];

    // ---- address book (from what you have shipped)
    const seen = new Map();
    for (const s of st.shipments) {
      for (const [kind, json] of [['send', s.from_json], ['rec', s.to_json]]) {
        const a = JSON.parse(json);
        const key = `${kind}|${a.name}|${a.line1}|${a.postcode}`;
        const cur = seen.get(key);
        if (cur) cur.n++; else seen.set(key, { kind, a, n: 1 });
      }
    }
    const book = [...seen.values()].sort((x, y) => y.n - x.n);
    const SEND = book.filter((x) => x.kind === 'send');
    const REC = book.filter((x) => x.kind === 'rec');
    const isSendTab = st.abTab === 'send';
    const addrs = (isSendTab ? SEND : REC).map(({ a, n }, i) => ({ label: a.name, name: a.name, phone: a.phone || '—', line: [a.line1, a.line2, a.city, a.postcode, a.country !== 'GB' ? a.country : ''].filter(Boolean).join(', '),
      tag: i === 0 ? (isSendTab ? 'Most used' : 'Recent') : `${n} parcel${n > 1 ? 's' : ''}`, ini: (a.name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
      tagBg: i === 0 ? '#EAF2FE' : 'transparent', cta: isSendTab ? 'Send from here' : 'Send here' }));
    const abTabs = [['rec', 'Recipients', REC.length], ['send', 'Collection addresses', SEND.length]].map(([id, label, n]) => ({ label, n, on: st.abTab === id ? 'true' : 'false',
      bg: st.abTab === id ? '#2463DB' : 'transparent', fg: st.abTab === id ? '#FFFFFF' : '#3E4A5C', pick: () => this.setState({ abTab: id }) }));

    // ---- integrations (coming soon)
    const APPS = [['shopify', 'Shopify', 'S', '#5E8E3E', 'Import paid orders and write tracking back to the order.'], ['woo', 'WooCommerce', 'W', '#7F54B3', 'Plugin for WordPress shops.'],
      ['ebay', 'eBay', 'e', '#E53238', 'Pull sold items and mark them dispatched automatically.'], ['etsy', 'Etsy', 'E', '#F1641E', 'Bring in Etsy orders with buyer addresses filled in.'],
      ['amazon', 'Amazon', 'a', '#232F3E', 'Seller Central orders, with tracking sent to Amazon.'], ['wix', 'Wix', 'W', '#0C6EFC', 'Connect your Wix store and ship from one place.'],
      ['squarespace', 'Squarespace', 'S', '#1F2A3C', 'Import orders from your Squarespace commerce site.'], ['csv', 'CSV upload', '↑', '#33AEEF', 'Upload a spreadsheet of addresses to book in bulk.']];
    const apps = APPS.filter(([id]) => !['shopify', 'woo', 'wix'].includes(id)).map(([, name, ini, color, desc]) => ({ name, ini, color, desc, state: 'Coming soon', stFg: '#8593A8', border: '#E1E7EF',
      cta: 'Notify me', bBg: '#FFFFFF', bFg: '#3E4A5C', bBorder: '#C9D6EA', toggle: () => this.say(`We will email you when ${name} is ready.`) }));

    // ---- connected shops (Shopify, WooCommerce)
    const SH = st.shop || { shopify: { enabled: false, stores: [] }, woo: { enabled: false, stores: [] }, ticimax: { enabled: false, stores: [] }, wix: { enabled: false, stores: [] }, orders: [] };
    const when = (iso) => (iso ? dateTime(iso) : 'not yet');
    const shRow = (o) => {
      const done = o.status === 'shipped', err = done && !o.pushedAt && o.pushError;
      const pn = { woo: 'WooCommerce', ticimax: 'Ticimax', wix: 'Wix' }[o.platform] || 'Shopify';
      return { name: o.name, store: o.store, date: shortDate(o.orderedAt), to: [o.to.name, o.to.city, o.to.postcode, o.to.country !== 'GB' ? o.to.country : ''].filter(Boolean).join(' · '),
        items: o.items.slice(0, 3).join(', ') + (o.items.length > 3 ? ` +${o.items.length - 3} more` : ''), kg: o.weightGrams ? `${(o.weightGrams / 1000).toFixed(1)} kg` : 'Weight not set',
        total: o.totalPence ? `${o.currency === 'GBP' || !o.currency ? '£' : `${o.currency} `}${(o.totalPence / 100).toFixed(2)}` : '',
        chip: done ? (o.pushedAt ? `Tracking sent to ${pn}` : err ? 'Tracking not sent' : 'Waiting for label') : 'Needs shipping',
        chipCls: done ? (o.pushedAt ? 'ok' : err ? 'bad' : 'wait') : 'todo', err: err ? o.pushError : '',
        shipUrl: `/app/send?shopOrder=${encodeURIComponent(o.id)}`,
        hide: async () => { try { this.setState({ shop: await api(`/api/shop/orders/${o.id}/ignore`, { method: 'POST' }) }); } catch (e) { this.say(e.message); } } };
    };
    const shopSync = async () => {
      this.say('Checking your shops for new orders…');
      try {
        const r = await api('/api/shop/sync', { method: 'POST' }); this.setState({ shop: r });
        this.say(r.errors?.length ? r.errors[0] : r.added ? `${r.added} new order${r.added > 1 ? 's' : ''}` : 'No new orders');
      } catch (e) { this.say(e.message); }
    };
    const PLAT = {
      shopify: { title: 'Shopify', input: 'Shopify store', label: 'Your Shopify address', ph: 'my-shop.myshopify.com', btn: 'Connect Shopify',
        lead: 'Paid orders that still need shipping come in here. Click Ship, pick a courier and print the label. The tracking number goes back to the Shopify order, and Shopify emails your customer.',
        go: (v) => `/api/shop/shopify/connect?shop=${encodeURIComponent(v)}`, need: 'Type your Shopify address, for example my-shop.myshopify.com' },
      woo: { title: 'WooCommerce', input: 'WooCommerce site', label: 'Your shop website', ph: 'https://www.my-shop.co.uk', btn: 'Connect WooCommerce',
        lead: 'Orders in Processing come in here. After you book, the tracking number is added to the order (your customer gets it by email) and the order is marked Completed. You approve Kargom once in your WordPress admin.',
        go: (v) => `/api/shop/woo/connect?site=${encodeURIComponent(v)}`, need: 'Type your shop website, for example https://www.my-shop.co.uk' },
      wix: { title: 'Wix', btn: 'Connect Wix', noInput: true,
        lead: 'Paid orders from your Wix store come in here. After you book, the tracking number is added to the Wix order as a fulfillment, and Wix can email your customer.',
        go: () => '/api/shop/wix/connect' },
      ticimax: { title: 'Ticimax', input: 'Ticimax site', label: 'Your shop website', ph: 'https://www.my-shop.com', btn: 'Connect Ticimax',
        keyInput: 'Ticimax Yetki Kodu', keyLabel: 'Yetki Kodu (Ticimax admin → Ayarlar → Yetki Kodu Yönetimi)',
        lead: 'Approved and packing orders come in here. After you book, the tracking number is saved on the Ticimax order and its status changes to Kargoya verildi.',
        need: 'Type your shop website, for example https://www.my-shop.com' },
    };
    const shopCards = Object.entries(PLAT).map(([id, P]) => {
      const info = SH[id] || { enabled: false, stores: [] };
      const connected = info.stores.length > 0;
      const mine = SH.orders.filter((o) => o.platform === id);
      const open = mine.filter((o) => o.status === 'open'), done = mine.filter((o) => o.status === 'shipped').slice(0, 10);
      return { ...P, isShopify: id === 'shopify', isWoo: id === 'woo', isTicimax: id === 'ticimax', isWix: id === 'wix', hasInput: !P.noInput,
        on: info.enabled && !connected, off: !info.enabled && !connected, connected,
        status: connected ? `Connected · ${info.stores.map((x) => x.name).join(', ')}` : info.enabled ? 'Not connected' : 'Switching on soon', statusCls: connected ? 'ok' : 'todo',
        stores: info.stores.map((x) => ({ name: x.name, shop: x.shop.replace(/^https:\/\//, ''), synced: `Last checked ${when(x.lastSyncAt)}`,
          disconnect: async () => { try { this.setState({ shop: await api(`/api/shop/stores/${x.id}/disconnect`, { method: 'POST' }) }); this.say(`${x.name} disconnected`); } catch (e) { this.say(e.message); } } })),
        orders: open.map(shRow), shipped: done.map(shRow), hasOrders: open.length > 0, noOrders: connected && open.length === 0, hasShipped: done.length > 0,
        count: open.length ? `${open.length} order${open.length > 1 ? 's' : ''} to ship` : '', sync: shopSync,
        hasKey: Boolean(P.keyInput), keyInput: P.keyInput || '', keyLabel: P.keyLabel || '',
        connect: async () => {
          if (P.noInput) { location.href = P.go(); return; }
          const v = String(field(P.input) || '').trim();
          if (!v) { this.say(P.need); return; }
          if (!P.keyInput) { location.href = P.go(v); return; }
          const key = String(field(P.keyInput) || '').trim();
          if (!key) { this.say('Paste the Yetki Kodu from your Ticimax admin.'); return; }
          this.say('Connecting to Ticimax…');
          try { this.setState({ shop: await api(`/api/shop/${id}/connect`, { method: 'POST', body: { site: v, key } }) }); this.say(`${P.title} connected.`); } catch (e) { this.say(e.message); }
        } };
    });
    // ---- settings
    const SET = [['profile', 'Profile'], ['company', 'Company'], ['prefs', 'Preferences'], ['notif', 'Notifications'], ['sec', 'Security'], ['team', 'Team']];
    const setTabs = SET.map(([id, label]) => ({ label, on: st.setTab === id ? 'true' : 'false', line: st.setTab === id ? '#2463DB' : 'transparent', fg: st.setTab === id ? '#1F2A3C' : '#586579',
      pick: () => this.setState({ setTab: id }) }));
    const [fn, ...ln] = (me.name || '').split(' ');
    const FIELDS = {
      profile: [{ k: 'First name', v: fn || '' }, { k: 'Last name', v: ln.join(' ') }, { k: 'Email', v: me.email || '' }, { k: 'Mobile', v: me.phone || '' }],
      company: [{ k: 'Company name', v: me.company || '' }],
    };
    const fields = (FIELDS[st.setTab] || []).map((f) => ({ ph: '', ...f }));
    const sw = (on) => ({ bg: on ? '#2463DB' : '#C9D6EA', x: on ? '25px' : '3px', on: on ? 'true' : 'false' });
    const formats = [['a4', 'A4 page', 'Print on a normal printer, 1 label per page'], ['thermal', '4×6 thermal', 'For Zebra, Rollo and other label printers']].map(([id, label, note]) => ({ label, note,
      on: st.fmt === id ? 'true' : 'false', border: st.fmt === id ? '#2463DB' : '#E1E7EF', bg: st.fmt === id ? '#F5F9FF' : '#FFFFFF', ring: st.fmt === id ? '#2463DB' : '#9FB0C8', dot: st.fmt === id ? '#2463DB' : 'transparent',
      pick: () => this.setState({ fmt: id }) }));
    const prefToggles = [
      { label: 'Prefer QR code when available', note: 'Show a code at the drop-off point instead of printing.', ...sw(st.qr), toggle: () => this.setState({ qr: !st.qr }) },
      { label: 'Add extra cover by default', note: 'Protects parcels worth more than the courier\'s standard cover.', ...sw(st.cover), toggle: () => this.setState({ cover: !st.cover }) },
    ];
    const NOT = [['booked', 'Label booked', 'Receipt with the label attached'], ['collected', 'Collected by courier', 'When the driver scans it'], ['out', 'Out for delivery', 'The day it arrives'],
      ['deliv', 'Delivered', 'With proof of delivery when the courier provides it'], ['issue', 'Delivery problem', 'Failed attempts, damage or delays'], ['low', 'Wallet running low', 'When the balance drops below £10']];
    const notifs = NOT.map(([id, label, note]) => { const [e, sms] = st.notif[id];
      const set = (k) => { const v = st.notif[id].slice(); v[k] = v[k] ? 0 : 1; this.setState({ notif: { ...st.notif, [id]: v } }); };
      return { label, note, eOn: e ? 'true' : 'false', eBg: e ? '#2463DB' : '#C9D6EA', eX: e ? '21px' : '3px', eToggle: () => set(0),
        sOn: sms ? 'true' : 'false', sBg: sms ? '#2463DB' : '#C9D6EA', sX: sms ? '21px' : '3px', sToggle: () => set(1) }; });
    const sessions = [{ d: 'This browser', w: 'Signed in now', a: 'This device', c: '#166534' }];
    const team = [{ name: me.name || '', email: me.email || '', role: 'Owner', last: 'Active now', ini: (me.name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(), color: '#1F2A3C', rBg: '#1F2A3C', rFg: '#FFFFFF' }];
    const saved = async () => {
      try {
        if (st.setTab === 'profile') {
          const name = `${field('First name') || ''} ${field('Last name') || ''}`.trim();
          await api('/api/me', { method: 'PUT', body: { name, phone: field('Mobile') } });
        } else if (st.setTab === 'company') {
          await api('/api/me', { method: 'PUT', body: { company: field('Company name') } });
        }
        this.setState({ me: await api('/api/me') });
        this.say('Changes saved');
      } catch (e) { this.say(e.message); }
    };

    // ---- adjustment dialog
    const A = st.adjustments.find((x) => x.id === st.adj);
    const adjVals = (() => {
      if (!A) return { aNo: '', aSvc: '', aKgFrom: '', aKgTo: '', aDimFrom: '', aDimTo: '', aExtra: '', aVia: '', aWhen: '', aPaid: false, aFree: false, aBand: '', aTitle: '', mBg: '', mFg: '', mDot: '', mBorder: '' };
      const before = JSON.parse(A.parcel_json), after = JSON.parse(A.measured_json);
      const paid = A.diff_pence > 0;
      const VIA = { wallet: 'Wallet', card: 'Saved card' };
      return { aNo: A.ref, aSvc: A.service_name, aKgFrom: before.weightGrams / 1000 + ' kg', aKgTo: after.weightGrams / 1000 + ' kg',
        aDimFrom: `${before.lengthCm} × ${before.widthCm} × ${before.heightCm} cm`, aDimTo: `${after.lengthCm} × ${after.widthCm} × ${after.heightCm} cm`,
        aExtra: gbp(A.diff_pence / 100), aVia: A.status === 'charged' ? VIA[A.method] || A.method : A.status === 'failed' ? 'Not paid yet: please top up' : A.status === 'waived' ? 'Waived' : 'Being collected',
        aWhen: dateTime(A.created_at), aPaid: paid, aFree: !paid, aBand: 'The measured parcel costs the same on this service.', aTitle: paid ? 'Courier re-measured this parcel' : 'Re-measured, no extra charge',
        mBg: paid ? '#FDF2F2' : '#FFF8EC', mFg: paid ? '#B42318' : '#9A5B00', mDot: paid ? '#E5484D' : '#E89B12', mBorder: paid ? '#E5484D' : '#E89B12' };
    })();

    // ---- help
    const curT = st.thread?.ticket;
    const tickets = st.tickets.map((t) => { const on = t.id === st.hT, H = HS[t.status];
      return { no: t.ref, subject: t.subject, meta: `${(CATS.find((c) => c[0] === t.category) || [0, t.category])[1]} · updated ${shortDate(t.updated_at)}`, status: H[0], sBg: H[1], sFg: H[2], cur: on ? 'true' : 'false',
        border: on ? '#2463DB' : '#E1E7EF', bg: on ? '#F5F9FF' : '#FFFFFF', pick: () => this.openTicket(t.id) }; });
    const cur = curT ? { subject: curT.subject, no: curT.ref, cat: (CATS.find((c) => c[0] === curT.category) || [0, curT.category])[1], ship: curT.shipment_id ? (shipRef[curT.shipment_id]?.ref || 'Shipment') : 'No shipment',
      status: HS[curT.status][0], sBg: HS[curT.status][1], sFg: HS[curT.status][2] }
      : { subject: st.tickets.length ? 'Pick a request' : 'No requests yet', no: '', cat: '', ship: '', status: '', sBg: 'transparent', sFg: 'transparent' };
    const msgs = (st.thread?.messages || []).map((m) => { const mine = m.author_type === 'customer';
      return { who: mine ? 'You' : 'Kargom support', time: dateTime(m.created_at), text: m.body, file: '', hasFile: false, align: mine ? 'flex-end' : 'flex-start', bg: mine ? '#2463DB' : '#FFFFFF', fg: mine ? '#FFFFFF' : '#1F2A3C',
        border: mine ? '#2463DB' : '#E1E7EF', radius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px' }; });
    const cats = CATS.map(([id, label]) => ({ label, on: st.cat === id ? 'true' : 'false', bg: st.cat === id ? '#2463DB' : '#FFFFFF', fg: st.cat === id ? '#FFFFFF' : '#3E4A5C', border: st.cat === id ? '#2463DB' : '#C9D6EA',
      pick: () => this.setState({ cat: id }) }));
    const catRow = CATS.find((c) => c[0] === st.cat);
    const faqs = [{ icon: '⌖', t: 'Where is my parcel?', s: 'Live tracking, and what each status means.' }, { icon: 'kg', t: 'Weight adjustments', s: 'Why a courier may charge more after weighing.' },
      { icon: '!', t: 'Lost or damaged', s: 'How to claim, and the cover on each service.' }, { icon: '£', t: 'Wallet and refunds', s: 'Top-ups, card payments and refunds.' }];
    const submitTicket = async () => {
      const subject = String(field('t_subject') || '').trim(), body = String(field('t_body') || '').trim();
      if (!subject || !body) { this.say('Please add a subject and tell us what happened.'); return; }
      try {
        const t = await api('/api/tickets', { method: 'POST', body: { category: st.cat, subject, body, shipmentId: field('t_ship') || null } });
        this.setState({ newT: false });
        this.say(`Request ${t.ref} sent. We usually reply within an hour.`);
        await this.reload();
        await this.openTicket(t.id);
      } catch (e) { this.say(e.message); }
    };
    const sendReply = async () => {
      const body = (document.querySelector('textarea[placeholder="Write a reply…"]')?.value || '').trim();
      if (!body || !curT) return;
      await api(`/api/tickets/${curT.id}/messages`, { method: 'POST', body: { body } });
      const ta = document.querySelector('textarea[placeholder="Write a reply…"]');
      if (ta) { ta.value = ''; ta.dataset.dirty = '0'; }
      await this.openTicket(curT.id);
      await this.reload();
    };
    const helpBadge = String(st.tickets.filter((t) => t.status === 'waiting_customer').length || '');

    // ---- nav
    const navItems = [['dash', 'Dashboard', ''], ['ship', 'Shipments', String(all.length || '')], ['wallet', 'Wallet', ''], ['inv', 'Invoices', ''], ['addr', 'Address book', ''], ['req', 'Moving & freight', ''], ['tr', 'Shop from Turkey', ''],
      ['int', 'Integrations', ''], ['set', 'Settings', ''], ['help', 'Help', helpBadge]];
    const unread = st.inbox?.unread || {};
    const nav = navItems.map(([id, label, count]) => ({ label, cur: st.nav === id ? 'page' : 'false',
      // Red = new updates there; otherwise the plain count in blue.
      badge: unread[id] ? String(unread[id] > 9 ? '9+' : unread[id]) : count, badgeBg: unread[id] ? '#E5484D' : 'transparent', badgeFg: unread[id] ? '#FFFFFF' : '#2463DB',
      bg: st.nav === id ? '#EAF2FE' : 'transparent', fg: st.nav === id ? '#1D4FB8' : '#3E4A5C', dot: st.nav === id ? '#2463DB' : '#C9D6EA',
      pick: () => { if (id === 'req') { location.href = '/app/requests'; return; } if (id === 'tr') { location.href = '/app/turkey'; return; } this.setState({ nav: id }); readArea(id); if (id === 'help' && !st.hT && st.tickets[0]) this.openTicket(st.tickets[0].id); } }));

    const low = st.bal < 20;
    return {
      signOut: async () => { try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* already out */ } location.href = '/'; },
      nav, isDash: st.nav === 'dash', isWallet: st.nav === 'wallet',
      isShip: st.nav === 'ship', isInv: st.nav === 'inv', isAddr: st.nav === 'addr', isRet: false, isInt: st.nav === 'int', isSet: st.nav === 'set',
      shipRows, shipTabs, hasSel: selCount > 0, selCount, clearSel: () => this.setState({ shipSel: {} }), shipShown: shipRows.length ? `1–${shipRows.length}` : '0', shipTotal: String(st.shipments.length), pages: [],
      invoices, invStats, billing, addrs, abTabs, returns: [], payers: [], retSvcs: [], apps, shopCards,
      copyTxt: 'Copy link', copyLink: () => {}, apiKey: 'Available on request', keyBtn: 'Request', toggleKey: () => this.say('Ask us in Help for API access.'),
      setTabs, fields, setForm: st.setTab === 'profile' || st.setTab === 'company', setPrefs: st.setTab === 'prefs', setNotif: st.setTab === 'notif', setSec: st.setTab === 'sec', setTeam: st.setTab === 'team',
      formats, prefToggles, notifs, sessions, team, saved,
      tfaOn: st.tfa ? 'true' : 'false', tfaBg: st.tfa ? '#2463DB' : '#C9D6EA', tfaX: st.tfa ? '25px' : '3px', toggleTfa: () => this.say('Two-step sign-in is coming soon.'),
      rows, tabs, tiles, month, bars, todo, tx, txTabs, spend, how, amounts, methods,
      balTxt: gbp(st.bal), parcels: Math.floor(st.bal / avgLabel), avgLabelTxt: gbp(avgLabel),
      refundsTxt: gbp(st.statement.filter((l) => l.kind === 'refund').reduce((x, l) => x + Math.max(0, l.amount), 0) / 100), inTxt: gbp(sumIn), outTxt: gbp(sumOut),
      lowTxt: low ? 'Running low' : 'Active', lowBg: low ? '#FFE3A3' : 'rgba(255,255,255,.18)', lowFg: low ? '#7A4A00' : '#FFFFFF',
      autoLine: me.demoPayments ? 'Test mode: top-ups are simulated' : st.auto ? 'Auto top-up on · adds £50 when below £10' : 'Auto top-up off',
      autoOn: st.auto ? 'true' : 'false', swBg: st.auto ? '#2463DB' : '#C9D6EA', swX: st.auto ? '25px' : '3px', autoOp: st.auto ? '1' : '.45',
      toggleAuto: () => this.say('Auto top-up starts once card payments are connected.'),
      topup: st.topup, openTopup: () => this.setState({ topup: true }), closeTopup: () => this.setState({ topup: false }),
      bellN: st.inbox?.total > 9 ? '9+' : String(st.inbox?.total || ''), bellDisp: st.inbox?.total ? 'grid' : 'none', bellLabel: `Notifications, ${st.inbox?.total || 0} new`,
      goWallet: () => this.setState({ nav: 'wallet' }), goShip: (e) => { e.preventDefault(); this.setState({ nav: 'ship' }); },
      amtTxt: gbp(st.amt), newBal: gbp(st.bal + st.amt), pay,
      adjOpen: !!A, closeAdj: () => this.setState({ adj: '' }), ...adjVals,
      dispute: async () => { try { await api(`/api/adjustments/${A.id}/dispute`, { method: 'POST' }); this.setState({ adj: '' }); this.say('Dispute sent. We will reply within 2 working days.'); await this.reload(); } catch (e) { this.say(e.message); } },
      isHelp: st.nav === 'help', goHelp: () => this.setState({ nav: 'help' }), faqs, tickets, cur, msgs, cats, catHint: catRow[2],
      newOpen: st.newT, newBtn: st.newT ? 'Cancel' : '+ New request', toggleNew: () => this.setState({ newT: !st.newT }), submitTicket,
      canReply: !!curT && curT.status !== 'solved', isClosed: curT?.status === 'solved', draft: '', setDraft: () => {}, sendReply,
      closeTicket: async () => { await api(`/api/tickets/${curT.id}/solve`, { method: 'POST' }); this.say('Marked as solved. Thanks!'); await this.openTicket(curT.id); await this.reload(); },
      reopen: async () => { await api(`/api/tickets/${curT.id}/reopen`, { method: 'POST' }); await this.openTicket(curT.id); await this.reload(); },
      toast: !!st.toast, toastTxt: st.toast, hideToast: () => this.setState({ toast: '' }),
      shipOptions: st.shipments.slice(0, 50).map((s) => ({ id: s.id, label: `${s.ref} · ${s.service_name} · ${JSON.parse(s.to_json).city}` })),
      meName: me.name, meIni: (me.name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(), meType: me.account_type === 'business' ? 'Business account' : 'Personal account',
      greeting: `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, ${first}`,
      monthTxt: me.demoPayments ? 'Test mode · payments are simulated' : now.toLocaleString('en-GB', { month: 'long', year: 'numeric' }),
      monthName: now.toLocaleString('en-GB', { month: 'long', year: 'numeric' }),
      barsNote: monthShips.length ? `${monthShips.length} parcel${monthShips.length > 1 ? 's' : ''} this month` : 'No parcels yet this month',
      cardTxt: me.has_card ? 'Charged to your saved card' : 'Add a card at your first card payment',
      qFromFlag: `/assets/flags/${FLAG[st.qFrom] || 'gb'}.svg`, qToFlag: `/assets/flags/${FLAG[st.qTo] || 'gb'}.svg`,
      setQFrom: (e) => this.setState({ qFrom: e.target.value }), setQTo: (e) => this.setState({ qTo: e.target.value }),
      quickQuote: (e) => {
        e.preventDefault();
        const kg = Number(String(field('Parcel weight in kg') || '1').replace(',', '.')) || 1;
        const q = new URLSearchParams({ from: field('Quick quote from') || 'United Kingdom', to: field('Quick quote to') || 'United Kingdom', kg: String(kg) });
        location.href = `/quotes?${q}`;
      },
    };
  }
}

/** Fields every Recent shipments card needs, with defaults. */
const card = (c) => ({ cTo: c.to, toFull: c.toFull || c.to, cSvc: c.service, cDate: c.when ? '' : c.date, cWhen: c.when || '', cPrice: c.price, carrier: c.carrier || '', icoShip: !!c.icoShip, icoTruck: !!c.icoTruck, icoWh: !!c.icoWh,
  act: c.act, actUrl: c.actUrl, actCls: c.actCls || '', actTarget: c.actTarget || '_blank', moreUrl: c.moreUrl, moreTarget: c.moreTarget || '_blank' });

/** "Royal Mail Tracked 48 Small Parcel Collection" -> "Royal Mail · Tracked 48". */
function shortService(carrier, name) {
  const brand = CARRIER_NAME[carrier] || '';
  const drop = new Set([...brand.toLowerCase().split(' '), 'uk', 'collection', 'drop-off', 'dropoff', 'service', 'parcel', 'small', 'medium', 'large', 'drop', 'off']);
  const rest = String(name || '').split(/\s+/).filter((w) => w && !drop.has(w.toLowerCase())).slice(0, 2).join(' ').replace(/\s+(to|from|and|&)$/i, '');
  return [brand, rest].filter(Boolean).join(' · ') || name;
}

/** "Sea freight · 1 40 ft container" -> "Sea freight · 1 × 40 ft". */
const shortJob = (t) => String(t || '').replace(/(\d+) (\d+ ?ft) container/i, '$1 × $2').replace(/\s*container\b/i, '');

const FLAG = { 'United States': 'us', Germany: 'de', France: 'fr', Ireland: 'ie' };

mount(Component, document.getElementById('tpl').textContent, document.getElementById('root'));
