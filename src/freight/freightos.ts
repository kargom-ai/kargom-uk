import { AppError } from '../core/errors.ts';
import { estimatePrice } from '../market/estimate.ts';
import { routeInfo } from '../market/route.ts';

/**
 * Air, sea and road freight price ranges from Freightos' public Shipping Calculator
 * (ship.freightos.com/api/shippingCalculator, estimate mode, no key needed).
 * Terms: show "Freightos" with a link to ship.freightos.com next to the prices.
 * Limit: 100 calls an hour per IP. All our visitors share the server's IP, so we cache
 * answers for 12 hours and stop calling for the rest of the hour once we near the limit.
 * For UK pallets / lorries we add our own road estimate.
 */

export type FreightLoad = 'boxes' | 'pallets' | 'container20' | 'container40' | 'container40HC';
export type FreightRate = { mode: string; label: string; minPence: number; maxPence: number; currency: string; daysMin: number | null; daysMax: number | null; source: 'freightos' | 'kargom' };
export type FreightQuery = {
  origin: string; destination: string; fromCountry: string; toCountry: string; fromPostcode?: string; toPostcode?: string;
  load: FreightLoad; quantity: number; weightKg: number; lengthCm: number; widthCm: number; heightCm: number;
};

const LOADS: FreightLoad[] = ['boxes', 'pallets', 'container20', 'container40', 'container40HC'];
const LABEL: Record<string, string> = {
  air: 'Air freight', express: 'Express courier', LCL: 'Sea freight · shared container (LCL)', FCL: 'Sea freight · full container (FCL)',
  LTL: 'Road · part load (LTL)', FTL: 'Road · full truck (FTL)',
};
const ORDER = ['express', 'air', 'LCL', 'FCL', 'LTL', 'FTL'];
const URL_BASE = 'https://ship.freightos.com/api/shippingCalculator';
const cache = new Map<string, { at: number; v: { rates: FreightRate[]; note: string | null } }>();
const TTL = 12 * 3600_000;
let hour = { start: 0, calls: 0 };
const HOURLY = 90;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const UKPC = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

export function parseFreightQuery(q: URLSearchParams): FreightQuery {
  const load = q.get('load') as FreightLoad;
  if (!LOADS.includes(load)) throw new AppError('bad_request', 'Choose boxes, pallets or a container');
  const origin = str(q.get('origin'), 120), destination = str(q.get('destination'), 120);
  if (origin.length < 2) throw new AppError('bad_request', 'Enter where the goods are now');
  if (destination.length < 2) throw new AppError('bad_request', 'Enter where the goods are going');
  const container = load.startsWith('container');
  const quantity = Math.round(num(q.get('qty')) || 1);
  if (!(quantity >= 1 && quantity <= (container ? 20 : 500))) throw new AppError('bad_request', 'Enter how many (1 to 500)');
  const weightKg = num(q.get('kg'));
  if (!container && !(weightKg > 0 && weightKg <= 30_000)) throw new AppError('bad_request', 'Enter the weight of one box or pallet in kg');
  let [l, w, h] = [num(q.get('l')), num(q.get('w')), num(q.get('h'))];
  if (load === 'pallets') { l ||= 120; w ||= 100; h ||= 150; }
  if (load === 'boxes' && !(l > 0 && w > 0 && h > 0)) throw new AppError('bad_request', 'Enter the size of one box in cm');
  if ([l, w, h].some((x) => x > 1400)) throw new AppError('bad_request', 'Sizes are in centimetres');
  return {
    origin, destination, load, quantity, weightKg, lengthCm: l, widthCm: w, heightCm: h,
    fromCountry: str(q.get('fromCountry'), 2).toUpperCase(), toCountry: str(q.get('toCountry'), 2).toUpperCase(),
    fromPostcode: str(q.get('fromPostcode'), 10).toUpperCase(), toPostcode: str(q.get('toPostcode'), 10).toUpperCase(),
  };
}

function money(x: any): { amount: number; currency: string } | null {
  const m = x?.moneyAmount ?? x;
  const amount = Number(m?.amount);
  return Number.isFinite(amount) ? { amount, currency: String(m?.currency ?? 'USD') } : null;
}

/** Turn Freightos' answer into rate rows. Accepts one mode or a list of modes. */
export function parseFreightos(j: any): { rates: FreightRate[]; error: string | null } {
  const r = j?.response ?? j;
  const raw = r?.estimatedFreightRates?.mode;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const rates: FreightRate[] = [];
  for (const m of list) {
    const lo = money(m?.price?.min), hi = money(m?.price?.max);
    if (!lo || !hi || !m?.mode) continue;
    const t = m.transitTimes ?? {};
    rates.push({
      mode: String(m.mode), label: LABEL[m.mode] ?? String(m.mode), minPence: Math.round(lo.amount * 100), maxPence: Math.round(hi.amount * 100), currency: lo.currency,
      daysMin: Number.isFinite(Number(t.min)) ? Number(t.min) : null, daysMax: Number.isFinite(Number(t.max)) ? Number(t.max) : null, source: 'freightos',
    });
  }
  const errs = r?.errors?.error ?? r?.errors;
  const first = Array.isArray(errs) ? errs[0] : errs;
  const error = rates.length ? null : (first?.message ?? first?.description ?? (typeof first === 'string' ? first : null));
  return { rates, error: error ? String(error) : null };
}

async function roadEstimate(q: FreightQuery, f: typeof fetch): Promise<FreightRate[]> {
  if (q.fromCountry !== 'GB' || q.toCountry !== 'GB' || !UKPC.test(q.fromPostcode ?? '') || !UKPC.test(q.toPostcode ?? '')) return [];
  if (q.load === 'boxes') return [];
  let miles: number;
  try { miles = (await routeInfo({ postcode: q.fromPostcode!, country: 'GB' }, { postcode: q.toPostcode!, country: 'GB' }, f)).miles; } catch { return []; }
  const days = (m: number) => (m > 250 ? [2, 3] : [1, 2]);
  const out: FreightRate[] = [];
  const row = (mode: string, d: Record<string, unknown>) => {
    const e = estimatePrice('freight', d, miles);
    if (e) out.push({ mode, label: LABEL[mode]!, minPence: e.lowPence, maxPence: e.highPence, currency: 'GBP', daysMin: days(miles)[0]!, daysMax: days(miles)[1]!, source: 'kargom' });
  };
  if (q.load === 'pallets' && q.quantity <= 26) row('LTL', { load: 'ltl', pallets: q.quantity, palletType: 'uk' });
  if (q.load !== 'pallets' || q.quantity >= 6) row('FTL', { load: 'ftl', vehicle: q.load === 'pallets' && q.quantity <= 14 ? '18t' : 'artic' });
  return out;
}

export async function freightRates(q: FreightQuery, f: typeof fetch = fetch): Promise<{ rates: FreightRate[]; note: string | null }> {
  const key = JSON.stringify(q).toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const road = await roadEstimate(q, f);
  let rates: FreightRate[] = [];
  let note: string | null = null;
  if (Date.now() - hour.start > 3600_000) hour = { start: Date.now(), calls: 0 };
  if (hour.calls >= HOURLY) note = 'Live air and sea estimates are busy right now. Try again in a little while, or ask forwarders for prices.';
  else {
    hour.calls++;
    const p = new URLSearchParams({ estimate: 'true', currency: 'GBP', format: 'json', loadtype: q.load, quantity: String(q.quantity), origin: q.origin, destination: q.destination });
    if (!q.load.startsWith('container')) {
      p.set('weight', String(q.weightKg));
      p.set('length', String(q.lengthCm)); p.set('width', String(q.widthCm)); p.set('height', String(q.heightCm));
    } else if (q.weightKg > 0) p.set('weight', String(q.weightKg));
    try {
      const r = await f(`${URL_BASE}?${p}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
      const j = await r.json().catch(() => null);
      if (!r.ok && !j) throw new Error(`HTTP ${r.status}`);
      const parsed = parseFreightos(j);
      rates = parsed.rates;
      if (!rates.length) note = parsed.error ? `No live estimate for this route: ${parsed.error}` : 'No live estimate for this route yet. Forwarders can still price it for you.';
    } catch (e) {
      console.warn(`[freightos] ${(e as Error).message}`);
      note = 'Live air and sea estimates could not load just now. Forwarders can still price it for you.';
    }
  }
  const all = [...rates, ...road.filter((x) => !rates.some((r) => r.mode === x.mode))]
    .sort((a, b) => ORDER.indexOf(a.mode) - ORDER.indexOf(b.mode));
  const v = { rates: all, note: all.length ? (rates.length ? null : note) : note };
  // keep good answers for 12 hours, failures only briefly
  if (rates.length) { cache.set(key, { at: Date.now(), v }); if (cache.size > 3000) cache.delete(cache.keys().next().value!); }
  return v;
}

/** For tests. */
export function resetFreightCache() { cache.clear(); hour = { start: 0, calls: 0 }; }
