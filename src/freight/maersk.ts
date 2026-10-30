/**
 * Real upcoming sailings from Maersk's Point-to-Point Schedules API (free key, self-service at
 * developer.maersk.com). Shown beside the sea-freight estimate: "next ships Shanghai → Felixstowe".
 *
 * Env: MAERSK_CONSUMER_KEY (required), MAERSK_SCHEDULE_URL (optional, if Maersk moves the endpoint).
 * We read the answer defensively: any object with a departure and an arrival date is a sailing,
 * so small changes in Maersk's response shape do not break the page. /api/admin/maersk-test shows
 * the raw answer to check it on the live site.
 */

export type Sailing = { depart: string; arrive: string; days: number; vessel: string | null; service: string | null; stops: number | null };

const DEFAULT_URL = 'https://api.maersk.com/products/ocean-products';
const cache = new Map<string, { at: number; v: Sailing[] }>();
const TTL = 6 * 3600_000;

export const maerskEnabled = () => Boolean(process.env.MAERSK_CONSUMER_KEY);

/** Main container port for a country, with the customer's town choosing between ports where it matters. */
const ORIGIN: Record<string, [RegExp, string][]> = {
  CN: [[/shenzhen|yantian|dongguan|guangzhou|guangdong|foshan/i, 'Yantian'], [/ningbo|yiwu|zhejiang|hangzhou/i, 'Ningbo'], [/qingdao|shandong/i, 'Qingdao'],
    [/xiamen|fujian/i, 'Xiamen'], [/tianjin|beijing/i, 'Xingang'], [/.*/, 'Shanghai']],
  HK: [[/.*/, 'Hong Kong']], VN: [[/hai ?phong|hanoi/i, 'Haiphong'], [/.*/, 'Ho Chi Minh City']], IN: [[/chennai/i, 'Chennai'], [/.*/, 'Nhava Sheva']],
  TW: [[/.*/, 'Kaohsiung']], KR: [[/.*/, 'Busan']], JP: [[/.*/, 'Yokohama']], TH: [[/.*/, 'Laem Chabang']], MY: [[/.*/, 'Port Klang']], SG: [[/.*/, 'Singapore']],
  BD: [[/.*/, 'Chittagong']], PK: [[/.*/, 'Karachi']], TR: [[/izmir/i, 'Izmir'], [/mersin|adana/i, 'Mersin'], [/.*/, 'Ambarli']],
  GB: [[/southampton/i, 'Southampton'], [/london|tilbury|essex|kent/i, 'London Gateway'], [/.*/, 'Felixstowe']],
  US: [[/new york|new jersey|newark|boston|philadelphia|east/i, 'New York'], [/savannah|atlanta|georgia/i, 'Savannah'], [/houston|texas|dallas/i, 'Houston'], [/.*/, 'Los Angeles']],
  NL: [[/.*/, 'Rotterdam']], DE: [[/.*/, 'Hamburg']], BE: [[/.*/, 'Antwerp']], FR: [[/.*/, 'Le Havre']], ES: [[/barcelona/i, 'Barcelona'], [/.*/, 'Valencia']],
  IT: [[/.*/, 'Genoa']], AE: [[/.*/, 'Jebel Ali']], SA: [[/.*/, 'Jeddah']], AU: [[/.*/, 'Melbourne']], CA: [[/vancouver|bc/i, 'Vancouver'], [/.*/, 'Montreal']],
};
export function portFor(country: string, town = ''): string | null {
  const list = ORIGIN[country.toUpperCase()];
  return list ? list.find(([re]) => re.test(town))![1] : null;
}

/** Every object in the answer that looks like one sailing. */
function findSailings(node: unknown, out: Record<string, any>[] = [], depth = 0): Record<string, any>[] {
  if (!node || typeof node !== 'object' || depth > 8) return out;
  if (Array.isArray(node)) { for (const x of node) findSailings(x, out, depth + 1); return out; }
  const o = node as Record<string, any>;
  if ((o.departureDateTime || o.departureDate) && (o.arrivalDateTime || o.arrivalDate)) { out.push(o); return out; }
  for (const v of Object.values(o)) findSailings(v, out, depth + 1);
  return out;
}
function firstString(node: unknown, key: string, depth = 0): string | null {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  const o = node as Record<string, any>;
  if (typeof o[key] === 'string' && o[key]) return o[key];
  for (const v of Object.values(o)) { const s = firstString(v, key, depth + 1); if (s) return s; }
  return null;
}

export function parseSailings(j: unknown, now = Date.now()): Sailing[] {
  const seen = new Set<string>();
  const out: Sailing[] = [];
  for (const o of findSailings(j)) {
    const depart = String(o.departureDateTime ?? o.departureDate), arrive = String(o.arrivalDateTime ?? o.arrivalDate);
    const d = Date.parse(depart), a = Date.parse(arrive);
    if (!Number.isFinite(d) || !Number.isFinite(a) || a <= d || d < now - 864e5) continue;
    const vessel = o.firstDepartureVessel?.vesselName ?? firstString(o, 'vesselName');
    const key = `${depart.slice(0, 10)}|${vessel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const legs = Array.isArray(o.transportLegs) ? o.transportLegs.filter((l: any) => /vessel|ship|BARGE|SEA/i.test(JSON.stringify(l?.transport?.modeOfTransport ?? l?.modeOfTransport ?? 'vessel'))).length : null;
    out.push({ depart: depart.slice(0, 10), arrive: arrive.slice(0, 10), days: Math.round((a - d) / 864e5), vessel: vessel ? String(vessel).replace(/\s+/g, ' ').trim() : null,
      service: firstString(o, 'carrierServiceName') ?? firstString(o, 'serviceName'), stops: legs ? Math.max(0, legs - 1) : null });
  }
  return out.sort((x, y) => x.depart.localeCompare(y.depart)).slice(0, 5);
}

function request(fromCountry: string, fromPort: string, toCountry: string, toPort: string) {
  const u = new URL(process.env.MAERSK_SCHEDULE_URL || DEFAULT_URL);
  u.search = new URLSearchParams({
    vesselOperatorCarrierCode: 'MAEU', collectionOriginCountryCode: fromCountry, collectionOriginCityName: fromPort,
    deliveryDestinationCountryCode: toCountry, deliveryDestinationCityName: toPort, startDate: new Date().toISOString().slice(0, 10), dateRange: 'P6W',
  }).toString();
  return u;
}

export async function maerskSailings(fromCountry: string, fromTown: string, toCountry: string, toTown: string, f: typeof fetch = fetch) {
  const key = process.env.MAERSK_CONSUMER_KEY;
  const from = portFor(fromCountry, fromTown), to = portFor(toCountry, toTown);
  if (!key) return { enabled: false as const };
  if (!from || !to || fromCountry === toCountry) return { enabled: true as const, from, to, sailings: [] as Sailing[] };
  const ck = `${fromCountry}|${from}|${toCountry}|${to}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL) return { enabled: true as const, from, to, sailings: hit.v };
  try {
    const r = await f(request(fromCountry.toUpperCase(), from, toCountry.toUpperCase(), to), { headers: { 'Consumer-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
    const j = await r.json().catch(() => null);
    if (!r.ok) { console.warn(`[maersk] ${r.status} ${JSON.stringify(j).slice(0, 300)}`); return { enabled: true as const, from, to, sailings: [] as Sailing[] }; }
    const v = parseSailings(j);
    cache.set(ck, { at: Date.now(), v });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return { enabled: true as const, from, to, sailings: v };
  } catch (e) { console.warn(`[maersk] ${(e as Error).message}`); return { enabled: true as const, from, to, sailings: [] as Sailing[] }; }
}

/** Admin check on the live site: the raw answer for Shanghai → Felixstowe. */
export async function maerskTest(f: typeof fetch = fetch) {
  const key = process.env.MAERSK_CONSUMER_KEY;
  if (!key) return { ok: false, error: 'MAERSK_CONSUMER_KEY is not set in Render' };
  const u = request('CN', 'Shanghai', 'GB', 'Felixstowe');
  const r = await f(u, { headers: { 'Consumer-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  const text = await r.text();
  let parsed: Sailing[] = [];
  try { parsed = parseSailings(JSON.parse(text)); } catch { /* not JSON */ }
  return { ok: r.ok && parsed.length > 0, status: r.status, url: u.toString(), sailings: parsed, raw: text.slice(0, 3000) };
}
