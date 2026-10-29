import type { FreightQuery, FreightRate } from './rates.ts';

/**
 * Live prices from Eurosender (integrators.eurosender.com), one API for parcels, pallets, vans
 * and FTL/LTL across Europe.
 *   POST {base}/v1/quotes   header x-api-key
 * Sandbox https://sandbox-api.eurosender.com, production https://api.eurosender.com.
 * Set EUROSENDER_API_KEY and EUROSENDER_ENV=sandbox while testing. Prices are final door to door.
 *
 * Customer privacy: quotes send only postcodes, towns and sizes. Orders (later) carry Kargom's own
 * contact email, never the customer's, so Eurosender cannot market to our customers.
 */

const EUROPE = new Set(['GB', 'IE', 'FR', 'DE', 'NL', 'BE', 'LU', 'ES', 'PT', 'IT', 'AT', 'CH', 'DK', 'SE', 'NO', 'FI', 'PL', 'CZ', 'SK', 'HU', 'SI', 'HR', 'RO', 'BG', 'GR', 'EE', 'LV', 'LT', 'TR']);
const NAMES: Record<string, string> = {
  selection: 'Standard', flexi: 'Standard · Flexi', regular_plus: 'Priority', express: 'Priority Express',
  freight: 'Pallet · Standard', freight_priority: 'Pallet · Priority', freight_priority_express: 'Pallet · Priority Express', van: 'Dedicated van', ftl: 'Full / part truck',
};
const cache = new Map<string, { at: number; v: FreightRate[] }>();
const TTL = 3600_000;

export const eurosenderEnabled = () => Boolean(process.env.EUROSENDER_API_KEY);
export const eurosenderBase = () => (process.env.EUROSENDER_ENV === 'sandbox' ? 'https://sandbox-api.eurosender.com' : 'https://api.eurosender.com');
const eurToGbp = () => Number(process.env.EUR_GBP) || 0.85;

export function eurosenderCovers(q: FreightQuery) {
  if (!EUROPE.has(q.fromCountry) || !EUROPE.has(q.toCountry)) return false;
  if (q.load.startsWith('container')) return false;
  if (q.load === 'boxes' && q.weightKg > 70) return false;
  return true;
}

const address = (country: string, zip: string, city: string) => ({ country, zip: zip || '', city: city || '', street: 'Main Street 1' });

/** The request body for a quote, shared with the admin test order. */
export function quoteBody(q: FreightQuery) {
  const pallets = q.load === 'pallets';
  const unit = { quantity: q.quantity, width: Math.ceil(q.widthCm), height: Math.ceil(q.heightCm), length: Math.ceil(q.lengthCm), weight: Math.ceil(q.weightKg), value: 100 };
  return {
    shipment: { pickupAddress: address(q.fromCountry, q.fromPostcode ?? '', q.fromTown ?? ''), deliveryAddress: address(q.toCountry, q.toPostcode ?? '', q.toTown ?? '') },
    parcels: pallets ? { pallets: [{ parcelId: 'P1', ...unit }] } : { packages: [{ parcelId: 'A1', ...unit }] },
    paymentMethod: 'credit', currencyCode: 'EUR', serviceType: pallets ? 'freight' : 'selection',
  };
}

function days(edt: unknown): [number | null, number | null] {
  const m = /(\d+)\s*(?:-\s*(\d+))?/.exec(String(edt ?? ''));
  return m ? [Number(m[1]), Number(m[2] ?? m[1])] : [null, null];
}

export function parseQuote(j: any, pallets: boolean): FreightRate[] {
  const list = Array.isArray(j?.options?.serviceTypes) ? j.options.serviceTypes : [];
  const out: FreightRate[] = [];
  for (const s of list) {
    const p = s?.price?.converted ?? s?.price?.original;
    const gross = Number(p?.gross);
    if (!s?.name || !Number.isFinite(gross) || gross <= 0) continue;
    const cur = String(p?.currencyCode ?? 'EUR').toUpperCase();
    const pence = Math.round((cur === 'GBP' ? gross : gross * eurToGbp()) * 100);
    const [a, b] = days(s.edt);
    out.push({
      mode: pallets || /freight|van|ftl/.test(s.name) ? (s.name === 'ftl' ? 'FTL' : 'LTL') : 'express',
      label: NAMES[s.name] ?? String(s.name), minPence: pence, maxPence: pence, currency: 'GBP', daysMin: a, daysMax: b,
      source: 'eurosender', carrier: 'Eurosender', live: true,
    });
  }
  return out;
}

export async function eurosenderRates(q: FreightQuery, f: typeof fetch = fetch): Promise<FreightRate[]> {
  const key = process.env.EUROSENDER_API_KEY;
  if (!key || !eurosenderCovers(q)) return [];
  const body = quoteBody(q);
  const ck = JSON.stringify(body);
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  try {
    const r = await f(`${eurosenderBase()}/v1/quotes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-api-key': key }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) { console.warn(`[eurosender] quote ${r.status} ${JSON.stringify(j).slice(0, 400)}`); return []; }
    const v = parseQuote(j, q.load === 'pallets');
    if (v.length) { cache.set(ck, { at: Date.now(), v }); if (cache.size > 2000) cache.delete(cache.keys().next().value!); }
    return v;
  } catch (e) { console.warn(`[eurosender] ${(e as Error).message}`); return []; }
}

/**
 * Sandbox only: a quote and a test order, so Eurosender can review our integration and switch on
 * production. Uses Kargom's own contact details.
 */
export async function eurosenderTestOrder(kind: 'package' | 'pallet', contact: { name: string; email: string; phone: string }, f: typeof fetch = fetch) {
  const key = process.env.EUROSENDER_API_KEY;
  if (!key) return { ok: false, error: 'EUROSENDER_API_KEY is not set in Render' };
  if (process.env.EUROSENDER_ENV !== 'sandbox') return { ok: false, error: 'Test orders only run with EUROSENDER_ENV=sandbox' };
  const pallets = kind === 'pallet';
  const q: FreightQuery = pallets
    ? { origin: '', destination: '', fromCountry: 'GB', toCountry: 'FR', fromPostcode: 'M1 1AE', toPostcode: '75001', fromTown: 'Manchester', toTown: 'Paris', load: 'pallets', quantity: 1, weightKg: 250, lengthCm: 120, widthCm: 100, heightCm: 120 }
    : { origin: '', destination: '', fromCountry: 'FR', toCountry: 'DE', fromPostcode: '75001', toPostcode: '10115', fromTown: 'Paris', toTown: 'Berlin', load: 'boxes', quantity: 1, weightKg: 2, lengthCm: 30, widthCm: 20, heightCm: 15 };
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', 'x-api-key': key };
  const body: any = quoteBody(q);
  body.shipment.pickupAddress.street = pallets ? '1 Piccadilly' : '10 Rue de Rivoli';
  body.shipment.deliveryAddress.street = pallets ? '1 Rue de Rivoli' : 'Invalidenstrasse 1';
  const qr = await f(`${eurosenderBase()}/v1/quotes`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const quote = await qr.json().catch(() => null) as any;
  if (!qr.ok) return { ok: false, step: 'quote', status: qr.status, response: quote };
  const order = {
    ...body,
    shipment: { ...body.shipment, pickupDate: quote?.order?.minPickupDate ?? new Date(Date.now() + 2 * 864e5).toISOString(), pickupContact: contact, deliveryContact: contact, addOns: [] },
    parcels: pallets ? { pallets: body.parcels.pallets.map((p: any) => ({ ...p, content: 'Books' })) } : { packages: body.parcels.packages.map((p: any) => ({ ...p, content: 'Books' })) },
    serviceType: quote?.order?.serviceType ?? body.serviceType, courierId: quote?.order?.courierId ?? null,
    orderContact: { email: contact.email, name: contact.name, phone: contact.phone }, comment: 'Kargom integration test', labelFormat: 'pdf',
  };
  const or = await f(`${eurosenderBase()}/v1/orders`, { method: 'POST', headers, body: JSON.stringify(order), signal: AbortSignal.timeout(20_000) });
  const res = await or.json().catch(() => null) as any;
  if (!or.ok) return { ok: false, step: 'order', status: or.status, response: res };
  return { ok: true, kind, orderCode: res?.orderCode, status: res?.status, price: res?.price, prices: parseQuote(quote, pallets).map((x) => `${x.label}: £${(x.minPence / 100).toFixed(2)}`) };
}
