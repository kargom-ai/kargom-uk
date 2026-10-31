import type { Db } from '../db/db.ts';
import { AppError } from '../core/errors.ts';
import { MATCH_CATS, type Addr } from './market.ts';
import { coords, haversineMiles, outcodeCoords } from './route.ts';
import { estimatePrice } from './estimate.ts';

/**
 * Kargom FreightMatch: the public board where transport companies browse open jobs like a shop,
 * with search, filters and a typical price for each job. Customers' names, exact addresses and
 * phone numbers are never shown here; a company sees them only once its offer is accepted.
 */

type Row = { id: string; ref: number; kind: string; status: string; title: string; details: string; from_addr: string; to_addr: string; from_area: string; to_area: string;
  distance_miles: number | null; move_date: string | null; created_at: string; offers: number; best: number | null; photo: string | null };

export const BOARD_CATS: Record<string, string> = { ...MATCH_CATS, international: 'International freight' };

/** Board category for any job: FreightMatch jobs carry one; older removal and freight requests are mapped. */
export function catOf(kind: string, d: Record<string, any>): string {
  if (kind === 'transport') return d.category in BOARD_CATS ? d.category : 'other';
  if (kind === 'removals') return d.moveType === 'office' ? 'office' : d.moveType === 'items' ? 'furniture' : 'home';
  return d.load === 'air' || d.load === 'sea' ? 'international' : 'pallets';
}

const PC_FULL = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/;
const PC_OUT = /^[A-Z]{1,2}\d[A-Z\d]?$/;
const outward = (pc: string) => pc.toUpperCase().trim().split(/\s+/)[0] ?? '';

/** Where a search box points: a UK postcode or outward code becomes a point; anything else is matched as text. */
async function place(input: string, f?: typeof fetch): Promise<{ point: { lat: number; lng: number } | null; text: string }> {
  const x = input.toUpperCase().trim().replace(/\s+/g, ' ');
  if (!x) return { point: null, text: '' };
  const full = PC_FULL.exec(x);
  if (full) return { point: (await coords(`${full[1]} ${full[2]}`, f).catch(() => null)) ?? (await outcodeCoords(full[1]!, f).catch(() => null)), text: '' };
  if (PC_OUT.test(x)) return { point: await outcodeCoords(x, f).catch(() => null), text: '' };
  return { point: null, text: x.toLowerCase() };
}

/** Short facts for a card: "2 items · 80 kg · Ford Transit (not running)". */
function facts(kind: string, d: Record<string, any>): string[] {
  if (kind === 'transport') {
    const v = d.vehicle && (d.vehicle.make || d.vehicle.model) ? `${[d.vehicle.make, d.vehicle.model].filter(Boolean).join(' ')}${d.vehicle.runs === false ? ' (not running)' : ''}` : '';
    const size = d.category === 'home' ? (d.size === 'studio' ? 'Studio flat' : `${d.size} bedroom${d.size === '1' ? '' : 's'}`) : d.category === 'office' ? `${d.size[0].toUpperCase()}${d.size.slice(1)} office` : '';
    return [size, d.qty > 1 ? `${d.qty} items` : '', d.weightKg ? `${d.weightKg.toLocaleString('en-GB')} kg` : '', v].filter(Boolean);
  }
  if (kind === 'removals') return [d.items?.length ? `${d.items.length} items` : ''].filter(Boolean);
  return [d.goods, d.weightKg ? `${Number(d.weightKg).toLocaleString('en-GB')} kg` : ''].filter(Boolean);
}

const FLEX: Record<string, string> = { exact: 'This date only', week: 'Within a few days', flexible: 'Flexible' };

function card(r: Row, d: Record<string, any>) {
  const from = JSON.parse(r.from_addr) as Addr, to = JSON.parse(r.to_addr) as Addr;
  const est = estimatePrice(r.kind, d, r.distance_miles, from.postcode, to.postcode);
  return {
    id: r.id, ref: r.ref, kind: r.kind, cat: catOf(r.kind, d), title: r.title, facts: facts(r.kind, d),
    fromArea: r.from_area, toArea: r.to_area, miles: r.distance_miles, date: r.move_date, flex: FLEX[d.dateFlex] ?? '',
    offers: Number(r.offers), lowestPence: r.best === null ? null : Number(r.best), createdAt: r.created_at,
    photo: r.photo && r.kind === 'transport' ? `/api/match/jobs/${r.id}/photos/${r.photo}` : null,
    estimate: est ? { lowPence: est.lowPence, highPence: est.highPence } : null,
  };
}

const SELECT = `SELECT j.id, j.ref, j.kind, j.status, j.title, j.details, j.from_addr, j.to_addr, j.from_area, j.to_area, j.distance_miles, j.move_date, j.created_at,
  (SELECT COUNT(*) FROM job_offers o WHERE o.job_id = j.id AND o.status IN ('pending','accepted')) AS offers,
  (SELECT MIN(price_pence) FROM job_offers o WHERE o.job_id = j.id AND o.status IN ('pending','accepted')) AS best,
  (SELECT p.id FROM job_photos p WHERE p.job_id = j.id ORDER BY p.created_at LIMIT 1) AS photo
  FROM jobs j`;

export async function board(db: Db, q: URLSearchParams, today: string, f?: typeof fetch) {
  const str = (k: string, max = 60) => String(q.get(k) ?? '').trim().slice(0, max);
  const num = (k: string) => { const v = Number(q.get(k)); return Number.isFinite(v) && v > 0 ? v : null; };
  const text = str('q', 80).toLowerCase();
  const cats = str('cat', 200).split(',').filter((c) => c in BOARD_CATS);
  const radius = Math.min(300, num('radius') ?? 30);
  const [near, deliver] = await Promise.all([place(str('from', 30), f), place(str('to', 30), f)]);
  const minMiles = num('min'), maxMiles = num('max');
  const when = str('when', 10); // week | month | any
  const sort = str('sort', 10) || 'newest';
  const page = Math.max(1, Math.min(50, Math.round(num('page') ?? 1)));
  const PER = 24;

  // Open jobs whose date has not passed (yesterday kept for late posts).
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
  const rows = await db.all<Row>(`${SELECT} WHERE j.status = 'open' AND (j.move_date IS NULL OR j.move_date >= $1) ORDER BY j.created_at DESC LIMIT 1000`, [yesterday]);

  const horizon = when === 'week' ? 7 : when === 'month' ? 31 : null;
  const until = horizon ? new Date(Date.parse(`${today}T12:00:00Z`) + horizon * 864e5).toISOString().slice(0, 10) : null;
  const pointOf = (a: Addr) => (a.country === 'GB' && a.postcode ? outcodeCoords(outward(a.postcode), f).catch(() => null) : Promise.resolve(null));

  const pre: Array<{ r: Row; d: Record<string, any>; cat: string; away: number | null }> = [];
  for (const r of rows) {
    const d = JSON.parse(r.details) as Record<string, any>;
    const hay = `${r.title} ${d.what ?? ''} ${d.goods ?? ''} ${(d.items ?? []).join(' ')} ${r.from_area} ${r.to_area} ${d.vehicle?.make ?? ''} ${d.vehicle?.model ?? ''}`.toLowerCase();
    if (text && !text.split(/\s+/).every((w) => hay.includes(w))) continue;
    if (near.text && !r.from_area.toLowerCase().includes(near.text)) continue;
    if (deliver.text && !r.to_area.toLowerCase().includes(deliver.text)) continue;
    if (minMiles && !(r.distance_miles && r.distance_miles >= minMiles)) continue;
    if (maxMiles && !(r.distance_miles && r.distance_miles <= maxMiles)) continue;
    if (until && r.move_date && r.move_date > until && d.dateFlex !== 'flexible') continue;
    let away: number | null = null;
    if (near.point) {
      const p = await pointOf(JSON.parse(r.from_addr) as Addr);
      if (!p) continue;
      away = haversineMiles(near.point, p);
      if (away > radius) continue;
    }
    if (deliver.point) {
      const p = await pointOf(JSON.parse(r.to_addr) as Addr);
      if (!p || haversineMiles(deliver.point, p) > radius) continue;
    }
    pre.push({ r, d, cat: catOf(r.kind, d), away });
  }
  // Category counts reflect every other filter, so a carrier sees where the work is.
  const counts: Record<string, number> = {};
  for (const x of pre) counts[x.cat] = (counts[x.cat] ?? 0) + 1;
  const list = cats.length ? pre.filter((x) => cats.includes(x.cat)) : pre;

  const by: Record<string, (a: typeof list[number], b: typeof list[number]) => number> = {
    newest: (a, b) => (a.r.created_at < b.r.created_at ? 1 : -1),
    soonest: (a, b) => String(a.r.move_date ?? '9999').localeCompare(String(b.r.move_date ?? '9999')),
    distance: (a, b) => (b.r.distance_miles ?? 0) - (a.r.distance_miles ?? 0),
    nearest: (a, b) => (a.away ?? 9e9) - (b.away ?? 9e9),
    offers: (a, b) => Number(a.r.offers) - Number(b.r.offers) || (a.r.created_at < b.r.created_at ? 1 : -1),
  };
  list.sort(by[sort] ?? by.newest!);
  const total = list.length;
  return {
    total, page, pages: Math.max(1, Math.ceil(total / PER)), counts, cats: BOARD_CATS,
    jobs: list.slice((page - 1) * PER, page * PER).map((x) => ({ ...card(x.r, x.d), away: x.away === null ? null : Math.round(x.away) })),
  };
}

/** One job as a transport company sees it before quoting: no names, street addresses or phone numbers. */
export async function boardJob(db: Db, id: string) {
  const r = await db.get<Row>(`${SELECT} WHERE j.id = $1`, [id]);
  if (!r || r.status === 'cancelled') throw new AppError('not_found', 'This job is no longer on the board');
  const d = JSON.parse(r.details) as Record<string, any>;
  const photos = r.kind === 'transport'
    ? (await db.all<{ id: string }>('SELECT id FROM job_photos WHERE job_id = $1 ORDER BY created_at', [r.id])).map((p) => `/api/match/jobs/${r.id}/photos/${p.id}`) : [];
  const { notes, ...rest } = d;
  return { ...card(r, d), status: r.status, details: rest, notes: typeof notes === 'string' ? notes.replace(/(\+?\d[\d\s-]{7,}\d)|([\w.+-]+@[\w-]+\.[\w.]+)/g, '[hidden]') : '', photos };
}

/** Photo of an open FreightMatch job (customers are told these are shown on the board). */
export async function boardPhoto(db: Db, jobId: string, photoId: string) {
  const r = await db.get<{ data: string; kind: string; status: string }>('SELECT p.data, j.kind, j.status FROM job_photos p JOIN jobs j ON j.id = p.job_id WHERE p.id = $1 AND p.job_id = $2', [photoId, jobId]);
  if (!r || r.kind !== 'transport' || r.status === 'cancelled') throw new AppError('not_found', 'Not found');
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(r.data);
  if (!m) throw new AppError('not_found', 'Not found');
  return { type: m[1]!, data: Buffer.from(m[2]!, 'base64') };
}

/** Town for a UK postcode (shown on the board as "Manchester M1"). */
export async function townFor(postcode: string, f: typeof fetch = fetch): Promise<{ postcode: string; town: string } | null> {
  const m = PC_FULL.exec(postcode.toUpperCase().trim().replace(/\s+/g, ' '));
  if (!m) return null;
  const pc = `${m[1]} ${m[2]}`;
  const r = await f(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`, { signal: AbortSignal.timeout(6000) }).catch(() => null);
  if (!r?.ok) return null;
  const j = (await r.json()) as { result?: { postcode?: string; admin_district?: string; parish?: string; region?: string } };
  const town = j.result?.admin_district || j.result?.region || '';
  return town ? { postcode: j.result?.postcode ?? pc, town: town.replace(/, City of$/, '') } : null;
}
