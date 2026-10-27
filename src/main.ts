import { SqliteDb } from './db/sqlite.ts';
import { createApp } from './app.ts';
import { startServer } from './http/server.ts';
import { FakeGateway, StripeGateway } from './payments/stripe.ts';
import { MockProvider } from './providers/mock.ts';
import { ShipEngineProvider } from './providers/shipengine.ts';

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
  quoteTimeoutMs: Number(process.env.QUOTE_TIMEOUT_MS ?? 2500),
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
    .catch((e) => console.error(`[shipstation] connection FAILED: ${(e as Error).message} ${JSON.stringify((e as { details?: unknown }).details ?? '')}`));
}

// The fake courier only runs when no real provider is configured (or MOCK_PROVIDER=1).
if (!production && (process.env.MOCK_PROVIDER === '1' || (!process.env.SHIPSTATION_API_KEY && process.env.MOCK_PROVIDER !== '0'))) {
  app.registry.addStatic(new MockProvider());
}

const port = Number(process.env.PORT ?? 8080);
await startServer(app, port);
console.log(`Kargom API listening on :${port}${stripeKey ? '' : ' (fake payments: set STRIPE_SECRET_KEY for real ones)'}`);
