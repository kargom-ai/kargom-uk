import type { App } from '../app.ts';
import type { ShipmentRequest } from '../providers/types.ts';

/**
 * Live price snapshots for the public guide pages (courier, country and price pages).
 *
 * Every few hours we ask our own quote engine for a fixed set of typical parcels and
 * keep the answers. Pages only ever read this snapshot, so Googlebot and visitors never
 * wait for a courier, and every number on a page is a real price someone could book.
 */

export type SeoQuote = { carrier: string; carrierName: string; serviceName: string; price: number; priceExVat: number; transitDays: number | null; dropOff: boolean };
export type Snapshot = { at: string; quotes: SeoQuote[] };

export const UK_WEIGHTS = [0.5, 1, 2, 5, 10, 15, 20, 25, 30];
export const INTL_WEIGHTS = [0.5, 2, 5, 10];
const DIMS = { lengthCm: 30, widthCm: 20, heightCm: 15 };

/** Destinations we publish guide pages for: slug → ISO code, display name, a central postcode. */
export const DESTINATIONS: Record<string, { code: string; name: string; postcode: string; city: string }> = {
  'united-states': { code: 'US', name: 'the USA', postcode: '10001', city: 'New York' },
  germany: { code: 'DE', name: 'Germany', postcode: '10115', city: 'Berlin' },
  france: { code: 'FR', name: 'France', postcode: '75001', city: 'Paris' },
  ireland: { code: 'IE', name: 'Ireland', postcode: 'D02 X285', city: 'Dublin' },
  netherlands: { code: 'NL', name: 'the Netherlands', postcode: '1012 AB', city: 'Amsterdam' },
  spain: { code: 'ES', name: 'Spain', postcode: '28001', city: 'Madrid' },
  italy: { code: 'IT', name: 'Italy', postcode: '00184', city: 'Rome' },
  australia: { code: 'AU', name: 'Australia', postcode: '2000', city: 'Sydney' },
  canada: { code: 'CA', name: 'Canada', postcode: 'M5V 2T6', city: 'Toronto' },
  turkey: { code: 'TR', name: 'Turkey', postcode: '34000', city: 'Istanbul' },
  poland: { code: 'PL', name: 'Poland', postcode: '00-001', city: 'Warsaw' },
  belgium: { code: 'BE', name: 'Belgium', postcode: '1000', city: 'Brussels' },
};

const addr = (postcode: string, country: string) => ({ name: 'Quote', line1: 'Quote', city: 'Quote', postcode, country });

function ukRequest(kg: number): ShipmentRequest {
  return { from: addr('EC1A 1BB', 'GB'), to: addr('M1 1AE', 'GB'), parcel: { weightGrams: Math.round(kg * 1000), ...DIMS } };
}
function intlRequest(slug: string, kg: number): ShipmentRequest {
  const d = DESTINATIONS[slug]!;
  return {
    from: addr('EC1A 1BB', 'GB'), to: addr(d.postcode, d.code), parcel: { weightGrams: Math.round(kg * 1000), ...DIMS },
    customs: { contents: 'merchandise', items: [{ description: 'Goods', quantity: 1, valuePence: 2000, originCountry: 'GB' }] },
  } as ShipmentRequest;
}

export class SeoPrices {
  private snaps = new Map<string, Snapshot>();
  private readonly app: App;
  private running = false;
  constructor(app: App) { this.app = app; }

  static ukKey(kg: number) { return `uk:${kg}`; }
  static intlKey(slug: string, kg: number) { return `${slug}:${kg}`; }

  get(key: string): Snapshot | undefined { return this.snaps.get(key); }
  /** Newest snapshot time across a set of keys (for "prices checked" and sitemap lastmod). */
  latest(keys: string[]): string | null {
    let best: string | null = null;
    for (const k of keys) { const s = this.snaps.get(k); if (s && (!best || s.at > best)) best = s.at; }
    return best;
  }

  async load() {
    await this.app.db.exec('CREATE TABLE IF NOT EXISTS seo_prices (key TEXT PRIMARY KEY, at TEXT NOT NULL, quotes TEXT NOT NULL)');
    const rows = await this.app.db.all<{ key: string; at: string; quotes: string }>('SELECT key, at, quotes FROM seo_prices');
    for (const r of rows) { try { this.snaps.set(r.key, { at: r.at, quotes: JSON.parse(r.quotes) }); } catch { /* skip */ } }
    return rows.length;
  }

  private async price(key: string, req: ShipmentRequest) {
    const { quotes } = await this.app.quotes.quote('anonymous', req);
    if (!quotes.length) return false;
    const snap: Snapshot = {
      at: new Date().toISOString(),
      quotes: quotes.map((q) => ({ carrier: q.carrier, carrierName: q.carrierName, serviceName: q.serviceName, price: q.price, priceExVat: q.priceExVat, transitDays: q.transitDays, dropOff: q.dropOff })),
    };
    this.snaps.set(key, snap);
    await this.app.db.run('INSERT INTO seo_prices (key, at, quotes) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET at = excluded.at, quotes = excluded.quotes',
      [key, snap.at, JSON.stringify(snap.quotes)]);
    return true;
  }

  /** Re-price everything, one request every `gapMs` so couriers are never hammered. */
  async refresh(gapMs = Number(process.env.SEO_REFRESH_GAP_MS ?? 1500)): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let n = 0;
    const jobs: Array<[string, ShipmentRequest]> = [
      ...UK_WEIGHTS.map((kg) => [SeoPrices.ukKey(kg), ukRequest(kg)] as [string, ShipmentRequest]),
      ...Object.keys(DESTINATIONS).flatMap((slug) => INTL_WEIGHTS.map((kg) => [SeoPrices.intlKey(slug, kg), intlRequest(slug, kg)] as [string, ShipmentRequest])),
    ];
    try {
      for (const [key, req] of jobs) {
        try { if (await this.price(key, req)) n++; } catch { /* keep the old snapshot */ }
        if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
      }
    } finally { this.running = false; }
    return n;
  }
}

/** Cheapest quote per carrier in a snapshot. */
export function cheapestByCarrier(s: Snapshot | undefined): Map<string, SeoQuote> {
  const m = new Map<string, SeoQuote>();
  for (const q of s?.quotes ?? []) { const cur = m.get(q.carrier); if (!cur || q.price < cur.price) m.set(q.carrier, q); }
  return m;
}

const instances = new WeakMap<object, SeoPrices>();
/** One price store per app, shared by the web server and the background refresh. */
export function seoPricesFor(app: App): SeoPrices {
  let s = instances.get(app);
  if (!s) { s = new SeoPrices(app); instances.set(app, s); }
  return s;
}
