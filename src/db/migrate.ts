import { readFileSync } from 'node:fs';
import type { Db } from './db.ts';

export async function migrate(db: Db): Promise<void> {
  const sql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  await db.exec(sql);
  // Columns added after the first release (CREATE TABLE IF NOT EXISTS does not add them to old tables).
  for (const stmt of ['ALTER TABLE partners ADD COLUMN base_postcode TEXT', 'ALTER TABLE jobs ADD COLUMN share_token TEXT',
    'ALTER TABLE fw_packages ADD COLUMN auto_send INTEGER NOT NULL DEFAULT 0', 'ALTER TABLE fw_packages ADD COLUMN auto_pref TEXT', 'ALTER TABLE fw_suites ADD COLUMN uk_address TEXT', 'ALTER TABLE fw_couriers ADD COLUMN logo TEXT']) {
    try { await db.exec(stmt); } catch { /* already there */ }
  }
  const seq = await db.get<{ n: number }>('SELECT n FROM shipment_seq');
  if (!seq) await db.run('INSERT INTO shipment_seq (n) VALUES ($1)', [10_000]);
  const def = await db.get('SELECT service_key FROM pricing_rules WHERE service_key = $1', ['*']);
  if (!def) await db.run('INSERT INTO pricing_rules (service_key, markup_bp, fixed_pence) VALUES ($1, $2, $3)', ['*', 1200, 10]);
}
