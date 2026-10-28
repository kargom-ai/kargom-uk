import type { Db } from '../db/db.ts';
import type { Clock } from '../core/clock.ts';
import { AppError } from '../core/errors.ts';
import { newId } from '../core/ids.ts';
import type { AuthService } from '../auth/auth.ts';
import { haversineMiles, outcodeCoords } from './route.ts';

/**
 * Moving & road-freight requests.
 *
 * A customer posts a request (a home move, or a full / part lorry load). Every active
 * partner of that kind sees it and can send one offer. The customer compares offers,
 * looks at each company's profile and reviews, and accepts one. Only then do the two
 * sides see each other's full contact details and exact addresses.
 *
 * Today the customer pays the partner directly. The offer rows already carry payment
 * columns so "pay this offer by card on Kargom" can be added without reshaping data.
 */

export type Kind = 'removals' | 'freight';
export type Addr = { line1: string; line2?: string; city: string; postcode: string; country: string };
type Partner = { id: string; customer_id: string; kind: Kind; company: string; phone: string; email: string; website: string | null; about: string | null; areas: string | null; base_postcode: string | null; fleet: string | null; logo: string | null; status: string; created_at: string };
type Job = { id: string; ref: number; customer_id: string; kind: Kind; status: string; title: string; details: string; from_addr: string; to_addr: string; from_area: string; to_area: string; distance_miles: number | null; move_date: string | null; contact_phone: string; accepted_offer_id: string | null; created_at: string; updated_at: string };
type Offer = { id: string; job_id: string; partner_id: string; price_pence: number; message: string | null; vehicle: string | null; available_date: string | null; valid_until: string | null; status: string; payment_status: string | null; created_at: string; updated_at: string };

export type Notice = (to: string, subject: string, heading: string, lines: string[], link?: { href: string; text: string }) => Promise<unknown>;

const KINDS: Kind[] = ['removals', 'freight'];
const COUNTRIES = ['GB', 'IE', 'FR', 'DE', 'NL', 'BE', 'ES', 'IT', 'PL', 'PT', 'AT', 'DK', 'SE', 'CZ'];
const MAX_PHOTOS = 4;
const MAX_PHOTO_CHARS = 420_000;   // ~300 KB JPEG as base64
const MAX_LOGO_CHARS = 200_000;

const s = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const b = (v: unknown) => v === true || v === 'true' || v === 1;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : NaN; };
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback?: T): T => {
  if (list.includes(v as T)) return v as T;
  if (fallback !== undefined) return fallback;
  throw new AppError('bad_request', `Choose one of: ${list.join(', ')}`);
};
const isoDate = (v: unknown, label: string, required = false) => {
  const x = s(v, 10);
  if (!x) { if (required) throw new AppError('bad_request', `Choose the ${label}`); return null; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x) || Number.isNaN(Date.parse(x))) throw new AppError('bad_request', `The ${label} is not a valid date`);
  return x;
};
const phoneOk = (p: string) => p.replace(/\D/g, '').length >= 7;
const outward = (pc: string) => pc.toUpperCase().trim().split(/\s+/)[0] ?? '';
const area = (a: Addr) => `${a.city} ${a.country === 'GB' ? outward(a.postcode) : a.country}`.trim();
/** "m1 1ae" → "M1 1AE"; accepts a full postcode or just the first half ("M1"). Empty → null. */
const basePc = (v: unknown) => {
  const x = s(v, 10).toUpperCase().replace(/\s+/g, ' ');
  if (!x) return null;
  const full = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/.exec(x);
  if (full) return `${full[1]} ${full[2]}`;
  if (/^[A-Z]{1,2}\d[A-Z\d]?$/.test(x)) return x;
  throw new AppError('bad_request', 'Enter a UK postcode for where you are based, e.g. M1 1AE or M1');
};
const initials = (name: string) => { const [f, l] = name.trim().split(/\s+/); return `${f ?? ''}${l ? ` ${l[0]}.` : ''}`; };

function address(v: unknown, who: string): Addr {
  const a = (v ?? {}) as Record<string, unknown>;
  const out: Addr = { line1: s(a.line1, 120), line2: s(a.line2, 120), city: s(a.city, 80), postcode: s(a.postcode, 12).toUpperCase(), country: s(a.country, 2).toUpperCase() || 'GB' };
  if (!COUNTRIES.includes(out.country)) throw new AppError('bad_request', `We do not cover that country for ${who} yet`);
  if (out.line1.length < 2) throw new AppError('bad_request', `Enter the first line of the ${who} address`);
  if (out.city.length < 2) throw new AppError('bad_request', `Enter the town or city for the ${who} address`);
  if (out.country === 'GB' && !/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/.test(out.postcode)) throw new AppError('bad_request', `Enter a full UK postcode for the ${who} address`);
  if (out.country !== 'GB' && out.postcode.length < 3) throw new AppError('bad_request', `Enter the postcode for the ${who} address`);
  return out;
}

const SIZE_LABEL: Record<string, string> = { studio: 'Studio flat', '1': '1 bedroom', '2': '2 bedroom', '3': '3 bedroom', '4': '4 bedroom', '5': '5+ bedroom', small: 'Small office', medium: 'Medium office', large: 'Large office' };
const VEHICLE_LABEL: Record<string, string> = { van: 'Large van', '7.5t': '7.5 tonne lorry', '18t': '18 tonne rigid', '26t': '26 tonne rigid', artic: 'Articulated lorry (13.6 m)' };

/** Validate what the customer filled in and turn it into a clean details object + title. */
export function cleanDetails(kind: Kind, d: Record<string, unknown>) {
  if (kind === 'removals') {
    const moveType = oneOf(d.moveType, ['home', 'office', 'items'] as const);
    const size = moveType === 'items' ? '' : oneOf(d.size, (moveType === 'home' ? ['studio', '1', '2', '3', '4', '5'] : ['small', 'medium', 'large']) as readonly string[]);
    const items = Array.isArray(d.items) ? d.items.map((x) => s(x, 60)).filter(Boolean).slice(0, 40) : [];
    if (moveType === 'items' && !items.length) throw new AppError('bad_request', 'Choose at least one item to move');
    const place = (p: unknown) => {
      const o = (p ?? {}) as Record<string, unknown>;
      return { floor: oneOf(o.floor, ['ground', '1', '2', '3', '4+'] as const, 'ground'), lift: b(o.lift), parking: oneOf(o.parking, ['easy', 'permit', 'hard'] as const, 'easy') };
    };
    const details = {
      moveType, size, items,
      packing: b(d.packing), dismantling: b(d.dismantling), storage: b(d.storage),
      fromPlace: place(d.fromPlace), toPlace: place(d.toPlace),
      dateFlex: oneOf(d.dateFlex, ['exact', 'week', 'flexible'] as const, 'exact'),
      notes: s(d.notes, 1000),
    };
    const title = moveType === 'items' ? `${items.length} item${items.length > 1 ? 's' : ''} to move`
      : moveType === 'office' ? `${SIZE_LABEL[size]} move` : size === 'studio' ? 'Studio flat move' : `${SIZE_LABEL[size]} home move`;
    return { details, title };
  }
  const load = oneOf(d.load, ['ftl', 'ltl'] as const);
  const goods = s(d.goods, 200);
  if (goods.length < 3) throw new AppError('bad_request', 'Describe the goods (at least 3 characters)');
  const weightKg = Math.round(n(d.weightKg));
  if (!(weightKg > 0 && weightKg <= 44_000)) throw new AppError('bad_request', 'Enter the total weight in kg (up to 44,000)');
  const vehicle = load === 'ftl' ? oneOf(d.vehicle, ['van', '7.5t', '18t', '26t', 'artic'] as const) : '';
  const pallets = load === 'ltl' ? Math.round(n(d.pallets)) : 0;
  if (load === 'ltl' && !(pallets >= 1 && pallets <= 26)) throw new AppError('bad_request', 'Enter the number of pallets (1 to 26)');
  const details = {
    load, goods, weightKg, vehicle, pallets,
    palletType: load === 'ltl' ? oneOf(d.palletType, ['uk', 'euro', 'half', 'quarter', 'other'] as const, 'uk') : '',
    stackable: b(d.stackable), adr: b(d.adr), tempControlled: b(d.tempControlled),
    tailLiftCollection: b(d.tailLiftCollection), tailLiftDelivery: b(d.tailLiftDelivery),
    collectWindow: oneOf(d.collectWindow, ['any', 'am', 'pm'] as const, 'any'),
    deliverBy: isoDate(d.deliverBy, 'delivery date'),
    notes: s(d.notes, 1000),
  };
  const title = load === 'ftl' ? `Full load · ${VEHICLE_LABEL[vehicle]}` : `Part load · ${pallets} pallet${pallets > 1 ? 's' : ''}`;
  return { details, title };
}

export class Market {
  private readonly db: Db;
  private readonly clock: Clock;
  private readonly auth: AuthService;
  notice: Notice | null = null;
  publicUrl = '';
  constructor(db: Db, clock: Clock, auth: AuthService) { this.db = db; this.clock = clock; this.auth = auth; }

  private now() { return this.clock.now().toISOString(); }
  private send(...args: Parameters<Notice>) { if (this.notice) this.notice(...args).catch((e) => console.warn(`[market] email: ${(e as Error).message}`)); }

  /* ---------------- partners ---------------- */

  async registerPartner(input: { email: string; password: string; name: string; company: string; phone: string; kind: string; basePostcode?: string }) {
    const kind = oneOf(input.kind, KINDS);
    const company = s(input.company, 120);
    if (company.length < 2) throw new AppError('bad_request', 'Enter your company name');
    if (!phoneOk(s(input.phone, 40))) throw new AppError('bad_request', 'Enter a phone number customers can call');
    const customerId = await this.auth.register({ email: input.email, password: input.password, name: input.name, accountType: 'business', company, phone: s(input.phone, 40) });
    await this.db.run("UPDATE customers SET account_type = 'partner' WHERE id = $1", [customerId]);
    const id = newId('ptn');
    await this.db.run('INSERT INTO partners (id, customer_id, kind, company, phone, email, base_postcode, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, customerId, kind, company, s(input.phone, 40), input.email.trim().toLowerCase(), basePc(input.basePostcode), 'active', this.now()]);
    return { id, customerId };
  }

  async partnerOf(customerId: string): Promise<Partner | null> {
    return (await this.db.get<Partner>('SELECT * FROM partners WHERE customer_id = $1', [customerId])) ?? null;
  }
  async requirePartner(customerId: string): Promise<Partner> {
    const p = await this.partnerOf(customerId);
    if (!p) throw new AppError('forbidden', 'This is for partner companies. Sign up as a partner first.');
    if (p.status !== 'active') throw new AppError('forbidden', 'Your partner account is paused. Please contact Kargom.');
    return p;
  }

  async updateProfile(customerId: string, v: Record<string, unknown>) {
    const p = await this.requirePartner(customerId);
    const phone = v.phone === undefined ? p.phone : s(v.phone, 40);
    if (!phoneOk(phone)) throw new AppError('bad_request', 'Enter a phone number customers can call');
    const email = v.email === undefined ? p.email : s(v.email, 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('bad_request', 'Enter a valid email');
    let website = v.website === undefined ? p.website : s(v.website, 200);
    if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
    const company = v.company === undefined ? p.company : s(v.company, 120);
    if (company.length < 2) throw new AppError('bad_request', 'Enter your company name');
    if (v.basePostcode !== undefined) await this.db.run('UPDATE partners SET base_postcode = $1 WHERE id = $2', [basePc(v.basePostcode), p.id]);
    await this.db.run('UPDATE partners SET company = $1, phone = $2, email = $3, website = $4, about = $5, areas = $6, fleet = $7 WHERE id = $8', [
      company, phone, email, website || null,
      v.about === undefined ? p.about : s(v.about, 1500) || null,
      v.areas === undefined ? p.areas : s(v.areas, 300) || null,
      v.fleet === undefined ? p.fleet : s(v.fleet, 300) || null, p.id]);
    return this.profile(p.id, true);
  }

  async setLogo(customerId: string, dataUrl: string | null) {
    const p = await this.requirePartner(customerId);
    if (dataUrl !== null) {
      if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw new AppError('bad_request', 'Upload a PNG, JPG or WebP image');
      if (dataUrl.length > MAX_LOGO_CHARS) throw new AppError('bad_request', 'That image is too large. Use one under 150 KB.');
    }
    await this.db.run('UPDATE partners SET logo = $1 WHERE id = $2', [dataUrl, p.id]);
    return { ok: true };
  }

  async logo(partnerId: string) {
    const r = await this.db.get<{ logo: string | null }>('SELECT logo FROM partners WHERE id = $1', [partnerId]);
    const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(r?.logo ?? '');
    if (!m) throw new AppError('not_found', 'No logo');
    return { type: m[1]!, data: Buffer.from(m[2]!, 'base64') };
  }

  /** What a customer sees about a company. `own` adds what only the partner sees. */
  async profile(partnerId: string, own = false) {
    const p = await this.db.get<Partner>('SELECT * FROM partners WHERE id = $1', [partnerId]);
    if (!p) throw new AppError('not_found', 'Company not found');
    const agg = await this.db.get<{ n: number; avg: number | null }>('SELECT COUNT(*) AS n, AVG(rating) AS avg FROM partner_reviews WHERE partner_id = $1', [p.id]);
    const done = await this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM job_offers o JOIN jobs j ON j.id = o.job_id WHERE o.partner_id = $1 AND o.status = 'accepted'", [p.id]);
    const reviews = await this.db.all<{ rating: number; comment: string | null; author: string; created_at: string }>(
      'SELECT rating, comment, author, created_at FROM partner_reviews WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 30', [p.id]);
    return {
      id: p.id, kind: p.kind, company: p.company, phone: p.phone, email: p.email, website: p.website, about: p.about, areas: p.areas, fleet: p.fleet,
      logoUrl: p.logo ? `/api/partners/${p.id}/logo?v=${p.logo.length}` : null, memberSince: p.created_at, basePostcode: p.base_postcode, basedIn: p.base_postcode ? outward(p.base_postcode) : null,
      rating: agg?.avg ? Math.round(Number(agg.avg) * 10) / 10 : null, reviewCount: Number(agg?.n ?? 0), jobsWon: Number(done?.n ?? 0), reviews,
      ...(own ? { status: p.status } : {}),
    };
  }

  /* ---------------- customer: requests ---------------- */

  async createJob(customerId: string, input: Record<string, unknown>) {
    const kind = oneOf(input.kind, KINDS);
    const from = address(input.from, kind === 'removals' ? 'moving from' : 'collection');
    const to = address(input.to, kind === 'removals' ? 'moving to' : 'delivery');
    if (kind === 'removals' && (from.country !== 'GB' || to.country !== 'GB')) throw new AppError('bad_request', 'Home moves are within the UK for now');
    const { details, title } = cleanDetails(kind, (input.details ?? {}) as Record<string, unknown>);
    const moveDate = isoDate(input.date, kind === 'removals' ? 'moving date' : 'collection date', true)!;
    if (moveDate < this.now().slice(0, 10)) throw new AppError('bad_request', 'The date is in the past');
    const phone = s(input.phone, 40);
    if (!phoneOk(phone)) throw new AppError('bad_request', 'Enter a phone number so companies can confirm the details once you choose one');
    const photos = Array.isArray(input.photos) ? input.photos.filter((x): x is string => typeof x === 'string').slice(0, MAX_PHOTOS) : [];
    for (const ph of photos) {
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(ph)) throw new AppError('bad_request', 'Photos must be JPG, PNG or WebP');
      if (ph.length > MAX_PHOTO_CHARS) throw new AppError('bad_request', 'A photo is too large');
    }
    const miles = n(input.distanceMiles);
    const id = newId('job');
    const now = this.now();
    await this.db.tx(async (q) => {
      const last = await q.get<{ m: number | null }>('SELECT MAX(ref) AS m FROM jobs');
      const ref = Math.max(1000, Number(last?.m ?? 1000)) + 1;
      await q.run(`INSERT INTO jobs (id, ref, customer_id, kind, status, title, details, from_addr, to_addr, from_area, to_area, distance_miles, move_date, contact_phone, created_at, updated_at)
        VALUES ($1,$2,$3,$4,'open',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
        [id, ref, customerId, kind, title, JSON.stringify(details), JSON.stringify(from), JSON.stringify(to), area(from), area(to), miles > 0 && miles < 5000 ? Math.round(miles) : null, moveDate, phone, now]);
      for (const ph of photos) await q.run('INSERT INTO job_photos (id, job_id, data, created_at) VALUES ($1,$2,$3,$4)', [newId('pho'), id, ph, now]);
    });
    // Tell every active partner of this kind (they choose whether to quote).
    const partners = await this.db.all<{ email: string; company: string }>("SELECT email, company FROM partners WHERE kind = $1 AND status = 'active' LIMIT 500", [kind]);
    for (const p of partners) this.send(p.email, `New ${kind === 'removals' ? 'moving' : 'freight'} request: ${title}`, 'New request on Kargom',
      [`${title}, ${area(from)} → ${area(to)}, on ${moveDate}.`, 'Open it to see the details and send your price.'], { href: `${this.publicUrl}/partner/requests/${id}`, text: 'View the request' });
    return this.customerJob(customerId, id);
  }

  async listJobs(customerId: string) {
    const rows = await this.db.all<Job & { offers: number; best: number | null }>(
      `SELECT j.*, (SELECT COUNT(*) FROM job_offers o WHERE o.job_id = j.id AND o.status IN ('pending','accepted')) AS offers,
              (SELECT MIN(price_pence) FROM job_offers o WHERE o.job_id = j.id AND o.status IN ('pending','accepted')) AS best
       FROM jobs j WHERE j.customer_id = $1 ORDER BY j.created_at DESC LIMIT 200`, [customerId]);
    return rows.map((j) => ({ id: j.id, ref: j.ref, kind: j.kind, status: j.status, title: j.title, fromArea: j.from_area, toArea: j.to_area, date: j.move_date, offers: Number(j.offers), bestPence: j.best === null ? null : Number(j.best), createdAt: j.created_at }));
  }

  private async ownJob(customerId: string, jobId: string) {
    const j = await this.db.get<Job>('SELECT * FROM jobs WHERE id = $1', [jobId]);
    if (!j || j.customer_id !== customerId) throw new AppError('not_found', 'Request not found');
    return j;
  }

  private async photoIds(jobId: string) {
    return (await this.db.all<{ id: string }>('SELECT id FROM job_photos WHERE job_id = $1 ORDER BY created_at', [jobId])).map((r) => r.id);
  }

  async customerJob(customerId: string, jobId: string) {
    const j = await this.ownJob(customerId, jobId);
    const offers = await this.db.all<Offer>("SELECT * FROM job_offers WHERE job_id = $1 AND status != 'withdrawn' ORDER BY price_pence", [j.id]);
    const review = await this.db.get<{ rating: number; comment: string | null }>('SELECT rating, comment FROM partner_reviews WHERE job_id = $1', [j.id]);
    return {
      ...this.jobView(j, true), photos: (await this.photoIds(j.id)).map((pid) => `/api/jobs/${j.id}/photos/${pid}`), review: review ?? null,
      offers: await Promise.all(offers.map(async (o) => ({
        id: o.id, pricePence: o.price_pence, message: o.message, vehicle: o.vehicle, availableDate: o.available_date, validUntil: o.valid_until, status: o.status, createdAt: o.created_at,
        partner: await this.profile(o.partner_id),
      }))),
    };
  }

  private jobView(j: Job, full: boolean) {
    const from = JSON.parse(j.from_addr) as Addr, to = JSON.parse(j.to_addr) as Addr;
    return {
      id: j.id, ref: j.ref, kind: j.kind, status: j.status, title: j.title, details: JSON.parse(j.details),
      fromArea: j.from_area, toArea: j.to_area, distanceMiles: j.distance_miles, date: j.move_date, createdAt: j.created_at, acceptedOfferId: j.accepted_offer_id,
      fromPostcode: from.postcode, toPostcode: to.postcode, fromCountry: from.country, toCountry: to.country,
      ...(full ? { from, to, contactPhone: j.contact_phone } : {}),
    };
  }

  async cancelJob(customerId: string, jobId: string) {
    const j = await this.ownJob(customerId, jobId);
    if (j.status !== 'open') throw new AppError('conflict', 'Only open requests can be cancelled');
    await this.db.run("UPDATE jobs SET status = 'cancelled', updated_at = $1 WHERE id = $2", [this.now(), j.id]);
    await this.db.run("UPDATE job_offers SET status = 'declined', updated_at = $1 WHERE job_id = $2 AND status = 'pending'", [this.now(), j.id]);
    return this.customerJob(customerId, jobId);
  }

  async acceptOffer(customerId: string, jobId: string, offerId: string) {
    const j = await this.ownJob(customerId, jobId);
    if (j.status !== 'open') throw new AppError('conflict', 'This request already has a company');
    const o = await this.db.get<Offer>('SELECT * FROM job_offers WHERE id = $1 AND job_id = $2', [offerId, j.id]);
    if (!o || o.status !== 'pending') throw new AppError('conflict', 'That offer is no longer available');
    const now = this.now();
    await this.db.tx(async (q) => {
      const r = await q.run("UPDATE jobs SET status = 'booked', accepted_offer_id = $1, updated_at = $2 WHERE id = $3 AND status = 'open'", [o.id, now, j.id]);
      if (!r.changes) throw new AppError('conflict', 'This request already has a company');
      await q.run("UPDATE job_offers SET status = 'accepted', updated_at = $1 WHERE id = $2", [now, o.id]);
      await q.run("UPDATE job_offers SET status = 'declined', updated_at = $1 WHERE job_id = $2 AND id != $3 AND status = 'pending'", [now, j.id, o.id]);
    });
    const p = await this.db.get<Partner>('SELECT * FROM partners WHERE id = $1', [o.partner_id]);
    if (p) this.send(p.email, `You won request #${j.ref}`, 'Your offer was accepted',
      [`The customer accepted your price of £${(o.price_pence / 100).toFixed(2)} for ${j.title}.`, 'Their name, phone number and full addresses are now on the request page. Please call them to confirm.'],
      { href: `${this.publicUrl}/partner/requests/${j.id}`, text: 'Open the request' });
    return this.customerJob(customerId, jobId);
  }

  async review(customerId: string, jobId: string, ratingIn: unknown, commentIn: unknown) {
    const j = await this.ownJob(customerId, jobId);
    if (!j.accepted_offer_id) throw new AppError('conflict', 'You can review a company once you have booked it');
    const rating = Math.round(n(ratingIn));
    if (!(rating >= 1 && rating <= 5)) throw new AppError('bad_request', 'Choose 1 to 5 stars');
    const o = await this.db.get<Offer>('SELECT * FROM job_offers WHERE id = $1', [j.accepted_offer_id]);
    const c = await this.db.get<{ name: string }>('SELECT name FROM customers WHERE id = $1', [customerId]);
    const exists = await this.db.get('SELECT id FROM partner_reviews WHERE job_id = $1', [j.id]);
    if (exists) throw new AppError('conflict', 'You have already reviewed this move');
    await this.db.run('INSERT INTO partner_reviews (id, partner_id, job_id, customer_id, rating, comment, author, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [newId('rev'), o!.partner_id, j.id, customerId, rating, s(commentIn, 1000) || null, initials(c?.name ?? 'Customer'), this.now()]);
    await this.db.run("UPDATE jobs SET status = 'completed', updated_at = $1 WHERE id = $2", [this.now(), j.id]);
    return this.customerJob(customerId, jobId);
  }

  async photo(customerId: string, jobId: string, photoId: string) {
    const j = await this.db.get<Job>('SELECT * FROM jobs WHERE id = $1', [jobId]);
    if (!j) throw new AppError('not_found', 'Not found');
    if (j.customer_id !== customerId) {
      const p = await this.requirePartner(customerId);
      if (p.kind !== j.kind) throw new AppError('not_found', 'Not found');
    }
    const r = await this.db.get<{ data: string }>('SELECT data FROM job_photos WHERE id = $1 AND job_id = $2', [photoId, jobId]);
    const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(r?.data ?? '');
    if (!m) throw new AppError('not_found', 'Not found');
    return { type: m[1]!, data: Buffer.from(m[2]!, 'base64') };
  }

  /**
   * Companies of the right kind, closest to where the job starts. Shown to the customer
   * while they wait for offers, so they can look around and call one if they like.
   */
  async nearbyPartners(customerId: string, jobId: string, f?: typeof fetch) {
    const j = await this.ownJob(customerId, jobId);
    const from = JSON.parse(j.from_addr) as Addr;
    const ps = await this.db.all<Partner>("SELECT * FROM partners WHERE kind = $1 AND status = 'active' LIMIT 300", [j.kind]);
    const here = from.country === 'GB' ? await outcodeCoords(outward(from.postcode), f) : null;
    const area = (pc: string) => (/^[A-Z]+/.exec(pc.toUpperCase()) ?? [''])[0];
    const scored = await Promise.all(ps.map(async (p) => {
      const pc = p.base_postcode ?? '';
      const there = here && pc ? await outcodeCoords(outward(pc), f) : null;
      const miles = here && there ? Math.round(haversineMiles(here, there)) : null;
      const rank = miles !== null ? miles : !pc ? 9e6 : outward(pc) === outward(from.postcode) ? 0 : area(pc) === area(from.postcode) ? 15
        : (p.areas ?? '').toLowerCase().includes(from.city.toLowerCase()) ? 30 : 5e6;
      return { p, miles, rank };
    }));
    scored.sort((a, b) => a.rank - b.rank);
    const out = [];
    for (const { p, miles } of scored.slice(0, 20)) {
      const prof = await this.profile(p.id);
      out.push({ ...prof, reviews: prof.reviews.slice(0, 3), milesAway: miles });
    }
    return { near: j.from_area, partners: out };
  }

  /* ---------------- partner: find work, send offers ---------------- */

  async partnerFeed(customerId: string, filter: string) {
    const p = await this.requirePartner(customerId);
    const rows = await this.db.all<Job & { my_status: string | null; my_price: number | null; offers: number }>(
      `SELECT j.*, o.status AS my_status, o.price_pence AS my_price,
              (SELECT COUNT(*) FROM job_offers x WHERE x.job_id = j.id AND x.status IN ('pending','accepted')) AS offers
       FROM jobs j LEFT JOIN job_offers o ON o.job_id = j.id AND o.partner_id = $1
       WHERE j.kind = $2 AND j.customer_id != $3 AND (j.status = 'open' OR o.id IS NOT NULL)
       ORDER BY j.created_at DESC LIMIT 300`, [p.id, p.kind, customerId]);
    const list = rows.map((j) => ({
      ...this.jobView(j, false), offers: Number(j.offers), myStatus: j.my_status, myPricePence: j.my_price === null ? null : Number(j.my_price),
      won: j.my_status === 'accepted',
    }));
    if (filter === 'mine') return list.filter((x) => x.myStatus && x.myStatus !== 'withdrawn');
    if (filter === 'won') return list.filter((x) => x.won);
    return list.filter((x) => x.status === 'open' && !x.myStatus);
  }

  async partnerJob(customerId: string, jobId: string) {
    const p = await this.requirePartner(customerId);
    const j = await this.db.get<Job>('SELECT * FROM jobs WHERE id = $1', [jobId]);
    if (!j || j.kind !== p.kind || j.customer_id === customerId) throw new AppError('not_found', 'Request not found');
    const mine = await this.db.get<Offer>('SELECT * FROM job_offers WHERE job_id = $1 AND partner_id = $2', [j.id, p.id]);
    if (j.status !== 'open' && !mine) throw new AppError('not_found', 'This request is no longer open');
    const won = mine?.status === 'accepted';
    const count = await this.db.get<{ n: number; min: number | null }>("SELECT COUNT(*) AS n, MIN(price_pence) AS min FROM job_offers WHERE job_id = $1 AND status IN ('pending','accepted')", [j.id]);
    const cust = won ? await this.db.get<{ name: string; email: string }>('SELECT name, email FROM customers WHERE id = $1', [j.customer_id]) : null;
    return {
      ...this.jobView(j, won), photos: (await this.photoIds(j.id)).map((pid) => `/api/jobs/${j.id}/photos/${pid}`),
      offers: Number(count?.n ?? 0),
      myOffer: mine ? { id: mine.id, pricePence: mine.price_pence, message: mine.message, vehicle: mine.vehicle, availableDate: mine.available_date, validUntil: mine.valid_until, status: mine.status } : null,
      customer: cust ? { name: cust.name, email: cust.email, phone: j.contact_phone } : null,
    };
  }

  async makeOffer(customerId: string, jobId: string, v: Record<string, unknown>) {
    const p = await this.requirePartner(customerId);
    const j = await this.db.get<Job>('SELECT * FROM jobs WHERE id = $1', [jobId]);
    if (!j || j.kind !== p.kind || j.customer_id === customerId) throw new AppError('not_found', 'Request not found');
    if (j.status !== 'open') throw new AppError('conflict', 'This request is no longer taking offers');
    const pounds = n(String(v.price ?? '').replace(/[£,\s]/g, ''));
    if (!(pounds >= 10 && pounds <= 100_000)) throw new AppError('bad_request', 'Enter your total price in pounds, including VAT');
    const price = Math.round(pounds * 100);
    const now = this.now();
    const vals = [price, s(v.message, 1000) || null, s(v.vehicle, 120) || null, isoDate(v.availableDate, 'date'), isoDate(v.validUntil, 'valid until date')];
    const mine = await this.db.get<Offer>('SELECT * FROM job_offers WHERE job_id = $1 AND partner_id = $2', [j.id, p.id]);
    if (mine && mine.status === 'accepted') throw new AppError('conflict', 'Your offer was already accepted');
    if (mine) {
      await this.db.run("UPDATE job_offers SET price_pence = $1, message = $2, vehicle = $3, available_date = $4, valid_until = $5, status = 'pending', updated_at = $6 WHERE id = $7", [...vals, now, mine.id]);
    } else {
      await this.db.run("INSERT INTO job_offers (id, job_id, partner_id, price_pence, message, vehicle, available_date, valid_until, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$9)",
        [newId('ofr'), j.id, p.id, ...vals, now]);
    }
    const c = await this.db.get<{ email: string; name: string; account_type: string }>('SELECT email, name, account_type FROM customers WHERE id = $1', [j.customer_id]);
    if (c && !mine) this.send(c.email, `New offer for request #${j.ref}: £${pounds.toFixed(2)}`, 'You have a new offer',
      [`${p.company} offered £${pounds.toFixed(2)} for your ${j.title.toLowerCase()}.`, 'Compare offers, look at each company\'s reviews and choose the one you like.'],
      { href: `${this.publicUrl}/app/requests/${j.id}`, text: 'See your offers' });
    return this.partnerJob(customerId, jobId);
  }

  async withdrawOffer(customerId: string, jobId: string) {
    const p = await this.requirePartner(customerId);
    const r = await this.db.run("UPDATE job_offers SET status = 'withdrawn', updated_at = $1 WHERE job_id = $2 AND partner_id = $3 AND status = 'pending'", [this.now(), jobId, p.id]);
    if (!r.changes) throw new AppError('conflict', 'There is no open offer to withdraw');
    return this.partnerJob(customerId, jobId);
  }

  async partnerStats(customerId: string) {
    const p = await this.requirePartner(customerId);
    const open = await this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs j WHERE j.kind = $1 AND j.status = 'open' AND j.customer_id != $2 AND NOT EXISTS (SELECT 1 FROM job_offers o WHERE o.job_id = j.id AND o.partner_id = $3)", [p.kind, customerId, p.id]);
    const sent = await this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM job_offers WHERE partner_id = $1 AND status = 'pending'", [p.id]);
    const won = await this.db.get<{ n: number; sum: number | null }>("SELECT COUNT(*) AS n, SUM(price_pence) AS sum FROM job_offers WHERE partner_id = $1 AND status = 'accepted'", [p.id]);
    return { open: Number(open?.n ?? 0), pending: Number(sent?.n ?? 0), won: Number(won?.n ?? 0), wonPence: Number(won?.sum ?? 0) };
  }

  /* ---------------- admin ---------------- */

  async adminPartners() {
    return this.db.all<{ id: string; kind: string; company: string; phone: string; email: string; status: string; created_at: string }>(
      'SELECT id, kind, company, phone, email, status, created_at FROM partners ORDER BY created_at DESC LIMIT 500');
  }
  async adminSetPartnerStatus(id: string, status: unknown) {
    const st = oneOf(status, ['active', 'suspended'] as const);
    const r = await this.db.run('UPDATE partners SET status = $1 WHERE id = $2', [st, id]);
    if (!r.changes) throw new AppError('not_found', 'Partner not found');
    return { ok: true };
  }
}
