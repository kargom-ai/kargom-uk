/* Bits shared by the Turkey warehouse pages (customer and admin). */
import { esc, resizeImage } from './market-ui.js';

/** Shop logo (through our server) or a letter tile for shops we do not know. */
export function shopLogo(store, known = [], size = 30) {
  const s = String(store || '?');
  const letter = esc(s.replace(/^www\./, '').slice(0, 1).toUpperCase());
  // The letter sits underneath: if the logo cannot load, the letter shows instead of an empty box.
  return `<span class="tw-logo tw-logo-t" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px">${letter}${known.includes(s)
    ? `<img src="/api/shop-logo/${encodeURIComponent(s)}" alt="" loading="lazy">` : ''}</span>`;
}

/** Courier logo, or nothing when there is none. */
export const courierLogo = (url) => (url ? `<span class="tw-clogo"><img src="${esc(url)}" alt=""></span>` : '');

export const WAREHOUSE_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21V8l9-5 9 5v13"></path><path d="M7 21v-8h10v8"></path><path d="M7 17h10"></path></svg>';
export const CHAT_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
export const CAMERA_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"></path><circle cx="12" cy="13" r="3"></circle></svg>';

const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Messages about one parcel, as chat bubbles. `me` is 'admin' or 'customer' (whose bubbles go right). */
export function threadHtml(notes, me) {
  if (!notes.length) return `<div class="tw-empty" style="padding:20px"><b>No messages yet</b>${me === 'admin' ? 'Add a note or photos: the customer gets an email.' : 'Questions about this parcel? Write to our warehouse team here.'}</div>`;
  return `<div class="tw-thread">${notes.map((n) => `<div class="tw-msg ${n.author === me ? 'mine' : ''}">
    <small>${n.author === 'admin' ? 'Kargom warehouse' : 'Customer'} · ${when(n.createdAt)}</small>
    ${n.body ? `<p>${esc(n.body)}</p>` : ''}
    ${n.photos.length ? `<div class="tw-photos">${n.photos.map((u) => `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="Photo of the parcel" loading="lazy"></a>`).join('')}</div>` : ''}</div>`).join('')}</div>`;
}

/** Composer: text box, photo picker with previews. Pending photos live in `state.photos`. */
export function composerHtml(state, placeholder) {
  return `<div class="tw-compose">
    <textarea class="tw-in" name="msg" rows="3" placeholder="${esc(placeholder)}">${esc(state.msg || '')}</textarea>
    ${state.photos?.length ? `<div class="tw-photos">${state.photos.map((p, i) => `<span class="tw-ph"><img src="${p}" alt=""><button type="button" data-unphoto="${i}" aria-label="Remove photo">×</button></span>`).join('')}</div>` : ''}
    <label class="tw-btn ghost sm" style="align-self:flex-start">${CAMERA_ICON} Add photos<input type="file" accept="image/*" multiple data-photos hidden></label></div>`;
}

/** Read chosen files into small JPEGs (max 6). */
export async function readPhotos(files, have = []) {
  const out = [...have];
  for (const f of [...files].slice(0, Math.max(0, 6 - out.length))) out.push(await resizeImage(f, 1400, 'image/jpeg', 0.78));
  return out;
}

// A logo that fails to load is removed, so the shop's letter underneath shows.
document.addEventListener('error', (e) => { const t = e.target; if (t instanceof HTMLImageElement && t.parentElement?.classList.contains('tw-logo-t')) t.remove(); }, true);
