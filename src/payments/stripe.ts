import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../core/errors.ts';
import type { Pence } from '../core/money.ts';

/**
 * The slice of Stripe we use, behind an interface so tests use a fake and
 * production talks to the REST API with plain fetch (no SDK needed).
 */
export interface PaymentGateway {
  /** Create the Stripe customer once, so cards can be saved for later charges. */
  createCustomer(input: { email: string; name: string; idempotencyKey: string }): Promise<{ id: string }>;
  /** Checkout / top-up: returns a client secret for Stripe.js to confirm in the browser. */
  createPaymentIntent(input: { amount: Pence; customerStripeId: string | null; metadata: Record<string, string>; idempotencyKey: string; saveCard: boolean }): Promise<{ id: string; clientSecret: string }>;
  /** Charge a saved card without the customer present (weight adjustments). */
  chargeOffSession(input: { amount: Pence; customerStripeId: string; paymentMethodId: string; metadata: Record<string, string>; idempotencyKey: string }): Promise<{ id: string; status: 'succeeded' | 'failed'; error?: string }>;
  refund(input: { paymentIntentId: string; amount?: Pence; idempotencyKey: string }): Promise<{ id: string }>;
}

export class StripeGateway implements PaymentGateway {
  private readonly secretKey: string;
  private readonly fetch: typeof fetch;
  constructor(secretKey: string, fetchImpl: typeof fetch = fetch) {
    this.secretKey = secretKey;
    this.fetch = fetchImpl;
  }

  private async post<T>(path: string, form: Record<string, string>, idempotencyKey: string): Promise<T> {
    const res = await this.fetch(`https://api.stripe.com/v1${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': idempotencyKey,
      },
      body: new URLSearchParams(form).toString(),
    });
    const json = (await res.json()) as T & { error?: { message?: string; code?: string } };
    if (!res.ok) throw new AppError('payment_failed', json.error?.message ?? `Stripe ${path} failed`, { stripeCode: json.error?.code });
    return json;
  }

  async createCustomer(i: Parameters<PaymentGateway['createCustomer']>[0]) {
    const c = await this.post<{ id: string }>('/customers', { email: i.email, name: i.name }, i.idempotencyKey);
    return { id: c.id };
  }

  async createPaymentIntent(i: Parameters<PaymentGateway['createPaymentIntent']>[0]) {
    const form: Record<string, string> = {
      amount: String(i.amount),
      currency: 'gbp',
      'automatic_payment_methods[enabled]': 'true',
    };
    if (i.customerStripeId) form.customer = i.customerStripeId;
    if (i.saveCard) form.setup_future_usage = 'off_session';
    for (const [k, v] of Object.entries(i.metadata)) form[`metadata[${k}]`] = v;
    const pi = await this.post<{ id: string; client_secret: string }>('/payment_intents', form, i.idempotencyKey);
    return { id: pi.id, clientSecret: pi.client_secret };
  }

  async chargeOffSession(i: Parameters<PaymentGateway['chargeOffSession']>[0]) {
    const form: Record<string, string> = {
      amount: String(i.amount),
      currency: 'gbp',
      customer: i.customerStripeId,
      payment_method: i.paymentMethodId,
      off_session: 'true',
      confirm: 'true',
    };
    for (const [k, v] of Object.entries(i.metadata)) form[`metadata[${k}]`] = v;
    try {
      const pi = await this.post<{ id: string; status: string }>('/payment_intents', form, i.idempotencyKey);
      return { id: pi.id, status: pi.status === 'succeeded' ? ('succeeded' as const) : ('failed' as const) };
    } catch (e) {
      return { id: '', status: 'failed' as const, error: (e as Error).message };
    }
  }

  async refund(i: Parameters<PaymentGateway['refund']>[0]) {
    const form: Record<string, string> = { payment_intent: i.paymentIntentId };
    if (i.amount) form.amount = String(i.amount);
    const r = await this.post<{ id: string }>('/refunds', form, i.idempotencyKey);
    return { id: r.id };
  }
}

/**
 * Verify a Stripe webhook (`Stripe-Signature: t=…,v1=…`). The signed payload is
 * `${t}.${rawBody}` with HMAC-SHA256 using the endpoint's signing secret.
 * Rejects events older than `toleranceSec` to stop replays.
 */
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, nowSec: number, toleranceSec = 300): void {
  if (!header) throw new AppError('unauthorized', 'Missing Stripe-Signature');
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length) throw new AppError('unauthorized', 'Bad Stripe-Signature');
  if (Math.abs(nowSec - t) > toleranceSec) throw new AppError('unauthorized', 'Stripe webhook is too old');
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const ok = sigs.some((s) => {
    const got = Buffer.from(s, 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  if (!ok) throw new AppError('unauthorized', 'Stripe signature does not match');
}

/** In-memory gateway for tests and local runs without Stripe keys. */
export class FakeGateway implements PaymentGateway {
  declineOffSession = false;
  intents = new Map<string, { amount: Pence; metadata: Record<string, string> }>();
  refunds: Array<{ paymentIntentId: string; amount?: Pence }> = [];
  private seq = 0;
  async createCustomer(_i: Parameters<PaymentGateway['createCustomer']>[0]) {
    return { id: `cus_fake_${++this.seq}` };
  }
  async createPaymentIntent(i: Parameters<PaymentGateway['createPaymentIntent']>[0]) {
    const id = `pi_fake_${++this.seq}`;
    this.intents.set(id, { amount: i.amount, metadata: i.metadata });
    return { id, clientSecret: `${id}_secret` };
  }
  async chargeOffSession(i: Parameters<PaymentGateway['chargeOffSession']>[0]) {
    if (this.declineOffSession) return { id: '', status: 'failed' as const, error: 'Your card was declined.' };
    const id = `pi_fake_${++this.seq}`;
    this.intents.set(id, { amount: i.amount, metadata: i.metadata });
    return { id, status: 'succeeded' as const };
  }
  async refund(i: Parameters<PaymentGateway['refund']>[0]) {
    this.refunds.push({ paymentIntentId: i.paymentIntentId, ...(i.amount ? { amount: i.amount } : {}) });
    return { id: `re_fake_${++this.seq}` };
  }
}
