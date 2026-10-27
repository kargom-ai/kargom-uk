import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addVat, parseGbp, roundUpTo9, splitVat, formatGbp } from '../src/core/money.ts';
import { priceFromCost, MIN_MARGIN_PENCE } from '../src/pricing/pricing.ts';

test('rounds up to the next 9p', () => {
  assert.equal(roundUpTo9(236), 239);
  assert.equal(roundUpTo9(239), 239);
  assert.equal(roundUpTo9(240), 249);
  assert.equal(roundUpTo9(1), 9);
});

test('VAT split is exact and reversible', () => {
  for (const net of [1, 199, 1000, 12345]) {
    const g = addVat(net);
    const s = splitVat(g.gross);
    assert.equal(s.net + s.vat, g.gross);
    assert.ok(Math.abs(s.net - net) <= 1);
  }
  assert.deepEqual(splitVat(239), { net: 199, vat: 40, gross: 239 });
});

test('parses money typed by a person', () => {
  assert.equal(parseGbp('12.3'), 1230);
  assert.equal(parseGbp('£50'), 5000);
  assert.equal(parseGbp(' 0.99 '), 99);
  assert.throws(() => parseGbp('1.234'));
  assert.throws(() => parseGbp('-5'));
  assert.equal(formatGbp(123456), '£1,234.56');
});

test('customer price: InPost at £1.66 cost sells for £2.39, never below the minimum margin', () => {
  const p = priceFromCost(166, { markupBp: 1000, fixedPence: 10 });
  assert.equal(p.gross, 239);
  assert.ok(p.margin >= MIN_MARGIN_PENCE);
  assert.equal(p.net + p.vat, p.gross);
});

test('a business discount only reduces the markup', () => {
  const full = priceFromCost(471, { markupBp: 1200, fixedPence: 10 });
  const disc = priceFromCost(471, { markupBp: 1200, fixedPence: 10 }, 5000);
  assert.ok(disc.gross <= full.gross);
  assert.ok(disc.margin >= MIN_MARGIN_PENCE);
});
