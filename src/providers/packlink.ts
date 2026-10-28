import { AppError } from '../core/errors.ts';
import type { Address, Label, LabelCheck, ProviderEvent, ProviderRate, ShipmentRequest, ShippingProvider } from './types.ts';
import { normaliseCarrier } from './shipengine.ts';

/**
 * Packlink PRO, using the same REST API as Packlink's own open-source shop plugins
 * (github.com/packlink-dev/ecommerce_module_core, Apache-2.0):
 *   GET  /v1/services            rates
 *   POST /v1/shipments           create the shipment (a draft until it is paid in Packlink PRO)
 *   GET  /v1/shipments/{ref}     state
 *   GET  /v1/shipments/{ref}/labels
 *   POST /v1/shipments/callback  where Packlink sends status webhooks
 *
 * Packlink does not let an API client pay, so the label arrives later: after the
 * shipment is paid in Packlink PRO (by hand, or automatically if Packlink enables it
 * for the account). Rates are marked labelTiming 'later' so the customer is told.
 */
export type PacklinkConfig = {
  apiKey: string;
  baseUrl?: string;             // https://api.packlink.com/v1
  /** Only offer services whose label can come later? Off = rates only shown, never sold. */
  sell?: boolean;
  fetchImpl?: typeof fetch;
};

type PlService = {
  id: number | string; carrier_name: string; name: string; currency?: string; dropoff?: boolean; delivery_to_parcelshop?: boolean;
  category?: string; transit_hours?: number | string; transit_time?: string; price?: { total_price?: number; tax_price?: number; base_price?: number };
};

const READY = new Set(['READY_TO_PRINT', 'READY_FOR_COLLECTION', 'COMPLETED', 'CARRIER_OK', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED']);
const FAILED = new Set(['CARRIER_KO', 'LABELS_KO', 'INTEGRATION_KO', 'CANCELED', 'CANCELLED']);
const toPence = (n: number) => Math.round(n * 100);

function plAddress(a: Address) {
  const [name, ...rest] = (a.name || 'Customer').trim().split(/\s+/);
  return {
    name, surname: rest.join(' ') || '-', company: a.company ?? '', street1: a.line1, street2: a.line2 ?? '',
    zip_code: a.postcode, city: a.city, country: a.country,
    phone: a.phone && a.phone.trim() ? a.phone.trim() : (process.env.DEFAULT_SHIPPER_PHONE ?? '07700900000'), email: a.email ?? '',
  };
}

export class PacklinkProvider implements ShippingProvider {
  readonly id = 'packlink';
  private readonly cfg: PacklinkConfig;
  private readonly fetch: typeof fetch;
  constructor(cfg: PacklinkConfig) {
    this.cfg = cfg;
    this.fetch = cfg.fetchImpl ?? fetch;
  }
  private get base() { return (this.cfg.baseUrl ?? 'https://api.packlink.com/v1').replace(/\/+$/, ''); }

  private async call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const res = await this.fetch(`${this.base}/${path}`, {
      method,
      headers: { Authorization: this.cfg.apiKey, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? null : JSON.stringify(body),
      signal: signal ?? null,
    });
    const text = await res.text();
    if (!res.ok) {
      let why = '';
      try { const j = JSON.parse(text) as { message?: string; messages?: Array<{ message?: string }> }; why = j.message ?? (j.messages ?? []).map((m) => m.message).join('; '); } catch { why = text.slice(0, 200); }
      throw new AppError('provider_failed', `packlink ${method} /${path.split('?')[0]} failed with ${res.status}${why ? `: ${why.slice(0, 300)}` : ''}`, { body: text.slice(0, 500) });
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async getRates(req: ShipmentRequest, signal: AbortSignal): Promise<ProviderRate[]> {
    const p = req.parcel;
    const q = new URLSearchParams({
      'from[country]': req.from.country, 'from[zip]': req.from.postcode, 'to[country]': req.to.country, 'to[zip]': req.to.postcode, source: 'PRO',
      'packages[0][weight]': String(Math.round(p.weightGrams / 10) / 100), 'packages[0][length]': String(Math.ceil(p.lengthCm)),
      'packages[0][width]': String(Math.ceil(p.widthCm)), 'packages[0][height]': String(Math.ceil(p.heightCm)),
    });
    const list = await this.call<PlService[]>('GET', `services?${q}`, undefined, signal);
    return (Array.isArray(list) ? list : [])
      // Delivery to a parcel shop needs the recipient to pick a shop first; not offered yet.
      .filter((s) => !s.delivery_to_parcelshop && (s.currency ?? 'GBP').toUpperCase() === 'GBP' && typeof s.price?.base_price === 'number')
      .map((s) => {
        const hours = Number(s.transit_hours) || 0;
        return {
          provider: this.id,
          providerRateId: String(s.id),
          carrier: normaliseCarrier(s.carrier_name, s.carrier_name),
          carrierName: s.carrier_name,
          serviceCode: `pl-${s.id}`,
          serviceName: `${s.carrier_name} ${s.name}`.replace(new RegExp(`^${s.carrier_name}\\s+${s.carrier_name}`, 'i'), s.carrier_name),
          cost: toPence(s.price!.base_price!),
          transitDays: hours ? Math.max(1, Math.ceil(hours / 24)) : null,
          dropOff: Boolean(s.dropoff),
          labelTiming: 'later' as const,
        };
      });
  }

  async buyLabel(rate: ProviderRate, req: ShipmentRequest, idempotencyKey: string): Promise<Label> {
    if (this.cfg.sell === false) throw new AppError('provider_failed', 'Packlink is set to show prices only');
    const p = req.parcel;
    const value = (req.valuePence ?? req.customs?.items.reduce((s, i) => s + i.valuePence * i.quantity, 0) ?? 0) / 100;
    const draft = {
      // Packlink's own code for the United Kingdom platform is 'UN'.
      source: 'PRO', platform: 'PRO', platform_country: 'UN',
      service_id: Number(rate.providerRateId) || rate.providerRateId,
      carrier: rate.carrierName, service: rate.serviceName,
      content: (req.contents || req.customs?.items.map((i) => i.description).join(', ') || 'Goods').slice(0, 100),
      contentvalue: Math.round(value * 100) / 100, contentValue_currency: 'GBP', content_second_hand: false,
      shipment_custom_reference: idempotencyKey.slice(0, 60),
      from: plAddress(req.from), to: plAddress(req.to),
      packages: [{ weight: Math.round(p.weightGrams / 10) / 100, length: Math.ceil(p.lengthCm), width: Math.ceil(p.widthCm), height: Math.ceil(p.heightCm) }],
    };
    const out = await this.call<{ reference?: string }>('POST', 'shipments', draft);
    if (!out.reference) throw new AppError('provider_failed', 'Packlink did not return a shipment reference');
    return { providerLabelId: out.reference, trackingNumber: '', labelUrl: '', cost: rate.cost, pending: true };
  }

  async checkLabel(reference: string): Promise<LabelCheck> {
    const s = await this.call<{ state?: string; trackings?: string[] }>('GET', `shipments/${encodeURIComponent(reference)}`);
    const state = String(s.state ?? '').toUpperCase();
    if (FAILED.has(state)) return { state: 'failed', detail: state };
    if (!READY.has(state)) return { state: 'pending', detail: state || 'AWAITING_COMPLETION' };
    const labels = await this.call<unknown>('GET', `shipments/${encodeURIComponent(reference)}/labels`);
    const url = Array.isArray(labels) ? labels.find((x) => typeof x === 'string') as string | undefined : undefined;
    if (!url) return { state: 'pending', detail: `${state}, label not published yet` };
    return { state: 'ready', labelUrl: url, trackingNumber: s.trackings?.[0] ?? reference };
  }

  async voidLabel(): Promise<boolean> {
    return false; // cancel in Packlink PRO
  }

  /** Packlink posts { event, datetime, data: { shipment_reference } }; we then re-check the shipment. */
  async parseWebhook(_headers: Record<string, string | undefined>, rawBody: string): Promise<ProviderEvent[]> {
    const b = JSON.parse(rawBody) as { event?: string; datetime?: string; data?: { shipment_reference?: string } };
    const ref = b.data?.shipment_reference;
    if (!ref || !b.event?.startsWith('shipment.')) return [];
    return [{ type: 'label_update', eventId: `${ref}:${b.event}:${b.datetime ?? ''}`, providerLabelId: ref }];
  }

  /** Tell Packlink where to send status updates. */
  async registerCallback(url: string) {
    await this.call('POST', 'shipments/callback', { url });
  }
}
