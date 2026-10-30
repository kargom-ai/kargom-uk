import type { Db } from '../db/db.ts';
import { AppError } from '../core/errors.ts';
import { newId } from '../core/ids.ts';
import type { Clock } from '../core/clock.ts';

export type TicketStatus = 'waiting_us' | 'waiting_customer' | 'solved';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export const CATEGORIES = ['weight_adjustment', 'where_is_my_parcel', 'damaged_or_missing', 'billing', 'account', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

export type TicketRow = {
  id: string; ref: string; customer_id: string; shipment_id: string | null; category: Category; subject: string;
  status: TicketStatus; priority: Priority; assignee_id: string | null; created_at: string; updated_at: string;
};
export type MessageRow = { id: string; ticket_id: string; author_type: 'customer' | 'agent' | 'note'; author_id: string; body: string; created_at: string };

/** SLA for the first/next reply from us, by priority. */
export const SLA_MINUTES: Record<Priority, number> = { urgent: 30, high: 60, normal: 120, low: 480 };

export class SupportService {
  /** We replied to a customer's help request (the app turns this into a notification). */
  onAgentReply: ((ticketId: string) => void) | null = null;
  private readonly db: Db;
  private readonly clock: Clock;
  constructor(db: Db, clock: Clock) {
    this.db = db;
    this.clock = clock;
  }

  private now() {
    return this.clock.now().toISOString();
  }

  /** Damage and paused accounts jump the queue. */
  private priorityFor(category: Category, paused: boolean): Priority {
    if (paused) return 'urgent';
    if (category === 'damaged_or_missing') return 'high';
    if (category === 'billing' || category === 'other') return 'low';
    return 'normal';
  }

  async open(input: { customerId: string; category: Category; subject: string; body: string; shipmentId?: string | null }): Promise<TicketRow> {
    if (!CATEGORIES.includes(input.category)) throw new AppError('bad_request', 'Unknown category');
    const subject = input.subject.trim().slice(0, 140);
    const body = input.body.trim();
    if (!subject || !body) throw new AppError('bad_request', 'Subject and message are required');
    if (body.length > 10_000) throw new AppError('bad_request', 'Message is too long');
    if (input.shipmentId) {
      const own = await this.db.get('SELECT id FROM shipments WHERE id = $1 AND customer_id = $2', [input.shipmentId, input.customerId]);
      if (!own) throw new AppError('not_found', 'Shipment not found');
    }
    const c = await this.db.get<{ bookings_paused: number }>('SELECT bookings_paused FROM customers WHERE id = $1', [input.customerId]);
    const id = newId('tkt');
    await this.db.tx(async (tx) => {
      const n = await tx.get<{ n: number }>('SELECT COUNT(*) AS n FROM tickets');
      const now = this.now();
      await tx.run(
        `INSERT INTO tickets (id, ref, customer_id, shipment_id, category, subject, status, priority, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, `T-${1000 + (n?.n ?? 0) + 1}`, input.customerId, input.shipmentId ?? null, input.category, subject, 'waiting_us',
          this.priorityFor(input.category, Boolean(c?.bookings_paused)), now, now],
      );
      await tx.run('INSERT INTO ticket_messages (id, ticket_id, author_type, author_id, body, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [
        newId('msg'), id, 'customer', input.customerId, body, now]);
    });
    return this.get(id);
  }

  async get(id: string): Promise<TicketRow> {
    const t = await this.db.get<TicketRow>('SELECT * FROM tickets WHERE id = $1', [id]);
    if (!t) throw new AppError('not_found', 'Ticket not found');
    return t;
  }

  /** Customer view: never includes internal notes. */
  async threadForCustomer(id: string, customerId: string) {
    const t = await this.get(id);
    if (t.customer_id !== customerId) throw new AppError('not_found', 'Ticket not found');
    const messages = await this.db.all<MessageRow>(
      "SELECT * FROM ticket_messages WHERE ticket_id = $1 AND author_type <> 'note' ORDER BY created_at, id", [id]);
    return { ticket: t, messages };
  }

  async threadForAgent(id: string) {
    const t = await this.get(id);
    const messages = await this.db.all<MessageRow>('SELECT * FROM ticket_messages WHERE ticket_id = $1 ORDER BY created_at, id', [id]);
    return { ticket: t, messages };
  }

  async customerReply(id: string, customerId: string, body: string) {
    const t = await this.get(id);
    if (t.customer_id !== customerId) throw new AppError('not_found', 'Ticket not found');
    if (!body.trim()) throw new AppError('bad_request', 'Message is empty');
    await this.addMessage(id, 'customer', customerId, body, 'waiting_us');
  }

  async customerSetSolved(id: string, customerId: string, solved: boolean) {
    const t = await this.get(id);
    if (t.customer_id !== customerId) throw new AppError('not_found', 'Ticket not found');
    await this.db.run('UPDATE tickets SET status = $1, updated_at = $2 WHERE id = $3', [solved ? 'solved' : 'waiting_us', this.now(), id]);
  }

  async agentReply(id: string, agentId: string, body: string, opts: { internal: boolean; nextStatus?: TicketStatus }) {
    await this.get(id);
    if (!body.trim()) throw new AppError('bad_request', 'Message is empty');
    await this.addMessage(id, opts.internal ? 'note' : 'agent', agentId, body, opts.internal ? undefined : opts.nextStatus ?? 'waiting_customer');
    if (!opts.internal) this.onAgentReply?.(id);
  }

  private async addMessage(id: string, type: MessageRow['author_type'], authorId: string, body: string, status?: TicketStatus) {
    const now = this.now();
    await this.db.tx(async (tx) => {
      await tx.run('INSERT INTO ticket_messages (id, ticket_id, author_type, author_id, body, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [
        newId('msg'), id, type, authorId, body.trim().slice(0, 10_000), now]);
      if (status) await tx.run('UPDATE tickets SET status = $1, updated_at = $2 WHERE id = $3', [status, now, id]);
      else await tx.run('UPDATE tickets SET updated_at = $1 WHERE id = $2', [now, id]);
    });
  }

  async listForCustomer(customerId: string) {
    return this.db.all<TicketRow>('SELECT * FROM tickets WHERE customer_id = $1 ORDER BY updated_at DESC', [customerId]);
  }

  /** Agent queue with SLA due times, most urgent first. */
  async queue(status?: TicketStatus) {
    const rows = await this.db.all<TicketRow>(
      `SELECT * FROM tickets ${status ? 'WHERE status = $1' : ''} ORDER BY updated_at ASC LIMIT 500`, status ? [status] : []);
    const rank: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    const nowMs = this.clock.now().getTime();
    return rows
      .map((t) => {
        const due = new Date(t.updated_at).getTime() + SLA_MINUTES[t.priority] * 60_000;
        return { ...t, slaDueAt: new Date(due).toISOString(), overdue: t.status === 'waiting_us' && due < nowMs };
      })
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || rank[a.priority] - rank[b.priority] || a.slaDueAt.localeCompare(b.slaDueAt));
  }
}
