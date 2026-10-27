import { createHmac } from 'node:crypto';
import { SqliteDb } from '../src/db/sqlite.ts';
import { createApp } from '../src/app.ts';
import { fixedClock } from '../src/core/clock.ts';
import { FakeGateway } from '../src/payments/stripe.ts';
import { MockProvider } from '../src/providers/mock.ts';
import type { ShipmentRequest } from '../src/providers/types.ts';

export const STRIPE_WHSEC = 'whsec_test_secret';

export async function makeApp() {
  const db = new SqliteDb(':memory:');
  const clock = fixedClock(new Date('2026-10-27T12:00:00Z'));
  const payments = new FakeGateway();
  const app = await createApp(db, {
    quoteSecret: 'test-quote-secret-0123456789abcdef0123',
    masterKey: Buffer.alloc(32, 1).toString('base64'),
    carrierWebhookToken: 'test-hook-token',
    stripeWebhookSecret: STRIPE_WHSEC,
    quoteTimeoutMs: 200,
    quoteTtlMs: 15 * 60_000,
  }, payments, clock);
  const mock = new MockProvider('mock');
  app.registry.addStatic(mock);
  return { app, db, clock, payments, mock };
}

export async function makeCustomer(app: Awaited<ReturnType<typeof makeApp>>['app'], email = 'a@example.co.uk', role: 'customer' | 'admin' = 'customer') {
  const id = await app.auth.register({ email, password: 'correct horse battery', name: 'Test Customer', accountType: 'business' });
  if (role === 'admin') await app.db.run("UPDATE customers SET role = 'admin' WHERE id = $1", [id]);
  return id;
}

export const ukReq = (weightGrams = 2000, dims: [number, number, number] = [30, 20, 15]): ShipmentRequest => ({
  from: { name: 'Sender', line1: 'Unit 4, Trafford Park', city: 'Manchester', postcode: 'M17 1AA', country: 'GB' },
  to: { name: 'Recipient A', line1: '18 Park Row', city: 'Leeds', postcode: 'LS1 5HD', country: 'GB' },
  parcel: { weightGrams, lengthCm: dims[0], widthCm: dims[1], heightCm: dims[2] },
});

export function stripeSign(payload: string, nowSec: number, secret = STRIPE_WHSEC) {
  const sig = createHmac('sha256', secret).update(`${nowSec}.${payload}`).digest('hex');
  return `t=${nowSec},v1=${sig}`;
}
