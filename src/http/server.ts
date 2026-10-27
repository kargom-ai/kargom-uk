import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { AppError, isAppError } from '../core/errors.ts';
import type { App } from '../app.ts';
import type { Principal } from '../auth/auth.ts';
import { verifyStripeSignature } from '../payments/stripe.ts';
import { CATEGORIES, type Category, type TicketStatus } from '../support/tickets.ts';
import type { ShipmentRequest } from '../providers/types.ts';
import { parseGbp } from '../core/money.ts';
import { serveStatic } from './static.ts';
import { FakeGateway } from '../payments/stripe.ts';

type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  raw: string;
  body: any;
  user: Principal | null;
};
type Handler = (ctx: Ctx) => Promise<unknown>;
type Access = 'public' | 'customer' | 'admin' | 'webhook';
type Route = { method: string; pattern: RegExp; keys: string[]; access: Access; handler: Handler };

const MAX_BODY = 1_000_000;

function compile(path: string) {
  const keys: string[] = [];
  const pattern = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
  return { pattern, keys };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new AppError('bad_request', 'Request body too large');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data ?? {});
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
}

const str = (v: unknown, name: string, max = 500): string => {
  if (typeof v !== 'string' || !v.trim()) throw new AppError('bad_request', `${name} is required`);
  if (v.length > max) throw new AppError('bad_request', `${name} is too long`);
  return v;
};

/** Very small per-IP limiter for login and quote endpoints. */
class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }
  check(key: string) {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.reset < now) {
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      return;
    }
    if (++h.n > this.limit) throw new AppError('forbidden', 'Too many attempts. Please wait a minute.');
  }
}

export function buildRouter(app: App) {
  const routes: Route[] = [];
  const on = (method: string, path: string, access: Access, handler: Handler) => routes.push({ method, ...compile(path), access, handler });
  const loginLimiter = new RateLimiter(10, 60_000);
  const quoteLimiter = new RateLimiter(60, 60_000);
  const ip = (c: Ctx) => (c.req.socket.remoteAddress ?? 'unknown');
  const me = (c: Ctx) => c.user!.customerId;

  // ---------- health
  on('GET', '/healthz', 'public', async () => ({ ok: true }));

  // ---------- auth
  on('POST', '/api/auth/register', 'public', async (c) => {
    loginLimiter.check(ip(c));
    const id = await app.auth.register({
      email: str(c.body.email, 'Email', 200), password: str(c.body.password, 'Password', 200), name: str(c.body.name, 'Name', 120),
      accountType: c.body.accountType === 'business' ? 'business' : 'personal', company: c.body.company, phone: c.body.phone,
    });
    return { id };
  });
  on('POST', '/api/auth/login', 'public', async (c) => {
    loginLimiter.check(ip(c));
    const { token, principal } = await app.auth.login(str(c.body.email, 'Email'), str(c.body.password, 'Password'));
    c.res.setHeader('Set-Cookie', `kg_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}`);
    return { token, role: principal.role };
  });
  on('POST', '/api/auth/logout', 'customer', async (c) => {
    const t = tokenFrom(c.req);
    if (t) await app.auth.logout(t);
    c.res.setHeader('Set-Cookie', 'kg_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    return { ok: true };
  });

  // ---------- quotes & booking
  /** Homepage prices without signing in. No tokens: booking needs a signed-in quote. */
  on('POST', '/api/quotes/preview', 'public', async (c) => {
    quoteLimiter.check(ip(c));
    const { quotes, failures } = await app.quotes.quote('anonymous', c.body as ShipmentRequest);
    return { quotes: quotes.map(({ token: _t, ...q }) => q), failures: failures.length };
  });
  on('GET', '/api/me', 'customer', async (c) => {
    const u = await app.db.get<Record<string, unknown>>(
      'SELECT id, email, name, company, phone, account_type, role, bookings_paused, default_payment_method IS NOT NULL AS has_card FROM customers WHERE id = $1', [me(c)]);
    return { ...u, demoPayments: app.payments instanceof FakeGateway };
  });
  on('PUT', '/api/me', 'customer', async (c) => {
    const sets: string[] = []; const vals: (string | null)[] = [];
    for (const k of ['name', 'phone', 'company'] as const) {
      if (typeof c.body[k] === 'string') {
        const v = c.body[k].trim().slice(0, 120);
        if (k === 'name' && !v) throw new AppError('bad_request', 'Name is required');
        vals.push(v || null); sets.push(`${k} = $${vals.length}`);
      }
    }
    if (sets.length) { vals.push(me(c)); await app.db.run(`UPDATE customers SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals); }
    return { ok: true };
  });
  /** Test mode only: simulate a successful Stripe top-up so the wallet can be tried end to end. */
  on('POST', '/api/dev/topup', 'customer', async (c) => {
    if (!(app.payments instanceof FakeGateway)) throw new AppError('forbidden', 'Only available in test mode');
    const amount = Number(c.body.amountPence);
    if (!Number.isSafeInteger(amount) || amount < 500 || amount > 50_000) throw new AppError('bad_request', 'Between £5 and £500 in test mode');
    const pi = await app.payments.createPaymentIntent({ amount, customerStripeId: null, metadata: { purpose: 'topup', customer_id: me(c) }, idempotencyKey: `devtopup:${Date.now()}`, saveCard: false });
    await app.webhooks.stripe({ id: `evt_dev_${pi.id}`, type: 'payment_intent.succeeded', data: { object: { id: pi.id, amount_received: amount, metadata: { purpose: 'topup', customer_id: me(c) } } } });
    return { balancePence: await app.wallet.balance(me(c)) };
  });
  on('POST', '/api/quotes', 'customer', async (c) => {
    quoteLimiter.check(me(c));
    const cust = await app.db.get<{ pricing_discount_bp: number }>('SELECT pricing_discount_bp FROM customers WHERE id = $1', [me(c)]);
    return app.quotes.quote(me(c), c.body as ShipmentRequest, cust?.pricing_discount_bp ?? 0);
  });
  on('POST', '/api/bookings', 'customer', async (c) => {
    const payWith = c.body.payWith === 'card' ? 'card' : 'wallet';
    const key = String(c.req.headers['idempotency-key'] ?? '');
    return app.bookings.book({ customerId: me(c), quoteToken: str(c.body.quoteToken, 'quoteToken', 20_000), payWith, idempotencyKey: key });
  });
  on('GET', '/api/shipments', 'customer', async (c) => ({ shipments: await app.bookings.listForCustomer(me(c)) }));
  on('GET', '/api/shipments/:id', 'customer', async (c) => {
    const s = await app.bookings.get(c.params.id!);
    if (s.customer_id !== me(c)) throw new AppError('not_found', 'Shipment not found');
    const events = await app.db.all('SELECT status, description, occurred_at FROM tracking_events WHERE shipment_id = $1 ORDER BY occurred_at DESC', [s.id]);
    return { shipment: s, events };
  });

  // ---------- wallet
  on('GET', '/api/wallet', 'customer', async (c) => ({ balancePence: await app.wallet.balance(me(c)), statement: await app.wallet.statement(me(c)) }));
  on('POST', '/api/wallet/topups', 'customer', async (c) => {
    const amount = typeof c.body.amountPence === 'number' ? c.body.amountPence : parseGbp(String(c.body.amount ?? ''));
    if (!Number.isSafeInteger(amount) || amount < 500 || amount > 500_000) throw new AppError('bad_request', 'Top up between £5 and £5,000');
    const cust = await app.db.get<{ stripe_customer_id: string | null; email: string; name: string }>('SELECT stripe_customer_id, email, name FROM customers WHERE id = $1', [me(c)]);
    let stripeId = cust?.stripe_customer_id ?? null;
    if (!stripeId && cust) {
      stripeId = (await app.payments.createCustomer({ email: cust.email, name: cust.name, idempotencyKey: `cus:${me(c)}` })).id;
      await app.db.run('UPDATE customers SET stripe_customer_id = $1 WHERE id = $2', [stripeId, me(c)]);
    }
    const key = String(c.req.headers['idempotency-key'] ?? `${Date.now()}`);
    return app.payments.createPaymentIntent({ amount, customerStripeId: stripeId, metadata: { purpose: 'topup', customer_id: me(c) }, idempotencyKey: `topup:${me(c)}:${key}`, saveCard: true });
  });

  // ---------- weight adjustments (customer)
  on('GET', '/api/adjustments', 'customer', async (c) => ({ adjustments: await app.adjustments.listForCustomer(me(c)) }));
  on('POST', '/api/adjustments/:id/dispute', 'customer', async (c) => app.adjustments.dispute(c.params.id!, me(c)));

  // ---------- help (customer)
  on('GET', '/api/tickets', 'customer', async (c) => ({ tickets: await app.support.listForCustomer(me(c)) }));
  on('POST', '/api/tickets', 'customer', async (c) => {
    const category = c.body.category as Category;
    if (!CATEGORIES.includes(category)) throw new AppError('bad_request', 'Pick a topic');
    return app.support.open({ customerId: me(c), category, subject: str(c.body.subject, 'Subject', 140), body: str(c.body.body, 'Message', 10_000), shipmentId: c.body.shipmentId ?? null });
  });
  on('GET', '/api/tickets/:id', 'customer', async (c) => app.support.threadForCustomer(c.params.id!, me(c)));
  on('POST', '/api/tickets/:id/messages', 'customer', async (c) => (await app.support.customerReply(c.params.id!, me(c), str(c.body.body, 'Message', 10_000)), { ok: true }));
  on('POST', '/api/tickets/:id/solve', 'customer', async (c) => (await app.support.customerSetSolved(c.params.id!, me(c), true), { ok: true }));
  on('POST', '/api/tickets/:id/reopen', 'customer', async (c) => (await app.support.customerSetSolved(c.params.id!, me(c), false), { ok: true }));

  // ---------- admin
  on('GET', '/api/admin/overview', 'admin', async (c) => app.admin.overview(Number(c.query.get('days') ?? 30)));
  on('GET', '/api/admin/shipments', 'admin', async (c) => ({ shipments: await app.admin.shipments({ status: c.query.get('status') ?? undefined }) }));
  on('GET', '/api/admin/customers', 'admin', async (c) => ({ customers: await app.admin.customers(c.query.get('q') ?? undefined) }));
  on('GET', '/api/admin/customers/:id', 'admin', async (c) => app.admin.customerProfile(c.params.id!));
  on('POST', '/api/admin/customers/:id/pause', 'admin', async (c) => {
    await app.db.run('UPDATE customers SET bookings_paused = $1 WHERE id = $2', [c.body.paused ? 1 : 0, c.params.id!]);
    return { ok: true };
  });
  on('POST', '/api/admin/customers/:id/credit', 'admin', async (c) => {
    const amount = parseGbp(String(c.body.amount ?? ''));
    await app.wallet.credit(c.params.id!, amount, `admincredit:${c.params.id}:${String(c.req.headers['idempotency-key'] ?? Date.now())}`, str(c.body.reason, 'Reason', 300));
    return { ok: true };
  });
  on('GET', '/api/admin/adjustments', 'admin', async (c) => ({ adjustments: await app.adjustments.listAll((c.query.get('status') as never) ?? undefined) }));
  on('POST', '/api/admin/adjustments/:id/charge', 'admin', async (c) => app.adjustments.collect(c.params.id!));
  on('POST', '/api/admin/adjustments/:id/waive', 'admin', async (c) => app.adjustments.waive(c.params.id!));
  /** Measurements that arrive outside webhooks (carrier invoice import, manual entry). */
  on('POST', '/api/admin/measurements', 'admin', async (c) => {
    const items = Array.isArray(c.body.items) ? c.body.items : [c.body];
    const out = [];
    for (const m of items) {
      out.push(await app.adjustments.handleMeasurement({
        eventId: str(m.eventId, 'eventId', 200), trackingNumber: str(m.trackingNumber, 'trackingNumber', 100),
        measured: { weightGrams: Number(m.weightGrams), lengthCm: Number(m.lengthCm), widthCm: Number(m.widthCm), heightCm: Number(m.heightCm) },
        providerSurchargePence: m.surchargePence == null ? null : Number(m.surchargePence),
      }));
    }
    return { adjustments: out };
  });
  on('GET', '/api/admin/tickets', 'admin', async (c) => ({ tickets: await app.support.queue((c.query.get('status') as TicketStatus) ?? undefined) }));
  on('GET', '/api/admin/tickets/:id', 'admin', async (c) => app.support.threadForAgent(c.params.id!));
  on('POST', '/api/admin/tickets/:id/reply', 'admin', async (c) => {
    const next = ['waiting_us', 'waiting_customer', 'solved'].includes(c.body.nextStatus) ? (c.body.nextStatus as TicketStatus) : undefined;
    await app.support.agentReply(c.params.id!, me(c), str(c.body.body, 'Message', 10_000), { internal: Boolean(c.body.internal), ...(next ? { nextStatus: next } : {}) });
    return { ok: true };
  });
  on('GET', '/api/admin/finance', 'admin', async () => app.admin.finance());
  on('GET', '/api/admin/ledger', 'admin', async () => ({ entries: await app.admin.ledgerEntries(100) }));
  /** Live provider costs for a typical 2 kg UK parcel, so the pricing screen shows real margins. */
  on('GET', '/api/admin/pricing/preview', 'admin', async () => {
    const req = { from: { name: 'A', line1: '1 St', city: 'Manchester', postcode: 'M1 1AE', country: 'GB' }, to: { name: 'B', line1: '1 St', city: 'Leeds', postcode: 'LS1 5HD', country: 'GB' },
      parcel: { weightGrams: 2000, lengthCm: 30, widthCm: 20, heightCm: 15 } };
    const out: Array<{ provider: string; carrier: string; serviceCode: string; serviceName: string; cost: number }> = [];
    for (const p of app.registry.all()) {
      try { for (const r of await p.getRates(req, AbortSignal.timeout(8000))) out.push({ provider: p.id, carrier: r.carrier, serviceCode: r.serviceCode, serviceName: r.serviceName, cost: r.cost }); } catch { /* skip */ }
    }
    return { services: out.sort((a, b) => a.cost - b.cost), rules: await app.pricing.list() };
  });
  on('GET', '/api/admin/providers', 'admin', async () => ({ providers: await app.registry.describe(), live: app.registry.all().map((p) => p.id), demoPayments: app.payments instanceof FakeGateway }));
  on('PUT', '/api/admin/providers/:id', 'admin', async (c) => {
    await app.registry.save(c.params.id!, { mode: c.body.mode === 'live' ? 'live' : 'test', enabled: Boolean(c.body.enabled), secrets: c.body.secrets ?? {} });
    return { providers: await app.registry.describe() };
  });
  on('POST', '/api/admin/providers/:id/test', 'admin', async (c) => {
    const p = app.registry.get(c.params.id!);
    if (!p) throw new AppError('not_found', 'Save and enable this connection first');
    const started = Date.now();
    const rates = await p.getRates(
      {
        from: { name: 'Test', line1: '1 Test St', city: 'Manchester', postcode: 'M1 1AE', country: 'GB' },
        to: { name: 'Test', line1: '1 Test St', city: 'Leeds', postcode: 'LS1 5HD', country: 'GB' },
        parcel: { weightGrams: 1000, lengthCm: 20, widthCm: 15, heightCm: 10 },
      },
      AbortSignal.timeout(10_000),
    );
    return { ok: true, ms: Date.now() - started, rates: rates.length, carriers: [...new Set(rates.map((r) => r.carrierName))] };
  });
  on('GET', '/api/admin/pricing', 'admin', async () => ({ rules: await app.pricing.list() }));
  on('PUT', '/api/admin/pricing/:key', 'admin', async (c) => {
    const markupBp = Number(c.body.markupBp), fixedPence = Number(c.body.fixedPence);
    if (!Number.isInteger(markupBp) || markupBp < 0 || markupBp > 10_000 || !Number.isInteger(fixedPence) || fixedPence < 0) throw new AppError('bad_request', 'Invalid rule');
    await app.pricing.set(decodeURIComponent(c.params.key!), { markupBp, fixedPence });
    return { rules: await app.pricing.list() };
  });

  // ---------- webhooks
  on('POST', '/webhooks/stripe', 'webhook', async (c) => {
    if (!app.config.stripeWebhookSecret) throw new AppError('forbidden', 'Stripe webhooks are not configured');
    verifyStripeSignature(c.raw, c.req.headers['stripe-signature'] as string | undefined, app.config.stripeWebhookSecret, Math.floor(app.clock.now().getTime() / 1000));
    await app.webhooks.stripe(JSON.parse(c.raw));
    return { received: true };
  });
  on('POST', '/webhooks/carrier/:provider/:token', 'webhook', async (c) => {
    const a = Buffer.from(c.params.token ?? '');
    const b = Buffer.from(app.config.carrierWebhookToken);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError('unauthorized', 'Bad webhook token');
    const provider = app.registry.get(c.params.provider!);
    if (!provider) throw new AppError('not_found', 'Unknown provider');
    const events = await provider.parseWebhook(c.req.headers as Record<string, string | undefined>, c.raw);
    await app.webhooks.carrier(provider.id, events);
    return { received: events.length };
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const url = new URL(req.url ?? '/', 'http://local');
      const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
      if (!route) {
        if (await serveStatic(req, res, url.pathname)) return;
        throw new AppError('not_found', 'Not found');
      }
      const m = route.pattern.exec(url.pathname)!;
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
      const raw = req.method === 'GET' ? '' : await readBody(req);
      let body: any = {};
      if (raw && route.access !== 'webhook') {
        try { body = JSON.parse(raw); } catch { throw new AppError('bad_request', 'Body must be JSON'); }
      }
      let user: Principal | null = null;
      if (route.access === 'customer' || route.access === 'admin') {
        user = await app.auth.authenticate(tokenFrom(req));
        if (route.access === 'admin' && user.role !== 'admin') throw new AppError('forbidden', 'Admins only');
        // Cookie-authenticated writes must come from our own pages (CSRF).
        if (req.method !== 'GET' && !req.headers.authorization && req.headers['x-requested-with'] !== 'kargom') {
          throw new AppError('forbidden', 'Missing X-Requested-With header');
        }
      }
      const out = await route.handler({ req, res, params, query: url.searchParams, raw, body, user });
      send(res, 200, out);
    } catch (e) {
      if (isAppError(e)) return send(res, e.status, { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });
      console.error('[unhandled]', e);
      send(res, 500, { error: { code: 'internal', message: 'Something went wrong. We have been notified.' } });
    }
  }

  return { handle, routes };
}

function tokenFrom(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  const cookie = req.headers.cookie ?? '';
  return /(?:^|;\s*)kg_session=([^;]+)/.exec(cookie)?.[1];
}

export function startServer(app: App, port: number) {
  const { handle } = buildRouter(app);
  const server = createServer((req, res) => void handle(req, res));
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  return new Promise<typeof server>((resolve) => server.listen(port, () => resolve(server)));
}
