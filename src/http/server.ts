import { readdirSync } from 'node:fs';
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
import { serveSeo } from '../seo/routes.ts';
import { seoPricesFor } from '../seo/prices.ts';
import { FakeGateway } from '../payments/stripe.ts';
import { AddressLookup } from '../address/lookup.ts';
import { addressFromImage, addressFromText } from '../address/fromImage.ts';
import { chatTurn } from '../chat/agent.ts';
import { GuestCheckout } from '../guest/guest.ts';
import { routeInfo } from '../market/route.ts';
import { placeLogo } from '../market/places.ts';
import { freightRates, parseFreightQuery } from '../freight/rates.ts';
import { freightForwarders } from '../freight/forwarders.ts';
import { forwardingEstimate, joinForwardingWaitlist } from '../forwarding/forwarding.ts';
import { eurosenderTestOrder } from '../freight/eurosender.ts';
import type { PacklinkProvider } from '../providers/packlink.ts';

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

const MAX_BODY = 5_000_000; // request photos are sent inline (resized in the browser)

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
/** Public address of the site for Stripe's return links (PUBLIC_URL wins, e.g. https://kargom.eu). */
function siteBase(req: IncomingMessage): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost');
  const proto = String(req.headers['x-forwarded-proto'] ?? (host.startsWith('localhost') ? 'http' : 'https')).split(',')[0];
  return `${proto}://${host}`;
}

/**
 * Public price search: same route + parcel within 6 hours is answered from memory,
 * because carrier prices do not move that fast. Booking always re-quotes live with
 * the real addresses, so the price charged is never a stale one.
 */
const PREVIEW_TTL_MS = Number(process.env.PREVIEW_CACHE_HOURS ?? 6) * 3600_000;
const previewKey = (r: ShipmentRequest) => JSON.stringify([String(r?.from?.postcode ?? '').toUpperCase().replace(/\s+/g, ''), r?.from?.country, String(r?.to?.postcode ?? '').toUpperCase().replace(/\s+/g, ''), r?.to?.country,
  r?.parcel?.weightGrams, r?.parcel?.lengthCm, r?.parcel?.widthCm, r?.parcel?.heightCm, r?.customs ?? null]);
const previewCache = new Map<string, { at: number; value: { quotes: unknown[]; failures: number } }>();
const previewInFlight = new Map<string, Promise<{ quotes: unknown[]; failures: number }>>();
/**
 * Homepage "Watch our video". Either:
 *  - a video file put in public/assets/video/ (mp4 is best; the first one found is used), or
 *  - HOME_VIDEO_URL: a YouTube link (any form) or a direct https video link (overrides the file).
 */
let videoCache: { at: number; file: string | null } = { at: 0, file: null };
function videoFile(): string | null {
  if (Date.now() - videoCache.at < 60_000) return videoCache.file;
  let file: string | null = null;
  // Look in public/assets/video/ (any capitalisation), then in public/assets/ itself. mp4 first.
  const assets = new URL('../../public/assets/', import.meta.url);
  const isVid = (n: string) => /\.(mp4|webm|mov|m4v)$/i.test(n);
  const order = (a: string, b: string) => Number(!/\.mp4$/i.test(a)) - Number(!/\.mp4$/i.test(b)) || a.localeCompare(b);
  try {
    const entries = readdirSync(assets, { withFileTypes: true });
    for (const d of entries.filter((e) => e.isDirectory() && e.name.toLowerCase() === 'video')) {
      const names = readdirSync(new URL(`${d.name}/`, assets)).filter(isVid).sort(order);
      if (names[0]) { file = `/assets/${d.name}/${encodeURIComponent(names[0])}`; break; }
    }
    if (!file) {
      const names = entries.filter((e) => e.isFile() && isVid(e.name)).map((e) => e.name).sort(order);
      if (names[0]) file = `/assets/${encodeURIComponent(names[0])}`;
    }
  } catch { /* no assets folder */ }
  videoCache = { at: Date.now(), file };
  return file;
}
function homeVideo(): { kind: 'youtube' | 'file'; src: string } | null {
  const u = (process.env.HOME_VIDEO_URL ?? '').trim();
  if (u) {
    const yt = u.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/);
    if (yt) return { kind: 'youtube', src: `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&rel=0&modestbranding=1&playsinline=1` };
    if (/^(https:\/\/|\/assets\/)[^\s"'<>]+$/i.test(u)) return { kind: 'file', src: u };
  }
  const f = videoFile();
  return f ? { kind: 'file', src: f } : null;
}

export async function previewQuotes(app: App, req: ShipmentRequest) {
  const key = previewKey(req);
  const hit = previewCache.get(key);
  if (hit && Date.now() - hit.at < PREVIEW_TTL_MS) return { ...hit.value, cached: true };
  // Ten people searching the same route at once share one carrier round trip.
  let p = previewInFlight.get(key);
  if (!p) {
    p = app.quotes.quote('anonymous', req).then(({ quotes, failures }) => {
      const value = { quotes: quotes.map(({ token: _t, ...q }) => q), failures: failures.length };
      if (quotes.length) {
        previewCache.set(key, { at: Date.now(), value });
        if (previewCache.size > 5000) previewCache.delete(previewCache.keys().next().value!);
      }
      return value;
    }).finally(() => previewInFlight.delete(key));
    previewInFlight.set(key, p);
  }
  return { ...(await p), cached: false };
}

/** The homepage's most common searches, priced in the background so the first visitor waits for nothing. */
export async function warmPreviewCache(app: App) {
  let n = 0;
  const dims = { lengthCm: 30, widthCm: 20, heightCm: 15 };
  for (const kg of [0.5, 1, 2, 3, 5, 10, 15, 20]) {
    const req = { from: { name: 'Quote', line1: 'Quote', city: 'Quote', postcode: 'EC1A 1BB', country: 'GB' },
      to: { name: 'Quote', line1: 'Quote', city: 'Quote', postcode: 'M1 1AE', country: 'GB' }, parcel: { weightGrams: Math.round(kg * 1000), ...dims } };
    try {
      // Refresh in place: visitors keep getting the old prices until the new ones are in.
      const { quotes, failures } = await app.quotes.quote('anonymous', req);
      if (quotes.length) { previewCache.set(previewKey(req), { at: Date.now(), value: { quotes: quotes.map(({ token: _t, ...q }) => q), failures: failures.length } }); n++; }
    } catch { /* next time */ }
  }
  return n;
}

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
  const addressLimiter = new RateLimiter(30, 60_000);
  const addresses = new AddressLookup(process.env.IDEAL_POSTCODES_API_KEY);
  const guest = new GuestCheckout(app);
  const guestLimiter = new RateLimiter(12, 60_000);
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
    const partner = await app.market.partnerOf(principal.customerId);
    return { token, role: principal.role, partner: Boolean(partner) };
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
    return previewQuotes(app, c.body as ShipmentRequest);
  });
  // ---------- guest checkout (no account)
  /** Payment settings the guest page needs (the publishable key is public by design). */
  on('GET', '/api/guest/config', 'public', async () => {
    const demo = app.payments instanceof FakeGateway;
    return { demoPayments: demo, stripePk: demo ? null : process.env.STRIPE_PUBLISHABLE_KEY ?? null, addressList: addresses.hasAddressList, notify: app.notifier.enabled, homeVideo: homeVideo(), chat: Boolean(process.env.ANTHROPIC_API_KEY) };
  });
  on('POST', '/api/guest/book', 'public', async (c) => {
    guestLimiter.check(ip(c));
    if (c.req.headers['x-requested-with'] !== 'kargom') throw new AppError('forbidden', 'Missing X-Requested-With header');
    const b = c.body;
    return guest.book({ email: b.email, name: b.name, from: b.from, to: b.to, parcel: b.parcel, contents: b.contents, valuePence: Number(b.valuePence) || 0,
      carrier: String(b.carrier ?? ''), serviceCode: String(b.serviceCode ?? ''), expectedPricePence: Number(b.expectedPricePence) || 0,
      idempotencyKey: String(c.req.headers['idempotency-key'] ?? '') || String(Date.now()),
      // Stripe is on but the publishable key is missing: fall back to Stripe's hosted page so nobody is blocked.
      ...(!(app.payments instanceof FakeGateway) && !process.env.STRIPE_PUBLISHABLE_KEY ? { hostedReturnBase: siteBase(c.req) } : {}) });
  });
  /** "Chat with me": the booking assistant. It fills a draft; the customer pays through /api/guest/book. */
  const chatLimiter = new RateLimiter(30, 60_000);
  on('POST', '/api/chat', 'public', async (c) => {
    chatLimiter.check(ip(c));
    const q = (pc: string) => ({ name: 'Quote', line1: 'Quote', city: 'Quote', postcode: pc, country: 'GB' });
    return chatTurn(c.body?.messages, c.body?.draft, {
      quote: async (r) => (await previewQuotes(app, { from: q(r.from.postcode), to: q(r.to.postcode), parcel: r.parcel } as ShipmentRequest)).quotes
        .map((x: any) => ({ carrier: x.carrier, carrierName: x.carrierName, serviceCode: x.serviceCode, serviceName: x.serviceName, pricePence: x.price, transitDays: x.transitDays, dropOff: x.dropOff })),
      lookup: (pc) => addresses.byPostcode(pc),
    });
  });
  on('GET', '/api/guest/address', 'public', async (c) => {
    guestLimiter.check(ip(c));
    return { ...(await addresses.byPostcode(c.query.get('postcode') ?? '')), fullList: addresses.hasAddressList };
  });
  on('GET', '/api/guest/label/:token', 'public', async (c) => guest.view(c.params.token!));
  on('POST', '/api/guest/demo-pay/:token', 'public', async (c) => guest.demoPay(c.params.token!));
  /** Test mode only: the test payment sheet marks a card booking as paid. */
  on('POST', '/api/dev/card-paid/:id', 'customer', async (c) => {
    if (!(app.payments instanceof FakeGateway)) throw new AppError('forbidden', 'Only available in test mode');
    const s = await app.bookings.get(c.params.id!);
    if (s.customer_id !== me(c)) throw new AppError('not_found', 'Shipment not found');
    if (s.status === 'awaiting_payment') {
      await app.webhooks.stripe({ id: `evt_demo_${s.id}`, type: 'payment_intent.succeeded',
        data: { object: { id: s.payment_ref ?? `pi_fake_${s.id}`, amount_received: s.price_pence, metadata: { purpose: 'booking', shipment_id: s.id, customer_id: s.customer_id } } } });
    }
    return { status: (await app.bookings.get(s.id)).status };
  });
  on('GET', '/api/guest/label/:token/pdf', 'public', async (c) => {
    const pdf = await guest.labelPdf(c.params.token!);
    c.res.writeHead(200, {
      'Content-Type': 'application/pdf', 'Content-Length': String(pdf.length),
      'Content-Disposition': `${c.query.get('download') ? 'attachment' : 'inline'}; filename="kargom-label.pdf"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    });
    c.res.end(pdf);
    return null;
  });
  on('GET', '/api/me', 'customer', async (c) => {
    const u = await app.db.get<Record<string, unknown>>(
      'SELECT id, email, name, company, phone, account_type, role, bookings_paused, default_payment_method IS NOT NULL AS has_card FROM customers WHERE id = $1', [me(c)]);
    const demo = app.payments instanceof FakeGateway;
    // The publishable key is public by design; the card form on our pages needs it.
    const partner = await app.market.partnerOf(me(c));
    return { ...u, partner: partner ? { id: partner.id, kind: partner.kind, company: partner.company } : null, demoPayments: demo, stripePk: demo ? null : process.env.STRIPE_PUBLISHABLE_KEY ?? null, notify: app.notifier.enabled };
  });

  /* ---------- moving & freight requests ---------- */
  const marketLimiter = new RateLimiter(20, 60_000);
  const image = (c: Ctx, img: { type: string; data: Buffer }, cache: string) => {
    c.res.writeHead(200, { 'Content-Type': img.type, 'Content-Length': String(img.data.length), 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
    c.res.end(img.data);
    return null;
  };
  on('GET', '/api/market/config', 'public', async () => ({
    mapsEmbedKey: process.env.GOOGLE_MAPS_EMBED_KEY ?? null, addressList: addresses.hasAddressList,
  }));
  on('GET', '/api/route', 'customer', async (c) => {
    marketLimiter.check(me(c));
    const q = c.query;
    return routeInfo({ postcode: str(q.get('from'), 'From', 12), country: (q.get('fc') ?? 'GB').toUpperCase() }, { postcode: str(q.get('to'), 'To', 12), country: (q.get('tc') ?? 'GB').toUpperCase() });
  });
  on('POST', '/api/jobs', 'customer', async (c) => { marketLimiter.check(me(c)); return app.market.createJob(me(c), c.body); });
  on('GET', '/api/jobs', 'customer', async (c) => ({ jobs: await app.market.listJobs(me(c)) }));
  on('GET', '/api/jobs/:id', 'customer', async (c) => app.market.customerJob(me(c), c.params.id!));
  on('GET', '/api/jobs/:id/partners', 'customer', async (c) => app.market.nearbyPartners(me(c), c.params.id!));
  const sendPdf = (c: Ctx, r: { ref: number; pdf: Buffer }, download: boolean) => {
    c.res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': String(r.pdf.length), 'Cache-Control': 'private, no-store',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="kargom-request-${r.ref}.pdf"`, 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' });
    c.res.end(r.pdf);
    return null;
  };
  on('GET', '/api/jobs/:id/pdf', 'customer', async (c) => sendPdf(c, await app.market.customerPdf(me(c), c.params.id!), Boolean(c.query.get('download'))));
  on('GET', '/r/:token', 'public', async (c) => sendPdf(c, await app.market.sharedPdf(c.params.token!.replace(/\.pdf$/, '')), false));
  const publicLimiter = new RateLimiter(15, 60_000);
  on('GET', '/api/public/movers', 'public', async (c) => { publicLimiter.check(ip(c)); return app.market.publicNearby(c.query.get('from'), c.query.get('kind') ?? 'removals', undefined, c.query.get('to'), c.query.get('size')); });
  /** Admin check: does our Packlink account return pallet / heavy freight services? Open /api/admin/packlink-test in the browser. */
  on('GET', '/api/admin/packlink-test', 'admin', async () => {
    const pl = app.registry.all().find((p) => p.id === 'packlink') as unknown as { rawServices?: PacklinkProvider['rawServices'] } | undefined;
    if (!pl?.rawServices) return { ok: false, error: 'Packlink is not connected (no PACKLINK_API_KEY and no Packlink connection in Admin → Connections)' };
    const pallet = { weight: 300, length: 120, width: 100, height: 150 };
    const cases: Array<[string, { country: string; zip: string }, { country: string; zip: string }, typeof pallet[]]> = [
      ['UK→UK · 1 pallet 300 kg', { country: 'GB', zip: 'M1 1AE' }, { country: 'GB', zip: 'B8 1AA' }, [pallet]],
      ['UK→UK · 2 pallets', { country: 'GB', zip: 'M1 1AE' }, { country: 'GB', zip: 'B8 1AA' }, [pallet, pallet]],
      ['UK→UK · half pallet 150 kg', { country: 'GB', zip: 'M1 1AE' }, { country: 'GB', zip: 'LS1 5HD' }, [{ weight: 150, length: 120, width: 100, height: 80 }]],
      ['UK→Germany · 1 pallet 300 kg', { country: 'GB', zip: 'M1 1AE' }, { country: 'DE', zip: '10115' }, [pallet]],
      ['UK→France · heavy box 70 kg', { country: 'GB', zip: 'M1 1AE' }, { country: 'FR', zip: '75001' }, [{ weight: 70, length: 80, width: 60, height: 60 }]],
    ];
    const out = [];
    for (const [name, from, to, pk] of cases) {
      try {
        const list = await pl.rawServices(from, to, pk);
        out.push({ case: name, found: list.length, services: list.map((s) => ({ carrier: s.carrier_name, service: s.name, category: s.category ?? null, price: s.price?.base_price ?? s.price?.total_price ?? null, currency: s.currency ?? null, days: s.transit_time ?? s.transit_hours ?? null, collection: !s.dropoff })) });
      } catch (e) { out.push({ case: name, error: (e as Error).message }); }
    }
    return { ok: true, results: out };
  });
  /** Admin, sandbox only: place Eurosender test orders so they can review us. Open /api/admin/eurosender-test (a small parcel, Paris → Berlin; ?kind=pallet for a pallet). */
  on('GET', '/api/admin/eurosender-test', 'admin', async (c) => eurosenderTestOrder(c.query.get('kind') === 'pallet' ? 'pallet' : 'package', {
    name: 'Kargom Test', email: process.env.EUROSENDER_CONTACT_EMAIL || 'orders@kargom.co.uk', phone: process.env.EUROSENDER_CONTACT_PHONE || '+447700900123',
  }));
  const freightLimiter = new RateLimiter(12, 60_000);
  on('GET', '/api/forwarding/estimate', 'public', async (c) => { freightLimiter.check(ip(c)); return forwardingEstimate(c.query.get('from'), c.query.get('to'), c.query.get('kg')); });
  on('POST', '/api/forwarding/waitlist', 'public', async (c) => { publicLimiter.check(ip(c)); return joinForwardingWaitlist(app.db, c.body ?? {}, c.user?.customerId ?? null, new Date().toISOString()); });
  on('GET', '/api/freight/forwarders', 'public', async (c) => { publicLimiter.check(ip(c)); return freightForwarders(c.query.get('place'), c.query.get('country'), Boolean(c.user)); });
  on('GET', '/api/freight/rates', 'public', async (c) => { freightLimiter.check(ip(c)); return freightRates(parseFreightQuery(c.query)); });
  on('GET', '/api/gplace/:id/logo', 'public', async (c) => {
    const img = await placeLogo(c.params.id!);
    if (!img) throw new AppError('not_found', 'No logo');
    return image(c, img, 'public, max-age=604800');
  });
  on('GET', '/api/jobs/:id/google', 'customer', async (c) => { marketLimiter.check(me(c)); return app.market.googleNearby(me(c), c.params.id!); });
  on('POST', '/api/jobs/:id/invite', 'customer', async (c) => app.market.invite(me(c), c.params.id!, c.body));
  on('GET', '/api/admin/partner-invites', 'admin', async () => ({ invites: await app.market.adminInvites() }));
  on('POST', '/api/jobs/:id/cancel', 'customer', async (c) => app.market.cancelJob(me(c), c.params.id!));
  on('POST', '/api/jobs/:id/offers/:offer/accept', 'customer', async (c) => app.market.acceptOffer(me(c), c.params.id!, c.params.offer!));
  on('POST', '/api/jobs/:id/review', 'customer', async (c) => app.market.review(me(c), c.params.id!, c.body.rating, c.body.comment));
  on('GET', '/api/jobs/:id/photos/:photo', 'customer', async (c) => image(c, await app.market.photo(me(c), c.params.id!, c.params.photo!), 'private, max-age=86400'));
  on('GET', '/api/partners/:id', 'public', async (c) => app.market.profile(c.params.id!));
  on('GET', '/api/partners/:id/logo', 'public', async (c) => image(c, await app.market.logo(c.params.id!), 'public, max-age=86400'));
  on('POST', '/api/partner/register', 'public', async (c) => {
    loginLimiter.check(ip(c));
    const b = c.body;
    await app.market.registerPartner({ email: str(b.email, 'Email', 200), password: str(b.password, 'Password', 200), name: str(b.name, 'Your name', 120),
      company: str(b.company, 'Company name', 120), phone: str(b.phone, 'Phone', 40), kind: str(b.kind, 'Type', 20), basePostcode: typeof b.basePostcode === 'string' ? b.basePostcode : undefined });
    const { token } = await app.auth.login(str(b.email, 'Email'), str(b.password, 'Password'));
    c.res.setHeader('Set-Cookie', `kg_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}`);
    return { ok: true };
  });
  on('GET', '/api/partner/me', 'customer', async (c) => {
    const p = await app.market.requirePartner(me(c));
    return { profile: await app.market.profile(p.id, true), stats: await app.market.partnerStats(me(c)) };
  });
  on('PUT', '/api/partner/profile', 'customer', async (c) => app.market.updateProfile(me(c), c.body));
  on('PUT', '/api/partner/logo', 'customer', async (c) => app.market.setLogo(me(c), c.body.logo ?? null));
  on('GET', '/api/partner/requests', 'customer', async (c) => ({ requests: await app.market.partnerFeed(me(c), c.query.get('filter') ?? 'open') }));
  on('GET', '/api/partner/requests/:id', 'customer', async (c) => app.market.partnerJob(me(c), c.params.id!));
  on('POST', '/api/partner/requests/:id/offer', 'customer', async (c) => app.market.makeOffer(me(c), c.params.id!, c.body));
  on('POST', '/api/partner/requests/:id/withdraw', 'customer', async (c) => app.market.withdrawOffer(me(c), c.params.id!));
  on('GET', '/api/admin/partners', 'admin', async () => ({ partners: await app.market.adminPartners() }));
  on('POST', '/api/admin/partners/:id/status', 'admin', async (c) => app.market.adminSetPartnerStatus(c.params.id!, c.body.status));
  /** UK postcode → delivery addresses. Signed-in only, so strangers cannot spend our lookup credits. */
  const photoLimiter = new RateLimiter(10, 60_000);
  on('POST', '/api/address/from-image', 'public', async (c) => { photoLimiter.check(ip(c)); return addressFromImage(c.body?.image); });
  on('POST', '/api/address/from-text', 'public', async (c) => { photoLimiter.check(ip(c)); return addressFromText(c.body?.text); });
  on('GET', '/api/address/lookup', 'customer', async (c) => {
    addressLimiter.check(me(c));
    return { ...(await addresses.byPostcode(c.query.get('postcode') ?? '')), fullList: addresses.hasAddressList };
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
    return app.bookings.book({ customerId: me(c), quoteToken: str(c.body.quoteToken, 'quoteToken', 20_000), payWith, idempotencyKey: key,
      // 'hosted' = Stripe's own page; default is the card form on our page.
      ...(c.body.flow === 'hosted' ? { returnBase: siteBase(c.req) } : {}) });
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
  /** Wallet top-up on Stripe's hosted payment page. */
  on('POST', '/api/wallet/checkout', 'customer', async (c) => {
    const amount = Number(c.body.amountPence);
    if (!Number.isSafeInteger(amount) || amount < 500 || amount > 500_000) throw new AppError('bad_request', 'Top up between £5 and £5,000');
    const cust = await app.db.get<{ stripe_customer_id: string | null; email: string; name: string }>('SELECT stripe_customer_id, email, name FROM customers WHERE id = $1', [me(c)]);
    let stripeId = cust?.stripe_customer_id ?? null;
    if (!stripeId && cust) {
      stripeId = (await app.payments.createCustomer({ email: cust.email, name: cust.name, idempotencyKey: `cus:${me(c)}` })).id;
      await app.db.run('UPDATE customers SET stripe_customer_id = $1 WHERE id = $2', [stripeId, me(c)]);
    }
    const key = String(c.req.headers['idempotency-key'] ?? `${Date.now()}`).slice(0, 100);
    const base = siteBase(c.req);
    const cs = await app.payments.createCheckout({
      amount, customerStripeId: stripeId, description: 'Kargom wallet top-up', metadata: { purpose: 'topup', customer_id: me(c) },
      successUrl: `${base}/app?view=wallet&topup=paid`, cancelUrl: `${base}/app?view=wallet&topup=cancelled`, idempotencyKey: `cstop:${me(c)}:${key}`, saveCard: true,
    });
    return { url: cs.url };
  });
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
  on('GET', '/api/admin/notifications', 'admin', async () => ({
    enabled: app.notifier.enabled,
    items: await app.db.all(`SELECT n.channel, n.status, n.detail, n.to_number, n.created_at, s.ref, s.id AS shipment_id FROM notifications n JOIN shipments s ON s.id = n.shipment_id ORDER BY n.created_at DESC LIMIT 100`),
  }));
  on('POST', '/api/admin/notify/test', 'admin', async (c) => {
    try {
      const to = str(c.body.phone, 'Phone or email', 200).trim();
      return { ok: true, message: to.includes('@') ? await app.notifier.testEmail(to) : await app.notifier.testSms(to) };
    }
    catch (e) { throw new AppError('bad_request', (e as Error).message); }
  });
  on('POST', '/api/admin/shipments/:id/notify', 'admin', async (c) => ({ results: await app.notifier.resend(c.params.id!) }));
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
    if (['netgsm', 'smsworks', 'resend'].includes(c.params.id!)) await app.refreshNotifier();
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
    return { ok: true, ms: Date.now() - started, rates: rates.length, carriers: [...new Set(rates.map((r) => r.carrierName))], problems: (p as { lastProblems?: string[] }).lastProblems ?? [] };
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

  // One main address: visitors on any other domain (e.g. kargom.eu) are sent to it with a permanent redirect.
  // API calls and webhooks are never redirected, so nothing already pointing at the old domain breaks.
  const canonical = (() => { try { return process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL) : null; } catch { return null; } })();

  async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const url = new URL(req.url ?? '/', 'http://local');
      const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(':')[0]!.toLowerCase();
      if (canonical && host && host !== canonical.hostname && !host.startsWith('localhost') && !host.endsWith('.onrender.com')
        && (req.method === 'GET' || req.method === 'HEAD') && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/webhooks/')) {
        res.writeHead(301, { Location: `${canonical.origin}${url.pathname}${url.search}`, 'Cache-Control': 'public, max-age=3600' });
        res.end();
        return;
      }
      const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
      if (!route) {
        let path = url.pathname;
        try { path = decodeURIComponent(url.pathname); } catch { /* leave as is */ }
        if (serveSeo(req, res, path, seoPricesFor(app))) return;
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
      if (!res.headersSent) send(res, 200, out);
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
