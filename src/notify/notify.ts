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

  /** Send a plain notice by email, if an email channel is set up. Silently does nothing otherwise. */
  async emailNotice(to: string, subject: string, heading: string, lines: string[], link?: { href: string; text: string }) {
    const ch = this.channels.find((c) => c.id === 'email') as unknown as { sendNotice?: (...a: unknown[]) => Promise<string> } | undefined;
    if (!ch?.sendNotice || !to) return null;
    return ch.sendNotice(to, subject, heading, lines, link);
  }

  get enabled() { return { whatsapp: this.channels.some((c) => c.id === 'whatsapp'), sms: this.channels.some((c) => c.id === 'sms'), email: this.channels.some((c) => c.id === 'email') }; }

  async labelReady(shipmentId: string, opts: { instant?: boolean } = {}): Promise<Array<{ channel: string; status: string; detail?: string }>> {
    if (!this.channels.length || !this.publicUrl) return [];
    const s = await this.db.get<{ id: string; ref: string; customer_id: string; status: string; label_url: string | null; tracking_number: string | null; service_name: string; carrier: string;
      from_json: string; to_json: string; parcel_json: string; price_pence: number; created_at: string }>(
      'SELECT id, ref, customer_id, status, label_url, tracking_number, service_name, carrier, from_json, to_json, parcel_json, price_pence, created_at FROM shipments WHERE id = $1', [shipmentId]);
    if (!s || s.status === 'failed' || !s.label_url) return [];
    const c = await this.db.get<{ phone: string | null; name: string; email: string; company: string | null; account_type: string }>(
      'SELECT phone, name, email, company, account_type FROM customers WHERE id = $1', [s.customer_id]);
    // The label always goes to the customer's email (with the PDF). Texts and WhatsApp follow the instant-label setting.
    const textsOn = !opts.instant || (this.instantPolicy !== 'none' && (this.instantPolicy === 'all' || c?.account_type === 'guest'));
    const from = JSON.parse(s.from_json) as Address;
    const dest = JSON.parse(s.to_json) as Address;
    const to = textsOn ? toE164(from.phone, from.country) ?? toE164(c?.phone, 'GB') : null;
    const email = (c?.account_type === 'guest' ? c?.company : c?.email) || from.email || '';
    if (!to && !email) return [{ channel: 'all', status: 'skipped', detail: 'no mobile number or email' }];

    // A private link that opens and prints the label without an account.
    const token = randomBytes(24).toString('base64url');
    await this.db.run('INSERT INTO guest_links (token_hash, shipment_id, email, created_at) VALUES ($1,$2,$3,$4)', [
      sha256(token), s.id, (c?.account_type === 'guest' ? c.company : c?.email) ?? '', this.clock.now().toISOString()]);
    let parcel = '';
    try {
      const p = JSON.parse(s.parcel_json) as { weightGrams?: number; lengthCm?: number; widthCm?: number; heightCm?: number };
      parcel = [p.weightGrams ? `${Number((p.weightGrams / 1000).toFixed(2))} kg` : '', p.lengthCm && p.widthCm && p.heightCm ? `${p.lengthCm} × ${p.widthCm} × ${p.heightCm} cm` : ''].filter(Boolean).join(' · ');
    } catch { /* old rows */ }
    const carrier = CARRIER_LABEL[s.carrier] || '';
    const LOGO: Record<string, string> = { royal_mail: 'royalmail', evri: 'evri', dpd: 'dpd', inpost: 'inpost', yodel: 'yodel', parcelforce: 'parcelforce', ups: 'ups', dhl: 'dhl', fedex: 'fedex' };
    const msg = {
      to: to ?? '', email, name: (from.name || c?.name || 'there').split(/\s+/)[0]!, service: s.service_name || carrier || 'parcel',
      tracking: s.tracking_number || s.ref, ref: s.ref, link: `${this.publicUrl}/l/${token}`, pdfUrl: `${this.publicUrl}/api/guest/label/${token}/pdf`, baseUrl: this.publicUrl,
      details: {
        carrier, carrierLogo: LOGO[s.carrier] ? `/assets/carriers/${LOGO[s.carrier]}.png` : null,
        toName: dest.name, toAddress: [dest.line1, dest.line2, `${dest.city} ${dest.postcode}`].filter(Boolean).join('\n'),
        from: [from.city, from.postcode].filter(Boolean).join(' '), parcel,
        paid: `£${(s.price_pence / 100).toFixed(2)}`, booked: new Date(s.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
        dropOff: /drop|shop|locker|post office/i.test(s.service_name),
      },
    };
    const out: Array<{ channel: string; status: string; detail?: string }> = [];
    for (const ch of this.channels) {
      if (ch.id === 'email' ? !email : !to) { out.push({ channel: ch.id, status: 'skipped' }); continue; }
      const id = newId('ntf');
      try {
        await this.db.run(`INSERT INTO notifications (id, shipment_id, channel, kind, to_number, status, created_at) VALUES ($1,$2,$3,'label_ready',$4,'sending',$5)`,
          [id, s.id, ch.id, ch.id === 'email' ? email : to, this.clock.now().toISOString()]);
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

  /** Admin check: send a sample "label ready" email. */
  async testEmail(address: string): Promise<string> {
    const ch = this.channels.find((c) => c.id === 'email');
    if (!ch) throw new Error('Email is not set up yet. Save the Resend details first.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) throw new Error('That does not look like an email address.');
    const id = await ch.sendLabelReady({ to: '', email: address, name: 'there', service: 'Royal Mail Tracked 48', tracking: 'TEST123456GB', ref: 'KGM-UK-TEST', link: `${this.publicUrl || 'https://kargom.co.uk'}/l/test`, pdfUrl: '', baseUrl: this.publicUrl,
      details: { carrier: 'Royal Mail', carrierLogo: '/assets/carriers/royalmail.png', toName: 'Sample Recipient', toAddress: '10 Downing Street\nLondon SW1A 2AA', from: 'Manchester M1 1AE', parcel: '2 kg · 30 × 20 × 15 cm', paid: '£4.59', booked: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), dropOff: true } });
    return `Sent to ${address} (email ${id})`;
  }

  /** Admin "send again": clears earlier attempts for this shipment, then sends. */
  async resend(shipmentId: string) {
    await this.db.run("DELETE FROM notifications WHERE shipment_id = $1 AND kind = 'label_ready'", [shipmentId]);
    return this.labelReady(shipmentId);
  }
}
