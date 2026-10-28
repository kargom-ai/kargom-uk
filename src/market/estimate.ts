/**
 * A rough price range for a move or a load, shown as "Estimated" before real offers arrive.
 *
 * Removals start from published UK averages by home size (CompareMyMove, 8,598 moves 2022-2026:
 * 1 bed £466, 2 bed £834, 3 bed £1,252, 4 bed £1,803, 5 bed £2,661) for a local move, then add
 * mileage, extras (packing, dismantling: bestbuilders.co.uk 2026 guide), stairs without a lift,
 * hard parking and a London uplift. Freight uses typical UK haulage rates per mile.
 * When real offers on Kargom build up, this can be tuned from them.
 */

export type Estimate = { lowPence: number; highPence: number; basis: string };

const HOME: Record<string, { base: number; perMile: number; packing: number; dismantle: number }> = {
  studio: { base: 340, perMile: 1.5, packing: 120, dismantle: 50 },
  1: { base: 466, perMile: 1.7, packing: 160, dismantle: 60 },
  2: { base: 834, perMile: 2.3, packing: 260, dismantle: 90 },
  3: { base: 1252, perMile: 3.0, packing: 360, dismantle: 130 },
  4: { base: 1803, perMile: 3.8, packing: 470, dismantle: 170 },
  5: { base: 2661, perMile: 4.8, packing: 600, dismantle: 200 },
};
const OFFICE: Record<string, { base: number; perMile: number }> = {
  small: { base: 900, perMile: 2.5 }, medium: { base: 2200, perMile: 4 }, large: { base: 4500, perMile: 6 },
};
const TRUCK: Record<string, { perMile: number; min: number }> = {
  van: { perMile: 1.1, min: 150 }, '7.5t': { perMile: 1.6, min: 250 }, '18t': { perMile: 2.0, min: 330 }, '26t': { perMile: 2.3, min: 380 }, artic: { perMile: 2.6, min: 450 },
};
const FLOOR: Record<string, number> = { ground: 0, 1: 1, 2: 2, 3: 3, '4+': 4 };
const LONDON = /^(E|EC|N|NW|SE|SW|W|WC)\d/;
const round10 = (n: number) => Math.max(10, Math.round(n / 10) * 10);

export function estimatePrice(kind: string, d: Record<string, any>, miles: number | null, fromPostcode = '', toPostcode = ''): Estimate | null {
  const extra = Math.max(0, (miles ?? 0) - 20); // the base price covers a local move
  let mid: number;
  if (kind === 'removals') {
    if (d.moveType === 'items') {
      mid = 90 + Math.max(0, (miles ?? 0) - 5) * 1.1;
    } else if (d.moveType === 'office') {
      const o = OFFICE[d.size] ?? OFFICE.small!;
      mid = o.base + extra * o.perMile;
    } else {
      const h = HOME[d.size];
      if (!h) return null;
      mid = h.base + extra * h.perMile;
      if (d.packing) mid += h.packing;
      if (d.dismantling) mid += h.dismantle;
    }
    for (const p of [d.fromPlace, d.toPlace]) {
      if (!p) continue;
      if (!p.lift) mid += 35 * (FLOOR[p.floor] ?? 0);
      if (p.parking === 'hard') mid += 50;
      else if (p.parking === 'permit') mid += 25;
    }
    if (LONDON.test(fromPostcode.toUpperCase()) || LONDON.test(toPostcode.toUpperCase())) mid *= 1.15;
    return { lowPence: round10(mid * 0.8) * 100, highPence: round10(mid * 1.25) * 100, basis: 'UK average removal prices for this size and distance' };
  }
  if (!miles || d.load === 'air' || d.load === 'sea') return null;
  if (d.load === 'ftl') {
    const t = TRUCK[d.vehicle] ?? TRUCK['18t']!;
    mid = Math.max(t.min, 60 + miles * t.perMile);
  } else {
    const n = Math.max(1, Number(d.pallets) || 1);
    const per = Math.max(45, 35 + miles * 0.28) * (d.palletType === 'half' ? 0.7 : d.palletType === 'quarter' ? 0.55 : 1);
    mid = n * per * (n > 4 ? 0.85 : 1);
  }
  if (d.tailLiftCollection) mid += 25;
  if (d.tailLiftDelivery) mid += 25;
  if (d.adr) mid *= 1.3;
  if (d.tempControlled) mid *= 1.35;
  return { lowPence: round10(mid * 0.8) * 100, highPence: round10(mid * 1.3) * 100, basis: 'typical UK haulage rates for this load and distance' };
}
