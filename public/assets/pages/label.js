import { DCLogic, mount, api, CARRIER_NAME } from '../dc.js';

/** Guest label page: /l/<secret token>. Waits for the label, then preview, print, download and share. */
const token = decodeURIComponent(location.pathname.split('/')[2] || '');
const gbp = (p) => `£${(p / 100).toFixed(2)}`;
const WAITING = ['awaiting_payment', 'pending', 'purchasing'];

class Component extends DCLogic {
  constructor(p) { super(p); this.state = { s: null, error: '', tries: 0, toast: '', copied: false }; }

  async mounted() {
    for (let i = 0; i < 45; i++) {
      try {
        const s = await api(`/api/guest/label/${encodeURIComponent(token)}`);
        this.setState({ s, tries: i });
        if (!WAITING.includes(s.status)) return;
      } catch (e) { this.setState({ error: e.status === 404 ? 'notfound' : 'network' }); if (e.status === 404) return; }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  say(t) { this.setState({ toast: t }); setTimeout(() => this.state.toast === t && this.setState({ toast: '' }), 3500); }

  renderVals() {
    const st = this.state, s = st.s;
    const link = `${location.origin}/l/${token}`;
    const waiting = !s || WAITING.includes(s.status);
    const failed = st.error === 'notfound' || (s && ['failed', 'cancelled'].includes(s.status));
    const ready = Boolean(s) && !waiting && !failed;
    const carrierName = s ? CARRIER_NAME[s.carrier] || 'courier' : 'courier';
    const drop = s && /drop|shop|locker|post office/i.test(s.service);
    const pdf = `/api/guest/label/${encodeURIComponent(token)}/pdf`;
    const msg = s ? `Your Kargom label for ${s.service} (${s.ref}). Tracking ${s.tracking || ''}. Print it here: ${link}` : '';
    return {
      loading: !failed && waiting && st.error !== 'notfound',
      waitTitle: s?.status === 'awaiting_payment' ? 'Confirming your payment…' : 'Creating your label…',
      waitTxt: st.tries > 20 ? 'This is taking longer than usual. Keep this page open; it updates by itself.' : 'This usually takes a few seconds.',
      failed, failTitle: st.error === 'notfound' ? 'Label not found' : 'We could not create this label',
      failTxt: st.error === 'notfound' ? 'Check that you opened the full link. If you paid and lost the page, contact us with the email you used and we will send it again.' : 'The courier did not accept this booking. Your card payment has been refunded in full. It can take 5–10 days to show on your statement.',
      ready,
      doneLine: s ? `${s.service} to ${s.to.name}, ${s.to.city}. Print the label and ${drop ? `drop the parcel off at a ${carrierName} shop or locker.` : 'have the parcel ready for collection.'}` : '',
      tracking: s?.tracking || '–', ref: s?.ref || '', priceTxt: s ? gbp(s.price) : '', email: s?.email || 'your email',
      pdfUrl: pdf, downloadUrl: `${pdf}?download=1`,
      waUrl: `https://wa.me/?text=${encodeURIComponent(msg)}`,
      copyTxt: st.copied ? 'Link copied' : 'Copy link',
      copyLink: async () => { try { await navigator.clipboard.writeText(link); this.setState({ copied: true }); this.say('Link copied'); } catch { this.say(link); } },
      handover: drop ? `Take it to any ${carrierName} drop-off shop or locker. They scan the label; keep the receipt.` : `${carrierName} collects it from the collection address. Have it ready by 9am on the collection day.`,
      carrierName,
      fromTxt: s ? `${s.from.name}, ${s.from.line1}, ${s.from.city} ${s.from.postcode}` : '',
      toTxt: s ? `${s.to.name}, ${s.to.line1}, ${s.to.city} ${s.to.postcode}` : '',
      service: s?.service || '', parcelTxt: s ? `${Math.round(s.parcel.weightGrams / 100) / 10} kg · ${s.parcel.lengthCm}×${s.parcel.widthCm}×${s.parcel.heightCm} cm` : '',
      trackUrl: s?.tracking ? `https://kargoradari.com/?q=${encodeURIComponent(s.tracking)}` : '#',
      registerUrl: `/register${s?.email ? `?email=${encodeURIComponent(s.email)}` : ''}`,
      toast: !!st.toast, toastTxt: st.toast,
    };
  }
}

mount(Component, document.getElementById('tpl').textContent, document.getElementById('root'));
