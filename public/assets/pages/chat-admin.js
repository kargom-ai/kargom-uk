import { mountAdminShell } from '../admin-shell.js';
import { api } from '../dc.js';

/** Admin: live chat with website visitors. List on the left, conversation on the right; refreshes every few seconds. */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? 'now' : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
const time = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const QUICK = [
  'Hi! Thanks for your message, I am looking into it now.',
  'Could you send me your Kargom reference (KGM-…) or the tracking number, please?',
  'You can compare prices and book on our homepage: enter the postcodes and the parcel weight, then pick a courier.',
  'I have opened a trace with the courier and will update you within 24 hours.',
];

let main, shell;
const S = { list: [], cur: null, filter: 'open', draft: '' };

async function loadList() {
  const r = await api('/api/admin/chat');
  S.list = r.threads;
  shell.setBadge('chat', S.list.filter((t) => t.status === 'open' && t.unread).length);
}
async function openThread(id) { S.cur = await api(`/api/admin/chat/${encodeURIComponent(id)}`); history.replaceState(null, '', `/admin/chat?t=${encodeURIComponent(id)}`); }

function render() {
  const ta = main.querySelector('textarea');
  if (ta) S.draft = ta.value;
  const list = S.list.filter((t) => (S.filter === 'all' ? true : t.status === S.filter));
  const n = (f) => S.list.filter((t) => t.status === f).length;
  const cur = S.cur;
  main.innerHTML = `
  <div class="lc">
    <aside class="lc-list">
      <div class="lc-tabs">${[['open', `Open (${n('open')})`], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) => `<button type="button" data-f="${k}" aria-pressed="${S.filter === k}">${l}</button>`).join('')}</div>
      ${list.length ? list.map((t) => `<button type="button" class="lc-item${cur?.id === t.id ? ' on' : ''}" data-t="${esc(t.id)}">
        <span class="lc-top"><b>${esc(t.name)}</b>${t.visitorHere ? '<i class="here" title="On the website now"></i>' : ''}<small>${ago(t.lastAt)}</small></span>
        <span class="lc-last">${t.lastFrom === 'agent' ? 'You: ' : ''}${esc(t.last)}</span>
        ${t.unread ? `<span class="lc-badge">${t.unread}</span>` : ''}</button>`).join('') : '<p class="lc-empty">No conversations here yet. When someone writes in the chat bubble on the website, it shows up here.</p>'}
    </aside>
    <section class="lc-thread">
      ${cur ? `
      <header class="lc-head">
        <div><b>${esc(cur.name)}</b> ${cur.visitorHere ? '<span class="lc-here">On the website now</span>' : ''}
          <small>${cur.email ? `<a href="mailto:${esc(cur.email)}">${esc(cur.email)}</a>` : ''}${cur.customerId ? ` · <a href="/admin?customer=${encodeURIComponent(cur.customerId)}">Customer profile</a>` : ' · Guest'}${cur.page ? ` · from <code>${esc(cur.page)}</code>` : ''}</small></div>
        <button type="button" class="lc-btn ghost" data-close="${cur.status === 'open' ? '1' : '0'}">${cur.status === 'open' ? 'Mark as done' : 'Reopen'}</button>
      </header>
      <div class="lc-msgs">${cur.messages.map((m) => `<div class="lc-m ${m.from === 'agent' ? 'a' : 'v'}">${esc(m.body)}<small>${m.from === 'agent' ? 'Kargom · ' : ''}${time(m.at)}</small></div>`).join('')}</div>
      <form class="lc-reply">
        <div class="lc-quick">${QUICK.map((q, i) => `<button type="button" data-q="${i}">${esc(q.slice(0, 38))}…</button>`).join('')}</div>
        <div class="lc-row"><textarea name="body" placeholder="Write a reply… (Enter to send, Shift+Enter for a new line)" rows="2">${esc(S.draft)}</textarea><button class="lc-btn" type="submit">Send</button></div>
        ${cur.visitorHere ? '' : '<p class="lc-note">They are not on the website right now: your reply will also be emailed to them.</p>'}
      </form>` : '<div class="lc-pick">Pick a conversation on the left.</div>'}
    </section>
  </div>`;
  const msgs = main.querySelector('.lc-msgs');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

async function refresh(keepFocus) {
  const had = document.activeElement?.tagName === 'TEXTAREA';
  const pos = had ? document.activeElement.selectionStart : 0;
  await loadList();
  if (S.cur) S.cur = await api(`/api/admin/chat/${encodeURIComponent(S.cur.id)}`);
  render();
  if (had || keepFocus) { const t = main.querySelector('textarea'); if (t) { t.focus(); t.setSelectionRange(pos, pos); } }
}

(async () => {
  try { shell = await mountAdminShell('chat', 'Live chat'); } catch { location.href = `/login?next=${encodeURIComponent('/admin/chat')}`; return; }
  main = shell.main;
  await loadList();
  const want = new URLSearchParams(location.search).get('t') || S.list.find((t) => t.status === 'open')?.id;
  if (want) { try { await openThread(want); } catch { /* gone */ } }
  render();
  main.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-t]'); const f = e.target.closest('[data-f]'); const c = e.target.closest('[data-close]'); const q = e.target.closest('[data-q]');
    if (t) { S.draft = ''; await openThread(t.dataset.t); await loadList(); render(); }
    if (f) { S.filter = f.dataset.f; render(); }
    if (c) { S.cur = await api(`/api/admin/chat/${encodeURIComponent(S.cur.id)}/close`, { method: 'POST', body: { reopen: c.dataset.close === '0' } }); await loadList(); render(); }
    if (q) { const ta = main.querySelector('textarea'); ta.value = (ta.value ? `${ta.value} ` : '') + QUICK[Number(q.dataset.q)]; ta.focus(); }
  });
  main.addEventListener('keydown', (e) => { if (e.target.tagName === 'TEXTAREA' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.form.requestSubmit(); } });
  main.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ta = e.target.querySelector('textarea'); const body = ta.value.trim();
    if (!body || !S.cur) return;
    ta.disabled = true;
    try { S.cur = await api(`/api/admin/chat/${encodeURIComponent(S.cur.id)}/messages`, { method: 'POST', body: { body } }); S.draft = ''; ta.value = ''; await loadList(); }
    catch (err) { alertBox(err.message); }
    render();
    main.querySelector('textarea')?.focus();
  });
  setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 4000);
})();

function alertBox(text) {
  const d = document.createElement('div'); d.className = 'kg-toast'; d.setAttribute('role', 'status'); d.textContent = text; document.body.append(d); setTimeout(() => d.remove(), 4000);
}
