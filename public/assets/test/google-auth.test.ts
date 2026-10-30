import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.ts';
import { googleUser, googleAuthUrl } from '../src/auth/google.ts';

const jwt = (claims: Record<string, unknown>) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const tokenReply = (claims: Record<string, unknown>) => (async (_u: string, init: any) => {
  assert.match(String(init.body), /client_secret=sec/);
  return new Response(JSON.stringify({ id_token: jwt(claims) }));
}) as any;

test('Google: verified identity for this site only', async () => {
  process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com'; process.env.GOOGLE_CLIENT_SECRET = 'sec';
  const ok = { aud: 'cid.apps.googleusercontent.com', iss: 'https://accounts.google.com', exp: Date.now() / 1000 + 600, email: 'Ali@Example.com', email_verified: true, name: 'Ali Veli', sub: '123' };
  assert.deepEqual(await googleUser('code', 'https://kargom.co.uk/api/auth/google/callback', tokenReply(ok)), { sub: '123', email: 'ali@example.com', name: 'Ali Veli' });
  await assert.rejects(googleUser('c', 'r', tokenReply({ ...ok, aud: 'other-site' })), /not for this site/);
  await assert.rejects(googleUser('c', 'r', tokenReply({ ...ok, email_verified: false })), /not verified/);
  await assert.rejects(googleUser('c', 'r', tokenReply({ ...ok, exp: 1 })), /expired/);
  const url = new URL(googleAuthUrl('https://kargom.co.uk/api/auth/google/callback', 'st8'));
  assert.equal(url.searchParams.get('client_id'), 'cid.apps.googleusercontent.com');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('state'), 'st8');
});

test('Google: new email makes an account, a known email signs into it', async () => {
  const { app } = await makeApp();
  const a = await app.auth.googleSignIn({ email: 'new@example.com', name: 'New Person' });
  assert.equal(a.created, true);
  const again = await app.auth.googleSignIn({ email: 'NEW@example.com', name: 'x' });
  assert.equal(again.created, false);
  assert.equal(again.principal.customerId, a.principal.customerId);
  // a Google-made account cannot be opened with any password
  await assert.rejects(app.auth.login('new@example.com', 'google$anything-at-all'), /wrong/);
  const id = await app.auth.register({ email: 'pw@example.com', password: 'correct horse battery', name: 'Pat', accountType: 'personal' });
  const linked = await app.auth.googleSignIn({ email: 'pw@example.com', name: 'Pat' });
  assert.equal(linked.principal.customerId, id);
  assert.ok((await app.auth.authenticate(linked.token)).customerId === id);
});
