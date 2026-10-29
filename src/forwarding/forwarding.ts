import type { Db } from '../db/db.ts';
import { AppError } from '../core/errors.ts';
import { freightRates, parseFreightQuery } from '../freight/rates.ts';

/**
 * Parcel forwarding: the customer shops in the US (or UK, China…) with a Kargom address at a
 * forwarding warehouse, then we send it on to them. Until a warehouse partner is live, this gives a
 * price estimate and takes sign-ups for the waiting list.
 */
const COUNTRIES = /^[A-Z]{2}$/;
/** A typical box for a given weight, so volumetric weight is realistic (shoes ≈ 35×25×15 cm). */
const boxFor = (kg: number) => (kg <= 1 ? [30, 20, 10] : kg <= 2.5 ? [36, 26, 15] : kg <= 5 ? [45, 35, 25] : kg <= 10 ? [55, 40, 35] : [60, 50, 45]);
const HANDLING_PENCE = 400; // receiving, photo, repacking at the warehouse

export async function forwardingEstimate(fromIn: unknown, toIn: unknown, kgIn: unknown) {
  const from = String(fromIn ?? '').toUpperCase(), to = String(toIn ?? '').toUpperCase();
  const kg = Number(kgIn);
  if (!COUNTRIES.test(from) || !COUNTRIES.test(to)) throw new AppError('bad_request', 'Choose the countries');
  if (from === to) throw new AppError('bad_request', 'Choose a different country to ship to');
  if (!(kg > 0 && kg <= 60)) throw new AppError('bad_request', 'Enter the weight in kg (up to 60)');
  const [l, w, h] = boxFor(kg);
  const q = parseFreightQuery(new URLSearchParams({ load: 'boxes', qty: '1', kg: String(kg), l: String(l), w: String(w), h: String(h), origin: from, destination: to, fromCountry: from, toCountry: to }));
  const r = await freightRates(q);
  const exp = r.rates.find((x) => x.mode === 'express');
  if (!exp) return { estimate: null };
  return {
    estimate: {
      shippingLowPence: exp.minPence, shippingHighPence: exp.maxPence, handlingPence: HANDLING_PENCE,
      totalLowPence: exp.minPence + HANDLING_PENCE, totalHighPence: exp.maxPence + HANDLING_PENCE,
      daysMin: exp.daysMin, daysMax: exp.daysMax, box: { l, w, h },
    },
  };
}

export async function joinForwardingWaitlist(db: Db, input: { email?: unknown; from?: unknown; to?: unknown }, customerId: string | null, now: string) {
  const email = String(input.email ?? '').trim().toLowerCase().slice(0, 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AppError('bad_request', 'Enter your email address');
  const from = String(input.from ?? 'US').toUpperCase().slice(0, 2), to = String(input.to ?? 'GB').toUpperCase().slice(0, 2);
  await db.run(`INSERT INTO forwarding_waitlist (email, from_country, to_country, customer_id, created_at) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (email) DO UPDATE SET from_country = excluded.from_country, to_country = excluded.to_country`, [email, from, to, customerId, now]);
  const n = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM forwarding_waitlist');
  return { ok: true, position: Number(n?.n ?? 1) };
}
