import { api, esc, toast } from '../market-ui.js';

/**
 * Admin: the weekly container market. Every Thursday Drewry publishes the World Container Index
 * (free, drewry.co.uk). Type the $ per 40ft numbers here; the freight page and the sea estimates
 * use the newest week straight away.
 */
const root = document.getElementById('root');
const S = { keys: {}, weeks: [], busy: false };
const nextThursday = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 3) % 7)); return d.toISOString().slice(0, 10); };

function render() {
  const last = S.weeks[0]?.values || {};
  const keys = Object.entries(S.keys);
  root.className = 'wrap';
  root.innerHTML = `<div class="steps-head"><h1>Container market index</h1><span class="muted">Drewry World Container Index · $ per 40ft · updated every Thursday</span></div>
  <section class="card" style="display:flex;flex-direction:column;gap:14px;max-width:760px">
    <p style="margin:0">1. Open <a href="https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry" target="_blank" rel="noopener">Drewry World Container Index</a> (new figures every Thursday).<br>
    2. Type this week's numbers below. Leave a box empty if it is not listed. 3. Save. The freight page updates at once.</p>
    <label class="fld">Index date (the Thursday)<input class="inp" id="week" type="date" value="${esc(nextThursday())}"></label>
    <div class="grid2">${keys.map(([k, label]) => `<label class="fld">${esc(label)} <em>(last week: ${last[k] ? '$' + last[k].toLocaleString('en-GB') : '–'})</em><input class="inp" inputmode="numeric" data-k="${k}" placeholder="e.g. ${last[k] || ''}"></label>`).join('')}</div>
    <button type="button" class="btn big" id="save" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Saving…' : 'Save this week'}</button>
  </section>
  <section class="card" style="margin-top:16px;max-width:760px;overflow-x:auto">
    <h2 style="font-size:18px;margin:0 0 10px">Saved weeks</h2>
    <table style="border-collapse:collapse;font-size:14px;min-width:560px"><tr><th style="text-align:left;padding:6px">Week</th>${keys.map(([, l]) => `<th style="text-align:right;padding:6px">${esc(l.replace('Shanghai', 'SHA').replace('Rotterdam', 'RTM').replace('Los Angeles', 'LA').replace('New York', 'NY').replace('Genoa', 'GOA').replace('WCI composite', 'WCI'))}</th>`).join('')}</tr>
    ${S.weeks.map((w) => `<tr><td style="padding:6px;border-top:1px solid #E5E9F0">${esc(w.week)}</td>${keys.map(([k]) => `<td style="text-align:right;padding:6px;border-top:1px solid #E5E9F0">${w.values[k] ? w.values[k].toLocaleString('en-GB') : '–'}</td>`).join('')}</tr>`).join('')}</table>
  </section>`;
}

root.addEventListener('click', async (e) => {
  if (!e.target.closest('#save') || S.busy) return;
  const values = {};
  root.querySelectorAll('[data-k]').forEach((i) => { if (i.value.trim()) values[i.dataset.k] = i.value.trim(); });
  S.busy = true; render();
  try {
    await api('/api/admin/market', { method: 'POST', body: { week: document.getElementById('week')?.value || nextThursday(), values } });
    S.weeks = (await api('/api/admin/market')).weeks; toast('Saved. The freight page now uses this week.');
  } catch (err) { toast(err.message); }
  S.busy = false; render();
});

(async () => {
  try { const r = await api('/api/admin/market'); S.keys = r.keys; S.weeks = r.weeks; render(); }
  catch { location.href = '/login?next=/admin/market'; }
})();
