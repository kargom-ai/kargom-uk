import { randomBytes } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Db } from '../db/db.ts';
import type { Clock } from '../core/clock.ts';
import { AppError } from '../core/errors.ts';
import { newId } from '../core/ids.ts';
import type { SecretBox } from '../auth/auth.ts';
import { CARRIER_LABEL } from '../notify/names.ts';
import { TRACK_URL, type Conn, type OrderRow, type ShipTo } from './shopify.ts';

/**
 * WooCommerce for senders. No app approval is needed: the merchant types their shop address,
 * approves Kargom in their own WordPress admin (WooCommerce's built-in "wc-auth" screen),
 * and WooCommerce sends us a read/write REST API key. Orders in "Processing" come in;
 * after booking, the order gets the tracking number (customer note) and is marked Completed.
 */

const pence = (amount: unknown) => Math.round(Number(amount ?? 0) * 100) || 0;

export function privateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const x = ip.toLowerCase();
    if (x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80')) return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    return m ? privateIp(m[1]!) : false;
  }
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** "myshop.co.uk" → "https://myshop.co.uk". Only public https addresses (we call them from our server). */
export function normaliseSite(input: unknown): string {
  let raw = String(input ?? '').trim();
  if (!raw) throw new AppError('bad_request', 'Enter your shop address, for example https://www.my-shop.co.uk');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try { u = new URL(raw); } catch { throw new AppError('bad_request', 'That does not look like a web address'); }
  if (u.protocol === 'http:') throw new AppError('bad_request', 'Your shop must use https:// (a padlock in the browser) to connect safely');
  if (u.protocol !== 'https:' || u.username || u.password || u.port) throw new AppError('bad_request', 'Enter your shop address, for example https://www.my-shop.co.uk');
  const host = u.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal'))
    throw new AppError('bad_request', 'Enter your shop address, for example https://www.my-shop.co.uk');
  const path = u.pathname.replace(/\/(wp-admin|wp-json|shop|cart|checkout)(\/.*)?$/i, '').replace(/\/+$/, '');
  return `https://${host}${path}`;
}

type Creds = { key: string; secret: string };
type WooAddr = { first_name?: string; last_name?: string; company?: string; address_1?: string; address_2?: string; city?: string; state?: string; postcode?: string; country?: string; phone?: string; email?: string };
type WooOrder = { id: number; number?: string; status: string; date_created_gmt?: string; date_created?: string; total?: string; currency?: string; billing?: WooAddr; shipping?: WooAddr;
  line_items?: Array<{ name: string; quantity: number; sku?: string; price?: number | string; product_id?: number; variation_id?: number }> };

export class WooIntegration {
  private readonly db: Db;
  private readonly clock: Clock;
  private readonly box: SecretBox;
  fetch: typeof fetch = fetch;
  /** DNS lookup (replaced in tests). */
  lookup: (host: string) => Promise<string[]> = async (host) => (await dnsLookup(host, { all: true })).map((r) => r.address);
  constructor(db: Db, clock: Clock, box: SecretBox) { this.db = db; this.clock = clock; this.box = box; }
  private now() { return this.clock.now().toISOString(); }

  /** Refuse to call addresses that point inside a private network. */
  private async safe(site: string) {
    const host = new URL(site).hostname;
    let ips: string[] = [];
    try { ips = await this.lookup(host); } catch { throw new AppError('bad_request', `We could not find ${host}. Check the address of your shop.`); }
    if (!ips.length || ips.some(privateIp)) throw new AppError('bad_request', `We could not reach ${host}`);
  }

  /* ---------------- connect ---------------- */

  /** WooCommerce's own approval screen on the merchant's site. */
  async authorizeUrl(customerId: string, siteIn: unknown, base: string) {
    const site = normaliseSite(siteIn);
    await this.safe(site);
    const taken = await this.db.get<Conn>("SELECT * FROM shop_connections WHERE platform = 'woo' AND shop = $1 AND status = 'active'", [site]);
    if (taken && taken.customer_id !== customerId) throw new AppError('conflict', 'This shop is already connected to another Kargom account');
    const state = randomBytes(18).toString('base64url');
    await this.db.run('DELETE FROM shop_oauth_states WHERE created_at < $1', [new Date(this.clock.now().getTime() - 3600_000).toISOString()]);
    await this.db.run('INSERT INTO shop_oauth_states (state, customer_id, shop, created_at) VALUES ($1,$2,$3,$4)', [state, customerId, site, this.now()]);
    const b = (process.env.PUBLIC_URL || base).replace(/\/+$/, '');
    const q = new URLSearchParams({ app_name: 'Kargom', scope: 'read_write', user_id: state, return_url: `${b}/api/shop/woo/return`, callback_url: `${b}/api/shop/woo/callback` });
    return `${site}/wc-auth/v1/authorize?${q}`;
  }

  /** WooCommerce posts the new API key here (server to server) once the merchant approves. */
  async callback(raw: string) {
    let body: { user_id?: string; consumer_key?: string; consumer_secret?: string; key_permissions?: string };
    try { body = JSON.parse(raw || '{}'); } catch { throw new AppError('bad_request', 'Body must be JSON'); }
    const state = String(body.user_id ?? '');
    const st = await this.db.get<{ customer_id: string; shop: string; created_at: string }>('SELECT * FROM shop_oauth_states WHERE state = $1', [state]);
    if (!st || Date.parse(st.created_at) < this.clock.now().getTime() - 30 * 60_000) throw new AppError('unauthorized', 'This connection link has expired');
    if (!/^ck_\w{20,}$/.test(String(body.consumer_key)) || !/^cs_\w{20,}$/.test(String(body.consumer_secret))) throw new AppError('bad_request', 'WooCommerce did not send a key');
    await this.db.run('DELETE FROM shop_oauth_states WHERE state = $1', [state]);
    const sealed = this.box.seal({ key: body.consumer_key!, secret: body.consumer_secret! });
    const existing = await this.db.get<Conn>("SELECT * FROM shop_connections WHERE platform = 'woo' AND shop = $1", [st.shop]);
    const id = existing?.id ?? newId('shc');
    if (existing) await this.db.run("UPDATE shop_connections SET customer_id = $1, token = $2, scopes = $3, status = 'active' WHERE id = $4", [st.customer_id, sealed, body.key_permissions ?? 'read_write', id]);
    else await this.db.run("INSERT INTO shop_connections (id, customer_id, platform, shop, token, scopes, status, created_at) VALUES ($1,$2,'woo',$3,$4,$5,'active',$6)", [id, st.customer_id, st.shop, sealed, body.key_permissions ?? 'read_write', this.now()]);
    // name + first orders in the background: WooCommerce is waiting for our answer
    void (async () => {
      try {
        const r = await this.fetch(`${st.shop}/wp-json`, { signal: AbortSignal.timeout(10_000), redirect: 'manual' });
        const j = (await r.json().catch(() => ({}))) as { name?: string };
        if (j.name) await this.db.run('UPDATE shop_connections SET shop_name = $1 WHERE id = $2', [String(j.name).slice(0, 80), id]);
      } catch { /* the name is only for display */ }
      await this.sync(st.customer_id).catch((e) => console.warn(`[woo] first sync for ${st.shop}: ${(e as Error).message}`));
    })();
    return { customerId: st.customer_id, site: st.shop };
  }

  /* ---------------- WooCommerce REST API ---------------- */

  private async call<T>(connId: string, method: string, path: string, body?: unknown): Promise<T> {
    const c = await this.db.get<Conn>('SELECT * FROM shop_connections WHERE id = $1', [connId]);
    if (!c?.token || c.status !== 'active') throw new AppError('conflict', 'This shop is not connected');
    await this.safe(c.shop);
    const { key, secret } = this.box.open(c.token) as Creds;
    const url = `${c.shop}/wp-json${path}`;
    const init = (headers: Record<string, string>): RequestInit => ({ method, headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000), redirect: 'manual' });
    let r = await this.fetch(url, init({ Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` }));
    // Some hosts drop the Authorization header; WooCommerce also accepts the key in the address over https.
    if (r.status === 401) r = await this.fetch(`${url}${url.includes('?') ? '&' : '?'}consumer_key=${encodeURIComponent(key)}&consumer_secret=${encodeURIComponent(secret)}`, init({}));
    if (r.status >= 300 && r.status < 400) throw new AppError('provider_failed', 'Your shop moved to another address. Disconnect and connect it again with the new address.');
    if (r.status === 401 || r.status === 403) {
      if (path.startsWith('/wc/v3/orders?')) await this.db.run("UPDATE shop_connections SET status = 'uninstalled', token = NULL WHERE id = $1", [c.id]);
      throw new AppError('conflict', 'WooCommerce no longer accepts Kargom\'s key. Please connect your shop again.');
    }
    const j = (await r.json().catch(() => null)) as T & { message?: string };
    if (!r.ok) throw new AppError('provider_failed', `WooCommerce: ${(j as { message?: string } | null)?.message ?? r.status}`);
    return j as T;
  }

  /* ---------------- orders ---------------- */

  /** Bring in paid orders waiting to be shipped ("Processing"). */
  async sync(customerId: string) {
    const conns = await this.db.all<Conn>("SELECT * FROM shop_connections WHERE customer_id = $1 AND platform = 'woo' AND status = 'active'", [customerId]);
    let n = 0;
    for (const c of conns) {
      const orders = await this.call<WooOrder[]>(c.id, 'GET', '/wc/v3/orders?status=processing&per_page=50&orderby=date&order=desc');
      // weights live on the products, in the shop's own unit
      const ids = [...new Set(orders.flatMap((o) => (o.line_items ?? []).map((l) => l.variation_id || l.product_id)).filter(Boolean))] as number[];
      const weight = new Map<number, number>();
      if (ids.length) {
        let unit = 'kg';
        try { unit = (await this.call<{ value?: string }>(c.id, 'GET', '/wc/v3/settings/products/woocommerce_weight_unit')).value || 'kg'; } catch { /* default kg */ }
        const toG = { kg: 1000, g: 1, lbs: 453.592, oz: 28.3495 }[unit] ?? 1000;
        const parents = [...new Set(orders.flatMap((o) => (o.line_items ?? []).map((l) => l.product_id)).filter(Boolean))] as number[];
        try {
          const prods = await this.call<Array<{ id: number; weight?: string }>>(c.id, 'GET', `/wc/v3/products?include=${parents.slice(0, 100).join(',')}&per_page=100`);
          for (const p of prods) if (Number(p.weight) > 0) weight.set(p.id, Number(p.weight) * toG);
        } catch { /* weight is optional */ }
        for (const o of orders) for (const l of o.line_items ?? []) {
          if (l.variation_id && !weight.has(l.variation_id)) {
            try { const v = await this.call<{ weight?: string }>(c.id, 'GET', `/wc/v3/products/${l.product_id}/variations/${l.variation_id}`); if (Number(v.weight) > 0) weight.set(l.variation_id, Number(v.weight) * toG); } catch { /* optional */ }
          }
        }
      }
      const now = this.now();
      for (const o of orders) {
        if (o.status !== 'processing') continue;
        const s = o.shipping?.address_1 ? o.shipping : o.billing ?? {};
        if (!s.address_1) continue;
        const shipTo: ShipTo = {
          name: [s.first_name, s.last_name].filter(Boolean).join(' ') || s.company || '', company: s.company ?? '', line1: s.address_1 ?? '', line2: s.address_2 ?? '',
          city: s.city ?? '', postcode: String(s.postcode ?? '').toUpperCase(), country: (s.country || 'GB').toUpperCase(),
          phone: o.shipping?.phone || o.billing?.phone || '', email: o.billing?.email || '',
        };
        const items = (o.line_items ?? []).map((l) => ({ name: String(l.name).slice(0, 120), quantity: Number(l.quantity) || 1, sku: l.sku ?? '', valuePence: pence(l.price) }));
        const grams = Math.round((o.line_items ?? []).reduce((a, l) => a + (weight.get(l.variation_id || 0) ?? weight.get(l.product_id || 0) ?? 0) * (Number(l.quantity) || 1), 0));
        const ext = String(o.id);
        const existing = await this.db.get<OrderRow>('SELECT * FROM shop_orders WHERE connection_id = $1 AND external_id = $2', [c.id, ext]);
        if (existing) {
          if (existing.status !== 'open') continue;
          await this.db.run('UPDATE shop_orders SET ship_to = $1, items = $2, weight_grams = $3, total_pence = $4, synced_at = $5 WHERE id = $6',
            [JSON.stringify(shipTo), JSON.stringify(items), grams, pence(o.total), now, existing.id]);
        } else {
          const at = o.date_created_gmt ? `${o.date_created_gmt}Z` : o.date_created ?? now;
          await this.db.run(`INSERT INTO shop_orders (id, connection_id, customer_id, external_id, name, ordered_at, buyer_email, ship_to, items, weight_grams, total_pence, currency, fulfillment_orders, status, synced_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'[]','open',$13)`,
            [newId('sho'), c.id, customerId, ext, `#${o.number || o.id}`, at, shipTo.email || null, JSON.stringify(shipTo), JSON.stringify(items), grams, pence(o.total), o.currency ?? null, now]);
          n++;
        }
      }
      await this.db.run('UPDATE shop_connections SET last_sync_at = $1 WHERE id = $2', [now, c.id]);
    }
    return n;
  }

  /** Tracking to the order (as a note the buyer is emailed), then mark it Completed. Safe to call more than once. */
  async pushTracking(shipmentId: string) {
    const o = await this.db.get<OrderRow>('SELECT * FROM shop_orders WHERE shipment_id = $1', [shipmentId]);
    if (!o || o.pushed_at) return false;
    const conn = await this.db.get<Conn>('SELECT * FROM shop_connections WHERE id = $1', [o.connection_id]);
    if (conn?.platform !== 'woo') return false;
    const s = await this.db.get<{ tracking_number: string | null; carrier: string; status: string }>('SELECT tracking_number, carrier, status FROM shipments WHERE id = $1', [shipmentId]);
    if (!s?.tracking_number || s.status === 'failed') return false;
    const company = CARRIER_LABEL[s.carrier] ?? s.carrier;
    const url = TRACK_URL[s.carrier]?.(encodeURIComponent(s.tracking_number));
    try {
      // the "Shipment Tracking" extension, if the shop has it (shows tracking in the order emails); fine if not installed
      await this.call(o.connection_id, 'POST', `/wc-shipment-tracking/v3/orders/${o.external_id}/shipment-trackings`,
        { tracking_provider: company, tracking_number: s.tracking_number, ...(url ? { custom_tracking_provider: company, custom_tracking_link: url } : {}) }).catch(() => null);
      await this.call(o.connection_id, 'POST', `/wc/v3/orders/${o.external_id}/notes`, {
        customer_note: true,
        note: `Your order is on its way with ${company}. Tracking number: ${s.tracking_number}${url ? `. Track it here: ${url}` : ''}`,
      });
      await this.call(o.connection_id, 'PUT', `/wc/v3/orders/${o.external_id}`, { status: 'completed' });
      await this.db.run('UPDATE shop_orders SET pushed_at = $1, push_error = NULL WHERE id = $2', [this.now(), o.id]);
      return true;
    } catch (e) {
      await this.db.run('UPDATE shop_orders SET push_error = $1 WHERE id = $2', [(e as Error).message.slice(0, 300), o.id]);
      console.warn(`[woo] tracking for ${o.name}: ${(e as Error).message}`);
      return false;
    }
  }
}
