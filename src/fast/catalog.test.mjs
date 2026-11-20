import test from 'node:test';
import assert from 'node:assert/strict';
import { norm, idOf, deriveAliases, wordFrequency, buildEntries, mergeScan, summary, candidates } from './catalog.js';
import { classifyShortcut, storeItems, programItems, bookmarkItems, recentItems } from './catalogScan.js';

const items = [
  { kind: 'pwa', name: 'Spotify', launch: { type: 'lnk', target: 'C:\\sm\\Spotify.lnk', args: '--app-id=abc' }, source: 'startmenu' },
  { kind: 'app', name: 'Visual Studio Code', launch: { type: 'exe', target: 'C:\\vs\\Code.exe' }, source: 'startmenu' },
  { kind: 'app', name: 'Microsoft Edge', launch: { type: 'exe', target: 'C:\\e\\edge.exe' }, source: 'startmenu' },
  { kind: 'app', name: 'Microsoft Word', launch: { type: 'exe', target: 'C:\\w\\word.exe' }, source: 'startmenu' },
  { kind: 'app', name: 'Microsoft Excel', launch: { type: 'exe', target: 'C:\\w\\excel.exe' }, source: 'startmenu' },
];

test('ids are stable and lowercase', () => assert.equal(idOf('app', 'C:\\A.exe'), 'app:c:\\a.exe'));

test('aliases: full, joined, acronym, rare words; common words never', () => {
  const es = buildEntries(items);
  const vs = es.find((e) => e.name === 'Visual Studio Code');
  assert.ok(vs.aliases.includes('visual studio code') && vs.aliases.includes('visualstudiocode') && vs.aliases.includes('vsc'));
  const word = es.find((e) => e.name === 'Microsoft Word');
  assert.ok(word.aliases.includes('word'));
  assert.ok(word.aliases.includes('microsoft') === false || es.filter((e) => e.key.includes('microsoft')).length <= 2);
  assert.equal(norm('SpotifyPremium_v2'), 'spotify premium v2');
});

test('rare-word rule comes from frequency, not a list', () => {
  const df = wordFrequency(Array.from({ length: 200 }, (_, i) => ({ name: i < 150 ? `Acme Tool${i}` : `Other${i}` })));
  const a = deriveAliases('Acme Zebra', df, 200);
  assert.ok(a.includes('zebra') && !a.includes('acme'));
});

test('buildEntries dedupes the same launch and ignores bad items', () => {
  const es = buildEntries([...items, items[0], { kind: 'nope', name: 'x', launch: { target: 'y' } }, { kind: 'app', name: '', launch: { target: 'y' } }]);
  assert.equal(es.length, items.length);
});

test('mergeScan keeps uses, removes only after grace and only for sources that ran', () => {
  const now = 1000;
  let es = buildEntries(items).map((e) => ({ ...e, uses: 3, last_used: 5, first_seen: 1, last_seen: 1, misses: 0 }));
  let m = mergeScan(es, buildEntries(items.slice(1)), now, new Set(['startmenu']));
  const sp = m.upserts.find((e) => e.name === 'Spotify');
  assert.equal(sp.misses, 1); assert.equal(m.removes.length, 0);
  assert.equal(m.upserts.find((e) => e.name === 'Microsoft Word').uses, 3);
  es = m.upserts;
  m = mergeScan(es, buildEntries(items.slice(1)), now + 1, new Set(['startmenu']));
  assert.deepEqual(m.removes, [sp.id]);
  m = mergeScan(buildEntries(items).map((e) => ({ ...e, misses: 5 })), [], now, new Set(['store']));
  assert.equal(m.removes.length, 0); // startmenu did not run: nothing judged
});

test('candidates survive typos and abbreviations', () => {
  const es = buildEntries(items);
  assert.equal(candidates(es, 'spotfy')[0].entry.name, 'Spotify');
  assert.equal(candidates(es, 'vsc')[0].entry.name, 'Visual Studio Code');
  assert.equal(candidates(es, 'word')[0].entry.name, 'Microsoft Word');
  assert.equal(candidates(es, 'zzzzqq').length, 0);
  assert.ok(candidates(es, 'excel', { kinds: ['pwa'] }).length === 0);
});

test('summary counts by kind', () => assert.deepEqual(summary(buildEntries(items)).byKind, { pwa: 1, app: 4 }));

test('scanners: shortcuts keep their args, Chrome apps become pwa', () => {
  const p = classifyShortcut('Spotify', 'C:\\a\\Spotify.lnk', { target: 'C:\\c\\chrome_proxy.exe', args: '--profile-directory=Default --app-id=xyz' });
  assert.equal(p.kind, 'pwa'); assert.equal(p.launch.type, 'lnk');
  assert.equal(classifyShortcut('Notepad', 'x.lnk', { target: 'C:\\n.exe', args: '' }).launch.type, 'exe');
  assert.equal(classifyShortcut('Gone', 'x.lnk', { target: 'C:\\n.exe', args: '' }, () => false), null);
  assert.equal(classifyShortcut('Doc', 'x.lnk', { target: 'C:\\d.txt', args: '' }), null);
  assert.equal(classifyShortcut('x', 'x.lnk', null), null);
});

test('scanners: store, registry, bookmarks, recent', () => {
  assert.equal(storeItems([{ name: 'WhatsApp', id: 'A!B' }, { name: '', id: 'x' }])[0].launch.target, 'shell:AppsFolder\\A!B');
  const prog = programItems(JSON.stringify([
    { DisplayName: 'Git', DisplayIcon: '"C:\\git\\git.exe",0', Publisher: 'x' },
    { DisplayName: 'Hidden', SystemComponent: 1, DisplayIcon: 'C:\\h.exe' },
    { DisplayName: 'Update for Windows (KB123456)', DisplayIcon: 'C:\\u.exe' },
    { DisplayName: 'NoPath' },
  ]));
  assert.deepEqual(prog.map((p) => p.name), ['Git']); assert.equal(prog[0].launch.target, 'C:\\git\\git.exe');
  assert.deepEqual(programItems('not json'), []);
  const bm = bookmarkItems(JSON.stringify({ roots: { bookmark_bar: { name: 'Bar', children: [{ type: 'url', name: 'Mail', url: 'https://mail.google.com' }, { type: 'folder', name: 'Dev', children: [{ type: 'url', name: 'GH', url: 'https://github.com' }] }, { type: 'url', name: 'js', url: 'javascript:1' }] } } }), 'chrome', 'KEVIN');
  assert.equal(bm.length, 2); assert.equal(bm[1].meta.folder, 'Bar / Dev'); assert.equal(bm[0].launch.profile, 'KEVIN');
  const rc = recentItems([{ name: 'kevin cv.pdf', target: 'C:\\d\\kevin cv.pdf', isDir: false, mtime: 5 }, { name: 'Proj', target: 'C:\\p', isDir: true }]);
  assert.deepEqual(rc.map((r) => r.kind), ['file', 'folder']);
});

test('same bookmark in two profiles stays two entries', () => {
  const j = JSON.stringify({ roots: { r: { children: [{ type: 'url', name: 'Mail', url: 'https://m.com' }] } } });
  assert.equal(buildEntries([...bookmarkItems(j, 'chrome', 'A'), ...bookmarkItems(j, 'chrome', 'B')]).length, 2);
});
