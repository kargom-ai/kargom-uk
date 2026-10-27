/**
 * Tiny template renderer for the Kargom design files.
 *
 * The pages are the exact markup from the approved designs: HTML with
 * {{path}} holes, <sc-for list="{{items}}" as="x"> loops and
 * <sc-if value="{{flag}}"> blocks. A page's logic class returns the values
 * for the holes from renderVals(), and calls setState() to re-render.
 *
 * Typed values in inputs survive re-renders (keyed by their place in the
 * template), and focus is restored, so uncontrolled form fields just work.
 */

const RENAMED = { 'x-table': 'table', 'x-thead': 'thead', 'x-tbody': 'tbody', 'x-tr': 'tr', 'x-td': 'td', 'x-th': 'th', 'x-select': 'select', 'x-option': 'option' };
const EVENTS = { onclick: 'click', onchange: 'change', oninput: 'input', onsubmit: 'submit', onkeydown: 'keydown' };
const HOLE = /\{\{\s*([\w.$]+)\s*\}\}/g;
const SOLE = /^\{\{\s*([\w.$]+)\s*\}\}$/;

/** Parse template text without the HTML parser moving our loop tags out of tables and selects. */
export function parseTemplate(src) {
  const safe = src.replace(/<(\/?)(table|thead|tbody|tr|td|th|select|option)(?=[\s>])/gi, (_, slash, tag) => `<${slash}x-${tag.toLowerCase()}`);
  const t = document.createElement('template');
  t.innerHTML = safe;
  return t.content;
}

function resolve(path, scope) {
  if (path === 'true') return true;
  if (path === 'false') return false;
  let v = scope;
  for (const part of path.split('.')) {
    if (v === null || v === undefined) return undefined;
    v = v[part];
  }
  return v;
}

function interp(text, scope) {
  return text.replace(HOLE, (_, p) => {
    const v = resolve(p, scope);
    return v === undefined || v === null ? '' : String(v);
  });
}

export class DCLogic {
  constructor(props = {}) {
    this.props = props;
    this.state = {};
    this.__render = null;
  }
  setState(patch) {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...next };
    if (this.__render) this.__render();
  }
}

export function mount(Component, templateSrc, root, props = {}) {
  const tpl = parseTemplate(templateSrc);
  const comp = new Component(props);
  const kept = new Map(); // key -> { value, checked }
  let scheduled = false;

  function build(node, scope, key, out) {
    if (node.nodeType === Node.TEXT_NODE) {
      out.append(document.createTextNode(node.nodeValue.includes('{{') ? interp(node.nodeValue, scope) : node.nodeValue));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.localName;
    if (tag === 'sc-for') {
      const m = SOLE.exec(node.getAttribute('list') || '');
      const list = m ? resolve(m[1], scope) : [];
      const as = node.getAttribute('as') || 'item';
      (Array.isArray(list) ? list : []).forEach((item, i) => {
        const s = Object.create(scope);
        s[as] = item;
        node.childNodes.forEach((c, j) => build(c, s, `${key}.${i}.${j}`, out));
      });
      return;
    }
    if (tag === 'sc-if') {
      const m = SOLE.exec(node.getAttribute('value') || '');
      if (m && resolve(m[1], scope)) node.childNodes.forEach((c, j) => build(c, scope, `${key}.${j}`, out));
      return;
    }
    const real = RENAMED[tag];
    const el = real ? document.createElement(real) : node.cloneNode(false);
    for (const a of [...node.attributes]) {
      const name = a.name.toLowerCase();
      const sole = SOLE.exec(a.value);
      if (EVENTS[name]) {
        if (real === undefined) el.removeAttribute(a.name);
        const fn = sole ? resolve(sole[1], scope) : null;
        if (typeof fn === 'function') el.addEventListener(EVENTS[name], fn);
        continue;
      }
      if (sole && (name === 'checked' || name === 'disabled' || name === 'selected' || name === 'hidden' || name === 'readonly')) {
        const v = resolve(sole[1], scope);
        if (real === undefined) el.removeAttribute(a.name);
        if (v === true || v === 'true') el.setAttribute(name, '');
        continue;
      }
      const value = a.value.includes('{{') ? interp(a.value, scope) : a.value;
      el.setAttribute(a.name, value);
    }
    const formy = el.localName === 'input' || el.localName === 'textarea' || el.localName === 'select';
    if (formy) el.dataset.k = key;
    node.childNodes.forEach((c, j) => build(c, scope, `${key}.${j}`, el));
    if (el.localName === 'textarea' && el.hasAttribute('value')) el.value = el.getAttribute('value');
    out.append(el);
  }

  function render() {
    scheduled = false;
    // Remember what the person typed and where the cursor was.
    for (const el of root.querySelectorAll('[data-k]')) {
      if (el.dataset.controlled === '1') continue;
      kept.set(el.dataset.k, { value: el.value, checked: el.checked, dirty: el.dataset.dirty === '1' });
    }
    const active = document.activeElement?.dataset?.k;
    const sel = active ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;

    const vals = comp.renderVals();
    const frag = document.createDocumentFragment();
    tpl.childNodes.forEach((c, j) => build(c, vals, String(j), frag));
    for (const el of frag.querySelectorAll('[data-k]')) {
      el.addEventListener('input', () => { el.dataset.dirty = '1'; });
      el.addEventListener('change', () => { el.dataset.dirty = '1'; });
      const k = kept.get(el.dataset.k);
      if (k && k.dirty) {
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = k.checked;
        else el.value = k.value;
        el.dataset.dirty = '1';
      }
    }
    root.replaceChildren(frag);
    if (active) {
      const el = root.querySelector(`[data-k="${CSS.escape(active)}"]`);
      if (el) {
        el.focus();
        try { if (sel && sel[0] !== null) el.setSelectionRange(sel[0], sel[1]); } catch { /* not a text input */ }
      }
    }
  }

  comp.__render = () => {
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(render);
    }
  };
  render();
  if (typeof comp.mounted === 'function') comp.mounted();
  return comp;
}

/** Read the current value of a field by its aria-label or name inside the page. */
export function field(labelOrName) {
  const el = document.querySelector(`[aria-label="${CSS.escape(labelOrName)}"], [name="${CSS.escape(labelOrName)}"]`);
  return el ? (el.type === 'checkbox' ? el.checked : el.value) : '';
}

/** Forget typed values (e.g. after a successful submit) so the form starts clean. */
export function clearTyped(root = document) {
  root.querySelectorAll('[data-k]').forEach((el) => { el.dataset.dirty = '0'; });
}

// ---------- shared helpers for the page logic ----------
export async function api(path, { method = 'GET', body, idempotencyKey } = {}) {
  const headers = { 'X-Requested-With': 'kargom' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(path, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data?.error?.code;
    throw err;
  }
  return data;
}

export const gbp = (p) => `${p < 0 ? '−' : ''}£${(Math.abs(p) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
export const shortDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
export const dateTime = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

export const CARRIER_LOGO = {
  royal_mail: '/assets/carriers/royalmail.png', evri: '/assets/carriers/evri.png', dpd: '/assets/carriers/dpd.png', inpost: '/assets/carriers/inpost.png',
  ups: '/assets/carriers/ups.png', dhl: '/assets/carriers/dhl.png', fedex: '/assets/carriers/fedex.png', parcelforce: '/assets/carriers/parcelforce.png', yodel: '/assets/carriers/yodel.png',
};
export const CARRIER_NAME = { royal_mail: 'Royal Mail', evri: 'Evri', dpd: 'DPD', inpost: 'InPost', ups: 'UPS', dhl: 'DHL', fedex: 'FedEx', parcelforce: 'Parcelforce', yodel: 'Yodel' };

/** Representative postcodes so the homepage can price without a full address. */
export const SAMPLE_POSTCODE = {
  'United Kingdom': ['GB', 'M1 1AE'], 'Northern Ireland': ['GB', 'BT1 1AA'], 'Channel Islands': ['JE', 'JE2 3AB'], 'Scottish Highlands & Islands': ['GB', 'IV1 1AA'],
  'United States': ['US', '10001'], Germany: ['DE', '10115'], France: ['FR', '75001'], Ireland: ['IE', 'D02 X285'], Netherlands: ['NL', '1012 AB'],
  Spain: ['ES', '28001'], Italy: ['IT', '00184'], Australia: ['AU', '2000'], Canada: ['CA', 'M5V 2T6'], Turkey: ['TR', '34000'],
};
export const COUNTRY_CODE = { 'United Kingdom': 'GB', 'United States': 'US', Germany: 'DE', France: 'FR', Ireland: 'IE', Netherlands: 'NL', Spain: 'ES', Italy: 'IT', Australia: 'AU', Canada: 'CA', Turkey: 'TR' };
