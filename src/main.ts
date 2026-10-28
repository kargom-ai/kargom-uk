import { SqliteDb } from './db/sqlite.ts';
import { createApp } from './app.ts';
import { startServer, warmPreviewCache } from './http/server.ts';
import { FakeGateway, StripeGateway } from './payments/stripe.ts';
import { MockProvider } from './providers/mock.ts';
import { ShipEngineProvider } from './providers/shipengine.ts';
import { PacklinkProvider } from './providers/packlink.ts';

const env = (k: string, fallback?: string) => {
  const v = process.env[k] ?? fallback;
  if (v === undefined) throw new Error(`Missing environment variable ${k}`);
  return v;
};

const production = process.env.NODE_ENV === 'production';
const db = new SqliteDb(env('DATABASE_PATH', './kargom.db'));

const stripeKey = process.env.STRIPE_SECRET_KEY;
if (production && !stripeKey) throw new Error('STRIPE_SECRET_KEY is required in production');
const payments = stripeKey ? new StripeGateway(stripeKey) : new FakeGateway();

const app = await createApp(db, {
  quoteSecret: env('QUOTE_SECRET', production ? undefined : 'dev-only-quote-secret-change-me-0123456789'),
  masterKey: env('MASTER_KEY', production ? undefined : Buffer.alloc(32, 7).toString('base64')),
  carrierWebhookToken: env('CARRIER_WEBHOOK_TOKEN', production ? undefined : 'dev-webhook-token'),
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? null,
  quoteTimeoutMs: Number(process.env.QUOTE_TIMEOUT_MS ?? 12000),
  quoteTtlMs: Number(process.env.QUOTE_TTL_MS ?? 15 * 60_000),
}, payments);

// ShipStation (API v2) straight from environment variables, so it works before the admin screens exist.
if (process.env.SHIPSTATION_API_KEY) {
  const shipstation = new ShipEngineProvider({
    id: 'shipstation',
    baseUrl: process.env.SHIPSTATION_BASE_URL ?? 'https://api.shipstation.com/v2',
    apiKey: process.env.SHIPSTATION_API_KEY,
    carrierIds: (process.env.SHIPSTATION_CARRIER_IDS ?? '').split(',').map((x) => x.trim()).filter(Boolean),
    // Outside production every label is a TEST label, so trying the site never buys real postage.
    testLabels: !production || process.env.SHIPSTATION_TEST_LABELS === '1',
  });
  app.registry.addStatic(shipstation);
  // Connection check on start-up: prints carrier names (never the key) to the logs.
  shipstation
    .listCarriers(AbortSignal.timeout(10_000))
    .then((cs) => console.log(`[shipstation] connected: ${cs.length} carrier account(s): ${cs.map((c) => `${c.name} [${c.code}] (${c.id})`).join(', ') || 'none - connect carriers in ShipStation first'}`))
    .then(() => shipstation.getRates({
      from: { name: 'Test', line1: '1 Piccadilly', city: 'Manchester', postcode: 'M1 1AE', country: 'GB', phone: '07700900000' },
      to: { name: 'Test', line1: '2 Park Row', city: 'Leeds', postcode: 'LS1 5HD', country: 'GB', phone: '07700900000' },
      parcel: { weightGrams: 1000, lengthCm: 20, widthCm: 15, heightCm: 10 },
    }, AbortSignal.timeout(20_000)))
    .then((rates) => console.log(`[shipstation] test quote Manchester → Leeds 1 kg: ${rates.length} rate(s)${rates.length ? ': ' + rates.slice(0, 6).map((r) => `${r.carrierName} ${r.serviceName} £${(r.cost / 100).toFixed(2)}`).join(', ') : ' · ' + (shipstation.lastProblems.join(' | ') || 'no reason given')}`))
    .catch((e) => console.error(`[shipstation] FAILED: ${(e as Error).message} ${JSON.stringify((e as { details?: unknown }).details ?? '')}`));
}

// Packlink PRO straight from environment variables. Labels arrive after the shipment is paid in Packlink PRO.
if (process.env.PACKLINK_API_KEY) {
  const packlink = new PacklinkProvider({ apiKey: process.env.PACKLINK_API_KEY, sell: process.env.PACKLINK_SELL !== '0' });
  app.registry.addStatic(packlink);
  packlink.getRates({
    from: { name: 'Test', line1: '1 Piccadilly', city: 'Manchester', postcode: 'M1 1AE', country: 'GB' },
    to: { name: 'Test', line1: '2 Park Row', city: 'Leeds', postcode: 'LS1 5HD', country: 'GB' },
    parcel: { weightGrams: 1000, lengthCm: 20, widthCm: 15, heightCm: 10 },
  }, AbortSignal.timeout(20_000))
    .then((rates) => console.log(`[packlink] connected: test quote Manchester → Leeds 1 kg: ${rates.length} rate(s)${rates.length ? ': ' + rates.slice(0, 6).map((r) => `${r.serviceName} £${(r.cost / 100).toFixed(2)}`).join(', ') : ''}`))
    .catch((e) => console.error(`[packlink] FAILED: ${(e as Error).message}`));
  if (process.env.PUBLIC_URL) {
    packlink.registerCallback(`${process.env.PUBLIC_URL.replace(/\/+$/, '')}/webhooks/carrier/packlink/${app.config.carrierWebhookToken}`)
      .then(() => console.log('[packlink] status webhook registered'))
      .catch((e) => console.warn(`[packlink] could not register the status webhook: ${(e as Error).message}`));
  }
}

// "Your label is ready" on WhatsApp (env) and by SMS (admin screen or env).
app.refreshNotifier().then((ch) => { if (ch.length) console.log(`[notify] label messages on: ${ch.join(' + ')}${process.env.PUBLIC_URL ? '' : ' (set PUBLIC_URL so links work)'}`); });

// Labels that arrive later (Packlink): check every 2 minutes, in case a webhook was missed.
setInterval(async () => {
  try {
    const rows = await app.db.all<{ id: string }>("SELECT id FROM shipments WHERE status = 'awaiting_label' ORDER BY updated_at LIMIT 50");
    for (const r of rows) await app.bookings.refreshPendingLabel(r.id).catch((e) => console.warn(`[labels] ${r.id}: ${(e as Error).message}`));
  } catch { /* next round */ }
}, 120_000).unref();

// The fake courier only runs when no real provider is configured (or MOCK_PROVIDER=1).
if (!production && (process.env.MOCK_PROVIDER === '1' || (!process.env.SHIPSTATION_API_KEY && process.env.MOCK_PROVIDER !== '0'))) {
  app.registry.addStatic(new MockProvider());
}

const port = Number(process.env.PORT ?? 8080);
await startServer(app, port);
if (stripeKey && !process.env.STRIPE_PUBLISHABLE_KEY) console.warn('[stripe] STRIPE_PUBLISHABLE_KEY is not set: card payments use Stripe\'s hosted page instead of the on-page form.');
if (stripeKey) console.log(`[stripe] ${stripeKey.startsWith('sk_live_') ? 'LIVE' : 'TEST'} mode, on-page card form ${process.env.STRIPE_PUBLISHABLE_KEY ? 'ON' : 'OFF (no publishable key)'}`);
// Price the common homepage searches now and every 6 hours.
{
  const warm = () => warmPreviewCache(app).then((n) => console.log(`[quotes] homepage prices warmed (${n} searches)`)).catch(() => {});
  setTimeout(warm, 3000);
  setInterval(warm, Math.max(60_000, Number(process.env.PREVIEW_CACHE_HOURS ?? 6) * 3600_000 - 5 * 60_000)).unref();
}
console.log(`Kargom API listening on :${port}${stripeKey ? '' : ' (fake payments: set STRIPE_SECRET_KEY for real ones)'}`);
