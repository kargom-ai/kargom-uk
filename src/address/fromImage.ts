import { AppError } from '../core/errors.ts';

/**
 * "Fill the address from a photo": the customer photographs a label, an envelope or a note, or
 * uploads a screenshot (WhatsApp, an order page). We read the text with Google Cloud Vision and
 * split it into name, phone, email, address lines, town, postcode and country.
 * The image is never stored: it is read once and dropped.
 */

export type ParsedAddress = {
  name: string; company: string; phone: string; email: string; line1: string; line2: string; city: string; postcode: string; country: string; lines: string[];
};

const UK_PC = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+|00)?\d[\d\s().-]{8,}\d/;
const LABEL = /^(?:ship(?:ping)?\s*to|deliver(?:y)?\s*(?:to|address)|send\s*to|recipient|to|address|addressee|name|tel|phone|mobile|e-?mail|alıcı|adres|ad\s*soyad|telefon)\s*[:\-–]\s*/i;
const NOISE = /^(?:ship(?:ping)?\s*to|deliver(?:y)?\s*(?:to|address)|send\s*to|recipient|to|from|address|delivery|shipping address|teslimat adresi|alıcı bilgileri)\s*:?$/i;
const COMPANY = /\b(ltd|limited|plc|llc|inc|gmbh|sarl|s\.a\.|b\.v\.|a\.ş\.|ltd\.?\s*şti|co\.|company|group|services|logistics)\b/i;

/** Country names and how we write them, for the last line of foreign addresses. */
const COUNTRY: Array<[RegExp, string]> = [
  [/^(?:united kingdom|uk|great britain|gb|england|scotland|wales|northern ireland)$/i, 'GB'],
  [/^(?:united states(?: of america)?|usa|us)$/i, 'US'], [/^(?:turkey|türkiye|turkiye)$/i, 'TR'], [/^(?:germany|deutschland)$/i, 'DE'],
  [/^(?:france)$/i, 'FR'], [/^(?:ireland|éire)$/i, 'IE'], [/^(?:netherlands|nederland|holland)$/i, 'NL'], [/^(?:spain|españa)$/i, 'ES'],
  [/^(?:italy|italia)$/i, 'IT'], [/^(?:belgium|belgique|belgië)$/i, 'BE'], [/^(?:poland|polska)$/i, 'PL'], [/^(?:portugal)$/i, 'PT'],
  [/^(?:austria|österreich)$/i, 'AT'], [/^(?:switzerland|schweiz|suisse)$/i, 'CH'], [/^(?:sweden|sverige)$/i, 'SE'], [/^(?:denmark|danmark)$/i, 'DK'],
  [/^(?:canada)$/i, 'CA'], [/^(?:australia)$/i, 'AU'], [/^(?:china)$/i, 'CN'], [/^(?:united arab emirates|uae)$/i, 'AE'], [/^(?:greece)$/i, 'GR'],
];
const countryOf = (s: string) => COUNTRY.find(([re]) => re.test(s.trim().replace(/[.,]$/, '')))?.[1] ?? '';
/** Foreign postcodes: "75001 Paris", "Paris 75001", "34000 Istanbul", "New York, NY 10001". */
const FOREIGN_PC = /^(?:(?<pc1>[A-Z]{0,2}-?\d{4,6}(?:\s?[A-Z]{2})?)\s+(?<city1>[^\d,]{2,}))$|^(?<city2>[^\d]{2,}?)[,\s]+(?:[A-Z]{2}\s+)?(?<pc2>\d{4,6}(?:-\d{4})?)$/i;

const tidy = (s: string) => s.replace(LABEL, '').replace(/\s{2,}/g, ' ').replace(/^[,;•\-–\s]+|[,;\s]+$/g, '').trim();
const hasDigit = (s: string) => /\d/.test(s);

export function parseAddress(text: string): ParsedAddress {
  const out: ParsedAddress = { name: '', company: '', phone: '', email: '', line1: '', line2: '', city: '', postcode: '', country: '', lines: [] };
  // one item per line; split "Street, Town, Postcode" lines on commas too
  let lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .filter((l) => !NOISE.test(l))
    .flatMap((l) => (l.split(',').length >= 3 ? l.split(',') : [l])).map(tidy).filter(Boolean);

  // email and phone, wherever they are
  for (const l of [...lines]) {
    const e = EMAIL.exec(l);
    if (e && !out.email) { out.email = e[0]; lines = lines.filter((x) => x !== l || x.replace(e[0], '').trim().length > 2).map((x) => (x === l ? tidy(x.replace(e[0], '')) : x)); continue; }
    const p = PHONE.exec(l);
    if (p && !out.phone && !UK_PC.test(l) && p[0].replace(/\D/g, '').length >= 10 && l.replace(p[0], '').replace(/[^A-Za-z]/g, '').length <= 12) {
      out.phone = p[0].replace(/[^\d+]/g, '').replace(/^00/, '+');
      lines = lines.map((x) => (x === l ? tidy(x.replace(p[0], '')) : x)).filter(Boolean);
    }
  }
  // country on its own line
  const ci = lines.findIndex((l) => countryOf(l));
  if (ci >= 0) { out.country = countryOf(lines[ci]!); lines.splice(ci, 1); }

  // postcode and town
  let pcLine = lines.findIndex((l) => UK_PC.test(l));
  if (pcLine >= 0 && (!out.country || out.country === 'GB')) {
    const m = UK_PC.exec(lines[pcLine]!)!;
    out.postcode = `${m[1]} ${m[2]}`.toUpperCase();
    out.country = 'GB';
    const rest = tidy(lines[pcLine]!.replace(m[0], ''));
    if (rest && !hasDigit(rest)) out.city = rest;
    lines.splice(pcLine, 1);
    if (!out.city && pcLine > 0 && !hasDigit(lines[pcLine - 1]!)) { out.city = lines[pcLine - 1]!; lines.splice(pcLine - 1, 1); }
  } else {
    pcLine = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = FOREIGN_PC.exec(lines[i]!);
      if (m?.groups) { out.postcode = (m.groups.pc1 ?? m.groups.pc2 ?? '').toUpperCase(); out.city = tidy(m.groups.city1 ?? m.groups.city2 ?? ''); lines.splice(i, 1); pcLine = i; break; }
    }
  }
  out.city = out.city.replace(/\b(?:UK|United Kingdom)\b/i, '').trim();

  // name: the first short line without digits; a company name goes to company
  const ni = lines.findIndex((l) => !hasDigit(l) && l.split(/\s+/).length <= 6 && l.length <= 60);
  if (ni >= 0 && (ni === 0 || ni < lines.findIndex(hasDigit) || lines.findIndex(hasDigit) < 0)) {
    const v = lines[ni]!;
    if (COMPANY.test(v)) out.company = v; else out.name = v;
    lines.splice(ni, 1);
    if (out.company && lines[0] && !hasDigit(lines[0]) && !COMPANY.test(lines[0]) && lines[0].split(/\s+/).length <= 4 && lines.length > 2) { out.name = lines[0]; lines.shift(); }
  }
  // the rest are street lines; the one with a house number first
  const street = lines.filter((l) => l.length <= 80);
  const first = street.findIndex(hasDigit);
  if (first > 0) street.unshift(...street.splice(first, 1));
  out.line1 = street[0] ?? '';
  out.line2 = street.slice(1, 3).join(', ');
  if (!out.city && street.length >= 3) { out.city = street[street.length - 1]!; out.line2 = street.slice(1, -1).join(', '); }
  if (!out.name && out.company) out.name = out.company;
  out.lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 20);
  return out;
}

/** Read the text in a photo with Google Cloud Vision (same Google key as Places, with Vision API turned on). */
export async function readImageText(dataUrl: string, f: typeof fetch = fetch): Promise<string> {
  const key = process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new AppError('provider_failed', 'Reading addresses from photos is not set up yet');
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new AppError('bad_request', 'Choose a JPG, PNG or WebP image');
  if (m[1]!.length > 1_600_000) throw new AppError('bad_request', 'That image is too large');
  const r = await f(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ requests: [{ image: { content: m[1] }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }], imageContext: { languageHints: ['en', 'tr', 'de', 'fr'] } }] }),
  });
  const j = (await r.json().catch(() => ({}))) as { responses?: Array<{ fullTextAnnotation?: { text?: string }; error?: { message?: string } }>; error?: { message?: string } };
  const err = j.error?.message ?? j.responses?.[0]?.error?.message;
  if (!r.ok || err) {
    console.warn(`[vision] ${r.status} ${err ?? ''}`);
    throw new AppError('provider_failed', /not been used|disabled|not enabled/i.test(err ?? '') ? 'Reading photos is not switched on yet (Cloud Vision API)' : 'We could not read that image. Try a clearer photo.');
  }
  return j.responses?.[0]?.fullTextAnnotation?.text ?? '';
}

export async function addressFromImage(dataUrl: unknown, f?: typeof fetch) {
  if (typeof dataUrl !== 'string') throw new AppError('bad_request', 'Choose an image');
  const text = await readImageText(dataUrl, f);
  if (!text.trim()) throw new AppError('bad_request', 'We could not find any text in that image');
  const a = parseAddress(text);
  return { address: a, found: Boolean(a.line1 || a.postcode) };
}
