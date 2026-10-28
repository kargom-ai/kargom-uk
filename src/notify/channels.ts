import { AppError } from '../core/errors.ts';

export type LabelMessage = { to: string; name: string; service: string; tracking: string; ref: string; link: string; pdfUrl: string };

export interface Channel {
  readonly id: 'whatsapp' | 'sms';
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
  constructor(cfg: { token: string; sender: string; fetchImpl?: typeof fetch }) { this.cfg = cfg; }
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
