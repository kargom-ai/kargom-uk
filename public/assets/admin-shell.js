/* The admin frame (dark left menu + top bar), same as /admin, for admin pages that live on their own URL. */
import { api } from './dc.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const ADMIN_NAV = [
  ['over', 'Overview', '/admin'], ['flow', 'Shipment flow', '/admin?view=flow'], ['adj', 'Weight adjustments', '/admin?view=adj'], ['sup', 'Support', '/admin?view=sup'],
  ['fin', 'Finance', '/admin?view=fin'], ['cust', 'Customers', '/admin?view=cust'], ['conn', 'Connections', '/admin?view=conn'], ['price', 'Pricing rules', '/admin?view=price'],
  ['chat', 'Live chat', '/admin/chat'], ['tr', 'Turkey warehouse', '/admin/turkey'],
];

/** Replace the page with the admin frame and return { main, me, setBadge }. Throws if not an admin. */
export async function mountAdminShell(active, title) {
  const me = await api('/api/me');
  if (me.role !== 'admin') throw new Error('not admin');
  const ini = (me.name || '?').split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase();
  const wrap = document.createElement('div');
  wrap.className = 'adm';
  wrap.innerHTML = `
  <aside class="adm-side" aria-label="Admin menu">
    <span class="adm-brand"><img src="/assets/logo-white.png" alt="Kargom.co.uk"><span>ADMIN</span></span>
    <nav>${ADMIN_NAV.map(([k, label, href]) => `<a href="${href}" ${k === active ? 'aria-current="page"' : ''}><i></i><span>${esc(label)}</span><b data-badge="${k}"></b></a>`).join('')}</nav>
    <div class="adm-foot"><a href="/app">Customer view</a><button type="button" data-signout>Sign out</button></div>
  </aside>
  <div class="adm-body">
    <header class="adm-top"><b>${esc(title)}</b><span class="adm-me"><span class="ini">${esc(ini)}</span><span><b>${esc(me.name)}</b><small>Super admin</small></span></span></header>
    <main class="adm-main"></main>
  </div>`;
  wrap.querySelector('[data-signout]').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* already out */ } location.href = '/'; });
  const page = document.querySelector('.page');
  (page || document.body.firstElementChild || document.body).replaceWith(wrap);
  const setBadge = (k, n) => { const b = wrap.querySelector(`[data-badge="${k}"]`); if (b) { b.textContent = n ? String(n) : ''; b.hidden = !n; } };
  return { main: wrap.querySelector('main'), me, setBadge };
}
