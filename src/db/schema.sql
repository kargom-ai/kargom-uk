-- Kargom schema. Portable between SQLite (dev/test) and Postgres (production).
-- Money columns are integer pence. Timestamps are ISO-8601 UTC strings.

CREATE TABLE IF NOT EXISTS customers (
  id                 TEXT PRIMARY KEY,
  email              TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  company            TEXT,
  phone              TEXT,
  account_type       TEXT NOT NULL DEFAULT 'personal',   -- personal | business
  role               TEXT NOT NULL DEFAULT 'customer',   -- customer | admin
  password_hash      TEXT NOT NULL,
  bookings_paused    INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id TEXT,
  default_payment_method TEXT,                           -- Stripe pm_… saved for off-session charges
  pricing_discount_bp INTEGER NOT NULL DEFAULT 0,        -- discount on markup, in basis points
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  expires_at  TEXT NOT NULL
);

-- Double-entry ledger. Every entry's lines sum to zero.
-- Line amount > 0 is a debit, < 0 a credit. Wallets are liabilities, so a
-- customer's wallet balance is the NEGATIVE of the sum of its lines.
CREATE TABLE IF NOT EXISTS ledger_entries (
  id              TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  kind            TEXT NOT NULL,          -- topup | hold | capture | release | refund | adjustment | card_sale | credit
  ref             TEXT,                   -- shipment / payment / adjustment id
  memo            TEXT,
  created_at      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger_lines (
  entry_id TEXT NOT NULL REFERENCES ledger_entries(id),
  account  TEXT NOT NULL,
  amount   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_lines_account ON ledger_lines(account);

CREATE TABLE IF NOT EXISTS holds (
  id          TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  amount      INTEGER NOT NULL,
  status      TEXT NOT NULL,             -- held | captured | released
  ref         TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shipments (
  id                 TEXT PRIMARY KEY,
  ref                TEXT NOT NULL UNIQUE,      -- KGM-UK-10483
  customer_id        TEXT NOT NULL REFERENCES customers(id),
  idempotency_key    TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL,             -- pending | booked | collected | in_transit | out_for_delivery | delivered | exception | cancelled | failed
  provider           TEXT NOT NULL,
  provider_rate_id   TEXT,
  provider_label_id  TEXT,
  carrier            TEXT NOT NULL,
  service_code       TEXT NOT NULL,
  service_name       TEXT NOT NULL,
  tracking_number    TEXT,
  label_url          TEXT,
  from_json          TEXT NOT NULL,
  to_json            TEXT NOT NULL,
  parcel_json        TEXT NOT NULL,             -- declared weight + dims
  cost_pence         INTEGER NOT NULL,          -- what the provider charges us (net)
  price_pence        INTEGER NOT NULL,          -- what the customer pays (gross, inc VAT)
  vat_pence          INTEGER NOT NULL,
  pay_method         TEXT NOT NULL,             -- wallet | card
  payment_ref        TEXT,                      -- hold id or Stripe payment intent id
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS shipments_customer ON shipments(customer_id, created_at);
CREATE INDEX IF NOT EXISTS shipments_tracking ON shipments(tracking_number);

CREATE TABLE IF NOT EXISTS shipment_seq (n INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS adjustments (
  id               TEXT PRIMARY KEY,
  shipment_id      TEXT NOT NULL REFERENCES shipments(id),
  source_event_id  TEXT NOT NULL,              -- provider event id, for idempotency
  measured_json    TEXT NOT NULL,
  old_price_pence  INTEGER NOT NULL,
  new_price_pence  INTEGER NOT NULL,
  diff_pence       INTEGER NOT NULL,           -- 0 when the measured size costs the same
  status           TEXT NOT NULL,              -- pending | no_charge | charged | failed | waived | disputed
  method           TEXT,                       -- wallet | card
  payment_ref      TEXT,
  created_at       TEXT NOT NULL,
  UNIQUE (shipment_id, source_event_id)
);

CREATE TABLE IF NOT EXISTS tracking_events (
  id          TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id),
  status      TEXT NOT NULL,
  description TEXT,
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  provider    TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE IF NOT EXISTS tickets (
  id          TEXT PRIMARY KEY,
  ref         TEXT NOT NULL UNIQUE,            -- T-1045
  customer_id TEXT NOT NULL REFERENCES customers(id),
  shipment_id TEXT REFERENCES shipments(id),
  category    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  status      TEXT NOT NULL,                   -- waiting_us | waiting_customer | solved
  priority    TEXT NOT NULL DEFAULT 'normal',  -- low | normal | high | urgent
  assignee_id TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id          TEXT PRIMARY KEY,
  ticket_id   TEXT NOT NULL REFERENCES tickets(id),
  author_type TEXT NOT NULL,                   -- customer | agent | note
  author_id   TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pricing_rules (
  service_key TEXT PRIMARY KEY,                -- "*" = default, or "<carrier>:<service_code>"
  markup_bp   INTEGER NOT NULL,
  fixed_pence INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_configs (
  id          TEXT PRIMARY KEY,                -- shipstation | shipengine | easypost | stripe ...
  kind        TEXT NOT NULL,                   -- shipping | payment
  mode        TEXT NOT NULL DEFAULT 'test',    -- test | live
  enabled     INTEGER NOT NULL DEFAULT 0,
  secrets_enc TEXT,                            -- AES-256-GCM encrypted JSON
  updated_at  TEXT NOT NULL
);

-- Guest checkout: a secret link per shipment, so someone without an account can
-- view, print and share their label. Only the hash of the link token is stored.
CREATE TABLE IF NOT EXISTS guest_links (
  token_hash  TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id),
  email       TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS guest_links_shipment ON guest_links(shipment_id);

-- One row per message we send about a shipment, so each customer gets each message once.
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id),
  channel     TEXT NOT NULL,               -- whatsapp | sms
  kind        TEXT NOT NULL,               -- label_ready
  to_number   TEXT NOT NULL,
  status      TEXT NOT NULL,               -- sending | sent | failed
  detail      TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (shipment_id, channel, kind)
);

-- ---------------------------------------------------------------------------
-- Moving & freight marketplace: customers post a request, partner companies
-- (removal firms and road hauliers) send offers, the customer picks one.
-- Payment columns are ready for the next step (paying the chosen offer by card
-- through Kargom); until then the customer and partner settle between themselves.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS partners (
  id          TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL UNIQUE REFERENCES customers(id),   -- the login behind the company
  kind        TEXT NOT NULL,                  -- removals | freight
  company     TEXT NOT NULL,
  phone       TEXT NOT NULL,
  email       TEXT NOT NULL,
  website     TEXT,
  about       TEXT,
  areas       TEXT,                           -- free text: where they work
  fleet       TEXT,                           -- free text: vans / lorries
  logo        TEXT,                           -- small image as a data URL
  status      TEXT NOT NULL DEFAULT 'active', -- active | suspended
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id                TEXT PRIMARY KEY,
  ref               INTEGER NOT NULL UNIQUE,  -- shown as #1042
  customer_id       TEXT NOT NULL REFERENCES customers(id),
  kind              TEXT NOT NULL,            -- removals | freight
  status            TEXT NOT NULL,            -- open | booked | cancelled | completed
  title             TEXT NOT NULL,            -- "2 bedroom home move", "FTL · 26t rigid"
  details           TEXT NOT NULL,            -- JSON: everything the customer filled in
  from_addr         TEXT NOT NULL,            -- JSON address
  to_addr           TEXT NOT NULL,
  from_area         TEXT NOT NULL,            -- "Manchester M1" (what partners see before booking)
  to_area           TEXT NOT NULL,
  distance_miles    REAL,
  move_date         TEXT,                     -- YYYY-MM-DD
  contact_phone     TEXT NOT NULL,
  accepted_offer_id TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_customer ON jobs(customer_id, created_at);
CREATE INDEX IF NOT EXISTS jobs_open ON jobs(kind, status, created_at);

CREATE TABLE IF NOT EXISTS job_photos (
  id         TEXT PRIMARY KEY,
  job_id     TEXT NOT NULL REFERENCES jobs(id),
  data       TEXT NOT NULL,                   -- JPEG data URL, resized in the browser
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS job_photos_job ON job_photos(job_id);

CREATE TABLE IF NOT EXISTS job_offers (
  id             TEXT PRIMARY KEY,
  job_id         TEXT NOT NULL REFERENCES jobs(id),
  partner_id     TEXT NOT NULL REFERENCES partners(id),
  price_pence    INTEGER NOT NULL,            -- total the customer pays, inc VAT
  message        TEXT,
  vehicle        TEXT,
  available_date TEXT,
  valid_until    TEXT,
  status         TEXT NOT NULL,               -- pending | accepted | declined | withdrawn
  -- marketplace payments (not live yet)
  platform_fee_pence INTEGER,
  payment_status     TEXT,                    -- null | requires_payment | paid | refunded
  payment_ref        TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (job_id, partner_id)
);
CREATE INDEX IF NOT EXISTS job_offers_partner ON job_offers(partner_id, created_at);

CREATE TABLE IF NOT EXISTS partner_reviews (
  id          TEXT PRIMARY KEY,
  partner_id  TEXT NOT NULL REFERENCES partners(id),
  job_id      TEXT NOT NULL UNIQUE REFERENCES jobs(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  rating      INTEGER NOT NULL,               -- 1..5
  comment     TEXT,
  author      TEXT NOT NULL,                  -- "Sarah M."
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS partner_reviews_partner ON partner_reviews(partner_id, created_at);
