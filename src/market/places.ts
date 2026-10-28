import { AppError } from '../core/errors.ts';
import { haversineMiles } from './route.ts';

/**
 * Companies listed on Google near a place (Places API "New", Text Search).
 * Shown under our own partners as "Other companies near you", with Google's attribution.
 * We ask only for the fields we show, and keep results in memory for an hour so one
 * customer opening a page twice does not cost two searches. Nothing is written to the DB.
 */
export type GooglePlace = { placeId: string; name: string; address: string; phone: string | null; intlPhone: string | null; rating: number | null; reviews: number; website: string | null; mapsUrl: string | null; milesAway: number | null; hasLogo: boolean };

const FIELDS = ['places.id', 'places.displayName', 'places.formattedAddress', 'places.rating', 'places.userRatingCount', 'places.websiteUri', 'places.nationalPhoneNumber', 'places.internationalPhoneNumber', 'places.googleMapsUri', 'places.location', 'places.businessStatus', 'places.photos'].join(',');
const QUERY: Record<string, string> = { removals: 'removal company', freight: 'haulage company road freight' };
/** What we need to fetch a company's picture later: its website (for its own icon) and first Google photo. */
const meta = new Map<string, { website: string | null; photo: string | null; by: string | null }>();
const cache = new Map<string, { at: number; v: GooglePlace[] }>();
const TTL = 3600_000;

export const placesEnabled = () => Boolean(process.env.GOOGLE_PLACES_API_KEY);

export async function nearbyOnGoogle(kind: string, near: { label: string; lat: number; lng: number } | { label: string; lat?: undefined; lng?: undefined }, f: typeof fetch = fetch): Promise<GooglePlace[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return [];
  const ck = `${kind}|${near.label}`.toUpperCase();
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const body: Record<string, unknown> = { textQuery: `${QUERY[kind] ?? QUERY.removals} near ${near.label}, UK`, regionCode: 'GB', languageCode: 'en-GB', pageSize: 10 };
  if (near.lat !== undefined) body.locationBias = { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 30000 } };
  const r = await f('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
  });
  const j = (await r.json().catch(() => ({}))) as { places?: Array<Record<string, any>>; error?: { message?: string } };
  if (!r.ok) throw new AppError('provider_failed', `Google Places: ${j.error?.message ?? r.status}`);
  const v = (j.places ?? []).filter((p) => p.businessStatus !== 'CLOSED_PERMANENTLY').map((p) => ({
    placeId: String(p.id), name: String(p.displayName?.text ?? ''), address: String(p.formattedAddress ?? '').replace(/, UK$|, United Kingdom$/, ''),
    phone: p.nationalPhoneNumber ?? null, intlPhone: p.internationalPhoneNumber ?? null, rating: typeof p.rating === 'number' ? p.rating : null, reviews: Number(p.userRatingCount ?? 0), website: p.websiteUri ?? null, mapsUrl: p.googleMapsUri ?? null,
    milesAway: near.lat !== undefined && p.location ? Math.round(haversineMiles({ lat: near.lat, lng: near.lng! }, { lat: p.location.latitude, lng: p.location.longitude })) : null,
    hasLogo: Boolean(p.websiteUri || p.photos?.length),
  })).filter((p) => p.name);
  for (const p of j.places ?? []) {
    meta.set(String(p.id), { website: p.websiteUri ?? null, photo: p.photos?.[0]?.name ?? null, by: p.photos?.[0]?.authorAttributions?.[0]?.displayName ?? null });
    if (meta.size > 5000) meta.delete(meta.keys().next().value!);
  }
  cache.set(ck, { at: Date.now(), v });
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  return v;
}

/**
 * A small picture for a company we found on Google. First the company's own website icon
 * (through Google's favicon service, only if it is a proper large icon), otherwise its first
 * photo on Google Maps. Cached in memory; browsers cache it for a week too.
 * Only for places we listed ourselves, so this cannot be used to fetch arbitrary URLs.
 */
const logos = new Map<string, { type: string; data: Buffer } | null>();
function pngWidth(b: Buffer) { return b.length > 24 && b.readUInt32BE(0) === 0x89504e47 ? b.readUInt32BE(16) : null; }

export async function placeLogo(placeId: string, f: typeof fetch = fetch): Promise<{ type: string; data: Buffer } | null> {
  if (logos.has(placeId)) return logos.get(placeId)!;
  const m = meta.get(placeId);
  if (!m) return null;
  let out: { type: string; data: Buffer } | null = null;
  if (m.website) {
    try {
      const host = new URL(m.website).hostname;
      const r = await f(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`, { signal: AbortSignal.timeout(5000) });
      const data = Buffer.from(await r.arrayBuffer());
      const w = pngWidth(data);
      const type = r.headers.get('content-type') ?? 'image/png';
      // a missing icon comes back as 404 with Google's grey globe; tiny 16px icons look blurry
      if (r.ok && type.startsWith('image/') && data.length > 400 && (w === null || w >= 48)) out = { type, data };
    } catch { /* try the photo */ }
  }
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!out && m.photo && key) {
    try {
      const r = await f(`https://places.googleapis.com/v1/${m.photo}/media?maxWidthPx=160&maxHeightPx=160&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(8000) });
      const type = r.headers.get('content-type') ?? '';
      if (r.ok && type.startsWith('image/')) out = { type, data: Buffer.from(await r.arrayBuffer()) };
    } catch { /* initials instead */ }
  }
  logos.set(placeId, out);
  if (logos.size > 3000) logos.delete(logos.keys().next().value!);
  return out;
}
