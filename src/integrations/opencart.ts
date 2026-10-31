import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { Db } from '../db/db.ts';
import type { Clock } from '../core/clock.ts';
import { AppError } from '../core/errors.ts';
import { newId } from '../core/ids.ts';
import type { SecretBox } from '../auth/auth.ts';
import { CARRIER_LABEL } from '../notify/names.ts';
import { TRACK_URL, type Conn, type OrderRow, type ShipTo } from './shopify.ts';
import { normaliseSite, privateIp } from './woo.ts';

/**
 * OpenCart for senders. OpenCart's own API cannot list orders, so the merchant uploads one small file
 * (kargom-connect.php, made for them with a private key inside) next to config.php in their OpenCart folder.
 * Kargom then asks that file for orders in the "processing" statuses, and after booking adds an order
 * history line with the tracking number and sets the order to "Shipped".
 */

const TEMPLATE = readFileSync(new URL('./opencart/kargom-connect.php', import.meta.url), 'utf8');
const pence = (amount: unknown) => Math.round(Number(amount ?? 0) * 100) || 0;
const GRAMS: Record<string, number> = { kg: 1000, g: 1, gr: 1, lb: 453.592, lbs: 453.592, oz: 28.3495 };

type OcProduct = { name: string; model?: string; quantity: string | number; price: string | number; weight?: string | number | null; weight_unit?: string | null };
type OcOrder = Record<string, string | null> & { order_id: string; products?: OcProduct[] };

export class OpenCartIntegration {
  private readonly db: Db;
  private readonly clock: Clock;
  private readonly box: SecretBox;
  fetch: typeof fetch = fetch;
  lookup: (host: string) => Promise<string[]> = async (host) => (await dnsLookup(host, { all: true })).map((r) => r.address);
  constructor(db: Db, clock: Clock, box: SecretBox) { this.db = db; this.clock = clock; this.box = box; }
  private now() { return this.clock.now().toISOString(); }

  private async safe(site: string) {
    const host = new URL(site).hostname;
    let ips: string[] = [];
    try { ips = await this.lookup(host); } catch { throw new AppError('bad_request', `We could not find ${host}. Check the address of your shop.`); }
    if (!ips.length || ips.some(privateIp)) throw new AppError('bad_request', `We could not reach ${host}`);
  }

  /* ---------------- connect: make the file, then check it ---------------- */

  /** Step 1: a connection waiting for its file, with a fresh private key. */
  async start(customerId: string, siteIn: unknown) {
    const site = normaliseSite(siteIn);
    await this.safe(site);
    const existing = await this.db.get<Conn>("SELECT * FROM shop_connections WHERE platform = 'opencart' AND shop = $1", [site]);
    if (existing && existing.status === 'active' && existing.customer_id !== customerId) throw new AppError('conflict', 'This shop is already connected to another Kargom account');
    const sealed = this.box.seal({ key: randomBytes(24).toString('hex') });
    const name = new URL(site).hostname.replace(/^www\./, '');
    if (existing) {
      // keep the key of a shop that already works for this customer, so its file keeps working
      if (existing.status === 'active' && existing.customer_id === customerId) return { id: existing.id };
      await this.db.run("UPDATE shop_connections SET customer_id = $1, token = $2, status = 'pending', shop_name = $3 WHERE id = $4", [customerId, sealed, name, existing.id]);
      return { id: existing.id };
    }
    const id = newId('shc');
    await this.db.run("INSERT INTO shop_connections (id, customer_id, platform, shop, shop_name, token, scopes, status, created_at) VALUES ($1,$2,'opencart',$3,$4,$5,'','pending',$6)",
      [id, customerId, site, name, sealed, this.now()]);
    return { id };
  }

  private async mine(customerId: string, id: string) {
    const c = await this.db.get<Conn>("SELECT * FROM shop_connections WHERE id = $1 AND platform = 'opencart'", [id]);
    if (!c || c.customer_id !== customerId || !c.token || c.status === 'uninstalled') throw new AppError('not_found', 'Shop not found');
    return c;
  }

  /** The connector file, with this shop's key written into it. */
  async file(customerId: string, id: string) {
    const c = await this.mine(customerId, id);
    const { key } = this.box.open(c.token!) as { key: string };
    return TEMPLATE.replace('__KARGOM_KEY__', key);
  }

  /** Step 2: the file is on the shop; check it answers with the right key. */
  async verify(customerId: string, id: string) {
    const c = await this.mine(customerId, id);
    const r = await this.call<{ ok?: boolean; name?: string; opencart?: string }>(c, 'ping');
    await this.db.run("UPDATE shop_connections SET status = 'active', shop_name = COALESCE(NULLIF($1, ''), shop_name), scopes = $2 WHERE id = $3", [String(r.name ?? '').slice(0, 80), r.opencart ?? '', c.id]);
    await this.sync(customerId).catch((e) => console.warn(`[opencart] first sync for ${c.shop}: ${(e as Error).message}`));
    return { name: r.name ?? c.shop_name };
  }

  /* ---------------- talking to the file ---------------- */

  private async call<T>(c: Conn, action: string, body?: unknown, query = ''): Promise<T> {
    if (!c.token) throw new AppError('conflict', 'This shop is not connected');
    await this.safe(c.shop);
    const { key } = this.box.open(c.token) as { key: string };
    let r: Response;
    try {
      r = await this.fetch(`${c.shop}/kargom-connect.php?action=${action}${query}`, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'manual', signal: AbortSignal.timeout(20_000),
        headers: { 'X-Kargom-Key': key, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new AppError('provider_failed', 'Your shop did not answer. Is the site online?'); }
    if (r.status === 404) throw new AppError('bad_request', 'We could not find kargom-connect.php. Upload it to your OpenCart folder, next to config.php, then check again.');
    if (r.status >= 300 && r.status < 400) throw new AppError('bad_request', 'Your shop sent us to another address. Use the exact address your shop opens on, for example https://www.my-shop.co.uk');
    const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
    if (r.status === 401) throw new AppError('unauthorized', 'The connector file on your shop has a different key. Download the file again and replace the old one.');
    if (!j) throw new AppError('provider_failed', 'Your shop answered, but not from the Kargom file. Check that kargom-connect.php was uploaded as it is.');
    if (!r.ok || j.error) throw new AppError('provider_failed', `OpenCart: ${j.error ?? r.status}`);
    return j;
  }

  /* ---------------- orders ---------------- */

  async sync(customerId: string) {
    const conns = await this.db.all<Conn>("SELECT * FROM shop_connections WHERE customer_id = $1 AND platform = 'opencart' AND status = 'active'", [customerId]);
    let n = 0;
    for (const c of conns) {
      const d = await this.call<{ orders?: OcOrder[] }>(c, 'orders');
      const now = this.now();
      for (const o of d.orders ?? []) {
        const ship = Boolean(o.shipping_address_1);
        const f = (k: string) => String((ship ? o[`shipping_${k}`] : o[`payment_${k}`]) ?? '').trim();
        if (!f('address_1')) continue;
        const shipTo: ShipTo = {
          name: [f('firstname'), f('lastname')].filter(Boolean).join(' ') || f('company') || [o.firstname, o.lastname].filter(Boolean).join(' '), company: f('company'),
          line1: f('address_1'), line2: f('address_2'), city: f('city'), postcode: f('postcode').toUpperCase(),
          country: String((ship ? o.shipping_iso : o.payment_iso) || 'GB').toUpperCase(), phone: String(o.telephone ?? ''), email: String(o.email ?? ''),
        };
        const rate = Number(o.currency_value) || 1;
        const products = o.products ?? [];
        const items = products.map((p) => ({ name: String(p.name).slice(0, 120), quantity: Number(p.quantity) || 1, sku: p.model ?? '', valuePence: pence(Number(p.price) * rate) }));
        const grams = Math.round(products.reduce((s, p) => s + (Number(p.weight) || 0) * (GRAMS[String(p.weight_unit ?? 'kg').trim().toLowerCase()] ?? 1000) * (Number(p.quantity) || 1), 0));
        const ext = String(o.order_id);
        const total = pence(Number(o.total) * rate);
        const existing = await this.db.get<OrderRow>('SELECT * FROM shop_orders WHERE connection_id = $1 AND external_id = $2', [c.id, ext]);
        if (existing) {
          if (existing.status !== 'open') continue;
          await this.db.run('UPDATE shop_orders SET ship_to = $1, items = $2, weight_grams = $3, total_pence = $4, synced_at = $5 WHERE id = $6', [JSON.stringify(shipTo), JSON.stringify(items), grams, total, now, existing.id]);
        } else {
          const at = o.date_added && !Number.isNaN(Date.parse(String(o.date_added).replace(' ', 'T'))) ? new Date(String(o.date_added).replace(' ', 'T')).toISOString() : now;
          await this.db.run(`INSERT INTO shop_orders (id, connection_id, customer_id, external_id, name, ordered_at, buyer_email, ship_to, items, weight_grams, total_pence, currency, fulfillment_orders, status, synced_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'[]','open',$13)`,
            [newId('sho'), c.id, customerId, ext, `#${o.order_id}`, at, shipTo.email || null, JSON.stringify(shipTo), JSON.stringify(items), grams, total, o.currency_code ?? null, now]);
          n++;
        }
      }
      await this.db.run('UPDATE shop_connections SET last_sync_at = $1 WHERE id = $2', [now, c.id]);
    }
    return n;
  }

  /** Order history line with the tracking number (shown in the buyer's account), status "Shipped". Safe to call more than once. */
  async pushTracking(shipmentId: string) {
    const o = await this.db.get<OrderRow>('SELECT * FROM shop_orders WHERE shipment_id = $1', [shipmentId]);
    if (!o || o.pushed_at) return false;
    const conn = await this.db.get<Conn>('SELECT * FROM shop_connections WHERE id = $1', [o.connection_id]);
    if (conn?.platform !== 'opencart') return false;
    const s = await this.db.get<{ tracking_number: string | null; carrier: string; status: string }>('SELECT tracking_number, carrier, status FROM shipments WHERE id = $1', [shipmentId]);
    if (!s?.tracking_number || s.status === 'failed') return false;
    const company = CARRIER_LABEL[s.carrier] ?? s.carrier;
    const url = TRACK_URL[s.carrier]?.(encodeURIComponent(s.tracking_number));
    try {
      await this.call(conn, 'ship', { order_id: Number(o.external_id), comment: `Your order is on its way with ${company}. Tracking number: ${s.tracking_number}${url ? `. Track it here: ${url}` : ''}` });
      await this.db.run('UPDATE shop_orders SET pushed_at = $1, push_error = NULL WHERE id = $2', [this.now(), o.id]);
      return true;
    } catch (e) {
      await this.db.run('UPDATE shop_orders SET push_error = $1 WHERE id = $2', [(e as Error).message.slice(0, 300), o.id]);
      console.warn(`[opencart] tracking for ${o.name}: ${(e as Error).message}`);
      return false;
    }
  }
}
