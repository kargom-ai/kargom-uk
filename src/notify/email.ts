/**
 * Kargom.co.uk email design system: one layout for every email we send.
 * Table-based and inline-styled so it looks the same in Gmail, Outlook, Apple Mail and on phones.
 * Max 600px wide; Nunito Sans where the mail app allows web fonts, Arial everywhere else.
 */

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const C = { navy: '#17263E', blue: '#087BFF', bg: '#F5F7FB', white: '#FFFFFF', ink: '#17263E', text: '#3E4A5C', mute: '#6B7789', line: '#E6EBF2' };
const FONT = "'Nunito Sans', Arial, Helvetica, sans-serif";
const TONES = {
  info: ['#E8F2FF', '#0A5BC4'],
  success: ['#E6F6EC', '#167A3E'],
  warning: ['#FFF4E0', '#9A5B00'],
  danger: ['#FDECEC', '#B42318'],
  neutral: ['#EEF2F7', '#3E4A5C'],
} as const;
export type Tone = keyof typeof TONES;

export type EmailParts = {
  /** Site address, e.g. https://kargom.co.uk (images and links are built from it). */
  baseUrl: string;
  /** Hidden first line shown in the inbox list after the subject. */
  preheader: string;
  badge?: { text: string; tone?: Tone };
  title: string;
  /** Short paragraphs, plain text (escaped here). */
  intro: string[];
  /** Picture under the text: our parcels illustration, or none. */
  illustration?: 'parcels' | null;
  /** A card of label / value rows, e.g. Tracking, Service, To. */
  details?: { heading?: string; logo?: string | null; rows: Array<[string, string]> };
  cta?: { href: string; text: string };
  /** Smaller lines under the button (tips, security notes). */
  after?: string[];
  /** Steps shown as a numbered list ("What happens next"). */
  steps?: { heading: string; items: string[] };
};

const abs = (base: string, path: string) => (/^https?:\/\//.test(path) ? path : `${base.replace(/\/+$/, '')}${path}`);

function button(href: string, text: string) {
  // "Bulletproof" button: a table cell with the colour, so Outlook shows it too.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate"><tr>
    <td align="center" bgcolor="${C.blue}" style="border-radius:12px;background:${C.blue}">
      <a href="${esc(href)}" target="_blank" style="display:block;padding:16px 24px;font-family:${FONT};font-size:16px;font-weight:800;line-height:20px;color:#FFFFFF;text-decoration:none;border-radius:12px">${esc(text)}&nbsp;&rarr;</a>
    </td></tr></table>`;
}

export function renderEmail(p: EmailParts): string {
  const base = p.baseUrl.replace(/\/+$/, '') || 'https://kargom.co.uk';
  const [bBg, bFg] = TONES[p.badge?.tone ?? 'info'];
  const nav = [['Ship', '/send'], ['Track', '/track'], ['Account', '/app']]
    .map(([t, h]) => `<a href="${base}${h}" target="_blank" style="color:#C9D6EA;text-decoration:none;font-family:${FONT};font-size:13px;font-weight:700;padding:0 0 0 16px">${t}</a>`).join('');
  const details = p.details?.rows.length ? `
    <tr><td style="padding:8px 32px 0" class="px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line};border-radius:14px;border-collapse:separate;background:${C.white}">
        ${p.details.heading || p.details.logo ? `<tr><td colspan="2" style="padding:16px 18px 6px;font-family:${FONT}">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="font-family:${FONT};font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:${C.mute}">${esc(p.details.heading ?? '')}</td>
            ${p.details.logo ? `<td align="right"><img src="${esc(abs(base, p.details.logo))}" alt="" height="22" style="display:block;height:22px;width:auto;border:0"></td>` : ''}
          </tr></table></td></tr>` : ''}
        ${p.details.rows.map(([k, v], i) => `<tr>
          <td valign="top" style="padding:10px 18px;${i ? `border-top:1px solid ${C.line};` : ''}font-family:${FONT};font-size:14px;color:${C.mute};width:38%">${esc(k)}</td>
          <td valign="top" style="padding:10px 18px;${i ? `border-top:1px solid ${C.line};` : ''}font-family:${FONT};font-size:14px;font-weight:700;color:${C.ink}">${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('')}
      </table></td></tr>` : '';
  const steps = p.steps?.items.length ? `
    <tr><td style="padding:24px 32px 0" class="px">
      <p style="margin:0 0 10px;font-family:${FONT};font-size:15px;font-weight:800;color:${C.ink}">${esc(p.steps.heading)}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${p.steps.items.map((s, i) => `<tr>
          <td valign="top" width="34" style="padding:0 0 10px"><div style="width:24px;height:24px;line-height:24px;border-radius:12px;background:#E8F2FF;color:${C.blue};text-align:center;font-family:${FONT};font-size:13px;font-weight:800">${i + 1}</div></td>
          <td valign="top" style="padding:2px 0 10px;font-family:${FONT};font-size:14px;line-height:21px;color:${C.text}">${esc(s)}</td></tr>`).join('')}
      </table></td></tr>` : '';
  return `<!DOCTYPE html>
<html lang="en-GB" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(p.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;700;800&display=swap" rel="stylesheet">
<style>
  body { margin:0; padding:0; background:${C.bg}; }
  a { color:${C.blue}; }
  @media (max-width: 620px) {
    .wrap { width:100% !important; }
    .px { padding-left:20px !important; padding-right:20px !important; }
    .h1 { font-size:24px !important; line-height:30px !important; }
    .nav { display:none !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg}">${esc(p.preheader)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}">
<tr><td align="center" style="padding:24px 12px">
  <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">
    <tr><td bgcolor="${C.navy}" style="background:${C.navy};border-radius:18px 18px 0 0;padding:20px 32px" class="px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td><a href="${base}" target="_blank"><img src="${base}/assets/logo-white.png" width="170" height="23" alt="Kargom.co.uk" style="display:block;width:170px;height:auto;border:0"></a></td>
        <td align="right" class="nav" style="white-space:nowrap">${nav}</td>
      </tr></table></td></tr>
    <tr><td bgcolor="${C.white}" style="background:${C.white};padding:0 0 32px;border-radius:0 0 18px 18px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:32px 32px 0" class="px">
          ${p.badge ? `<span style="display:inline-block;padding:5px 12px;border-radius:999px;background:${bBg};color:${bFg};font-family:${FONT};font-size:12px;font-weight:800;letter-spacing:.02em">&#9679;&nbsp;${esc(p.badge.text)}</span>` : ''}
          <h1 class="h1" style="margin:${p.badge ? '14px' : '0'} 0 10px;font-family:${FONT};font-size:28px;line-height:34px;font-weight:800;color:${C.ink}">${esc(p.title)}</h1>
          ${p.intro.map((l) => `<p style="margin:0 0 12px;font-family:${FONT};font-size:16px;line-height:24px;color:${C.text}">${esc(l)}</p>`).join('')}
        </td></tr>
        ${p.illustration === 'parcels' ? `<tr><td align="center" style="padding:8px 32px 8px" class="px"><img src="${base}/assets/email/parcels.jpg" width="240" alt="" style="display:block;width:240px;max-width:70%;height:auto;border:0"></td></tr>` : ''}
        ${details}
        ${p.cta ? `<tr><td style="padding:24px 32px 0" class="px">${button(p.cta.href, p.cta.text)}</td></tr>` : ''}
        ${(p.after ?? []).length ? `<tr><td style="padding:16px 32px 0" class="px">${p.after!.map((l) => `<p style="margin:0 0 8px;font-family:${FONT};font-size:13px;line-height:20px;color:${C.mute}">${esc(l)}</p>`).join('')}</td></tr>` : ''}
        ${steps}
      </table></td></tr>
    <tr><td style="padding:24px 32px 8px;text-align:center" class="px">
      <p style="margin:0 0 8px;font-family:${FONT};font-size:13px;line-height:20px;color:${C.mute}">Questions? Open <a href="${base}/app?view=help" style="color:${C.blue};text-decoration:none;font-weight:700">Help</a> in your Kargom account and our UK team will reply.</p>
      <p style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:#8A95A6">Kargom.co.uk is a trading name of CURACAVI LTD, registered in England and Wales, company no. 17412069.<br>
      <a href="${base}/privacy" style="color:#8A95A6">Privacy</a> &middot; <a href="${base}/terms" style="color:#8A95A6">Terms</a></p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

/** The same email as plain text, for mail apps that do not show HTML. */
export function renderText(p: EmailParts): string {
  return [p.title, '', ...p.intro, '',
    ...(p.details?.rows.map(([k, v]) => `${k}: ${v.replace(/\n/g, ', ')}`) ?? []), '',
    ...(p.cta ? [`${p.cta.text}: ${p.cta.href}`, ''] : []),
    ...(p.steps ? [p.steps.heading, ...p.steps.items.map((s, i) => `${i + 1}. ${s}`), ''] : []),
    ...(p.after ?? []), '', 'Kargom.co.uk · CURACAVI LTD, company no. 17412069'].join('\n').replace(/\n{3,}/g, '\n\n');
}
