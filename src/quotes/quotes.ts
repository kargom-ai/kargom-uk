import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../core/errors.ts';
import type { Clock } from '../core/clock.ts';
import type { Pence } from '../core/money.ts';
import { priceFromCost, type PricingRules } from '../pricing/pricing.ts';
import type { ProviderRate, ShipmentRequest, ShippingProvider } from '../providers/types.ts';

export type Quote = {
  token: string;             // signed; the booking step only trusts this
  provider: string;
  carrier: string;
  carrierName: string;
  serviceCode: string;
  serviceName: string;
  transitDays: number | null;
  dropOff: boolean;
  labelLater: boolean;       // label is issued after a manual step (shown to the customer)
  price: Pence;              // gross, inc VAT
  priceExVat: Pence;
  expiresAt: string;
};

/** What the token carries. The customer never sees cost or margin. */
export type QuotePayload = {
  v: 1;
  customerId: string;
  rate: ProviderRate;
  req: ShipmentRequest;
  price: Pence;
  vat: Pence;
  exp: number; // epoch ms
};

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');

export class QuoteSigner {
  private readonly secret: Buffer;
  constructor(secret: string) {
    if (secret.length < 32) throw new Error('QUOTE_SECRET must be at least 32 characters');
    this.secret = Buffer.from(secret);
  }
  sign(p: QuotePayload): string {
    const body = b64(JSON.stringify(p));
    const mac = createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${mac}`;
  }
  verify(token: string, now: Date): QuotePayload {
    const [body, mac] = token.split('.');
    if (!body || !mac) throw new AppError('quote_invalid', 'Malformed quote');
    const expect = createHmac('sha256', this.secret).update(body).digest();
    const got = Buffer.from(mac, 'base64url');
    if (got.length !== expect.length || !timingSafeEqual(got, expect)) throw new AppError('quote_invalid', 'Quote signature does not match');
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as QuotePayload;
    if (p.exp < now.getTime()) throw new AppError('quote_expired', 'This price has expired. Please get a new quote.');
    return p;
  }
}

export type AggregatorOptions = { timeoutMs: number; quoteTtlMs: number };

/**
 * Asks every enabled provider at the same time. A slow or failing provider
 * never blocks the others: it is cut off after `timeoutMs` and reported in
 * `failures`. When two providers sell the same carrier service, the cheaper
 * cost wins (that is where our margin comes from).
 */
export class QuoteService {
  private readonly providers: () => ShippingProvider[];
  private readonly pricing: PricingRules;
  private readonly signer: QuoteSigner;
  private readonly clock: Clock;
  private readonly opts: AggregatorOptions;

  constructor(providers: () => ShippingProvider[], pricing: PricingRules, signer: QuoteSigner, clock: Clock, opts: AggregatorOptions) {
    this.providers = providers;
    this.pricing = pricing;
    this.signer = signer;
    this.clock = clock;
    this.opts = opts;
  }

  async quote(customerId: string, req: ShipmentRequest, discountBp = 0): Promise<{ quotes: Quote[]; failures: Array<{ provider: string; error: string }> }> {
    validateRequest(req);
    const providers = this.providers();
    const settled = await Promise.allSettled(
      providers.map(async (p) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs);
        try {
          return await Promise.race([
            p.getRates(req, ctrl.signal),
            new Promise<never>((_, reject) => ctrl.signal.addEventListener('abort', () => reject(new Error(`timed out after ${this.opts.timeoutMs} ms`)))),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }),
    );

    const failures: Array<{ provider: string; error: string }> = [];
    const best = new Map<string, ProviderRate>();
    settled.forEach((s, i) => {
      const provider = providers[i]!.id;
      if (s.status === 'rejected') {
        const err = s.reason as Error & { details?: { body?: string } };
        failures.push({ provider, error: String(err?.message ?? s.reason) });
        console.warn(`[quotes] ${provider} failed: ${err?.message ?? s.reason} ${err?.details?.body ?? ''}`);
        return;
      }
      for (const r of s.value) {
        if (!Number.isSafeInteger(r.cost) || r.cost <= 0) continue;
        const key = `${r.carrier}:${r.serviceCode}`;
        const cur = best.get(key);
        if (!cur || r.cost < cur.cost) best.set(key, r);
      }
    });

    const exp = this.clock.now().getTime() + this.opts.quoteTtlMs;
    const quotes: Quote[] = [];
    for (const rate of best.values()) {
      const rule = await this.pricing.rule(rate.carrier, rate.serviceCode);
      const price = priceFromCost(rate.cost, rule, discountBp);
      const token = this.signer.sign({ v: 1, customerId, rate, req, price: price.gross, vat: price.vat, exp });
      quotes.push({
        token,
        provider: rate.provider,
        carrier: rate.carrier,
        carrierName: rate.carrierName,
        serviceCode: rate.serviceCode,
        serviceName: rate.serviceName,
        transitDays: rate.transitDays,
        dropOff: rate.dropOff,
        labelLater: rate.labelTiming === 'later',
        price: price.gross,
        priceExVat: price.net,
        expiresAt: new Date(exp).toISOString(),
      });
    }
    quotes.sort((a, b) => a.price - b.price);
    return { quotes, failures };
  }
}

export function validateRequest(req: ShipmentRequest): void {
  const p = req?.parcel;
  if (!p) throw new AppError('bad_request', 'Parcel details are required');
  const ok = (n: number, max: number) => Number.isFinite(n) && n > 0 && n <= max;
  if (!ok(p.weightGrams, 70_000)) throw new AppError('bad_request', 'Weight must be between 1 g and 70 kg');
  if (!ok(p.lengthCm, 300) || !ok(p.widthCm, 300) || !ok(p.heightCm, 300)) throw new AppError('bad_request', 'Each side must be between 1 and 300 cm');
  for (const [k, a] of [['from', req.from], ['to', req.to]] as const) {
    if (!a?.name || !a.line1 || !a.city || !a.postcode || !/^[A-Z]{2}$/.test(a.country ?? '')) {
      throw new AppError('bad_request', `The ${k} address is incomplete`);
    }
  }
  if (req.from.country !== 'GB') throw new AppError('bad_request', 'Collections must be in the UK');
  if (req.to.country !== 'GB' && !req.customs?.items.length) throw new AppError('bad_request', 'International parcels need a customs declaration');
}
