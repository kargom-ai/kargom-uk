import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/db.ts';
import type { Clock } from '../core/clock.ts';
import { AppError } from '../core/errors.ts';
import { newId } from '../core/ids.ts';

/**
 * Live chat on the website. A visitor (signed in or not) opens the chat bubble and writes;
 * the Kargom team answers from /admin/chat. The visitor's browser keeps a private token for its conversation
 * (we store only a hash of it). If nobody is around, the team is emailed; if the visitor has left
 * when we reply, they get an email with the answer.
 */

type Thread = { id: string; token_hash: string; customer_id: string | null; name: string; email: string | null; page: string | null; status: string;
  unread_admin: number; unread_visitor: number; visitor_seen_at: string | null; admin_notified_at: string | null; visitor_notified_at: string | null; last_at: string; created_at: string };
type Msg = { id: string; thread_id: string; sender: 'visitor' | 'agent'; body: string; created_at: string };

const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

export class LiveChat {
  private readonly db: Db;
  private readonly clock: Clock;
  /** Email someone (wired to the notifier by the app). */
  notify: ((to: string, subject: string, heading: string, lines: string[], link?: { href: string; text: string }) => Promise<unknown>) | null = null;
  publicUrl = '';
  /** When an admin last had the chat page open: visitors see "We're online". */
  private adminSeen = 0;
  constructor(db: Db, clock: Clock) { this.db = db; this.clock = clock; }
  private now() { return this.clock.now().toISOString(); }
  private nowMs() { return this.clock.now().getTime(); }
  get online() { return this.nowMs() - this.adminSeen < 3 * 60_000; }

  private async byToken(token: unknown) {
    const t = String(token ?? '');
    if (t.length < 20) throw new AppError('unauthorized', 'Chat not found');
    const th = await this.db.get<Thread>('SELECT * FROM chat_threads WHERE token_hash = $1', [hash(t)]);
    if (!th) throw new AppError('unauthorized', 'Chat not found');
    return th;
  }
  private msgView = (m: Msg) => ({ id: m.id, from: m.sender, body: m.body, at: m.created_at });

  /* ---------------- visitor ---------------- */

  async start(input: { name?: unknown; email?: unknown; message?: unknown; page?: unknown }, user: { customerId: string; name: string; email: string } | null) {
    const message = clean(input.message, 2000);
    if (!message) throw new AppError('bad_request', 'Write your message');
    const name = clean(input.name, 80) || user?.name || '';
    const email = (clean(input.email, 200) || user?.email || '').toLowerCase();
    if (!name) throw new AppError('bad_request', 'Tell us your name');
    if (!EMAIL.test(email)) throw new AppError('bad_request', 'Add your email so we can reply if you leave the page');
    const token = randomBytes(24).toString('base64url');
    const id = newId('cht'), now = this.now();
    await this.db.run(`INSERT INTO chat_threads (id, token_hash, customer_id, name, email, page, status, unread_admin, unread_visitor, visitor_seen_at, last_at, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,'open',0,0,$7,$7,$7)`, [id, hash(token), user?.customerId ?? null, name, email, clean(input.page, 300) || null, now]);
    await this.add(id, 'visitor', message);
    return { token, ...(await this.visitorView(id)) };
  }

  async visitorRead(token: unknown, after?: string | null) {
    const th = await this.byToken(token);
    await this.db.run('UPDATE chat_threads SET unread_visitor = 0, visitor_seen_at = $1 WHERE id = $2', [this.now(), th.id]);
    return this.visitorView(th.id, after);
  }

  async visitorSend(token: unknown, body: unknown) {
    const th = await this.byToken(token);
    const text = clean(body, 2000);
    if (!text) throw new AppError('bad_request', 'Write your message');
    const recent = await this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM chat_messages WHERE thread_id = $1 AND sender = 'visitor' AND created_at > $2",
      [th.id, new Date(this.nowMs() - 60_000).toISOString()]);
    if ((recent?.n ?? 0) >= 12) throw new AppError('bad_request', 'Please wait a moment before sending more messages');
    await this.db.run("UPDATE chat_threads SET status = 'open', visitor_seen_at = $1 WHERE id = $2", [this.now(), th.id]);
    await this.add(th.id, 'visitor', text);
    return this.visitorView(th.id);
  }

  private async visitorView(id: string, after?: string | null) {
    const th = (await this.db.get<Thread>('SELECT * FROM chat_threads WHERE id = $1', [id]))!;
    const msgs = await this.db.all<Msg>('SELECT * FROM chat_messages WHERE thread_id = $1 ORDER BY created_at, id', [id]);
    const i = after ? msgs.findIndex((m) => m.id === after) : -1;
    return { name: th.name, status: th.status, online: this.online, unread: th.unread_visitor, messages: msgs.slice(i + 1).map(this.msgView) };
  }

  /** Just the unread count, for the dot on the bubble. */
  async visitorUnread(token: unknown) {
    const th = await this.byToken(token);
    return { unread: th.unread_visitor, online: this.online };
  }

  /* ---------------- team ---------------- */

  private async add(threadId: string, sender: 'visitor' | 'agent', body: string) {
    const now = this.now();
    await this.db.run('INSERT INTO chat_messages (id, thread_id, sender, body, created_at) VALUES ($1,$2,$3,$4,$5)', [newId('chm'), threadId, sender, body, now]);
    if (sender === 'visitor') await this.db.run('UPDATE chat_threads SET unread_admin = unread_admin + 1, last_at = $1 WHERE id = $2', [now, threadId]);
    else await this.db.run('UPDATE chat_threads SET unread_visitor = unread_visitor + 1, unread_admin = 0, last_at = $1 WHERE id = $2', [now, threadId]);
    const th = (await this.db.get<Thread>('SELECT * FROM chat_threads WHERE id = $1', [threadId]))!;
    const base = this.publicUrl || 'https://kargom.co.uk';
    if (sender === 'visitor' && !this.online && this.notify) {
      // the team is not on the chat page: email them, at most every 10 minutes per conversation
      if (!th.admin_notified_at || Date.parse(th.admin_notified_at) < this.nowMs() - 10 * 60_000) {
        await this.db.run('UPDATE chat_threads SET admin_notified_at = $1 WHERE id = $2', [now, threadId]);
        for (const to of (process.env.ADMIN_EMAILS ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
          this.notify(to, `New chat message from ${th.name}`, `${th.name} wrote on the website`, [body.slice(0, 500), th.email ? `Email: ${th.email}` : '', th.page ? `Page: ${th.page}` : ''].filter(Boolean),
            { href: `${base}/admin/chat?t=${th.id}`, text: 'Open the chat' }).catch(() => {});
        }
      }
    }
    if (sender === 'agent' && th.email && this.notify) {
      // the visitor is not on the page any more: send the answer by email (at most every 10 minutes)
      const away = !th.visitor_seen_at || Date.parse(th.visitor_seen_at) < this.nowMs() - 90_000;
      const quiet = !th.visitor_notified_at || Date.parse(th.visitor_notified_at) < this.nowMs() - 10 * 60_000;
      if (away && quiet) {
        await this.db.run('UPDATE chat_threads SET visitor_notified_at = $1 WHERE id = $2', [now, threadId]);
        const back = th.page && th.page.startsWith('/') ? `${base}${th.page.split('#')[0]}${th.page.includes('?') ? '&' : '?'}chat=open` : `${base}/?chat=open`;
        this.notify(th.email, 'Kargom replied to your message', `Hi ${th.name.split(' ')[0]}, we replied`, [body.slice(0, 1500), 'You can reply in the chat on our website, from the same browser.'],
          { href: back, text: 'Open the chat' }).catch(() => {});
      }
    }
  }

  async adminList() {
    this.adminSeen = this.nowMs();
    const threads = await this.db.all<Thread & { last_body: string | null; last_sender: string | null }>(`SELECT t.*,
        (SELECT body FROM chat_messages m WHERE m.thread_id = t.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_body,
        (SELECT sender FROM chat_messages m WHERE m.thread_id = t.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_sender
      FROM chat_threads t ORDER BY (t.status = 'open') DESC, t.last_at DESC LIMIT 200`);
    return { threads: threads.map((t) => ({ id: t.id, name: t.name, email: t.email, customerId: t.customer_id, page: t.page, status: t.status, unread: t.unread_admin,
      lastAt: t.last_at, last: (t.last_body ?? '').slice(0, 140), lastFrom: t.last_sender, visitorHere: !!t.visitor_seen_at && Date.parse(t.visitor_seen_at) > this.nowMs() - 60_000 })) };
  }

  async adminUnread() {
    const r = await this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM chat_threads WHERE status = 'open' AND unread_admin > 0");
    return { unread: r?.n ?? 0 };
  }

  private async thread(id: string) {
    const th = await this.db.get<Thread>('SELECT * FROM chat_threads WHERE id = $1', [id]);
    if (!th) throw new AppError('not_found', 'Chat not found');
    return th;
  }

  async adminOpen(id: string) {
    this.adminSeen = this.nowMs();
    const th = await this.thread(id);
    await this.db.run('UPDATE chat_threads SET unread_admin = 0 WHERE id = $1', [id]);
    const msgs = await this.db.all<Msg>('SELECT * FROM chat_messages WHERE thread_id = $1 ORDER BY created_at, id', [id]);
    return { id: th.id, name: th.name, email: th.email, customerId: th.customer_id, page: th.page, status: th.status, createdAt: th.created_at,
      visitorHere: !!th.visitor_seen_at && Date.parse(th.visitor_seen_at) > this.nowMs() - 60_000, messages: msgs.map(this.msgView) };
  }

  async adminSend(id: string, body: unknown) {
    const th = await this.thread(id);
    const text = clean(body, 4000);
    if (!text) throw new AppError('bad_request', 'Write a reply');
    await this.db.run("UPDATE chat_threads SET status = 'open' WHERE id = $1", [th.id]);
    await this.add(th.id, 'agent', text);
    return this.adminOpen(id);
  }

  async adminClose(id: string, open = false) {
    await this.thread(id);
    await this.db.run('UPDATE chat_threads SET status = $1, unread_admin = 0 WHERE id = $2', [open ? 'open' : 'closed', id]);
    return this.adminOpen(id);
  }
}
