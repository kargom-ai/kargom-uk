import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, makeCustomer, ukReq } from './helpers.ts';
import { toE164 } from '../src/notify/phone.ts';
import { NetgsmSms, WhatsAppCloud, type Channel, type LabelMessage } from '../src/notify/channels.ts';

test('phone numbers become E.164; UK landlines are not messaged', () => {
  assert.equal(toE164('07700 900123'), '447700900123');
  assert.equal(toE164('+44 7700 900123'), '447700900123');
  assert.equal(toE164('7700900123'), '447700900123');
  assert.equal(toE164('0161 496 0000'), null);
  assert.equal(toE164('0532 123 45 67', 'TR'), '905321234567');
  assert.equal(toE164(''), null);
});

test('WhatsApp sends the approved template with the label PDF; NetGSM reads its answer codes', async () => {
  let sent: any;
  const wa = new WhatsAppCloud({ token: 't', phoneNumberId: '123', fetchImpl: (async (_u: string, i: RequestInit) => { sent = JSON.parse(String(i.body)); return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] })); }) as any });
  const m: LabelMessage = { to: '447700900123', name: 'Ann', service: 'Evri Drop Off', tracking: 'H123', ref: 'KGM-UK-10001', link: 'https://kargom.eu/l/x', pdfUrl: 'https://kargom.eu/api/guest/label/x/pdf' };
  assert.equal(await wa.sendLabelReady(m), 'wamid.1');
  assert.equal(sent.template.name, 'label_ready');
  assert.equal(sent.template.components[0].parameters[0].document.link, m.pdfUrl);
  assert.deepEqual(sent.template.components[1].parameters.map((p: any) => p.text), ['Ann', 'Evri Drop Off', 'H123', 'https://kargom.eu/l/x']);
  let url = '';
  const ok = new NetgsmSms({ usercode: 'u', password: 'p', header: 'KARGOM', fetchImpl: (async (u: string) => { url = u; return new Response('00 987654'); }) as any });
  assert.equal(await ok.sendLabelReady(m), '987654');
  assert.match(url, /gsmno=447700900123/);
  const bad = new NetgsmSms({ usercode: 'u', password: 'p', header: 'X', fetchImpl: (async () => new Response('40')) as any });
  await assert.rejects(bad.sendLabelReady(m), /sender name/);
});

test('a label that arrives later is sent once on each channel; failures are recorded, not thrown', async () => {
  const { app } = await makeApp();
  const got: Array<[string, LabelMessage]> = [];
  const wa: Channel = { id: 'whatsapp', async sendLabelReady(m) { got.push(['whatsapp', m]); return 'w1'; } };
  const sms: Channel = { id: 'sms', async sendLabelReady() { throw new Error('limit'); } };
  app.notifier.configure([wa, sms], 'https://kargom.eu/', 'none');
  const c = await makeCustomer(app);
  await app.wallet.topUp(c, 1000, 'pi_t');
  const q = (await app.quotes.quote(c, { ...ukReq(), from: { ...ukReq().from, phone: '07700 900123' } })).quotes[0]!;
  const r = await app.bookings.book({ customerId: c, quoteToken: q.token, payWith: 'wallet', idempotencyKey: 'n1' });
  await new Promise((x) => setTimeout(x, 20));
  assert.equal(got.length, 0, 'instant labels follow the policy (none here)');
  const res = await app.notifier.labelReady(r.shipment.id);
  assert.deepEqual(res.map((x) => `${x.channel}:${x.status}`), ['whatsapp:sent', 'sms:failed']);
  assert.equal(got[0]![1].to, '447700900123');
  assert.match(got[0]![1].link, /^https:\/\/kargom\.eu\/l\/[\w-]{20,}$/);
  const again = await app.notifier.labelReady(r.shipment.id);
  assert.deepEqual(again.map((x) => x.status), ['already_sent', 'already_sent']);
  assert.equal(got.length, 1);
});

test('The SMS Works: sends sender, destination and content with the JWT; explains common errors', async () => {
  const { SmsWorks } = await import('../src/notify/channels.ts');
  let req: any;
  const ok = new SmsWorks({ token: 'JWT abc', sender: 'Kargom UK!', fetchImpl: (async (_u: string, i: RequestInit) => { req = { auth: new Headers(i.headers).get('authorization'), body: JSON.parse(String(i.body)) }; return new Response(JSON.stringify({ messageid: 'm1' }), { status: 201 }); }) as any });
  const m = { to: '447700900123', name: 'Ann', service: 'Evri', tracking: 'H1', ref: 'R', link: 'https://kargom.eu/l/x', pdfUrl: '' };
  assert.equal(await ok.sendLabelReady(m), 'm1');
  assert.equal(req.auth, 'JWT abc');
  assert.deepEqual([req.body.sender, req.body.destination], ['KargomUK', '447700900123']);
  const broke = new SmsWorks({ token: 't', sender: 'Kargom', fetchImpl: (async () => new Response('{}', { status: 402 })) as any });
  await assert.rejects(broke.sendLabelReady(m), /out of credit/);
});
