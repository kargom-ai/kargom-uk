import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/db.ts';
import type { Clock } from '../core/clock.ts';
import { AppError } from '../core/errors.ts';
import { newId } from '../core/ids.ts';
import type { SecretBox } from '../auth/auth.ts';
import { CARRIER_LABEL } from '../notify/names.ts';

/**
 * Shopify for senders: connect a store (OAuth), bring in paid orders that still need shipping,
 * book a Kargom label for one, and Shopify gets the tracking number back (the buyer is emailed by Shopify).
 *
 * Env: SHOPIFY_API_KEY, SHOPIFY_API_SECRET (from the app in the Shopify Partner Dashboard),
 * SHOPIFY_SCOPES (optional), SHOPIFY_API_VERSION (optional, default 2026-10), PUBLIC_URL.
 */

export const SHOPIFY_DEFAULT_SCOPES = 'read_orders,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders';
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

type Conn = { id: string; customer_id: string; platform: string; shop: string; shop_name: string | null; token: string | null; scopes: string | null; status: string; last_sync_at: string | null; created_at: string };
type OrderRow = { id: string; connection_id: string; customer_id: string; external_id: string; name: string; ordered_at: string; buyer_email: string | null; ship_to: string; items: string;
  weight_grams: number; total_pence: number; currency: string | null; fulfillment_orders: string; status: string; shipment_id: string | null; pushed_at: string | null; push_error: string | null; synced_at: string };
export type ShipTo = { name: string; company: string; line1: string; line2: string; city: string; postcode: string; country: string; phone: string; email: string };

/** Turn what the merchant typed ("my-shop", "https://my-shop.myshopify.com/admin") into "my-shop.myshopify.com". */
export function normaliseShop(input: unknown): string {
  let s = String(input ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0] ?? '';
  if (s && !s.includes('.')) s = `${s}.myshopify.com`;
  if (!SHOP_RE.test(s)) throw new AppError('bad_request', 'Enter your Shopify address, for example my-shop.myshopify.com');
  return s;
}

/** Shopify signs the query string of the OAuth callback with the app secret. */
export function validQueryHmac(params: URLSearchParams, secret: string): boolean {
  const hmac = params.get('hmac') ?? '';
  const msg = [...params.entries()].filter(([k]) => k !== 'hmac' && k !== 'signature').sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&');
  const want = createHmac('sha256', secret).update(msg).digest('hex');
  return hmac.length === want.length && timingSafeEqual(Buffer.from(hmac), Buffer.from(want));
}

/** Webhooks carry a base64 HMAC of the raw body. */
export function validWebhookHmac(raw: string, header: string | undefined, secret: string): boolean {
  const want = createHmac('sha256', secret).update(raw, 'utf8').digest('base64');
  const got = String(header ?? '');
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

const TRACK_URL: Record<string, (n: string) => string> = {
  royal_mail: (n) => `https://www.royalmail.com/track-your-item#/tracking-results/${n}`, evri: (n) => `https://www.evri.com/track/parcel/${n}/details`,
  dpd: (n) => `https://track.dpd.co.uk/parcels/${n}`, yodel: (n) => `https://www.yodel.co.uk/track/${n}`, parcelforce: (n) => `https://www.parcelforce.com/track-trace?trackNumber=${n}`,
  ups: (n) => `https://www.ups.com/track?tracknum=${n}`, dhl: (n) => `https://www.dhl.com/gb-en/home/tracking/tracking-express.html?submit=1&tracking-id=${n}`,
  fedex: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`,
};
/** Company names Shopify recognises, so the buyer's tracking link works inside Shopify too. */
const SHOPIFY_COMPANY: Record<string, string> = { royal_mail: 'Royal Mail', evri: 'Evri', dpd: 'DPD UK', yodel: 'Yodel', parcelforce: 'Parcelforce', ups: 'UPS', dhl: 'DHL Express', fedex: 'FedEx', inpost: 'InPost' };

const pence = (amount: unknown) => Math.round(Number(amount ?? 0) * 100) || 0;

export class ShopifyIntegration {
  private readonly db: Db;
  private readonly clock: Clock;
  private readonly box: SecretBox;
  fetch: typeof fetch = fetch;
  constructor(db: Db, clock: Clock, box: SecretBox) { this.db = db; this.clock = clock; this.box = box; }

  private get cfg() {
    const key = process.env.SHOPIFY_API_KEY ?? '', secret = process.env.SHOPIFY_API_SECRET ?? '';
    return { key, secret, scopes: process.env.SHOPIFY_SCOPES || SHOPIFY_DEFAULT_SCOPES, version: process.env.SHOPIFY_API_VERSION || '2026-10', base: (process.env.PUBLIC_URL ?? '').replace(/\/+$/, '') };
  }
  get enabled() { return Boolean(this.cfg.key && this.cfg.secret); }
  private now() { return this.clock.now().toISOString(); }

  /* ---------------- connect ---------------- */

  /** Where to send the merchant to approve Kargom on their store. */
  async installUrl(customerId: string, shopIn: unknown, base: string) {
    if (!this.enabled) throw new AppError('conflict', 'Shopify is not switched on yet');
    const shop = normaliseShop(shopIn);
    const taken = await this.db.get<Conn>("SELECT * FROM shop_connections WHERE platform = 'shopify' AND shop = $1 AND status = 'active'", [shop]);
    if (taken && taken.customer_id !== customerId) throw new AppError('conflict', 'This store is already connected to another Kargom account');
    const state = randomBytes(18).toString('base64url');
    await this.db.run('DELETE FROM shop_oauth_states WHERE created_at < $1', [new Date(this.clock.now().getTime() - 3600_000).toISOString()]);
    await this.db.run('INSERT INTO shop_oauth_states (state, customer_id, shop, created_at) VALUES ($1,$2,$3,$4)', [state, customerId, shop, this.now()]);
    const q = new URLSearchParams({ client_id: this.cfg.key, scope: this.cfg.scopes, redirect_uri: `${this.cfg.base || base}/api/shop/shopify/callback`, state });
    return `https://${shop}/admin/oauth/authorize?${q}`;
  }

  /** Shopify sends the merchant back here after they approve. Returns the Kargom customer it belongs to. */
  async callback(params: URLSearchParams) {
    if (!this.enabled) throw new AppError('conflict', 'Shopify is not switched on yet');
    if (!validQueryHmac(params, this.cfg.secret)) throw new AppError('unauthorized', 'The reply from Shopify could not be verified');
    const shop = normaliseShop(params.get('shop'));
    const st = await this.db.get<{ customer_id: string; shop: string; created_at: string }>('SELECT * FROM shop_oauth_states WHERE state = $1', [params.get('state') ?? '']);
    if (!st || st.shop !== shop || Date.parse(st.created_at) < this.clock.now().getTime() - 15 * 60_000) throw new AppError('unauthorized', 'This connection link has expired. Please try again.');
    await this.db.run('DELETE FROM shop_oauth_states WHERE state = $1', [params.get('state') ?? '']);
    const code = params.get('code');
    if (!code) throw new AppError('bad_request', 'Shopify did not send an approval code');
    const r = await this.fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ client_id: this.cfg.key, client_secret: this.cfg.secret, code }),
    });
    const tok = (await r.json().catch(() => ({}))) as { access_token?: string; scope?: string };
    if (!r.ok || !tok.access_token) throw new AppError('provider_failed', `Shopify did not give access (${r.status})`);
    const sealed = this.box.seal({ token: tok.access_token });
    const existing = await this.db.get<Conn>("SELECT * FROM shop_connections WHERE platform = 'shopify' AND shop = $1", [shop]);
    let id = existing?.id ?? newId('shc');
    if (existing) await this.db.run("UPDATE shop_connections SET customer_id = $1, token = $2, scopes = $3, status = 'active' WHERE id = $4", [st.customer_id, sealed, tok.scope ?? '', id]);
    else await this.db.run("INSERT INTO shop_connections (id, customer_id, platform, shop, token, scopes, status, created_at) VALUES ($1,$2,'shopify',$3,$4,$5,'active',$6)", [id, st.customer_id, shop, sealed, tok.scope ?? '', this.now()]);
    try {
      const d = await this.gql<{ shop: { name: string } }>(id, '{ shop { name } }');
      await this.db.run('UPDATE shop_connections SET shop_name = $1 WHERE id = $2', [d.shop.name, id]);
    } catch { /* the name is only for display */ }
    try { await this.gql(id, `mutation { webhookSubscriptionCreate(topic: APP_UNINSTALLED, webhookSubscription: { uri: "${this.cfg.base}/webhooks/shopify", format: JSON }) { userErrors { message } } }`); } catch { /* also set in the app's config */ }
    await this.sync(st.customer_id).catch((e) => console.warn(`[shopify] first sync for ${shop}: ${(e as Error).message}`));
    return { customerId: st.customer_id, shop };
  }

  async disconnect(customerId: string, connId: string) {
    const c = await this.own(customerId, connId);
    await this.db.run("UPDATE shop_connections SET status = 'uninstalled', token = NULL WHERE id = $1", [c.id]);
    await this.db.run("DELETE FROM shop_orders WHERE connection_id = $1 AND status = 'open'", [c.id]);
    return this.overview(customerId);
  }

  private async own(customerId: string, connId: string) {
    const c = await this.db.get<Conn>('SELECT * FROM shop_connections WHERE id = $1', [connId]);
    if (!c || c.customer_id !== customerId) throw new AppError('not_found', 'Store not found');
    return c;
  }

  /* ---------------- Shopify Admin GraphQL ---------------- */

  private async gql<T>(connId: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const c = await this.db.get<Conn>('SELECT * FROM shop_connections WHERE id = $1', [connId]);
    if (!c?.token || c.status !== 'active') throw new AppError('conflict', 'This store is not connected');
    const { token } = this.box.open(c.token);
    const r = await this.fetch(`https://${c.shop}/admin/api/${this.cfg.version}/graphql.json`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token! }, signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ query, variables }),
    });
    if (r.status === 401 || r.status === 403) {
      await this.db.run("UPDATE shop_connections SET status = 'uninstalled', token = NULL WHERE id = $1", [c.id]);
      throw new AppError('conflict', 'Shopify no longer allows Kargom on this store. Please connect it again.');
    }
    const j = (await r.json().catch(() => ({}))) as { data?: T; errors?: Array<{ message: string }> };
    if (!r.ok || j.errors?.length || !j.data) throw new AppError('provider_failed', `Shopify: ${j.errors?.[0]?.message ?? r.status}`);
    return j.data;
  }

  /* ---------------- orders ---------------- */

  /** Bring in paid orders that still need shipping (up to the 100 newest per store). */
  async sync(customerId: string) {
    const conns = await this.db.all<Conn>("SELECT * FROM shop_connections WHERE customer_id = $1 AND platform = 'shopify' AND status = 'active'", [customerId]);
    let n = 0;
    for (const c of conns) {
      const d = await this.gql<{ orders: { nodes: Array<Record<string, any>> } }>(c.id, `query($q: String!) {
        orders(first: 100, sortKey: CREATED_AT, reverse: true, query: $q) { nodes {
          id name createdAt email displayFulfillmentStatus displayFinancialStatus cancelledAt
          totalWeight
          currentTotalPriceSet { shopMoney { amount currencyCode } }
          shippingAddress { name firstName lastName company address1 address2 city zip countryCodeV2 phone }
          lineItems(first: 50) { nodes { name quantity sku originalUnitPriceSet { shopMoney { amount } } } }
          fulfillmentOrders(first: 10) { nodes { id status } }
        } } }`, { q: 'status:open AND (fulfillment_status:unshipped OR fulfillment_status:partial)' });
      const now = this.now();
      for (const o of d.orders.nodes) {
        if (o.cancelledAt || !o.shippingAddress) continue;
        if (!['UNFULFILLED', 'PARTIALLY_FULFILLED', 'IN_PROGRESS', 'ON_HOLD', 'OPEN', 'SCHEDULED'].includes(String(o.displayFulfillmentStatus))) continue;
        const a = o.shippingAddress;
        const shipTo: ShipTo = {
          name: a.name || [a.firstName, a.lastName].filter(Boolean).join(' '), company: a.company ?? '', line1: a.address1 ?? '', line2: a.address2 ?? '',
          city: a.city ?? '', postcode: String(a.zip ?? '').toUpperCase(), country: a.countryCodeV2 ?? 'GB', phone: a.phone ?? '', email: o.email ?? '',
        };
        const items = (o.lineItems?.nodes ?? []).map((l: any) => ({ name: String(l.name).slice(0, 120), quantity: Number(l.quantity) || 1, sku: l.sku ?? '', valuePence: pence(l.originalUnitPriceSet?.shopMoney?.amount) }));
        const fos = (o.fulfillmentOrders?.nodes ?? []).filter((f: any) => ['OPEN', 'IN_PROGRESS'].includes(f.status)).map((f: any) => f.id);
        const money = o.currentTotalPriceSet?.shopMoney ?? {};
        const existing = await this.db.get<OrderRow>('SELECT * FROM shop_orders WHERE connection_id = $1 AND external_id = $2', [c.id, o.id]);
        if (existing) {
          if (existing.status !== 'open') continue;
          await this.db.run('UPDATE shop_orders SET ship_to = $1, items = $2, weight_grams = $3, total_pence = $4, fulfillment_orders = $5, synced_at = $6 WHERE id = $7',
            [JSON.stringify(shipTo), JSON.stringify(items), Math.round(Number(o.totalWeight) || 0), pence(money.amount), JSON.stringify(fos), now, existing.id]);
        } else {
          await this.db.run(`INSERT INTO shop_orders (id, connection_id, customer_id, external_id, name, ordered_at, buyer_email, ship_to, items, weight_grams, total_pence, currency, fulfillment_orders, status, synced_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'open',$14)`,
            [newId('sho'), c.id, customerId, o.id, o.name, o.createdAt, o.email ?? null, JSON.stringify(shipTo), JSON.stringify(items), Math.round(Number(o.totalWeight) || 0), pence(money.amount), money.currencyCode ?? null, JSON.stringify(fos), now]);
          n++;
        }
      }
      await this.db.run('UPDATE shop_connections SET last_sync_at = $1 WHERE id = $2', [now, c.id]);
    }
    return { added: n, ...(await this.overview(customerId)) };
  }

  async overview(customerId: string) {
    const conns = await this.db.all<Conn>("SELECT * FROM shop_connections WHERE customer_id = $1 AND platform = 'shopify' AND status = 'active' ORDER BY created_at", [customerId]);
    const rows = await this.db.all<OrderRow>("SELECT * FROM shop_orders WHERE customer_id = $1 AND status IN ('open','shipped') ORDER BY ordered_at DESC LIMIT 200", [customerId]);
    const shops = Object.fromEntries(conns.map((c) => [c.id, c]));
    return {
      enabled: this.enabled,
      stores: conns.map((c) => ({ id: c.id, shop: c.shop, name: c.shop_name || c.shop.replace('.myshopify.com', ''), lastSyncAt: c.last_sync_at })),
      orders: rows.filter((o) => shops[o.connection_id]).map((o) => this.view(o, shops[o.connection_id]!)),
    };
  }

  private view(o: OrderRow, c: Conn) {
    const to = JSON.parse(o.ship_to) as ShipTo, items = JSON.parse(o.items) as Array<{ name: string; quantity: number }>;
    return { id: o.id, store: c.shop_name || c.shop, name: o.name, orderedAt: o.ordered_at, to: { name: to.name, city: to.city, postcode: to.postcode, country: to.country },
      items: items.map((i) => `${i.quantity} × ${i.name}`), weightGrams: o.weight_grams, totalPence: o.total_pence, currency: o.currency, status: o.status, shipmentId: o.shipment_id, pushedAt: o.pushed_at, pushError: o.push_error };
  }

  private async ownOrder(customerId: string, id: string) {
    const o = await this.db.get<OrderRow>('SELECT * FROM shop_orders WHERE id = $1', [id]);
    if (!o || o.customer_id !== customerId) throw new AppError('not_found', 'Order not found');
    return o;
  }

  /** What the Send-a-parcel page fills in for this order. */
  async prefill(customerId: string, id: string) {
    const o = await this.ownOrder(customerId, id);
    return { id: o.id, name: o.name, to: JSON.parse(o.ship_to) as ShipTo, weightGrams: o.weight_grams, items: JSON.parse(o.items), currency: o.currency };
  }

  async ignore(customerId: string, id: string) {
    const o = await this.ownOrder(customerId, id);
    await this.db.run("UPDATE shop_orders SET status = 'ignored' WHERE id = $1", [o.id]);
    return this.overview(customerId);
  }

  /** Tie a Kargom shipment to the order; tracking goes to Shopify now, or when the label arrives. */
  async link(customerId: string, id: string, shipmentId: string) {
    const o = await this.ownOrder(customerId, id);
    const s = await this.db.get<{ id: string; customer_id: string }>('SELECT id, customer_id FROM shipments WHERE id = $1', [shipmentId]);
    if (!s || s.customer_id !== customerId) throw new AppError('not_found', 'Shipment not found');
    await this.db.run("UPDATE shop_orders SET shipment_id = $1, status = 'shipped' WHERE id = $2", [s.id, o.id]);
    await this.pushTracking(s.id).catch(() => {});
    return this.view((await this.ownOrder(customerId, id)), (await this.db.get<Conn>('SELECT * FROM shop_connections WHERE id = $1', [o.connection_id]))!);
  }

  /** Mark the Shopify order fulfilled with the tracking number. Safe to call more than once. */
  async pushTracking(shipmentId: string) {
    const o = await this.db.get<OrderRow>('SELECT * FROM shop_orders WHERE shipment_id = $1', [shipmentId]);
    if (!o || o.pushed_at) return false;
    const s = await this.db.get<{ tracking_number: string | null; carrier: string; status: string }>('SELECT tracking_number, carrier, status FROM shipments WHERE id = $1', [shipmentId]);
    if (!s?.tracking_number || s.status === 'failed') return false;
    const fos = JSON.parse(o.fulfillment_orders) as string[];
    if (!fos.length) { await this.db.run('UPDATE shop_orders SET push_error = $1 WHERE id = $2', ['Nothing left to fulfil in Shopify', o.id]); return false; }
    try {
      const d = await this.gql<{ fulfillmentCreate: { fulfillment: { id: string } | null; userErrors: Array<{ message: string }> } }>(o.connection_id,
        `mutation($f: FulfillmentInput!) { fulfillmentCreate(fulfillment: $f) { fulfillment { id } userErrors { message } } }`,
        { f: { notifyCustomer: true, lineItemsByFulfillmentOrder: fos.map((id) => ({ fulfillmentOrderId: id })),
          trackingInfo: { company: SHOPIFY_COMPANY[s.carrier] ?? CARRIER_LABEL[s.carrier] ?? s.carrier, number: s.tracking_number, ...(TRACK_URL[s.carrier] ? { url: TRACK_URL[s.carrier]!(encodeURIComponent(s.tracking_number)) } : {}) } } });
      const err = d.fulfillmentCreate.userErrors[0]?.message;
      if (err || !d.fulfillmentCreate.fulfillment) throw new Error(err ?? 'Shopify did not create the fulfillment');
      await this.db.run('UPDATE shop_orders SET pushed_at = $1, push_error = NULL WHERE id = $2', [this.now(), o.id]);
      return true;
    } catch (e) {
      await this.db.run('UPDATE shop_orders SET push_error = $1 WHERE id = $2', [(e as Error).message.slice(0, 300), o.id]);
      console.warn(`[shopify] tracking for ${o.name}: ${(e as Error).message}`);
      return false;
    }
  }

  /* ---------------- webhooks (uninstall + the privacy webhooks every Shopify app must answer) ---------------- */

  async webhook(topic: string, shopIn: string, raw: string) {
    const shop = normaliseShop(shopIn);
    const conn = await this.db.get<Conn>("SELECT * FROM shop_connections WHERE platform = 'shopify' AND shop = $1", [shop]);
    const body = JSON.parse(raw || '{}') as Record<string, any>;
    if (topic === 'app/uninstalled' && conn) {
      await this.db.run("UPDATE shop_connections SET status = 'uninstalled', token = NULL WHERE id = $1", [conn.id]);
      await this.db.run("DELETE FROM shop_orders WHERE connection_id = $1 AND status = 'open'", [conn.id]);
    }
    if (topic === 'shop/redact' && conn) {
      await this.db.run('DELETE FROM shop_orders WHERE connection_id = $1', [conn.id]);
      await this.db.run('DELETE FROM shop_connections WHERE id = $1', [conn.id]);
    }
    if (topic === 'customers/redact' && conn) {
      const ids = (body.orders_to_redact ?? []).map((x: unknown) => `gid://shopify/Order/${x}`);
      for (const ext of ids) await this.db.run('DELETE FROM shop_orders WHERE connection_id = $1 AND external_id = $2', [conn.id, ext]);
      if (body.customer?.email) await this.db.run('DELETE FROM shop_orders WHERE connection_id = $1 AND buyer_email = $2', [conn.id, String(body.customer.email)]);
    }
    // customers/data_request: we keep only open orders' shipping details, which the merchant already has in Shopify.
    return { ok: true };
  }
}
