/**
 * Product link preview, like a chat app shows: the product's name, price and main picture,
 * read from the page (Open Graph tags, schema.org Product data, the shop's own page data).
 * Only for the Turkish shops we know, over https, with every redirect checked, so a customer's
 * link can never make our server call anything else.
 */

/** Shops whose product pages we read (and their short-link domains). */
const PAGE_HOSTS = ['trendyol.com', 'ty.gl', 'hepsiburada.com', 'hb.gl', 'amazon.com.tr', 'amzn.eu', 'amzn.to', 'n11.com', 'ciceksepeti.com', 'koton.com', 'lcw.com',
  'defacto.com.tr', 'boyner.com.tr', 'mavi.com', 'pazarama.com', 'morhipo.com'];
/** Where those shops keep their product pictures. */
const IMAGE_HOSTS = ['dsmcdn.com', 'trendyol.com', 'hepsiburada.net', 'hepsiburada.com', 'media-amazon.com', 'ssl-images-amazon.com', 'amazon.com.tr', 'n11scdn.com', 'n11.com',
  'ciceksepeti.com', 'koton.com', 'ktncdn.com', 'lcw.com', 'lcwaikiki.com', 'defacto.com.tr', 'boyner.com.tr', 'mavi.com', 'pazarama.com', 'morhipo.com'];

const hostOk = (u: URL, list: string[]) => u.protocol === 'https:' && !u.port && list.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
export const isShopLink = (url: string) => { try { return hostOk(new URL(url), PAGE_HOSTS); } catch { return false; } };

// A normal browser string, plus who we are, so shops serve the regular page and can still see it is us.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 KargomLinkPreview/1.1 (+https://kargom.co.uk/about)';

type Got = { url: URL; type: string; data: Buffer };
/** GET with redirects followed by hand, each hop checked against the allow-list. Notes each step for the admin test page. */
async function safeGet(url: string, allow: string[], f: typeof fetch, accept: string, maxBytes: number, log: string[]): Promise<Got | null> {
  let u = new URL(url);
  for (let hop = 0; hop < 5; hop++) {
    if (!hostOk(u, allow)) { log.push(`stopped: ${u.hostname} is not a shop we read`); return null; }
    const r = await f(u.toString(), {
      redirect: 'manual', signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8', 'Cache-Control': 'no-cache' },
    });
    log.push(`${r.status} ${u.hostname}${u.pathname.slice(0, 60)}`);
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc) return null;
      u = new URL(loc, u);
      continue;
    }
    if (!r.ok || !r.body) return null;
    if (Number(r.headers.get('content-length') ?? 0) > maxBytes) { log.push('too big'); return null; }
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) { await reader.cancel().catch(() => {}); break; }
      chunks.push(value);
    }
    return { url: u, type: r.headers.get('content-type') ?? '', data: Buffer.concat(chunks) };
  }
  log.push('too many redirects');
  return null;
}

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&')
  .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\//g, '/');
function meta(html: string, keys: string[]): string | null {
  for (const k of keys) {
    for (const tag of html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${k}["'][^>]*>`, 'gi')) ?? []) {
      const content = tag.match(/content=["']([^"']*)["']/i)?.[1];
      if (content?.trim()) return decode(content.trim());
    }
  }
  return null;
}
/** schema.org Product blocks: name, image, offers.price. */
function jsonLd(html: string): { name?: string; image?: string; price?: number } {
  const out: { name?: string; image?: string; price?: number } = {};
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try { data = JSON.parse(m[1]!.trim()); } catch { continue; }
    const items: unknown[] = Array.isArray(data) ? data : [data, ...(((data as Record<string, unknown>)?.['@graph'] as unknown[]) ?? [])];
    for (const it of items) {
      const o = it as Record<string, unknown>;
      if (!o || !String(o['@type'] ?? '').includes('Product')) continue;
      if (!out.name && typeof o.name === 'string') out.name = o.name;
      const img = Array.isArray(o.image) ? o.image[0] : o.image;
      if (!out.image) out.image = typeof img === 'string' ? img : (img as Record<string, string> | undefined)?.url;
      const offers = (Array.isArray(o.offers) ? o.offers[0] : o.offers) as Record<string, unknown> | undefined;
      const p = Number(offers?.price ?? offers?.lowPrice);
      if (!out.price && p > 0) out.price = p;
    }
  }
  return out;
}
/** "1.299,90" / "1299.90" / 1299.9 → 1299.9 */
function num(s: string | number | null | undefined): number | null {
  if (s == null) return null;
  if (typeof s === 'number') return s > 0 ? s : null;
  let t = String(s).replace(/[^\d.,]/g, '');
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); else t = t.replace(/,/g, '');
  const n = Number(t);
  return n > 0 && n < 10_000_000 ? n : null;
}

export type Preview = { title: string | null; english?: string | null; priceTry: number | null; image: { type: string; data: Buffer } | null; log?: string[] };

const TR_FIX: Record<string, string> = { kulaklik: 'kulaklık', gurultu: 'gürültü', kadin: 'kadın', erkek: 'erkek', cocuk: 'çocuk', canta: 'çanta', elbise: 'elbise', gomlek: 'gömlek',
  ayakkabi: 'ayakkabı', pantolon: 'pantolon', tisort: 'tişört', kazak: 'kazak', ceket: 'ceket', saat: 'saat', telefon: 'telefon', kilif: 'kılıf', sarj: 'şarj', bebek: 'bebek' };
/** The product name written in the link itself: trendyol.com/tarcin/air-4-pro-…-p-123 → "Tarcin Air 4 Pro …". No request to the shop. */
export function nameFromLink(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').map((p) => decodeURIComponent(p)).filter(Boolean);
    const isTy = /trendyol\.com$/.test(u.hostname);
    // the longest hyphenated piece is the product name; Amazon puts it before /dp/
    const dp = parts.indexOf('dp');
    let slug = dp > 0 ? parts[dp - 1]! : [...parts].sort((a, b) => b.split('-').length - a.split('-').length)[0] ?? '';
    slug = slug.replace(/-(p|pm|pd)-[\w-]*$/i, '').replace(/-\d{5,}$/, '').replace(/\.html?$/, '');
    if (slug.split('-').length < 2) return null;
    const brand = isTy && parts.length > 1 && parts[0] !== slug ? parts[0]! : '';
    const words = `${brand ? `${brand}-` : ''}${slug}`.split('-').filter(Boolean).slice(0, 14)
      .map((w) => TR_FIX[w.toLowerCase()] ?? w).map((w) => (/^(anc|usb|led|xl|xxl|tws|5g|4g|hd|uv)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1)));
    return words.join(' ').slice(0, 160) || null;
  } catch { return null; }
}

/** A short English name a customs officer understands ("Tarcin wireless earbuds"). Cheap, fast model; null without a key. */
export async function englishName(name: string, f: typeof fetch = fetch): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !name) return null;
  try {
    const r = await f('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(12_000),
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_FAST_MODEL || 'claude-haiku-5-5', max_tokens: 30,
        messages: [{ role: 'user', content: `Turkish shop product name: "${name.slice(0, 200)}"\nWrite a short English name for a customs form: brand + what it is, 2 to 4 words, no marketing words, no model numbers. Examples: "Tarcin wireless earbuds", "Koton cotton dress", "Leather shoulder bag". Reply with the name only.` }] }),
    });
    const j = (await r.json().catch(() => ({}))) as { content?: Array<{ type: string; text?: string }> };
    if (!r.ok) return null;
    const t = (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('').replace(/["\n]/g, ' ').trim();
    return t && t.length <= 60 ? t : null;
  } catch { return null; }
}
const EMPTY = (log: string[]): Preview => ({ title: null, priceTry: null, image: null, log });

/** Read a product page's name, price and picture. Never throws: returns nulls when the shop blocks us. */
export async function productPreview(url: string, f: typeof fetch = fetch): Promise<Preview> {
  const log: string[] = [];
  try {
    if (!isShopLink(url)) { log.push('not a shop link we read'); return EMPTY(log); }
    const fromLink = nameFromLink(url);
    // When the shop does not let us read the page, the name in the link is still there.
    const linkOnly = async () => { log.push(fromLink ? `name from the link: ${fromLink}` : 'no name in the link'); return { title: fromLink, english: fromLink ? await englishName(fromLink, f) : null, priceTry: null, image: null, log }; };
    const page = await safeGet(url, PAGE_HOSTS, f, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 2_500_000, log);
    if (!page) return linkOnly();
    if (!/html/i.test(page.type)) { log.push(`not a web page (${page.type})`); return linkOnly(); }
    const html = page.data.toString('utf8');
    const ld = jsonLd(html);
    let title: string | null = meta(html, ['og:title', 'twitter:title']) ?? ld.name ?? decode(html.match(/<title[^>]*>([^<]{3,300})<\/title>/i)?.[1]?.trim() ?? '');
    title = title ? title.replace(/\s*[-|–]\s*(Fiyatı.*|Trendyol|Hepsiburada|Amazon\.com\.tr|n11|Çiçeksepeti|Koton|LC Waikiki|DeFacto|Boyner).*$/i, '').trim().slice(0, 200) || null : null;
    // Price: schema.org, product meta tags, then the shop's own page data (Trendyol: "sellingPrice"/"discountedPrice").
    const priceTry = num(ld.price) ?? num(meta(html, ['product:price:amount', 'og:price:amount', 'price']))
      ?? num(html.match(/"discountedPrice"\s*:\s*\{[^}]*?"value"\s*:\s*([\d.]+)/)?.[1]) ?? num(html.match(/"sellingPrice"\s*:\s*\{[^}]*?"value"\s*:\s*([\d.]+)/)?.[1])
      ?? num(html.match(/"(?:discountedPrice|sellingPrice|price)"\s*:\s*([\d.]+)/)?.[1]);
    const img = meta(html, ['og:image:secure_url', 'og:image', 'twitter:image']) ?? ld.image ?? null;
    log.push(`found: ${title ? 'name' : 'no name'}, ${priceTry ? `price ${priceTry}` : 'no price'}, ${img ? 'picture link' : 'no picture link'}`);
    let image: Preview['image'] = null;
    if (img) {
      const iu = new URL(img.startsWith('//') ? `https:${img}` : img, page.url);
      const got = await safeGet(iu.toString(), IMAGE_HOSTS, f, 'image/webp,image/jpeg,image/png,*/*;q=0.5', 700_000, log);
      if (got && /^image\/(jpeg|png|webp|gif)/i.test(got.type) && got.data.length > 500) image = { type: got.type.split(';')[0]!.trim(), data: got.data };
      else if (got) log.push(`picture not usable (${got.type})`);
    }
    title = title || fromLink;
    return { title, english: title ? await englishName(title, f) : null, priceTry: priceTry ? Math.round(priceTry * 100) / 100 : null, image, log };
  } catch (e) { log.push(`error: ${(e as Error).message}`); return EMPTY(log); }
}

/** Same answer for the same link for an hour: the drawer, the save and the list all reuse it. */
const cache = new Map<string, { at: number; pv: Promise<Preview> }>();
export function cachedPreview(url: string, f: typeof fetch = fetch): Promise<Preview> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.pv;
  const pv = productPreview(url, f);
  cache.set(url, { at: Date.now(), pv });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  // A failed read is not kept long, so a retry later can work.
  pv.then((r) => { if (!r.title && !r.image) setTimeout(() => cache.delete(url), 60_000); }).catch(() => cache.delete(url));
  return pv;
}
