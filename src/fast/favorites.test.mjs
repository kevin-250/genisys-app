import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBrowserFavorites, appForCategory, favoriteOf, parseFavoriteCommand } from './favorites.js';
import { makeActions } from './actions.js';

const PROFS = [{ dir: 'Default', name: 'KEVIN', email: '' }, { dir: 'Profile 1', name: 'Nshimyimana', email: '' }, { dir: 'Profile 2', name: 'Your Chrome', email: '' }, { dir: 'Profile 3', name: 'Mr', email: '' }, { dir: 'kevin', name: 'Person 1', email: '' }];
function rig(prefs = {}) {
  const calls = []; const store = { ...prefs };
  const d = { shell: { openExternal: async (u) => calls.push(['ext', u]), openPath: async () => '' }, resolveApp: (n) => (['chrome', 'edge', 'spotify'].includes(n) ? `C:\\${n}.exe` : null), spawnDetached: (...a) => calls.push(['spawn', ...a]),
    paths: {}, findFiles: async () => ({ matches: [] }), exists: () => true, isAllowed: () => true, browserProfiles: async () => PROFS,
    prefs: () => ({ ...store }), prefSet: (k, v) => { store[k] = v; }, prefDel: (k) => { delete store[k]; }, prefBump: (k) => { store[k] = String((Number(store[k]) || 0) + 1); } };
  return { A: makeActions(d), calls, store };
}

test('the profile name wins over a folder that happens to be called the same (KEVIN vs dir "kevin")', async () => {
  for (const w of ['Kevin', 'kevin', 'KEVIN', 'kevn']) { const { A, calls } = rig(); await A.open_url({ url: 'https://x.com', browser: 'chrome', profile: w }); assert.equal(calls[0][2][0], '--profile-directory=Default', w); }
  const { A, calls } = rig(); await A.open_url({ url: 'https://x.com', browser: 'chrome', profile: 'nshimyiman' }); assert.equal(calls[0][2][0], '--profile-directory=Profile 1');
});
test('favorites fill what the request leaves out; a named browser or profile wins', async () => {
  const P = { 'fav:browser': 'chrome', 'fav:profile:chrome': 'kevin' };
  let r = rig(P); await r.A.search_web({ query: 'cats' }); assert.deepEqual(r.calls[0].slice(1, 2), ['C:\\chrome.exe']); assert.equal(r.calls[0][2][0], '--profile-directory=Default');
  r = rig(P); await r.A.search_web({ query: 'cats', profile: 'mr' }); assert.equal(r.calls[0][2][0], '--profile-directory=Profile 3', 'a named profile skips the favorite');
  r = rig(P); await r.A.search_web({ query: 'cats', browser: 'edge' }); assert.equal(r.calls[0][1], 'C:\\edge.exe'); assert.deepEqual(r.calls[0][2], ['https://www.google.com/search?q=cats'], 'edge gets no chrome profile');
  r = rig({}); await r.A.search_web({ query: 'cats' }); assert.equal(r.calls[0][0], 'ext', 'no favorites: the system default browser');
});
test('"open chrome" uses the favorite profile; "open my email" uses the favorite email', async () => {
  let r = rig({ 'fav:profile:chrome': 'kevin' }); await r.A.open_app({ name: 'chrome' }); assert.equal(r.calls[0][2][0], '--profile-directory=Default');
  r = rig({}); const g = await r.A.open_app({ name: 'my email' }); assert.equal(g.status, 'done'); assert.match(r.calls[0][1], /mail\.google\.com/);
  r = rig({ 'fav:email': 'spotify' }); await r.A.open_app({ name: 'my email' }); assert.equal(r.calls[0][1], 'C:\\spotify.exe');
  r = rig({}); assert.equal((await r.A.open_app({ name: 'my music' })).status, 'fall', 'no favorite music app yet: says how to set it');
});
test('the favorite action saves, lists, forgets, and rejects a profile that does not exist', async () => {
  const r = rig();
  await r.A.favorite({ op: 'set', category: 'browser', value: 'chrome' });
  const s = await r.A.favorite({ op: 'set', category: 'profile', value: 'kevin', browser: 'chrome' }); assert.equal(r.store['fav:profile:chrome'], 'KEVIN'); assert.match(s.message, /KEVIN/);
  assert.equal((await r.A.favorite({ op: 'set', category: 'profile', value: 'bob', browser: 'chrome' })).status, 'fall');
  assert.match((await r.A.favorite({ op: 'list' })).message, /browser: chrome/);
  await r.A.favorite({ op: 'forget', category: 'browser' }); assert.equal(r.store['fav:browser'], undefined);
});
test('usage is learned: 3+ uses and a 60% share become a favorite without being told', async () => {
  const r = rig(); for (let i = 0; i < 3; i++) await r.A.open_url({ url: 'https://x.com', browser: 'chrome', profile: 'kevin' });
  assert.equal(favoriteOf(r.store, 'browser'), 'chrome'); assert.equal(applyBrowserFavorites({}, r.store).profile, 'KEVIN');
  assert.equal(favoriteOf({ 'count:browser:chrome': 2 }, 'browser'), null, 'two uses is not enough');
});
test('compose_email opens a draft, never says sent, and refuses placeholder or missing recipients', async () => {
  const r = rig({ 'fav:browser': 'chrome', 'fav:profile:chrome': 'kevin' });
  const ok = await r.A.compose_email({ to: 'bob@acme.com', subject: 'Hi', body: 'Hello there' });
  assert.equal(ok.status, 'done'); assert.match(ok.message, /NOT sent/); assert.ok(!/\bsent\b(?! *\))/i.test(ok.message.replace(/NOT sent/g, '')));
  assert.match(r.calls[0][2][1], /mail\.google\.com\/mail\/u\/0\/\?view=cm&fs=1&to=bob%40acme\.com&su=Hi&body=Hello\+there/); assert.equal(r.calls[0][2][0], '--profile-directory=Default');
  for (const to of ['', 'client@example.com', 'not an email', 'a@b']) assert.equal((await rig().A.compose_email({ to })).status, 'fall', to);
});
