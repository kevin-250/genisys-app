// What the code parser produces must be accepted by the real action registry (same check main.js does before running anything).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIntent, FAST_MIN } from './intent.js';
import { loadActions, validateParams } from './registry.js';

const reg = loadActions(fs, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'actions'));
const SAMPLES = [
  'open chrome', 'open downloads', 'open the folder projects', 'open the movie mousetrap', 'play mousetrap', 'open resume.pdf',
  'search elon musk net worth', 'search elon musk net worth in chrome', 'open chrome and search elon musk net worth', 'serch cats on youtube',
  'open youtube', 'open youtube in edge', 'go to github.com', 'open calculator',
];
for (const text of SAMPLES) {
  test(`parser output validates: "${text}"`, () => {
    const it = parseIntent(text);
    assert.ok(it.confidence >= FAST_MIN, text);
    const spec = reg.get(it.action);
    assert.ok(spec, `no action folder for ${it.action}`);
    const params = Object.fromEntries(Object.entries(it.params).map(([k, v]) => [k, typeof v === 'boolean' ? String(v) : v])); // main.js does the same
    const v = validateParams(spec, params, {});
    assert.ok(v.ok, v.error);
  });
}
test('search words reach the engine untouched (keeps "me", "a", years)', () => {
  assert.equal(parseIntent('google best pizza near me').params.query, 'best pizza near me');
  assert.equal(parseIntent('look up how to tie a tie').params.query, 'how to tie a tie');
  assert.equal(parseIntent('search iphone 17 review 2026 in chrome').params.query, 'iphone 17 review 2026');
});
