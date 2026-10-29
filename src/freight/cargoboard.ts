import type { FreightQuery, FreightRate } from './rates.ts';

/**
 * Live pallet and parcel-freight prices from Cargoboard (docs.cargoboard.com).
 *   POST {base}/v1/quotations   with X-API-KEY
 * Sandbox: https://api-sandbox.cargoboard.com, production: https://api.cargoboard.com.
 * Coverage: most of the EU; Great Britain, Ireland, Switzerland, Norway and Liechtenstein for
 * groupage only (up to 6 pallets / 3,000 kg), and never within the UK. No Turkey.
 * Set CARGOBOARD_API_KEY, and CARGOBOARD_ENV=sandbox while testing.
 */

const FULL = ['AT', 'BE', 'BG', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IT', 'LT', 'LU', 'LV', 'NL', 'PL', 'PT', 'RO', 'SI', 'SK', 'SE'];
const GROUPAGE_ONLY = ['GB', 'IE', 'CH', 'NO', 'LI'];
const covered = (c: string) => FULL.includes(c) || GROUPAGE_ONLY.includes(c);
const cache = new Map<string, { at: number; v: FreightRate[] }>();
const TTL = 3600_000;

export const cargoboardEnabled = () => Boolean(process.env.CARGOBOARD_API_KEY);
const base = () => (process.env.CARGOBOARD_ENV === 'sandbox' ? 'https://api-sandbox.cargoboard.com' : 'https://api.cargoboard.com');
const eurToGbp = () => Number(process.env.EUR_GBP) || 0.85;

/** Next working day, as YYYY-MM-DD. */
function nextWorkingDay(now = new Date()) {
  const d = new Date(now.getTime() + 864e5);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setTime(d.getTime() + 864e5);
  return d.toISOString().slice(0, 10);
}

export function cargoboardCovers(q: FreightQuery) {
  if (!covered(q.fromCountry) || !covered(q.toCountry)) return false;
  if (q.fromCountry === 'GB' && q.toCountry === 'GB') return false;       // no UK domestic
  if (q.load.startsWith('container')) return false;
  const groupageOnly = GROUPAGE_ONLY.includes(q.fromCountry) || GROUPAGE_ONLY.includes(q.toCountry);
  const units = q.load === 'pallets' ? q.quantity : Math.ceil(q.quantity / 8);
  if (groupageOnly && (units > 6 || q.weightKg * q.quantity > 3000)) return false;
  return q.weightKg * q.quantity >= 30;                                     // below this a courier is cheaper
}

export async function cargoboardRates(q: FreightQuery, f: typeof fetch = fetch): Promise<FreightRate[]> {
  const key = process.env.CARGOBOARD_API_KEY;
  if (!key || !cargoboardCovers(q)) return [];
  const ck = JSON.stringify([q.fromCountry, q.fromPostcode, q.toCountry, q.toPostcode, q.load, q.quantity, q.weightKg, q.lengthCm, q.widthCm, q.heightCm]);
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const euro = q.load === 'pallets' && q.lengthCm === 120 && q.widthCm === 80;
  const line = {
    unitQuantity: q.quantity, unitPackageType: q.load === 'pallets' ? (euro ? 'FP' : 'EP') : 'KT', content: 'General goods',
    unitLength: Math.ceil(q.lengthCm), unitWidth: Math.ceil(q.widthCm), unitHeight: Math.ceil(q.heightCm), unitWeight: Math.ceil(q.weightKg), isStackable: false,
  };
  const ask = async (product: 'STANDARD' | 'EXPRESS'): Promise<FreightRate | null> => {
    const body = {
      product,
      shipper: { address: { postCode: q.fromPostcode || '', city: q.fromTown || '', countryCode: q.fromCountry }, pickupOn: nextWorkingDay() },
      consignee: { address: { postCode: q.toPostcode || '', city: q.toTown || '', countryCode: q.toCountry } },
      lines: [line],
    };
    try {
      const r = await f(`${base()}/v1/quotations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-KEY': key }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000),
      });
      const j = (await r.json().catch(() => null)) as { data?: Record<string, any>; message?: string; errors?: unknown } | null;
      if (!r.ok || !j?.data?.price) { console.warn(`[cargoboard] ${product} ${r.status} ${JSON.stringify(j?.errors ?? j?.message ?? '').slice(0, 300)}`); return null; }
      const p = j.data.price;
      const amount = Number(p.grossAmount ?? p.amount);
      if (!Number.isFinite(amount)) return null;
      const gbp = String(p.currency ?? 'EUR').toUpperCase() === 'GBP' ? amount : amount * eurToGbp();
      const pence = Math.round(gbp * 100);
      return {
        mode: 'LTL', label: product === 'EXPRESS' ? 'Pallet network · Express' : 'Pallet network · Standard', minPence: pence, maxPence: pence, currency: 'GBP',
        daysMin: j.data.runtime?.daysMin ?? null, daysMax: j.data.runtime?.daysMax ?? null, source: 'cargoboard', carrier: 'Cargoboard', live: true,
      };
    } catch (e) { console.warn(`[cargoboard] ${(e as Error).message}`); return null; }
  };
  const v = (await Promise.all([ask('STANDARD'), ask('EXPRESS')])).filter((x): x is FreightRate => Boolean(x));
  if (v.length) { cache.set(ck, { at: Date.now(), v }); if (cache.size > 2000) cache.delete(cache.keys().next().value!); }
  return v;
}
