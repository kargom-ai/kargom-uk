import { api, gbp, uid } from './dc.js';
import { openPaySheet } from './pay.js';
import { shrinkPhoto } from './photo-address.js';

/**
 * "Chat with me": book a UK parcel label by chatting. The assistant prices the parcel and collects
 * the details; the customer checks a summary card and pays on the secure card form.
 * The conversation lives in this tab only (sessionStorage).
 */

const KEY = 'kg_chat';
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; } };
const save = (s) => { try { sessionStorage.setItem(KEY, JSON.stringify({ messages: s.messages, draft: s.draft, ready: s.ready })); } catch { /* private mode */ } };
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HELLO = 'Hi! I can book your parcel label right here in a minute. What are you sending?';
const HELLO_TR = 'Merhaba! Kargo etiketini bir dakikada buradan alabilirsin. Ne gönderiyorsun?';

let S = null;
let root = null;

const CSS = `
.kc-bg{position:fixed;inset:0;z-index:1000;background:rgba(15,23,42,.45);display:flex;justify-content:flex-end}
.kc{width:min(440px,100%);height:100%;background:#F5F7FB;display:flex;flex-direction:column;box-shadow:-10px 0 40px rgba(0,0,0,.2);font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#1F2A3C}
.kc-h{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#1F2A3C;color:#fff}
.kc-h b{font:700 16px 'Outfit',sans-serif;display:block}.kc-h small{color:#AEB9C9;font-size:12px}
.kc-av{width:36px;height:36px;border-radius:50%;background:#2463DB;display:grid;place-items:center;flex:none}
.kc-x{margin-left:auto;width:40px;height:40px;border:0;border-radius:10px;background:transparent;color:#fff;font-size:26px;cursor:pointer}
.kc-new{border:1px solid #3B4A63;background:transparent;color:#DCE4F2;border-radius:8px;padding:6px 10px;font:600 12px 'Plus Jakarta Sans',sans-serif;cursor:pointer}
.kc-m{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch}
.kc-b{max-width:86%;padding:10px 13px;border-radius:16px;font-size:15px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}
.kc-b.a{background:#fff;border:1px solid #E1E7EF;border-bottom-left-radius:4px;align-self:flex-start}
.kc-b.u{background:#2463DB;color:#fff;border-bottom-right-radius:4px;align-self:flex-end}
.kc-typing{align-self:flex-start;background:#fff;border:1px solid #E1E7EF;border-radius:16px;padding:12px 14px;display:flex;gap:4px}
.kc-typing i{width:7px;height:7px;border-radius:50%;background:#8593A8;animation:kcb 1s infinite}.kc-typing i:nth-child(2){animation-delay:.15s}.kc-typing i:nth-child(3){animation-delay:.3s}
@keyframes kcb{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
.kc-q{display:flex;flex-direction:column;gap:8px;align-self:stretch}
.kc-qc{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:1px solid #D6E4FB;border-radius:12px;cursor:pointer;text-align:left;font-family:inherit;color:inherit}
.kc-qc:hover{border-color:#2463DB}.kc-qc.on{border-color:#16A34A;box-shadow:0 0 0 1px #16A34A}
.kc-qc img{width:40px;height:28px;object-fit:contain}.kc-qc .t{flex:1;min-width:0;display:flex;flex-direction:column;font-size:13px;color:#586579}.kc-qc .t b{font-size:14px;color:#1F2A3C}
.kc-qc .p{font:700 17px 'Outfit',sans-serif}
.kc-sum{align-self:stretch;background:#fff;border:2px solid #16A34A;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:8px;font-size:14px}
.kc-sum h4{margin:0;font:700 16px 'Outfit',sans-serif}.kc-sum .r{display:grid;grid-template-columns:80px 1fr;gap:4px 10px}.kc-sum .r span{color:#586579}
.kc-pay{min-height:50px;border:0;border-radius:12px;background:#16A34A;color:#fff;font:700 17px 'Plus Jakarta Sans',sans-serif;cursor:pointer}
.kc-pay[disabled]{opacity:.6}
.kc-f{display:flex;align-items:flex-end;gap:8px;padding:10px;background:#fff;border-top:1px solid #E1E7EF;padding-bottom:max(10px,env(safe-area-inset-bottom))}
.kc-f textarea{flex:1;min-height:44px;max-height:140px;resize:none;border:1px solid #C9D6EA;border-radius:12px;padding:11px 12px;font:500 16px 'Plus Jakarta Sans',sans-serif;line-height:1.35}
.kc-ib{width:44px;height:44px;flex:none;border-radius:12px;border:1px solid #C9D6EA;background:#fff;display:grid;place-items:center;cursor:pointer;position:relative;color:#2463DB}
.kc-send{width:44px;height:44px;flex:none;border:0;border-radius:12px;background:#2463DB;color:#fff;display:grid;place-items:center;cursor:pointer}
.kc-err{align-self:center;color:#B42318;font-size:13px;text-align:center}
.kc-note{font-size:11.5px;color:#8593A8;text-align:center;padding:0 12px 6px;background:#fff}
@media (max-width:600px){.kc{width:100%}.kc-bg{background:#F5F7FB}}
.kc-bg .kc[role="dialog"]{padding:0 !important;align-items:stretch !important}
.kc-bg .kc[role="dialog"] > div,.kc-bg .kc[role="dialog"] > form{max-height:none !important}
.kc-bg .kc[role="dialog"] > .kc-m{overflow-y:auto !important}
`;

function logo(carrier) {
  const L = { royal_mail: 'royalmail', evri: 'evri', dpd: 'dpd', inpost: 'inpost', ups: 'ups', dhl: 'dhl', fedex: 'fedex', parcelforce: 'parcelforce', yodel: 'yodel' };
  return L[carrier] ? `<img src="/assets/carriers/${L[carrier]}.png" alt="">` : '';
}

function view() {
  const d = S.draft || {};
  const card = (q, on) => `<button type="button" class="kc-qc ${on ? 'on' : ''}" ${on ? 'disabled' : `data-q="${esc(q.serviceCode)}"`}>${logo(q.carrier)}
      <span class="t"><b>${esc(q.serviceName)}</b>${on ? 'Selected · ' : ''}${q.transitDays ? `${q.transitDays} day${q.transitDays > 1 ? 's' : ''} · ` : ''}${q.dropOff ? 'Drop off' : 'Collected'}</span><span class="p">${gbp(q.pricePence)}</span></button>`;
  const lastQ = S.messages.reduce((i, m, j) => (m.quotes ? j : i), -1);
  const bubbles = S.messages.map((m, j) => {
    let extra = '';
    if (m.quotes?.length) {
      const chosen = d.choice && m.quotes.find((q) => q.serviceCode === d.choice.serviceCode && q.carrier === d.choice.carrier);
      // once chosen only the choice stays; older price lists disappear
      if (chosen) extra = `<div class="kc-q">${card(chosen, true)}</div>`;
      else if (j === lastQ && !S.ready) extra = `<div class="kc-q">${m.quotes.slice(0, 4).map((q) => card(q, false)).join('')}</div>`;
    }
    return `<div class="kc-b ${m.role === 'user' ? 'u' : 'a'}">${esc(m.text)}</div>${extra}`;
  }).join('');
  const quotes = '';
  const a = (x) => [x?.name, x?.line1, x?.line2, `${x?.city || ''} ${x?.postcode || ''}`.trim(), x?.phone].filter(Boolean).map(esc).join('<br>');
  const sum = S.ready && d.choice ? `<div class="kc-sum"><h4>Check and pay</h4>
      <div class="r"><span>From</span><div>${a(d.from)}</div><span>To</span><div>${a(d.to)}</div>
      <span>Parcel</span><div>${esc(d.parcel?.weightKg)} kg · ${esc(d.parcel?.lengthCm)}×${esc(d.parcel?.widthCm)}×${esc(d.parcel?.heightCm)} cm · ${esc(d.contents)} (£${esc(d.valueGbp)})</div>
      <span>Service</span><div>${esc(d.choice.serviceName)}</div><span>Label to</span><div>${esc(d.email)}</div></div>
      <button type="button" class="kc-pay" data-pay ${S.paying ? 'disabled' : ''}>${S.paying ? 'Opening the payment…' : `Pay ${gbp(d.choice.pricePence)}`}</button>
      <span style="font-size:12px;color:#586579">Something wrong? Just tell me in the chat and I will fix it. By paying you agree to our terms.</span></div>` : '';
  return `${bubbles}${quotes}${sum}${S.busy ? '<div class="kc-typing"><i></i><i></i><i></i></div>' : ''}${S.err ? `<div class="kc-err">${esc(S.err)}</div>` : ''}`;
}

function render(scroll = true) {
  const m = root.querySelector('.kc-m');
  m.innerHTML = view();
  root.querySelector('.kc-send').disabled = S.busy;
  if (scroll) m.scrollTop = m.scrollHeight;
}

async function send(text) {
  const t = String(text || '').trim();
  if (!t || S.busy) return;
  S.messages.push({ role: 'user', text: t });
  S.busy = true; S.err = ''; render();
  try {
    const r = await api('/api/chat', { method: 'POST', body: { messages: S.messages.map(({ role, text }) => ({ role, text })), draft: S.draft } });
    S.messages.push({ role: 'assistant', text: r.reply, ...(r.showQuotes && r.draft.quotes?.length ? { quotes: r.draft.quotes.slice(0, 4) } : {}) });
    S.draft = r.draft; S.ready = r.ready;
  } catch (e) { S.err = e.message; S.messages.pop(); root.querySelector('textarea').value = t; }
  S.busy = false; save(S); render();
}

async function photo(file) {
  if (!file || S.busy) return;
  S.busy = true; S.err = ''; render();
  try {
    const image = await shrinkPhoto(file);
    const r = await api('/api/address/from-image', { method: 'POST', body: { image } });
    S.busy = false;
    const a = r.address || {};
    const txt = [a.name, a.company, a.line1, a.line2, a.city, a.postcode, a.phone, a.email].filter(Boolean).join(', ');
    if (!r.found || !txt) { S.err = 'I could not read an address in that picture. You can type or paste it.'; render(); return; }
    await send(`Address from my photo: ${txt}`);
  } catch (e) { S.busy = false; S.err = e.message; render(); }
}

/** Back to the chat with a message (after a cancelled or failed payment). */
function reopen(msg) {
  openChat();
  S.err = msg; render();
}

async function pay() {
  const d = S.draft;
  if (!d?.choice || S.paying) return;
  // the chat closes and the card form opens straight away
  save(S); close();
  const busy = document.createElement('div');
  busy.style.cssText = 'position:fixed;inset:0;z-index:999;background:rgba(15,23,42,.35);display:grid;place-items:center';
  busy.innerHTML = '<div style="background:#fff;border-radius:14px;padding:16px 20px;font:600 15px \'Plus Jakarta Sans\',sans-serif;color:#1F2A3C">Opening the secure payment…</div>';
  document.body.append(busy);
  try {
    const r = await api('/api/guest/book', { method: 'POST', idempotencyKey: uid(), body: {
      email: d.email, name: d.name, from: { ...d.from, country: 'GB' }, to: { ...d.to, country: 'GB' },
      parcel: { weightGrams: Math.round(d.parcel.weightKg * 1000), lengthCm: d.parcel.lengthCm, widthCm: d.parcel.widthCm, heightCm: d.parcel.heightCm },
      contents: d.contents, valuePence: Math.round((d.valueGbp || 0) * 100), carrier: d.choice.carrier, serviceCode: d.choice.serviceCode, expectedPricePence: d.choice.pricePence } });
    if (r.checkoutUrl) { location.href = r.checkoutUrl; return; }
    const cfg = await api('/api/guest/config');
    busy.remove();
    if (r.clientSecret && (cfg.stripePk || cfg.demoPayments)) {
      const res = await openPaySheet({ publishableKey: cfg.stripePk, clientSecret: r.clientSecret, amountTxt: gbp(r.pricePence),
        title: 'Pay and get your label', subtitle: `${d.choice.serviceName} · ${d.from.postcode} → ${d.to.postcode}`, payLabel: `Pay ${gbp(r.pricePence)}`,
        returnUrl: `${location.origin}/l/${r.token}`,
        ...(cfg.demoPayments ? { demoPay: () => api(`/api/guest/demo-pay/${encodeURIComponent(r.token)}`, { method: 'POST', body: {} }) } : {}) });
      if (res === 'cancelled') { reopen('Payment cancelled. Nothing was charged. Press Pay when you are ready.'); return; }
    } else if (r.clientSecret) throw new Error('Card payments are being set up. Please try again in a few minutes.');
    sessionStorage.removeItem(KEY);
    location.href = `/l/${r.token}`;
  } catch (e) {
    busy.remove();
    reopen(e.code === 'quote_invalid' ? `${e.message} Tell me and I will get fresh prices.` : e.message);
  }
}

function close() {
  root?.remove(); root = null;
  document.body.style.overflow = '';
}

function fresh() {
  const tr = /^tr\b/i.test(navigator.language || '');
  return { messages: [{ role: 'assistant', text: tr ? HELLO_TR : HELLO }], draft: {}, ready: false, showQuotes: false, busy: false, err: '' };
}

export function openChat() {
  if (root) return;
  S = { ...fresh(), ...(load() || {}), busy: false, err: '', paying: false };
  if (!document.getElementById('kc-css')) { const st = document.createElement('style'); st.id = 'kc-css'; st.textContent = CSS; document.head.append(st); }
  root = document.createElement('div');
  root.className = 'kc-bg';
  root.innerHTML = `<div class="kc" role="dialog" aria-modal="true" aria-label="Chat with Kargom">
    <div class="kc-h"><span class="kc-av"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></span>
      <span><b>Kargom assistant</b><small>Books UK parcels in minutes</small></span>
      <button type="button" class="kc-new" data-new>New chat</button><button type="button" class="kc-x" aria-label="Close chat">×</button></div>
    <div class="kc-m" aria-live="polite"></div>
    <div class="kc-note">AI assistant. Always check the summary before paying.</div>
    <form class="kc-f">
      <label class="kc-ib" aria-label="Send a photo of an address"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path><circle cx="12" cy="13" r="3"></circle></svg><input type="file" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden"></label>
      <textarea rows="1" placeholder="Type, or paste an address…" aria-label="Message"></textarea>
      <button type="submit" class="kc-send" aria-label="Send"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"></path><path d="M22 2 15 22l-4-9-9-4z"></path></svg></button>
    </form></div>`;
  document.body.append(root);
  document.body.style.overflow = 'hidden';
  const ta = root.querySelector('textarea');
  const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(140, ta.scrollHeight)}px`; };
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); root.querySelector('form').requestSubmit(); } });
  root.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); const t = ta.value; ta.value = ''; grow(); send(t); });
  root.querySelector('input[type=file]').addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; photo(f); });
  root.addEventListener('click', (e) => {
    if (e.target === root || e.target.closest('.kc-x')) { close(); return; }
    if (e.target.closest('[data-new]')) { sessionStorage.removeItem(KEY); S = { ...fresh(), paying: false }; render(); return; }
    if (e.target.closest('[data-pay]')) { pay(); return; }
    const q = e.target.closest('[data-q]');
    if (q && !S.busy) { const o = S.draft.quotes.find((x) => x.serviceCode === q.dataset.q); if (o) send(`I'll take ${o.serviceName} (${gbp(o.pricePence)})`); }
  });
  document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape' && root) { close(); document.removeEventListener('keydown', onKey); } });
  render();
  if (!matchMedia('(pointer: coarse)').matches) ta.focus();
}
