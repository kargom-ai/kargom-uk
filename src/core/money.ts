/**
 * Money is always an integer number of pence. Never use floats for amounts.
 * All arithmetic goes through these helpers so rounding is explicit.
 */
export type Pence = number;

export const VAT_RATE_BP = 2000; // 20.00% in basis points (UK standard rate)

export function assertPence(v: number, what = 'amount'): Pence {
  if (!Number.isSafeInteger(v)) throw new Error(`${what} must be an integer number of pence, got ${v}`);
  return v;
}

/** Multiply by basis points (1bp = 0.01%) and round half away from zero. */
export function applyBp(amount: Pence, bp: number): Pence {
  assertPence(amount);
  const raw = (amount * bp) / 10_000;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}

/** Gross (VAT inclusive) from net. */
export function addVat(net: Pence, vatBp = VAT_RATE_BP): { net: Pence; vat: Pence; gross: Pence } {
  const vat = applyBp(net, vatBp);
  return { net, vat, gross: net + vat };
}

/** Split a VAT-inclusive gross amount into net + VAT. */
export function splitVat(gross: Pence, vatBp = VAT_RATE_BP): { net: Pence; vat: Pence; gross: Pence } {
  assertPence(gross);
  const net = Math.round((gross * 10_000) / (10_000 + vatBp));
  return { net, vat: gross - net, gross };
}

/** Round a price UP to the next amount ending in 9p (e.g. 236 -> 239, 240 -> 249). */
export function roundUpTo9(p: Pence): Pence {
  assertPence(p);
  const base = Math.floor(p / 10) * 10 + 9;
  return base >= p ? base : base + 10;
}

export function formatGbp(p: Pence): string {
  const sign = p < 0 ? '−' : '';
  const abs = Math.abs(p);
  return `${sign}£${Math.floor(abs / 100).toLocaleString('en-GB')}.${String(abs % 100).padStart(2, '0')}`;
}

/** Parse "12.34" or "£12.34" from user input into pence. Rejects more than 2 decimals. */
export function parseGbp(input: string): Pence {
  const m = /^\s*£?\s*(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!m) throw new Error(`Not a valid amount: ${input}`);
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}
