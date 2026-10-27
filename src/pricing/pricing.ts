import type { Db } from '../db/db.ts';
import { addVat, applyBp, roundUpTo9, splitVat, type Pence } from '../core/money.ts';

export type Rule = { markupBp: number; fixedPence: Pence };
export type Price = { cost: Pence; net: Pence; vat: Pence; gross: Pence; margin: Pence };

export const MIN_MARGIN_PENCE = 30;

/**
 * Customer price = round-up-to-9p( (provider cost + markup% + fixed fee) + VAT ).
 * Provider costs from ShipStation / ShipEngine are net of VAT. A minimum margin
 * per label stops a very cheap service from being sold at a loss after rounding.
 */
export function priceFromCost(cost: Pence, rule: Rule, discountBp = 0): Price {
  const markupBp = Math.max(0, rule.markupBp - applyBp(rule.markupBp, discountBp));
  let net = cost + applyBp(cost, markupBp) + rule.fixedPence;
  if (net - cost < MIN_MARGIN_PENCE) net = cost + MIN_MARGIN_PENCE;
  const gross = roundUpTo9(addVat(net).gross);
  const split = splitVat(gross);
  return { cost, net: split.net, vat: split.vat, gross, margin: split.net - cost };
}

export class PricingRules {
  private readonly db: Db;
  private cache: Map<string, Rule> | null = null;
  constructor(db: Db) {
    this.db = db;
  }

  async rule(carrier: string, serviceCode: string): Promise<Rule> {
    if (!this.cache) {
      const rows = await this.db.all<{ service_key: string; markup_bp: number; fixed_pence: number }>('SELECT * FROM pricing_rules');
      this.cache = new Map(rows.map((r) => [r.service_key, { markupBp: r.markup_bp, fixedPence: r.fixed_pence }]));
    }
    return this.cache.get(`${carrier}:${serviceCode}`) ?? this.cache.get('*') ?? { markupBp: 1200, fixedPence: 10 };
  }

  async set(serviceKey: string, rule: Rule): Promise<void> {
    await this.db.run(
      `INSERT INTO pricing_rules (service_key, markup_bp, fixed_pence) VALUES ($1,$2,$3)
       ON CONFLICT (service_key) DO UPDATE SET markup_bp = excluded.markup_bp, fixed_pence = excluded.fixed_pence`,
      [serviceKey, rule.markupBp, rule.fixedPence],
    );
    this.cache = null;
  }

  async list() {
    return this.db.all<{ service_key: string; markup_bp: number; fixed_pence: number }>('SELECT * FROM pricing_rules ORDER BY service_key');
  }
}
