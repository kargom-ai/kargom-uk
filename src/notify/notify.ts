import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/db.ts';
import type { Clock } from '../core/clock.ts';
import { newId } from '../core/ids.ts';
import type { Address } from '../providers/types.ts';
import { CARRIER_LABEL } from './names.ts';
import type { Channel } from './channels.ts';
import { toE164 } from './phone.ts';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Tells the customer their label is ready, on WhatsApp (with the PDF) and by SMS (with a link).
 * Each channel is sent at most once per shipment; failures are recorded, never thrown.
 */
export class Notifier {
  private readonly db: Db;
  private readonly clock: Clock;
  channels: Channel[];
  private publicUrl: string;
  /** Instant labels: notify 'all', only 'guests' (they have no account to look in), or 'none'. */
  instantPolicy: 'all' | 'guests' | 'none' = 'guests';
  constructor(db: Db, clock: Clock, channels: Channel[] = [], publicUrl = '') {
    this.db = db; this.clock = clock; this.channels = channels; this.publicUrl = publicUrl.replace(/\/+$/, '');
  }
  configure(channels: Channel[], publicUrl: string, instantPolicy?: 'all' | 'guests' | 'none') {
    this.channels = channels; this.publicUrl = publicUrl.replace(/\/+$/, '');
    if (instantPolicy) this.instantPolicy = instantPolicy;
  }

  get enabled() { return { whatsapp: this.channels.some((c) => c.id === 'whatsapp'), sms: this.channels.some((c) => c.id === 'sms') }; }

  async labelReady(shipmentId: string, opts: { instant?: boolean } = {}): Promise<Array<{ channel: string; status: string; detail?: string }>> {
    if (!this.channels.length || !this.publicUrl) return [];
    if (opts.instant && this.instantPolicy === 'none') return [];
    const s = await this.db.get<{ id: string; ref: string; customer_id: string; status: string; label_url: string | null; tracking_number: string | null; service_name: string; carrier: string; from_json: string }>(
      'SELECT id, ref, customer_id, status, label_url, tracking_number, service_name, carrier, from_json FROM shipments WHERE id = $1', [shipmentId]);
    if (!s || s.status === 'failed' || !s.label_url) return [];
    const c = await this.db.get<{ phone: string | null; name: string; email: string; company: string | null; account_type: string }>(
      'SELECT phone, name, email, company, account_type FROM customers WHERE id = $1', [s.customer_id]);
    if (opts.instant && this.instantPolicy === 'guests' && c?.account_type !== 'guest') return [];
    const from = JSON.parse(s.from_json) as Address;
    const to = toE164(from.phone, from.country) ?? toE164(c?.phone, 'GB');
    if (!to) return [{ channel: 'all', status: 'skipped', detail: 'no mobile number' }];

    // A private link that opens and prints the label without an account.
    const token = randomBytes(24).toString('base64url');
    await this.db.run('INSERT INTO guest_links (token_hash, shipment_id, email, created_at) VALUES ($1,$2,$3,$4)', [
      sha256(token), s.id, (c?.account_type === 'guest' ? c.company : c?.email) ?? '', this.clock.now().toISOString()]);
    const msg = {
      to, name: (from.name || c?.name || 'there').split(/\s+/)[0]!, service: s.service_name || CARRIER_LABEL[s.carrier] || 'parcel',
      tracking: s.tracking_number || s.ref, ref: s.ref, link: `${this.publicUrl}/l/${token}`, pdfUrl: `${this.publicUrl}/api/guest/label/${token}/pdf`,
    };
    const out: Array<{ channel: string; status: string; detail?: string }> = [];
    for (const ch of this.channels) {
      const id = newId('ntf');
      try {
        await this.db.run(`INSERT INTO notifications (id, shipment_id, channel, kind, to_number, status, created_at) VALUES ($1,$2,$3,'label_ready',$4,'sending',$5)`,
          [id, s.id, ch.id, to, this.clock.now().toISOString()]);
      } catch { out.push({ channel: ch.id, status: 'already_sent' }); continue; }
      try {
        const ref = await ch.sendLabelReady(msg);
        await this.db.run("UPDATE notifications SET status = 'sent', detail = $1 WHERE id = $2", [ref, id]);
        out.push({ channel: ch.id, status: 'sent' });
      } catch (e) {
        const detail = (e as Error).message.slice(0, 300);
        await this.db.run("UPDATE notifications SET status = 'failed', detail = $1 WHERE id = $2", [detail, id]);
        console.warn(`[notify] ${ch.id} for ${s.ref} failed: ${detail}`);
        out.push({ channel: ch.id, status: 'failed', detail });
      }
    }
    return out;
  }

  /** Admin check: send one SMS to a number to prove the NetGSM settings work. */
  async testSms(phone: string): Promise<string> {
    const sms = this.channels.find((c) => c.id === 'sms');
    if (!sms) throw new Error('SMS is not set up yet. Save the SMS details first.');
    const to = toE164(phone, phone.trim().startsWith('05') ? 'TR' : 'GB');
    if (!to) throw new Error('That does not look like a mobile number. Use e.g. 07700 900123 or +90 532 123 45 67.');
    const id = await sms.sendLabelReady({ to, name: 'Test', service: 'TEST', tracking: 'TEST123', ref: 'TEST', link: `${this.publicUrl || 'https://kargom.eu'}/l/test`, pdfUrl: '' });
    return `Sent to +${to} (message ${id})`;
  }

  /** Admin "send again": clears earlier attempts for this shipment, then sends. */
  async resend(shipmentId: string) {
    await this.db.run("DELETE FROM notifications WHERE shipment_id = $1 AND kind = 'label_ready'", [shipmentId]);
    return this.labelReady(shipmentId);
  }
}
