import { AppError } from '../core/errors.ts';
import { forwardersOnGoogle, placesEnabled, rankPlaces } from '../market/places.ts';

/**
 * Freight forwarders on Google in the sending and the receiving place, listed under the freight
 * estimates so customers have more companies to ask. Visitors see phone numbers with the last
 * four digits hidden; signed-in customers get the full number, WhatsApp, website and map links.
 */
const mask = (ph: string | null) => {
  if (!ph) return null;
  let seen = 0;
  return ph.split('').reverse().map((ch) => (/\d/.test(ch) && seen < 4 ? (seen++, '*') : ch)).reverse().join('');
};

type Found = Awaited<ReturnType<typeof forwardersOnGoogle>>[number];
const shape = (p: Found, member: boolean, city?: string) => ({
  placeId: p.placeId, company: p.name, rating: p.rating, reviewCount: p.reviews,
  area: p.address.split(',').slice(-2).join(',').trim(), ...(city ? { city } : {}),
  logoUrl: p.hasLogo ? `/api/gplace/${encodeURIComponent(p.placeId)}/logo` : null,
  whatsapp: Boolean(p.intlPhone),
  ...(member
    ? { phone: p.phone ?? p.intlPhone, intlPhone: p.intlPhone, website: p.website, mapsUrl: p.mapsUrl }
    : { phone: mask(p.phone ?? p.intlPhone) }),
});

/**
 * The best freight forwarders in a country for the "Forwarders" list: searched in up to 3 cities
 * (for sea freight the main container ports, where the strongest forwarders are), merged, and ranked
 * by rating backed by review count. Each search is cached for an hour.
 */
export async function topForwarders(citiesIn: unknown, countryIn: unknown, member: boolean, f?: typeof fetch) {
  const country = typeof countryIn === 'string' ? countryIn.trim().toUpperCase() : '';
  const cities = (typeof citiesIn === 'string' ? citiesIn.split('|') : []).map((c) => c.trim().replace(/\s+/g, ' ').slice(0, 80)).filter((c) => c.length >= 2).slice(0, 3);
  if (!cities.length || !/^[A-Z]{2}$/.test(country)) throw new AppError('bad_request', 'Choose a place');
  if (!placesEnabled()) return { enabled: false, places: [] };
  const seen = new Map<string, { p: Found; city: string }>();
  let error: string | null = null;
  await Promise.all(cities.map(async (city) => {
    try {
      for (const p of await forwardersOnGoogle(city, country, f)) if (!seen.has(p.placeId)) seen.set(p.placeId, { p, city: city.split(',')[0]! });
    } catch (e) { error = (e as Error).message; console.warn(`[places] ${error}`); }
  }));
  const ranked = rankPlaces([...seen.values()].map((x) => ({ ...x, rating: x.p.rating, reviews: x.p.reviews })));
  return { enabled: true, error: member ? error : null, places: ranked.slice(0, 10).map((x) => shape(x.p, member, x.city)) };
}

export async function freightForwarders(placeIn: unknown, countryIn: unknown, member: boolean, f?: typeof fetch) {
  const place = typeof placeIn === 'string' ? placeIn.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
  const country = typeof countryIn === 'string' ? countryIn.trim().toUpperCase() : '';
  if (place.length < 2 || !/^[A-Z]{2}$/.test(country)) throw new AppError('bad_request', 'Choose a place');
  if (!placesEnabled()) return { enabled: false, searched: place, places: [] };
  let list: Awaited<ReturnType<typeof forwardersOnGoogle>> = [];
  let error: string | null = null;
  try { list = await forwardersOnGoogle(place, country, f); } catch (e) { error = (e as Error).message; console.warn(`[places] ${error}`); }
  return {
    enabled: true, searched: place, error: member ? error : null,
    places: list.slice(0, 8).map((p) => ({
      placeId: p.placeId, company: p.name, rating: p.rating, reviewCount: p.reviews,
      area: p.address.split(',').slice(-2).join(',').trim(),
      logoUrl: p.hasLogo ? `/api/gplace/${encodeURIComponent(p.placeId)}/logo` : null,
      whatsapp: Boolean(p.intlPhone),
      ...(member
        ? { phone: p.phone ?? p.intlPhone, intlPhone: p.intlPhone, website: p.website, mapsUrl: p.mapsUrl }
        : { phone: mask(p.phone ?? p.intlPhone) }),
    })),
  };
}
