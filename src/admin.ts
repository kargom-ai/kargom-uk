import type { Db } from './db/db.ts';
import { AppError } from './core/errors.ts';
import type { Ledger } from './ledger/ledger.ts';
import { acct } from './ledger/ledger.ts';
import type { Clock } from './core/clock.ts';

/** Read models for the admin panel. Everything financial comes from the ledger. */
export class AdminQueries {
  private readonly db: Db;
  private readonly ledger: Ledger;
  private readonly clock: Clock;
  constructor(db: Db, ledger: Ledger, clock: Clock) {
    this.db = db;
    this.ledger = ledger;
    this.clock = clock;
  }

  private since(days: number) {
    return new Date(this.clock.now().getTime() - days * 86_400_000).toISOString();
  }

  async overview(days = 30) {
    const from = this.since(days);
    const ship = await this.db.get<{ n: number; gross: number | null; cost: number | null; vat: number | null }>(
      `SELECT COUNT(*) AS n, SUM(price_pence) AS gross, SUM(cost_pence) AS cost, SUM(vat_pence) AS vat
         FROM shipments WHERE created_at >= $1 AND status NOT IN ('failed','cancelled','awaiting_payment','pending')`, [from]);
    const customers = await this.db.get<{ total: number; active: number | null }>(
      `SELECT (SELECT COUNT(*) FROM customers WHERE role = 'customer') AS total,
              (SELECT COUNT(DISTINCT customer_id) FROM shipments WHERE created_at >= $1) AS active`, [from]);
    const wallets = await this.db.get<{ s: number | null }>("SELECT SUM(amount) AS s FROM ledger_lines WHERE account LIKE 'wallet:%'");
    const adj = await this.db.get<{ n: number; owed: number | null }>(
      "SELECT COUNT(*) AS n, SUM(diff_pence) AS owed FROM adjustments WHERE status IN ('pending','failed','disputed')");
    const waiting = await this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM tickets WHERE status = 'waiting_us'");
    const gross = Number(ship?.gross ?? 0);
    const net = gross - Number(ship?.vat ?? 0);
    const cost = Number(ship?.cost ?? 0);
    return {
      periodDays: days,
      shipments: Number(ship?.n ?? 0),
      gmvPence: gross,
      netSalesPence: net,
      providerCostPence: cost,
      grossProfitPence: net - cost,
      customers: { total: Number(customers?.total ?? 0), active: Number(customers?.active ?? 0) },
      heldInWalletsPence: -Number(wallets?.s ?? 0),
      adjustments: { open: Number(adj?.n ?? 0), owedPence: Number(adj?.owed ?? 0) },
      supportWaiting: Number(waiting?.n ?? 0),
    };
  }

  async shipments(filter: { status?: string; customerId?: string; limit?: number }) {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.status) { params.push(filter.status); where.push(`s.status = $${params.length}`); }
    if (filter.customerId) { params.push(filter.customerId); where.push(`s.customer_id = $${params.length}`); }
    params.push(Math.min(filter.limit ?? 100, 500));
    return this.db.all(
      `SELECT s.id, s.ref, s.status, s.provider, s.carrier, s.service_name, s.tracking_number, s.cost_pence, s.price_pence, s.vat_pence,
              s.pay_method, s.created_at, s.customer_id, c.name AS customer_name,
              (SELECT a.status FROM adjustments a WHERE a.shipment_id = s.id ORDER BY a.created_at DESC LIMIT 1) AS adjustment_status
         FROM shipments s JOIN customers c ON c.id = s.customer_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY s.created_at DESC LIMIT $${params.length}`, params);
  }

  async customers(search?: string) {
    const q = search ? `%${search.toLowerCase()}%` : null;
    return this.db.all(
      `SELECT c.id, c.name, c.email, c.company, c.account_type, c.bookings_paused, c.created_at,
              (SELECT COUNT(*) FROM shipments s WHERE s.customer_id = c.id AND s.status NOT IN ('failed','awaiting_payment')) AS shipments,
              (SELECT COALESCE(SUM(price_pence),0) FROM shipments s WHERE s.customer_id = c.id AND s.status NOT IN ('failed','awaiting_payment','pending')) AS spend_pence,
              (SELECT -COALESCE(SUM(amount),0) FROM ledger_lines l WHERE l.account = 'wallet:' || c.id) AS wallet_pence
         FROM customers c WHERE c.role = 'customer' ${q ? 'AND (LOWER(c.name) LIKE $1 OR LOWER(c.email) LIKE $1 OR LOWER(COALESCE(c.company, \'\')) LIKE $1)' : ''}
        ORDER BY c.created_at DESC LIMIT 200`, q ? [q] : []);
  }

  /** Everything the admin profile page shows for one customer. */
  async customerProfile(id: string) {
    const c = await this.db.get<Record<string, unknown>>(
      'SELECT id, email, name, company, phone, account_type, bookings_paused, pricing_discount_bp, stripe_customer_id, default_payment_method, created_at FROM customers WHERE id = $1', [id]);
    if (!c) throw new AppError('not_found', 'Customer not found');
    const [shipments, adjustments, tickets, wallet, statement, addresses, carriers] = await Promise.all([
      this.shipments({ customerId: id, limit: 50 }),
      this.db.all('SELECT a.*, s.ref FROM adjustments a JOIN shipments s ON s.id = a.shipment_id WHERE s.customer_id = $1 ORDER BY a.created_at DESC', [id]),
      this.db.all('SELECT id, ref, subject, status, priority, updated_at FROM tickets WHERE customer_id = $1 ORDER BY updated_at DESC', [id]),
      this.ledger.liability(acct.wallet(id)),
      this.db.all(
        `SELECT e.kind, e.ref, e.memo, e.created_at, -l.amount AS amount FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
          WHERE l.account = $1 ORDER BY e.created_at DESC LIMIT 50`, [acct.wallet(id)]),
      // Addresses are derived from what they actually shipped, most used first.
      this.db.all(
        `SELECT from_json AS json, 'collection' AS kind, COUNT(*) AS used FROM shipments WHERE customer_id = $1 GROUP BY from_json
         UNION ALL
         SELECT to_json AS json, 'recipient' AS kind, COUNT(*) AS used FROM shipments WHERE customer_id = $1 GROUP BY to_json
         ORDER BY used DESC LIMIT 100`, [id]),
      this.db.all('SELECT carrier, COUNT(*) AS n FROM shipments WHERE customer_id = $1 GROUP BY carrier ORDER BY n DESC', [id]),
    ]);
    return {
      customer: c,
      walletPence: wallet,
      shipments,
      adjustments,
      tickets,
      statement,
      addresses: (addresses as Array<{ json: string; kind: string; used: number }>).map((a) => ({ kind: a.kind, used: Number(a.used), address: JSON.parse(a.json) })),
      carriers,
    };
  }

  /** Balances straight from the ledger: what we hold, owe and earned. */
  async finance() {
    const rows = await this.db.all<{ account: string; s: number }>(
      `SELECT CASE WHEN account LIKE 'wallet:%' THEN 'wallets' WHEN account LIKE 'hold:%' THEN 'holds' ELSE account END AS account, SUM(amount) AS s
         FROM ledger_lines GROUP BY 1 ORDER BY 1`);
    const by = Object.fromEntries(rows.map((r) => [r.account, Number(r.s)]));
    const payables = rows.filter((r) => r.account.startsWith('payable:provider:')).map((r) => ({ provider: r.account.split(':')[2], owedPence: -Number(r.s) }));
    return {
      cashStripePence: by[acct.cashStripe] ?? 0,
      customerWalletsPence: -(by.wallets ?? 0),
      inFlightHoldsPence: -(by.holds ?? 0),
      netRevenuePence: -(by[acct.revenue] ?? 0),
      vatOutputPence: -(by[acct.vatOutput] ?? 0),
      providerCostPence: rows.filter((r) => r.account.startsWith('cost:provider:')).reduce((s, r) => s + Number(r.s), 0),
      payables,
      trialBalancePence: await this.ledger.trialBalance(),
    };
  }
}
