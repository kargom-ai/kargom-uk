/**
 * Product link preview, like a chat app shows: the product's name and main picture, read from the
 * page's Open Graph tags (og:title, og:image). Only for the Turkish shops we know, over https,
 * with every redirect checked, so a customer's link can never make our server call anything else.
 */

/** Shops whose product pages we read (and their short-link domains). */
const PAGE_HOSTS = ['trendyol.com', 'ty.gl', 'hepsiburada.com', 'hb.gl', 'amazon.com.tr', 'amzn.eu', 'amzn.to', 'n11.com', 'ciceksepeti.com', 'koton.com', 'lcw.com',
  'defacto.com.tr', 'boyner.com.tr', 'mavi.com', 'pazarama.com', 'morhipo.com'];
/** Where those shops keep their product pictures. */
const IMAGE_HOSTS = ['dsmcdn.com', 'trendyol.com', 'hepsiburada.net', 'hepsiburada.com', 'media-amazon.com', 'ssl-images-amazon.com', 'amazon.com.tr', 'n11scdn.com', 'n11.com',
  'ciceksepeti.com', 'cdn03.ciceksepeti.com', 'koton.com', 'ktncdn.com', 'lcw.com', 'lcwaikiki.com', 'defacto.com.tr', 'dfcdn.defacto.com.tr', 'boyner.com.tr', 'mavi.com', 'pazarama.com', 'morhipo.com'];

const hostOk = (u: URL, list: string[]) => u.protocol === 'https:' && !u.port && list.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
export const isShopLink = (url: string) => { try { return hostOk(new URL(url), PAGE_HOSTS); } catch { return false; } };

const UA = 'Mozilla/5.0 (compatible; KargomLinkPreview/1.0; +https://kargom.co.uk/about)';

/** GET with redirects followed by hand, each hop checked against the allow-list. */
async function safeGet(url: string, allow: string[], f: typeof fetch, accept: string, maxBytes: number) {
  let u = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    if (!hostOk(u, allow)) return null;
    const r = await f(u.toString(), { redirect: 'manual', headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8' }, signal: AbortSignal.timeout(7000) });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc) return null;
      u = new URL(loc, u);
      continue;
    }
    if (!r.ok || !r.body) return null;
    const len = Number(r.headers.get('content-length') ?? 0);
    if (len > maxBytes) return null;
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
  return null;
}

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
function meta(html: string, keys: string[]): string | null {
  for (const k of keys) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*>`, 'i');
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    if (content?.trim()) return decode(content.trim());
  }
  return null;
}

export type Preview = { title: string | null; image: { type: string; data: Buffer } | null };

/** Read a product page's name and picture. Never throws: returns nulls when the shop blocks us. */
export async function productPreview(url: string, f: typeof fetch = fetch): Promise<Preview> {
  try {
    if (!isShopLink(url)) return { title: null, image: null };
    const page = await safeGet(url, PAGE_HOSTS, f, 'text/html,application/xhtml+xml', 1_500_000);
    if (!page || !/html/i.test(page.type)) return { title: null, image: null };
    const html = page.data.toString('utf8');
    let title: string | null = meta(html, ['og:title', 'twitter:title']) ?? decode(html.match(/<title[^>]*>([^<]{3,300})<\/title>/i)?.[1]?.trim() ?? '');
    title = title ? title.replace(/\s*[-|–]\s*(Trendyol|Hepsiburada|Amazon\.com\.tr|n11|Çiçeksepeti|Koton|LC Waikiki|DeFacto|Boyner).*$/i, '').slice(0, 200) : null;
    const img = meta(html, ['og:image:secure_url', 'og:image', 'twitter:image']);
    let image: Preview['image'] = null;
    if (img) {
      const iu = new URL(img, page.url);
      const got = await safeGet(iu.toString(), IMAGE_HOSTS, f, 'image/avif,image/webp,image/jpeg,image/png,*/*;q=0.5', 900_000);
      if (got && /^image\/(jpeg|png|webp|avif|gif)/i.test(got.type) && got.data.length > 500) image = { type: got.type.split(';')[0]!.trim(), data: got.data };
    }
    return { title: title || null, image };
  } catch { return { title: null, image: null }; }
}
