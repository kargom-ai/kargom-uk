import type { Db } from '../db/db.ts';
import { AppError } from '../core/errors.ts';
import type { ShopifyIntegration, Conn, OrderRow, ShipTo } from './shopify.ts';
import type { WooIntegration } from './woo.ts';

export const PLATFORM_NAME: Record<string, string> = { shopify: 'Shopify', woo: 'WooCommerce' };

/** One place for the sender's connected shops: Shopify, WooCommerce (and later others). */
export class StoreHub {
  private readonly db: Db;
  readonly shopify: ShopifyIntegration;
  readonly woo: WooIntegration;
  constructor(db: Db, shopify: ShopifyIntegration, woo: WooIntegration) { this.db = db; this.shopify = shopify; this.woo = woo; }

  async overview(customerId: string) {
    const conns = await this.db.all<Conn>("SELECT * FROM shop_connections WHERE customer_id = $1 AND status = 'active' ORDER BY created_at", [customerId]);
    const rows = await this.db.all<OrderRow>("SELECT * FROM shop_orders WHERE customer_id = $1 AND status IN ('open','shipped') ORDER BY ordered_at DESC LIMIT 300", [customerId]);
    const byId = Object.fromEntries(conns.map((c) => [c.id, c]));
    const store = (c: Conn) => ({ id: c.id, platform: c.platform, shop: c.shop, lastSyncAt: c.last_sync_at,
      name: c.shop_name || c.shop.replace('.myshopify.com', '').replace(/^https:\/\/(www\.)?/, '') });
    return {
      enabled: this.shopify.enabled,
      shopify: { enabled: this.shopify.enabled, stores: conns.filter((c) => c.platform === 'shopify').map(store) },
      woo: { enabled: true, stores: conns.filter((c) => c.platform === 'woo').map(store) },
      orders: rows.filter((o) => byId[o.connection_id]).map((o) => this.view(o, byId[o.connection_id]!)),
    };
  }

  private view(o: OrderRow, c: Conn) {
    const to = JSON.parse(o.ship_to) as ShipTo, items = JSON.parse(o.items) as Array<{ name: string; quantity: number }>;
    return { id: o.id, platform: c.platform, store: c.shop_name || c.shop, name: o.name, orderedAt: o.ordered_at, to: { name: to.name, city: to.city, postcode: to.postcode, country: to.country },
      items: items.map((i) => `${i.quantity} × ${i.name}`), weightGrams: o.weight_grams, totalPence: o.total_pence, currency: o.currency, status: o.status,
      shipmentId: o.shipment_id, pushedAt: o.pushed_at, pushError: o.push_error };
  }

  /** Check every connected shop for new orders. A shop that fails does not stop the others. */
  async sync(customerId: string) {
    let added = 0;
    const errors: string[] = [];
    if (await this.db.get("SELECT id FROM shop_connections WHERE customer_id = $1 AND platform = 'shopify' AND status = 'active'", [customerId])) {
      try { added += (await this.shopify.sync(customerId)).added; } catch (e) { errors.push((e as Error).message); }
    }
    try { added += await this.woo.sync(customerId); } catch (e) { errors.push((e as Error).message); }
    return { added, errors, ...(await this.overview(customerId)) };
  }

  private async ownOrder(customerId: string, id: string) {
    const o = await this.db.get<OrderRow>('SELECT * FROM shop_orders WHERE id = $1', [id]);
    if (!o || o.customer_id !== customerId) throw new AppError('not_found', 'Order not found');
    return o;
  }

  async disconnect(customerId: string, connId: string) {
    const c = await this.db.get<Conn>('SELECT * FROM shop_connections WHERE id = $1', [connId]);
    if (!c || c.customer_id !== customerId) throw new AppError('not_found', 'Shop not found');
    await this.db.run("UPDATE shop_connections SET status = 'uninstalled', token = NULL WHERE id = $1", [c.id]);
    await this.db.run("DELETE FROM shop_orders WHERE connection_id = $1 AND status = 'open'", [c.id]);
    return this.overview(customerId);
  }

  /** What the Send-a-parcel page fills in for this order. */
  async prefill(customerId: string, id: string) {
    const o = await this.ownOrder(customerId, id);
    const c = await this.db.get<Conn>('SELECT platform FROM shop_connections WHERE id = $1', [o.connection_id]);
    return { id: o.id, name: o.name, platform: c?.platform ?? 'shopify', platformName: PLATFORM_NAME[c?.platform ?? ''] ?? 'Shop',
      to: JSON.parse(o.ship_to) as ShipTo, weightGrams: o.weight_grams, items: JSON.parse(o.items), currency: o.currency };
  }

  async ignore(customerId: string, id: string) {
    const o = await this.ownOrder(customerId, id);
    await this.db.run("UPDATE shop_orders SET status = 'ignored' WHERE id = $1", [o.id]);
    return this.overview(customerId);
  }

  /** Tie a Kargom shipment to the order; tracking goes to the shop now, or when the label arrives. */
  async link(customerId: string, id: string, shipmentId: string) {
    const o = await this.ownOrder(customerId, id);
    const s = await this.db.get<{ id: string; customer_id: string }>('SELECT id, customer_id FROM shipments WHERE id = $1', [shipmentId]);
    if (!s || s.customer_id !== customerId) throw new AppError('not_found', 'Shipment not found');
    await this.db.run("UPDATE shop_orders SET shipment_id = $1, status = 'shipped' WHERE id = $2", [s.id, o.id]);
    await this.pushTracking(s.id).catch(() => {});
    const c = (await this.db.get<Conn>('SELECT * FROM shop_connections WHERE id = $1', [o.connection_id]))!;
    return this.view(await this.ownOrder(customerId, id), c);
  }

  /** Called when a label is ready too. Each platform only acts on its own orders. */
  async pushTracking(shipmentId: string) {
    return (await this.shopify.pushTracking(shipmentId)) || (await this.woo.pushTracking(shipmentId));
  }
}
