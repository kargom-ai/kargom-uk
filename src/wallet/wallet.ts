import type { Db, Queryable } from '../db/db.ts';
import { AppError } from '../core/errors.ts';
import { assertPence, splitVat, type Pence } from '../core/money.ts';
import { newId } from '../core/ids.ts';
import type { Clock } from '../core/clock.ts';
import { acct, type Ledger } from '../ledger/ledger.ts';

/**
 * Customer wallet on top of the ledger. A booking first HOLDS the price
 * (moves it from wallet to hold), then either CAPTURES it once the label is
 * bought, or RELEASES it back if buying the label failed.
 */
export class Wallet {
  private readonly db: Db;
  private readonly ledger: Ledger;
  private readonly clock: Clock;
  constructor(db: Db, ledger: Ledger, clock: Clock) {
    this.db = db;
    this.ledger = ledger;
    this.clock = clock;
  }

  balance(customerId: string, q?: Queryable): Promise<Pence> {
    return this.ledger.liability(acct.wallet(customerId), q);
  }

  /** Money arrived from Stripe (top-up). Idempotent on the Stripe payment id. */
  async topUp(customerId: string, amount: Pence, stripePaymentId: string): Promise<void> {
    assertPence(amount);
    if (amount <= 0) throw new AppError('bad_request', 'Top-up must be positive');
    await this.ledger.post({
      idempotencyKey: `topup:${stripePaymentId}`,
      kind: 'topup',
      ref: stripePaymentId,
      lines: [
        { account: acct.cashStripe, amount },
        { account: acct.wallet(customerId), amount: -amount },
      ],
    });
  }

  /** Admin goodwill credit (e.g. waiving an adjustment). */
  async credit(customerId: string, amount: Pence, key: string, memo: string, q?: Queryable): Promise<void> {
    const { net, vat } = splitVat(amount);
    const lines = [
      { account: acct.revenue, amount: net },
      { account: acct.wallet(customerId), amount: -amount },
    ];
    if (vat) lines.push({ account: acct.vatOutput, amount: vat });
    await this.ledger.post({ idempotencyKey: key, kind: 'credit', memo, lines }, q);
  }

  /** Reserve `amount` for a booking. Throws insufficient_funds if the wallet is short. */
  async hold(customerId: string, amount: Pence, ref: string, key: string, q?: Queryable): Promise<string> {
    assertPence(amount);
    const work = async (tx: Queryable) => {
      const existing = await tx.get<{ id: string }>('SELECT id FROM holds WHERE ref = $1 AND customer_id = $2', [ref, customerId]);
      if (existing) return existing.id;
      const bal = await this.balance(customerId, tx);
      if (bal < amount) throw new AppError('insufficient_funds', 'Not enough money in your wallet', { balance: bal, needed: amount });
      const id = newId('hold');
      await tx.run('INSERT INTO holds (id, customer_id, amount, status, ref, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [
        id, customerId, amount, 'held', ref, this.clock.now().toISOString(),
      ]);
      await this.ledger.post(
        {
          idempotencyKey: key,
          kind: 'hold',
          ref,
          lines: [
            { account: acct.wallet(customerId), amount },
            { account: acct.hold(customerId), amount: -amount },
          ],
        },
        tx,
      );
      return id;
    };
    return q ? work(q) : this.db.tx(work);
  }

  /** Turn a hold into revenue (label bought). */
  async capture(holdId: string, q?: Queryable): Promise<void> {
    const work = async (tx: Queryable) => {
      const h = await tx.get<{ customer_id: string; amount: number; status: string; ref: string }>('SELECT * FROM holds WHERE id = $1', [holdId]);
      if (!h) throw new AppError('not_found', 'Hold not found');
      if (h.status === 'captured') return;
      if (h.status !== 'held') throw new AppError('conflict', `Hold is ${h.status}`);
      const { net, vat } = splitVat(h.amount);
      const lines = [
        { account: acct.hold(h.customer_id), amount: h.amount },
        { account: acct.revenue, amount: -net },
      ];
      if (vat) lines.push({ account: acct.vatOutput, amount: -vat });
      await this.ledger.post({ idempotencyKey: `capture:${holdId}`, kind: 'capture', ref: h.ref, lines }, tx);
      await tx.run('UPDATE holds SET status = $1 WHERE id = $2', ['captured', holdId]);
    };
    return q ? work(q) : this.db.tx(work);
  }

  /** Give a hold back to the wallet (label purchase failed). */
  async release(holdId: string, q?: Queryable): Promise<void> {
    const work = async (tx: Queryable) => {
      const h = await tx.get<{ customer_id: string; amount: number; status: string; ref: string }>('SELECT * FROM holds WHERE id = $1', [holdId]);
      if (!h) throw new AppError('not_found', 'Hold not found');
      if (h.status === 'released') return;
      if (h.status !== 'held') throw new AppError('conflict', `Hold is ${h.status}`);
      await this.ledger.post(
        {
          idempotencyKey: `release:${holdId}`,
          kind: 'release',
          ref: h.ref,
          lines: [
            { account: acct.hold(h.customer_id), amount: h.amount },
            { account: acct.wallet(h.customer_id), amount: -h.amount },
          ],
        },
        tx,
      );
      await tx.run('UPDATE holds SET status = $1 WHERE id = $2', ['released', holdId]);
    };
    return q ? work(q) : this.db.tx(work);
  }

  /** Take money straight from the wallet as revenue (weight adjustment). */
  async debitAsRevenue(customerId: string, amount: Pence, key: string, ref: string, q?: Queryable): Promise<void> {
    const work = async (tx: Queryable) => {
      const bal = await this.balance(customerId, tx);
      if (bal < amount) throw new AppError('insufficient_funds', 'Not enough money in the wallet', { balance: bal, needed: amount });
      const { net, vat } = splitVat(amount);
      const lines = [
        { account: acct.wallet(customerId), amount },
        { account: acct.revenue, amount: -net },
      ];
      if (vat) lines.push({ account: acct.vatOutput, amount: -vat });
      await this.ledger.post({ idempotencyKey: key, kind: 'adjustment', ref, lines }, tx);
    };
    return q ? work(q) : this.db.tx(work);
  }

  /** Refund a captured label price back into the wallet (cancelled / unused label). */
  async refundToWallet(customerId: string, amount: Pence, key: string, ref: string): Promise<void> {
    const { net, vat } = splitVat(amount);
    const lines = [
      { account: acct.revenue, amount: net },
      { account: acct.wallet(customerId), amount: -amount },
    ];
    if (vat) lines.push({ account: acct.vatOutput, amount: vat });
    await this.ledger.post({ idempotencyKey: key, kind: 'refund', ref, lines });
  }

  /** Wallet statement for the customer panel, newest first. */
  async statement(customerId: string, limit = 50) {
    return this.db.all<{ id: string; kind: string; ref: string | null; memo: string | null; created_at: string; amount: number }>(
      `SELECT e.id, e.kind, e.ref, e.memo, e.created_at, -l.amount AS amount
         FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
        WHERE l.account = $1 ORDER BY e.created_at DESC, e.id DESC LIMIT $2`,
      [acct.wallet(customerId), limit],
    );
  }
}
