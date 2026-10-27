# Kargom.co.uk backend

Parcel price comparison, booking, customer wallet, weight adjustments, support
and admin API for kargom.co.uk. TypeScript on Node 22, no runtime dependencies.

```
npm test            # 27 tests: money, ledger, booking saga, adjustments, webhooks, support, HTTP
npm run typecheck   # strict TypeScript
npm start           # API on :8080 (dev: SQLite file, fake payments, mock courier)
```

Node 22.18+ runs the `.ts` files directly (type stripping), so there is no build step.

## How money moves

Every amount is an integer number of pence. Every movement is a balanced
double-entry ledger posting with an idempotency key, so retries and duplicate
webhooks can never double-charge. `trialBalance()` must always be 0.

| Event | Ledger |
|---|---|
| Wallet top-up (Stripe `payment_intent.succeeded`, purpose `topup`) | cash:stripe ↑, wallet:customer ↑ |
| Book with wallet | wallet → hold (same DB transaction as creating the shipment; fails cleanly if short) |
| Book with card | Stripe PaymentIntent → webhook funds the hold from cash:stripe |
| Label bought | hold → revenue:labels + vat:output; cost:provider ↑ / payable:provider ↑ |
| Label purchase failed | hold → wallet (wallet) or Stripe refund + hold → cash (card) |
| Weight adjustment charged | wallet (or cash:stripe via saved card) → revenue + VAT |
| Admin waive / credit | revenue + VAT → wallet |

## Weight adjustments (the rule you asked for)

When a courier re-weighs or re-measures a parcel we re-price **the same
service** at the measured size (billable weight = max(actual, L×W×H/5000)).

* Same price (same weight band) → `no_charge`. Nothing is taken. Show it yellow.
* Dearer → the difference is taken from the wallet, else the saved card
  (off-session, Stripe). Show it red.
* Both fail → `failed`; bookings pause automatically once unpaid adjustments
  pass £20, and reopen when paid or waived.

Measurements arrive as normalised events from three places: provider webhooks
(where the provider sends them), carrier invoice import, or the admin
`POST /api/admin/measurements` endpoint. Most UK carriers report weight
adjustments on their invoices rather than in real time, so the invoice import
is the reliable path.

## Shipping providers

`src/providers/shipengine.ts` talks to ShipEngine-style APIs. ShipStation's API
v2 uses the same model (rates → buy label from a rate → void), so one adapter
serves both; configure it from the admin Connections screen
(`PUT /api/admin/providers/shipstation` with `apiKey` and `carrierIds`). Keys are
encrypted with AES-256-GCM (`MASTER_KEY`) and only ever shown masked.
**Verify the ShipStation v2 base URL and carrier ids against your account before
going live**; the adapter has unit coverage through the mock, not live calls.

Quotes ask every connected provider in parallel with a timeout; a slow or broken
provider is skipped and reported. When two providers sell the same service, the
cheaper cost wins. The customer gets a signed, 15-minute quote token; the
browser never sees our cost and cannot change the price.

## Environment

| Variable | |
|---|---|
| `DATABASE_PATH` | SQLite file (dev). Production: Postgres, see below |
| `QUOTE_SECRET` | 32+ random characters, signs quote tokens |
| `MASTER_KEY` | base64 of 32 random bytes, encrypts provider keys |
| `CARRIER_WEBHOOK_TOKEN` | random string; webhook URL is `/webhooks/carrier/<provider>/<token>` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe; webhook URL is `/webhooks/stripe` |
| `QUOTE_TIMEOUT_MS`, `QUOTE_TTL_MS` | defaults 2500 and 900000 |

## API

Customer (Bearer token or `kg_session` cookie + `X-Requested-With: kargom`):
`POST /api/auth/register|login|logout`, `POST /api/quotes`,
`POST /api/bookings` (needs `Idempotency-Key`), `GET /api/shipments[/:id]`,
`GET /api/wallet`, `POST /api/wallet/topups`, `GET /api/adjustments`,
`POST /api/adjustments/:id/dispute`, `GET|POST /api/tickets`,
`GET /api/tickets/:id`, `POST /api/tickets/:id/messages|solve|reopen`.

Admin: `/api/admin/overview`, `/shipments`, `/customers`, `/customers/:id`
(full profile: shipments, addresses, wallet, adjustments, tickets),
`/customers/:id/pause|credit`, `/adjustments`, `/adjustments/:id/charge|waive`,
`/measurements`, `/tickets`, `/tickets/:id/reply`, `/finance`, `/providers`,
`/providers/:id/test`, `/pricing`.

## Not done yet

1. **Postgres adapter** (`src/db/postgres.ts`) — needs the `pg` driver; the
   schema and SQL are already portable. The package registry was blocked in the
   build environment.
2. **Web front end** — the customer panel, booking flow and admin panel from the
   designs, built against this API.
3. **Live provider checks** — ShipStation/ShipEngine and Stripe were not called
   for real; run `/api/admin/providers/:id/test` with sandbox keys first.
4. **Carrier invoice import** for weight adjustments (CSV per carrier).
5. Email/SMS notifications, a reconciliation job for labels bought but not
   recorded (crash between purchase and commit), and backups/monitoring.
