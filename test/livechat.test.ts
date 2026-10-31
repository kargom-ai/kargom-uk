import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.ts';

test('live chat: visitor writes, team is emailed when away, replies reach the visitor (by email if they left)', async () => {
  const { app } = await makeApp();
  process.env.ADMIN_EMAILS = 'boss@kargom.test';
  const mails: Array<{ to: string; subject: string; lines: string[] }> = [];
  app.chat.notify = async (to, subject, _h, lines) => { mails.push({ to, subject, lines }); return null; };

  await assert.rejects(app.chat.start({ name: 'Ann', email: 'nope', message: 'hi' }, null), /email/);
  await assert.rejects(app.chat.start({ name: '', email: 'a@b.co', message: 'hi' }, null), /name/);
  const s = await app.chat.start({ name: 'Ann', email: 'ANN@example.com', message: 'Where is my parcel?', page: '/track' }, null);
  assert.ok(s.token.length > 20);
  assert.equal(s.messages.length, 1);
  assert.equal(mails[0]!.to, 'boss@kargom.test', 'nobody on the chat page: the team is emailed');
  await app.chat.visitorSend(s.token, 'It is KGM-UK-10001');
  assert.equal(mails.length, 1, 'not emailed again within 10 minutes');

  const list = await app.chat.adminList(); // the admin is now "online"
  assert.equal(list.threads[0]!.unread, 2);
  assert.equal(list.threads[0]!.email, 'ann@example.com');
  assert.equal(app.chat.online, true);

  const t = list.threads[0]!.id;
  const open = await app.chat.adminOpen(t);
  assert.equal(open.messages.length, 2);
  assert.equal((await app.chat.adminUnread()).unread, 0);

  // the visitor is still on the page: no email
  await app.chat.visitorRead(s.token);
  await app.chat.adminSend(t, 'Hi Ann, it is out for delivery today.');
  assert.equal(mails.length, 1);
  const seen = await app.chat.visitorRead(s.token, open.messages[1]!.id);
  assert.deepEqual(seen.messages.map((m) => [m.from, m.body]), [['agent', 'Hi Ann, it is out for delivery today.']]);

  // someone else's token cannot read it
  await assert.rejects(app.chat.visitorRead('x'.repeat(30)), /not found/);

  // the visitor left (no polling for 2 minutes): the reply is emailed
  await app.db.run('UPDATE chat_threads SET visitor_seen_at = $1 WHERE id = $2', [new Date(app.clock.now().getTime() - 5 * 60_000).toISOString(), t]);
  await app.chat.adminSend(t, 'It has been delivered.');
  assert.equal(mails[1]!.to, 'ann@example.com');
  assert.match(mails[1]!.lines[0]!, /delivered/);

  await app.chat.adminClose(t);
  assert.equal((await app.chat.adminList()).threads[0]!.status, 'closed');
  await app.chat.visitorSend(s.token, 'Thanks!');
  assert.equal((await app.chat.adminList()).threads[0]!.status, 'open', 'a new message reopens it');
});
