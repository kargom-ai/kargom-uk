import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatTurn, missing, cleanDraft } from '../src/chat/agent.ts';

const QUOTES = [
  { carrier: 'evri', carrierName: 'Evri', serviceCode: 'evri-48', serviceName: 'Evri 48', pricePence: 399, transitDays: 2, dropOff: true },
  { carrier: 'dpd', carrierName: 'DPD', serviceCode: 'dpd-nd', serviceName: 'DPD Next Day', pricePence: 899, transitDays: 1, dropOff: false },
];
const deps = (calls: any[]) => ({
  quote: async (r: any) => { calls.push(['quote', r]); return QUOTES; },
  lookup: async (pc: string) => ({ postcode: pc, town: 'Leeds', addresses: [{ label: '1 Park Row, Leeds', line1: '1 Park Row', line2: '', city: 'Leeds', postcode: pc }] }),
});
/** A fake Claude that plays back a script of responses, and records what it was sent. */
function fakeClaude(script: any[], seen: any[]) {
  return (async (_u: string, init: any) => { seen.push(JSON.parse(init.body)); const next = script.shift(); return new Response(JSON.stringify(next), { status: 200 }); }) as typeof fetch;
}
const toolUse = (name: string, input: any, id = 't1') => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });
const say = (text: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

test('chat: prices a parcel with live quotes, saves details, and only offers Pay when complete', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  const calls: any[] = [], seen: any[] = [];
  const f = fakeClaude([toolUse('get_quotes', { from_postcode: 'm11ae', to_postcode: 'LS1 5HD', weight_kg: 2 }), say('Evri 48 is £3.99, DPD Next Day £8.99.')], seen);
  const r1 = await chatTurn([{ role: 'user', text: 'Shoes from M1 1AE to LS1 5HD, about 2 kg' }], {}, { ...deps(calls), fetch: f });
  assert.equal(calls[0][1].from.postcode, 'M1 1AE');
  assert.equal(calls[0][1].parcel.weightGrams, 2000);
  assert.equal(r1.showQuotes, true);
  assert.equal(r1.ready, false);
  assert.equal(r1.draft.quotes!.length, 2);
  assert.match(seen[0].system, /booking assistant/);
  assert.equal(seen[1].messages.at(-1).content[0].type, 'tool_result');

  // the model tries to show Pay too early: refused, it is told what is missing
  const f2 = fakeClaude([toolUse('ready_to_pay', {}), say('I still need a few details.')], seen);
  const r2 = await chatTurn([{ role: 'user', text: 'Evri please' }], r1.draft, { ...deps(calls), fetch: f2 });
  assert.equal(r2.ready, false);
  assert.match(seen.at(-1).messages.at(-1).content[0].content, /Not ready yet/);

  const all = { customer_name: 'Goktug Duhan', customer_email: 'g@x.com', choice: 'evri-48', contents: 'Shoes', value_gbp: 60,
    sender: { name: 'Ayse K', phone: '07700900111', line1: '1 Piccadilly', city: 'Manchester' }, recipient: { name: 'Ali K', phone: '07700900222', line1: '1 Park Row', city: 'Leeds' } };
  const f3 = fakeClaude([{ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'a', name: 'save_details', input: all }, { type: 'tool_use', id: 'b', name: 'ready_to_pay', input: {} }] }, say('Please check and press Pay.')], seen);
  const r3 = await chatTurn([{ role: 'user', text: 'all the details...' }], r2.draft, { ...deps(calls), fetch: f3 });
  assert.equal(r3.ready, true);
  assert.deepEqual(missing(r3.draft), []);
  assert.equal(r3.draft.choice!.pricePence, 399);
  assert.equal(r3.draft.from!.postcode, 'M1 1AE');
  delete process.env.ANTHROPIC_API_KEY;
});

test('chat: card numbers never reach the model, and a forged choice is dropped', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  const seen: any[] = [];
  const r = await chatTurn([{ role: 'user', text: 'my visa is 4242 4242 4242 4242' }], {}, { ...deps([]), fetch: fakeClaude([], seen) });
  assert.equal(seen.length, 0);
  assert.match(r.reply, /do not type card details/);
  const d = cleanDraft({ quotes: QUOTES, choice: { carrier: 'evri', serviceCode: 'made-up' } });
  assert.equal(d.choice, undefined);
  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(chatTurn([{ role: 'user', text: 'hi' }], {}, deps([])), /not switched on/);
});
