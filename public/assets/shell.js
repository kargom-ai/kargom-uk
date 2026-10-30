/* The signed-in app frame (header + left menu), same markup as the dashboard and Send a parcel. */
import { api } from './dc.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gbp = (p) => `£${(p / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

export const NAV = [
  ['dash', 'Dashboard', '/app'], ['ship', 'Shipments', '/app?view=ship'], ['wallet', 'Wallet', '/app?view=wallet'], ['inv', 'Invoices', '/app?view=inv'],
  ['addr', 'Address book', '/app?view=addr'], ['req', 'Moving & freight', '/app/requests'], ['tr', 'Shop from Turkey', '/app/turkey'], ['int', 'Integrations', '/app?view=int'], ['set', 'Settings', '/app?view=set'], ['help', 'Help', '/app?view=help'],
];

const plus = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>';
const truck = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"></path><circle cx="7" cy="17.5" r="1.8"></circle><circle cx="17" cy="17.5" r="1.8"></circle></svg>';

/**
 * Build the frame around `main`. `active` is 'send' | 'quote' | a NAV id.
 * Returns the <main> element to render the page into.
 */
export async function mountShell(active) {
  const [me, w] = await Promise.all([api('/api/me'), api('/api/wallet').catch(() => ({ balancePence: 0 }))]);
  const ini = (me.name || '?').split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase();
  const type = me.account_type === 'business' ? 'Business account' : 'Personal account';
  const on = (k) => active === k;
  const wrap = document.createElement('div');
  wrap.style.cssText = "font-family: 'Plus Jakarta Sans', system-ui, sans-serif; color: #1F2A3C; background: #F4F6FA; width: 100%; min-height: 100vh; display: flex; flex-direction: column";
  wrap.innerHTML = `
  <header class="m-apphead" style="background: #1F2A3C; color: #FFFFFF">
    <div style="padding: 12px 24px; display: flex; flex-wrap: wrap; align-items: center; gap: 14px 20px">
      <a href="/" aria-label="Kargom.co.uk home"><img src="/assets/logo-white.png" alt="Kargom.co.uk" style="height: 28px; width: auto; display: block"></a>
      <div style="margin-left: auto; display: flex; align-items: center; gap: 14px">
        <a href="/app?view=wallet" aria-label="Wallet balance ${gbp(w.balancePence)}" style="display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 14px 0 6px; border-radius: 12px; border: 1px solid #3B4A63; background: #26334A; color: #FFFFFF; font: 700 15px 'Outfit', sans-serif; text-decoration: none">
          <span style="width: 32px; height: 32px; border-radius: 8px; background: #2463DB; display: grid; place-items: center"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="3"></rect><path d="M3 10h18M16 15h2"></path></svg></span>
          <span style="font-variant-numeric: tabular-nums">${gbp(w.balancePence)}</span>
        </a>
        <span style="display: flex; align-items: center; gap: 10px">
          <span style="width: 38px; height: 38px; border-radius: 50%; background: #FFFFFF; color: #1F2A3C; display: grid; place-items: center; font: 700 14px 'Outfit', sans-serif">${esc(ini)}</span>
          <span class="m-hide" style="display: flex; flex-direction: column; line-height: 1.25"><b style="font-size: 14px">${esc(me.name)}</b><span style="font-size: 12px; color: #9FB0C8">${type}</span></span>
          <button type="button" class="m-hide" data-signout style="margin-left: 6px; min-height: 36px; padding: 0 12px; border-radius: 9px; border: 1px solid #3B4A63; background: transparent; color: #DCE4F2; font: 700 13px 'Plus Jakarta Sans', sans-serif; cursor: pointer">Sign out</button>
        </span>
      </div>
    </div>
  </header>
  <div style="flex: 1; display: flex; flex-wrap: wrap; align-items: stretch">
    <aside aria-label="Account menu" class="m-side" style="flex: 1 1 230px; max-width: 250px; background: #FFFFFF; border-right: 1px solid #E1E7EF; padding: 20px 14px; display: flex; flex-direction: column; gap: 6px; box-sizing: border-box">
      <a href="/app/send" ${on('send') ? 'aria-current="page"' : ''} style="display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; border-radius: 11px; background: #2463DB; color: #FFFFFF; font-weight: 700; text-decoration: none${on('send') ? '; box-shadow: 0 0 0 3px #BFD6FB' : ''}">${plus}Send a parcel</a>
      <a href="/app/quote" class="m-quote" ${on('quote') ? 'aria-current="page"' : ''} style="display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; border-radius: 11px; border: 1px solid ${on('quote') ? '#2463DB' : '#C9D6EA'}; background: ${on('quote') ? '#EAF2FE' : '#FFFFFF'}; color: ${on('quote') ? '#1D4FB8' : '#1F2A3C'}; font-weight: 700; font-size: 14px; text-decoration: none; margin-top: 4px${on('quote') ? '; box-shadow: 0 0 0 3px #BFD6FB' : ''}">${truck}Get a quote</a>
      <span style="height: 12px"></span>
      <nav style="display: flex; flex-direction: column; gap: 2px">
        ${NAV.map(([k, label, href]) => `<a href="${href}" class="nav" ${on(k) ? 'aria-current="page"' : ''} style="display: flex; align-items: center; gap: 11px; min-height: 42px; padding: 0 12px; border-radius: 10px; background: ${on(k) ? '#EAF2FE' : 'transparent'}; color: ${on(k) ? '#1D4FB8' : '#3E4A5C'}; font: 600 14px 'Plus Jakarta Sans', sans-serif; text-decoration: none">
          <span style="width: 8px; height: 8px; border-radius: 50%; background: ${on(k) ? '#2463DB' : '#C9D6EA'}"></span>${label}</a>`).join('')}
      </nav>
      <button type="button" class="m-signout" data-signout style="margin-top: 10px; display: flex; align-items: center; min-height: 42px; padding: 0 12px; border: 0; border-radius: 10px; background: transparent; color: #B42318; font: 600 14px 'Plus Jakarta Sans', sans-serif; cursor: pointer; text-align: left">Sign out</button>
    </aside>
    <main class="m-main" style="flex: 999 1 640px; min-width: 0; padding: 28px 28px 40px; display: flex; flex-direction: column; gap: 22px; box-sizing: border-box"></main>
  </div>`;
  for (const b of wrap.querySelectorAll('[data-signout]')) {
    b.addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* already out */ } location.href = '/'; });
  }
  const page = document.querySelector('.page');
  (page || document.body).replaceWith(wrap);
  return { main: wrap.querySelector('main'), me };
}
