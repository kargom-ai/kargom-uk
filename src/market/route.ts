import { AppError } from '../core/errors.ts';

/**
 * Distance between two places for the request map.
 *  - GOOGLE_MAPS_SERVER_KEY set: real road distance and driving time (Distance Matrix API).
 *  - Otherwise (UK postcodes only): straight-line distance from postcodes.io, times 1.2 for roads.
 * The map itself is drawn in the browser (Google Maps Embed if GOOGLE_MAPS_EMBED_KEY, else OpenStreetMap).
 */
export type RouteInfo = { miles: number; minutes: number | null; source: 'google' | 'estimate'; from: LatLng | null; to: LatLng | null };
type LatLng = { lat: number; lng: number };

const cache = new Map<string, { at: number; v: RouteInfo }>();
const TTL = 24 * 3600_000;

export async function coords(postcode: string, f: typeof fetch = fetch): Promise<LatLng | null> {
  const r = await f(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) return null;
  const j = (await r.json()) as { result?: { latitude?: number; longitude?: number } };
  return j.result?.latitude != null && j.result?.longitude != null ? { lat: j.result.latitude, lng: j.result.longitude } : null;
}

export function haversineMiles(a: LatLng, b: LatLng) {
  const R = 3958.8, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function routeInfo(from: { postcode: string; country: string }, to: { postcode: string; country: string }, f: typeof fetch = fetch): Promise<RouteInfo> {
  const key = `${from.postcode}|${from.country}|${to.postcode}|${to.country}`.toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  let v: RouteInfo | null = null;
  const server = process.env.GOOGLE_MAPS_SERVER_KEY;
  const ukBoth = from.country === 'GB' && to.country === 'GB';
  const [a, b] = ukBoth ? await Promise.all([coords(from.postcode, f).catch(() => null), coords(to.postcode, f).catch(() => null)]) : [null, null];
  if (server) {
    const q = new URLSearchParams({ origins: `${from.postcode}, ${from.country}`, destinations: `${to.postcode}, ${to.country}`, units: 'imperial', key: server });
    try {
      const r = await f(`https://maps.googleapis.com/maps/api/distancematrix/json?${q}`, { signal: AbortSignal.timeout(8000) });
      const j = (await r.json()) as { rows?: Array<{ elements?: Array<{ status: string; distance?: { value: number }; duration?: { value: number } }> }> };
      const el = j.rows?.[0]?.elements?.[0];
      if (el?.status === 'OK' && el.distance) v = { miles: Math.round(el.distance.value / 1609.344), minutes: el.duration ? Math.round(el.duration.value / 60) : null, source: 'google', from: a, to: b };
    } catch { /* fall back */ }
  }
  if (!v && a && b) {
    const miles = Math.max(1, Math.round(haversineMiles(a, b) * 1.2));
    v = { miles, minutes: Math.round((miles / 40) * 60), source: 'estimate', from: a, to: b };
  }
  if (!v) throw new AppError('not_found', 'We could not work out the distance for those postcodes');
  cache.set(key, { at: Date.now(), v });
  if (cache.size > 5000) cache.delete(cache.keys().next().value!);
  return v;
}

const outs = new Map<string, Promise<LatLng | null>>();
/** Centre of a UK outward code ("M1", "SW1A"), cached. */
export function outcodeCoords(outcode: string, f: typeof fetch = fetch): Promise<LatLng | null> {
  const k = outcode.toUpperCase().trim();
  if (!/^[A-Z]{1,2}\d[A-Z\d]?$/.test(k)) return Promise.resolve(null);
  if (!outs.has(k)) {
    outs.set(k, f(`https://api.postcodes.io/outcodes/${encodeURIComponent(k)}`, { signal: AbortSignal.timeout(5000) })
      .then(async (r) => { if (!r.ok) return null; const j = (await r.json()) as { result?: { latitude?: number; longitude?: number } }; return j.result?.latitude != null ? { lat: j.result.latitude, lng: j.result.longitude! } : null; })
      .catch(() => { outs.delete(k); return null; }));
  }
  return outs.get(k)!;
}
