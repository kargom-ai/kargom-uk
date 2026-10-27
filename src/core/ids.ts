import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford-ish, no i/l/o/u

/** Prefixed, sortable-ish, URL-safe id: `shp_01hx...`. Time prefix keeps inserts roughly ordered. */
export function newId(prefix: string): string {
  const time = Date.now().toString(32).padStart(10, '0');
  const bytes = randomBytes(10);
  let rand = '';
  for (const b of bytes) rand += ALPHABET[b % 32];
  return `${prefix}_${time}${rand}`;
}

/** Human-facing shipment reference, e.g. KGM-UK-10483. */
export function shipmentRef(seq: number): string {
  return `KGM-UK-${seq}`;
}
