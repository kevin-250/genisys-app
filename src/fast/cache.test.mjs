import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheKey, cacheable, cacheLookup, cacheStore } from './cache.js';

const reg = new Map([['open_app', { destructive: false }], ['delete_file', { destructive: true }], ['open_path', { destructive: false, internal: true }]]);
function fakeDb() {
  const rows = new Map();
  const db = async (op, ...a) => {
    if (op === 'cacheGet') return rows.has(a[0]) ? { key: a[0], ...rows.get(a[0]) } : null;
    if (op === 'cachePut') { rows.set(a[0], { action: a[1], params: a[2], uses: 1 }); return; }
    if (op === 'cacheUse') { rows.get(a[0]).uses++; return; }
    if (op === 'cacheDrop') { rows.delete(a[0]); return; }
  };
  return { db, rows };
}
test('key ignores filler and case', () => { assert.equal(cacheKey('Please OPEN the chrome!'), cacheKey('open chrome')); });
test('never caches destructive, unknown, pseudo or huge', () => {
  assert.ok(cacheable('open_app', { name: 'x' }, reg));
  assert.ok(!cacheable('delete_file', { path: 'C:\\x' }, reg));
  assert.ok(!cacheable('script', {}, reg));
  assert.ok(!cacheable('open_app', { name: 'x'.repeat(2000) }, reg));
});
test('store, then second run hits the cache', async () => {
  const { db, rows } = fakeDb();
  assert.equal(await cacheStore(db, 'open chrome', 'open_app', { name: 'chrome' }, reg), true);
  const hit = await cacheLookup(db, async () => true, 'Open Chrome please');
  assert.deepEqual([hit.action, hit.params, hit.uses], ['open_app', { name: 'chrome' }, 2]);
  assert.equal(rows.size, 1);
});
test('a target that no longer exists is dropped, not run', async () => {
  const { db, rows } = fakeDb();
  await cacheStore(db, 'open the movie mousetrap', 'open_path', { path: 'C:\\gone.mkv' }, reg);
  assert.equal(await cacheLookup(db, async () => false, 'open the movie mousetrap'), null);
  assert.equal(rows.size, 0);
});
test('destructive actions are not stored', async () => {
  const { db, rows } = fakeDb();
  assert.equal(await cacheStore(db, 'delete old', 'delete_file', { path: 'C:\\x' }, reg), false);
  assert.equal(rows.size, 0);
});
