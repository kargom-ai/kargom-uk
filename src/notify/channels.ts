import { AppError } from '../core/errors.ts';
import { renderEmail, renderText, type EmailParts, type Tone } from './email.ts';

export type LabelMessage = {
  to: string; name: string; service: string; tracking: string; ref: string; link: string; pdfUrl: string; email?: string;
  /** For the email: carrier, addresses and parcel, shown as a details card. */
  details?: { carrier?: string; carrierLogo?: string | null; toName?: string; toAddress?: string; from?: string; parcel?: string; paid?: string; booked?: string; dropOff?: boolean };
  baseUrl?: string;
};

export interface Channel {
  readonly id: 'whatsapp' | 'sms' | 'email';
  sendLabelReady(m: LabelMessage): Promise<string>; // returns the provider's message id
}

/**
 * WhatsApp Business (Meta Cloud API). Messages we start must use an approved template.
 * Template (create in WhatsApp Manager, category UTILITY, header DOCUMENT, 4 body variables):
 *   "Hi {{1}}, your Kargom label for {{2}} is ready. Tracking: {{3}}.
 *    Print the attached PDF, or open it here: {{4}}"
 */
export class WhatsAppCloud implements Channel {
  readonly id = 'whatsapp' as const;
  private readonly cfg: { token: string; phoneNumberId: string; template: string; lang: string; version: string; fetchImpl?: typeof fetch };
  constructor(cfg: { token: string; phoneNumberId: string; template?: string; lang?: string; version?: string; fetchImpl?: typeof fetch }) {
    this.cfg = { template: 'label_ready', lang: 'en_GB', version: 'v21.0', ...cfg } as WhatsAppCloud['cfg'];
  }
  async sendLabelReady(m: LabelMessage): Promise<string> {
    const body = {
      messaging_product: 'whatsapp', to: m.to, type: 'template',
      template: {
        name: this.cfg.template, language: { code: this.cfg.lang },
        components: [
          { type: 'header', parameters: [{ type: 'document', document: { link: m.pdfUrl, filename: `Kargom-label-${m.ref}.pdf` } }] },
          { type: 'body', parameters: [m.name, m.service, m.tracking, m.link].map((text) => ({ type: 'text', text: text.slice(0, 200) })) },
        ],
      },
    };
    const res = await (this.cfg.fetchImpl ?? fetch)(`https://graph.facebook.com/${this.cfg.version}/${encodeURIComponent(this.cfg.phoneNumberId)}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.cfg.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message?: string; code?: number } };
    if (!res.ok || !j.messages?.[0]) throw new AppError('provider_failed', `WhatsApp: ${j.error?.message ?? res.status}${j.error?.code ? ` (code ${j.error.code})` : ''}`);
    return j.messages[0].id;
  }
}

/**
 * NetGSM SMS (HTTP GET API). Success answers start with 00/01/02 followed by the job id.
 * Sending to UK (+44) numbers needs international SMS enabled on the NetGSM account.
 */
export class NetgsmSms implements Channel {
  readonly id = 'sms' as const;
  private readonly cfg: { usercode: string; password: string; header: string; fetchImpl?: typeof fetch };
  constructor(cfg: { usercode: string; password: string; header: string; fetchImpl?: typeof fetch }) { this.cfg = cfg; }
  async sendLabelReady(m: LabelMessage): Promise<string> {
    // Plain ASCII keeps it to one SMS (160 characters).
    const text = `Kargom: your ${m.service} label is ready. Open and print it: ${m.link} Tracking ${m.tracking}`
      .normalize('NFKD').replace(/[^\x20-\x7E]/g, '').slice(0, 300);
    const q = new URLSearchParams({ usercode: this.cfg.usercode, password: this.cfg.password, gsmno: m.to, message: text, msgheader: this.cfg.header, dil: 'TR' });
    let res: Response;
    try { res = await (this.cfg.fetchImpl ?? fetch)(`https://api.netgsm.com.tr/sms/send/get?${q}`, { signal: AbortSignal.timeout(15_000) }); }
    catch (e) { throw new AppError('provider_failed', `NetGSM SMS: could not reach NetGSM (${(e as Error).message})`); }
    const out = (await res.text()).trim();
    const [code, id] = out.split(/\s+/);
    if (!res.ok || !['00', '01', '02'].includes(code ?? '')) {
      const why: Record<string, string> = { '20': 'message text problem', '30': 'wrong username/password or API access not allowed', '40': 'sender name (msgheader) not approved', '50': 'account not allowed to send to this number', '51': 'IYS check failed', '70': 'bad parameters', '80': 'sending limit reached', '85': 'duplicate within 1 minute' };
      throw new AppError('provider_failed', `NetGSM SMS: ${why[code ?? ''] ?? (out.slice(0, 120) || String(res.status))}`);
    }
    return id ?? code!;
  }
}

/**
 * The SMS Works (UK). POST /v1/message/send with the account's JWT as the Authorization header.
 * Alphanumeric sender: 4–11 letters/digits, no spaces (e.g. "Kargom").
 */
export class SmsWorks implements Channel {
  readonly id = 'sms' as const;
  private readonly cfg: { token: string; sender: string; fetchImpl?: typeof fetch };
  constructor(cfg: { token: string; sender: string; fetchImpl?: typeof fetch }) {
    // The site shows the token as "JWT" + a line break + "eyJ…", and people often copy only the "eyJ…" part.
    // The API wants exactly "JWT eyJ…", so we rebuild that whatever was pasted.
    const raw = cfg.token.replace(/\s+/g, ' ').trim().replace(/^JWT\s*/i, '');
    this.cfg = { ...cfg, token: `JWT ${raw}` };
  }
  async sendLabelReady(m: LabelMessage): Promise<string> {
    const content = `Kargom: your ${m.service} label is ready. Open and print it: ${m.link} Tracking ${m.tracking}`.normalize('NFKD').replace(/[^\x20-\x7E]/g, '');
    const sender = this.cfg.sender.replace(/[^A-Za-z0-9]/g, '').slice(0, 11);
    let res: Response;
    try {
      res = await (this.cfg.fetchImpl ?? fetch)('https://api.thesmsworks.co.uk/v1/message/send', {
        method: 'POST', headers: { Authorization: this.cfg.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender, destination: m.to, content, tag: 'label_ready' }), signal: AbortSignal.timeout(15_000),
      });
    } catch (e) { throw new AppError('provider_failed', `SMS: could not reach The SMS Works (${(e as Error).message})`); }
    const j = (await res.json().catch(() => ({}))) as { messageid?: string; messageId?: string; message?: string; error?: string; errorCode?: number };
    if (!res.ok) {
      const why: Record<number, string> = { 401: 'API token is wrong (create a new one under API Key)', 402: 'out of credit: top up The SMS Works account', 403: 'account not allowed to send yet' };
      throw new AppError('provider_failed', `SMS: ${why[res.status] ?? j.message ?? j.error ?? res.status}`);
    }
    return String(j.messageid ?? j.messageId ?? 'sent');
  }
}

/** Badge and tone for a plain notice, from its wording. */
function noticeBadge(subject: string, heading: string): { text: string; tone: Tone } {
  const t = `${subject} ${heading}`;
  if (/not possible|rejected|failed|problem|cancel/i.test(t)) return { text: 'Action needed', tone: 'danger' };
  if (/accepted|won|paid|delivered|ordered|arrived|ready/i.test(t)) return { text: 'Good news', tone: 'success' };
  if (/to pay|pay |price|quote|offer/i.test(t)) return { text: /offer/i.test(t) ? 'New offer' : 'Price ready', tone: 'info' };
  if (/request|lead/i.test(t)) return { text: 'New request', tone: 'info' };
  if (/message|reply/i.test(t)) return { text: 'New message', tone: 'info' };
  return { text: 'Update', tone: 'neutral' };
}

/**
 * Email through Resend (free up to 3,000 a month). Every email uses the Kargom design (email.ts).
 * The label email carries the label PDF as an attachment and a button to open and print it.
 */
export class ResendEmail implements Channel {
  readonly id = 'email' as const;
  private readonly cfg: { apiKey: string; from: string; baseUrl: string; fetchImpl?: typeof fetch };
  constructor(cfg: { apiKey: string; from: string; baseUrl?: string; fetchImpl?: typeof fetch }) { this.cfg = { baseUrl: process.env.PUBLIC_URL || 'https://kargom.co.uk', ...cfg }; }

  private async post(body: Record<string, unknown>) {
    const res = await (this.cfg.fetchImpl ?? fetch)('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({ from: this.cfg.from, ...body }),
    }).catch((e: Error) => { throw new AppError('provider_failed', `Email: could not reach Resend (${e.message})`); });
    const j = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok) throw new AppError('provider_failed', `Email: ${j.message ?? j.name ?? res.status}`);
    return j.id ?? 'sent';
  }

  /** The parts of the "label ready" email (exported for the preview and tests). */
  labelParts(m: LabelMessage): EmailParts {
    const d = m.details ?? {};
    const rows: Array<[string, string]> = [['Tracking number', m.tracking], ['Service', m.service]];
    if (d.toName || d.toAddress) rows.push(['Delivering to', [d.toName, d.toAddress].filter(Boolean).join('\n')]);
    if (d.from) rows.push(['Sending from', d.from]);
    if (d.parcel) rows.push(['Parcel', d.parcel]);
    if (d.paid) rows.push(['Paid', d.paid]);
    if (d.booked) rows.push(['Booked', d.booked]);
    return {
      baseUrl: m.baseUrl || this.cfg.baseUrl,
      preheader: `Your ${m.service} label is attached as a PDF. Tracking ${m.tracking}.`,
      badge: { text: 'Label ready', tone: 'success' },
      title: 'Your label is ready to print',
      intro: [`Hi ${m.name}, your ${m.service} label is attached to this email as a PDF.`, 'Print it, stick it on your parcel and it is ready to go.'],
      illustration: 'parcels',
      details: { heading: `Shipment ${m.ref}`, logo: d.carrierLogo ?? null, rows },
      cta: { href: m.link, text: 'Open and print your label' },
      steps: { heading: 'What happens next', items: [
        'Print the attached label on A4 paper or a 4×6 label printer.',
        'Stick it flat on the largest side of the parcel and cover any old labels or barcodes.',
        d.dropOff ? `Take it to a ${d.carrier ? `${d.carrier} ` : ''}drop-off point within 7 days.` : 'Have the parcel ready on the day of collection.',
        `Track it any time on Kargom with ${m.tracking}.`,
      ] },
      after: ['Anyone with the button link can open the label, so forward it only to people you trust.'],
    };
  }

  async sendLabelReady(m: LabelMessage): Promise<string> {
    if (!m.email) throw new AppError('bad_request', 'No email address for this customer');
    const parts = this.labelParts(m);
    return this.post({
      to: [m.email], subject: `Your label is ready · ${m.service} · ${m.ref}`, html: renderEmail(parts), text: renderText(parts),
      attachments: m.pdfUrl ? [{ path: m.pdfUrl, filename: `Kargom-label-${m.ref}.pdf` }] : [],
    });
  }

  /** A plain notice email (requests, offers, Turkey warehouse updates) in the same design. */
  async sendNotice(to: string, subject: string, heading: string, lines: string[], link?: { href: string; text: string }): Promise<string> {
    const parts: EmailParts = {
      baseUrl: this.cfg.baseUrl, preheader: lines[0] ?? subject, badge: noticeBadge(subject, heading), title: heading, intro: lines,
      illustration: /parcel|box|warehouse|turkey|order/i.test(`${subject} ${heading}`) ? 'parcels' : null,
      ...(link ? { cta: link } : {}),
    };
    return this.post({ to: [to], subject, html: renderEmail(parts), text: renderText(parts) });
  }
}
