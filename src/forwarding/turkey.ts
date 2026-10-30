import { randomInt } from 'node:crypto';
import type { Db, Param, Queryable } from '../db/db.ts';
import type { Clock } from '../core/clock.ts';
import { AppError } from '../core/errors.ts';
import { newId } from '../core/ids.ts';
import { acct, type Ledger } from '../ledger/ledger.ts';
import type { Wallet } from '../wallet/wallet.ts';
import type { PaymentGateway } from '../payments/stripe.ts';
import { cachedPreview, isShopLink, type Preview } from './preview.ts';

/**
 * Turkey warehouse: the customer shops on Trendyol, Hepsiburada, Amazon.com.tr… using our
 * Istanbul warehouse address plus their own suite code. We log each parcel when it arrives,
 * keep it free for a while, combine parcels if asked, then measure the box, price it with the
 * courier rates the admin entered, take payment, and send it to the UK.
 *
 * Money: forwarding revenue goes to its own ledger account (revenue:forwarding). Prices are
 * shown and charged as entered; no VAT is split out (international transport, ask your
 * accountant if your set-up differs).
 */

export const FW_REVENUE = 'revenue:forwarding';
/** Buy-for-me money: the goods we buy for the customer plus our fee (split it with your accountant). */
export const FW_BUY = 'revenue:buy_for_me';

/** Turkish shops we know: logo (favicon) and recognising a product link. */
export const SHOP_DOMAINS: Record<string, string> = {
  Trendyol: 'trendyol.com', Hepsiburada: 'hepsiburada.com', 'Amazon.com.tr': 'amazon.com.tr', N11: 'n11.com', 'Çiçeksepeti': 'ciceksepeti.com', Koton: 'koton.com',
  'LC Waikiki': 'lcw.com', DeFacto: 'defacto.com.tr', Boyner: 'boyner.com.tr', Mavi: 'mavi.com', 'Pazarama': 'pazarama.com', 'Morhipo': 'morhipo.com',
};
export function storeFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    for (const [name, d] of Object.entries(SHOP_DOMAINS)) if (host === d || host.endsWith(`.${d}`)) return name;
    return host;
  } catch { return 'Other'; }
}
const shopIcons = new Map<string, { type: string; data: Buffer }>();
/** Shop logo through our server (the page's CSP only allows our own images). Known shops only. */
export async function shopIcon(name: string, f: typeof fetch = fetch) {
  const domain = SHOP_DOMAINS[name];
  if (!domain) throw new AppError('not_found', 'Unknown shop');
  const hit = shopIcons.get(domain);
  if (hit) return hit;
  try {
    const r = await f(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`, { signal: AbortSignal.timeout(5000) });
    const type = r.headers.get('content-type') ?? 'image/png';
    const data = Buffer.from(await r.arrayBuffer());
    if (r.ok && type.startsWith('image/') && data.length > 200) { const v = { type, data }; shopIcons.set(domain, v); return v; }
  } catch { /* fall through */ }
  // The page shows the shop's first letter underneath when there is no logo.
  throw new AppError('not_found', 'No logo');
}
const MAX_PHOTOS = 6;
const dataUrl = (img: Preview['image']) => (img ? `data:${img.type};base64,${img.data.toString('base64')}` : null);
const photosIn = (v: unknown): string[] => (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(x) && x.length < 3_200_000).slice(0, MAX_PHOTOS);

type BuyRow = { id: string; ref: string; customer_id: string; status: string; url: string; details: string | null; qty: number; store: string | null; item_try: number | null;
  price_pence: number | null; admin_note: string | null; paid_via: string | null; payment_ref: string | null; package_id: string | null; created_at: string; quoted_at: string | null;
  paid_at: string | null; ordered_at: string | null; title?: string | null; image?: string | null };
const buyOut = (b: BuyRow) => ({ id: b.id, ref: b.ref, customerId: b.customer_id, status: b.status, url: b.url, details: b.details, qty: b.qty, store: b.store, itemTry: b.item_try,
  pricePence: b.price_pence, note: b.admin_note, paidVia: b.paid_via, packageId: b.package_id, createdAt: b.created_at, quotedAt: b.quoted_at, paidAt: b.paid_at, orderedAt: b.ordered_at,
  title: b.title ?? null, image: b.image ? `/api/tr/img/buy/${b.id}` : null });

export type FwSettings = {
  whName: string; whLine1: string; whLine2: string; whDistrict: string; whCity: string; whPostcode: string; whPhone: string;
  handlingPence: number;       // per shipment: repack, paperwork
  consolidatePence: number;    // per extra parcel combined into the box
  freeDays: number;            // free storage from arrival
  storagePencePerDay: number;  // per parcel, after the free days
};
const DEFAULTS: FwSettings = {
  whName: 'Kargom Depo', whLine1: '', whLine2: '', whDistrict: '', whCity: 'İstanbul', whPostcode: '', whPhone: '',
  handlingPence: 300, consolidatePence: 200, freeDays: 30, storagePencePerDay: 10,
};
const NUM_KEYS = new Set(['handlingPence', 'consolidatePence', 'freeDays', 'storagePencePerDay']);

export type Courier = {
  id: string; name: string; active: boolean; divisor: number; fuelBp: number; rates: Array<[number, number]>;
  extraKgPence: number; maxKg: number; daysMin: number; daysMax: number; trackingUrl: string | null; note: string | null; sort: number;
  logo?: string | null; logoUrl?: string | null;
};
export type CourierQuote = {
  courierId: string; name: string; pence: number; daysMin: number; daysMax: number; chargeableKg: number;
  breakdown: { shipping: number; fuel: number; handling: number; consolidation: number; storage: number };
};

export const STORES = ['Trendyol', 'Hepsiburada', 'Amazon.com.tr', 'N11', 'Çiçeksepeti', 'Koton', 'LC Waikiki', 'DeFacto', 'Boyner', 'Other'];
const PKG_OPEN = ['expected', 'received'];

const int = (v: unknown, name: string, min: number, max: number): number => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) throw new AppError('bad_request', `${name} must be between ${min} and ${max}`);
  return n;
};
const text = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : '';
  return s || null;
};
/** '' (guess from name), 'none', 'preset:dhl', or an uploaded small image as a data URL. */
const parseLogo = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  if (s === 'none') return 'none';
  if (s.startsWith('preset:') && COURIER_LOGOS[s.slice(7)]) return s;
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s) && s.length < 300_000) return s;
  throw new AppError('bad_request', 'The logo must be a PNG, JPG or WebP picture under 200 KB');
};
const kgToG = (v: unknown, name = 'Weight'): number => {
  const kg = Number(String(v ?? '').replace(',', '.'));
  if (!(kg > 0 && kg <= 300)) throw new AppError('bad_request', `${name}: enter kg (up to 300)`);
  return Math.round(kg * 1000);
};
/** "40x30x20", "40 × 30 × 20", or {l,w,h} → [l,w,h] in cm. */
export function parseDims(v: unknown): [number, number, number] | null {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    v = `${o.l ?? ''}x${o.w ?? ''}x${o.h ?? ''}`;
  }
  const m = String(v ?? '').replace(',', '.').match(/^\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*$/i);
  if (!m) return null;
  const d = [m[1], m[2], m[3]].map((x) => Math.ceil(Number(x))) as [number, number, number];
  return d.every((x) => x > 0 && x <= 300) ? d : null;
}
const dimsText = (d: [number, number, number] | null) => (d ? d.join('x') : null);

/** "0.5 = 8.50" lines (kg = £) or [[kg, pence]] → sorted bands. */
export function parseRates(v: unknown): Array<[number, number]> {
  let rows: Array<[number, number]> = [];
  if (Array.isArray(v)) rows = v.map((r: unknown) => { const a = Array.isArray(r) ? r : []; return [Number(a[0]), Math.round(Number(a[1]))] as [number, number]; });
  else {
    for (const line of String(v ?? '').split(/\n|;/)) {
      if (!line.trim()) continue;
      const m = line.replace(/£/g, '').replace(/kg/ig, '').match(/^\s*(\d+(?:[.,]\d+)?)\s*[=:\t ]\s*(\d+(?:[.,]\d+)?)\s*$/);
      if (!m) throw new AppError('bad_request', `Rate line not understood: "${line.trim()}". Write it like 0.5 = 8.50`);
      rows.push([Number(m[1]!.replace(',', '.')), Math.round(Number(m[2]!.replace(',', '.')) * 100)]);
    }
  }
  rows = rows.filter(([kg, p]) => kg > 0 && kg <= 300 && p >= 0 && p <= 1_000_000).sort((a, b) => a[0] - b[0]);
  if (!rows.length) throw new AppError('bad_request', 'Add at least one rate line, e.g. 1 = 12.50');
  return rows;
}

/** Chargeable weight: the bigger of the real weight and the box's volumetric weight, up to the next 0.5 kg. */
export function chargeableKg(weightG: number, dims: [number, number, number] | null, divisor: number): number {
  const real = weightG / 1000;
  const vol = dims ? (dims[0] * dims[1] * dims[2]) / Math.max(1000, divisor) : 0;
  return Math.ceil(Math.max(real, vol, 0.1) * 2) / 2;
}

/** Shipping price for one courier, before our fees. null = this courier cannot take it. */
export function courierPrice(c: Pick<Courier, 'rates' | 'extraKgPence' | 'maxKg' | 'fuelBp'>, kg: number): { shipping: number; fuel: number } | null {
  if (kg > c.maxKg || !c.rates.length) return null;
  const band = c.rates.find(([upTo]) => kg <= upTo + 1e-9);
  let shipping: number;
  if (band) shipping = band[1];
  else {
    if (!c.extraKgPence) return null;
    const [lastKg, lastP] = c.rates[c.rates.length - 1]!;
    shipping = lastP + Math.ceil(kg - lastKg) * c.extraKgPence;
  }
  return { shipping, fuel: Math.round((shipping * c.fuelBp) / 10_000) };
}

/** Price for every active courier, cheapest first, with our handling, combining and storage fees. */
export function quoteAll(couriers: Courier[], s: FwSettings, input: { weightG: number; dims: [number, number, number] | null; parcels: number; storagePence: number }): CourierQuote[] {
  const out: CourierQuote[] = [];
  const consolidation = Math.max(0, input.parcels - 1) * s.consolidatePence;
  for (const c of couriers.filter((x) => x.active)) {
    const kg = chargeableKg(input.weightG, input.dims, c.divisor);
    const p = courierPrice(c, kg);
    if (!p) continue;
    const breakdown = { shipping: p.shipping, fuel: p.fuel, handling: s.handlingPence, consolidation, storage: input.storagePence };
    out.push({ courierId: c.id, name: c.name, pence: Object.values(breakdown).reduce((a, b) => a + b, 0), daysMin: c.daysMin, daysMax: c.daysMax, chargeableKg: kg, breakdown });
  }
  return out.sort((a, b) => a.pence - b.pence);
}

/** Storage owed for one parcel: days past the free period × daily fee. */
export function storageFor(receivedAt: string | null, now: Date, s: FwSettings): number {
  if (!receivedAt || !s.storagePencePerDay) return 0;
  const days = Math.floor((now.getTime() - new Date(receivedAt).getTime()) / 86_400_000);
  return Math.max(0, days - s.freeDays) * s.storagePencePerDay;
}

type PkgRow = { id: string; customer_id: string; status: string; store: string | null; order_no: string | null; inbound_tracking: string | null; description: string | null;
  value_try: number | null; weight_g: number | null; dims: string | null; admin_note: string | null; hold: number; shipment_id: string | null; received_at: string | null; created_at: string;
  auto_send?: number; auto_pref?: string | null; product_url?: string | null; product_title?: string | null; image?: string | null };
type ShipRow = { id: string; ref: string; customer_id: string; status: string; address: string; note: string | null; weight_g: number | null; dims: string | null; quotes: string | null;
  courier_id: string | null; courier_name: string | null; price_pence: number | null; paid_via: string | null; payment_ref: string | null; tracking_no: string | null; tracking_url: string | null;
  admin_note: string | null; created_at: string; quoted_at: string | null; paid_at: string | null; shipped_at: string | null; delivered_at: string | null };
type CourierRow = { id: string; name: string; active: number; divisor: number; fuel_bp: number; rates: string; extra_kg_pence: number; max_kg: number; days_min: number; days_max: number;
  tracking_url: string | null; note: string | null; sort: number; logo?: string | null };

/** Ready-made courier logos (files in public/assets/carriers). */
export const COURIER_LOGOS: Record<string, string> = { dhl: 'DHL', fedex: 'FedEx', ups: 'UPS' };
/** The picture to show: an uploaded logo, a ready-made one, or a guess from the name (DHL Express → DHL). */
export function courierLogoUrl(logo: string | null | undefined, name: string): string | null {
  if (logo === 'none') return null;
  if (logo?.startsWith('data:image/')) return logo;
  const preset = logo?.startsWith('preset:') ? logo.slice(7) : Object.keys(COURIER_LOGOS).find((k) => name.toLowerCase().replace(/\s/g, '').includes(k));
  return preset && COURIER_LOGOS[preset] ? `/assets/carriers/${preset}.png` : null;
}

const toCourier = (r: CourierRow): Courier => ({ id: r.id, name: r.name, active: Boolean(r.active), divisor: r.divisor, fuelBp: r.fuel_bp, rates: JSON.parse(r.rates),
  extraKgPence: r.extra_kg_pence, maxKg: r.max_kg, daysMin: r.days_min, daysMax: r.days_max, trackingUrl: r.tracking_url, note: r.note, sort: r.sort,
  logo: r.logo ?? null, logoUrl: courierLogoUrl(r.logo, r.name) });
const pkgOut = (p: PkgRow) => ({ id: p.id, customerId: p.customer_id, status: p.status, store: p.store, orderNo: p.order_no, tracking: p.inbound_tracking, description: p.description, valueTry: p.value_try,
  weightKg: p.weight_g ? p.weight_g / 1000 : null, dims: p.dims, note: p.admin_note, hold: Boolean(p.hold), shipmentId: p.shipment_id, receivedAt: p.received_at, createdAt: p.created_at,
  autoSend: Boolean(p.auto_send), autoPref: p.auto_pref === 'fastest' ? 'fastest' : 'cheapest',
  productUrl: p.product_url ?? null, productTitle: p.product_title ?? null, image: p.image ? `/api/tr/img/pkg/${p.id}` : null });
const shipOut = (s: ShipRow) => ({ id: s.id, ref: s.ref, status: s.status, address: JSON.parse(s.address), note: s.note, weightKg: s.weight_g ? s.weight_g / 1000 : null, dims: s.dims,
  quotes: s.quotes ? (JSON.parse(s.quotes) as CourierQuote[]) : [], courierId: s.courier_id, courierName: s.courier_name, pricePence: s.price_pence, paidVia: s.paid_via,
  trackingNo: s.tracking_no, trackingUrl: s.tracking_url, adminNote: s.admin_note, createdAt: s.created_at, quotedAt: s.quoted_at, paidAt: s.paid_at, shippedAt: s.shipped_at, deliveredAt: s.delivered_at });

export type UkAddress = { name: string; line1: string; line2: string | null; city: string; postcode: string; phone: string; email: string | null };
/** A UK delivery address, checked. Throws a message the customer can act on. */
export function parseUkAddress(v: unknown): UkAddress {
  const a = (v ?? {}) as Record<string, unknown>;
  const address = { name: text(a.name, 80), line1: text(a.line1, 120), line2: text(a.line2, 120), city: text(a.city, 80), postcode: text(a.postcode, 10)?.toUpperCase() ?? null, phone: text(a.phone, 30), email: text(a.email, 120) };
  if (!address.name || !address.line1 || !address.city || !address.postcode) throw new AppError('bad_request', 'Enter the UK delivery address: name, street, town and postcode');
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/.test(address.postcode)) throw new AppError('bad_request', 'Enter a valid UK postcode');
  if (!address.phone || address.phone.replace(/\D/g, '').length < 10) throw new AppError('bad_request', 'Enter a phone number: couriers need it for delivery and customs');
  return address as UkAddress;
}
const pickQuote = (quotes: CourierQuote[], pref: string | null | undefined) =>
  pref === 'fastest' ? [...quotes].sort((a, b) => a.daysMax - b.daysMax || a.daysMin - b.daysMin || a.pence - b.pence)[0] : quotes[0];

export type FwNotify = (customerId: string, subject: string, heading: string, lines: string[], link: { href: string; text: string }) => Promise<unknown>;

export class TurkeyForwarding {
  notify: FwNotify | null = null;
  publicUrl = '';
  private readonly db: Db;
  private readonly clock: Clock;
  private readonly ledger: Ledger;
  private readonly wallet: Wallet;
  private readonly payments: PaymentGateway;
  constructor(db: Db, clock: Clock, ledger: Ledger, wallet: Wallet, payments: PaymentGateway) {
    this.db = db; this.clock = clock; this.ledger = ledger; this.wallet = wallet; this.payments = payments;
  }

  private now() { return this.clock.now().toISOString(); }
  private tell(customerId: string, subject: string, heading: string, lines: string[]) {
    if (!this.notify) return;
    this.notify(customerId, subject, heading, lines, { href: `${this.publicUrl}/app/turkey`, text: 'Open my Turkey parcels' }).catch((e) => console.warn(`[turkey] notify: ${(e as Error).message}`));
  }

  // ---------- settings + couriers
  async settings(q: Queryable = this.db): Promise<FwSettings> {
    const rows = await q.all<{ key: string; value: string }>('SELECT key, value FROM fw_settings');
    const s: Record<string, unknown> = { ...DEFAULTS };
    for (const r of rows) if (r.key in DEFAULTS) s[r.key] = NUM_KEYS.has(r.key) ? Number(r.value) : r.value;
    return s as FwSettings;
  }
  async saveSettings(input: Record<string, unknown>) {
    const cur = await this.settings();
    const next: Record<string, string> = {};
    for (const k of Object.keys(DEFAULTS) as Array<keyof FwSettings>) {
      if (!(k in input)) continue;
      if (k === 'freeDays') next[k] = String(int(input[k], 'Free storage days', 0, 365));
      else if (NUM_KEYS.has(k)) {
        // Money fields are typed in pounds on the admin screen.
        const v = Math.round(Number(String(input[k]).replace(',', '.')) * 100);
        if (!(Number.isFinite(v) && v >= 0 && v <= 100_000)) throw new AppError('bad_request', 'Fees must be between £0 and £1,000');
        next[k] = String(v);
      } else next[k] = String(input[k] ?? '').trim().slice(0, 200);
    }
    for (const [k, v] of Object.entries(next)) {
      await this.db.run('INSERT INTO fw_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [k, v]);
    }
    return { ...cur, ...(await this.settings()) };
  }
  async couriers(q: Queryable = this.db): Promise<Courier[]> {
    return (await q.all<CourierRow>('SELECT * FROM fw_couriers ORDER BY sort, name')).map(toCourier);
  }
  async saveCourier(input: Record<string, unknown>) {
    const name = text(input.name, 80);
    if (!name) throw new AppError('bad_request', 'Courier name is required');
    const rates = parseRates(input.rates);
    const trackingUrl = text(input.trackingUrl, 300);
    if (trackingUrl && !/^https:\/\/[^\s"'<>]+$/i.test(trackingUrl)) throw new AppError('bad_request', 'Tracking link must start with https://');
    const row = {
      name, active: input.active === false || input.active === 'false' || input.active === 0 ? 0 : 1,
      divisor: int(input.divisor ?? 5000, 'Volumetric divisor', 1000, 10_000), fuel_bp: Math.round(Number(input.fuelPct ?? 0) * 100),
      rates: JSON.stringify(rates), extra_kg_pence: Math.round(Number(input.extraKg ?? 0) * 100), max_kg: int(input.maxKg ?? 30, 'Max kg', 1, 300),
      days_min: int(input.daysMin ?? 2, 'Days from', 1, 60), days_max: int(input.daysMax ?? 5, 'Days to', 1, 90), tracking_url: trackingUrl, note: text(input.note, 200),
      sort: int(input.sort ?? 0, 'Order', 0, 999),
      logo: parseLogo(input.logo),
    };
    if (!(row.fuel_bp >= 0 && row.fuel_bp <= 10_000)) throw new AppError('bad_request', 'Fuel surcharge must be 0–100%');
    if (!(row.extra_kg_pence >= 0 && row.extra_kg_pence <= 100_000)) throw new AppError('bad_request', 'Extra kg price is not valid');
    if (row.days_max < row.days_min) row.days_max = row.days_min;
    const id = typeof input.id === 'string' && input.id ? input.id : null;
    if (id) {
      const r = await this.db.run(`UPDATE fw_couriers SET name=$1, active=$2, divisor=$3, fuel_bp=$4, rates=$5, extra_kg_pence=$6, max_kg=$7, days_min=$8, days_max=$9, tracking_url=$10, note=$11, sort=$12, logo=$13 WHERE id=$14`,
        [row.name, row.active, row.divisor, row.fuel_bp, row.rates, row.extra_kg_pence, row.max_kg, row.days_min, row.days_max, row.tracking_url, row.note, row.sort, row.logo, id]);
      if (!r.changes) throw new AppError('not_found', 'Courier not found');
      return { id };
    }
    const nid = newId('frc');
    await this.db.run(`INSERT INTO fw_couriers (id, name, active, divisor, fuel_bp, rates, extra_kg_pence, max_kg, days_min, days_max, tracking_url, note, sort, logo, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [nid, row.name, row.active, row.divisor, row.fuel_bp, row.rates, row.extra_kg_pence, row.max_kg, row.days_min, row.days_max, row.tracking_url, row.note, row.sort, row.logo, this.now()]);
    return { id: nid };
  }
  /** Show or hide a courier for customers, without touching its prices. */
  async setCourierActive(id: string, active: boolean) {
    const r = await this.db.run('UPDATE fw_couriers SET active = $1 WHERE id = $2', [active ? 1 : 0, id]);
    if (!r.changes) throw new AppError('not_found', 'Courier not found');
    return { ok: true };
  }
  async deleteCourier(id: string) {
    await this.db.run('DELETE FROM fw_couriers WHERE id = $1', [id]);
    return { ok: true };
  }

  /** Public calculator: rough price for a box before anything is bought. */
  async estimate(kgIn: unknown, dimsIn: unknown, parcelsIn: unknown = 1) {
    const weightG = kgToG(kgIn);
    const dims = parseDims(dimsIn);
    const parcels = int(parcelsIn ?? 1, 'Parcels', 1, 20);
    const s = await this.settings();
    return { quotes: quoteAll(await this.couriers(), s, { weightG, dims, parcels, storagePence: 0 }), freeDays: s.freeDays };
  }

  // ---------- customer
  /** The customer's suite code, created the first time they open the page. */
  async suite(customerId: string): Promise<string> {
    const row = await this.db.get<{ code: string }>('SELECT code FROM fw_suites WHERE customer_id = $1', [customerId]);
    if (row) return row.code;
    for (let i = 0; i < 20; i++) {
      const code = `KG${randomInt(10_000, 100_000)}`;
      try {
        await this.db.run('INSERT INTO fw_suites (customer_id, code, created_at) VALUES ($1, $2, $3)', [customerId, code, this.now()]);
        return code;
      } catch {
        const again = await this.db.get<{ code: string }>('SELECT code FROM fw_suites WHERE customer_id = $1', [customerId]);
        if (again) return again.code;
      }
    }
    throw new AppError('conflict', 'Could not create your suite code, please try again');
  }

  async overview(customerId: string) {
    const [code, s, couriers] = await Promise.all([this.suite(customerId), this.settings(), this.couriers()]);
    const cust = await this.db.get<{ name: string }>('SELECT name FROM customers WHERE id = $1', [customerId]);
    const packages = await this.db.all<PkgRow>(`SELECT * FROM fw_packages WHERE customer_id = $1 AND (status <> 'shipped' OR created_at > $2) ORDER BY created_at DESC`,
      [customerId, new Date(this.clock.now().getTime() - 90 * 86_400_000).toISOString()]);
    const shipments = await this.db.all<ShipRow>('SELECT * FROM fw_shipments WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 50', [customerId]);
    const buyRows = await this.db.all<BuyRow>(`SELECT * FROM fw_buys WHERE customer_id = $1 AND (status IN ('requested','quoted','paid') OR created_at > $2) ORDER BY created_at DESC LIMIT 50`, [customerId, new Date(this.clock.now().getTime() - 30 * 86_400_000).toISOString()]);
    this.backfill(buyRows, packages);
    const ready = Boolean(s.whLine1 && s.whCity);
    return {
      suite: code,
      ukAddress: await this.ukAddress(customerId),
      suggestedAddress: await this.suggestedAddress(customerId),
      buys: buyRows.map(buyOut),
      notes: await this.notes(customerId),
      shopLogos: Object.keys(SHOP_DOMAINS),
      balancePence: await this.wallet.balance(customerId),
      address: ready ? {
        name: `${(cust?.name || 'Kargom').trim()} ${code}`, line1: s.whLine1, line2: [s.whLine2, code].filter(Boolean).join(' · '), district: s.whDistrict, city: s.whCity,
        postcode: s.whPostcode, phone: s.whPhone, country: 'Türkiye',
      } : null,
      fees: { handlingPence: s.handlingPence, consolidatePence: s.consolidatePence, freeDays: s.freeDays, storagePencePerDay: s.storagePencePerDay },
      couriers: couriers.filter((c) => c.active).map((c) => ({ name: c.name, daysMin: c.daysMin, daysMax: c.daysMax, logoUrl: c.logoUrl })),
      courierLogos: Object.fromEntries(couriers.map((c) => [c.id, c.logoUrl])),
      stores: STORES,
      packages: packages.map((p) => ({ ...pkgOut(p), storagePence: storageFor(p.received_at, this.clock.now(), s),
        freeUntil: p.received_at ? new Date(new Date(p.received_at).getTime() + s.freeDays * 86_400_000).toISOString() : null })),
      shipments: shipments.map(shipOut),
    };
  }

  async ukAddress(customerId: string, q: Queryable = this.db): Promise<UkAddress | null> {
    const r = await q.get<{ uk_address: string | null }>('SELECT uk_address FROM fw_suites WHERE customer_id = $1', [customerId]);
    try { return r?.uk_address ? JSON.parse(r.uk_address) as UkAddress : null; } catch { return null; }
  }
  async saveUkAddress(customerId: string, input: unknown) {
    const address = parseUkAddress(input);
    await this.suite(customerId);
    await this.db.run('UPDATE fw_suites SET uk_address = $1 WHERE customer_id = $2', [JSON.stringify(address), customerId]);
    return { ukAddress: address };
  }

  async addPackage(customerId: string, input: Record<string, unknown>) {
    const store = text(input.store, 60);
    const description = text(input.description, 300);
    if (!store) throw new AppError('bad_request', 'Choose the shop');
    if (!description) throw new AppError('bad_request', 'Say what is in the parcel (for customs), e.g. 2 cotton T-shirts');
    const value = int(input.valueTry, 'Price paid (TL)', 1, 5_000_000);
    const open = await this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM fw_packages WHERE customer_id = $1 AND status = 'expected'`, [customerId]);
    if (Number(open?.n ?? 0) >= 100) throw new AppError('bad_request', 'You have 100 parcels on the way already');
    await this.suite(customerId);
    const autoSend = input.autoSend === true || input.autoSend === 'true';
    if (input.address) await this.saveUkAddress(customerId, input.address);
    if (autoSend && !(await this.ukAddress(customerId))) throw new AppError('bad_request', 'Add your UK address first, so we know where to send it');
    const id = newId('frp');
    await this.db.run(`INSERT INTO fw_packages (id, customer_id, status, store, order_no, inbound_tracking, description, value_try, auto_send, auto_pref, created_at) VALUES ($1,$2,'expected',$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, customerId, store, text(input.orderNo, 60), text(input.tracking, 60), description, value, autoSend ? 1 : 0, input.autoPref === 'fastest' ? 'fastest' : 'cheapest', this.now()]);
    const link = text(input.productUrl, 1000);
    if (link && isShopLink(link)) {
      await this.db.run('UPDATE fw_packages SET product_url = $1 WHERE id = $2', [link, id]);
      await this.withPreview(link, (pv) => this.db.run('UPDATE fw_packages SET product_title = $1, image = $2 WHERE id = $3', [pv.english || pv.title, dataUrl(pv.image), id]));
    }
    return { id };
  }

  private async ownPackage(customerId: string, id: string, q: Queryable = this.db) {
    const p = await q.get<PkgRow>('SELECT * FROM fw_packages WHERE id = $1', [id]);
    if (!p || p.customer_id !== customerId) throw new AppError('not_found', 'Parcel not found');
    return p;
  }

  async updatePackage(customerId: string, id: string, input: Record<string, unknown>) {
    const p = await this.ownPackage(customerId, id);
    if (!PKG_OPEN.includes(p.status)) throw new AppError('conflict', 'This parcel is already being sent');
    const sets: string[] = []; const vals: Param[] = [];
    const put = (col: string, v: Param) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if ('tracking' in input) put('inbound_tracking', text(input.tracking, 60));
    if ('orderNo' in input) put('order_no', text(input.orderNo, 60));
    if ('description' in input) { const d = text(input.description, 300); if (!d) throw new AppError('bad_request', 'Say what is in the parcel'); put('description', d); }
    if ('valueTry' in input) put('value_try', int(input.valueTry, 'Price paid (TL)', 1, 5_000_000));
    if ('hold' in input) put('hold', input.hold ? 1 : 0);
    if ('autoSend' in input) {
      if (input.autoSend && !(await this.ukAddress(customerId))) throw new AppError('bad_request', 'Add your UK address first, so we know where to send it');
      put('auto_send', input.autoSend ? 1 : 0);
    }
    if ('autoPref' in input) put('auto_pref', input.autoPref === 'fastest' ? 'fastest' : 'cheapest');
    if (!sets.length) return { ok: true };
    vals.push(id);
    await this.db.run(`UPDATE fw_packages SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    return { ok: true };
  }

  async removePackage(customerId: string, id: string) {
    const p = await this.ownPackage(customerId, id);
    if (p.status !== 'expected') throw new AppError('conflict', 'Only parcels that have not arrived yet can be removed');
    await this.db.run('DELETE FROM fw_packages WHERE id = $1', [id]);
    return { ok: true };
  }

  /** "Send now" / "Combine and send": the chosen parcels go into one box for one UK address. */
  async requestShipment(customerId: string, input: Record<string, unknown>) {
    const ids = Array.isArray(input.packageIds) ? [...new Set(input.packageIds.map(String))].slice(0, 20) : [];
    if (!ids.length) throw new AppError('bad_request', 'Choose the parcels to send');
    const saved = await this.ukAddress(customerId);
    const address = input.address ? parseUkAddress(input.address) : saved;
    if (!address) throw new AppError('bad_request', 'Enter the UK delivery address');
    if (input.address) await this.saveUkAddress(customerId, address);
    return this.db.tx(async (tx) => {
      const pk = await Promise.all(ids.map((id) => this.ownPackage(customerId, id, tx)));
      const notHere = pk.filter((p) => p.status !== 'received');
      if (notHere.length) throw new AppError('conflict', 'Only parcels that are in our warehouse can be sent');
      const noInfo = pk.filter((p) => !p.description || !p.value_try);
      if (noInfo.length) throw new AppError('bad_request', 'Add what is in each parcel and the price you paid (Edit). Customs needs it.');
      return this.createShipment(tx, customerId, pk.map((p) => p.id), address, text(input.note, 500));
    });
  }

  private async createShipment(tx: Queryable, customerId: string, packageIds: string[], address: UkAddress, note: string | null) {
    const seq = await tx.get<{ n: number }>('SELECT COUNT(*) AS n FROM fw_shipments');
    const id = newId('frs');
    const ref = `TR-${10_001 + Number(seq?.n ?? 0)}`;
    await tx.run(`INSERT INTO fw_shipments (id, ref, customer_id, status, address, note, created_at) VALUES ($1,$2,$3,'requested',$4,$5,$6)`,
      [id, ref, customerId, JSON.stringify(address), note, this.now()]);
    for (const pid of packageIds) await tx.run(`UPDATE fw_packages SET status = 'requested', shipment_id = $1, hold = 0 WHERE id = $2`, [id, pid]);
    return { id, ref };
  }

  /** Customer asked "send it as soon as it arrives": box it, price it, and pay from the wallet if the money is there. */
  private async autoShip(p: PkgRow): Promise<{ status: 'paid' | 'quoted'; ref: string; pence: number } | null> {
    const address = await this.ukAddress(p.customer_id);
    if (!address || !p.weight_g || !p.description || !p.value_try) return null;
    const sh = await this.db.tx((tx) => this.createShipment(tx, p.customer_id, [p.id], address, 'Send as soon as it arrives'));
    const { quotes } = await this.measure(sh.id, { weightKg: p.weight_g / 1000, dims: p.dims }, false, true);
    const q = pickQuote(quotes, p.auto_pref)!;
    try {
      await this.payFromWallet(p.customer_id, sh.id, sh.ref, q);
      this.tell(p.customer_id, `Your parcel ${sh.ref} is on its way to being sent`, 'Paid from your wallet, sending now', [
        `${p.store ?? 'Your parcel'}: ${p.description} arrived and you asked us to send it straight away.`,
        `We took ${'£' + (q.pence / 100).toFixed(2)} from your wallet for ${q.name} (${q.daysMin}–${q.daysMax} working days). We email the tracking number as soon as it leaves.`,
      ]);
      return { status: 'paid', ref: sh.ref, pence: q.pence };
    } catch (e) {
      if ((e as AppError).code !== 'insufficient_funds') throw e;
      this.tell(p.customer_id, `Your parcel ${sh.ref} is ready: pay to send it`, 'Your parcel is ready to send', [
        `${p.store ?? 'Your parcel'}: ${p.description} arrived. Sending it with ${q.name} costs £${(q.pence / 100).toFixed(2)}.`,
        'Your wallet did not have enough money, so pay by card or top up and we send it the same or next working day.',
      ]);
      return { status: 'quoted', ref: sh.ref, pence: q.pence };
    }
  }

  private async ownShipment(customerId: string, id: string, q: Queryable = this.db) {
    const s = await q.get<ShipRow>('SELECT * FROM fw_shipments WHERE id = $1', [id]);
    if (!s || s.customer_id !== customerId) throw new AppError('not_found', 'Shipment not found');
    return s;
  }

  async cancelShipment(customerId: string, id: string) {
    return this.db.tx(async (tx) => {
      const s = await this.ownShipment(customerId, id, tx);
      if (!['requested', 'quoted'].includes(s.status)) throw new AppError('conflict', 'This shipment is paid already. Ask us in Help to change it.');
      await tx.run(`UPDATE fw_shipments SET status = 'cancelled' WHERE id = $1`, [id]);
      await tx.run(`UPDATE fw_packages SET status = 'received', shipment_id = NULL WHERE shipment_id = $1`, [id]);
      return { ok: true };
    });
  }

  /** Pay for a priced shipment: from the wallet now, or by card on Stripe's page. */
  async pay(customerId: string, id: string, input: { courierId?: unknown; payWith?: unknown }, returnBase: string) {
    const s = await this.ownShipment(customerId, id);
    if (s.status !== 'quoted') throw new AppError('conflict', s.status === 'paid' ? 'Already paid' : 'We have not priced this box yet');
    const quotes = JSON.parse(s.quotes ?? '[]') as CourierQuote[];
    const q = quotes.find((x) => x.courierId === input.courierId);
    if (!q) throw new AppError('bad_request', 'Choose a courier');
    if (input.payWith === 'card') {
      const cust = await this.db.get<{ stripe_customer_id: string | null; email: string; name: string }>('SELECT stripe_customer_id, email, name FROM customers WHERE id = $1', [customerId]);
      let stripeId = cust?.stripe_customer_id ?? null;
      if (!stripeId && cust) {
        stripeId = (await this.payments.createCustomer({ email: cust.email, name: cust.name, idempotencyKey: `cus:${customerId}` })).id;
        await this.db.run('UPDATE customers SET stripe_customer_id = $1 WHERE id = $2', [stripeId, customerId]);
      }
      const metadata = { purpose: 'fwd', customer_id: customerId, fwd_id: id, courier_id: q.courierId };
      const cs = await this.payments.createCheckout({
        amount: q.pence, customerStripeId: stripeId, description: `Kargom ${s.ref}: Turkey to UK, ${q.name}`, metadata,
        successUrl: `${returnBase}/app/turkey?paid=${encodeURIComponent(s.ref)}`, cancelUrl: `${returnBase}/app/turkey`, idempotencyKey: `fwd:${id}:${q.courierId}:${q.pence}`, saveCard: true,
      });
      return { url: cs.url };
    }
    await this.payFromWallet(customerId, id, s.ref, q);
    return { ok: true, paid: true };
  }

  private async payFromWallet(customerId: string, id: string, ref: string, q: CourierQuote) {
    await this.db.tx(async (tx) => {
      const bal = await this.wallet.balance(customerId, tx);
      if (bal < q.pence) throw new AppError('insufficient_funds', 'Not enough money in your wallet', { balance: bal, needed: q.pence });
      await this.ledger.post({ idempotencyKey: `fwd:${id}`, kind: 'fwd_sale', ref, memo: `Turkey to UK ${ref}`,
        lines: [{ account: acct.wallet(customerId), amount: q.pence }, { account: FW_REVENUE, amount: -q.pence }] }, tx);
      await this.markPaid(tx, id, q, 'wallet', `fwd:${id}`);
    });
  }

  private async markPaid(tx: Queryable, id: string, q: CourierQuote, via: string, ref: string) {
    await tx.run(`UPDATE fw_shipments SET status = 'paid', courier_id = $1, courier_name = $2, price_pence = $3, paid_via = $4, payment_ref = $5, paid_at = $6 WHERE id = $7 AND status = 'quoted'`,
      [q.courierId, q.name, q.pence, via, ref, this.now(), id]);
  }

  /** Stripe webhook: the card payment for a shipment went through. */
  async onCardPaid(id: string, courierId: string, paymentIntentId: string, amount: number) {
    await this.db.tx(async (tx) => {
      const s = await tx.get<ShipRow>('SELECT * FROM fw_shipments WHERE id = $1', [id]);
      if (!s) return;
      const { duplicate } = await this.ledger.post({ idempotencyKey: `card:${paymentIntentId}`, kind: 'card_sale', ref: s.ref, memo: `Turkey to UK ${s.ref}`,
        lines: [{ account: acct.cashStripe, amount }, { account: FW_REVENUE, amount: -amount }] }, tx);
      if (duplicate) return;
      const q = (JSON.parse(s.quotes ?? '[]') as CourierQuote[]).find((x) => x.courierId === courierId);
      if (s.status === 'quoted' && q && amount >= q.pence) await this.markPaid(tx, id, q, 'card', paymentIntentId);
      else console.warn(`[turkey] card payment ${paymentIntentId} for ${s.ref} not applied (status ${s.status}, amount ${amount})`);
    });
  }

  // ---------- admin
  async adminOverview() {
    const [settings, couriers] = await Promise.all([this.settings(), this.couriers()]);
    const recent = new Date(this.clock.now().getTime() - 30 * 86_400_000).toISOString();
    const packages = await this.db.all<PkgRow & { cname: string; email: string; code: string | null }>(
      `SELECT p.*, c.name AS cname, c.email, s.code FROM fw_packages p JOIN customers c ON c.id = p.customer_id LEFT JOIN fw_suites s ON s.customer_id = p.customer_id
       WHERE p.status IN ('expected','received','requested') OR p.created_at > $1 ORDER BY p.created_at DESC LIMIT 500`, [recent]);
    const shipments = await this.db.all<ShipRow & { cname: string; email: string; code: string | null }>(
      `SELECT f.*, c.name AS cname, c.email, s.code FROM fw_shipments f JOIN customers c ON c.id = f.customer_id LEFT JOIN fw_suites s ON s.customer_id = f.customer_id
       WHERE f.status IN ('requested','quoted','paid','shipped') OR f.created_at > $1 ORDER BY f.created_at DESC LIMIT 300`, [recent]);
    const now = this.clock.now();
    const buys = await this.db.all<BuyRow & { cname: string; code: string | null }>(
      `SELECT b.*, c.name AS cname, s.code FROM fw_buys b JOIN customers c ON c.id = b.customer_id LEFT JOIN fw_suites s ON s.customer_id = b.customer_id
       WHERE b.status IN ('requested','quoted','paid') OR b.created_at > $1 ORDER BY b.created_at DESC LIMIT 200`, [recent]);
    return {
      settings, couriers, stores: STORES, shopLogos: Object.keys(SHOP_DOMAINS),
      buys: buys.map((b) => ({ ...buyOut(b), customer: b.cname, suite: b.code })),
      notes: await this.notes(null),
      packages: packages.map((p) => ({ ...pkgOut(p), customer: p.cname, email: p.email, suite: p.code, storagePence: storageFor(p.received_at, now, settings) })),
      shipments: shipments.map((s) => ({ ...shipOut(s), customer: s.cname, email: s.email, suite: s.code,
        packages: packages.filter((p) => p.shipment_id === s.id).map((p) => ({ id: p.id, store: p.store, description: p.description, valueTry: p.value_try, weightKg: p.weight_g ? p.weight_g / 1000 : null, dims: p.dims })) })),
    };
  }

  /** A parcel arrived at the warehouse. Matches the customer's pre-alert by tracking number, or logs a new one. */
  async receive(input: Record<string, unknown>) {
    const weightG = kgToG(input.weightKg);
    const dims = parseDims(input.dims);
    const tracking = text(input.tracking, 60);
    const now = this.now();
    let pkg: PkgRow | undefined;
    if (typeof input.packageId === 'string' && input.packageId) {
      pkg = await this.db.get<PkgRow>('SELECT * FROM fw_packages WHERE id = $1', [input.packageId]);
      if (!pkg) throw new AppError('not_found', 'Parcel not found');
    } else if (tracking) {
      pkg = await this.db.get<PkgRow>(`SELECT * FROM fw_packages WHERE status = 'expected' AND UPPER(REPLACE(inbound_tracking, ' ', '')) = $1`, [tracking.replace(/\s/g, '').toUpperCase()]);
    }
    if (pkg) {
      if (pkg.status !== 'expected' && pkg.status !== 'received') throw new AppError('conflict', 'This parcel is already in a shipment');
      if (pkg.auto_send && pkg.status === 'expected' && !dims) throw new AppError('bad_request', 'Enter the size: this customer asked us to send it as soon as it arrives');
      await this.db.run(`UPDATE fw_packages SET status = 'received', weight_g = $1, dims = $2, admin_note = COALESCE($3, admin_note), inbound_tracking = COALESCE(inbound_tracking, $4), received_at = COALESCE(received_at, $5) WHERE id = $6`,
        [weightG, dimsText(dims), text(input.note, 300), tracking, now, pkg.id]);
    } else {
      const suite = String(input.suite ?? '').replace(/\s/g, '').toUpperCase();
      const owner = suite ? await this.db.get<{ customer_id: string }>('SELECT customer_id FROM fw_suites WHERE code = $1', [suite]) : undefined;
      if (!owner) throw new AppError('bad_request', 'No pre-alert matches this tracking number. Enter the suite code from the label (KG…).');
      const id = newId('frp');
      await this.db.run(`INSERT INTO fw_packages (id, customer_id, status, store, inbound_tracking, description, weight_g, dims, admin_note, received_at, created_at)
        VALUES ($1,$2,'received',$3,$4,$5,$6,$7,$8,$9,$9)`, [id, owner.customer_id, text(input.store, 60) ?? 'Other', tracking, text(input.description, 300), weightG, dimsText(dims), text(input.note, 300), now]);
      pkg = await this.db.get<PkgRow>('SELECT * FROM fw_packages WHERE id = $1', [id]);
    }
    const s = await this.settings();
    const p = (await this.db.get<PkgRow>('SELECT * FROM fw_packages WHERE id = $1', [pkg!.id]))!;
    if (p.auto_send && p.status === 'received') {
      const auto = await this.autoShip(p);
      if (auto) return { id: p.id, customerId: p.customer_id, auto };
    }
    this.tell(p.customer_id, 'Your parcel is in our Turkey warehouse', 'Your parcel has arrived', [
      `${p.store ?? 'Your parcel'}${p.description ? `: ${p.description}` : ''} is in our Istanbul warehouse (${(weightG / 1000).toFixed(2)} kg).`,
      `Storage is free for ${s.freeDays} days. Send it now, or wait for more parcels and we will combine them into one box.`,
      ...(p.description ? [] : ['Please add what is in it and the price you paid, so we can fill in the customs form.']),
    ]);
    return { id: p.id, customerId: p.customer_id };
  }

  /** Box packed: enter its real weight and size, we price every courier and the customer chooses and pays. */
  async measure(id: string, input: Record<string, unknown>, preview = false, silent = false) {
    const s = await this.db.get<ShipRow>('SELECT * FROM fw_shipments WHERE id = $1', [id]);
    if (!s) throw new AppError('not_found', 'Shipment not found');
    if (!preview && !['requested', 'quoted'].includes(s.status)) throw new AppError('conflict', 'This shipment is paid already');
    const weightG = kgToG(input.weightKg);
    const dims = parseDims(input.dims);
    if (!dims && !preview) throw new AppError('bad_request', 'Enter the box size in cm, e.g. 40x30x20');
    const settings = await this.settings();
    const pk = await this.db.all<PkgRow>('SELECT * FROM fw_packages WHERE shipment_id = $1', [id]);
    const now = this.clock.now();
    const storagePence = pk.reduce((a, p) => a + storageFor(p.received_at, now, settings), 0);
    const quotes = quoteAll(await this.couriers(), settings, { weightG, dims, parcels: pk.length, storagePence });
    if (preview) return { quotes };
    if (!quotes.length) throw new AppError('bad_request', 'No active courier takes a box this heavy or big. Check the courier rates.');
    await this.db.run(`UPDATE fw_shipments SET status = 'quoted', weight_g = $1, dims = $2, quotes = $3, admin_note = COALESCE($4, admin_note), quoted_at = $5 WHERE id = $6`,
      [weightG, dimsText(dims), JSON.stringify(quotes), text(input.note, 300), now.toISOString(), id]);
    const cheapest = quotes[0]!;
    if (!silent) this.tell(s.customer_id, `Your box ${s.ref} is packed: choose a courier and pay`, 'Your box is ready to send', [
      `We packed ${pk.length} parcel${pk.length > 1 ? 's' : ''} into one box: ${(weightG / 1000).toFixed(2)} kg, ${dimsText(dims)} cm.`,
      `Prices start at £${(cheapest.pence / 100).toFixed(2)} with ${cheapest.name}. Choose a courier and pay, and we send it the same or next working day.`,
    ]);
    return { quotes };
  }

  async ship(id: string, input: Record<string, unknown>) {
    const s = await this.db.get<ShipRow>('SELECT * FROM fw_shipments WHERE id = $1', [id]);
    if (!s) throw new AppError('not_found', 'Shipment not found');
    if (!['paid', 'shipped'].includes(s.status)) throw new AppError('conflict', 'Only paid shipments can be sent');
    const trackingNo = text(input.trackingNo, 60);
    if (!trackingNo) throw new AppError('bad_request', 'Enter the courier tracking number');
    const c = s.courier_id ? await this.db.get<CourierRow>('SELECT * FROM fw_couriers WHERE id = $1', [s.courier_id]) : undefined;
    const url = c?.tracking_url ? c.tracking_url.replace('{n}', encodeURIComponent(trackingNo)) : null;
    await this.db.run(`UPDATE fw_shipments SET status = 'shipped', tracking_no = $1, tracking_url = $2, shipped_at = COALESCE(shipped_at, $3) WHERE id = $4`, [trackingNo, url, this.now(), id]);
    await this.db.run(`UPDATE fw_packages SET status = 'shipped' WHERE shipment_id = $1`, [id]);
    this.tell(s.customer_id, `Your box ${s.ref} is on its way to the UK`, 'Your box is on its way', [
      `${s.courier_name ?? 'The courier'} tracking number: ${trackingNo}.`,
      ...(url ? [`Track it here: ${url}`] : []),
      'If UK import VAT or duty is due, the courier will ask you for it before delivery.',
    ]);
    return { ok: true, trackingUrl: url };
  }

  async delivered(id: string) {
    const r = await this.db.run(`UPDATE fw_shipments SET status = 'delivered', delivered_at = $1 WHERE id = $2 AND status = 'shipped'`, [this.now(), id]);
    if (!r.changes) throw new AppError('conflict', 'Only shipped boxes can be marked delivered');
    return { ok: true };
  }

  async adminPackageNote(id: string, input: Record<string, unknown>) {
    const p = await this.db.get<PkgRow>('SELECT * FROM fw_packages WHERE id = $1', [id]);
    if (!p) throw new AppError('not_found', 'Parcel not found');
    const sets: string[] = []; const vals: Param[] = [];
    const put = (col: string, v: Param) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if ('note' in input) put('admin_note', text(input.note, 300));
    if (input.discard === true && PKG_OPEN.includes(p.status)) put('status', 'discarded');
    if (!sets.length) return { ok: true };
    vals.push(id);
    await this.db.run(`UPDATE fw_packages SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    return { ok: true };
  }

  /** Boxes on their way to the UK or delivered: these show in the dashboard's recent shipments, as "Forwarding". */
  async sentBoxes(customerId: string) {
    const rows = await this.db.all<ShipRow>(`SELECT * FROM fw_shipments WHERE customer_id = $1 AND status IN ('shipped','delivered') ORDER BY shipped_at DESC LIMIT 50`, [customerId]);
    if (!rows.length) return [];
    const pk = await this.db.all<PkgRow>(`SELECT * FROM fw_packages WHERE customer_id = $1 AND status = 'shipped'`, [customerId]);
    const logos = Object.fromEntries((await this.couriers()).map((c) => [c.id, c.logoUrl]));
    return rows.map((r) => ({ ...shipOut(r), courierLogo: (r.courier_id && logos[r.courier_id]) || null, items: pk.filter((p) => p.shipment_id === r.id).map((p) => ({ store: p.store, description: p.description })) }));
  }

  /** Reads product pages (swapped in tests). */
  preview: (url: string) => Promise<Preview> = (url) => cachedPreview(url);
  private tried = new Set<string>();

  /** What the customer sees the moment they paste a link: shop, name, price and picture. */
  async linkPreview(urlIn: unknown) {
    const url = text(urlIn, 1000);
    if (!url || !/^https?:\/\//i.test(url)) throw new AppError('bad_request', 'Paste the link to the product');
    if (!isShopLink(url)) return { store: storeFromUrl(url), known: false, title: null, priceTry: null, image: null };
    const pv = await this.preview(url);
    return { store: storeFromUrl(url), known: true, title: pv.title, english: pv.english ?? null, priceTry: pv.priceTry, image: dataUrl(pv.image) };
  }
  /** Admin test: what our server gets back from a shop link, step by step. */
  async previewTest(urlIn: unknown) {
    const url = text(urlIn, 1000) ?? '';
    const { productPreview } = await import('./preview.ts');
    const pv = await productPreview(url);
    return { title: pv.title, english: pv.english ?? null, priceTry: pv.priceTry, image: Boolean(pv.image), steps: pv.log ?? [] };
  }
  /** Orders and requests made before we read links (or when the shop was slow): fill them in once, in the background. */
  private backfill(buys: Array<{ id: string; url: string; title?: string | null; image?: string | null }>, pkgs: Array<{ id: string; product_url?: string | null; product_title?: string | null; image?: string | null }>) {
    for (const b of buys) {
      if (b.title || b.image || this.tried.has(b.id) || !isShopLink(b.url)) continue;
      this.tried.add(b.id);
      this.preview(b.url).then((pv) => (pv.title || pv.image ? this.db.run('UPDATE fw_buys SET title = $1, image = $2, item_try = COALESCE(item_try, $3) WHERE id = $4',
        [pv.english || pv.title, dataUrl(pv.image), pv.priceTry ? Math.round(pv.priceTry) : null, b.id]) : null)).catch(() => {});
    }
    for (const p of pkgs) {
      if (!p.product_url || p.product_title || p.image || this.tried.has(p.id)) continue;
      this.tried.add(p.id);
      this.preview(p.product_url).then((pv) => (pv.title || pv.image ? this.db.run('UPDATE fw_packages SET product_title = $1, image = $2 WHERE id = $3', [pv.english || pv.title, dataUrl(pv.image), p.id]) : null)).catch(() => {});
    }
  }
  /** Get the product's name and picture: wait up to 4 s so the page can show it at once, then finish in the background. */
  private async withPreview(url: string, save: (pv: Preview) => Promise<unknown>) {
    const job = this.preview(url).then(async (pv) => { if (pv.title || pv.image) await save(pv); }).catch((e) => console.warn(`[turkey] preview: ${(e as Error).message}`));
    await Promise.race([job, new Promise((r) => setTimeout(r, 4000))]);
  }
  /** Product picture for a buy request or a parcel. customerId null = admin. */
  async productImage(kind: string, id: string, customerId: string | null) {
    const r = kind === 'buy'
      ? await this.db.get<{ image: string | null; customer_id: string }>('SELECT image, customer_id FROM fw_buys WHERE id = $1', [id])
      : await this.db.get<{ image: string | null; customer_id: string }>('SELECT image, customer_id FROM fw_packages WHERE id = $1', [id]);
    const m = r?.image ? /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(r.image) : null;
    if (!r || !m || (customerId && r.customer_id !== customerId)) throw new AppError('not_found', 'Picture not found');
    return { type: m[1]!, data: Buffer.from(m[2]!, 'base64') };
  }

  // ---------- UK address we can suggest (from the customer's parcel bookings)
  async suggestedAddress(customerId: string): Promise<Partial<UkAddress> | null> {
    if (await this.ukAddress(customerId)) return null;
    const r = await this.db.get<{ from_json: string }>(`SELECT from_json FROM shipments WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`, [customerId]).catch(() => undefined);
    try {
      const a = r?.from_json ? JSON.parse(r.from_json) as Record<string, string> : null;
      return a && a.postcode && (a.country ?? 'GB') === 'GB' ? { name: a.name, line1: a.line1, line2: a.line2 ?? null, city: a.city, postcode: a.postcode, phone: a.phone ?? '' } : null;
    } catch { return null; }
  }

  // ---------- messages and photos about one parcel
  /** Messages for one customer (or every customer, for the admin), newest last, with photo links. */
  async notes(customerId: string | null) {
    const rows = await this.db.all<{ id: string; customer_id: string; package_id: string; author: string; body: string | null; created_at: string }>(
      customerId ? 'SELECT * FROM fw_notes WHERE customer_id = $1 ORDER BY created_at' : `SELECT * FROM fw_notes WHERE created_at > $1 ORDER BY created_at`,
      [customerId ?? new Date(this.clock.now().getTime() - 90 * 86_400_000).toISOString()]);
    const photos = rows.length ? await this.db.all<{ id: string; note_id: string }>(
      customerId ? 'SELECT id, note_id FROM fw_photos WHERE customer_id = $1 ORDER BY created_at' : 'SELECT id, note_id FROM fw_photos WHERE created_at > $1 ORDER BY created_at',
      [customerId ?? new Date(this.clock.now().getTime() - 90 * 86_400_000).toISOString()]) : [];
    const base = customerId ? '/api/tr/photos/' : '/api/admin/tr/photos/';
    return rows.map((n) => ({ id: n.id, packageId: n.package_id, customerId: n.customer_id, author: n.author, body: n.body, createdAt: n.created_at,
      photos: photos.filter((p) => p.note_id === n.id).map((p) => base + p.id) }));
  }

  /** Add a message (and photos) about one parcel. by = 'admin' or the customer's id. */
  async addNote(by: 'admin' | { customerId: string }, packageId: string, input: Record<string, unknown>) {
    const p = await this.db.get<PkgRow>('SELECT * FROM fw_packages WHERE id = $1', [packageId]);
    if (!p || (by !== 'admin' && p.customer_id !== by.customerId)) throw new AppError('not_found', 'Parcel not found');
    const body = text(input.body, 2000);
    const photos = photosIn(input.photos);
    if (!body && !photos.length) throw new AppError('bad_request', 'Write a message or add a photo');
    const id = newId('frn');
    const now = this.now();
    await this.db.tx(async (tx) => {
      await tx.run('INSERT INTO fw_notes (id, customer_id, package_id, author, body, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [id, p.customer_id, p.id, by === 'admin' ? 'admin' : 'customer', body, now]);
      for (const ph of photos) await tx.run('INSERT INTO fw_photos (id, note_id, package_id, customer_id, data, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [newId('frf'), id, p.id, p.customer_id, ph, now]);
    });
    if (by === 'admin') {
      this.tell(p.customer_id, `A message about your parcel: ${p.description ?? p.store ?? ''}`.trim(), 'We have an update about your parcel', [
        `${p.store ?? 'Your parcel'}${p.description ? `: ${p.description}` : ''}`,
        ...(body ? [body] : []), ...(photos.length ? [`We added ${photos.length} photo${photos.length > 1 ? 's' : ''}.`] : []),
        'Reply on the page: your message goes to our warehouse team.',
      ]);
    }
    return { id };
  }

  /** One photo, as a JPEG. customerId null = admin. */
  async photo(id: string, customerId: string | null) {
    const r = await this.db.get<{ data: string; customer_id: string }>('SELECT data, customer_id FROM fw_photos WHERE id = $1', [id]);
    if (!r || (customerId && r.customer_id !== customerId)) throw new AppError('not_found', 'Photo not found');
    const b64 = /^data:image\/jpeg;base64,(.+)$/.exec(r.data)?.[1];
    if (!b64) throw new AppError('not_found', 'Photo not found');
    return { type: 'image/jpeg', data: Buffer.from(b64, 'base64') };
  }

  // ---------- buy it for me
  async requestBuy(customerId: string, input: Record<string, unknown>) {
    const url = text(input.url, 1000);
    if (!url || !/^https?:\/\/[^\s]+\.[^\s]+/i.test(url)) throw new AppError('bad_request', 'Paste the link to the product');
    const open = await this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM fw_buys WHERE customer_id = $1 AND status IN ('requested','quoted')`, [customerId]);
    if (Number(open?.n ?? 0) >= 20) throw new AppError('bad_request', 'You have 20 requests waiting already');
    await this.suite(customerId);
    const seq = await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM fw_buys');
    const id = newId('frb');
    const ref = `BUY-${1001 + Number(seq?.n ?? 0)}`;
    await this.db.run(`INSERT INTO fw_buys (id, ref, customer_id, status, url, details, qty, store, created_at) VALUES ($1,$2,$3,'requested',$4,$5,$6,$7,$8)`,
      [id, ref, customerId, url, text(input.details, 1000), int(input.qty ?? 1, 'Quantity', 1, 20), storeFromUrl(url), this.now()]);
    await this.withPreview(url, (pv) => this.db.run('UPDATE fw_buys SET title = $1, image = $2, item_try = COALESCE(item_try, $3) WHERE id = $4', [pv.english || pv.title, dataUrl(pv.image), pv.priceTry ? Math.round(pv.priceTry) : null, id]));
    return { id, ref };
  }

  private async ownBuy(customerId: string, id: string, q: Queryable = this.db) {
    const b = await q.get<BuyRow>('SELECT * FROM fw_buys WHERE id = $1', [id]);
    if (!b || b.customer_id !== customerId) throw new AppError('not_found', 'Request not found');
    return b;
  }
  async cancelBuy(customerId: string, id: string) {
    const b = await this.ownBuy(customerId, id);
    if (!['requested', 'quoted'].includes(b.status)) throw new AppError('conflict', 'This is paid already. Ask us in Help to change it.');
    await this.db.run(`UPDATE fw_buys SET status = 'cancelled' WHERE id = $1`, [id]);
    return { ok: true };
  }
  async payBuy(customerId: string, id: string, input: { payWith?: unknown }, returnBase: string) {
    const b = await this.ownBuy(customerId, id);
    if (b.status !== 'quoted' || !b.price_pence) throw new AppError('conflict', b.status === 'paid' ? 'Already paid' : 'We have not priced this yet');
    const amount = b.price_pence;
    if (input.payWith === 'card') {
      const cust = await this.db.get<{ stripe_customer_id: string | null; email: string; name: string }>('SELECT stripe_customer_id, email, name FROM customers WHERE id = $1', [customerId]);
      let stripeId = cust?.stripe_customer_id ?? null;
      if (!stripeId && cust) {
        stripeId = (await this.payments.createCustomer({ email: cust.email, name: cust.name, idempotencyKey: `cus:${customerId}` })).id;
        await this.db.run('UPDATE customers SET stripe_customer_id = $1 WHERE id = $2', [stripeId, customerId]);
      }
      const cs = await this.payments.createCheckout({
        amount, customerStripeId: stripeId, description: `Kargom ${b.ref}: we buy it for you in Turkey`, metadata: { purpose: 'fwd_buy', customer_id: customerId, buy_id: id },
        successUrl: `${returnBase}/app/turkey?paid=${encodeURIComponent(b.ref)}`, cancelUrl: `${returnBase}/app/turkey`, idempotencyKey: `fwdbuy:${id}:${amount}`, saveCard: true,
      });
      return { url: cs.url };
    }
    await this.db.tx(async (tx) => {
      const bal = await this.wallet.balance(customerId, tx);
      if (bal < amount) throw new AppError('insufficient_funds', 'Not enough money in your wallet', { balance: bal, needed: amount });
      await this.ledger.post({ idempotencyKey: `fwdbuy:${id}`, kind: 'fwd_sale', ref: b.ref, memo: `Buy for me ${b.ref}`,
        lines: [{ account: acct.wallet(customerId), amount }, { account: FW_BUY, amount: -amount }] }, tx);
      await tx.run(`UPDATE fw_buys SET status = 'paid', paid_via = 'wallet', payment_ref = $1, paid_at = $2 WHERE id = $3 AND status = 'quoted'`, [`fwdbuy:${id}`, this.now(), id]);
    });
    return { ok: true, paid: true };
  }
  async onBuyPaid(id: string, paymentIntentId: string, amount: number) {
    await this.db.tx(async (tx) => {
      const b = await tx.get<BuyRow>('SELECT * FROM fw_buys WHERE id = $1', [id]);
      if (!b) return;
      const { duplicate } = await this.ledger.post({ idempotencyKey: `card:${paymentIntentId}`, kind: 'card_sale', ref: b.ref, memo: `Buy for me ${b.ref}`,
        lines: [{ account: acct.cashStripe, amount }, { account: FW_BUY, amount: -amount }] }, tx);
      if (duplicate) return;
      if (b.status === 'quoted' && amount >= (b.price_pence ?? Infinity)) {
        await tx.run(`UPDATE fw_buys SET status = 'paid', paid_via = 'card', payment_ref = $1, paid_at = $2 WHERE id = $3`, [paymentIntentId, this.now(), id]);
      } else console.warn(`[turkey] buy payment ${paymentIntentId} for ${b.ref} not applied (status ${b.status}, amount ${amount})`);
    });
  }

  async quoteBuy(id: string, input: Record<string, unknown>) {
    const b = await this.db.get<BuyRow>('SELECT * FROM fw_buys WHERE id = $1', [id]);
    if (!b) throw new AppError('not_found', 'Request not found');
    if (!['requested', 'quoted'].includes(b.status)) throw new AppError('conflict', 'This request is paid or closed');
    const price = Math.round(Number(String(input.price ?? '').replace(',', '.')) * 100);
    if (!(price >= 100 && price <= 1_000_000)) throw new AppError('bad_request', 'Enter the price for the customer in £');
    const itemTry = input.itemTry ? int(input.itemTry, 'Shop price (TL)', 1, 5_000_000) : null;
    await this.db.run(`UPDATE fw_buys SET status = 'quoted', price_pence = $1, item_try = $2, admin_note = $3, store = COALESCE($4, store), quoted_at = $5 WHERE id = $6`,
      [price, itemTry, text(input.note, 500), text(input.store, 60), this.now(), id]);
    this.tell(b.customer_id, `${b.ref}: we can buy it for you`, 'Your item is ready to buy', [
      `We checked your link (${b.store ?? 'shop'}). The price to buy it for you is £${(price / 100).toFixed(2)}, including our service fee.`,
      ...(text(input.note, 500) ? [text(input.note, 500)!] : []),
      'Pay on the page and we order it. It then comes to our warehouse like any other order.',
    ]);
    return { ok: true };
  }
  async rejectBuy(id: string, input: Record<string, unknown>) {
    const b = await this.db.get<BuyRow>('SELECT * FROM fw_buys WHERE id = $1', [id]);
    if (!b) throw new AppError('not_found', 'Request not found');
    if (!['requested', 'quoted'].includes(b.status)) throw new AppError('conflict', 'This request is paid: refund it from the wallet instead');
    const note = text(input.note, 500) ?? 'We cannot buy this item for you.';
    await this.db.run(`UPDATE fw_buys SET status = 'rejected', admin_note = $1 WHERE id = $2`, [note, id]);
    this.tell(b.customer_id, `${b.ref}: we cannot buy this one`, 'We cannot buy this item', [note]);
    return { ok: true };
  }
  /** We placed the order in Turkey: it becomes a normal parcel on its way to the warehouse. */
  async orderedBuy(id: string, input: Record<string, unknown>) {
    const b = await this.db.get<BuyRow>('SELECT * FROM fw_buys WHERE id = $1', [id]);
    if (!b) throw new AppError('not_found', 'Request not found');
    if (b.status !== 'paid') throw new AppError('conflict', 'Only paid requests can be ordered');
    const description = text(input.description, 300);
    if (!description) throw new AppError('bad_request', 'Say what the item is (in English, for customs)');
    const valueTry = int(input.valueTry ?? b.item_try, 'Price paid (TL)', 1, 5_000_000);
    const pid = newId('frp');
    await this.db.tx(async (tx) => {
      await tx.run(`INSERT INTO fw_packages (id, customer_id, status, store, order_no, inbound_tracking, description, value_try, product_url, product_title, image, created_at) VALUES ($1,$2,'expected',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [pid, b.customer_id, text(input.store, 60) ?? b.store ?? 'Other', text(input.orderNo, 60) ?? b.ref, text(input.tracking, 60), description, valueTry, b.url, b.title ?? null, b.image ?? null, this.now()]);
      await tx.run(`UPDATE fw_buys SET status = 'ordered', package_id = $1, ordered_at = $2 WHERE id = $3`, [pid, this.now(), id]);
    });
    this.tell(b.customer_id, `${b.ref}: ordered`, 'We ordered your item', [`${description} is ordered and on its way to our warehouse. It shows in your orders as "On the way to us".`]);
    return { packageId: pid };
  }
}
