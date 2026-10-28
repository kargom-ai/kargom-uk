import { AppError } from '../core/errors.ts';
import { haversineMiles } from './route.ts';

/**
 * Companies listed on Google near a place (Places API "New", Text Search).
 * Shown under our own partners as "Other companies near you", with Google's attribution.
 * We ask only for the fields we show, and keep results in memory for an hour so one
 * customer opening a page twice does not cost two searches. Nothing is written to the DB.
 */
export type GooglePlace = { placeId: string; name: string; address: string; phone: string | null; intlPhone: string | null; rating: number | null; reviews: number; website: string | null; mapsUrl: string | null; milesAway: number | null };

const FIELDS = ['places.id', 'places.displayName', 'places.formattedAddress', 'places.rating', 'places.userRatingCount', 'places.websiteUri', 'places.nationalPhoneNumber', 'places.internationalPhoneNumber', 'places.googleMapsUri', 'places.location', 'places.businessStatus'].join(',');
const QUERY: Record<string, string> = { removals: 'removal company', freight: 'haulage company road freight' };
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
  })).filter((p) => p.name);
  cache.set(ck, { at: Date.now(), v });
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  return v;
}
