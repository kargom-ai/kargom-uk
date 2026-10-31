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
  base_postcode TEXT,                         -- where the company is based (for "companies near you")
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
  share_token       TEXT,                     -- secret link to the PDF sheet the customer can send to companies
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

-- Customers asking us to bring a company they found on Google onto Kargom (partner leads).
CREATE TABLE IF NOT EXISTS partner_invites (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES jobs(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  place_id    TEXT NOT NULL,                  -- Google place ID (allowed to keep)
  name        TEXT NOT NULL,
  website     TEXT,
  area        TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (job_id, place_id)
);

-- Parcel forwarding ("shop abroad, we forward it"): people who want a Kargom address before it opens.
CREATE TABLE IF NOT EXISTS forwarding_waitlist (
  email       TEXT PRIMARY KEY,
  from_country TEXT NOT NULL,
  to_country  TEXT NOT NULL,
  customer_id TEXT,
  created_at  TEXT NOT NULL
);

-- Weekly container market index (Drewry WCI, entered by the admin each week). One row per week.
CREATE TABLE IF NOT EXISTS market_index (
  week       TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  source     TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Turkey warehouse (shop in Turkey, we forward to the UK).
CREATE TABLE IF NOT EXISTS fw_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fw_suites (
  customer_id TEXT PRIMARY KEY REFERENCES customers(id),
  code        TEXT NOT NULL UNIQUE,            -- KG48213: goes on every order's address
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fw_couriers (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,                 -- "UPS Express Saver"
  active        INTEGER NOT NULL DEFAULT 1,
  divisor       INTEGER NOT NULL DEFAULT 5000, -- volumetric: L×W×H cm / divisor = kg
  fuel_bp       INTEGER NOT NULL DEFAULT 0,    -- fuel surcharge on the rate, basis points
  rates         TEXT NOT NULL,                 -- JSON [[upToKg, pence], …] ascending
  extra_kg_pence INTEGER NOT NULL DEFAULT 0,   -- each kg above the last band (0 = not allowed)
  max_kg        INTEGER NOT NULL DEFAULT 30,
  days_min      INTEGER NOT NULL DEFAULT 2,
  days_max      INTEGER NOT NULL DEFAULT 5,
  tracking_url  TEXT,                          -- https://…{n}… ({n} = tracking number)
  note          TEXT,
  sort          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fw_packages (
  id               TEXT PRIMARY KEY,
  customer_id      TEXT NOT NULL REFERENCES customers(id),
  status           TEXT NOT NULL,              -- expected | received | requested | shipped | discarded
  store            TEXT,
  order_no         TEXT,
  inbound_tracking TEXT,
  description      TEXT,
  value_try        INTEGER,                    -- what the customer paid, whole lira
  weight_g         INTEGER,
  dims             TEXT,                       -- "40x30x20" cm, as measured on arrival
  admin_note       TEXT,
  hold             INTEGER NOT NULL DEFAULT 0, -- customer asked us to keep it for now
  shipment_id      TEXT,
  received_at      TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fw_packages_customer ON fw_packages(customer_id);
CREATE TABLE IF NOT EXISTS fw_shipments (
  id           TEXT PRIMARY KEY,
  ref          TEXT NOT NULL UNIQUE,           -- TR-10001
  customer_id  TEXT NOT NULL REFERENCES customers(id),
  status       TEXT NOT NULL,                  -- requested | quoted | paid | shipped | delivered | cancelled
  address      TEXT NOT NULL,                  -- JSON UK delivery address
  note         TEXT,
  weight_g     INTEGER,
  dims         TEXT,
  quotes       TEXT,                           -- JSON price per courier, fixed when we measure
  courier_id   TEXT,
  courier_name TEXT,
  price_pence  INTEGER,
  paid_via     TEXT,                           -- wallet | card
  payment_ref  TEXT,
  tracking_no  TEXT,
  tracking_url TEXT,
  admin_note   TEXT,
  created_at   TEXT NOT NULL,
  quoted_at    TEXT,
  paid_at      TEXT,
  shipped_at   TEXT,
  delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS fw_shipments_customer ON fw_shipments(customer_id);
-- Turkey warehouse: "buy it for me" requests, and messages/photos about one parcel.
CREATE TABLE IF NOT EXISTS fw_buys (
  id          TEXT PRIMARY KEY,
  ref         TEXT NOT NULL UNIQUE,             -- BUY-1001
  customer_id TEXT NOT NULL REFERENCES customers(id),
  status      TEXT NOT NULL,                    -- requested | quoted | paid | ordered | rejected | cancelled
  url         TEXT NOT NULL,
  details     TEXT,                             -- size, colour, notes from the customer
  qty         INTEGER NOT NULL DEFAULT 1,
  store       TEXT,
  item_try    INTEGER,                          -- shop price in lira, from us
  price_pence INTEGER,                          -- what the customer pays us (item + our fee)
  admin_note  TEXT,
  paid_via    TEXT,
  payment_ref TEXT,
  package_id  TEXT,                             -- the parcel once we have ordered it
  created_at  TEXT NOT NULL,
  quoted_at   TEXT,
  paid_at     TEXT,
  ordered_at  TEXT
);
CREATE INDEX IF NOT EXISTS fw_buys_customer ON fw_buys(customer_id);
CREATE TABLE IF NOT EXISTS fw_notes (
  id          TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  package_id  TEXT NOT NULL,
  author      TEXT NOT NULL,                    -- admin | customer
  body        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fw_notes_package ON fw_notes(package_id);
CREATE TABLE IF NOT EXISTS fw_photos (
  id          TEXT PRIMARY KEY,
  note_id     TEXT NOT NULL,
  package_id  TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  data        TEXT NOT NULL,                    -- JPEG data URL, resized in the browser
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fw_photos_package ON fw_photos(package_id);
-- In-app notifications for customers: the bell and the red counts in the left menu.
CREATE TABLE IF NOT EXISTS inbox (
  id          TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  area        TEXT NOT NULL,                    -- ship | tr | req | wallet | help
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,
  read_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inbox_customer ON inbox(customer_id, created_at);
-- Store integrations (Shopify first): a seller's connected shop and the orders waiting to be shipped.
CREATE TABLE IF NOT EXISTS shop_connections (
  id           TEXT PRIMARY KEY,
  customer_id  TEXT NOT NULL REFERENCES customers(id),
  platform     TEXT NOT NULL,                   -- shopify
  shop         TEXT NOT NULL,                   -- example.myshopify.com
  shop_name    TEXT,
  token        TEXT,                            -- access token, sealed with MASTER_KEY; NULL once uninstalled
  scopes       TEXT,
  status       TEXT NOT NULL,                   -- active | uninstalled
  last_sync_at TEXT,
  created_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS shop_connections_shop ON shop_connections(platform, shop);
CREATE INDEX IF NOT EXISTS shop_connections_customer ON shop_connections(customer_id);
CREATE TABLE IF NOT EXISTS shop_oauth_states (
  state       TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  shop        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shop_orders (
  id             TEXT PRIMARY KEY,
  connection_id  TEXT NOT NULL REFERENCES shop_connections(id),
  customer_id    TEXT NOT NULL,
  external_id    TEXT NOT NULL,                 -- gid://shopify/Order/123
  name           TEXT NOT NULL,                 -- #1001
  ordered_at     TEXT NOT NULL,
  buyer_email    TEXT,
  ship_to        TEXT NOT NULL,                 -- JSON address
  items          TEXT NOT NULL,                 -- JSON [{name, quantity, sku, valuePence}]
  weight_grams   INTEGER NOT NULL DEFAULT 0,
  total_pence    INTEGER NOT NULL DEFAULT 0,
  currency       TEXT,
  fulfillment_orders TEXT NOT NULL,             -- JSON [gid]
  status         TEXT NOT NULL,                 -- open | shipped | ignored
  shipment_id    TEXT,
  pushed_at      TEXT,
  push_error     TEXT,
  synced_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS shop_orders_ext ON shop_orders(connection_id, external_id);
CREATE INDEX IF NOT EXISTS shop_orders_customer ON shop_orders(customer_id, status, ordered_at);
