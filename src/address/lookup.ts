import { AppError } from '../core/errors.ts';

/** One UK address in the shape our Address / ShipStation mapping expects. */
export type FoundAddress = { label: string; company: string; line1: string; line2: string; city: string; postcode: string; country: 'GB' };
export type LookupResult = {
  postcode: string;
  addresses: FoundAddress[];
  /** Town for the postcode even when no street list is available (free fallback). */
  town: string;
  source: 'ideal-postcodes' | 'postcodes.io';
  suggestions: string[];
};

const UK_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/;

/** "m11ae" → "M1 1AE"; throws when it is not a UK postcode. */
export function normalisePostcode(input: string): string {
  const m = UK_POSTCODE.exec(input.toUpperCase().replace(/\s+/g, ' ').trim());
  if (!m) throw new AppError('bad_request', 'That does not look like a UK postcode');
  return `${m[1]} ${m[2]}`;
}

type IdealAddress = { line_1: string; line_2: string; line_3: string; post_town: string; postcode: string; organisation_name: string };

/**
 * Postcode → list of delivery addresses (Royal Mail PAF via Ideal Postcodes).
 * The key stays on the server. Without a key it falls back to postcodes.io,
 * which only confirms the postcode and gives the town.
 */
export class AddressLookup {
  private readonly apiKey: string;
  private readonly fetch: typeof fetch;
  private cache = new Map<string, { at: number; value: LookupResult }>();
  private static readonly TTL = 6 * 3600_000;

  constructor(apiKey: string | undefined, fetchImpl: typeof fetch = fetch) {
    this.apiKey = apiKey ?? '';
    this.fetch = fetchImpl;
  }

  get hasAddressList() { return Boolean(this.apiKey); }

  async byPostcode(input: string): Promise<LookupResult> {
    const postcode = normalisePostcode(input);
    const hit = this.cache.get(postcode);
    if (hit && Date.now() - hit.at < AddressLookup.TTL) return hit.value;
    const value = this.apiKey ? await this.ideal(postcode) : await this.free(postcode);
    if (value.addresses.length || value.town) {
      this.cache.set(postcode, { at: Date.now(), value });
      if (this.cache.size > 5000) this.cache.delete(this.cache.keys().next().value!);
    }
    return value;
  }

  private async ideal(postcode: string): Promise<LookupResult> {
    const url = `https://api.ideal-postcodes.co.uk/v1/postcodes/${encodeURIComponent(postcode.replace(' ', ''))}?api_key=${encodeURIComponent(this.apiKey)}`;
    const res = await this.fetch(url, { signal: AbortSignal.timeout(8000) });
    const body = (await res.json().catch(() => ({}))) as { result?: IdealAddress[] | string[]; code?: number; message?: string };
    if (res.status === 404) return { postcode, addresses: [], town: '', source: 'ideal-postcodes', suggestions: (body.result as string[] | undefined) ?? [] };
    if (!res.ok) throw new AppError('provider_failed', `Address lookup failed (${res.status}${body.message ? `: ${body.message}` : ''})`);
    const list = (body.result as IdealAddress[]).map((a) => {
      const line2 = [a.line_2, a.line_3].filter(Boolean).join(', ');
      return { label: [a.line_1, line2, a.post_town].filter(Boolean).join(', '), company: a.organisation_name || '', line1: a.line_1, line2, city: titleCase(a.post_town), postcode: a.postcode, country: 'GB' as const };
    });
    return { postcode, addresses: list, town: list[0]?.city ?? '', source: 'ideal-postcodes', suggestions: [] };
  }

  private async free(postcode: string): Promise<LookupResult> {
    const res = await this.fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`, { signal: AbortSignal.timeout(6000) });
    if (res.status === 404) return { postcode, addresses: [], town: '', source: 'postcodes.io', suggestions: [] };
    if (!res.ok) throw new AppError('provider_failed', `Postcode check failed (${res.status})`);
    const body = (await res.json()) as { result?: { postcode: string; admin_district?: string; parish?: string; region?: string } };
    return { postcode: body.result?.postcode ?? postcode, addresses: [], town: body.result?.admin_district ?? '', source: 'postcodes.io', suggestions: [] };
  }
}

/** PAF post towns come in capitals ("MANCHESTER"); labels read better as "Manchester". */
function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase()).replace(/\bUpon\b/g, 'upon').replace(/\bOn\b/g, 'on');
}
