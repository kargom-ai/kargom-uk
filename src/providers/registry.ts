import type { Db } from '../db/db.ts';
import { AppError } from '../core/errors.ts';
import type { Clock } from '../core/clock.ts';
import { SecretBox } from '../auth/auth.ts';
import { PacklinkProvider } from './packlink.ts';
import { ShipEngineProvider } from './shipengine.ts';
import type { ShippingProvider } from './types.ts';

/** Which providers can be configured from the admin Connections screen, and what they need. */
export const PROVIDER_CATALOG = {
  shipstation: {
    kind: 'shipping',
    name: 'ShipStation',
    fields: ['apiKey', 'carrierIds'],
    baseUrl: { live: 'https://api.shipstation.com/v2', test: 'https://api.shipstation.com/v2' },
  },
  shipengine: {
    kind: 'shipping',
    name: 'ShipEngine',
    fields: ['apiKey', 'carrierIds'],
    baseUrl: { live: 'https://api.shipengine.com/v1', test: 'https://api.shipengine.com/v1' },
  },
  packlink: {
    kind: 'shipping',
    name: 'Packlink PRO',
    fields: ['apiKey', 'sell'],
    baseUrl: { live: 'https://api.packlink.com/v1', test: 'https://api.packlink.com/v1' },
  },
  stripe: { kind: 'payment', name: 'Stripe', fields: ['secretKey', 'publishableKey', 'webhookSecret'], baseUrl: null },
} as const;
export type ProviderId = keyof typeof PROVIDER_CATALOG;

type ConfigRow = { id: string; kind: string; mode: 'test' | 'live'; enabled: number; secrets_enc: string | null; updated_at: string };

/**
 * Builds live provider clients from the encrypted rows in provider_configs.
 * Rebuilt whenever an admin saves a connection, so keys change without a restart.
 */
export class ProviderRegistry {
  private readonly db: Db;
  private readonly box: SecretBox;
  private readonly clock: Clock;
  private shipping = new Map<string, ShippingProvider>();
  private extra = new Map<string, ShippingProvider>();

  constructor(db: Db, box: SecretBox, clock: Clock) {
    this.db = db;
    this.box = box;
    this.clock = clock;
  }

  /** Register an in-process provider (the mock in dev/tests). */
  addStatic(p: ShippingProvider) {
    this.extra.set(p.id, p);
  }

  async load(): Promise<void> {
    const rows = await this.db.all<ConfigRow>("SELECT * FROM provider_configs WHERE kind = 'shipping' AND enabled = 1");
    const next = new Map<string, ShippingProvider>();
    for (const r of rows) {
      const cat = PROVIDER_CATALOG[r.id as ProviderId];
      if (!cat || cat.kind !== 'shipping' || !r.secrets_enc) continue;
      const s = this.box.open(r.secrets_enc);
      if (r.id === 'packlink') {
        next.set(r.id, new PacklinkProvider({ apiKey: s.apiKey ?? '', baseUrl: cat.baseUrl[r.mode], sell: s.sell !== 'no' }));
        continue;
      }
      next.set(r.id, new ShipEngineProvider({
        id: r.id,
        baseUrl: cat.baseUrl[r.mode],
        apiKey: s.apiKey ?? '',
        carrierIds: (s.carrierIds ?? '').split(',').map((x) => x.trim()).filter(Boolean),
      }));
    }
    this.shipping = next;
  }

  all(): ShippingProvider[] {
    return [...this.shipping.values(), ...this.extra.values()];
  }

  get(id: string): ShippingProvider | undefined {
    return this.shipping.get(id) ?? this.extra.get(id);
  }

  async save(id: string, input: { mode: 'test' | 'live'; enabled: boolean; secrets?: Record<string, string> }) {
    const cat = PROVIDER_CATALOG[id as ProviderId];
    if (!cat) throw new AppError('not_found', 'Unknown provider');
    const prev = await this.db.get<ConfigRow>('SELECT * FROM provider_configs WHERE id = $1', [id]);
    // Blank fields keep the stored value, so the admin can change one key without retyping the rest.
    const merged = { ...(prev?.secrets_enc ? this.box.open(prev.secrets_enc) : {}) };
    for (const [k, v] of Object.entries(input.secrets ?? {})) if (v && (cat.fields as readonly string[]).includes(k)) merged[k] = v;
    await this.db.run(
      `INSERT INTO provider_configs (id, kind, mode, enabled, secrets_enc, updated_at) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET mode = excluded.mode, enabled = excluded.enabled, secrets_enc = excluded.secrets_enc, updated_at = excluded.updated_at`,
      [id, cat.kind, input.mode, input.enabled ? 1 : 0, this.box.seal(merged), this.clock.now().toISOString()],
    );
    await this.load();
  }

  /** Safe summary for the admin screen: which fields are set, masked. */
  async describe() {
    const rows = await this.db.all<ConfigRow>('SELECT * FROM provider_configs');
    return Object.entries(PROVIDER_CATALOG).map(([id, cat]) => {
      const r = rows.find((x) => x.id === id);
      const s = r?.secrets_enc ? this.box.open(r.secrets_enc) : {};
      return {
        id, name: cat.name, kind: cat.kind, mode: r?.mode ?? 'test', enabled: Boolean(r?.enabled), updatedAt: r?.updated_at ?? null,
        fields: Object.fromEntries(cat.fields.map((f) => [f, s[f] ? SecretBox.mask(s[f]!) : null])),
      };
    });
  }

  /** Stripe keys for the payments layer. */
  async stripeSecrets(): Promise<{ secretKey: string; webhookSecret: string; publishableKey: string } | null> {
    const r = await this.db.get<ConfigRow>("SELECT * FROM provider_configs WHERE id = 'stripe' AND enabled = 1");
    if (!r?.secrets_enc) return null;
    const s = this.box.open(r.secrets_enc);
    if (!s.secretKey || !s.webhookSecret) return null;
    return { secretKey: s.secretKey, webhookSecret: s.webhookSecret, publishableKey: s.publishableKey ?? '' };
  }
}
