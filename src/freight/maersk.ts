/**
 * Real upcoming sailings from Maersk's Point-to-Point Schedules API (free key, self-service at
 * developer.maersk.com). Shown beside the sea-freight estimate: "next ships Shanghai → Felixstowe".
 *
 * Env: MAERSK_CONSUMER_KEY (required), MAERSK_CONSUMER_SECRET (when Maersk asks for a token),
 * MAERSK_SCHEDULE_URL (optional). Maersk now offers schedules as "Ocean Commercial Schedules [DCSA]"
 * (port codes such as CNSHA → GBFXT); the older point-to-point API is kept as a fallback.
 * We read the answer defensively: any object with a departure and an arrival date is a sailing,
 * so small changes in Maersk's response shape do not break the page. /api/admin/maersk-test shows
 * the raw answer to check it on the live site.
 */

export type Sailing = { depart: string; arrive: string; days: number; vessel: string | null; service: string | null; stops: number | null };

const LEGACY_URL = 'https://api.maersk.com/products/ocean-products';
const DCSA_URLS = ['https://api.maersk.com/dcsa/cs/v1/point-to-point-routes', 'https://api.maersk.com/dcsa/commercial-schedules/v1/point-to-point-routes'];
/** The address that answered last time, so we do not try them all on every search. */
let working: string | null = null;
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
/** UN/LOCODEs for the ports above (the DCSA API wants codes, not names). */
export const LOCODE: Record<string, string> = {
  Shanghai: 'CNSHA', Yantian: 'CNYTN', Ningbo: 'CNNGB', Qingdao: 'CNTAO', Xiamen: 'CNXMN', Xingang: 'CNTXG', 'Hong Kong': 'HKHKG', Haiphong: 'VNHPH', 'Ho Chi Minh City': 'VNSGN',
  Chennai: 'INMAA', 'Nhava Sheva': 'INNSA', Kaohsiung: 'TWKHH', Busan: 'KRPUS', Yokohama: 'JPYOK', 'Laem Chabang': 'THLCH', 'Port Klang': 'MYPKG', Singapore: 'SGSIN',
  Chittagong: 'BDCGP', Karachi: 'PKKHI', Izmir: 'TRIZM', Mersin: 'TRMER', Ambarli: 'TRAMR', Southampton: 'GBSOU', 'London Gateway': 'GBLGP', Felixstowe: 'GBFXT',
  'New York': 'USNYC', Savannah: 'USSAV', Houston: 'USHOU', 'Los Angeles': 'USLAX', Rotterdam: 'NLRTM', Hamburg: 'DEHAM', Antwerp: 'BEANR', 'Le Havre': 'FRLEH',
  Barcelona: 'ESBCN', Valencia: 'ESVLC', Genoa: 'ITGOA', 'Jebel Ali': 'AEJEA', Jeddah: 'SAJED', Melbourne: 'AUMEL', Vancouver: 'CAVAN', Montreal: 'CAMTR',
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
  // DCSA point-to-point route: { placeOfReceipt: { dateTime }, placeOfDelivery: { dateTime }, legs: [...] }
  if (o.placeOfReceipt?.dateTime && o.placeOfDelivery?.dateTime) { out.push({ ...o, departureDateTime: o.placeOfReceipt.dateTime, arrivalDateTime: o.placeOfDelivery.dateTime, transportLegs: o.legs ?? o.transportLegs }); return out; }
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
    const legs = Array.isArray(o.transportLegs) ? o.transportLegs.filter((l: any) => /vessel|ship|SEA/i.test(JSON.stringify(l?.transport?.modeOfTransport ?? l?.modeOfTransport ?? 'vessel'))).length : null;
    out.push({ depart: depart.slice(0, 10), arrive: arrive.slice(0, 10), days: Math.round((a - d) / 864e5), vessel: vessel ? String(vessel).replace(/\s+/g, ' ').trim() : null,
      service: firstString(o, 'carrierServiceName') ?? firstString(o, 'serviceName'), stops: legs ? Math.max(0, legs - 1) : null });
  }
  return out.sort((x, y) => x.depart.localeCompare(y.depart)).slice(0, 5);
}

function request(url: string, fromCountry: string, fromPort: string, toCountry: string, toPort: string) {
  const u = new URL(url);
  const start = new Date(), end = new Date(Date.now() + 42 * 864e5);
  u.search = (url.includes('point-to-point-routes')
    ? new URLSearchParams({ placeOfReceipt: LOCODE[fromPort] ?? '', placeOfDelivery: LOCODE[toPort] ?? '', departureStartDate: start.toISOString().slice(0, 10), departureEndDate: end.toISOString().slice(0, 10), limit: '20' })
    : new URLSearchParams({
      vesselOperatorCarrierCode: 'MAEU', collectionOriginCountryCode: fromCountry, collectionOriginCityName: fromPort,
      deliveryDestinationCountryCode: toCountry, deliveryDestinationCityName: toPort, startDate: start.toISOString().slice(0, 10), dateRange: 'P6W',
    })).toString();
  return u;
}

/** Some Maersk APIs want a short-lived token made from the key and secret (client credentials). */
let token: { value: string; until: number } | null = null;
async function headers(f: typeof fetch): Promise<Record<string, string>> {
  const key = process.env.MAERSK_CONSUMER_KEY!, secret = process.env.MAERSK_CONSUMER_SECRET;
  const h: Record<string, string> = { 'Consumer-Key': key, Accept: 'application/json' };
  if (!secret) return h;
  if (!token || token.until < Date.now() + 60_000) {
    try {
      const r = await f('https://api.maersk.com/customer-identity/oauth/v2/access_token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Consumer-Key': key },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: key, client_secret: secret }).toString(), signal: AbortSignal.timeout(10_000),
      });
      const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
      if (r.ok && j.access_token) token = { value: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
      else console.warn(`[maersk] token ${r.status}`);
    } catch (e) { console.warn(`[maersk] token ${(e as Error).message}`); }
  }
  if (token) h.Authorization = `Bearer ${token.value}`;
  return h;
}

const candidates = () => [...new Set([process.env.MAERSK_SCHEDULE_URL, working, ...DCSA_URLS, LEGACY_URL].filter((x): x is string => Boolean(x)))];

/** Ask each known address until one answers; remember it. */
async function ask(fromCountry: string, from: string, toCountry: string, to: string, f: typeof fetch) {
  const h = await headers(f);
  const tried: { url: string; status: number; body: string }[] = [];
  for (const base of candidates()) {
    if (base.includes('point-to-point-routes') && (!LOCODE[from] || !LOCODE[to])) continue;
    const u = request(base, fromCountry, from, toCountry, to);
    const r = await f(u, { headers: h, signal: AbortSignal.timeout(12_000) });
    const body = await r.text();
    tried.push({ url: u.toString(), status: r.status, body: body.slice(0, 1500) });
    if (r.ok) { working = base; let j: unknown = null; try { j = JSON.parse(body); } catch { /* not JSON */ } return { sailings: parseSailings(j), tried }; }
    if (r.status === 401 || r.status === 403) continue; // this API is not switched on for the key: try the next
  }
  return { sailings: [] as Sailing[], tried };
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
    const { sailings, tried } = await ask(fromCountry.toUpperCase(), from, toCountry.toUpperCase(), to, f);
    if (!sailings.length && tried.length) console.warn(`[maersk] ${tried.map((t) => `${t.status} ${t.url.split('?')[0]}`).join(' | ')}`);
    cache.set(ck, { at: Date.now(), v: sailings });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return { enabled: true as const, from, to, sailings };
  } catch (e) { console.warn(`[maersk] ${(e as Error).message}`); return { enabled: true as const, from, to, sailings: [] as Sailing[] }; }
}

/** Admin check on the live site: Shanghai → Felixstowe, with what each Maersk address answered. */
export async function maerskTest(f: typeof fetch = fetch) {
  if (!process.env.MAERSK_CONSUMER_KEY) return { ok: false, error: 'MAERSK_CONSUMER_KEY is not set in Render' };
  token = null;
  const h = await headers(f);
  const { sailings, tried } = await ask('CN', 'Shanghai', 'GB', 'Felixstowe', f);
  return { ok: sailings.length > 0, usingToken: Boolean(h.Authorization), secretSet: Boolean(process.env.MAERSK_CONSUMER_SECRET), working, sailings, tried };
}
