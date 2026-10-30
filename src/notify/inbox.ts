import type { Db } from '../db/db.ts';
import type { Clock } from '../core/clock.ts';
import { newId } from '../core/ids.ts';

/** Where a notification belongs: it lights up that item in the customer's left menu. */
export const AREAS = ['ship', 'tr', 'req', 'wallet', 'help'] as const;
export type Area = typeof AREAS[number];

/**
 * In-app notifications ("the bell"). Every update that matters to a customer lands here,
 * next to any email or SMS. Reading happens when they open the item or visit that area.
 */
export class Inbox {
  private readonly db: Db;
  private readonly clock: Clock;
  constructor(db: Db, clock: Clock) { this.db = db; this.clock = clock; }

  async add(customerId: string, area: Area, title: string, body: string | null, link: string | null) {
    await this.db.run('INSERT INTO inbox (id, customer_id, area, title, body, link, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [newId('inb'), customerId, area, title.slice(0, 160), body ? body.slice(0, 400) : null, link, this.clock.now().toISOString()]);
  }
  /** Fire and forget: a failed notification never breaks the action that caused it. */
  push(customerId: string, area: Area, title: string, body: string | null, link: string | null) {
    this.add(customerId, area, title, body, link).catch((e) => console.warn(`[inbox] ${(e as Error).message}`));
  }

  async list(customerId: string) {
    const items = await this.db.all<{ id: string; area: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }>(
      'SELECT id, area, title, body, link, read_at, created_at FROM inbox WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 30', [customerId]);
    const counts = await this.db.all<{ area: string; n: number }>('SELECT area, COUNT(*) AS n FROM inbox WHERE customer_id = $1 AND read_at IS NULL GROUP BY area', [customerId]);
    const unread: Record<string, number> = Object.fromEntries(AREAS.map((a) => [a, 0]));
    for (const c of counts) unread[c.area] = Number(c.n);
    return {
      items: items.map((i) => ({ id: i.id, area: i.area, title: i.title, body: i.body, link: i.link, read: Boolean(i.read_at), createdAt: i.created_at })),
      unread, total: Object.values(unread).reduce((a, b) => a + b, 0),
    };
  }

  /** Mark one notification, one area, or everything as read. */
  async read(customerId: string, input: { id?: unknown; area?: unknown; all?: unknown }) {
    const now = this.clock.now().toISOString();
    if (typeof input.id === 'string') await this.db.run('UPDATE inbox SET read_at = $1 WHERE customer_id = $2 AND id = $3 AND read_at IS NULL', [now, customerId, input.id]);
    else if (typeof input.area === 'string' && (AREAS as readonly string[]).includes(input.area)) await this.db.run('UPDATE inbox SET read_at = $1 WHERE customer_id = $2 AND area = $3 AND read_at IS NULL', [now, customerId, input.area]);
    else if (input.all) await this.db.run('UPDATE inbox SET read_at = $1 WHERE customer_id = $2 AND read_at IS NULL', [now, customerId]);
    return this.list(customerId);
  }
}
