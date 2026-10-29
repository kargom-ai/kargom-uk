import { AppError } from '../core/errors.ts';

/**
 * "Chat with me": a booking assistant on the homepage. The customer says what they are sending and
 * where; the assistant (Claude, with tools) prices it with our live quotes, collects the two
 * addresses and the parcel details, then hands back a summary for the customer to confirm and pay.
 *
 * Safety by design:
 * - The assistant never books or charges. It only fills a draft. The customer presses Pay on a
 *   summary card, and the browser books through the normal guest checkout (same checks, same prices).
 * - Card details never enter the chat: payment is Stripe's own form.
 * - Prices only come from the get_quotes tool, never from the model's head.
 * - Stateless: the browser sends the conversation and the draft each time; nothing is stored here.
 */

export type ChatAddress = { name?: string; phone?: string; company?: string; line1?: string; line2?: string; city?: string; postcode?: string };
export type ChatDraft = {
  email?: string; name?: string;
  from?: ChatAddress; to?: ChatAddress;
  parcel?: { weightKg?: number; lengthCm?: number; widthCm?: number; heightCm?: number };
  contents?: string; valueGbp?: number;
  choice?: { carrier: string; serviceCode: string; serviceName: string; carrierName: string; pricePence: number; transitDays: number | null; dropOff: boolean };
  quotes?: QuoteOption[];
};
export type QuoteOption = { carrier: string; carrierName: string; serviceCode: string; serviceName: string; pricePence: number; transitDays: number | null; dropOff: boolean };
export type ChatMessage = { role: 'user' | 'assistant'; text: string };
export type ChatDeps = {
  quote: (req: { from: { postcode: string }; to: { postcode: string }; parcel: { weightGrams: number; lengthCm: number; widthCm: number; heightCm: number } }) => Promise<QuoteOption[]>;
  lookup: (postcode: string) => Promise<{ postcode: string; town: string; addresses: Array<{ label: string; line1: string; line2: string; city: string; postcode: string }> }>;
  fetch?: typeof fetch;
};

const UK_PC = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_TURNS = 40;
const MAX_TOOL_ROUNDS = 6;

const SYSTEM = `You are Kargom's booking assistant on kargom.co.uk, a UK parcel price comparison site. You help a customer book a parcel label inside this chat, quickly and warmly.

What you can book here: parcels from a UK address to a UK address, up to 30 kg, paid by card, no account needed. For anything else (sending abroad, pallets, freight, removals), say kindly that this chat books UK parcels for now and point them to: "Send a Parcel" (abroad, sign in), the Freight tab, or the Removals tab on the homepage. Then stop.

How to run the conversation:
- Reply in the customer's language (English, Turkish, or whatever they write). Keep messages short: 1 to 3 sentences. Ask for at most two things at a time.
- Order: 1) what they are sending, the collection postcode and the delivery postcode; 2) show prices; 3) their choice; 4) sender address, name and phone; 5) recipient address, name and phone; 6) their own name and email (the label link is emailed there); 7) contents and value; 8) summary.
- If they do not know the size or weight, estimate a sensible box for the item (for example: pair of shoes 2 kg 35x25x15 cm; small box of books 5 kg 30x30x20 cm; laptop 3 kg 45x35x10 cm) and say it is an estimate they can change.
- Call get_quotes as soon as you have both postcodes and a weight. Never state a price you did not get from get_quotes. Mention the 2 or 3 best options (cheapest, fastest) in words; the screen also shows them as cards the customer can tap.
- When the customer gives a postcode for an address, you may call find_addresses to offer the exact address lines. Postcodes must be full UK postcodes like M1 1AE.
- The customer may paste or photograph an address; the text arrives in their message. Take what is there and only ask for what is missing.
- Save every detail with save_details as soon as you learn it (you can call it many times; it merges). It tells you what is still missing.
- When nothing is missing, call ready_to_pay. The screen then shows a summary card with a Pay button. Ask the customer to check it and press Pay.
- Never ask for card numbers, passwords or bank details. Payment happens on a secure card form after the customer presses Pay. If they type card details, tell them not to and that payment is on the secure form.
- Stay on parcels. Politely decline unrelated requests.`;

const TOOLS = [
  {
    name: 'get_quotes',
    description: 'Live prices from UK couriers for one parcel between two UK postcodes. Call when you know both postcodes and the weight. Dimensions default to a 30x20x15 cm box.',
    input_schema: { type: 'object', properties: {
      from_postcode: { type: 'string' }, to_postcode: { type: 'string' }, weight_kg: { type: 'number' },
      length_cm: { type: 'number' }, width_cm: { type: 'number' }, height_cm: { type: 'number' },
    }, required: ['from_postcode', 'to_postcode', 'weight_kg'] },
  },
  {
    name: 'find_addresses',
    description: 'The street addresses at a UK postcode, to help the customer pick the exact one.',
    input_schema: { type: 'object', properties: { postcode: { type: 'string' } }, required: ['postcode'] },
  },
  {
    name: 'save_details',
    description: 'Save what you learned into the booking. Any subset of fields; it merges with what is saved. choice is the serviceCode of the option the customer picked from get_quotes.',
    input_schema: { type: 'object', properties: {
      customer_name: { type: 'string' }, customer_email: { type: 'string' },
      sender: { type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' }, company: { type: 'string' }, line1: { type: 'string' }, line2: { type: 'string' }, city: { type: 'string' }, postcode: { type: 'string' } } },
      recipient: { type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' }, company: { type: 'string' }, line1: { type: 'string' }, line2: { type: 'string' }, city: { type: 'string' }, postcode: { type: 'string' } } },
      weight_kg: { type: 'number' }, length_cm: { type: 'number' }, width_cm: { type: 'number' }, height_cm: { type: 'number' },
      contents: { type: 'string' }, value_gbp: { type: 'number' }, choice: { type: 'string' },
    } },
  },
  {
    name: 'ready_to_pay',
    description: 'Show the customer the summary card with the Pay button. Only call when save_details reports nothing missing.',
    input_schema: { type: 'object', properties: {} },
  },
];

const s = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : undefined; };
const normPc = (v: string) => { const t = v.toUpperCase().replace(/\s+/g, ''); return t.length > 3 ? `${t.slice(0, -3)} ${t.slice(-3)}` : t; };

function mergeAddress(old: ChatAddress = {}, add: Record<string, unknown> = {}): ChatAddress {
  const out = { ...old };
  for (const k of ['name', 'phone', 'company', 'line1', 'line2', 'city', 'postcode'] as const) {
    const v = s(add[k]); if (v) out[k] = k === 'postcode' ? normPc(v) : v;
  }
  return out;
}

/** What is still needed before the customer can pay. */
export function missing(d: ChatDraft): string[] {
  const m: string[] = [];
  const addr = (a: ChatAddress | undefined, who: string) => {
    if (!a?.postcode || !UK_PC.test(a.postcode)) m.push(`${who} postcode (full UK postcode)`);
    if (!a?.line1) m.push(`${who} address line 1`);
    if (!a?.city) m.push(`${who} town`);
    if (!a?.name) m.push(`${who} name`);
    if (!a?.phone || a.phone.replace(/\D/g, '').length < 7) m.push(`${who} phone`);
  };
  if (!d.parcel?.weightKg) m.push('parcel weight');
  if (!d.choice) m.push('courier choice (from get_quotes)');
  addr(d.from, 'sender'); addr(d.to, 'recipient');
  if (!d.name) m.push('customer name');
  if (!d.email || !EMAIL.test(d.email)) m.push('customer email');
  if (!d.contents || d.contents.length < 3) m.push('what is in the parcel');
  if (d.valueGbp === undefined) m.push('value of the contents in pounds');
  return m;
}

export function cleanDraft(input: unknown): ChatDraft {
  const d = (input && typeof input === 'object' ? input : {}) as Record<string, any>;
  const out: ChatDraft = {};
  if (s(d.email)) out.email = s(d.email, 200);
  if (s(d.name)) out.name = s(d.name);
  if (d.from) out.from = mergeAddress({}, d.from);
  if (d.to) out.to = mergeAddress({}, d.to);
  if (d.parcel) out.parcel = { weightKg: n(d.parcel.weightKg), lengthCm: n(d.parcel.lengthCm), widthCm: n(d.parcel.widthCm), heightCm: n(d.parcel.heightCm) };
  if (s(d.contents)) out.contents = s(d.contents, 200);
  if (Number.isFinite(Number(d.valueGbp)) && d.valueGbp !== null && d.valueGbp !== '') out.valueGbp = Math.max(0, Number(d.valueGbp));
  // quotes and the choice come from our own tool results, but they travel through the browser:
  // the booking step re-prices everything and never charges more than the live price
  if (Array.isArray(d.quotes)) out.quotes = d.quotes.slice(0, 12).map((q: any) => ({ carrier: s(q.carrier, 40), carrierName: s(q.carrierName, 60), serviceCode: s(q.serviceCode, 80), serviceName: s(q.serviceName, 120), pricePence: Math.round(Number(q.pricePence) || 0), transitDays: Number(q.transitDays) || null, dropOff: Boolean(q.dropOff) }));
  if (d.choice && typeof d.choice === 'object') {
    const q = out.quotes?.find((x) => x.serviceCode === s(d.choice.serviceCode, 80) && x.carrier === s(d.choice.carrier, 40));
    if (q) out.choice = q;
  }
  return out;
}

async function runTool(name: string, input: Record<string, any>, draft: ChatDraft, deps: ChatDeps, ui: { ready: boolean; quotes: boolean }): Promise<unknown> {
  if (name === 'get_quotes') {
    const from = normPc(s(input.from_postcode, 10)), to = normPc(s(input.to_postcode, 10));
    if (!UK_PC.test(from) || !UK_PC.test(to)) return { error: 'Both must be full UK postcodes, like M1 1AE.' };
    const kg = n(input.weight_kg);
    if (!kg || kg > 30) return { error: 'Weight must be between 0.1 and 30 kg.' };
    const p = { weightKg: kg, lengthCm: n(input.length_cm) ?? draft.parcel?.lengthCm ?? 30, widthCm: n(input.width_cm) ?? draft.parcel?.widthCm ?? 20, heightCm: n(input.height_cm) ?? draft.parcel?.heightCm ?? 15 };
    let list: QuoteOption[];
    try { list = await deps.quote({ from: { postcode: from }, to: { postcode: to }, parcel: { weightGrams: Math.round(kg * 1000), lengthCm: p.lengthCm, widthCm: p.widthCm, heightCm: p.heightCm } }); } catch (e) { return { error: (e as Error).message }; }
    list = list.sort((a, b) => a.pricePence - b.pricePence).slice(0, 8);
    draft.parcel = p;
    draft.from = mergeAddress(draft.from, { postcode: from });
    draft.to = mergeAddress(draft.to, { postcode: to });
    draft.quotes = list;
    if (draft.choice && !list.some((q) => q.serviceCode === draft.choice!.serviceCode && q.carrier === draft.choice!.carrier)) delete draft.choice;
    ui.quotes = true;
    if (!list.length) return { error: 'No courier could price this. Ask the customer to check the postcodes or the weight.' };
    return { options: list.map((q) => ({ serviceCode: q.serviceCode, service: q.serviceName, price: `£${(q.pricePence / 100).toFixed(2)}`, days: q.transitDays, handover: q.dropOff ? 'drop off at a shop or locker' : 'collected from the door' })) };
  }
  if (name === 'find_addresses') {
    const pc = normPc(s(input.postcode, 10));
    if (!UK_PC.test(pc)) return { error: 'Not a full UK postcode.' };
    try { const r = await deps.lookup(pc); return { postcode: r.postcode, town: r.town, addresses: r.addresses.slice(0, 15).map((a) => a.label) }; } catch (e) { return { error: (e as Error).message }; }
  }
  if (name === 'save_details') {
    if (s(input.customer_name)) draft.name = s(input.customer_name);
    if (s(input.customer_email)) draft.email = s(input.customer_email, 200);
    if (input.sender) draft.from = mergeAddress(draft.from, input.sender);
    if (input.recipient) draft.to = mergeAddress(draft.to, input.recipient);
    const dims = { weightKg: n(input.weight_kg), lengthCm: n(input.length_cm), widthCm: n(input.width_cm), heightCm: n(input.height_cm) };
    if (Object.values(dims).some(Boolean)) {
      draft.parcel = { ...draft.parcel, ...Object.fromEntries(Object.entries(dims).filter(([, v]) => v)) };
      if (dims.weightKg && draft.quotes?.length) { delete draft.choice; draft.quotes = []; return { saved: true, note: 'The size changed: call get_quotes again before choosing.', missing: missing(draft) }; }
    }
    if (s(input.contents)) draft.contents = s(input.contents, 200);
    if (input.value_gbp !== undefined && Number.isFinite(Number(input.value_gbp))) draft.valueGbp = Math.max(0, Number(input.value_gbp));
    if (s(input.choice, 80)) {
      const q = draft.quotes?.find((x) => x.serviceCode === s(input.choice, 80));
      if (!q) return { error: 'Unknown choice: use a serviceCode from the latest get_quotes.', missing: missing(draft) };
      draft.choice = q;
    }
    if (draft.from?.postcode && draft.to?.postcode && draft.from.postcode === draft.to.postcode && draft.from.line1 && draft.from.line1 === draft.to.line1) return { error: 'Sender and recipient are the same address.', missing: missing(draft) };
    return { saved: true, missing: missing(draft) };
  }
  if (name === 'ready_to_pay') {
    const m = missing(draft);
    if (m.length) return { error: 'Not ready yet', missing: m };
    ui.ready = true;
    return { shown: true };
  }
  return { error: 'Unknown tool' };
}

export async function chatTurn(messagesIn: unknown, draftIn: unknown, deps: ChatDeps): Promise<{ reply: string; draft: ChatDraft; ready: boolean; showQuotes: boolean }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AppError('provider_failed', 'The chat is not switched on yet');
  const msgs = (Array.isArray(messagesIn) ? messagesIn : []).slice(-MAX_TURNS)
    .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
    .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: String(m.text).slice(0, 3000) }));
  while (msgs.length && msgs[0]!.role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1]!.role !== 'user') throw new AppError('bad_request', 'Say something first');
  // card numbers never go to the model
  const last = msgs[msgs.length - 1]!;
  if (/\b(?:\d[ -]?){13,19}\b/.test(last.content) && /card|visa|master|amex|\b(?:4\d{3}|5[1-5]\d{2})/i.test(last.content)) {
    return { reply: 'Please do not type card details here. When everything is ready you will pay on a secure card form.', draft: cleanDraft(draftIn), ready: false, showQuotes: false };
  }
  const draft = cleanDraft(draftIn);
  const ui = { ready: false, quotes: false };
  const f = deps.fetch ?? fetch;
  const context = `Current booking draft (what is already saved): ${JSON.stringify({ ...draft, quotes: draft.quotes?.map((q) => `${q.serviceCode}: ${q.serviceName} £${(q.pricePence / 100).toFixed(2)}`) })}. Still missing: ${missing(draft).join(', ') || 'nothing'}.`;
  const convo: Array<{ role: 'user' | 'assistant'; content: unknown }> = msgs.map((m) => ({ role: m.role, content: m.content }));
  let reply = '';
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const r = await f('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(45_000),
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_CHAT_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 700, system: `${SYSTEM}\n\n${context}`, tools: TOOLS, messages: convo }),
    });
    const j = (await r.json().catch(() => ({}))) as { content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: any }>; stop_reason?: string; error?: { message?: string } };
    if (!r.ok) { console.warn(`[chat] ${r.status} ${j.error?.message ?? ''}`); throw new AppError('provider_failed', 'The assistant is busy. Please try again in a moment.'); }
    const content = j.content ?? [];
    const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    if (text) reply = text;
    const calls = content.filter((c) => c.type === 'tool_use');
    if (!calls.length || j.stop_reason !== 'tool_use') break;
    convo.push({ role: 'assistant', content });
    const results = [];
    for (const c of calls) results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(await runTool(c.name!, c.input ?? {}, draft, deps, ui)) });
    convo.push({ role: 'user', content: results });
    reply = '';
  }
  if (!reply) reply = ui.ready ? 'Here is your booking. Please check it and press Pay.' : 'Sorry, could you say that again?';
  return { reply, draft, ready: ui.ready && missing(draft).length === 0, showQuotes: ui.quotes };
}
