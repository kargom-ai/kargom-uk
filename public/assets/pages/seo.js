/* Guide pages: tracking-number detector and volumetric weight calculator. No framework. */

// ---- Track: recognise the courier from the number, then open its tracking page ----
for (const form of document.querySelectorAll('form[data-track]')) {
  const cfg = JSON.parse(form.dataset.track);
  const input = form.querySelector('input');
  const out = form.querySelector('.tf-out');
  const patterns = cfg.patterns.map(([src, key]) => [new RegExp(src), key]);
  const clean = (v) => v.toUpperCase().replace(/[\s-]/g, '');
  const guess = (n) => [...new Set(patterns.filter(([re]) => re.test(n)).map(([, k]) => k))];

  const say = (html) => { out.innerHTML = html; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const link = (key, n) => cfg.carriers[key].url.replace('{n}', encodeURIComponent(n));

  // Arrived from the homepage tracking box: fill in and go.
  const pre = new URLSearchParams(location.search).get('n');
  if (pre) { input.value = pre; history.replaceState(null, '', location.pathname); setTimeout(() => form.requestSubmit(), 0); }

  input.addEventListener('input', () => {
    const n = clean(input.value);
    if (cfg.carrier || n.length < 8) { say(''); return; }
    const g = guess(n);
    say(g.length ? `Looks like <b>${g.map((k) => esc(cfg.carriers[k].name)).join('</b> or <b>')}</b>.` : '');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = clean(input.value);
    if (n.length < 6) { say('Enter the full tracking number.'); return; }
    const keys = cfg.carrier ? [cfg.carrier] : guess(n);
    if (!keys.length) {
      say(`We do not recognise that format. Pick the courier: ${Object.entries(cfg.carriers).map(([k, c]) => `<a href="${esc(link(k, n))}" rel="nofollow noopener">${esc(c.name)}</a>`).join(' · ')}`);
      return;
    }
    if (keys.length > 1) {
      say(`This could be ${keys.map((k) => `<a href="${esc(link(k, n))}" rel="nofollow noopener"><b>${esc(cfg.carriers[k].name)}</b></a>`).join(' or ')}. Choose one.`);
      return;
    }
    const c = cfg.carriers[keys[0]];
    if (!c.deep) {
      try { await navigator.clipboard.writeText(n); say(`Number copied. Opening ${esc(c.name)}: paste it there.`); } catch { say(`Opening ${esc(c.name)}. Your number is <b>${esc(n)}</b>.`); }
    } else {
      say(`Opening ${esc(c.name)} tracking…`);
    }
    setTimeout(() => { location.href = link(keys[0], n); }, c.deep ? 150 : 900);
  });
}

// ---- Volumetric weight calculator ----
const calc = document.getElementById('calc');
if (calc) {
  const out = calc.querySelector('.calc-out');
  const go = document.getElementById('calc-go');
  const num = (n) => { const v = Number(String(calc.elements[n].value).replace(',', '.')); return v > 0 ? v : 0; };
  const fmt = (v) => (Math.round(v * 100) / 100).toLocaleString('en-GB');
  const run = () => {
    const l = num('l'), w = num('w'), h = num('h'), kg = num('kg'), d = num('d') || 5000;
    if (!l || !w || !h) { out.textContent = 'Enter all three sides in centimetres.'; return; }
    const vol = (l * w * h) / d;
    const charged = Math.max(vol, kg);
    out.innerHTML = `<span>Volumetric weight</span><b class="v">${fmt(vol)} kg</b><span>${kg ? (vol > kg ? `Charged by <b>size</b> as ${fmt(charged)} kg, not ${fmt(kg)} kg. A smaller box would cost less.` : `Charged by <b>weight</b> as ${fmt(charged)} kg. The box size is fine.`) : 'Add the real weight to see which one is charged.'}</span>`;
    go.href = `/quotes?from=United+Kingdom&to=United+Kingdom&kg=${encodeURIComponent(kg || Math.max(0.1, Math.ceil(vol * 10) / 10))}&l=${encodeURIComponent(l)}&w=${encodeURIComponent(w)}&h=${encodeURIComponent(h)}`;
  };
  calc.addEventListener('input', run);
  calc.addEventListener('submit', (e) => e.preventDefault());
  run();
}
