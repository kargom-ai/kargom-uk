import { AppError } from '../core/errors.ts';
import type { Label, Parcel, ProviderEvent, ProviderRate, ShipmentRequest, ShippingProvider } from './types.ts';

/**
 * Deterministic provider for tests and local development. Prices come from a
 * weight-band table so the adjustment logic ("same band = no charge") can be
 * exercised exactly.
 */
type Service = { carrier: string; carrierName: string; code: string; name: string; bands: Array<[maxGrams: number, cost: number]>; days: number; dropOff: boolean };

export const MOCK_SERVICES: Service[] = [
  { carrier: 'inpost', carrierName: 'InPost', code: 'inpost_locker', name: 'InPost Locker to Locker', bands: [[2000, 166], [5000, 210], [15000, 330]], days: 2, dropOff: true },
  { carrier: 'evri', carrierName: 'Evri', code: 'evri_dropoff', name: 'Evri Drop Off', bands: [[1000, 199], [2000, 231], [5000, 360], [15000, 590]], days: 3, dropOff: true },
  { carrier: 'royal_mail', carrierName: 'Royal Mail', code: 'rm_tracked_48', name: 'Royal Mail Tracked 48', bands: [[10000, 284], [20000, 520]], days: 2, dropOff: true },
  { carrier: 'dpd', carrierName: 'DPD', code: 'dpd_next_day', name: 'DPD Next Day', bands: [[2000, 471], [5000, 650], [10000, 820], [20000, 1100]], days: 1, dropOff: false },
];

export function mockCost(serviceCode: string, parcel: Parcel): number | null {
  const s = MOCK_SERVICES.find((x) => x.code === serviceCode);
  if (!s) return null;
  // Couriers bill the higher of actual and volumetric weight (L×W×H / 5000 in kg).
  const volumetric = Math.ceil((parcel.lengthCm * parcel.widthCm * parcel.heightCm) / 5);
  const chargeable = Math.max(parcel.weightGrams, volumetric);
  const band = s.bands.find(([max]) => chargeable <= max);
  return band ? band[1] : null;
}

export class MockProvider implements ShippingProvider {
  readonly id: string;
  failNextLabel = false;
  latencyMs = 0;
  labels = new Map<string, { trackingNumber: string; voided: boolean }>();
  private seq = 0;

  constructor(id = 'mock') {
    this.id = id;
  }

  async getRates(req: ShipmentRequest, signal: AbortSignal): Promise<ProviderRate[]> {
    if (this.latencyMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, this.latencyMs);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new Error('aborted'));
        });
      });
    }
    const out: ProviderRate[] = [];
    for (const s of MOCK_SERVICES) {
      const cost = mockCost(s.code, req.parcel);
      if (cost === null) continue;
      out.push({
        provider: this.id,
        providerRateId: `${this.id}:${s.code}:${req.parcel.weightGrams}`,
        carrier: s.carrier,
        carrierName: s.carrierName,
        serviceCode: s.code,
        serviceName: s.name,
        cost,
        transitDays: s.days,
        dropOff: s.dropOff,
      });
    }
    return out;
  }

  async buyLabel(rate: ProviderRate, _req: ShipmentRequest, _key: string): Promise<Label> {
    if (this.failNextLabel) {
      this.failNextLabel = false;
      throw new AppError('provider_failed', 'Mock provider refused the label');
    }
    const id = `lbl_${++this.seq}`;
    const trackingNumber = `MOCK${String(100000 + this.seq)}`;
    this.labels.set(id, { trackingNumber, voided: false });
    return { providerLabelId: id, trackingNumber, labelUrl: `https://labels.example/${id}.pdf`, cost: rate.cost };
  }

  async voidLabel(id: string): Promise<boolean> {
    const l = this.labels.get(id);
    if (!l) return false;
    l.voided = true;
    return true;
  }

  async parseWebhook(_h: Record<string, string | undefined>, raw: string): Promise<ProviderEvent[]> {
    return (JSON.parse(raw) as { events: ProviderEvent[] }).events;
  }
}
