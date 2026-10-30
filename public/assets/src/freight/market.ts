import { AppError } from '../core/errors.ts';

/**
 * The weekly container market: Drewry World Container Index (published free every Thursday).
 * The admin types the numbers in at /admin/market (about 5 minutes a week). We do not scrape.
 * The latest week feeds the sea-freight estimates and the "this week" box on the freight page.
 */
type Db = {
  run(sql: string, p?: unknown[]): Promise<unknown>;
  get<T>(sql: string, p?: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, p?: unknown[]): Promise<T[]>;
};

/** $ per 40ft container, port to port. */
export const INDEX_KEYS = {
  composite: 'WCI composite',
  shaRtm: 'Shanghai → Rotterdam',
  shaGoa: 'Shanghai → Genoa',
  shaLax: 'Shanghai → Los Angeles',
  shaNyc: 'Shanghai → New York',
  rtmSha: 'Rotterdam → Shanghai',
  rtmNyc: 'Rotterdam → New York',
  nycRtm: 'New York → Rotterdam',
  laxSha: 'Los Angeles → Shanghai',
} as const;
export type IndexKey = keyof typeof INDEX_KEYS;
export type IndexWeek = { week: string; values: Partial<Record<IndexKey, number>>; source: string };

/** The two most recent weeks published by Drewry before this code shipped, so the site shows something on day one. */
export const SEED: IndexWeek[] = [
  { week: '2026-10-22', source: 'Drewry WCI', values: { composite: 4585, shaRtm: 3632, shaGoa: 4152, shaLax: 8007, shaNyc: 10166, rtmSha: 646, rtmNyc: 3181, nycRtm: 1158, laxSha: 847 } },
  { week: '2026-10-29', source: 'Drewry WCI', values: { composite: 4429, shaRtm: 3686, shaGoa: 4151, shaLax: 7514, shaNyc: 9631, rtmSha: 646, rtmNyc: 3106, nycRtm: 1135, laxSha: 837 } },
];

let latest: IndexWeek | null = null;
/** What the estimator reads. Null until loaded. */
export const latestIndex = () => latest;

function clean(v: Record<string, unknown>): Partial<Record<IndexKey, number>> {
  const out: Partial<Record<IndexKey, number>> = {};
  for (const k of Object.keys(INDEX_KEYS) as IndexKey[]) {
    const n = Number(String(v[k] ?? '').replace(/[$,\s]/g, ''));
    if (Number.isFinite(n) && n > 0) {
      if (n < 100 || n > 50000) throw new AppError('bad_request', `${INDEX_KEYS[k]}: ${n} does not look like a $ per 40ft rate`);
      out[k] = Math.round(n);
    }
  }
  return out;
}

export async function loadMarketIndex(db: Db) {
  const n = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM market_index');
  if (!n?.n) for (const w of SEED) await db.run('INSERT INTO market_index (week, data, source, updated_at) VALUES ($1,$2,$3,$4)', [w.week, JSON.stringify(w.values), w.source, new Date().toISOString()]);
  const row = await db.get<{ week: string; data: string; source: string }>('SELECT week, data, source FROM market_index ORDER BY week DESC LIMIT 1');
  latest = row ? { week: row.week, values: JSON.parse(row.data), source: row.source } : null;
  return latest;
}

export async function saveMarketIndex(db: Db, body: Record<string, unknown>) {
  const week = String(body.week ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new AppError('bad_request', 'Enter the index date, e.g. 2026-11-05');
  const values = clean((body.values ?? {}) as Record<string, unknown>);
  if (!values.shaRtm && !values.composite) throw new AppError('bad_request', 'Enter at least Shanghai → Rotterdam or the composite');
  await db.run(`INSERT INTO market_index (week, data, source, updated_at) VALUES ($1,$2,$3,$4)
    ON CONFLICT (week) DO UPDATE SET data = excluded.data, source = excluded.source, updated_at = excluded.updated_at`, [week, JSON.stringify(values), 'Drewry WCI', new Date().toISOString()]);
  await loadMarketIndex(db);
  return { ok: true, week, values };
}

export async function marketWeeks(db: Db, limit = 8) {
  const rows = await db.all<{ week: string; data: string; source: string }>('SELECT week, data, source FROM market_index ORDER BY week DESC LIMIT $1', [limit]);
  return rows.map((r) => ({ week: r.week, values: JSON.parse(r.data) as Partial<Record<IndexKey, number>>, source: r.source }));
}

/** For the freight page: this week, the change on last week, per lane. */
export async function marketSummary(db: Db) {
  const [cur, prev] = await marketWeeks(db, 2);
  if (!cur) return { enabled: false };
  const lanes = (Object.keys(INDEX_KEYS) as IndexKey[]).filter((k) => cur.values[k]).map((k) => {
    const now = cur.values[k]!, before = prev?.values[k];
    return { key: k, label: INDEX_KEYS[k], usd: now, changePct: before ? Math.round(((now - before) / before) * 1000) / 10 : null };
  });
  return { enabled: true, week: cur.week, previousWeek: prev?.week ?? null, source: 'Drewry World Container Index', lanes };
}
