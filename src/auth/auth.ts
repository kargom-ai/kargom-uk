import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import type { Db } from '../db/db.ts';
import { AppError } from '../core/errors.ts';
import { newId } from '../core/ids.ts';
import type { Clock } from '../core/clock.ts';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(pw: string): Promise<string> {
  if (pw.length < 10) throw new AppError('bad_request', 'Password must be at least 10 characters');
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, s, k] = stored.split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const expected = Buffer.from(k, 'base64');
  const got = await scrypt(pw, Buffer.from(s, 'base64'), expected.length, SCRYPT);
  return timingSafeEqual(got, expected);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export type Principal = { customerId: string; role: 'customer' | 'admin' };

export class AuthService {
  private readonly db: Db;
  private readonly clock: Clock;
  private readonly sessionDays: number;
  constructor(db: Db, clock: Clock, sessionDays = 30) {
    this.db = db;
    this.clock = clock;
    this.sessionDays = sessionDays;
  }

  async register(input: { email: string; password: string; name: string; accountType: 'personal' | 'business'; company?: string; phone?: string }) {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('bad_request', 'Enter a valid email');
    if (!input.name.trim()) throw new AppError('bad_request', 'Name is required');
    const exists = await this.db.get('SELECT id FROM customers WHERE email = $1', [email]);
    if (exists) throw new AppError('conflict', 'An account with this email already exists');
    const id = newId('cus');
    await this.db.run(
      `INSERT INTO customers (id, email, name, company, phone, account_type, password_hash, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, email, input.name.trim(), input.company ?? null, input.phone ?? null, input.accountType, await hashPassword(input.password), this.clock.now().toISOString()],
    );
    return id;
  }

  async login(email: string, password: string): Promise<{ token: string; principal: Principal }> {
    const c = await this.db.get<{ id: string; password_hash: string; role: 'customer' | 'admin' }>(
      'SELECT id, password_hash, role FROM customers WHERE email = $1', [email.trim().toLowerCase()]);
    // Same work whether or not the email exists, so timing does not leak accounts.
    const ok = c ? await verifyPassword(password, c.password_hash) : (await verifyPassword(password, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(43) + '='), false);
    if (!c || !ok) throw new AppError('unauthorized', 'Email or password is wrong');
    const token = randomBytes(32).toString('base64url');
    const expires = new Date(this.clock.now().getTime() + this.sessionDays * 86_400_000).toISOString();
    await this.db.run('INSERT INTO sessions (token_hash, customer_id, expires_at) VALUES ($1,$2,$3)', [sha256(token), c.id, expires]);
    return { token, principal: { customerId: c.id, role: c.role } };
  }

  async authenticate(token: string | undefined): Promise<Principal> {
    if (!token) throw new AppError('unauthorized', 'Please sign in');
    const row = await this.db.get<{ customer_id: string; expires_at: string; role: 'customer' | 'admin' }>(
      'SELECT s.customer_id, s.expires_at, c.role FROM sessions s JOIN customers c ON c.id = s.customer_id WHERE s.token_hash = $1', [sha256(token)]);
    if (!row || row.expires_at < this.clock.now().toISOString()) throw new AppError('unauthorized', 'Your session has expired. Please sign in again.');
    return { customerId: row.customer_id, role: row.role };
  }

  async logout(token: string) {
    await this.db.run('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  }
}

/**
 * Secrets vault for provider API keys (ShipStation, Stripe …). Values are
 * encrypted with AES-256-GCM using MASTER_KEY from the environment and are
 * never returned in full to the browser.
 */
export class SecretBox {
  private readonly key: Buffer;
  constructor(masterKeyBase64: string) {
    this.key = Buffer.from(masterKeyBase64, 'base64');
    if (this.key.length !== 32) throw new Error('MASTER_KEY must be 32 bytes, base64 encoded');
  }
  seal(obj: Record<string, string>): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
  }
  open(sealed: string): Record<string, string> {
    const [iv, tag, enc] = sealed.split('.').map((s) => Buffer.from(s, 'base64'));
    const d = createDecipheriv('aes-256-gcm', this.key, iv!);
    d.setAuthTag(tag!);
    return JSON.parse(Buffer.concat([d.update(enc!), d.final()]).toString('utf8'));
  }
  static mask(v: string): string {
    return v.length <= 8 ? '••••' : `${v.slice(0, 4)}••••${v.slice(-4)}`;
  }
}
