/**
 * Ocean carriers that sail each trade lane, shown as small icons on the sea-freight cards
 * ("carriers on this route"). The icon is the carrier's own website icon, fetched once through
 * Google's favicon service and kept in memory. Only the carriers listed here can be fetched.
 */
export const CARRIERS: Record<string, { name: string; domain: string }> = {
  maersk: { name: 'Maersk', domain: 'maersk.com' },
  msc: { name: 'MSC', domain: 'msc.com' },
  cma: { name: 'CMA CGM', domain: 'cma-cgm.com' },
  hapag: { name: 'Hapag-Lloyd', domain: 'hapag-lloyd.com' },
  cosco: { name: 'COSCO', domain: 'lines.coscoshipping.com' },
  one: { name: 'ONE', domain: 'one-line.com' },
  evergreen: { name: 'Evergreen', domain: 'evergreen-line.com' },
  hmm: { name: 'HMM', domain: 'hmm21.com' },
  yangming: { name: 'Yang Ming', domain: 'yangming.com' },
  zim: { name: 'ZIM', domain: 'zim.com' },
};

/** Who runs services on the main lanes (the big alliances plus the independents). */
const LANE: Record<string, string[]> = {
  'asia>uk': ['maersk', 'msc', 'cma', 'hapag', 'cosco', 'one', 'evergreen', 'hmm'],
  'asia>eu': ['maersk', 'msc', 'cma', 'hapag', 'cosco', 'one', 'evergreen', 'hmm'],
  'asia>na': ['maersk', 'msc', 'cma', 'cosco', 'one', 'evergreen', 'hapag', 'yangming', 'zim'],
  'uk>na': ['maersk', 'msc', 'hapag', 'cma', 'one'], 'eu>na': ['maersk', 'msc', 'hapag', 'cma', 'one'],
  'na>uk': ['maersk', 'msc', 'hapag', 'cma', 'one'], 'na>eu': ['maersk', 'msc', 'hapag', 'cma', 'one'],
  'uk>asia': ['maersk', 'msc', 'cma', 'hapag', 'cosco', 'one'], 'eu>asia': ['maersk', 'msc', 'cma', 'hapag', 'cosco', 'one'],
};
export const carriersFor = (lane: string) => (LANE[lane] ?? ['maersk', 'msc', 'cma', 'hapag', 'cosco']).map((id) => ({ id, name: CARRIERS[id]!.name }));

const icons = new Map<string, { type: string; data: Buffer }>();
/** A 1×1 transparent PNG, so a missing icon never shows as a broken image. */
const BLANK = { type: 'image/png', data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') };

export async function carrierIcon(id: string, f: typeof fetch = fetch) {
  const c = CARRIERS[id];
  if (!c) return BLANK;
  const hit = icons.get(id);
  if (hit) return hit;
  try {
    const r = await f(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(c.domain)}&sz=64`, { signal: AbortSignal.timeout(5000) });
    const type = r.headers.get('content-type') ?? 'image/png';
    const data = Buffer.from(await r.arrayBuffer());
    if (r.ok && type.startsWith('image/') && data.length > 200) { const v = { type, data }; icons.set(id, v); return v; }
  } catch { /* fall through */ }
  return BLANK;
}
