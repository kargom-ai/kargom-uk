import type { Db } from './db/db.ts';
import { migrate } from './db/migrate.ts';
import { systemClock, type Clock } from './core/clock.ts';
import { Ledger } from './ledger/ledger.ts';
import { Wallet } from './wallet/wallet.ts';
import { PricingRules } from './pricing/pricing.ts';
import { QuoteService, QuoteSigner } from './quotes/quotes.ts';
import { BookingService } from './bookings/bookings.ts';
import { AdjustmentService } from './adjustments/adjustments.ts';
import { SupportService } from './support/tickets.ts';
import { AuthService, SecretBox } from './auth/auth.ts';
import { ProviderRegistry } from './providers/registry.ts';
import { WebhookHandlers } from './webhooks.ts';
import { AdminQueries } from './admin.ts';
import type { PaymentGateway } from './payments/stripe.ts';

export type AppConfig = {
  quoteSecret: string;          // HMAC key for quote tokens, 32+ chars
  masterKey: string;            // base64 32 bytes, encrypts provider secrets
  carrierWebhookToken: string;  // secret path segment for carrier webhooks
  stripeWebhookSecret: string | null;
  quoteTimeoutMs: number;
  quoteTtlMs: number;
};

/** Composition root: builds every service once and wires the dependencies. */
export async function createApp(db: Db, config: AppConfig, payments: PaymentGateway, clock: Clock = systemClock) {
  await migrate(db);
  const box = new SecretBox(config.masterKey);
  const ledger = new Ledger(db, clock);
  const wallet = new Wallet(db, ledger, clock);
  const pricing = new PricingRules(db);
  const registry = new ProviderRegistry(db, box, clock);
  await registry.load();
  const signer = new QuoteSigner(config.quoteSecret);
  const quotes = new QuoteService(() => registry.all(), pricing, signer, clock, { timeoutMs: config.quoteTimeoutMs, quoteTtlMs: config.quoteTtlMs });
  const bookings = new BookingService({ db, ledger, wallet, payments, signer, providers: (id) => registry.get(id), clock });
  const adjustments = new AdjustmentService({ db, ledger, wallet, payments, pricing, providers: (id) => registry.get(id), clock });
  const support = new SupportService(db, clock);
  const auth = new AuthService(db, clock);
  const webhooks = new WebhookHandlers({ db, clock, bookings, wallet, adjustments });
  const admin = new AdminQueries(db, ledger, clock);
  return { db, config, clock, ledger, wallet, pricing, registry, quotes, bookings, adjustments, support, auth, webhooks, admin, payments };
}

export type App = Awaited<ReturnType<typeof createApp>>;
