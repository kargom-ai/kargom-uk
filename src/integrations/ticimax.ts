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
 * Ticimax for senders. The merchant creates a web service "Yetki Kodu" in their Ticimax admin
 * (Ayarlar → Yetki Kodu Yönetimi) and pastes it here with their shop address. Ticimax is SOAP:
 * we read the shop's own WSDL to get the exact names and order of the fields, then
 *  - SelectSiparis: approved (2) and packing (4) orders come in,
 *  - SaveKargoTakipNo + SetSiparisKargoyaVerildi: tracking number on the order, status "Kargoya verildi".
 */

/* ---------------- a very small XML reader (SOAP answers only) ---------------- */

type XNode = { name: string; attrs: Record<string, string>; children: XNode[]; text: string };
const unesc = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#x?[0-9a-f]+);/gi, (_, e: string) =>
  ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()] ?? String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
const local = (n: string) => n.slice(n.indexOf(':') + 1);

export function parseXml(xml: string): XNode {
  const root: XNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) { if (stack.length > 1) stack.pop(); }
    else if (m[3]) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? '').matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]!] = unesc(a[2] ?? a[3] ?? '');
      const node: XNode = { name: m[3], attrs, children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6]) top.text += unesc(m[6]);
  }
  return root;
}

/** Element tree → plain object (namespace prefixes dropped; repeated names become arrays). */
function toObj(n: XNode): any {
  if (!n.children.length) return Object.entries(n.attrs).some(([k, v]) => local(k) === 'nil' && v === 'true') ? null : n.text.trim();
  const o: Record<string, any> = {};
  for (const c of n.children) {
    const k = local(c.name), v = toObj(c);
    if (k in o) o[k] = Array.isArray(o[k]) ? [...o[k], v] : [o[k], v]; else o[k] = v;
  }
  return o;
}
const find = (n: XNode, name: string): XNode | undefined => {
  if (local(n.name) === name) return n;
  for (const c of n.children) { const f = find(c, name); if (f) return f; }
  return undefined;
};
const arr = <T>(v: T | T[] | null | undefined): T[] => (v == null || v === '' ? [] : Array.isArray(v) ? v : [v]);
const xesc = (s: unknown) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

/* ---------------- the shop's WSDL: names, order and namespaces of the fields ---------------- */

type Field = { name: string; type: string; nillable: boolean };
type ComplexT = { ns: string; fields: Field[] };
export type Wsdl = { tns: string; actions: Record<string, string>; params: Record<string, Field[]>; types: Record<string, ComplexT> };

export function readWsdl(xml: string): Wsdl {
  const doc = parseXml(xml);
  const defs = doc.children.find((c) => local(c.name) === 'definitions');
  const tns = defs?.attrs.targetNamespace ?? 'http://tempuri.org/';
  const actions: Record<string, string> = {};
  const params: Record<string, Field[]> = {};
  const types: Record<string, ComplexT> = {};
  const walk = (n: XNode, schemaNs: string) => {
    const ln = local(n.name);
    const ns = ln === 'schema' ? (n.attrs.targetNamespace ?? schemaNs) : schemaNs;
    if (ln === 'operation') {
      const op = n.children.find((c) => local(c.name) === 'operation' && c.attrs.soapAction);
      if (op && n.attrs.name) actions[n.attrs.name] = op.attrs.soapAction!;
    }
    if (ln === 'complexType' && n.attrs.name) types[n.attrs.name] = { ns, fields: seq(n) };
    if (ln === 'element' && n.attrs.name && ns === tns) {
      const ct = n.children.find((c) => local(c.name) === 'complexType');
      if (ct) params[n.attrs.name] = seq(ct);
    }
    for (const c of n.children) walk(c, ns);
  };
  const seq = (ct: XNode): Field[] => {
    const out: Field[] = [];
    const go = (x: XNode) => {
      if (local(x.name) === 'element' && x.attrs.name) out.push({ name: x.attrs.name, type: local(x.attrs.type ?? 'xs:string'), nillable: x.attrs.nillable === 'true' });
      else if (local(x.name) !== 'complexType' || x === ct) for (const c of x.children) go(c);
    };
    // base type first (complexContent/extension)
    for (const c of ct.children) go(c);
    return out;
  };
  if (defs) walk(defs, tns);
  return { tns, actions, params, types };
}

/** Values we set on purpose; everything else gets a neutral value ("no filter"). */
const FILTER_SET: Record<string, unknown> = { SiparisID: 0, UyeID: 0, IptalEdilmisUrunler: false, UrunGetir: true, OdemeGetir: false, KampanyaGetir: false };

function valueXml(w: Wsdl, typeName: string, name: string, value: unknown, prefixes: Map<string, string>): string {
  const t = w.types[typeName];
  const nsOf = (ns: string) => { if (!prefixes.has(ns)) prefixes.set(ns, `d${prefixes.size}`); return prefixes.get(ns)!; };
  if (t) {
    const p = nsOf(t.ns);
    const obj = (value ?? {}) as Record<string, unknown>;
    return `<${name}>${t.fields.map((f) => {
      const tag = `${p}:${f.name}`;
      const v = f.name in obj ? obj[f.name] : undefined;
      if (w.types[f.type]) return valueXml(w, f.type, tag, v, prefixes);
      if (v === null || (v === undefined && (f.nillable || /dateTime/i.test(f.type)))) return `<${tag} i:nil="true"/>`;
      if (v !== undefined) return `<${tag}>${xesc(v)}</${tag}>`;
      if (/int|long|short|decimal|double/i.test(f.type)) return `<${tag}>-1</${tag}>`;
      if (/boolean/i.test(f.type)) return `<${tag}>false</${tag}>`;
      return `<${tag}></${tag}>`;
    }).join('')}</${name}>`;
  }
  return value === null || value === undefined ? `<${name} i:nil="true"/>` : `<${name}>${xesc(value)}</${name}>`;
}

/* ---------------- country names Ticimax may send ---------------- */

const COUNTRY: Record<string, string> = {
  turkiye: 'TR', turkey: 'TR', 'united kingdom': 'GB', ingiltere: 'GB', 'birlesik krallik': 'GB', uk: 'GB', 'great britain': 'GB', almanya: 'DE', germany: 'DE',
  fransa: 'FR', france: 'FR', hollanda: 'NL', netherlands: 'NL', belcika: 'BE', belgium: 'BE', irlanda: 'IE', ireland: 'IE', ispanya: 'ES', spain: 'ES', italya: 'IT', italy: 'IT',
  'amerika birlesik devletleri': 'US', abd: 'US', 'united states': 'US', usa: 'US', avusturya: 'AT', austria: 'AT', isvicre: 'CH', switzerland: 'CH', polonya: 'PL', poland: 'PL',
  kanada: 'CA', canada: 'CA', avustralya: 'AU', australia: 'AU', azerbaycan: 'AZ', azerbaijan: 'AZ', kktc: 'CY', kibris: 'CY', cyprus: 'CY',
};
export function countryCode(v: unknown): string {
  const s = String(v ?? '').trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const k = s.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/\s+/g, ' ');
  return COUNTRY[k] ?? 'TR';
}

export class TicimaxIntegration {
  private readonly db: Db;
  private readonly clock: Clock;
  private readonly box: SecretBox;
  fetch: typeof fetch = fetch;
  lookup: (host: string) => Promise<string[]> = async (host) => (await dnsLookup(host, { all: true })).map((r) => r.address);
  private readonly wsdlCache = new Map<string, { at: number; w: Wsdl }>();
  constructor(db: Db, clock: Clock, box: SecretBox) { this.db = db; this.clock = clock; this.box = box; }
  private now() { return this.clock.now().toISOString(); }

  private async safe(site: string) {
    const host = new URL(site).hostname;
    let ips: string[] = [];
    try { ips = await this.lookup(host); } catch { throw new AppError('bad_request', `We could not find ${host}. Check the address of your shop.`); }
    if (!ips.length || ips.some(privateIp)) throw new AppError('bad_request', `We could not reach ${host}`);
  }

  private async wsdl(site: string): Promise<Wsdl> {
    const hit = this.wsdlCache.get(site);
    if (hit && Date.now() - hit.at < 3600_000) return hit.w;
    await this.safe(site);
    const r = await this.fetch(`${site}/Servis/SiparisServis.svc?singleWsdl`, { signal: AbortSignal.timeout(20_000), redirect: 'manual' });
    const text = r.ok ? await r.text() : '';
    if (!text.includes('SelectSiparis')) throw new AppError('bad_request', 'We could not find Ticimax\'s order service on this address. Use your shop\'s main address, for example https://www.my-shop.com');
    const w = readWsdl(text);
    this.wsdlCache.set(site, { at: Date.now(), w });
    return w;
  }

  /** Call one SOAP operation with arguments in the order the WSDL gives. */
  private async soap(site: string, key: string, op: string, args: Record<string, unknown>): Promise<XNode> {
    const w = await this.wsdl(site);
    await this.safe(site);
    const order: Field[] = w.params[op] ?? Object.keys(args).map((name) => ({ name, type: 'string', nillable: false }));
    const prefixes = new Map<string, string>();
    const parts = order.map((f) => {
      const v = f.name.toLowerCase() === 'uyekodu' ? key : args[f.name];
      if (v === undefined && !w.types[f.type]) return '';
      return valueXml(w, w.types[f.type] ? f.type : '', f.name, v, prefixes);
    }).join('');
    const nsDecl = [...prefixes].map(([ns, p]) => ` xmlns:${p}="${xesc(ns)}"`).join('');
    const body = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i="http://www.w3.org/2001/XMLSchema-instance"${nsDecl}><s:Body><${op} xmlns="${xesc(w.tns)}">${parts}</${op}></s:Body></s:Envelope>`;
    const r = await this.fetch(`${site}/Servis/SiparisServis.svc`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30_000),
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${w.actions[op] ?? `${w.tns.replace(/\/?$/, '/')}ISiparisServis/${op}`}"` }, body,
    });
    const doc = parseXml(await r.text());
    const fault = find(doc, 'Fault');
    if (fault || !r.ok) {
      const msg = (fault && (find(fault, 'faultstring')?.text || find(fault, 'Text')?.text)) || `HTTP ${r.status}`;
      if (/yetki|uye ?kodu|üye ?kodu|unauthori|authorization/i.test(msg)) throw new AppError('unauthorized', 'Ticimax did not accept this Yetki Kodu. Check it in Ayarlar → Yetki Kodu Yönetimi.');
      throw new AppError('provider_failed', `Ticimax: ${msg.trim().slice(0, 200)}`);
    }
    return doc;
  }

  /* ---------------- connect ---------------- */

  async connect(customerId: string, siteIn: unknown, keyIn: unknown) {
    const site = normaliseSite(siteIn);
    const key = String(keyIn ?? '').trim();
    if (key.length < 6 || key.length > 200 || /\s/.test(key)) throw new AppError('bad_request', 'Paste the Yetki Kodu from Ticimax (Ayarlar → Yetki Kodu Yönetimi)');
    const taken = await this.db.get<Conn>("SELECT * FROM shop_connections WHERE platform = 'ticimax' AND shop = $1 AND status = 'active'", [site]);
    if (taken && taken.customer_id !== customerId) throw new AppError('conflict', 'This shop is already connected to another Kargom account');
    await this.select(site, key, -1, 1); // proves the address and the code work
    const sealed = this.box.seal({ key });
    const name = new URL(site).hostname.replace(/^www\./, '');
    const existing = await this.db.get<Conn>("SELECT * FROM shop_connections WHERE platform = 'ticimax' AND shop = $1", [site]);
    if (existing) await this.db.run("UPDATE shop_connections SET customer_id = $1, token = $2, status = 'active', shop_name = $3 WHERE id = $4", [customerId, sealed, name, existing.id]);
    else await this.db.run("INSERT INTO shop_connections (id, customer_id, platform, shop, shop_name, token, scopes, status, created_at) VALUES ($1,$2,'ticimax',$3,$4,$5,'',  'active',$6)", [newId('shc'), customerId, site, name, sealed, this.now()]);
    await this.sync(customerId).catch((e) => console.warn(`[ticimax] first sync for ${site}: ${(e as Error).message}`));
  }

  private async select(site: string, key: string, status: number, count: number) {
    const doc = await this.soap(site, key, 'SelectSiparis', {
      f: { ...FILTER_SET, SiparisDurumu: status },
      s: { BaslangicIndex: 0, KayitSayisi: count, SiralamaDegeri: 'ID', SiralamaYonu: 'DESC' },
    });
    const res = find(doc, 'SelectSiparisResult');
    return res ? arr(toObj(res)?.WebSiparis) as Array<Record<string, any>> : [];
  }

  private async keyOf(c: Conn) {
    if (!c.token || c.status !== 'active') throw new AppError('conflict', 'This shop is not connected');
    return (this.box.open(c.token) as { key: string }).key;
  }

  /* ---------------- orders ---------------- */

  /** Approved (2) and packing (4) orders come in. */
  async sync(customerId: string) {
    const conns = await this.db.all<Conn>("SELECT * FROM shop_connections WHERE customer_id = $1 AND platform = 'ticimax' AND status = 'active'", [customerId]);
    let n = 0;
    for (const c of conns) {
      const key = await this.keyOf(c);
      let orders: Array<Record<string, any>>;
      try { orders = [...(await this.select(c.shop, key, 2, 100)), ...(await this.select(c.shop, key, 4, 100))]; }
      catch (e) {
        if ((e as AppError).code === 'unauthorized') await this.db.run("UPDATE shop_connections SET status = 'uninstalled', token = NULL WHERE id = $1", [c.id]);
        throw e;
      }
      const now = this.now();
      for (const o of orders) {
        const a = (o.TeslimatAdresi ?? {}) as Record<string, string>;
        if (!o.ID || !a.Adres) continue;
        const shipTo: ShipTo = {
          name: a.AliciAdi || o.AdiSoyadi || '', company: '', line1: String(a.Adres).replace(/\s+/g, ' ').trim(), line2: a.Ilce ?? '',
          city: a.Il ?? '', postcode: String(a.PostaKodu ?? '').toUpperCase(), country: countryCode(a.Ulke), phone: a.AliciTelefon ?? '', email: o.Mail ?? '',
        };
        const lines = arr((o.Urunler as Record<string, any> | undefined)?.WebSiparisUrun) as Array<Record<string, string>>;
        const items = lines.filter((l) => !/iptal/i.test(String(l.DurumAd ?? ''))).map((l) => ({ name: String(l.UrunAdi ?? 'Item').slice(0, 120), quantity: Math.max(1, Math.round(Number(l.Adet) || 1)), sku: l.StokKodu ?? '', valuePence: Math.round((Number(l.Tutar) || 0) * 100) }));
        const ext = String(o.ID);
        const total = Math.round((Number(o.SiparisToplamTutari ?? o.ToplamTutar) || 0) * 100);
        const existing = await this.db.get<OrderRow>('SELECT * FROM shop_orders WHERE connection_id = $1 AND external_id = $2', [c.id, ext]);
        if (existing) {
          if (existing.status !== 'open') continue;
          await this.db.run('UPDATE shop_orders SET ship_to = $1, items = $2, total_pence = $3, synced_at = $4 WHERE id = $5', [JSON.stringify(shipTo), JSON.stringify(items), total, now, existing.id]);
        } else {
          const at = o.SiparisTarihi && !Number.isNaN(Date.parse(o.SiparisTarihi)) ? new Date(o.SiparisTarihi).toISOString() : now;
          await this.db.run(`INSERT INTO shop_orders (id, connection_id, customer_id, external_id, name, ordered_at, buyer_email, ship_to, items, weight_grams, total_pence, currency, fulfillment_orders, status, synced_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,'[]','open',$12)`,
            [newId('sho'), c.id, customerId, ext, `#${o.SiparisNo || o.ID}`, at, shipTo.email || null, JSON.stringify(shipTo), JSON.stringify(items), total, String(o.ParaBirimi || 'TRY').toUpperCase().replace('TL', 'TRY'), now]);
          n++;
        }
      }
      await this.db.run('UPDATE shop_connections SET last_sync_at = $1 WHERE id = $2', [now, c.id]);
    }
    return n;
  }

  /** Tracking number on the Ticimax order, then status "Kargoya verildi". Safe to call more than once. */
  async pushTracking(shipmentId: string) {
    const o = await this.db.get<OrderRow>('SELECT * FROM shop_orders WHERE shipment_id = $1', [shipmentId]);
    if (!o || o.pushed_at) return false;
    const conn = await this.db.get<Conn>('SELECT * FROM shop_connections WHERE id = $1', [o.connection_id]);
    if (conn?.platform !== 'ticimax') return false;
    const s = await this.db.get<{ tracking_number: string | null; carrier: string; status: string }>('SELECT tracking_number, carrier, status FROM shipments WHERE id = $1', [shipmentId]);
    if (!s?.tracking_number || s.status === 'failed') return false;
    try {
      const key = await this.keyOf(conn);
      const url = TRACK_URL[s.carrier]?.(encodeURIComponent(s.tracking_number)) ?? '';
      await this.soap(conn.shop, key, 'SaveKargoTakipNo', { siparisId: o.external_id, kargoKodu: CARRIER_LABEL[s.carrier] ?? s.carrier, kargoTakipNo: s.tracking_number,
        kargoTakipLink: url, BarkodBilgisi: s.tracking_number, KargoTakipLinkGoster: Boolean(url) });
      await this.soap(conn.shop, key, 'SetSiparisKargoyaVerildi', { siparisId: o.external_id });
      await this.db.run('UPDATE shop_orders SET pushed_at = $1, push_error = NULL WHERE id = $2', [this.now(), o.id]);
      return true;
    } catch (e) {
      await this.db.run('UPDATE shop_orders SET push_error = $1 WHERE id = $2', [(e as Error).message.slice(0, 300), o.id]);
      console.warn(`[ticimax] tracking for ${o.name}: ${(e as Error).message}`);
      return false;
    }
  }
}
