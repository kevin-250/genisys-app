import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEntries } from './catalog.js';
import { predict, nameMatch, skeleton, lev } from './predict.js';

const L = (kind, name, target, extra = {}) => ({ kind, name, launch: { type: 'exe', target, ...extra }, source: 'x' });
const es = buildEntries([
  L('pwa', 'Spotify', 's.lnk'), L('program', 'Spotify', 'sp.exe'), L('app', 'Spotify Uninstaller', 'su.exe'),
  L('app', 'Google Chrome', 'c.exe'), L('app', 'Visual Studio Code', 'v.exe'), L('app', 'Microsoft Word', 'w.exe'), L('app', 'Microsoft Excel', 'e.exe'),
  L('app', 'WhatsApp', 'wa.exe'), L('store', 'Netflix', 'nf'), L('app', 'Discord', 'd.exe'), L('app', 'OneDrive', 'od.exe'), L('app', 'OneNote', 'on.exe'),
  { kind: 'site', name: 'Gmail', launch: { type: 'url', url: 'https://mail.google.com', browser: 'chrome', profile: 'KEVIN' }, source: 'b' },
]);
const top = (q, c) => { const r = predict(es, q, c); return [r.decision, (r.pick || r.picks?.[0])?.entry.name, r]; };

test('helpers', () => { assert.equal(lev('kitten', 'sitting'), 3); assert.equal(lev('a', 'abcdefgh', 2), Infinity); assert.equal(skeleton('spotfy'), skeleton('spotify')); });

test('exact and typo\'d names pick the right thing', () => {
  for (const [q, name] of [['spotify', 'Spotify'], ['spotfy', 'Spotify'], ['spotiyf', 'Spotify'], ['discrod', 'Discord'], ['netflx', 'Netflix'], ['whatsap', 'WhatsApp'], ['wrod', 'Microsoft Word'], ['exel', 'Microsoft Excel'], ['vsc', 'Visual Studio Code'], ['chrom', 'Google Chrome'], ['gmail', 'Gmail']]) {
    const [dec, n] = top(q);
    assert.equal(dec, 'do', q); assert.equal(n, name, q);
  }
});

test('Spotify the app beats its uninstaller and the same name as a program', () => {
  const r = predict(es, 'spotify', {});
  assert.equal(r.pick.entry.kind, 'pwa');
  assert.ok(r.ranked.find((x) => x.entry.name === 'Spotify Uninstaller').score < 0.5);
});

test('junk and nonsense do nothing; ties ask', () => {
  assert.equal(top('zzzz')[0], 'none');
  assert.equal(top('qwertyuiop asdf')[0], 'none');
  const t = predict(es, 'one', {}); assert.equal(t.decision, 'choose'); assert.deepEqual(t.picks.map((p) => p.entry.name).sort(), ['OneDrive', 'OneNote']);
  assert.equal(predict(es, 'microsoft', {}).decision, 'choose');
});

test('what you use breaks a tie and shows up in the score', () => {
  const used = es.map((e) => (e.name === 'OneNote' ? { ...e, uses: 20, last_used: Date.now() } : e));
  const a = predict(used, 'one', {}).ranked;
  assert.equal(a[0].entry.name, 'OneNote');
});

test('a favorite and a thing just mentioned get a boost', () => {
  const base = predict(es, 'one', {}).ranked.find((r) => r.entry.name === 'OneDrive').score;
  assert.ok(predict(es, 'one', { prefs: { 'fav:storage': 'onedrive' } }).ranked.find((r) => r.entry.name === 'OneDrive').score > base);
  assert.ok(predict(es, 'one', { mentioned: ['onedrive'] }).ranked.find((r) => r.entry.name === 'OneDrive').score > base);
});

test('kinds filter and nameMatch basics', () => {
  assert.equal(predict(es, 'gmail', {}, { kinds: ['app'] }).decision, 'none');
  assert.equal(nameMatch('spotify', 'spotify'), 1);
  assert.ok(nameMatch('spotfy', 'spotify') > 0.75 && nameMatch('zzzz', 'visual studio code') < 0.2);
});
