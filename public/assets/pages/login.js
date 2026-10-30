import { api } from '../dc.js';

const params = new URLSearchParams(location.search);
let mode = params.get('mode') === 'register' || location.pathname === '/register' ? 'register' : 'login';
const f = document.getElementById('f');
const msg = document.getElementById('msg');
const raw = params.get('next') || '';
// Only allow redirects inside our own site.
// Only a path on this site. Blocks //evil.com, /\evil.com and /<tab>/evil.com (browsers treat all of them as another site).
const next = /^\/(?![/\\])[^\s\\\x00-\x1f\x7f]*$/.test(raw) ? raw : '';

function render() {
  document.getElementById('t-login').setAttribute('aria-selected', String(mode === 'login'));
  document.getElementById('t-register').setAttribute('aria-selected', String(mode === 'register'));
  document.getElementById('reg-fields').hidden = mode !== 'register';
  document.getElementById('submit-t').textContent = mode === 'login' ? 'Sign in' : 'Create account';
  const gt = document.getElementById('google-t'); if (gt) gt.textContent = mode === 'login' ? 'Sign in with Google' : 'Sign up with Google';
  document.getElementById('headline').innerHTML = mode === 'login'
    ? '<b>Welcome back.</b> Cheaper parcel delivery, in one account.'
    : '<b>Create your account</b> and start saving on parcel delivery.';
  f.password.placeholder = mode === 'login' ? 'Your password' : 'Create a password';
  document.getElementById('hint').textContent = mode === 'register' ? 'Use at least 10 characters for your password.' : '';
  f.password.setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
  document.title = `${mode === 'login' ? 'Sign in' : 'Create account'} — Kargom.co.uk`;
}
document.getElementById('t-login').addEventListener('click', () => { mode = 'login'; msg.replaceChildren(); render(); });
document.getElementById('t-register').addEventListener('click', () => { mode = 'register'; msg.replaceChildren(); render(); });
render();

/* Continue with Google: shown when the site has Google keys; returns here with ?error= if it fails */
api('/api/auth/providers').then((p) => {
  if (!p.google) return;
  document.getElementById('google').href = `/api/auth/google${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  document.getElementById('google-g').hidden = !p.googleLogo;
  document.getElementById('google-box').hidden = false;
}).catch(() => {});
const GOOGLE_ERR = {
  google_cancelled: 'Google sign-in was cancelled.',
  google_state: 'That Google sign-in link expired. Please try again.',
  google_failed: 'We could not sign you in with Google. Please try again, or use your email.',
  google_off: 'Google sign-in is not switched on yet. Please use your email.',
};
if (GOOGLE_ERR[params.get('error')]) { const d = document.createElement('div'); d.className = 'err'; d.textContent = GOOGLE_ERR[params.get('error')]; msg.replaceChildren(d); }
const eye = document.getElementById('eye');
eye.addEventListener('click', () => {
  const show = f.password.type === 'password';
  f.password.type = show ? 'text' : 'password';
  eye.setAttribute('aria-pressed', String(show));
  eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});
if (params.get('email')) document.querySelector('[name=email]').value = params.get('email');

f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(f);
  const btn = document.getElementById('submit');
  btn.disabled = true;
  msg.replaceChildren();
  try {
    if (mode === 'register') {
      await api('/api/auth/register', { method: 'POST', body: {
        name: fd.get('name'), email: fd.get('email'), password: fd.get('password'),
        accountType: fd.get('accountType'), company: fd.get('company') || undefined,
      } });
    }
    const r = await api('/api/auth/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
    location.href = next || (r.role === 'admin' ? '/admin' : r.partner ? '/partner' : '/app');
  } catch (err) {
    const d = document.createElement('div');
    d.className = 'err';
    d.textContent = err.message;
    msg.replaceChildren(d);
    btn.disabled = false;
  }
});
