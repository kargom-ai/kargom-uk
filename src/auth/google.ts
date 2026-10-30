import { randomBytes } from 'node:crypto';
import { AppError } from '../core/errors.ts';

/**
 * "Continue with Google" (OpenID Connect, authorisation code flow).
 *   1. /api/auth/google        → we send the browser to Google with a one-time state
 *   2. Google asks the customer, then returns to /api/auth/google/callback?code&state
 *   3. we swap the code for an ID token straight from Google's token endpoint (server to server,
 *      with the client secret), check it is for us and the email is verified, and sign them in.
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. The secret never reaches the browser.
 */
export const googleEnabled = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function newState() { return randomBytes(24).toString('base64url'); }

export function googleAuthUrl(redirectUri: string, state: string) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '', redirect_uri: redirectUri, response_type: 'code',
    scope: 'openid email profile', state, prompt: 'select_account', access_type: 'online',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export type GoogleUser = { sub: string; email: string; name: string };

/** Swap the code for the customer's verified Google identity. */
export async function googleUser(code: string, redirectUri: string, f: typeof fetch = fetch, now = Date.now()): Promise<GoogleUser> {
  const r = await f('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID ?? '', client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '', redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await r.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!r.ok || !j.id_token) throw new AppError('unauthorized', `Google sign-in failed${j.error ? ` (${j.error})` : ''}. Please try again.`);
  // the token came to us directly from Google over TLS, so its contents can be read without a signature check (OpenID Connect 3.1.3.7)
  let c: Record<string, unknown>;
  try { c = JSON.parse(Buffer.from(j.id_token.split('.')[1] ?? '', 'base64url').toString('utf8')); } catch { throw new AppError('unauthorized', 'Google sign-in failed. Please try again.'); }
  if (c.aud !== process.env.GOOGLE_CLIENT_ID) throw new AppError('unauthorized', 'Google sign-in was not for this site');
  if (c.iss !== 'https://accounts.google.com' && c.iss !== 'accounts.google.com') throw new AppError('unauthorized', 'Google sign-in failed');
  if (!(Number(c.exp) * 1000 > now)) throw new AppError('unauthorized', 'Google sign-in expired. Please try again.');
  const email = String(c.email ?? '').trim().toLowerCase();
  if (!email || c.email_verified !== true) throw new AppError('unauthorized', 'Your Google email is not verified');
  return { sub: String(c.sub ?? ''), email, name: String(c.name ?? c.given_name ?? email.split('@')[0]).slice(0, 120) };
}
