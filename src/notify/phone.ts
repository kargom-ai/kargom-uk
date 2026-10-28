/**
 * Phone number to E.164 digits (no '+'), e.g. "07700 900123" (GB) → "447700900123".
 * Returns null when it cannot be a mobile number we can message.
 */
export function toE164(raw: string | null | undefined, country = 'GB'): string | null {
  if (!raw) return null;
  let d = String(raw).trim();
  const plus = d.startsWith('+');
  d = d.replace(/\D/g, '');
  if (!d) return null;
  if (plus) return d.length >= 10 && d.length <= 15 ? d : null;
  if (d.startsWith('00')) d = d.slice(2);
  else if (country === 'GB' && d.startsWith('0')) d = `44${d.slice(1)}`;
  else if (country === 'GB' && d.length === 10 && d.startsWith('7')) d = `44${d}`;
  else if (country === 'TR' && d.startsWith('0')) d = `90${d.slice(1)}`;
  if (d.length < 10 || d.length > 15) return null;
  // UK: only mobiles (07…) can receive WhatsApp/SMS.
  if (d.startsWith('44') && !d.startsWith('447')) return null;
  return d;
}
