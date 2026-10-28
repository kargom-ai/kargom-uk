import { AppError } from '../core/errors.ts';
import { forwardersOnGoogle, placesEnabled } from '../market/places.ts';

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
