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

/** Carriers reject empty strings and nulls in odd places, so only send fields that have a value. */
/** Split a long street line at word breaks into pieces of at most `max` characters (UK carriers allow 40 per line). */
export function splitLine(text: string, max = 40): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of text.replace(/\s+/g, ' ').trim().split(' ')) {
    const word = w.length > max ? w.slice(0, max) : w;
    if (!cur) cur = word;
    else if (`${cur} ${word}`.length <= max) cur = `${cur} ${word}`;
    else { out.push(cur.replace(/,$/, '')); cur = word; }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Phone in the form UK carriers accept (starting 0 or 44), or null when it is not a UK number.
 * "+44 7700 900123" -> "447700900123", "7700900123" -> "07700900123".
 */
export function ukPhone(raw: string | undefined | null): string | null {
  let d = String(raw ?? '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('0044')) d = d.slice(2);
  if (d.startsWith('440')) d = `44${d.slice(3)}`; // "+44 (0)7700..."
  if (/^44\d{9,10}$/.test(d) || /^0\d{9,10}$/.test(d)) return d;
  if (/^7\d{9}$/.test(d)) return `0${d}`; // mobile typed without the 0
  return null;
}

const UKISH = ['GB', 'JE', 'GG', 'IM'];

function seAddress(a: Address, role: 'from' | 'to') {
  // Line 1 may be at most 40 characters: the rest moves to lines 2 and 3.
  const lines = [...splitLine(a.line1 || 'Address'), ...(a.line2 ? splitLine(a.line2) : [])];
  // Most carriers insist on a phone number; quotes from the homepage do not have one yet.
  const fallback = process.env.DEFAULT_SHIPPER_PHONE ?? '07700900000';
  const typed = a.phone && a.phone.trim() ? a.phone.trim() : '';
  const phone = UKISH.includes(a.country) ? (ukPhone(typed) ?? ukPhone(fallback) ?? fallback) : (typed || fallback);
  const out: Record<string, string> = {
    name: (a.name || 'Customer').slice(0, 40),
    address_line1: lines[0]!,
    city_locality: a.city || 'City',
    postal_code: a.postcode,
    country_code: a.country,
    address_residential_indicator: 'unknown',
  };
  if (phone) out.phone = phone;
  if (a.company) out.company_name = a.company.slice(0, 40);
  // Carriers want an email for the sender: theirs if we have it, otherwise our order desk.
  const email = a.email || (role === 'from' ? process.env.DEFAULT_SHIPPER_EMAIL || 'orders@kargom.co.uk' : '');
  if (email) out.email = email;
  if (lines[1]) out.address_line2 = lines[1];
  if (lines[2]) out.address_line3 = lines.slice(2).join(' ').slice(0, 40);
  return out;
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
      // Put the provider's own explanation in the message, so the admin screen and logs say what is wrong.
      let why = '';
      try {
        const j = JSON.parse(text) as { errors?: Array<{ message?: string; field_name?: string }>; message?: string };
        why = (j.errors ?? []).map((e) => e.message ?? '').filter(Boolean).join('; ') || j.message || '';
      } catch { why = text.slice(0, 200); }
      throw new AppError('provider_failed', `${this.id} ${method} ${path} failed with ${res.status}${why ? `: ${why.slice(0, 300)}` : ''}`, { body: text.slice(0, 500) });
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  private shipmentBody(req: ShipmentRequest) {
    const p = req.parcel;
    return {
      ship_from: seAddress(req.from, 'from'),
      ship_to: seAddress(req.to, 'to'),
      packages: [
        {
          weight: { value: p.weightGrams, unit: 'gram' },
          dimensions: { unit: 'centimeter', length: p.lengthCm, width: p.widthCm, height: p.heightCm },
        },
      ],
      ...(req.customs
        ? { customs: {
            contents: req.customs.contents,
            non_delivery: 'return_to_sender',
            customs_items: req.customs.items.map((i) => ({
              description: i.description,
              quantity: i.quantity,
              value: { currency: 'gbp', amount: i.valuePence / 100 },
              harmonized_tariff_code: i.hsCode ?? null,
              country_of_origin: i.originCountry,
            })),
          } }
        : {}),
    };
  }

  private carrierCache: string[] | null = null;
  /** Carrier error messages from the latest rate request (shown on the admin test button). */
  lastProblems: string[] = [];

  /** Carrier accounts connected in the ShipStation / ShipEngine dashboard. */
  async listCarriers(signal?: AbortSignal): Promise<Array<{ id: string; code: string; name: string }>> {
    const out = await this.call<{ carriers?: Array<{ carrier_id: string; carrier_code: string; friendly_name: string; nickname?: string }> }>('GET', '/carriers', undefined, signal);
    // friendly_name is the carrier ("Royal Mail"); nickname can be a billing label, so it is not used.
    const list = (out.carriers ?? []).map((c) => ({ id: c.carrier_id, code: c.carrier_code, name: c.friendly_name || c.carrier_code }));
    this.carrierCache = list.map((c) => c.id);
    return list;
  }

  private async carrierIds(signal: AbortSignal): Promise<string[]> {
    if (this.cfg.carrierIds.length) return this.cfg.carrierIds;
    if (!this.carrierCache) this.carrierCache = (await this.listCarriers(signal)).map((c) => c.id);
    return this.carrierCache;
  }

  /** Same route + parcel asked again within a few minutes: answer from memory instead of a 3-6 s carrier round trip. */
  private rateCache = new Map<string, { at: number; rates: ProviderRate[] }>();
  private static readonly RATE_CACHE_MS = 5 * 60_000;

  async getRates(req: ShipmentRequest, signal: AbortSignal): Promise<ProviderRate[]> {
    // Full request in the key: a rate id belongs to one exact shipment (addresses included).
    const key = JSON.stringify(req);
    const hit = this.rateCache.get(key);
    if (hit && Date.now() - hit.at < ShipEngineProvider.RATE_CACHE_MS) return hit.rates;
    const started = Date.now();
    const rates = await this.fetchRates(req, signal);
    console.log(`[${this.id}] rates ${req.from.postcode} → ${req.to.postcode} ${req.parcel.weightGrams} g: ${rates.length} in ${Date.now() - started} ms`);
    if (rates.length) {
      this.rateCache.set(key, { at: Date.now(), rates });
      if (this.rateCache.size > 500) this.rateCache.delete(this.rateCache.keys().next().value!);
    }
    return rates;
  }

  private async fetchRates(req: ShipmentRequest, signal: AbortSignal): Promise<ProviderRate[]> {
    const carrierIds = await this.carrierIds(signal);
    if (!carrierIds.length) return [];
    const out = await this.call<{ rate_response?: { rates?: SeRate[]; invalid_rates?: SeRate[]; errors?: Array<{ message?: string }> } }>(
      'POST',
      '/rates',
      { rate_options: { carrier_ids: carrierIds }, shipment: this.shipmentBody(req) },
      signal,
    );
    const rates = out.rate_response?.rates ?? [];
    // Make carrier-side refusals visible in the server log instead of silently showing no prices.
    const problems = [
      ...(out.rate_response?.errors ?? []).map((e) => e.message ?? ''),
      ...[...rates, ...(out.rate_response?.invalid_rates ?? [])].filter((r) => r.error_messages?.length).map((r) => `${r.carrier_friendly_name ?? r.carrier_code}: ${r.error_messages!.join('; ')}`),
      ...rates.filter((r) => !r.error_messages?.length && r.shipping_amount?.currency?.toLowerCase() !== 'gbp').slice(0, 3)
        .map((r) => `${r.carrier_friendly_name}: price in ${r.shipping_amount?.currency?.toUpperCase()} not GBP (account currency)`),
    ].filter(Boolean);
    const usable = rates.filter((r) => !r.error_messages?.length && r.shipping_amount?.currency?.toLowerCase() === 'gbp');
    this.lastProblems = problems.slice(0, 10);
    if (!usable.length) console.warn(`[${this.id}] no usable rates (${rates.length} returned). ${problems.slice(0, 5).join(' | ') || 'No error given: check the carriers serve this route.'}`);
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
    // A rate id is used up once a label is bought from it, so never hand it out again.
    for (const [k, v] of this.rateCache) if (v.rates.some((x) => x.providerRateId === rate.providerRateId)) this.rateCache.delete(k);
    type Out = { label_id: string; tracking_number: string; label_download?: { pdf?: string; href?: string }; shipment_cost?: { amount: number } };
    let out: Out;
    try {
      out = await this.call<Out>('POST', `/labels/rates/${encodeURIComponent(rate.providerRateId)}`, {
        label_format: this.cfg.labelFormat ?? 'pdf',
        label_layout: this.cfg.labelLayout ?? '4x6',
        ...(this.cfg.testLabels ? { test_label: true } : {}),
      });
    } catch (e) {
      // Test mode: some carriers (most UK ones on ShipStation) cannot make test labels. Rather than fail,
      // hand back our own sample label marked "not valid for postage", so the booking flow can be tried.
      if (this.cfg.testLabels && /test labels? (are|is) not supported/i.test((e as Error).message)) {
        const id = `test-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        return { providerLabelId: id, trackingNumber: `TEST${Date.now().toString().slice(-9)}`, labelUrl: `/api/test-label/${id}.pdf?c=${encodeURIComponent(rate.carrierName ?? rate.carrier)}&s=${encodeURIComponent(rate.serviceName)}`, cost: rate.cost };
      }
      throw e;
    }
    return {
      providerLabelId: out.label_id,
      trackingNumber: out.tracking_number,
      labelUrl: out.label_download?.pdf ?? out.label_download?.href ?? '',
      cost: out.shipment_cost ? toPence(out.shipment_cost.amount) : rate.cost,
    };
  }

  async voidLabel(providerLabelId: string): Promise<boolean> {
    if (providerLabelId.startsWith('test-')) return true; // our own sample label: nothing to cancel at the carrier
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
