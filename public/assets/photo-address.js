import { api } from './dc.js';

/** Decode any picture the phone gives us (JPEG, PNG, HEIC on iPhone, WebP). */
async function decode(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* older browsers, HEIC */ }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
    return img;
  } catch { return null; } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}

/** Shrink a photo before upload: long side up to 2400 px, JPEG under ~2 MB. */
export async function shrinkPhoto(file) {
  const img = await decode(file);
  if (!img) {
    // could not draw it here; send small JPEG/PNG files as they are
    if (/^image\/(jpeg|png|webp)$/.test(file.type) && file.size < 3_000_000) {
      return await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = bad; r.readAsDataURL(file); });
    }
    throw new Error('We could not open that picture. Try a screenshot or a JPG photo.');
  }
  const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
  const k = Math.min(1, 2400 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext('2d');
  g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  for (const q of [0.9, 0.8, 0.7, 0.6]) { const d = c.toDataURL('image/jpeg', q); if (d.length < 3_000_000 && d.startsWith('data:image/jpeg')) return d; }
  return c.toDataURL('image/jpeg', 0.5);
}

/** Put whatever was read into the boxes named `${px}_name`, `${px}_phone`, … Never wipes what was typed. */
export function applyAddress(a, px, setField, { useCompany = false, ukOnly = false, from = 'photo' } = {}) {
  const has = (k) => document.querySelector(`[aria-label="${k}"]`);
  const put = (k, v) => { if (v && has(k)) setField(k, v); };
  if (useCompany && a.company && has(`${px}_company`)) { put(`${px}_company`, a.company); put(`${px}_name`, a.name !== a.company ? a.name : ''); }
  else put(`${px}_name`, a.name || a.company);
  put(`${px}_phone`, a.phone); put(`${px}_email`, a.email);
  put(`${px}_line1`, a.line1); put(`${px}_line2`, a.line2); put(`${px}_city`, a.city); put(`${px}_postcode`, a.postcode);
  const got = ['name', 'phone', 'line1', 'city', 'postcode'].filter((k) => a[k] || (k === 'name' && a.company)).length;
  if (ukOnly && a.country && a.country !== 'GB') return { ok: false, msg: 'This looks like an address outside the UK. This booking is for UK addresses.', address: a };
  return { ok: true, msg: got >= 4 ? `Filled in from your ${from}. Please check the details.` : 'We filled in what we could read. Please complete the rest.', address: a };
}

/** Read an address from a photo or screenshot and fill the boxes. Returns a short message for the customer. */
export async function fillFromPhoto(file, px, setField, opts = {}) {
  const image = await shrinkPhoto(file);
  const r = await api('/api/address/from-image', { method: 'POST', body: { image } });
  if (!r.found) return { ok: false, msg: 'We could not read an address in that image. Try a closer photo, or type it below.', address: r.address };
  return applyAddress(r.address, px, setField, { ...opts, from: 'photo' });
}

/** Read an address from pasted text (any shape) and fill the boxes. */
export async function fillFromText(text, px, setField, opts = {}) {
  const r = await api('/api/address/from-text', { method: 'POST', body: { text } });
  if (!r.found) return { ok: false, msg: 'We could not find an address in that text. Check it, or type it below.', address: r.address };
  return applyAddress(r.address, px, setField, { ...opts, from: 'text' });
}

/** What is on the clipboard, if the browser lets us read it (otherwise the customer pastes by hand). */
export async function clipboardText() {
  try { return (await navigator.clipboard?.readText?.()) || ''; } catch { return ''; }
}

export { postcodeHere } from './here.js';
