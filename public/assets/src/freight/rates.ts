import { AppError } from '../core/errors.ts';
import { estimatePrice } from '../market/estimate.ts';
import { routeInfo } from '../market/route.ts';
import { cargoboardRates } from './cargoboard.ts';
import { eurosenderRates } from './eurosender.ts';
import { latestIndex, type IndexKey } from './market.ts';
import { carriersFor } from './carriers.ts';

/**
 * Air, sea, express and road freight price ranges, worked out from published market indices.
 *
 * Why our own: Freightos' public calculator (ship.freightos.com/api/shippingCalculator) answers
 * every query with the same sample (one FCL quote, USD 13,088–19,813), so it cannot price a shipment.
 *
 * Inputs (USD, late October 2026), updated by hand in LANES below:
 *  - Sea, per 40 ft container: Drewry World Container Index 22 Oct 2026 (Shanghai–Rotterdam $3,632,
 *    Shanghai–Los Angeles $8,007, Shanghai–New York $10,166, Shanghai–Genoa $4,152); FBX Asia–Med $3,800.
 *  - Air, per kg airport to airport: Freightos Air Index (China–Europe $3.58, China–North America ~$6.30).
 * On top of the index we add typical collection, handling, customs clearance and delivery, then show
 * a range (-20% / +30%). Duties and import VAT are not included.
 */

export type FreightLoad = 'boxes' | 'pallets' | 'container20' | 'container40' | 'container40HC';
export type FreightRate = { mode: string; label: string; minPence: number; maxPence: number; currency: string; daysMin: number | null; daysMax: number | null; source: 'kargom' | 'cargoboard' | 'eurosender'; carrier?: string; live?: boolean };
export type FreightQuery = {
  origin: string; destination: string; fromCountry: string; toCountry: string; fromPostcode?: string; toPostcode?: string;
  load: FreightLoad; quantity: number; weightKg: number; lengthCm: number; widthCm: number; heightCm: number; fromTown?: string; toTown?: string;
  /** 'port' = the customer delivers to / collects from the port or airport themselves. Default 'door'. */
  fromType?: 'door' | 'port'; toType?: 'door' | 'port';
};

const LOADS: FreightLoad[] = ['boxes', 'pallets', 'container20', 'container40', 'container40HC'];
const LABEL: Record<string, string> = {
  express: 'Express courier', air: 'Air freight', LCL: 'Sea freight · shared container (LCL)', FCL: 'Sea freight · full container (FCL)',
  LTL: 'Road · part load (LTL)', FTL: 'Road · full truck (FTL)',
};
const ORDER = ['express', 'air', 'LCL', 'FCL', 'LTL', 'FTL'];

type Region = 'uk' | 'eu' | 'asia' | 'na' | 'me' | 'oc' | 'other';
const REGION: Record<string, Region> = {
  GB: 'uk', JE: 'uk',
  IE: 'eu', FR: 'eu', DE: 'eu', NL: 'eu', BE: 'eu', ES: 'eu', IT: 'eu', PT: 'eu', PL: 'eu', AT: 'eu', DK: 'eu', SE: 'eu', CH: 'eu', CZ: 'eu', GR: 'eu',
  CN: 'asia', HK: 'asia', TW: 'asia', VN: 'asia', JP: 'asia', KR: 'asia', SG: 'asia', TH: 'asia', MY: 'asia', ID: 'asia', IN: 'asia', BD: 'asia', PK: 'asia',
  US: 'na', CA: 'na', MX: 'na', TR: 'me', AE: 'me', SA: 'me', AU: 'oc', NZ: 'oc',
};
const region = (c: string): Region => REGION[c] ?? 'other';

/** Per lane: sea $/40ft port to port, LCL $/m³ door to door, air $/kg door to door, express $/kg, transit days. */
type Lane = { fcl: number; lcl: number; air: number; exp: number; sea: [number, number]; airDays: [number, number]; expDays: [number, number] };
const L = (fcl: number, lcl: number, air: number, exp: number, sea: [number, number], airDays: [number, number] = [6, 10], expDays: [number, number] = [3, 6]): Lane => ({ fcl, lcl, air, exp, sea, airDays, expDays });
const LANES: Record<string, Lane> = {
  'asia>uk': L(3650, 135, 5.2, 9.5, [35, 48]),
  'asia>eu': L(3800, 135, 5.2, 9.5, [32, 45]),
  'asia>na': L(9000, 170, 8.5, 11, [25, 42], [6, 10], [3, 5]),
  'asia>me': L(2200, 110, 4.0, 8, [20, 30]),
  'asia>oc': L(2400, 120, 4.5, 9, [20, 30]),
  'uk>na': L(2300, 120, 4.6, 8.5, [16, 26], [4, 8], [2, 4]),
  'eu>na': L(2300, 120, 4.6, 8.5, [16, 26], [4, 8], [2, 4]),
  'na>uk': L(1300, 100, 3.8, 8, [16, 26], [4, 8], [2, 4]),
  'na>eu': L(1300, 100, 3.8, 8, [16, 26], [4, 8], [2, 4]),
  'uk>asia': L(1100, 95, 3.2, 9, [35, 48]),
  'eu>asia': L(1100, 95, 3.2, 9, [35, 48]),
  'me>uk': L(2600, 120, 3.6, 8, [18, 30], [4, 8], [2, 5]),
  'uk>me': L(2200, 110, 3.4, 8, [18, 30], [4, 8], [2, 5]),
  'uk>oc': L(3200, 150, 6.5, 12, [40, 55], [6, 10], [4, 7]),
  'oc>uk': L(2800, 150, 6.5, 12, [40, 55], [6, 10], [4, 7]),
};
/** Which weekly WCI lane sets each lane's sea rate ($/40ft port to port). */
const INDEX_FOR: Record<string, IndexKey | [IndexKey, IndexKey]> = {
  'asia>uk': 'shaRtm', 'asia>eu': 'shaRtm', 'asia>na': ['shaLax', 'shaNyc'], 'uk>na': 'rtmNyc', 'eu>na': 'rtmNyc',
  'na>uk': 'nycRtm', 'na>eu': 'nycRtm', 'uk>asia': 'rtmSha', 'eu>asia': 'rtmSha',
};
/** The lane with this week's index in place of the built-in sea rate, when the admin has entered one. */
function withIndex(lane: string, base: Lane): { lane: Lane; week: string | null } {
  const idx = latestIndex(), k = INDEX_FOR[lane];
  if (!idx || !k) return { lane: base, week: null };
  const vals = (Array.isArray(k) ? k : [k]).map((x) => idx.values[x]).filter((n): n is number => typeof n === 'number' && n > 0);
  if (!vals.length) return { lane: base, week: null };
  return { lane: { ...base, fcl: vals.reduce((a, b) => a + b, 0) / vals.length }, week: idx.week };
}
const DEFAULT_LANE = L(3200, 150, 6.0, 11, [30, 50], [6, 12], [4, 8]);
const NEAR = new Set(['uk>uk', 'uk>eu', 'eu>uk', 'eu>eu']);

/** Charges per container on top of the sea index: collection, terminal handling, customs, delivery. */
const FCL_EXTRAS = 1400;
const LCL_FIXED = 280;
/**
 * What the door-to-door extras are made of, per end. A port end drops collection or delivery,
 * export or import clearance and haulage; terminal handling stays.
 *   FCL $/container: 150 terminal handling + 550 origin door + 700 destination door = FCL_EXTRAS
 *   LCL: fixed $ and a share of the per-m³ rate; air: fixed $ and a share of the per-kg rate
 */
const DOOR = { fcl: { from: 550, to: 700 }, lcl: { from: 100, to: 90, share: 0.15 }, air: { from: 60, to: 60, share: 0.1 } };
function ends(q: FreightQuery) { return { fromDoor: q.fromType !== 'port', toDoor: q.toType !== 'port' }; }
const CONTAINER: Record<string, { factor: number; cbm: number }> = { container20: { factor: 0.62, cbm: 33 }, container40: { factor: 1, cbm: 67 }, container40HC: { factor: 1.06, cbm: 76 } };
const usdToGbp = () => Number(process.env.USD_GBP) || 0.78;

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
    fromCountry: str(q.get('fromCountry'), 2).toUpperCase() || 'GB', toCountry: str(q.get('toCountry'), 2).toUpperCase() || 'GB',
    fromPostcode: str(q.get('fromPostcode'), 10).toUpperCase(), toPostcode: str(q.get('toPostcode'), 10).toUpperCase(),
    fromTown: str(q.get('fromTown'), 60), toTown: str(q.get('toTown'), 60),
    fromType: q.get('fromType') === 'port' ? 'port' : 'door', toType: q.get('toType') === 'port' ? 'port' : 'door',
  };
}

const row = (mode: string, midUsd: number, days: [number, number], hi = 1.3): FreightRate => {
  const mid = midUsd * usdToGbp() * 100;
  const r10 = (p: number) => Math.max(1000, Math.round(p / 1000) * 1000);
  return { mode, label: LABEL[mode]!, minPence: r10(mid * 0.8), maxPence: r10(mid * hi), currency: 'GBP', daysMin: days[0], daysMax: days[1], source: 'kargom' };
};

/** UK / Europe by road, using our haulage estimate. */
async function road(q: FreightQuery, near: string, f: typeof fetch): Promise<FreightRate[]> {
  let miles = near === 'uk>uk' ? 150 : 650;
  if (near === 'uk>uk' && UKPC.test(q.fromPostcode ?? '') && UKPC.test(q.toPostcode ?? '')) {
    try { miles = (await routeInfo({ postcode: q.fromPostcode!, country: 'GB' }, { postcode: q.toPostcode!, country: 'GB' }, f)).miles; } catch { /* keep the default */ }
  }
  const days: [number, number] = near === 'uk>uk' ? (miles > 250 ? [2, 3] : [1, 2]) : [3, 6];
  const out: FreightRate[] = [];
  const add = (mode: string, d: Record<string, unknown>) => {
    const e = estimatePrice('freight', d, miles);
    if (e) out.push({ mode, label: LABEL[mode]!, minPence: e.lowPence, maxPence: e.highPence, currency: 'GBP', daysMin: days[0], daysMax: days[1], source: 'kargom' });
  };
  const boxesAsPallets = Math.max(1, Math.ceil(Math.max((q.lengthCm * q.widthCm * q.heightCm / 1e6) * q.quantity / 1.6, (q.weightKg * q.quantity) / 500)));
  const pallets = q.load === 'pallets' ? q.quantity : q.load === 'boxes' ? boxesAsPallets : 26;
  if (!q.load.startsWith('container') && pallets <= 26) add('LTL', { load: 'ltl', pallets, palletType: 'uk' });
  if (pallets >= 6) add('FTL', { load: 'ftl', vehicle: q.load === 'pallets' && pallets <= 14 ? '18t' : 'artic' });
  // crossing to/from Europe: ferry or tunnel, plus customs paperwork both sides
  if (near !== 'uk>uk') for (const r of out) { r.minPence = Math.round((r.minPence * 1.25 + 15000) / 1000) * 1000; r.maxPence = Math.round((r.maxPence * 1.25 + 20000) / 1000) * 1000; }
  return out;
}

export async function freightRates(q: FreightQuery, f: typeof fetch = fetch): Promise<{ rates: FreightRate[]; note: string | null; basis: string; scope: string; carriers: { id: string; name: string }[] }> {
  const lane = `${region(q.fromCountry)}>${region(q.toCountry)}`;
  const container = q.load.startsWith('container');
  const out: FreightRate[] = [];
  const near = NEAR.has(lane) ? lane : null;
  const { lane: L, week: indexWeek } = withIndex(lane, LANES[lane] ?? DEFAULT_LANE);
  const cbm = container ? CONTAINER[q.load]!.cbm * q.quantity : (q.lengthCm * q.widthCm * q.heightCm / 1e6) * q.quantity;
  const kg = container ? 0 : q.weightKg * q.quantity;

  const { fromDoor, toDoor } = ends(q);
  const fclExtras = FCL_EXTRAS - (fromDoor ? 0 : DOOR.fcl.from) - (toDoor ? 0 : DOOR.fcl.to);
  const lclFixed = LCL_FIXED - (fromDoor ? 0 : DOOR.lcl.from) - (toDoor ? 0 : DOOR.lcl.to);
  const lclRate = L.lcl * (1 - (fromDoor ? 0 : DOOR.lcl.share) - (toDoor ? 0 : DOOR.lcl.share));
  const airFixed = 180 - (fromDoor ? 0 : DOOR.air.from) - (toDoor ? 0 : DOOR.air.to);
  const airRate = L.air * (1 - (fromDoor ? 0 : DOOR.air.share) - (toDoor ? 0 : DOOR.air.share));
  if (container) {
    const c = CONTAINER[q.load]!;
    if (!near) out.push(row('FCL', (L.fcl * c.factor + fclExtras) * q.quantity, L.sea));
    else out.push(...(await road(q, near, f)).filter((r) => r.mode === 'FTL'));
  } else {
    const airKg = Math.max(kg, cbm * 167);
    const expKg = Math.max(kg, cbm * 200);
    if (expKg <= 300) {
      // couriers charge more per kg for small shipments
      const perKg = (near ? 4.2 : L.exp) * (expKg < 20 ? 1.6 : expKg < 70 ? 1.2 : 1);
      out.push(row('express', Math.max(45, 25 + expKg * perKg), near ? [1, 3] : L.expDays));
    }
    if (!near) {
      if (airKg >= 45) out.push(row('air', Math.max(fromDoor || toDoor ? 250 : 150, airFixed + airKg * airRate), L.airDays));
      if (cbm <= 18 && (cbm >= 0.5 || kg >= 150)) out.push(row('LCL', lclFixed + Math.max(1, cbm, kg / 1000) * lclRate, [L.sea[0] + 5, L.sea[1] + 7]));
      if (cbm >= 12) out.push(row('FCL', (L.fcl * (cbm > 33 ? 1 : 0.62) + fclExtras) * Math.max(1, Math.ceil(cbm / (cbm > 33 ? 67 : 33))), L.sea));
    } else if (q.load === 'pallets' || expKg > 70) out.push(...(await road(q, near, f)));
  }
  // live pallet-network prices replace our road estimate where Cargoboard covers the route
  const live = (await Promise.all([cargoboardRates(q, f), eurosenderRates(q, f)])).flat();
  const liveModes = new Set(live.map((r) => r.mode));
  const all = [...out.filter((r) => !liveModes.has(r.mode)), ...live];
  all.sort((a, b) => ORDER.indexOf(a.mode) - ORDER.indexOf(b.mode) || Number(Boolean(b.live)) - Number(Boolean(a.live)) || a.minPence - b.minPence);
  return {
    rates: all,
    note: all.length ? null : 'We could not estimate this one. Freight companies can still price it for you.',
    basis: near ? 'typical UK and European haulage rates'
      : `${indexWeek ? `the Drewry World Container Index of ${new Date(indexWeek + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Drewry market indices'}, the Freightos Air Index, plus ${fromDoor && toDoor ? 'typical collection, customs clearance and delivery charges' : !fromDoor && !toDoor ? 'terminal handling (port to port: no collection, delivery or customs)' : fromDoor ? 'collection and export clearance, delivered to the destination port' : 'import clearance and delivery from the origin port'}`,
    carriers: near ? [] : carriersFor(lane),
    scope: near ? 'door to door' : `${fromDoor ? 'door' : 'port'} to ${toDoor ? 'door' : 'port'}`,
  };
}
