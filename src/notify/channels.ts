import { AppError } from '../core/errors.ts';

export type LabelMessage = { to: string; name: string; service: string; tracking: string; ref: string; link: string; pdfUrl: string; email?: string };

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

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Email through Resend (free up to 3,000 a month). The label PDF is attached by URL,
 * and the email has a button to open and print it.
 */
export class ResendEmail implements Channel {
  readonly id = 'email' as const;
  private readonly cfg: { apiKey: string; from: string; fetchImpl?: typeof fetch };
  constructor(cfg: { apiKey: string; from: string; fetchImpl?: typeof fetch }) { this.cfg = cfg; }
  async sendLabelReady(m: LabelMessage): Promise<string> {
    if (!m.email) throw new AppError('bad_request', 'No email address for this customer');
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1F2A3C;max-width:520px;margin:0 auto">
      <div style="background:#1F2A3C;padding:16px 20px;border-radius:12px 12px 0 0"><b style="color:#fff;font-size:20px">Kargom<span style="color:#33AEEF">.co.uk</span></b></div>
      <div style="border:1px solid #E1E7EF;border-top:0;border-radius:0 0 12px 12px;padding:22px 20px">
        <h1 style="font-size:22px;margin:0 0 10px">Your label is ready</h1>
        <p style="margin:0 0 14px;line-height:1.5">Hi ${esc(m.name)}, your <b>${esc(m.service)}</b> label is attached to this email as a PDF. Print it, tape it to the parcel and hand it over.</p>
        <p style="margin:0 0 18px;line-height:1.5">Tracking: <b>${esc(m.tracking)}</b><br>Reference: ${esc(m.ref)}</p>
        <a href="${esc(m.link)}" style="display:inline-block;background:#2463DB;color:#fff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px">Open and print the label</a>
        <p style="margin:18px 0 0;font-size:12px;color:#586579">Anyone with this link can open the label, so share it only with people you trust.</p>
      </div></div>`;
    const res = await (this.cfg.fetchImpl ?? fetch)('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        from: this.cfg.from, to: [m.email], subject: `Your Kargom label is ready (${m.ref})`, html,
        text: `Hi ${m.name}, your ${m.service} label is ready. Tracking ${m.tracking}. Open and print it: ${m.link}`,
        attachments: m.pdfUrl ? [{ path: m.pdfUrl, filename: `Kargom-label-${m.ref}.pdf` }] : [],
      }),
    }).catch((e: Error) => { throw new AppError('provider_failed', `Email: could not reach Resend (${e.message})`); });
    const j = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok) throw new AppError('provider_failed', `Email: ${j.message ?? j.name ?? res.status}`);
    return j.id ?? 'sent';
  }
  /** A plain notice email (marketplace: new request, new offer, offer accepted). */
  async sendNotice(to: string, subject: string, heading: string, lines: string[], link?: { href: string; text: string }): Promise<string> {
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1F2A3C;max-width:520px;margin:0 auto">
      <div style="background:#1F2A3C;padding:16px 20px;border-radius:12px 12px 0 0"><b style="color:#fff;font-size:20px">Kargom<span style="color:#33AEEF">.co.uk</span></b></div>
      <div style="border:1px solid #E1E7EF;border-top:0;border-radius:0 0 12px 12px;padding:22px 20px">
        <h1 style="font-size:22px;margin:0 0 10px">${esc(heading)}</h1>
        ${lines.map((l) => `<p style="margin:0 0 12px;line-height:1.5">${esc(l)}</p>`).join('')}
        ${link ? `<a href="${esc(link.href)}" style="display:inline-block;margin-top:6px;background:#2463DB;color:#fff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px">${esc(link.text)}</a>` : ''}
      </div></div>`;
    const res = await (this.cfg.fetchImpl ?? fetch)('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ from: this.cfg.from, to: [to], subject, html, text: [heading, ...lines, link ? `${link.text}: ${link.href}` : ''].join('\n\n') }),
    });
    const j = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) throw new AppError('provider_failed', `Email: ${j.message ?? res.status}`);
    return j.id ?? 'sent';
  }
}
