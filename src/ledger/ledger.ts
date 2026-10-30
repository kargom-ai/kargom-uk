import type { Db, Queryable } from '../db/db.ts';
import { isUniqueViolation } from '../db/db.ts';
import { assertPence, type Pence } from '../core/money.ts';
import { newId } from '../core/ids.ts';
import type { Clock } from '../core/clock.ts';

/**
 * Chart of accounts (amount > 0 = debit, < 0 = credit):
 *   wallet:<customer>        liability: money customers have loaded
 *   hold:<customer>          liability: wallet money reserved for a booking in progress
 *   cash:stripe              asset: money received through Stripe (cards, Apple Pay, top-ups)
 *   revenue:labels           income: net label sales and adjustments
 *   vat:output               liability: VAT collected, owed to HMRC
 *   cost:provider:<id>       expense: what ShipStation / ShipEngine charge us
 *   payable:provider:<id>    liability: what we owe each provider
 */
export const acct = {
  wallet: (customerId: string) => `wallet:${customerId}`,
  hold: (customerId: string) => `hold:${customerId}`,
  cashStripe: 'cash:stripe',
  revenue: 'revenue:labels',
  vatOutput: 'vat:output',
  providerCost: (p: string) => `cost:provider:${p}`,
  providerPayable: (p: string) => `payable:provider:${p}`,
} as const;

export type Line = { account: string; amount: Pence };
export type EntryKind = 'topup' | 'hold' | 'capture' | 'release' | 'refund' | 'adjustment' | 'card_sale' | 'provider_cost' | 'credit' | 'fwd_sale';

export type PostInput = {
  idempotencyKey: string;
  kind: EntryKind;
  ref?: string;
  memo?: string;
  lines: Line[];
};

export class Ledger {
  private readonly db: Db;
  private readonly clock: Clock;
  constructor(db: Db, clock: Clock) {
    this.db = db;
    this.clock = clock;
  }

  /**
   * Post a balanced entry. Idempotent: posting the same key twice returns the
   * first entry and changes nothing. Pass `q` to join an outer transaction.
   */
  async post(input: PostInput, q?: Queryable): Promise<{ entryId: string; duplicate: boolean }> {
    if (input.lines.length < 2) throw new Error('A ledger entry needs at least two lines');
    let sum = 0;
    for (const l of input.lines) {
      assertPence(l.amount, `line amount for ${l.account}`);
      if (l.amount === 0) throw new Error(`Zero line for ${l.account}`);
      sum += l.amount;
    }
    if (sum !== 0) throw new Error(`Unbalanced ledger entry (${input.kind}): lines sum to ${sum}`);

    const work = async (tx: Queryable) => {
      const existing = await tx.get<{ id: string }>('SELECT id FROM ledger_entries WHERE idempotency_key = $1', [input.idempotencyKey]);
      if (existing) return { entryId: existing.id, duplicate: true };
      const id = newId('le');
      try {
        await tx.run('INSERT INTO ledger_entries (id, idempotency_key, kind, ref, memo, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [
          id,
          input.idempotencyKey,
          input.kind,
          input.ref ?? null,
          input.memo ?? null,
          this.clock.now().toISOString(),
        ]);
      } catch (e) {
        if (isUniqueViolation(e)) {
          const again = await tx.get<{ id: string }>('SELECT id FROM ledger_entries WHERE idempotency_key = $1', [input.idempotencyKey]);
          if (again) return { entryId: again.id, duplicate: true };
        }
        throw e;
      }
      for (const l of input.lines) {
        await tx.run('INSERT INTO ledger_lines (entry_id, account, amount) VALUES ($1,$2,$3)', [id, l.account, l.amount]);
      }
      return { entryId: id, duplicate: false };
    };
    return q ? work(q) : this.db.tx(work);
  }

  /** Raw sum of lines (debits positive). */
  async sum(account: string, q?: Queryable): Promise<Pence> {
    const r = await (q ?? this.db).get<{ s: number | null }>('SELECT SUM(amount) AS s FROM ledger_lines WHERE account = $1', [account]);
    return Number(r?.s ?? 0);
  }

  /** Balance of a liability account (wallets, holds, VAT, payables) as a positive number. */
  async liability(account: string, q?: Queryable): Promise<Pence> {
    return -(await this.sum(account, q));
  }

  /** Sum over all accounts must always be zero. Used by tests and a nightly check. */
  async trialBalance(): Promise<Pence> {
    const r = await this.db.get<{ s: number | null }>('SELECT SUM(amount) AS s FROM ledger_lines');
    return Number(r?.s ?? 0);
  }
}
