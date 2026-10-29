import { AppError } from '../core/errors.ts';
import { haversineMiles } from './route.ts';

/**
 * Companies listed on Google near a place (Places API "New", Text Search).
 * Shown under our own partners as "Other companies near you", with Google's attribution.
 * We ask only for the fields we show, and keep results in memory for an hour so one
 * customer opening a page twice does not cost two searches. Nothing is written to the DB.
 */
export type GooglePlace = { placeId: string; name: string; address: string; phone: string | null; intlPhone: string | null; rating: number | null; reviews: number; website: string | null; mapsUrl: string | null; milesAway: number | null; hasLogo: boolean };

const FIELDS = ['places.id', 'places.displayName', 'places.formattedAddress', 'places.rating', 'places.userRatingCount', 'places.websiteUri', 'places.nationalPhoneNumber', 'places.internationalPhoneNumber', 'places.googleMapsUri', 'places.location', 'places.businessStatus', 'places.photos', 'places.types', 'places.primaryType'].join(',');
const QUERY: Record<string, string> = { removals: 'removal company', freight: 'haulage company road freight' };
/** Google place type that must match, so a "removals" search lists only moving companies. */
const TYPE: Record<string, string> = { removals: 'moving_company' };
/** Names that are clearly removal firms, and names that are clearly something else (van hire, storage only, skips). */
const MOVING_NAME = /remov|moving|movers|man (?:and|&|with) (?:a )?van|relocat|house ?move|home ?move|office ?move/i;
const NOT_MOVING = /self[- ]?storage|storage (?:centre|center|units?)|van (?:hire|rental)|car (?:hire|rental)|u-?haul|enterprise|hertz|europcar|skip hire|waste|clearance only|parcel|post office|estate agent/i;
const FREIGHT_NAME = /haul|freight|logistic|transport|lorr|truck|carrier|forward|shipping|cargo|distribution|courier|express/i;

/**
 * Best first: a high rating backed by many reviews. A Bayesian average pulls a 5.0 from
 * 2 reviews below a 4.8 from 300, then the review count breaks ties. No reviews go last.
 */
export function rankPlaces<T extends { rating: number | null; reviews: number }>(list: T[]): T[] {
  const PRIOR = 4.2, WEIGHT = 15;
  const score = (p: T) => (p.rating === null || !p.reviews ? -1 : (p.rating * p.reviews + PRIOR * WEIGHT) / (p.reviews + WEIGHT));
  return [...list].sort((a, b) => score(b) - score(a) || b.reviews - a.reviews);
}

/** Keep only companies that do the job asked for. */
export function relevant(kind: string, p: { name: string; types?: string[] }) {
  const types = p.types ?? [];
  if (kind === 'removals') {
    if (NOT_MOVING.test(p.name) && !MOVING_NAME.test(p.name)) return false;
    return types.includes('moving_company') || MOVING_NAME.test(p.name);
  }
  if (kind === 'freight' || kind === 'forwarder') return FREIGHT_NAME.test(p.name) || types.includes('moving_company') || types.includes('storage');
  return true;
}
/** What we need to fetch a company's picture later: its website (for its own icon) and first Google photo. */
const meta = new Map<string, { website: string | null; photo: string | null; by: string | null }>();
const cache = new Map<string, { at: number; v: GooglePlace[] }>();
const TTL = 3600_000;

export const placesEnabled = () => Boolean(process.env.GOOGLE_PLACES_API_KEY);

export async function nearbyOnGoogle(kind: string, near: { label: string; lat: number; lng: number } | { label: string; lat?: undefined; lng?: undefined }, f: typeof fetch = fetch,
  opts: { query?: string; region?: string } = {}): Promise<GooglePlace[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return [];
  const ck = `v2|${kind}|${near.label}|${opts.query ?? ''}|${opts.region ?? ''}`.toUpperCase();
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const body: Record<string, unknown> = opts.query
    ? { textQuery: opts.query, ...(opts.region ? { regionCode: opts.region } : {}), languageCode: 'en', pageSize: 20 }
    : { textQuery: `${QUERY[kind] ?? QUERY.removals} near ${near.label}, UK`, regionCode: 'GB', languageCode: 'en-GB', pageSize: 20,
      ...(TYPE[kind] ? { includedType: TYPE[kind], strictTypeFiltering: true } : {}) };
  if (near.lat !== undefined) body.locationBias = { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 30000 } };
  const r = await f('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
  });
  const j = (await r.json().catch(() => ({}))) as { places?: Array<Record<string, any>>; error?: { message?: string } };
  if (!r.ok) throw new AppError('provider_failed', `Google Places: ${j.error?.message ?? r.status}`);
  const found = (j.places ?? []).filter((p) => p.businessStatus !== 'CLOSED_PERMANENTLY').map((p) => ({
    placeId: String(p.id), name: String(p.displayName?.text ?? ''), address: String(p.formattedAddress ?? '').replace(/, UK$|, United Kingdom$/, ''),
    phone: p.nationalPhoneNumber ?? null, intlPhone: p.internationalPhoneNumber ?? null, rating: typeof p.rating === 'number' ? p.rating : null, reviews: Number(p.userRatingCount ?? 0), website: p.websiteUri ?? null, mapsUrl: p.googleMapsUri ?? null,
    milesAway: near.lat !== undefined && p.location ? Math.round(haversineMiles({ lat: near.lat, lng: near.lng! }, { lat: p.location.latitude, lng: p.location.longitude })) : null,
    hasLogo: Boolean(p.websiteUri || p.photos?.length),
    types: Array.isArray(p.types) ? p.types.map(String) : [],
  })).filter((p) => p.name && relevant(kind, p))
    // removal firms must be local: drop anything far from the customer
    .filter((p) => kind !== 'removals' || p.milesAway === null || p.milesAway <= 40);
  const v = rankPlaces(found).slice(0, 12).map(({ types: _t, ...p }) => p);
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

/** Freight forwarders in a city or country anywhere (e.g. "Shenzhen, China"), for the freight page. */
export function forwardersOnGoogle(place: string, country: string, f: typeof fetch = fetch) {
  return nearbyOnGoogle('forwarder', { label: place }, f, { query: `freight forwarder in ${place}`, region: country.toLowerCase() === 'je' ? 'gb' : country.toLowerCase() });
}
