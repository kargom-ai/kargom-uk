import { readFileSync } from 'node:fs';
import type { Db } from './db.ts';

export async function migrate(db: Db): Promise<void> {
  const sql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  await db.exec(sql);
  const seq = await db.get<{ n: number }>('SELECT n FROM shipment_seq');
  if (!seq) await db.run('INSERT INTO shipment_seq (n) VALUES ($1)', [10_000]);
  const def = await db.get('SELECT service_key FROM pricing_rules WHERE service_key = $1', ['*']);
  if (!def) await db.run('INSERT INTO pricing_rules (service_key, markup_bp, fixed_pence) VALUES ($1, $2, $3)', ['*', 1200, 10]);
}
