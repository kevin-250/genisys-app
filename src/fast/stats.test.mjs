import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLog, groupBy, compareModes, formatStats } from './stats.js';

const rows = [
  { text: 'open chrome', mode: 'old', route: 'old', ok: true, totalMs: 20000, modelCalls: 3 },
  { text: 'open chrome', mode: 'new', route: 'fast', action: 'open_app', ok: true, totalMs: 200, modelCalls: 0 },
  { text: 'what is my ip', mode: 'new', route: 'router', action: 'script', ok: false, totalMs: 4000, modelCalls: 2, ai: [{ provider: 'groq', ms: 900, ok: true }] },
];
test('parseLog skips bad lines', () => { assert.equal(parseLog('{"a":1}\nnot json\n\n{"b":2}').length, 2); });
test('groupBy route gives counts, success rate, average', () => {
  const g = groupBy(rows, (r) => r.route);
  assert.equal(g.find((x) => x.key === 'fast').avgMs, 200);
  assert.equal(g.find((x) => x.key === 'router').rate, 0);
});
test('compareModes pairs the same command in old and new', () => {
  const c = compareModes(rows);
  assert.equal(c.length, 1);
  assert.equal(Math.round(c[0].speedup), 100);
});
test('formatStats prints every table', () => {
  const t = formatStats(rows);
  for (const w of ['By route', 'By mode', 'By action', 'By provider', 'Same command, old vs new', '3 commands logged, 1 failed']) assert.ok(t.includes(w), w);
  assert.match(formatStats([]), /No commands logged/);
});
