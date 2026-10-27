import { api } from '../dc.js';

const params = new URLSearchParams(location.search);
let mode = params.get('mode') === 'register' || location.pathname === '/register' ? 'register' : 'login';
const f = document.getElementById('f');
const msg = document.getElementById('msg');
const raw = params.get('next') || '';
// Only allow redirects inside our own site.
const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '';

function render() {
  document.getElementById('t-login').setAttribute('aria-selected', String(mode === 'login'));
  document.getElementById('t-register').setAttribute('aria-selected', String(mode === 'register'));
  document.getElementById('reg-fields').hidden = mode !== 'register';
  document.getElementById('submit').textContent = mode === 'login' ? 'Sign in' : 'Create account';
  document.getElementById('hint').textContent = mode === 'register' ? 'Use at least 10 characters for your password.' : '';
  f.password.setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
  document.title = `${mode === 'login' ? 'Sign in' : 'Create account'} — Kargom.co.uk`;
}
document.getElementById('t-login').addEventListener('click', () => { mode = 'login'; msg.replaceChildren(); render(); });
document.getElementById('t-register').addEventListener('click', () => { mode = 'register'; msg.replaceChildren(); render(); });
render();

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
    location.href = next || (r.role === 'admin' ? '/admin' : '/app');
  } catch (err) {
    const d = document.createElement('div');
    d.className = 'err';
    d.textContent = err.message;
    msg.replaceChildren(d);
    btn.disabled = false;
  }
});
