import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford-ish, no i/l/o/u

let lastMs = 0;
let counter = 0;

/**
 * Prefixed, sortable, URL-safe id: `shp_01hx...`. Time prefix plus a per-millisecond
 * counter, so ids made by this process sort in creation order even within one ms.
 */
export function newId(prefix: string): string {
  const now = Date.now();
  counter = now === lastMs ? counter + 1 : 0;
  lastMs = now;
  const time = now.toString(32).padStart(10, '0');
  const seq = (counter % 32 ** 4).toString(32).padStart(4, '0');
  const bytes = randomBytes(6);
  let rand = '';
  for (const b of bytes) rand += ALPHABET[b % 32];
  return `${prefix}_${time}${seq}${rand}`;
}

/** Human-facing shipment reference, e.g. KGM-UK-10483. */
export function shipmentRef(seq: number): string {
  return `KGM-UK-${seq}`;
}
