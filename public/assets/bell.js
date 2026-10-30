/* The notification bell: a dropdown of the latest updates (any page with a [data-bell] button). */
import { api } from './dc.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const AREA = { ship: ['Shipments', '#2463DB'], tr: ['Shop from Turkey', '#E30A17'], req: ['Moving & freight', '#0F766E'], wallet: ['Wallet', '#5B2BB5'], help: ['Help', '#9A5B00'] };
const ago = (iso) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

let data = { items: [], unread: {}, total: 0 };
let panel = null;

/** Tell the page (badges, dot) that the counts changed. */
function publish(d) { data = d; document.dispatchEvent(new CustomEvent('kg-inbox', { detail: d })); }

export async function loadInbox() {
  try { publish(await api('/api/inbox')); } catch { /* signed out */ }
  return data;
}
/** Visiting an area clears its red count. */
export async function readArea(area) {
  if (!data.unread?.[area]) return;
  try { publish(await api('/api/inbox/read', { method: 'POST', body: { area } })); } catch { /* ignore */ }
}

function close() { panel?.remove(); panel = null; }
function draw(anchor) {
  const r = anchor.getBoundingClientRect();
  panel ||= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'kg-bell' }));
  panel.style.cssText = `position:fixed;top:${Math.round(r.bottom + 8)}px;right:${Math.max(12, Math.round(innerWidth - r.right - 8))}px;width:min(380px,calc(100vw - 24px));max-height:min(70vh,560px);overflow:auto;background:#FFFFFF;border:1px solid #E1E7EF;border-radius:16px;box-shadow:0 20px 50px rgba(15,23,42,.22);z-index:60;font-family:'Nunito Sans',system-ui,sans-serif;color:#1F2A3C`;
  panel.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #EEF2F7;position:sticky;top:0;background:#FFFFFF">
      <b style="font-size:16px">Notifications</b>${data.total ? '<button type="button" data-all style="border:0;background:none;color:#2463DB;font:700 13px inherit;cursor:pointer">Mark all as read</button>' : ''}</div>
    ${data.items.length ? data.items.map((i) => `<button type="button" data-item="${esc(i.id)}" data-link="${esc(i.link || '')}" style="display:flex;gap:12px;width:100%;text-align:left;padding:12px 16px;border:0;border-bottom:1px solid #F1F4F8;background:${i.read ? '#FFFFFF' : '#F5F9FF'};cursor:pointer;font:inherit;color:inherit">
        <span style="flex:none;width:10px;height:10px;margin-top:5px;border-radius:50%;background:${i.read ? 'transparent' : '#E5484D'}"></span>
        <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
          <small style="font-size:11px;font-weight:800;letter-spacing:.03em;color:${(AREA[i.area] || AREA.ship)[1]};text-transform:uppercase">${esc((AREA[i.area] || AREA.ship)[0])} · <span style="color:#8593A8;font-weight:700;text-transform:none">${ago(i.createdAt)}</span></small>
          <b style="font-size:14px;font-weight:${i.read ? 600 : 800}">${esc(i.title)}</b>${i.body ? `<span style="font-size:13px;color:#586579;line-height:1.4">${esc(i.body)}</span>` : ''}</span></button>`).join('')
    : '<div style="padding:28px 16px;text-align:center;color:#586579;font-size:14px">No notifications yet. Updates about your parcels show here.</div>'}`;
}

document.addEventListener('click', async (e) => {
  const bell = e.target.closest?.('[data-bell]');
  if (bell) { e.preventDefault(); if (panel) { close(); return; } draw(bell); await loadInbox(); if (panel) draw(document.querySelector("[data-bell]") || bell); return; }
  if (!panel) return;
  if (!panel.contains(e.target)) { close(); return; }
  const all = e.target.closest('[data-all]');
  if (all) { try { publish(await api('/api/inbox/read', { method: 'POST', body: { all: true } })); } catch { /* ignore */ } draw(document.querySelector('[data-bell]')); return; }
  const it = e.target.closest('[data-item]');
  if (it) {
    try { publish(await api('/api/inbox/read', { method: 'POST', body: { id: it.dataset.item } })); } catch { /* ignore */ }
    close();
    const link = it.dataset.link;
    if (link && link.startsWith('/')) location.href = link;
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
// Fresh counts every minute while the page is open.
setInterval(() => { if (document.visibilityState === 'visible') loadInbox(); }, 60_000);
