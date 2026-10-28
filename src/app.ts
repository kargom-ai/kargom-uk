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
import { Notifier } from './notify/notify.ts';
import { NetgsmSms, ResendEmail, SmsWorks, WhatsAppCloud, type Channel } from './notify/channels.ts';
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
  const notifier = new Notifier(db, clock);
  /**
   * Label messages: WhatsApp from env; SMS from the admin screen (NetGSM saved encrypted) or env.
   * Called at start and whenever the admin saves the NetGSM connection.
   */
  const refreshNotifier = async () => {
    const channels: Channel[] = [];
    const env = process.env;
    if (env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) {
      channels.push(new WhatsAppCloud({ token: env.WHATSAPP_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, template: env.WHATSAPP_TEMPLATE ?? 'label_ready', lang: env.WHATSAPP_TEMPLATE_LANG ?? 'en_GB' }));
    }
    const rs = (await registry.secretsFor('resend')) ?? {};
    const rsKey = rs.apiKey || env.RESEND_API_KEY, rsFrom = rs.from || env.RESEND_FROM;
    if (rsKey && rsFrom) channels.push(new ResendEmail({ apiKey: rsKey, from: rsFrom }));
    // SMS: The SMS Works (UK) first; NetGSM only if that is not set up.
    const sw = (await registry.secretsFor('smsworks')) ?? {};
    const swToken = sw.token || env.SMSWORKS_TOKEN, swSender = sw.sender || env.SMSWORKS_SENDER || 'Kargom';
    const ng = (await registry.secretsFor('netgsm')) ?? {};
    const usercode = ng.usercode || env.NETGSM_USERCODE, password = ng.password || env.NETGSM_PASSWORD, header = ng.header || env.NETGSM_HEADER;
    if (swToken) channels.push(new SmsWorks({ token: swToken, sender: swSender }));
    else if (usercode && password && header) channels.push(new NetgsmSms({ usercode, password, header }));
    const policy = (['all', 'guests', 'none'] as const).find((p) => p === env.NOTIFY_INSTANT_LABELS) ?? 'guests';
    notifier.configure(channels, env.PUBLIC_URL ?? '', policy);
    return channels.map((c) => c.id);
  };
  bookings.onLabelReady = (id, instant) => { notifier.labelReady(id, { instant }).catch((e) => console.warn(`[notify] ${id}: ${(e as Error).message}`)); };
  return { db, config, clock, ledger, wallet, pricing, registry, quotes, bookings, adjustments, support, auth, webhooks, admin, payments, notifier, refreshNotifier };
}

export type App = Awaited<ReturnType<typeof createApp>>;
