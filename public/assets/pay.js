/**
 * Card payment sheet on our own page (Stripe Payment Element).
 * The card fields are Stripe's secure iframes, so card numbers never touch our
 * server, but the customer never leaves Kargom. 3-D Secure opens in Stripe's
 * own pop-up on top of this sheet when the bank asks for it.
 */

let stripePromise = null;

function loadStripe(publishableKey) {
  if (!stripePromise) {
    stripePromise = new Promise((resolve, reject) => {
      if (window.Stripe) { resolve(window.Stripe(publishableKey)); return; }
      const s = document.createElement('script');
      s.src = 'https://js.stripe.com/v3/';
      s.onload = () => resolve(window.Stripe(publishableKey));
      s.onerror = () => { stripePromise = null; reject(new Error('Could not load the secure card form. Check your connection and try again.')); };
      document.head.append(s);
    });
  }
  return stripePromise;
}

const CSS = `
.kp-back{position:fixed;inset:0;z-index:200;background:rgba(8,14,28,.62);display:flex;align-items:center;justify-content:center;padding:24px;animation:kpfade .15s ease-out}
.kp-sheet{width:100%;max-width:470px;max-height:calc(100vh - 32px);overflow-y:auto;background:#FFFFFF;border-radius:20px;box-shadow:0 24px 60px rgba(8,14,40,.35);font-family:'Nunito Sans',system-ui,sans-serif;color:#1F2A3C}
.kp-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:20px 22px 0}
.kp-head h2{margin:0;font:600 22px 'Nunito Sans',sans-serif}
.kp-sub{margin-top:4px;font-size:14px;color:#586579}
.kp-x{flex:none;width:40px;height:40px;border-radius:10px;border:1px solid #E1E7EF;background:#FFFFFF;color:#3E4A5C;font:700 18px sans-serif;cursor:pointer}
.kp-sum{margin:16px 22px 0;padding:14px 16px;border-radius:14px;background:linear-gradient(110deg,#3D6DEB 0%,#2A4FC8 55%,#1D3593 100%);color:#FFFFFF;display:flex;align-items:center;justify-content:space-between;gap:12px}
.kp-sum span{font-size:14px;color:#DCE4F2}
.kp-sum b{font:700 26px 'Nunito Sans',sans-serif;font-variant-numeric:tabular-nums}
.kp-body{padding:18px 22px 22px;display:flex;flex-direction:column;gap:14px}
.kp-el{min-height:120px}
.kp-load{display:flex;align-items:center;gap:10px;font-size:14px;color:#586579;padding:18px 0}
.kp-spin{width:18px;height:18px;border-radius:50%;border:3px solid #C9D6EA;border-top-color:#2463DB;animation:kpspin .8s linear infinite}
.kp-err{padding:10px 12px;border-radius:10px;background:#FDECEC;color:#B42318;font-size:14px;font-weight:600}
.kp-pay{min-height:52px;border-radius:12px;border:0;background:#2463DB;color:#FFFFFF;font:700 16px 'Nunito Sans',sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px}
.kp-pay:hover{background:#1A4FB8}.kp-pay:disabled{opacity:.6;cursor:default}
.kp-safe{display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;color:#586579;text-align:center}
@keyframes kpspin{to{transform:rotate(360deg)}}
@keyframes kpfade{from{opacity:0}}
@media (max-width:760px){
  .kp-back{align-items:flex-end;padding:0}
  .kp-sheet{max-width:none;border-radius:20px 20px 0 0;max-height:94vh;padding-bottom:env(safe-area-inset-bottom)}
}`;

const LOCK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>';

function el(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
}

/**
 * Show the sheet and take the payment.
 * Resolves 'paid' (money taken), 'processing' (bank still confirming) or 'cancelled'.
 */
export function openPaySheet({ publishableKey, clientSecret, amountTxt, title, subtitle, payLabel, returnUrl, summary, demoPay }) {
  if (!document.getElementById('kp-style')) document.head.append(el('style', { id: 'kp-style' }, CSS));
  return new Promise((resolve) => {
    const back = el('div', { class: 'kp-back', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    const sheet = el('div', { class: 'kp-sheet' });
    const head = el('div', { class: 'kp-head' });
    const h = el('div');
    h.append(el('h2', {}, ''), el('div', { class: 'kp-sub' }));
    h.firstChild.textContent = title;
    h.lastChild.textContent = subtitle || '';
    const x = el('button', { type: 'button', class: 'kp-x', 'aria-label': 'Close' }, '×');
    head.append(h, x);
    const sum = el('div', { class: 'kp-sum' });
    sum.append(el('span'), el('b'));
    sum.firstChild.textContent = summary || 'To pay today, inc VAT';
    sum.lastChild.textContent = amountTxt;
    const body = el('div', { class: 'kp-body' });
    const mountPoint = el('div', { class: 'kp-el' }, '<div class="kp-load"><span class="kp-spin"></span>Loading secure card form…</div>');
    const err = el('div', { class: 'kp-err', role: 'alert' });
    err.hidden = true;
    const pay = el('button', { type: 'button', class: 'kp-pay' });
    pay.innerHTML = `${LOCK}<span></span>`;
    pay.lastChild.textContent = payLabel || `Pay ${amountTxt}`;
    pay.disabled = true;
    const safe = el('div', { class: 'kp-safe' }, `${LOCK}<span>Secured by Stripe. Kargom never sees or stores your card number.</span>`);
    body.append(mountPoint, err, pay, safe);
    sheet.append(head, sum, body);
    back.append(sheet);
    document.body.append(back);
    document.body.style.overflow = 'hidden';

    let busy = false;
    const close = (result) => {
      document.body.style.overflow = '';
      back.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => { if (e.key === 'Escape' && !busy) close('cancelled'); };
    document.addEventListener('keydown', onKey);
    x.addEventListener('click', () => { if (!busy) close('cancelled'); });
    back.addEventListener('click', (e) => { if (e.target === back && !busy) close('cancelled'); });
    const showError = (m) => { err.textContent = m; err.hidden = !m; };

    if (demoPay) {
      // Test mode without Stripe: same sheet, simulated card. No real money moves.
      // No card boxes at all in test mode: a page asking for card details that do not go to Stripe
      // looks like phishing to Google Safe Browsing, so the test sheet only has a confirm button.
      mountPoint.innerHTML = `
        <div style="padding:12px 14px;border-radius:10px;background:#FFF4E0;color:#9A5B00;font-size:14px;font-weight:700;line-height:1.45">TEST MODE · card payments are not switched on yet.<br><span style="font-weight:500">Press the button to finish this booking as a test. No card is needed and no money is taken.</span></div>`;
      pay.disabled = false;
      pay.addEventListener('click', async () => {
        if (busy) return;
        busy = true; pay.disabled = true; pay.lastChild.textContent = 'Processing…'; showError('');
        try { await demoPay(); close('paid'); }
        catch (e) { busy = false; pay.disabled = false; pay.lastChild.textContent = payLabel || `Pay ${amountTxt}`; showError(e.message); }
      });
      return;
    }

    loadStripe(publishableKey).then((stripe) => {
      const elements = stripe.elements({
        clientSecret,
        fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;500;600;700;800&display=swap' }],
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: '#2463DB', colorText: '#1F2A3C', colorTextSecondary: '#586579', colorDanger: '#B42318',
            colorBackground: '#FFFFFF', fontFamily: "'Nunito Sans', system-ui, sans-serif", fontSizeBase: '16px',
            borderRadius: '10px', spacingUnit: '4px',
          },
          rules: {
            '.Input': { border: '1px solid #C9D6EA', boxShadow: 'none', padding: '12px' },
            '.Input:focus': { border: '1px solid #2463DB', boxShadow: '0 0 0 1px #2463DB' },
            '.Label': { fontWeight: '700', fontSize: '13px', color: '#3E4A5C' },
            '.Tab': { border: '1px solid #E1E7EF', boxShadow: 'none' },
            '.Tab--selected': { borderColor: '#2463DB', boxShadow: '0 0 0 1px #2463DB' },
          },
        },
      });
      const payment = elements.create('payment', { layout: { type: 'tabs' }, fields: { billingDetails: { address: { country: 'auto' } } } });
      mountPoint.innerHTML = '';
      payment.mount(mountPoint);
      payment.on('ready', () => { pay.disabled = false; });
      payment.on('change', () => showError(''));
      pay.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        pay.disabled = true;
        pay.lastChild.textContent = 'Processing…';
        showError('');
        const { error, paymentIntent } = await stripe.confirmPayment({ elements, confirmParams: { return_url: returnUrl }, redirect: 'if_required' });
        if (error) {
          busy = false;
          pay.disabled = false;
          pay.lastChild.textContent = payLabel || `Pay ${amountTxt}`;
          showError(error.type === 'card_error' || error.type === 'validation_error' ? error.message : 'Something went wrong with the payment. Please try again.');
          return;
        }
        close(paymentIntent && paymentIntent.status === 'succeeded' ? 'paid' : 'processing');
      });
    }).catch((e) => { mountPoint.innerHTML = ''; showError(e.message); });
  });
}
