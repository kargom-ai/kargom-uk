import { AppError } from '../core/errors.ts';
import type { Label, ProviderEvent, ProviderRate, ShipmentRequest, ShippingProvider, TrackingStatus, Address } from './types.ts';

/**
 * Adapter for ShipEngine-style REST APIs. ShipEngine (v1) and ShipStation's
 * API v2 share this shape (rates → buy label from rate → void), so one class
 * serves both; only the base URL and auth header value differ.
 *
 *   ShipEngine:  https://api.shipengine.com/v1   header API-Key
 *   ShipStation: https://api.shipstation.com/v2  header API-Key   (check against your account's API docs)
 */
export type ShipEngineConfig = {
  id: string;            // 'shipengine' | 'shipstation'
  baseUrl: string;
  apiKey: string;
  carrierIds: string[];  // carrier accounts connected in the provider dashboard
  labelFormat?: 'pdf' | 'zpl' | 'png';
  labelLayout?: '4x6' | 'letter';
  /** Ask for test labels (no carrier charge). Always on outside production. */
  testLabels?: boolean;
  fetchImpl?: typeof fetch;
};

type SeRate = {
  rate_id: string;
  carrier_id: string;
  carrier_code: string;
  carrier_friendly_name: string;
  service_code: string;
  service_type: string;
  shipping_amount: { currency: string; amount: number };
  other_amount?: { amount: number } | null;
  confirmation_amount?: { amount: number } | null;
  delivery_days?: number | null;
  error_messages?: string[];
};

const CARRIER_ALIASES: Array<[RegExp, string]> = [
  [/royal.?mail/i, 'royal_mail'],
  [/parcelforce/i, 'parcelforce'],
  [/evri|hermes/i, 'evri'],
  [/\bdpd/i, 'dpd'],
  [/yodel/i, 'yodel'],
  [/inpost/i, 'inpost'],
  [/\bups\b|^ups/i, 'ups'],
  [/dhl/i, 'dhl'],
  [/fedex/i, 'fedex'],
];

export function normaliseCarrier(code: string, friendly: string): string {
  for (const [re, id] of CARRIER_ALIASES) if (re.test(code) || re.test(friendly)) return id;
  return code.toLowerCase();
}

const toPence = (amount: number) => Math.round(amount * 100);

function seAddress(a: Address) {
  return {
    name: a.name,
    company_name: a.company ?? null,
    phone: a.phone ?? '',
    email: a.email ?? null,
    address_line1: a.line1,
    address_line2: a.line2 ?? null,
    city_locality: a.city,
    state_province: '',
    postal_code: a.postcode,
    country_code: a.country,
  };
}

const TRACK_MAP: Record<string, TrackingStatus> = {
  AC: 'collected',
  IT: 'in_transit',
  OD: 'out_for_delivery',
  DE: 'delivered',
  EX: 'exception',
  AT: 'exception',
};

export class ShipEngineProvider implements ShippingProvider {
  readonly id: string;
  private readonly cfg: ShipEngineConfig;
  private readonly fetch: typeof fetch;

  constructor(cfg: ShipEngineConfig) {
    this.id = cfg.id;
    this.cfg = cfg;
    this.fetch = cfg.fetchImpl ?? fetch;
  }

  private async call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const res = await this.fetch(`${this.cfg.baseUrl}${path}`, {
      method,
      headers: { 'API-Key': this.cfg.apiKey, 'Content-Type': 'application/json' },
      body: body === undefined ? null : JSON.stringify(body),
      signal: signal ?? null,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new AppError('provider_failed', `${this.id} ${method} ${path} failed with ${res.status}`, { body: text.slice(0, 500) });
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  private shipmentBody(req: ShipmentRequest) {
    const p = req.parcel;
    return {
      ship_from: seAddress(req.from),
      ship_to: seAddress(req.to),
      packages: [
        {
          weight: { value: p.weightGrams, unit: 'gram' },
          dimensions: { unit: 'centimeter', length: p.lengthCm, width: p.widthCm, height: p.heightCm },
        },
      ],
      customs: req.customs
        ? {
            contents: req.customs.contents,
            non_delivery: 'return_to_sender',
            customs_items: req.customs.items.map((i) => ({
              description: i.description,
              quantity: i.quantity,
              value: { currency: 'gbp', amount: i.valuePence / 100 },
              harmonized_tariff_code: i.hsCode ?? null,
              country_of_origin: i.originCountry,
            })),
          }
        : null,
    };
  }

  private carrierCache: string[] | null = null;

  /** Carrier accounts connected in the ShipStation / ShipEngine dashboard. */
  async listCarriers(signal?: AbortSignal): Promise<Array<{ id: string; code: string; name: string }>> {
    const out = await this.call<{ carriers?: Array<{ carrier_id: string; carrier_code: string; friendly_name: string; nickname?: string }> }>('GET', '/carriers', undefined, signal);
    // friendly_name is the carrier ("Royal Mail"); nickname can be a billing label, so it is not used.
    return (out.carriers ?? []).map((c) => ({ id: c.carrier_id, code: c.carrier_code, name: c.friendly_name || c.carrier_code }));
  }

  private async carrierIds(signal: AbortSignal): Promise<string[]> {
    if (this.cfg.carrierIds.length) return this.cfg.carrierIds;
    if (!this.carrierCache) this.carrierCache = (await this.listCarriers(signal)).map((c) => c.id);
    return this.carrierCache;
  }

  async getRates(req: ShipmentRequest, signal: AbortSignal): Promise<ProviderRate[]> {
    const carrierIds = await this.carrierIds(signal);
    if (!carrierIds.length) return [];
    const out = await this.call<{ rate_response?: { rates?: SeRate[] } }>(
      'POST',
      '/rates',
      { rate_options: { carrier_ids: carrierIds }, shipment: this.shipmentBody(req) },
      signal,
    );
    const rates = out.rate_response?.rates ?? [];
    return rates
      .filter((r) => !r.error_messages?.length && r.shipping_amount?.currency?.toLowerCase() === 'gbp')
      .map((r) => ({
        provider: this.id,
        providerRateId: r.rate_id,
        carrier: normaliseCarrier(r.carrier_code, r.carrier_friendly_name),
        carrierName: r.carrier_friendly_name,
        serviceCode: r.service_code,
        serviceName: r.service_type,
        cost: toPence(r.shipping_amount.amount + (r.other_amount?.amount ?? 0) + (r.confirmation_amount?.amount ?? 0)),
        transitDays: r.delivery_days ?? null,
        dropOff: /drop|shop|locker|post office/i.test(r.service_type),
      }));
  }

  async buyLabel(rate: ProviderRate, _req: ShipmentRequest, _idempotencyKey: string): Promise<Label> {
    const out = await this.call<{
      label_id: string;
      tracking_number: string;
      label_download?: { pdf?: string; href?: string };
      shipment_cost?: { amount: number };
    }>('POST', `/labels/rates/${encodeURIComponent(rate.providerRateId)}`, {
      label_format: this.cfg.labelFormat ?? 'pdf',
      label_layout: this.cfg.labelLayout ?? '4x6',
      ...(this.cfg.testLabels ? { test_label: true } : {}),
    });
    return {
      providerLabelId: out.label_id,
      trackingNumber: out.tracking_number,
      labelUrl: out.label_download?.pdf ?? out.label_download?.href ?? '',
      cost: out.shipment_cost ? toPence(out.shipment_cost.amount) : rate.cost,
    };
  }

  async voidLabel(providerLabelId: string): Promise<boolean> {
    const out = await this.call<{ approved?: boolean }>('PUT', `/labels/${encodeURIComponent(providerLabelId)}/void`);
    return Boolean(out.approved);
  }

  /**
   * Tracking webhooks. Authenticity is checked by the router (secret token in
   * the webhook URL) before this runs.
   */
  async parseWebhook(_headers: Record<string, string | undefined>, rawBody: string): Promise<ProviderEvent[]> {
    const body = JSON.parse(rawBody) as {
      resource_type?: string;
      data?: { tracking_number?: string; status_code?: string; status_description?: string; events?: Array<{ occurred_at?: string; event_code?: string }> };
    };
    if (body.resource_type !== 'API_TRACK' || !body.data?.tracking_number || !body.data.status_code) return [];
    const status = TRACK_MAP[body.data.status_code];
    if (!status) return [];
    const last = body.data.events?.[0];
    const occurredAt = last?.occurred_at ?? new Date().toISOString();
    return [
      {
        type: 'tracking',
        eventId: `${body.data.tracking_number}:${body.data.status_code}:${occurredAt}`,
        trackingNumber: body.data.tracking_number,
        status,
        description: body.data.status_description ?? status,
        occurredAt,
      },
    ];
  }
}
