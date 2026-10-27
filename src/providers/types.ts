import type { Pence } from '../core/money.ts';

export type Address = {
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  line1: string;
  line2?: string;
  city: string;
  postcode: string;
  country: string; // ISO 3166-1 alpha-2
};

export type Parcel = {
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

export type CustomsItem = {
  description: string;
  quantity: number;
  valuePence: Pence;
  hsCode?: string;
  originCountry: string;
};

export type ShipmentRequest = {
  from: Address;
  to: Address;
  parcel: Parcel;
  customs?: { contents: 'merchandise' | 'gift' | 'documents' | 'returned_goods' | 'sample'; items: CustomsItem[] };
};

/** One price for one service from one provider. `cost` is net of VAT, in pence. */
export type ProviderRate = {
  provider: string;
  providerRateId: string;
  carrier: string;        // evri | royal_mail | dpd | inpost | yodel | parcelforce | ups | dhl | fedex
  carrierName: string;
  serviceCode: string;
  serviceName: string;
  cost: Pence;
  transitDays: number | null;
  dropOff: boolean;
};

export type Label = {
  providerLabelId: string;
  trackingNumber: string;
  labelUrl: string;
  cost: Pence; // final cost charged by the provider
};

export type TrackingStatus = 'booked' | 'collected' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception';

/** Normalised event from any provider webhook. */
export type ProviderEvent =
  | { type: 'tracking'; eventId: string; trackingNumber: string; status: TrackingStatus; description: string; occurredAt: string }
  | {
      type: 'measurement';
      eventId: string;
      trackingNumber: string;
      measured: Parcel;
      providerSurchargePence: Pence | null; // what the carrier billed on top, if the provider tells us
      occurredAt: string;
    };

export interface ShippingProvider {
  readonly id: string;
  getRates(req: ShipmentRequest, signal: AbortSignal): Promise<ProviderRate[]>;
  buyLabel(rate: ProviderRate, req: ShipmentRequest, idempotencyKey: string): Promise<Label>;
  voidLabel(providerLabelId: string): Promise<boolean>;
  /** Verify and parse a webhook. Returns [] for events we do not use. */
  parseWebhook(headers: Record<string, string | undefined>, rawBody: string): Promise<ProviderEvent[]>;
}
