import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/db.ts';
import type { Clock } from '../core/clock.ts';
import { AppError } from '../core/errors.ts';
import { newId } from '../core/ids.ts';
import type { SecretBox } from '../auth/auth.ts';
import { CARRIER_LABEL } from '../notify/names.ts';
import { TRACK_URL, type Conn, type OrderRow, type ShipTo } from './shopify.ts';

/**
 * Wix for senders (Wix Stores / Wix eCommerce).
 * Env: WIX_APP_ID, WIX_APP_SECRET (the app in the Wix Developers Center → OAuth page).
 *
 * Connecting: the site owner installs the Kargom app on their site. We learn which site (the app "instance")
 * in one of two trusted ways, and tie it to the Kargom account that is signed in:
 *  - the install redirect brings an authorization code → we exchange it and ask Wix which instance it is, or
 *  - the app's dashboard link brings Wix's signed "instance" parameter → we check the signature with the app secret.
 * After that we get 4-hour access tokens with client credentials + instance id (nothing long-lived to store).
 */

const API = 'https://www.wixapis.com';
const pence = (amount: unknown) => Math.round(Number(amount ?? 0) * 100) || 0;

type WixAddr = { addressLine1?: string; addressLine2?: string; streetAddress?: { number?: string; name?: string }; city?: string; postalCode?: string; country?: string; subdivision?: string };
type WixContact = { firstName?: string; lastName?: string; phone?: string; company?: string };
type WixOrder = {
  id: string; number?: string | number; createdDate?: string; status?: string; paymentStatus?: string; fulfillmentStatus?: string; archived?: boolean; currency?: string; weightUnit?: string;
  buyerInfo?: { email?: string };
  recipientInfo?: { address?: WixAddr; contactDetails?: WixContact };
  shippingInfo?: { logistics?: { shippingDestination?: { address?: WixAddr; contactDetails?: WixContact } } };
  lineItems?: Array<{ id: string; productName?: { original?: string; translated?: string }; quantity?: number; price?: { amount?: string }; physicalProperties?: { weight?: number; sku?: string; shippable?: boolean } }>;
  priceSummary?: { total?: { amount?: string } };
};

/** Wix's signed "instance" parameter: base64url(signature).base64url(json), signed with the app secret. */
export function readSignedInstance(instance: string, secret: string, nowMs: number): { instanceId: string } | null {
  const [sig, payload] = String(instance ?? '').split('.');
  if (!sig || !payload) return null;
  const want = createHmac('sha256', secret).update(payload).digest('base64url');
  const got = sig.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return null;
  try {
    const j = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { instanceId?: string; signDate?: string };
    if (!j.instanceId || !/^[0-9a-f-]{36}$/i.test(j.instanceId)) return null;
    if (j.signDate && Date.parse(j.signDate) < nowMs - 24 * 3600_000) return null; // links older than a day are not accepted
    return { instanceId: j.instanceId };
  } catch { return null; }
}

export class WixIntegration {
  private readonly db: Db;
  private readonly clock: Clock;
  private readonly box: SecretBox;
  fetch: typeof fetch = fetch;
  private readonly tokens = new Map<string, { token: string; until: number }>();
  constructor(db: Db, clock: Clock, box: SecretBox) { this.db = db; this.clock = clock; this.box = box; }
  private now() { return this.clock.now().toISOString(); }
  private get cfg() { return { id: process.env.WIX_APP_ID ?? '', secret: process.env.WIX_APP_SECRET ?? '', base: (process.env.PUBLIC_URL ?? '').replace(/\/+$/, '') }; }
  get enabled() { return Boolean(this.cfg.id && this.cfg.secret); }
  private need() { if (!this.enabled) throw new AppError('conflict', 'Wix is not switched on yet'); }

  /* ---------------- connect ---------------- */

  /** Send the signed-in Kargom user to Wix to install the app on their site. */
  async installUrl(customerId: string, base: string) {
    this.need();
    const state = randomBytes(18).toString('base64url');
    await this.db.run('DELETE FROM shop_oauth_states WHERE created_at < $1', [new Date(this.clock.now().getTime() - 3600_000).toISOString()]);
    await this.db.run('INSERT INTO shop_oauth_states (state, customer_id, shop, created_at) VALUES ($1,$2,$3,$4)', [state, customerId, 'wix', this.now()]);
    const q = new URLSearchParams({ appId: this.cfg.id, redirectUrl: `${this.cfg.base || base}/api/shop/wix/callback`, state });
    return `https://www.wix.com/installer/install?${q}`;
  }

  /** Back from the Wix install: exchange the code, then ask Wix which site (instance) approved us. */
  async callback(params: URLSearchParams, signedInCustomer: string | null) {
    this.need();
    const state = params.get('state') ?? '';
    const st = state ? await this.db.get<{ customer_id: string; created_at: string }>("SELECT * FROM shop_oauth_states WHERE state = $1 AND shop = 'wix'", [state]) : undefined;
    if (st) await this.db.run('DELETE FROM shop_oauth_states WHERE state = $1', [state]);
    const fresh = st && Date.parse(st.created_at) > this.clock.now().getTime() - 30 * 60_000;
    const customerId = (fresh ? st!.customer_id : null) ?? signedInCustomer;
    if (!customerId) throw new AppError('unauthorized', 'Please sign in to Kargom and connect Wix again.');
    const code = params.get('code');
    if (!code) throw new AppError('bad_request', 'Wix did not send an approval code');
    const r = await this.fetch(`${API}/oauth/access`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ grant_type: 'authorization_code', client_id: this.cfg.id, client_secret: this.cfg.secret, code }),
    });
    const tok = (await r.json().catch(() => ({}))) as { access_token?: string };
    if (!r.ok || !tok.access_token) throw new AppError('provider_failed', `Wix did not give access (${r.status})`);
    const info = await this.instanceInfo(tok.access_token);
    return this.attach(customerId, info);
  }

  /** Opened from the app's page in the Wix dashboard (signed "instance" parameter). */
  async fromDashboard(instance: string, customerId: string) {
    this.need();
    const s = readSignedInstance(instance, this.cfg.secret, this.clock.now().getTime());
    if (!s) throw new AppError('unauthorized', 'This Wix link could not be verified. Open Kargom again from your Wix dashboard.');
    const token = await this.token(s.instanceId);
    return this.attach(customerId, await this.instanceInfo(token));
  }

  private async instanceInfo(token: string) {
    const r = await this.fetch(`${API}/apps/v1/instance`, { headers: { Authorization: token }, signal: AbortSignal.timeout(15_000) });
    const j = (await r.json().catch(() => ({}))) as { instance?: { instanceId?: string }; site?: { siteDisplayName?: string; url?: string; siteId?: string } };
    if (!r.ok || !j.instance?.instanceId) throw new AppError('provider_failed', 'Wix did not say which site this is');
    return { instanceId: j.instance.instanceId, name: j.site?.siteDisplayName || (j.site?.url ?? '').replace(/^https?:\/\//, '') || 'Wix site', url: j.site?.url ?? '' };
  }

  private async attach(customerId: string, info: { instanceId: string; name: string; url: string }) {
    const taken = await this.db.get<Conn>("SELECT * FROM shop_connections WHERE platform = 'wix' AND shop = $1", [info.instanceId]);
    if (taken && taken.status === 'active' && taken.customer_id !== customerId) throw new AppError('conflict', 'This Wix site is already connected to another Kargom account');
    const meta = this.box.seal({ instanceId: info.instanceId, url: info.url });
    if (taken) await this.db.run("UPDATE shop_connections SET customer_id = $1, token = $2, shop_name = $3, status = 'active' WHERE id = $4", [customerId, meta, info.name.slice(0, 80), taken.id]);
    else await this.db.run("INSERT INTO shop_connections (id, customer_id, platform, shop, shop_name, token, scopes, status, created_at) VALUES ($1,$2,'wix',$3,$4,$5,'','active',$6)",
      [newId('shc'), customerId, info.instanceId, info.name.slice(0, 80), meta, this.now()]);
    await this.sync(customerId).catch((e) => console.warn(`[wix] first sync for ${info.name}: ${(e as Error).message}`));
    return { customerId, name: info.name };
  }

  /* ---------------- Wix REST ---------------- */

  private async token(instanceId: string) {
    const hit = this.tokens.get(instanceId);
    if (hit && hit.until > Date.now()) return hit.token;
    const r = await this.fetch(`${API}/oauth2/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ grant_type: 'client_credentials', client_id: this.cfg.id, client_secret: this.cfg.secret, instance_id: instanceId }),
    });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!r.ok || !j.access_token) {
      if (r.status === 400 || r.status === 401 || r.status === 403 || r.status === 404) {
        await this.db.run("UPDATE shop_connections SET status = 'uninstalled' WHERE platform = 'wix' AND shop = $1", [instanceId]);
        throw new AppError('conflict', 'Kargom is no longer installed on this Wix site. Please connect it again.');
      }
      throw new AppError('provider_failed', `Wix: ${r.status}`);
    }
    this.tokens.set(instanceId, { token: j.access_token, until: Date.now() + Math.max(60, (j.expires_in ?? 14400) - 300) * 1000 });
    return j.access_token;
  }

  private async call<T>(c: Conn, method: string, path: string, body?: unknown): Promise<T> {
    if (c.status !== 'active') throw new AppError('conflict', 'This Wix site is not connected');
    const token = await this.token(c.shop);
    const r = await this.fetch(`${API}${path}`, { method, headers: { Authorization: token, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20_000),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const j = (await r.json().catch(() => ({}))) as T & { message?: string; details?: { applicationError?: { description?: string; code?: string } } };
    if (!r.ok) {
      const d = (j as { details?: { applicationError?: { code?: string; description?: string } }; message?: string });
      const e = new AppError('provider_failed', `Wix: ${d.details?.applicationError?.description ?? d.message ?? r.status}`);
      (e as AppError & { wixCode?: string }).wixCode = d.details?.applicationError?.code;
      throw e;
    }
    return j;
  }

  /* ---------------- orders ---------------- */

  /** Paid, approved orders that are not (fully) fulfilled yet. */
  async sync(customerId: string) {
    const conns = await this.db.all<Conn>("SELECT * FROM shop_connections WHERE customer_id = $1 AND platform = 'wix' AND status = 'active'", [customerId]);
    let n = 0;
    for (const c of conns) {
      const d = await this.call<{ orders?: WixOrder[] }>(c, 'POST', '/ecom/v1/orders/search', { search: {
        filter: { status: { $eq: 'APPROVED' }, paymentStatus: { $in: ['PAID', 'PARTIALLY_PAID'] }, fulfillmentStatus: { $in: ['NOT_FULFILLED', 'PARTIALLY_FULFILLED'] }, archived: { $eq: false } },
        sort: [{ fieldName: 'createdDate', order: 'DESC' }], cursorPaging: { limit: 100 },
      } });
      const now = this.now();
      for (const o of d.orders ?? []) {
        const dest = o.shippingInfo?.logistics?.shippingDestination;
        const a = dest?.address ?? o.recipientInfo?.address ?? {};
        const who = { ...(o.recipientInfo?.contactDetails ?? {}), ...(dest?.contactDetails ?? {}) };
        const line1 = a.addressLine1 || [a.streetAddress?.number, a.streetAddress?.name].filter(Boolean).join(' ');
        if (!line1) continue; // digital or pickup orders
        const shipTo: ShipTo = {
          name: [who.firstName, who.lastName].filter(Boolean).join(' ') || who.company || '', company: who.company ?? '', line1, line2: a.addressLine2 ?? '',
          city: a.city ?? '', postcode: String(a.postalCode ?? '').toUpperCase(), country: (a.country || 'GB').toUpperCase(), phone: who.phone ?? '', email: o.buyerInfo?.email ?? '',
        };
        const lines = (o.lineItems ?? []).filter((l) => l.physicalProperties?.shippable !== false);
        const items = lines.map((l) => ({ name: String(l.productName?.original ?? l.productName?.translated ?? 'Item').slice(0, 120), quantity: Number(l.quantity) || 1, sku: l.physicalProperties?.sku ?? '', valuePence: pence(l.price?.amount) }));
        const toG = String(o.weightUnit).toUpperCase() === 'LB' ? 453.592 : 1000;
        const grams = Math.round(lines.reduce((s, l) => s + (Number(l.physicalProperties?.weight) || 0) * toG * (Number(l.quantity) || 1), 0));
        const existing = await this.db.get<OrderRow>('SELECT * FROM shop_orders WHERE connection_id = $1 AND external_id = $2', [c.id, o.id]);
        if (existing) {
          if (existing.status !== 'open') continue;
          await this.db.run('UPDATE shop_orders SET ship_to = $1, items = $2, weight_grams = $3, total_pence = $4, fulfillment_orders = $5, synced_at = $6 WHERE id = $7',
            [JSON.stringify(shipTo), JSON.stringify(items), grams, pence(o.priceSummary?.total?.amount), JSON.stringify(lines.map((l) => l.id)), now, existing.id]);
        } else {
          await this.db.run(`INSERT INTO shop_orders (id, connection_id, customer_id, external_id, name, ordered_at, buyer_email, ship_to, items, weight_grams, total_pence, currency, fulfillment_orders, status, synced_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'open',$14)`,
            [newId('sho'), c.id, customerId, o.id, `#${o.number ?? o.id.slice(0, 8)}`, o.createdDate ?? now, shipTo.email || null, JSON.stringify(shipTo), JSON.stringify(items), grams,
              pence(o.priceSummary?.total?.amount), o.currency ?? null, JSON.stringify(lines.map((l) => l.id)), now]);
          n++;
        }
      }
      await this.db.run('UPDATE shop_connections SET last_sync_at = $1 WHERE id = $2', [now, c.id]);
    }
    return n;
  }

  /** A fulfillment with the tracking number on the Wix order (Wix may email the buyer). Safe to call more than once. */
  async pushTracking(shipmentId: string) {
    const o = await this.db.get<OrderRow>('SELECT * FROM shop_orders WHERE shipment_id = $1', [shipmentId]);
    if (!o || o.pushed_at) return false;
    const conn = await this.db.get<Conn>('SELECT * FROM shop_connections WHERE id = $1', [o.connection_id]);
    if (conn?.platform !== 'wix') return false;
    const s = await this.db.get<{ tracking_number: string | null; carrier: string; status: string }>('SELECT tracking_number, carrier, status FROM shipments WHERE id = $1', [shipmentId]);
    if (!s?.tracking_number || s.status === 'failed') return false;
    const ids = JSON.parse(o.fulfillment_orders) as string[];
    const link = TRACK_URL[s.carrier]?.(encodeURIComponent(s.tracking_number));
    try {
      await this.call(conn, 'POST', `/ecom/v1/fulfillments/orders/${encodeURIComponent(o.external_id)}/create-fulfillment`, { fulfillment: {
        lineItems: ids.map((id) => ({ id })),
        trackingInfo: { trackingNumber: s.tracking_number, shippingProvider: CARRIER_LABEL[s.carrier] ?? s.carrier, ...(link ? { trackingLink: link } : {}) },
      } }).catch((e: AppError & { wixCode?: string }) => { if (e.wixCode !== 'TRACKING_NUMBER_ALREADY_EXISTS') throw e; });
      await this.db.run('UPDATE shop_orders SET pushed_at = $1, push_error = NULL WHERE id = $2', [this.now(), o.id]);
      return true;
    } catch (e) {
      await this.db.run('UPDATE shop_orders SET push_error = $1 WHERE id = $2', [(e as Error).message.slice(0, 300), o.id]);
      console.warn(`[wix] tracking for ${o.name}: ${(e as Error).message}`);
      return false;
    }
  }
}
