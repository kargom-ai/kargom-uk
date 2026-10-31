import { DCLogic, mount, field, api, shortDate, dateTime, CARRIER_LOGO, CARRIER_NAME, uid } from '../dc.js';

/** Admin panel: the approved design, filled from the live admin API. */

const P = (pence) => `${pence < 0 ? '−' : ''}£${(Math.abs(pence) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const int = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const J = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
const kg = (g) => `${Math.round((g / 1000) * 10) / 10} kg`;
const dims = (p) => (p.lengthCm ? ` · ${p.lengthCm}×${p.widthCm}×${p.heightCm}` : '');
const ini = (name) => (name || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const COLORS = ['#1F2A3C', '#2463DB', '#33AEEF', '#1D3593', '#16A34A', '#E5484D', '#E89B12', '#7F54B3'];
const colorFor = (id) => COLORS[[...String(id)].reduce((s, c) => s + c.charCodeAt(0), 0) % COLORS.length];
const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
};
const routeOf = (s) => { const f = J(s.from_json), t = J(s.to_json); return `${f.city || f.postcode || ''} → ${t.city || t.postcode || ''}`; };

const chip = (on, a) => ({ on: on ? 'true' : 'false', bg: on ? (a || '#1F2A3C') : '#FFFFFF', fg: on ? '#FFFFFF' : '#3E4A5C', border: on ? (a || '#1F2A3C') : '#C9D6EA' });
const sw = (on) => ({ on: on ? 'true' : 'false', bg: on ? '#2463DB' : '#C9D6EA', x: on ? '23px' : '3px' });

const SS = { booked: ['Booked', '#EEF2F7', '#3E4A5C'], coll: ['Collected', '#EAF2FE', '#1D4FB8'], transit: ['In transit', '#EAF2FE', '#1D4FB8'], out: ['Out for delivery', '#E0F2FE', '#0369A1'],
  deliv: ['Delivered', '#E6F4EA', '#166534'], exc: ['Exception', '#FDECEC', '#B42318'] };
const STAGE = { awaiting_label: 'booked', pending: 'booked', purchasing: 'booked', awaiting_payment: 'booked', booked: 'booked', collected: 'coll', in_transit: 'transit', out_for_delivery: 'out', delivered: 'deliv',
  exception: 'exc', failed: 'exc', cancelled: 'exc' };
const AS = { charged: ['Charged', '#E6F4EA', '#166534'], failed: ['Card declined', '#FDECEC', '#B42318'], pending: ['To collect', '#FFF4E0', '#9A5B00'], disputed: ['Disputed', '#EAF2FE', '#1D4FB8'],
  waived: ['Waived', '#EEF2F7', '#3E4A5C'], no_charge: ['No extra charge', '#FFF4E0', '#9A5B00'] };
const OPEN_ADJ = ['pending', 'failed', 'disputed'];
const PR = { urgent: ['Urgent', '#E5484D', '#FFFFFF'], high: ['High', '#FFE3A3', '#7A4A00'], normal: ['Normal', '#EEF2F7', '#3E4A5C'], low: ['Low', '#EEF2F7', '#8593A8'] };
const CAT = { weight_adjustment: 'Weight adjustment', where_is_my_parcel: 'Where is my parcel', damaged_or_missing: 'Damaged or missing', billing: 'Billing and wallet', account: 'My account', other: 'Something else' };
const TKS = { waiting_us: ['Waiting on us', '#FDECEC', '#B42318'], waiting_customer: ['Waiting on customer', '#EEF2F7', '#3E4A5C'], solved: ['Solved', '#E6F4EA', '#166534'] };
const LT = { topup: ['Top-up', '#E6F4EA', '#166534'], label: ['Label', '#EAF2FE', '#1D4FB8'], adjust: ['Adjustment', '#FDECEC', '#B42318'], refund: ['Refund', '#EEF2F7', '#3E4A5C'], fee: ['Fee', '#FFF4E0', '#9A5B00'] };
const ledgerType = (kind) => (kind === 'topup' || kind === 'credit' ? 'topup' : kind === 'adjustment' ? 'adjust' : kind === 'refund' || kind === 'release' ? 'refund' : 'label');
const CANNED = {
  'Weight adjustment explained': 'Hi, thanks for getting in touch. The courier weighed and measured the parcel at their depot and recorded a higher weight than booked, so they billed us the difference. If you think it is wrong, reply with a photo of the parcel on scales and we will dispute it for you.',
  'Trace raised with courier': 'Thanks for flagging this. We have opened a trace with the courier and will update you within 24 hours. You do not need to do anything for now.',
  'Refund added to wallet': 'We have refunded the label to your Kargom wallet. You can see it under Wallet › Transactions straight away.',
  'Claim form needed': 'Sorry this happened. To start a claim, please reply with photos of the outer box, the packaging inside and the damaged item, plus proof of the item’s value.',
};
const NEXT = { 'Waiting on customer': 'waiting_customer', Solved: 'solved', 'Waiting on us': 'waiting_us' };
const PER = { today: ['Today', 1], '7d': ['Last 7 days', 7], '30d': ['Last 30 days', 30], q: ['This quarter', 90] };

/** Design provider cards. `backend` = can be saved and used today. */
const PROV = [
  { g: 'ship', id: 'shipstation', name: 'ShipStation', ini: 'SS', color: '#3B7A57', backend: true, desc: 'Buy labels at your ShipStation carrier rates. Uses the ShipStation API v2 key.',
    chips: ['Royal Mail', 'Evri', 'DPD', 'Parcelforce', 'Yodel', 'UPS', 'DHL'],
    fields: [['apiKey', 'API key (v2)', 'password', 'ShipStation › Settings › Account › API Settings › API v2'], ['carrierIds', 'Carrier IDs (optional)', 'text', 'Leave empty to use every connected carrier, or se-123, se-456']],
    events: ['tracking', 'carrier_adjustment'] },
  { g: 'ship', id: 'shipengine', name: 'ShipEngine', ini: 'SE', color: '#2463DB', backend: true, desc: 'Rates, labels and tracking for UK carriers.', chips: ['Royal Mail', 'Evri', 'DPD', 'Parcelforce', 'Yodel', 'UPS'],
    fields: [['apiKey', 'API key', 'password', 'ShipEngine dashboard › API Management'], ['carrierIds', 'Carrier account IDs', 'text', 'One per connected carrier, comma separated']],
    events: ['track', 'carrier_adjustment'] },
  { g: 'ship', id: 'packlink', name: 'Packlink PRO', ini: 'PL', color: '#FF6B35', backend: true, desc: 'Packlink PRO rates. Labels are issued after you pay the shipment in Packlink PRO (customers are told "Label within 1 hour").',
    chips: ['Evri', 'DPD', 'Royal Mail', 'InPost', 'Yodel', 'UPS'],
    fields: [['apiKey', 'Packlink PRO API key', 'password', 'Packlink PRO › Settings › Packlink PRO API key › Generate']],
    events: ['shipment.label.ready', 'shipment.tracking.update', 'shipment.delivered'] },
  { g: 'ship', id: 'easypost', name: 'EasyPost', ini: 'EP', color: '#1D3593', desc: 'Second source of rates; also used for international.', chips: ['Royal Mail', 'DPD', 'UPS', 'DHL', 'FedEx'],
    fields: [['prod', 'Production API key', 'password', 'Dashboard › API Keys › Production'], ['test', 'Test API key', 'password', 'Used when this connection is in test mode']],
    events: ['tracker.updated', 'shipment.invoice.created', 'refund.successful'] },
  { g: 'ship', id: 'shippo', name: 'Shippo', ini: 'SH', color: '#33AEEF', desc: 'Backup provider.', chips: ['Evri', 'DPD', 'UPS', 'DHL'],
    fields: [['token', 'API token', 'password', 'Settings › API › Tokens']], events: ['track_updated', 'transaction_updated'] },
  { g: 'msg', id: 'resend', name: 'Resend email', ini: 'RE', color: '#1F2A3C', backend: true, desc: 'Free up to 3,000 emails a month: "your label is ready" with the PDF attached and a print button.',
    chips: ['Label PDF attached', 'Free tier', 'From your domain'],
    fields: [['apiKey', 'API key', 'password', 'resend.com › API Keys › Create (starts with re_)'], ['from', 'From address', 'text', 'e.g. Kargom <labels@kargom.eu> (verify kargom.eu in Resend › Domains first)']],
    events: ['label_ready'] },
  { g: 'msg', id: 'smsworks', name: 'The SMS Works', ini: 'SW', color: '#2463DB', backend: true, desc: 'UK SMS: "your label is ready" with a link to print. Pay as you go, about 3–4p per text, credits never expire.',
    chips: ['Label ready SMS', 'UK numbers', 'Sender: Kargom'],
    fields: [['token', 'API token (JWT)', 'password', 'The SMS Works › API Key › Generate: copy the long token'], ['sender', 'Sender name', 'text', '4–11 letters/digits, no spaces, e.g. Kargom']],
    events: ['label_ready'] },
  { g: 'pay', id: 'stripe', name: 'Stripe', ini: 'St', color: '#635BFF', backend: true, desc: 'Cards, Apple Pay and Google Pay: wallet top-ups, card checkout and off-session charges for adjustments.',
    chips: ['Cards', 'Apple Pay', 'Google Pay', 'Saved cards'],
    fields: [['publishableKey', 'Publishable key', 'text', 'Safe to use in the browser'], ['secretKey', 'Secret key', 'password', 'Server only. Use a restricted key if you can'],
      ['webhookSecret', 'Webhook signing secret', 'password', 'Shown after you add the webhook URL below']],
    events: ['payment_intent.succeeded', 'payment_intent.payment_failed', 'charge.refunded', 'charge.dispute.created'] },
  { g: 'pay', id: 'truelayer', name: 'TrueLayer', ini: 'TL', color: '#0B1A2B', desc: 'Pay by bank (Open Banking). Lower fees for large wallet top-ups.', chips: ['Pay by bank', 'Instant refunds'],
    fields: [['clientId', 'Client ID', 'text', 'Console › Settings › App'], ['clientSecret', 'Client secret', 'password', 'Console › Settings › App']], events: ['payment_executed', 'payment_failed'] },
  { g: 'pay', id: 'paypal', name: 'PayPal', ini: 'PP', color: '#003087', desc: 'Optional checkout method for personal customers.', chips: ['PayPal checkout'],
    fields: [['clientId', 'Client ID', 'text', 'Developer › Apps & Credentials'], ['secret', 'Secret', 'password', 'Developer › Apps & Credentials']], events: ['PAYMENT.CAPTURE.COMPLETED'] },
];
function csv(name, rows) {
  const text = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name; document.body.append(a); a.click(); a.remove();
}
const VIEWS = ['over', 'flow', 'adj', 'sup', 'fin', 'cust', 'conn', 'price'];
const startView = new URLSearchParams(location.search).get('view');

class Component extends DCLogic {
  constructor(p) {
    super(p);
    this.state = {
      view: VIEWS.includes(startView) ? startView : 'over', period: '30d', stage: 'all', ledTab: 'all', custTab: 'all', custQ: '', prof: '', profile: null, pTab: 'ship', from: 'cust',
      open: 'shipstation', modeSel: {}, tested: {}, sup: '', qTab: 'waiting_us', rMode: 'reply', nextSt: 'waiting_customer', thread: null, toast: '',
      me: null, ov: null, notif: { enabled: {}, items: [] }, shipments: [], adjustments: [], tickets: [], customers: [], providers: [], live: [], demoPayments: true, fin: null, ledger: [], pricing: null, pricingErr: '',
      rules: { auto: true, retry: true, block: true, notify: true },
    };
  }

  async mounted() {
    try {
      const me = await api('/api/me');
      if (me.role !== 'admin') throw new Error('not admin');
      this.setState({ me });
    } catch {
      location.href = `/login?next=${encodeURIComponent('/admin')}`;
      return;
    }
    await this.reload();
    this.loadView(this.state.view);
    // /admin?customer=<id> opens that customer's profile (links from the Turkey warehouse page).
    const cust = new URLSearchParams(location.search).get('customer');
    if (cust) this.openCustomer(cust);
    setInterval(() => { if (!document.hidden) this.reload().catch(() => {}); }, 30_000);
  }

  async reload() {
    const days = PER[this.state.period][1];
    const [ov, s, a, t, c, p] = await Promise.all([api(`/api/admin/overview?days=${days}`), api('/api/admin/shipments'), api('/api/admin/adjustments'), api('/api/admin/tickets'),
      api('/api/admin/customers'), api('/api/admin/providers')]);
    api('/api/admin/notifications').then((notif) => this.setState({ notif }), () => {});
    api('/api/admin/chat/unread').then((r) => this.setState({ chatUnread: r.unread }), () => {});
    this.setState({ ov, shipments: s.shipments, adjustments: a.adjustments, tickets: t.tickets, customers: c.customers, providers: p.providers, live: p.live, demoPayments: p.demoPayments });
    if (this.state.view === 'sup' && !this.state.sup) this.pickFirstTicket();
  }

  async loadView(v) {
    try {
      if (v === 'fin') {
        const [fin, led] = await Promise.all([api('/api/admin/finance'), api('/api/admin/ledger')]);
        this.setState({ fin, ledger: led.entries });
      }
      if (v === 'price') {
        this.setState({ pricingErr: '' });
        this.setState({ pricing: await api('/api/admin/pricing/preview') });
      }
      if (v === 'sup' && !this.state.sup) this.pickFirstTicket();
    } catch (e) { this.say(e.message); }
  }

  go(v) { if (v === 'tr') { location.href = '/admin/turkey'; return; } if (v === 'chat') { location.href = '/admin/chat'; return; } this.setState({ view: v }); this.loadView(v); history.replaceState(null, '', v === 'over' ? '/admin' : `/admin?view=${v}`); }

  pickFirstTicket() {
    const first = this.state.tickets.find((t) => this.state.qTab === 'all' || t.status === this.state.qTab) || this.state.tickets[0];
    if (first) this.openTicket(first.id);
  }

  async openTicket(id) {
    const thread = await api(`/api/admin/tickets/${id}`);
    this.setState({ sup: id, thread });
    const ta = document.querySelector('[aria-label="Admin reply"]');
    if (ta) { ta.value = ''; ta.dataset.dirty = '0'; }
  }

  async openCustomer(id) {
    if (!id) return;
    const from = this.state.view === 'prof' ? this.state.from : this.state.view;
    this.setState({ view: 'prof', prof: id, profile: null, pTab: 'ship', from });
    try { this.setState({ profile: await api(`/api/admin/customers/${id}`) }); } catch (e) { this.say(e.message); }
  }

  say(text) { this.setState({ toast: text }); setTimeout(() => this.state.toast === text && this.setState({ toast: '' }), 4500); }

  async act(fn, okText) {
    try { await fn(); if (okText) this.say(okText); await this.reload(); } catch (e) { this.say(e.message); }
  }

  renderVals() {
    const st = this.state;
    const me = st.me || { name: '' };
    const go = (v) => () => this.go(v);
    const custName = Object.fromEntries(st.customers.map((c) => [c.id, c.name]));
    const oc = (id) => () => this.openCustomer(id);
    const ov = st.ov || { shipments: 0, gmvPence: 0, netSalesPence: 0, providerCostPence: 0, grossProfitPence: 0, customers: { total: 0, active: 0 }, heldInWalletsPence: 0, adjustments: { open: 0, owedPence: 0 }, supportWaiting: 0 };
    const days = PER[st.period][1];
    const since = Date.now() - days * 86_400_000;
    const inPeriod = st.shipments.filter((s) => new Date(s.created_at).getTime() >= since);

    // adjustments
    const adjByShip = {};
    for (const a of st.adjustments) if (!adjByShip[a.shipment_id]) adjByShip[a.shipment_id] = a;
    const openAdj = st.adjustments.filter((a) => OPEN_ADJ.includes(a.status));
    const usCount = st.tickets.filter((t) => t.status === 'waiting_us').length;

    // ---- nav + header
    const NAV = [['over', 'Overview', ''], ['flow', 'Shipment flow', ''], ['adj', 'Weight adjustments', String(openAdj.length)], ['sup', 'Support', String(usCount)], ['chat', 'Live chat', String(st.chatUnread || 0)], ['fin', 'Finance', ''],
      ['cust', 'Customers', ''], ['conn', 'Connections', ''], ['price', 'Pricing rules', ''], ['tr', 'Turkey warehouse', '']];
    const vv = st.view === 'prof' ? 'cust' : st.view;
    const nav = NAV.map(([id, label, badge]) => ({ label, badge: badge === '0' ? '' : badge, badgeBg: badge && badge !== '0' ? '#E5484D' : 'transparent', cur: vv === id ? 'page' : 'false',
      bg: vv === id ? '#2C3A50' : 'transparent', fg: vv === id ? '#FFFFFF' : '#C9D6EA', dot: vv === id ? '#33AEEF' : '#3B4A63', pick: go(id) }));
    const testMode = st.demoPayments;
    const envs = [['live', 'Live'], ['test', 'Test']].map(([id, label]) => {
      const on = (id === 'test') === testMode;
      return { label, on: on ? 'true' : 'false', bg: on ? (id === 'live' ? '#16A34A' : '#E89B12') : 'transparent', fg: on ? '#FFFFFF' : '#586579',
        pick: () => this.say(id === 'live' ? 'Live mode starts once Stripe is connected and NODE_ENV is production.' : 'Test mode: payments are simulated and labels are test labels.') };
    });
    const periods = Object.keys(PER).map((id) => ({ label: PER[id][0], ...chip(st.period === id), pick: () => { this.setState({ period: id }); this.reload(); } }));

    // ---- overview
    const margin = ov.netSalesPence ? ((ov.grossProfitPence / ov.netSalesPence) * 100).toFixed(1) + '% margin' : 'No sales yet';
    const kpis = [
      { label: 'Label sales (GMV)', value: P(ov.gmvPence), delta: PER[st.period][0], dFg: '#586579' },
      { label: 'Gross profit', value: P(ov.grossProfitPence), delta: margin, dFg: ov.grossProfitPence >= 0 ? '#166534' : '#B42318' },
      { label: 'Shipments', value: int(ov.shipments), delta: PER[st.period][0], dFg: '#586579' },
      { label: 'Active customers', value: int(ov.customers.active), delta: `of ${int(ov.customers.total)} accounts`, dFg: '#586579' },
      { label: 'Held in wallets', value: P(ov.heldInWalletsPence), delta: 'Owed to customers', dFg: '#586579' },
      { label: 'Adjustments to collect', value: P(ov.adjustments.owedPence), delta: `${ov.adjustments.open} open cases`, dFg: ov.adjustments.open ? '#B42318' : '#166534' },
    ];
    const nBars = Math.min(30, Math.max(days, 7));
    const daily = Array.from({ length: nBars }, (_, i) => {
      const d0 = new Date(); d0.setHours(0, 0, 0, 0); d0.setDate(d0.getDate() - (nBars - 1 - i));
      const d1 = d0.getTime() + 86_400_000;
      return st.shipments.filter((s) => { const t = new Date(s.created_at).getTime(); return t >= d0.getTime() && t < d1; }).length;
    });
    const maxD = Math.max(1, ...daily) * 1.1;
    const axDay = (i) => { const d = new Date(); d.setDate(d.getDate() - (nBars - 1 - i)); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
    const ax = [0, Math.round((nBars - 1) / 3), Math.round(((nBars - 1) * 2) / 3), nBars - 1].map(axDay);
    const bars = daily.map((n, i) => ({ h: Math.max(2, Math.round((n / maxD) * 100)) + '%', c: i === daily.length - 1 ? '#2463DB' : '#8FB4F5', tip: `${n} shipments` }));
    const line = daily.map((n, i) => `${((i * 300) / Math.max(1, daily.length - 1)).toFixed(1)},${(96 - (n / maxD) * 90).toFixed(1)}`).join(' ');
    const cardPaid = inPeriod.filter((s) => s.pay_method === 'card').length;
    const avg = inPeriod.length ? inPeriod.reduce((x, s) => x + s.price_pence, 0) / inPeriod.length : 0;
    const funnel = [
      { label: 'Bookings', value: int(inPeriod.length), note: PER[st.period][0] },
      { label: 'Customers booking', value: int(new Set(inPeriod.map((s) => s.customer_id)).size), note: 'Distinct accounts' },
      { label: 'Paid by card', value: inPeriod.length ? Math.round((cardPaid / inPeriod.length) * 100) + '%' : '–', note: 'The rest from wallets' },
      { label: 'Average label', value: inPeriod.length ? P(Math.round(avg)) : '–', note: 'Inc VAT' },
    ];
    const feedItems = [
      ...st.shipments.slice(0, 12).map((s) => ({ at: s.created_at, icon: s.status === 'delivered' ? '✓' : s.status === 'failed' ? '×' : '+', bg: s.status === 'failed' ? '#FDECEC' : s.status === 'delivered' ? '#E6F4EA' : '#EAF2FE',
        fg: s.status === 'failed' ? '#B42318' : s.status === 'delivered' ? '#166534' : '#1D4FB8', t: `${s.status === 'failed' ? 'Booking failed' : 'Label booked'} · ${s.service_name}`, s: `${s.ref} · ${P(s.price_pence)} · ${s.customer_name}` })),
      ...st.adjustments.slice(0, 6).map((a) => ({ at: a.created_at, icon: '!', bg: a.diff_pence > 0 ? '#FDECEC' : '#FFF4E0', fg: a.diff_pence > 0 ? '#B42318' : '#9A5B00',
        t: 'Weight adjustment received', s: `${a.ref} · ${kg(J(a.parcel_json).weightGrams)} → ${kg(J(a.measured_json).weightGrams)}` })),
      ...st.customers.slice(0, 6).map((c) => ({ at: c.created_at, icon: '↑', bg: '#EEF2F7', fg: '#3E4A5C', t: `New ${c.account_type} account`, s: c.name })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 7).map((x) => ({ ...x, ago: ago(x.at) }));
    const feed = feedItems.length ? feedItems : [{ icon: '·', bg: '#EEF2F7', fg: '#586579', t: 'No activity yet', s: 'Bookings, top-ups and adjustments appear here live.', ago: '' }];
    const byCarrier = {};
    for (const s of inPeriod) {
      const k = s.carrier; byCarrier[k] = byCarrier[k] || { n: 0, price: 0, cost: 0 };
      byCarrier[k].n++; byCarrier[k].price += s.price_pence - s.vat_pence; byCarrier[k].cost += s.cost_pence;
    }
    const mixRows = Object.entries(byCarrier).sort((a, b) => b[1].n - a[1].n).slice(0, 6);
    const mix = mixRows.map(([k, v]) => ({ name: CARRIER_NAME[k] || k, logo: CARRIER_LOGO[k] || '', n: int(v.n), mg: v.price ? Math.round(((v.price - v.cost) / v.price) * 100) + '%' : '–',
      w: Math.round((v.n / (mixRows[0]?.[1].n || 1)) * 100) + '%' }));
    const provDesc = Object.fromEntries(st.providers.map((p) => [p.id, p]));
    const ssLive = st.live.includes('shipstation');
    const health = [
      { name: 'ShipStation', ini: 'SS', color: '#3B7A57', note: ssLive ? 'Quoting and buying labels' : 'Add your API key to start', state: ssLive ? 'Connected' : 'Not connected', fg: ssLive ? '#166534' : '#8593A8' },
      { name: 'ShipEngine', ini: 'SE', color: '#2463DB', note: st.live.includes('shipengine') ? 'Quoting and buying labels' : 'Optional second source', state: st.live.includes('shipengine') ? 'Connected' : 'Not connected', fg: st.live.includes('shipengine') ? '#166534' : '#8593A8' },
      ...(st.live.includes('packlink') ? [{ name: 'Packlink PRO', ini: 'PL', color: '#FF6B35', note: 'Labels after payment in Packlink PRO', state: 'Connected', fg: '#166534' }] : []),
      { name: 'Stripe', ini: 'St', color: '#635BFF', note: st.demoPayments ? 'Test mode · payments simulated' : 'Payments and webhooks', state: st.demoPayments ? 'Test' : 'Connected', fg: st.demoPayments ? '#9A5B00' : '#166534' },
      { name: 'WhatsApp', ini: 'WA', color: '#1FAF38', note: st.notif.enabled.whatsapp ? 'Labels sent with the PDF' : 'Add WHATSAPP_TOKEN to send labels', state: st.notif.enabled.whatsapp ? 'Connected' : 'Not connected', fg: st.notif.enabled.whatsapp ? '#166534' : '#8593A8' },
      { name: 'Email (Resend)', ini: 'RE', color: '#1F2A3C', note: st.notif.enabled.email ? 'Label PDF by email' : 'Connect Resend in Connections (free)', state: st.notif.enabled.email ? 'Connected' : 'Not connected', fg: st.notif.enabled.email ? '#166534' : '#8593A8' },
      { name: 'SMS', ini: 'SM', color: '#E5484D', note: st.notif.enabled.sms ? 'Label link by SMS' : 'Connect The SMS Works in Connections', state: st.notif.enabled.sms ? 'Connected' : 'Not connected', fg: st.notif.enabled.sms ? '#166534' : '#8593A8' },
      { name: 'Courier webhooks', ini: 'WH', color: '#1F2A3C', note: 'Tracking and weight updates', state: 'Listening', fg: '#166534' },
      ...(st.live.includes('mock') ? [{ name: 'Demo rates', ini: 'DM', color: '#E89B12', note: 'Sample prices while no provider is connected', state: 'Test', fg: '#9A5B00' }] : []),
    ];
    const alerts = [
      ...(openAdj.length ? [{ t: `${openAdj.length} weight adjustment${openAdj.length > 1 ? 's' : ''} to resolve`, s: `${P(openAdj.reduce((x, a) => x + a.diff_pence, 0))} to collect.`, bg: '#FDF2F2', dot: '#E5484D', go: go('adj') }] : []),
      ...(usCount ? [{ t: `${usCount} support request${usCount > 1 ? 's' : ''} waiting`, s: st.tickets.some((t) => t.overdue) ? 'At least one is overdue.' : 'Reply before the SLA runs out.', bg: '#FDF2F2', dot: '#E5484D', go: go('sup') }] : []),
      ...(st.shipments.some((s) => s.status === 'awaiting_label') ? [{ t: `${st.shipments.filter((s) => s.status === 'awaiting_label').length} Packlink label${st.shipments.filter((s) => s.status === 'awaiting_label').length > 1 ? 's' : ''} waiting for payment`,
        s: 'Customers have paid. Open Packlink PRO › Ready for payment and pay them so the labels are issued.', bg: '#FFF8EC', dot: '#E89B12', go: () => window.open('https://pro.packlink.com', '_blank', 'noopener') }] : []),
      ...(st.notif.items.some((n) => n.status === 'failed') ? [{ t: `${st.notif.items.filter((n) => n.status === 'failed').length} label message${st.notif.items.filter((n) => n.status === 'failed').length > 1 ? 's' : ''} not delivered`,
        s: `Latest: ${st.notif.items.find((n) => n.status === 'failed').channel} · ${st.notif.items.find((n) => n.status === 'failed').detail || ''}. Click to send again.`, bg: '#FDF2F2', dot: '#E5484D',
        go: async () => { const ids = [...new Set(st.notif.items.filter((n) => n.status === 'failed').map((n) => n.shipment_id))]; for (const id of ids) await api(`/api/admin/shipments/${id}/notify`, { method: 'POST', body: {} }).catch(() => {}); this.say('Sent again'); this.reload(); } }] : []),
      ...(!ssLive ? [{ t: 'Connect ShipStation', s: 'Add your API key to start buying labels through it.', bg: '#EAF2FE', dot: '#2463DB', go: go('conn') }] : []),
      ...(st.demoPayments ? [{ t: 'Connect Stripe to take real payments', s: 'Until then top-ups and card payments are simulated.', bg: '#FFF8EC', dot: '#E89B12', go: go('conn') }] : []),
    ];
    if (!alerts.length) alerts.push({ t: 'All clear', s: 'Nothing needs your attention right now.', bg: '#E6F4EA', dot: '#16A34A', go: go('flow') });

    // ---- flow
    const stCount = (id) => (id === 'all' ? inPeriod.length : inPeriod.filter((s) => STAGE[s.status] === id).length);
    const stages = [['all', 'All', PER[st.period][0]], ['booked', 'Booked', 'Label printed'], ['coll', 'Collected', 'Scanned by courier'], ['transit', 'In transit', 'Between depots'],
      ['out', 'Out for delivery', 'On the van'], ['deliv', 'Delivered', 'Proof of delivery'], ['exc', 'Exception', 'Failed, damaged, held']].map(([id, label, note]) => {
      const on = st.stage === id, c = id === 'all' ? ['', '', '#1F2A3C'] : SS[id];
      return { label, note, n: int(stCount(id)), on: on ? 'true' : 'false', border: on ? '#2463DB' : '#E1E7EF', bg: on ? '#F5F9FF' : '#FFFFFF', fg: c[2], pick: () => this.setState({ stage: id }) };
    });
    const adjTxt = (a) => `${kg(J(a.parcel_json).weightGrams)} → ${kg(J(a.measured_json).weightGrams)}${a.diff_pence > 0 ? ` · ${P(a.diff_pence)} extra` : ' · same price, no extra charge'}`;
    const flowRows = inPeriod.filter((s) => st.stage === 'all' || STAGE[s.status] === st.stage).slice(0, 200).map((s) => {
      const a = adjByShip[s.id], c = SS[STAGE[s.status] || 'booked'];
      return { no: s.ref, time: dateTime(s.created_at), cust: s.customer_name, openCust: oc(s.customer_id), route: routeOf(s), logo: CARRIER_LOGO[s.carrier] || '', svc: s.service_name,
        via: s.provider === 'shipstation' ? 'ShipStation' : s.provider === 'shipengine' ? 'ShipEngine' : s.provider === 'mock' ? 'Demo' : s.provider,
        cost: P(s.cost_pence), price: P(s.price_pence), margin: P(s.price_pence - s.vat_pence - s.cost_pence), paid: s.pay_method === 'card' ? 'Card' : 'Wallet',
        status: s.status === 'failed' ? 'Failed, refunded' : s.status === 'cancelled' ? 'Cancelled' : s.status === 'awaiting_label' ? 'Waiting for label' : c[0], sBg: c[1], sFg: c[2],
        adj: !!a, adjTxt: a ? adjTxt(a) : '', adjBg: a && a.diff_pence === 0 ? '#E89B12' : '#E5484D' };
    });

    // ---- adjustments
    const adjRows = st.adjustments.map((a) => {
      const S = AS[a.status] || AS.pending, d = J(a.parcel_json), m = J(a.measured_json);
      return { no: a.ref, cust: a.customer_name, openCust: oc(a.customer_id), svc: a.service_name, from: kg(d.weightGrams) + dims(d), to: kg(m.weightGrams) + dims(m),
        toFg: a.diff_pence > 0 ? '#B42318' : '#9A5B00', src: `${CARRIER_NAME[a.carrier] || a.carrier} · ${dateTime(a.created_at)}`, cost: P(a.new_price_pence - a.old_price_pence),
        charge: a.diff_pence > 0 ? P(a.diff_pence) : '£0.00 · same price', method: a.method === 'card' ? 'Saved card' : a.method === 'wallet' ? 'Wallet' : '–',
        status: S[0], sBg: S[1], sFg: S[2], actionable: OPEN_ADJ.includes(a.status), chargeTxt: a.status === 'failed' ? 'Retry card' : a.status === 'disputed' ? 'Uphold' : 'Charge now',
        charge_: () => this.act(() => api(`/api/admin/adjustments/${a.id}/charge`, { method: 'POST' }), `Collection attempted for ${a.ref}`),
        waive: () => this.act(() => api(`/api/admin/adjustments/${a.id}/waive`, { method: 'POST' }), 'Adjustment waived. The customer will be told.') };
    });
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const thisMonth = st.adjustments.filter((a) => new Date(a.created_at) >= monthStart);
    const adjStats = [
      { label: 'Open cases', value: String(openAdj.length), note: 'To collect, declined or disputed', color: openAdj.length ? '#B42318' : '#166534' },
      { label: 'Collected this month', value: P(thisMonth.filter((a) => a.status === 'charged').reduce((x, a) => x + a.diff_pence, 0)), note: 'From wallets and cards', color: '#166534' },
      { label: 'Adjustments this month', value: String(thisMonth.length), note: 'Re-measured by couriers', color: '#1F2A3C' },
      { label: 'Re-measured, same price', value: String(st.adjustments.filter((a) => a.status === 'no_charge').length), note: 'Heavier but same price band: no charge', color: '#9A5B00' },
    ];
    const RL = [['auto', 'Charge automatically', 'Take the difference as soon as the webhook arrives'], ['retry', 'Retry declined cards', 'Try again after 24 hours, then every 3 days'],
      ['block', 'Pause bookings if unpaid', 'When the customer owes more than £20'], ['notify', 'Tell the customer', 'Email with the courier’s measurement']];
    const adjRules = RL.map(([id, label, note]) => ({ label, note, ...sw(st.rules[id]),
      toggle: () => this.say(id === 'auto' || id === 'block' ? 'This rule is always on in this version.' : 'Saved. Applies from the next adjustment.') }));

    // ---- support
    const PRIO = (t) => PR[t.priority] || PR.normal;
    const qList = st.tickets.filter((t) => st.qTab === 'all' || t.status === st.qTab);
    const curT = st.thread?.ticket;
    const minsTo = (iso) => Math.round((new Date(iso).getTime() - Date.now()) / 60000);
    const slaTxt = (t) => {
      if (t.status === 'waiting_customer') return 'Waiting on customer';
      if (t.status === 'solved') return 'Solved';
      const m = minsTo(t.slaDueAt);
      const h = (x) => (Math.abs(x) >= 60 ? `${Math.floor(Math.abs(x) / 60)}h ${Math.abs(x) % 60}m` : `${Math.abs(x)}m`);
      return m < 0 ? `Overdue ${h(m)}` : `Due in ${h(m)}`;
    };
    const queue = qList.map((t) => {
      const on = curT && t.id === curT.id, p = PRIO(t);
      return { no: t.ref, subject: t.subject, cust: custName[t.customer_id] || 'Customer', cat: CAT[t.category] || t.category, prio: p[0], pBg: p[1], pFg: p[2], sla: slaTxt(t),
        slaFg: t.status === 'waiting_us' && t.overdue ? '#B42318' : t.status === 'waiting_us' ? '#9A5B00' : '#8593A8',
        cur: on ? 'true' : 'false', border: on ? '#2463DB' : '#E1E7EF', bg: on ? '#F5F9FF' : '#FFFFFF', pick: () => this.openTicket(t.id) };
    });
    const qTabs = [['waiting_us', 'Waiting on us'], ['waiting_customer', 'Waiting on customer'], ['solved', 'Solved'], ['all', 'All']].map(([id, label]) => ({ label,
      n: id === 'all' ? st.tickets.length : st.tickets.filter((t) => t.status === id).length, ...chip(st.qTab === id), pick: () => this.setState({ qTab: id }) }));
    const tkCust = curT ? st.customers.find((c) => c.id === curT.customer_id) : null;
    const thread = (st.thread?.messages || []).map((m) => {
      const c = m.author_type === 'customer', n = m.author_type === 'note';
      return { who: c ? tkCust?.name || 'Customer' : n ? `${me.name} · internal note` : 'Kargom support', time: dateTime(m.created_at), text: m.body, file: '', hasFile: false,
        align: c ? 'flex-start' : 'flex-end', bg: c ? '#FFFFFF' : n ? '#FFF8EC' : '#2463DB', fg: c || n ? '#1F2A3C' : '#FFFFFF', border: c ? '#E1E7EF' : n ? '#F5D9A8' : '#2463DB',
        radius: c ? '14px 14px 14px 4px' : '14px 14px 4px 14px' };
    });
    if (!curT) thread.push({ who: 'Kargom', time: '', text: st.tickets.length ? 'Pick a request on the left.' : 'No support requests yet. When a customer opens one from their Help tab it lands here.', file: '', hasFile: false,
      align: 'flex-start', bg: '#F4F6FA', fg: '#586579', border: '#E1E7EF', radius: '14px' });
    const tk = curT ? { no: curT.ref, subject: curT.subject, cust: tkCust?.name || 'Customer', cat: CAT[curT.category] || curT.category } : { no: '–', subject: 'Support inbox', cust: '', cat: '' };
    const kv = ([k, v, fg]) => ({ k, v, fg: fg || '#1F2A3C' });
    const tkInfo = tkCust ? [['Account', tkCust.account_type === 'business' ? 'Business' : 'Personal'], ['Wallet', P(tkCust.wallet_pence)],
      ['Unpaid', tkCust.owed_pence ? P(tkCust.owed_pence) : '–', tkCust.owed_pence ? '#B42318' : ''], ['Shipments', int(tkCust.shipments)]].map(kv) : [];
    const tkShipRow = curT?.shipment_id ? st.shipments.find((s) => s.id === curT.shipment_id) : null;
    const tkAdj = tkShipRow ? adjByShip[tkShipRow.id] : null;
    const tkShip = tkShipRow ? [['Shipment', tkShipRow.ref], ['Service', tkShipRow.service_name], ['Status', (SS[STAGE[tkShipRow.status]] || SS.booked)[0]],
      ...(tkAdj ? [['Adjustment', adjTxt(tkAdj), tkAdj.diff_pence > 0 ? '#B42318' : '#9A5B00']] : [['Tracking', tkShipRow.tracking_number || '–']])].map(kv) : [kv(['Shipment', 'None'])];
    const tkActions = curT ? [
      ...(tkAdj && OPEN_ADJ.includes(tkAdj.status) ? [{ label: `Waive the ${P(tkAdj.diff_pence)}`, go: () => this.act(() => api(`/api/admin/adjustments/${tkAdj.id}/waive`, { method: 'POST' }), 'Adjustment waived.') }] : []),
      ...(tkCust?.bookings_paused ? [{ label: 'Unpause bookings', go: () => this.act(() => api(`/api/admin/customers/${tkCust.id}/pause`, { method: 'POST', body: { paused: false } }), 'Bookings unpaused.') }] : []),
      ...(tkShipRow?.label_url ? [{ label: 'Open label', go: () => window.open(tkShipRow.label_url, '_blank', 'noopener') }] : []),
      { label: 'Open customer profile', go: oc(curT.customer_id) },
    ] : [];
    const isNote = st.rMode === 'note';
    const replyModes = [['reply', 'Reply to customer'], ['note', 'Internal note']].map(([id, label]) => ({ label, on: st.rMode === id ? 'true' : 'false',
      bg: st.rMode === id ? (id === 'note' ? '#E89B12' : '#2463DB') : 'transparent', fg: st.rMode === id ? '#FFFFFF' : '#586579', pick: () => this.setState({ rMode: id }) }));
    const sendAdmin = async () => {
      if (!curT) return;
      const body = field('Admin reply').trim();
      if (!body) { this.say('Write a message first.'); return; }
      try {
        await api(`/api/admin/tickets/${curT.id}/reply`, { method: 'POST', body: { body, internal: isNote, nextStatus: st.nextSt } });
        this.say(isNote ? 'Note added' : `Reply sent to ${tk.cust}`);
        await this.openTicket(curT.id);
        await this.reload();
      } catch (e) { this.say(e.message); }
    };
    const waitingOld = st.tickets.filter((t) => t.status === 'waiting_us').sort((a, b) => a.updated_at.localeCompare(b.updated_at))[0];
    const weekAgo = Date.now() - 7 * 86_400_000;
    const supStats = [
      { label: 'Waiting on us', value: String(usCount), note: waitingOld ? `Oldest: ${slaTxt(waitingOld).toLowerCase()}` : 'Inbox zero', color: usCount ? '#B42318' : '#166534' },
      { label: 'Waiting on customer', value: String(st.tickets.filter((t) => t.status === 'waiting_customer').length), note: 'They have our reply', color: '#1F2A3C' },
      { label: 'Opened this week', value: String(st.tickets.filter((t) => new Date(t.created_at).getTime() >= weekAgo).length), note: 'New requests', color: '#1F2A3C' },
      { label: 'Solved this week', value: String(st.tickets.filter((t) => t.status === 'solved' && new Date(t.updated_at).getTime() >= weekAgo).length), note: 'Closed requests', color: '#166534' },
      { label: 'All requests', value: String(st.tickets.length), note: 'Since launch', color: '#1F2A3C' },
    ];

    // ---- finance
    const fin = st.fin || { cashStripePence: 0, customerWalletsPence: 0, inFlightHoldsPence: 0, netRevenuePence: 0, vatOutputPence: 0, providerCostPence: 0, payables: [], trialBalancePence: 0 };
    const pnl = [
      { label: 'Label sales inc VAT', value: P(fin.netRevenuePence + fin.vatOutputPence), note: 'What customers paid (all time)', fg: '#1F2A3C', line: '#2463DB' },
      { label: 'Net sales', value: P(fin.netRevenuePence), note: 'After 20% VAT', fg: '#1F2A3C', line: '#33AEEF' },
      { label: 'Provider costs', value: P(-fin.providerCostPence), note: 'ShipStation and other providers', fg: '#B42318', line: '#E5484D' },
      { label: 'Gross profit', value: P(fin.netRevenuePence - fin.providerCostPence), note: fin.netRevenuePence ? `${(((fin.netRevenuePence - fin.providerCostPence) / fin.netRevenuePence) * 100).toFixed(1)}% of net sales` : 'No sales yet', fg: '#166534', line: '#16A34A' },
      { label: 'VAT to pay HMRC', value: P(fin.vatOutputPence), note: 'Output VAT on labels', fg: '#9A5B00', line: '#E89B12' },
      { label: 'Ledger check', value: fin.trialBalancePence === 0 ? 'Balanced' : P(fin.trialBalancePence), note: 'Debits = credits', fg: fin.trialBalancePence === 0 ? '#166534' : '#B42318', line: '#1F2A3C' },
    ];
    const sumBy = (pred) => st.ledger.filter(pred).reduce((x, l) => x + l.amount, 0);
    const walletRows = [
      { k: 'Top-ups and credits', v: '+' + P(sumBy((l) => l.method === 'Wallet' && l.amount > 0 && (l.kind === 'topup' || l.kind === 'credit'))), fg: '#166534' },
      { k: 'Spent on labels and adjustments', v: P(sumBy((l) => l.method === 'Wallet' && l.amount < 0)), fg: '#1F2A3C' },
      { k: 'Refunds back to wallets', v: '+' + P(sumBy((l) => l.method === 'Wallet' && l.amount > 0 && (l.kind === 'refund' || l.kind === 'release'))), fg: '#1F2A3C' },
      { k: 'Held for bookings in progress', v: P(fin.inFlightHoldsPence), fg: '#1F2A3C' },
      { k: 'Closing balance', v: P(fin.customerWalletsPence), fg: '#1F2A3C' },
    ];
    const paidWallet = st.shipments.filter((s) => s.pay_method === 'wallet' && !['failed', 'cancelled'].includes(s.status)).reduce((x, s) => x + s.price_pence, 0);
    const paidCard = st.shipments.filter((s) => s.pay_method === 'card' && !['failed', 'cancelled'].includes(s.status)).reduce((x, s) => x + s.price_pence, 0);
    const tot = paidWallet + paidCard || 1;
    const payMix = [{ k: 'Wallet', v: P(paidWallet), p: Math.round((paidWallet / tot) * 100) + '%', c: '#2463DB' }, { k: 'Card at checkout', v: P(paidCard), p: Math.round((paidCard / tot) * 100) + '%', c: '#33AEEF' },
      { k: 'Pay by bank', v: P(0), p: '0%', c: '#1D3593' }];
    const payables = fin.payables.length ? fin.payables.map((p) => ({ name: p.provider === 'shipstation' ? 'ShipStation' : p.provider === 'mock' ? 'Demo provider (test)' : p.provider, ini: (p.provider || '?').slice(0, 2).toUpperCase(),
      color: p.provider === 'shipstation' ? '#3B7A57' : '#2463DB', due: 'Billed by the provider', dueFg: '#586579', amt: P(p.owedPence) }))
      : [{ name: 'No provider bills yet', ini: '–', color: '#8593A8', due: 'Appears after your first label', dueFg: '#586579', amt: P(0) }];
    const refName = Object.fromEntries([...st.shipments.map((s) => [s.id, s.ref]), ...st.adjustments.map((a) => [a.id, `${a.ref} adjustment`])]);
    const ledger = st.ledger.filter((l) => l.amount !== 0).map((l) => ({ ...l, t: ledgerType(l.kind) })).filter((l) => st.ledTab === 'all' || l.t === st.ledTab).map((l) => ({
      time: dateTime(l.created_at), type: LT[l.t][0], bg: LT[l.t][1], fg: LT[l.t][2], cust: l.customerName || '–', openCust: oc(l.customerId), ref: refName[l.ref] || l.memo || l.ref || l.kind, method: l.method,
      amt: (l.amount > 0 ? '+' : '') + P(l.amount), aFg: l.amount < 0 ? '#B42318' : '#1F2A3C' }));
    const ledTabs = [['all', 'All'], ['topup', 'Top-ups'], ['label', 'Labels'], ['adjust', 'Adjustments'], ['refund', 'Refunds'], ['fee', 'Fees']].map(([id, label]) => ({ label, ...chip(st.ledTab === id), pick: () => this.setState({ ledTab: id }) }));

    // ---- customers
    const C = st.customers;
    const biz = C.filter((c) => c.account_type === 'business');
    const owers = C.filter((c) => c.owed_pence > 0);
    const activeIds = new Set(st.shipments.filter((s) => new Date(s.created_at).getTime() >= Date.now() - 30 * 86_400_000).map((s) => s.customer_id));
    const spenders = C.filter((c) => c.spend_pence > 0);
    const custStats = [
      { label: 'Accounts', value: int(C.length), delta: `${C.filter((c) => new Date(c.created_at).getTime() >= Date.now() - 7 * 86_400_000).length} new this week`, dFg: '#166534' },
      { label: 'Active in 30 days', value: int(activeIds.size), delta: C.length ? `${Math.round((activeIds.size / C.length) * 100)}% of accounts` : '–', dFg: '#586579' },
      { label: 'Business accounts', value: int(biz.length), delta: C.length ? `${Math.round((biz.length / C.length) * 100)}% of accounts` : '–', dFg: '#586579' },
      { label: 'Average spend', value: spenders.length ? P(Math.round(spenders.reduce((x, c) => x + c.spend_pence, 0) / spenders.length)) : '–', delta: 'Per paying customer', dFg: '#586579' },
      { label: 'Owe us money', value: String(owers.length), delta: `${P(owers.reduce((x, c) => x + c.owed_pence, 0))} unpaid`, dFg: owers.length ? '#B42318' : '#586579' },
    ];
    const CS = { active: ['Active', '#E6F4EA', '#166534'], paused: ['Bookings paused', '#FDECEC', '#B42318'], new: ['New', '#EAF2FE', '#1D4FB8'] };
    const q = st.custQ.trim().toLowerCase();
    const custRows = C.filter((c) => st.custTab === 'all' || (st.custTab === 'biz' && c.account_type === 'business') || (st.custTab === 'pers' && c.account_type !== 'business') || (st.custTab === 'owe' && c.owed_pence > 0))
      .filter((c) => !q || `${c.name} ${c.email} ${c.company || ''}`.toLowerCase().includes(q))
      .map((c) => { const s = c.bookings_paused ? 'paused' : c.shipments === 0 ? 'new' : 'active';
        return { name: c.name, openCust: oc(c.id), email: c.account_type === 'guest' ? c.company : c.email, type: c.account_type === 'business' ? 'Business' : c.account_type === 'guest' ? 'Guest checkout' : 'Personal', joined: new Date(c.created_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
          n: int(c.shipments), spend: P(c.spend_pence), wallet: P(c.wallet_pence), owed: c.owed_pence ? P(c.owed_pence) : '–', owFg: c.owed_pence ? '#B42318' : '#8593A8',
          status: CS[s][0], sBg: CS[s][1], sFg: CS[s][2], color: colorFor(c.id), ini: ini(c.name) }; });
    const custTabs = [['all', 'All'], ['biz', 'Business'], ['pers', 'Personal'], ['owe', 'Owes money']].map(([id, label]) => ({ label, ...chip(st.custTab === id), pick: () => this.setState({ custTab: id }) }));

    // ---- customer profile
    const pr = st.profile;
    const pc = pr?.customer || { name: 'Loading…', email: '', account_type: 'personal', created_at: new Date().toISOString(), id: st.prof };
    const paused = !!pc.bookings_paused;
    const pShips = pr?.shipments || [];
    const pAdj = Object.fromEntries((pr?.adjustments || []).map((a) => [a.shipment_id, a]));
    const ships = pShips.map((s) => {
      const t = J(s.to_json), a = pAdj[s.id], d = J(s.parcel_json), c = SS[STAGE[s.status] || 'booked'];
      const w = a ? `${kg(d.weightGrams)} → ${kg(J(a.measured_json).weightGrams)}${a.diff_pence > 0 ? ` · +${P(a.diff_pence)}` : ' · no charge'}` : kg(d.weightGrams || 0);
      return { no: s.ref, date: shortDate(s.created_at), src: 'Panel', to: t.name || '', town: `${t.city || ''} ${t.postcode || ''}`.trim(), logo: CARRIER_LOGO[s.carrier] || '', svc: s.service_name, kg: w,
        wFg: a ? (a.diff_pence > 0 ? '#B42318' : '#9A5B00') : '#1F2A3C', price: P(s.price_pence), status: c[0], sBg: c[1], sFg: c[2] };
    });
    const addrItem = (x) => ({ label: x.address.company || x.address.name || 'Address', name: x.address.name || '', phone: x.address.phone || '–',
      line: [x.address.line1, x.address.line2, x.address.city, x.address.postcode, x.address.country !== 'GB' ? x.address.country : ''].filter(Boolean).join(', '), tag: '', used: `${x.used} time${x.used > 1 ? 's' : ''}` });
    const sendA = (pr?.addresses || []).filter((x) => x.kind === 'collection').map(addrItem);
    const recA = (pr?.addresses || []).filter((x) => x.kind === 'recipient').map(addrItem);
    if (sendA[0]) sendA[0].tag = 'Most used';
    const addrGroups = [{ title: 'Collection addresses', n: sendA.length, items: sendA }, { title: 'Recipients', n: recA.length, items: recA }];
    const prods = [];
    const cards = pc.default_payment_method ? [{ brand: 'CARD', bg: '#1A1F71', label: 'Saved card', note: 'Stored with Stripe' }] : [{ brand: '–', bg: '#8593A8', label: 'No saved card', note: 'Saved on first card payment' }];
    const pays = (pr?.statement || []).map((l) => { const t = ledgerType(l.kind);
      return { date: shortDate(l.created_at), type: LT[t][0], bg: LT[t][1], fg: LT[t][2], detail: l.memo || l.ref || l.kind, method: 'Wallet', amt: (l.amount > 0 ? '+' : '') + P(l.amount), aFg: l.amount > 0 ? '#166534' : '#1F2A3C' }; });
    const ptickets = (pr?.tickets || []).map((t) => { const s = TKS[t.status] || TKS.waiting_us;
      return { no: t.ref, subject: t.subject, status: s[0], sBg: s[1], sFg: s[2], open: () => { this.setState({ view: 'sup', qTab: 'all' }); this.openTicket(t.id); } }; });
    const notes = [{ who: 'System', when: shortDate(pc.created_at), text: 'Account created.' }];
    const spend = pShips.filter((s) => !['failed', 'awaiting_payment', 'cancelled'].includes(s.status)).reduce((x, s) => x + s.price_pence, 0);
    const monthN = pShips.filter((s) => new Date(s.created_at) >= monthStart).length;
    const owed = (pr?.adjustments || []).filter((a) => ['pending', 'failed'].includes(a.status)).reduce((x, a) => x + a.diff_pence, 0);
    const totalCarrier = (pr?.carriers || []).reduce((x, c) => x + c.n, 0) || 1;
    const pf = {
      name: pc.name, ini: ini(pc.name), color: colorFor(pc.id), email: pc.account_type === 'guest' ? pc.company : pc.email, phone: pc.phone || '–', company: pc.company || 'No company',
      type: pc.account_type === 'business' ? 'Business' : pc.account_type === 'guest' ? 'Guest checkout' : 'Personal', joined: new Date(pc.created_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
      status: paused ? 'Bookings paused' : pShips.length ? 'Active' : 'New', sBg: paused ? '#FDECEC' : '#E6F4EA', sFg: paused ? '#B42318' : '#166534', pauseTxt: paused ? 'Unpause bookings' : 'Pause bookings',
      tags: [pc.account_type === 'business' ? 'Business' : 'Personal', ...(pc.default_payment_method ? ['Saved card'] : []), ...(pc.pricing_discount_bp ? [`−${pc.pricing_discount_bp / 100}% markup`] : [])],
      kpis: [{ label: 'Shipments', value: int(pShips.length), fg: '#1F2A3C' }, { label: 'This month', value: String(monthN), fg: '#1F2A3C' }, { label: 'Total spend', value: P(spend), fg: '#1F2A3C' },
        { label: 'Average label', value: pShips.length ? P(Math.round(spend / pShips.length)) : '–', fg: '#1F2A3C' }, { label: 'Wallet', value: P(pr?.walletPence || 0), fg: '#1F2A3C' },
        { label: 'Unpaid', value: owed ? P(owed) : '–', fg: owed ? '#B42318' : '#8593A8' }, { label: 'Weight adjustments', value: String((pr?.adjustments || []).length), fg: (pr?.adjustments || []).length ? '#9A5B00' : '#1F2A3C' },
        { label: 'Support requests', value: String(ptickets.length), fg: '#1F2A3C' }],
      ships, shipsShown: ships.length, shipsTotal: int(pShips.length), addrGroups, prods, cards, pays, tickets: ptickets, noTickets: ptickets.length ? '' : 'No support requests yet.', notes,
      mix: (pr?.carriers || []).slice(0, 5).map((c) => ({ name: CARRIER_NAME[c.carrier] || c.carrier, logo: CARRIER_LOGO[c.carrier] || '', p: Math.round((c.n / totalCarrier) * 100) + '%' })),
      facts: [{ k: 'Customer ID', v: pc.id, fg: '#1F2A3C' }, { k: 'Pricing', v: pc.pricing_discount_bp ? `−${pc.pricing_discount_bp / 100}% markup` : 'Standard', fg: '#1F2A3C' },
        { k: 'Integrations', v: 'None', fg: '#1F2A3C' }, { k: 'Stripe customer', v: pc.stripe_customer_id || '–', fg: '#1F2A3C' },
        { k: 'Risk', v: owed > 2000 ? 'Watch: unpaid balance' : 'Low', fg: owed > 2000 ? '#B42318' : '#166534' }],
    };
    const PTB = [['ship', 'Shipments', int(pShips.length)], ['addr', 'Addresses', String(sendA.length + recA.length)], ['prod', 'Products', '0'], ['pay', 'Payments', ''], ['sup', 'Support', String(ptickets.length)], ['notes', 'Notes', '1']];
    const pTabs = PTB.map(([id, label, n]) => ({ label, n, on: st.pTab === id ? 'true' : 'false', line: st.pTab === id ? '#2463DB' : 'transparent', fg: st.pTab === id ? '#1F2A3C' : '#586579', pick: () => this.setState({ pTab: id }) }));
    const pt = { ship: st.pTab === 'ship', addr: st.pTab === 'addr', prod: st.pTab === 'prod', pay: st.pTab === 'pay', sup: st.pTab === 'sup', notes: st.pTab === 'notes' };
    const BACK = { over: 'Overview', flow: 'Shipment flow', adj: 'Weight adjustments', sup: 'Support', fin: 'Finance', cust: 'Customers' };
    const pAct = {
      mail: () => { location.href = `mailto:${pc.email}`; },
      credit: async () => {
        const amount = window.prompt(`Add wallet credit for ${pc.name} (£):`, '5.00');
        if (!amount) return;
        const reason = window.prompt('Reason (the customer sees this):', 'Goodwill credit');
        if (!reason) return;
        try { await api(`/api/admin/customers/${pc.id}/credit`, { method: 'POST', body: { amount, reason }, idempotencyKey: uid() }); this.say(`£${amount} added to the wallet`); this.openCustomer(pc.id); this.reload(); } catch (e) { this.say(e.message); }
      },
      pause: async () => {
        try { await api(`/api/admin/customers/${pc.id}/pause`, { method: 'POST', body: { paused: !paused } }); this.say(paused ? 'Bookings unpaused' : 'Bookings paused'); this.openCustomer(pc.id); this.reload(); } catch (e) { this.say(e.message); }
      },
      view: () => { this.setState({ pTab: 'ship' }); },
      note: () => this.say('Customer notes are coming in the next update.'),
    };

    // ---- connections
    const origin = location.origin;
    const conItem = (p) => {
      const d = provDesc[p.id];
      const envLive = st.live.includes(p.id) && !d?.enabled;
      const conn = (!!d?.enabled) || envLive || (p.id === 'stripe' && !st.demoPayments) || (['netgsm', 'smsworks', 'resend'].includes(p.id) && Boolean(d?.enabled));
      const mode = st.modeSel[p.id] || d?.mode || 'test';
      const isOpen = st.open === p.id, t = st.tested[p.id];
      const state = !p.backend ? 'Coming soon' : envLive ? 'Connected · server key' : !conn ? 'Not connected' : mode === 'live' ? 'Connected · Live' : 'Connected · Test';
      return { name: p.name, ini: p.ini, color: p.color, desc: p.desc, chips: p.chips, state, sBg: !conn ? '#EEF2F7' : mode === 'live' || envLive ? '#E6F4EA' : '#FFF4E0', sFg: !conn ? '#586579' : mode === 'live' || envLive ? '#166534' : '#9A5B00',
        border: isOpen ? '#2463DB' : '#E1E7EF', isOpen, open: isOpen ? 'true' : 'false', openTxt: isOpen ? 'Close' : conn ? 'Configure' : p.backend ? 'Connect' : 'Details',
        toggleOpen: () => this.setState({ open: isOpen ? '' : p.id }),
        modes: [['test', 'Test'], ['live', 'Live']].map(([m, label]) => ({ label, on: mode === m ? 'true' : 'false', bg: mode === m ? (m === 'live' ? '#16A34A' : '#E89B12') : 'transparent', fg: mode === m ? '#FFFFFF' : '#586579',
          pick: () => this.setState({ modeSel: { ...st.modeSel, [p.id]: m } }) })),
        fields: p.fields.map(([key, label, type, help]) => ({ label, type, key: `${p.id}.${key}`, value: '', ph: d?.fields?.[key] ? `Saved: ${d.fields[key]} · paste to replace` : envLive && key === 'apiKey' ? 'Set on the server (Render env)' : 'Paste here', help })),
        hook: ['netgsm', 'smsworks', 'resend'].includes(p.id) ? 'No webhook needed' : p.id === 'stripe' ? `${origin}/webhooks/stripe` : p.backend ? `${origin}/webhooks/carrier/${p.id}/YOUR_CARRIER_WEBHOOK_TOKEN` : 'Available when this provider is supported',
        events: p.events,
        where: (e) => { e.preventDefault(); this.say(`The grey hint under each box says where to find it in ${p.name}.`); },
        copy: async () => { try { await navigator.clipboard.writeText(p.id === 'stripe' ? `${origin}/webhooks/stripe` : `${origin}/webhooks/carrier/${p.id}/`); this.say('Copied'); } catch { this.say('Select the URL and copy it'); } },
        test: async () => {
          if (!p.backend) { this.say(`${p.name} is not supported yet.`); return; }
          if (p.id === 'stripe') { this.say(st.demoPayments ? 'Stripe is not connected yet: payments are simulated.' : 'Stripe is connected.'); return; }
          if (['netgsm', 'smsworks', 'resend'].includes(p.id)) {
            const phone = window.prompt(p.id === 'resend' ? 'Send a test email to which address?' : 'Send a test SMS to which mobile number?', '');
            if (!phone) return;
            this.setState({ tested: { ...st.tested, [p.id]: 'Sending…' } });
            try { const r = await api('/api/admin/notify/test', { method: 'POST', body: { phone } }); this.setState({ tested: { ...this.state.tested, [p.id]: `✓ ${r.message}` } }); }
            catch (e) { this.setState({ tested: { ...this.state.tested, [p.id]: `✗ ${e.message}` } }); }
            return;
          }
          this.setState({ tested: { ...st.tested, [p.id]: 'Testing…' } });
          try { const r = await api(`/api/admin/providers/${p.id}/test`, { method: 'POST' });
            this.setState({ tested: { ...this.state.tested, [p.id]: r.rates ? `✓ Connected · ${r.ms} ms · ${r.rates} rates · ${r.carriers.join(', ')}` : `✗ Connected, but 0 rates. ${(r.problems || []).slice(0, 3).join(' | ') || 'No reason given by the carriers.'}` } });
          } catch (e) { this.setState({ tested: { ...this.state.tested, [p.id]: `✗ ${e.message}` } }); }
        },
        testTxt: t || '', testFg: t && t.startsWith('✗') ? '#B42318' : '#166534',
        saveTxt: !p.backend ? 'Coming soon' : conn && !envLive ? 'Save changes' : `Connect ${p.name}`,
        save: async () => {
          if (!p.backend) { this.say(`${p.name} is on the roadmap. ShipStation and Stripe work today.`); return; }
          const secrets = {};
          for (const [key] of p.fields) { const v = String(field(`${p.id}.${key}`) || '').trim(); if (v) secrets[key] = v; }
          const hasSaved = d && Object.values(d.fields || {}).some(Boolean);
          if (!Object.keys(secrets).length && !hasSaved) { this.say('Paste the keys first.'); return; }
          try { await api(`/api/admin/providers/${p.id}`, { method: 'PUT', body: { mode, enabled: true, secrets } }); this.say(`${p.name} saved`); await this.reload(); } catch (e) { this.say(e.message); }
        } };
    };
    const connGroups = [
      { title: 'Shipping providers', note: 'Quotes come from every connected provider at once.', items: PROV.filter((p) => p.g === 'ship').map(conItem) },
      { title: 'Payment providers', note: 'Used for top-ups, card checkout and adjustment charges.', items: PROV.filter((p) => p.g === 'pay').map(conItem) },
      { title: 'Label messages', note: 'Tells customers their label is ready.', items: PROV.filter((p) => p.g === 'msg').map(conItem) },
    ];

    // ---- pricing
    const prc = st.pricing;
    const ruleFor = (k) => prc?.rules.find((r) => r.service_key === k) || prc?.rules.find((r) => r.service_key === '*') || { service_key: '*', markup_bp: 1200, fixed_pence: 10 };
    const seen = new Set();
    const rules = (prc?.services || []).filter((s) => { const k = `${s.carrier}:${s.serviceCode}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 30).map((s) => {
      const key = `${s.carrier}:${s.serviceCode}`, r = ruleFor(key);
      let net = s.cost + Math.round((s.cost * r.markup_bp) / 10000) + r.fixed_pence;
      if (net - s.cost < 30) net = s.cost + 30;
      let gross = net + Math.round(net * 0.2);
      gross = Math.floor(gross / 10) * 10 + 9 >= gross ? Math.floor(gross / 10) * 10 + 9 : Math.floor(gross / 10) * 10 + 19;
      const m = Math.round((gross * 10000) / 12000) - s.cost;
      const setBp = (bp) => this.act(async () => { const out = await api(`/api/admin/pricing/${encodeURIComponent(key)}`, { method: 'PUT', body: { markupBp: Math.max(0, bp), fixedPence: r.fixed_pence } });
        this.setState({ pricing: { ...this.state.pricing, rules: out.rules } }); });
      return { logo: CARRIER_LOGO[s.carrier] || '', svc: s.serviceName, cost: P(s.cost), pct: `${r.markup_bp / 100}%`, fixed: P(r.fixed_pence), price: P(gross), margin: P(m),
        mFg: m < 30 ? '#B42318' : '#166534', up: () => setBp(r.markup_bp + 100), dn: () => setBp(r.markup_bp - 100) };
    });
    if (!rules.length) rules.push({ logo: '', svc: prc ? 'No live rates: connect ShipStation first' : 'Loading live provider prices…', cost: '–', pct: `${ruleFor('*').markup_bp / 100}%`, fixed: P(ruleFor('*').fixed_pence), price: '–', margin: '–', mFg: '#586579',
      up: () => this.act(async () => { const r = ruleFor('*'); const out = await api('/api/admin/pricing/*', { method: 'PUT', body: { markupBp: r.markup_bp + 100, fixedPence: r.fixed_pence } }); this.setState({ pricing: { ...(prc || { services: [] }), rules: out.rules } }); }),
      dn: () => this.act(async () => { const r = ruleFor('*'); const out = await api('/api/admin/pricing/*', { method: 'PUT', body: { markupBp: Math.max(0, r.markup_bp - 100), fixedPence: r.fixed_pence } }); this.setState({ pricing: { ...(prc || { services: [] }), rules: out.rules } }); }) });

    return {
      nav, envs, periods, isTest: testMode, periodTxt: PER[st.period][0], sysTxt: ssLive || st.live.length ? 'All systems normal' : 'No shipping provider', sysFg: ssLive || st.live.length ? '#4ADE80' : '#FBBF24',
      ax0: ax[0], ax1: ax[1], ax2: ax[2], ax3: ax[3], feesTxt: st.demoPayments ? '£0.00 · test mode' : 'See Stripe dashboard',
      meName: me.name || 'Admin', meIni: ini(me.name),
      vOver: st.view === 'over', vFlow: st.view === 'flow', vAdj: st.view === 'adj', vFin: st.view === 'fin', vCust: st.view === 'cust', vConn: st.view === 'conn', vPrice: st.view === 'price',
      kpis, bars, line, funnel, feed, mix, health, alerts, goFlow: go('flow'), goConn: go('conn'), goAdj: go('adj'),
      stages, flowRows, adjRows, adjStats, adjRules, pnl, walletRows, payMix, payables, ledger, ledTabs, custStats, custRows, custTabs, connGroups, rules,
      globalSearch: (e) => { if (e.key === 'Enter') { const v = e.target.value.trim(); const hit = st.shipments.find((s) => s.ref.toLowerCase() === v.toLowerCase() || (s.tracking_number || '').toLowerCase() === v.toLowerCase());
        if (hit) { this.openCustomer(hit.customer_id); return; } this.setState({ custQ: v, custTab: 'all' }); this.go('cust'); } },
      signOut: async () => { try { await api('/api/auth/logout', { method: 'POST' }); } finally { location.href = '/login'; } },
      exportFlow: (e) => { e.preventDefault(); csv('kargom-shipments.csv', [['Ref', 'Date', 'Customer', 'Route', 'Service', 'Provider', 'Cost', 'Price', 'Paid', 'Status'],
        ...inPeriod.map((x) => [x.ref, x.created_at, x.customer_name, routeOf(x), x.service_name, x.provider, (x.cost_pence / 100).toFixed(2), (x.price_pence / 100).toFixed(2), x.pay_method, x.status])]); },
      exportLedger: (e) => { e.preventDefault(); csv('kargom-ledger.csv', [['Time', 'Kind', 'Customer', 'Reference', 'Method', 'Amount'],
        ...st.ledger.map((l) => [l.created_at, l.kind, l.customerName, l.memo || l.ref || '', l.method, (l.amount / 100).toFixed(2)])]); },
      vatReport: (e) => { e.preventDefault(); this.say(`Output VAT so far: ${P(fin.vatOutputPence)} on net sales of ${P(fin.netRevenuePence)}.`); },
      setCustQ: (e) => { this.setState({ custQ: e.target.value }); },
      vProf: st.view === 'prof', pf, pTabs, pt, pAct, profBack: go(st.from || 'cust'), backTxt: 'Back to ' + (BACK[st.from] || 'Customers'), tkOpenCust: curT ? oc(curT.customer_id) : () => {},
      vSup: st.view === 'sup', supStats, qTabs, queue, tk, thread, tkInfo, tkShip, tkActions, replyModes,
      aDraft: '', setADraft: () => {},
      useCanned: (e) => { const v = e?.target?.value; const ta = document.querySelector('[aria-label="Admin reply"]'); if (CANNED[v] && ta) { ta.value = CANNED[v]; ta.dataset.dirty = '1'; this.setState({ rMode: 'reply' }); } },
      setNext: (e) => { const v = e?.target?.value; if (NEXT[v]) this.setState({ nextSt: NEXT[v] }); },
      replyBg: isNote ? '#FFFBF2' : '#FFFFFF', replyPh: isNote ? 'Only admins see notes' : 'Write to the customer…', sendBg: isNote ? '#E89B12' : '#2463DB', sendTxt: isNote ? 'Add note' : 'Send reply', sendAdmin,
      toast: !!st.toast, toastTxt: st.toast, hideToast: () => this.setState({ toast: '' }),
    };
  }
}

mount(Component, document.getElementById('tpl').textContent, document.getElementById('root'));
