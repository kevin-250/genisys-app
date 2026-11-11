import test from 'node:test';
import assert from 'node:assert/strict';
import { PathIndex, skipDir, sectionOf } from './index.js';

// A fake disk: { dir: [[name, isDir], ...] } plus mtimes.
function fakeFs(tree, mtimes = {}) {
  const reads = [];
  return {
    reads,
    readdir: async (d) => { reads.push(d); if (!tree[d]) throw new Error('ENOENT'); return tree[d].map(([name, dir]) => ({ name, isDirectory: () => !!dir })); },
    stat: async (p) => ({ mtimeMs: mtimes[p] ?? 1, size: 1000 }),
  };
}
const TREE = {
  'C:\\U\\Videos': [['Mousetrap', 1], ['Free.Guy.2021.mkv'], ['node_modules', 1], ['.git', 1], ['notes.txt']],
  'C:\\U\\Videos\\Mousetrap': [['Mousetrap.S01E03.mkv'], ['Mousetrap.S01E04.mkv']],
  'C:\\U\\Documents': [['Resume 2025.pdf'], ['AppData', 1], ['Taxes', 1]],
  'C:\\U\\Documents\\Taxes': [['taxes 2024.pdf']],
};
const nopause = () => Promise.resolve();

test('junk folders are skipped', () => {
  for (const n of ['node_modules', '.git', 'AppData', '$Recycle.Bin', 'Windows', '.cache']) assert.ok(skipDir(n), n);
  assert.ok(!skipDir('Documents'));
});
test('scan builds sections and skips junk', async () => {
  const ix = new PathIndex();
  const fsp = fakeFs(TREE);
  await ix.scan(['C:\\U\\Videos', 'C:\\U\\Documents'], fsp, { pause: nopause });
  assert.equal(ix.ready, true);
  assert.ok(!fsp.reads.some((d) => /node_modules|\.git|AppData/.test(d)));
  assert.equal(ix.sec.media_library.length, 3); // Free.Guy + two episodes
  assert.ok(ix.sec.personal_files.some((e) => e.n === 'Resume 2025.pdf'));
});
test('lookup: finds media quickly, ignores year and filler words', async () => {
  const ix = new PathIndex();
  await ix.scan(['C:\\U\\Videos', 'C:\\U\\Documents'], fakeFs(TREE), { pause: nopause });
  const t = process.hrtime.bigint();
  const r = ix.lookup('free guy 2021 movie', { kind: 'file', ext: 'mkv' });
  assert.ok(Number(process.hrtime.bigint() - t) / 1e6 < 100);
  assert.equal(r[0].path, 'C:\\U\\Videos\\Free.Guy.2021.mkv');
  assert.equal(r[0].score, 1);
});
test('lookup: episode numbers and folder names', async () => {
  const ix = new PathIndex();
  await ix.scan(['C:\\U\\Videos'], fakeFs(TREE), { pause: nopause });
  const r = ix.lookup('mouse trap episode 3', { kind: 'file' });
  assert.equal(r.length, 1);
  assert.match(r[0].path, /S01E03/);
});
test('lookup: typos use letter-pair similarity when nothing matches exactly', async () => {
  const ix = new PathIndex();
  await ix.scan(['C:\\U\\Videos'], fakeFs(TREE), { pause: nopause });
  assert.match(ix.lookup('freegut')[0]?.path || '', /Free\.Guy/);
});
test('pinned paths always win', async () => {
  const ix = new PathIndex();
  await ix.scan(['C:\\U\\Videos'], fakeFs(TREE), { pause: nopause });
  ix.setPins([{ name: 'mousetrap', path: 'D:\\Shows\\Mousetrap' }]);
  assert.deepEqual(ix.lookup('open mousetrap'), [{ path: 'D:\\Shows\\Mousetrap', score: 1, pinned: true }]);
  assert.deepEqual(ix.lookup('mousetrap', { exists: () => false }), []); // a pin to a missing path is ignored, nothing else matches either
});
test('incremental: unchanged folders are not read again', async () => {
  const ix = new PathIndex();
  const f1 = fakeFs(TREE);
  await ix.scan(['C:\\U\\Videos'], f1, { pause: nopause });
  const f2 = fakeFs(TREE);
  await ix.scan(['C:\\U\\Videos'], f2, { pause: nopause });
  assert.equal(f2.reads.length, 0);
  const f3 = fakeFs(TREE, { 'C:\\U\\Videos': 99 }); // one folder changed
  await ix.scan(['C:\\U\\Videos'], f3, { pause: nopause });
  assert.deepEqual(f3.reads, ['C:\\U\\Videos']);
});
test('apps section and contextFor never return the whole index', async () => {
  const ix = new PathIndex();
  await ix.scan(['C:\\U\\Videos', 'C:\\U\\Documents'], fakeFs(TREE), { pause: nopause });
  ix.setApps([{ name: 'Google Chrome', path: 'C:\\Chrome\\chrome.exe' }, { name: 'VLC media player', path: 'C:\\vlc\\vlc.exe' }]);
  assert.equal(ix.app('chrome'), 'C:\\Chrome\\chrome.exe');
  assert.equal(ix.app('nothing'), null);
  const ctx = ix.contextFor('open taxes with vlc');
  assert.ok(ctx.personal_files.some((p) => /taxes/i.test(p)));
  assert.deepEqual(ctx.installed_apps, ['C:\\vlc\\vlc.exe']);
  assert.ok(Object.values(ctx).flat().length <= 12);
});
test('save and load round trip', async () => {
  const ix = new PathIndex();
  await ix.scan(['C:\\U\\Videos'], fakeFs(TREE), { pause: nopause });
  const back = PathIndex.fromJSON(JSON.parse(JSON.stringify(ix.toJSON())));
  assert.equal(back.ready, true);
  assert.equal(back.count, ix.count);
});
test('sectionOf', () => {
  assert.equal(sectionOf({ t: 'file', e: 'mp4' }), 'media_library');
  assert.equal(sectionOf({ t: 'file', e: 'pdf' }), 'personal_files');
  assert.equal(sectionOf({ t: 'app' }), 'installed_apps');
});
test('scan: maxDepth limits how deep folders are read', async () => {
  const ix = new PathIndex();
  const fsp = fakeFs(TREE);
  await ix.scan(['C:\\U\\Documents'], fsp, { pause: nopause, maxDepth: 0 });
  assert.deepEqual(fsp.reads, ['C:\\U\\Documents']); // Taxes is listed but not opened
});
test('lookup: even past the deadline, exact matches and the narrowed typo list still come back', async () => {
  const ix = new PathIndex();
  await ix.scan(['C:\\U\\Videos'], fakeFs(TREE), { pause: nopause });
  assert.match(ix.lookup('freegut', { deadline: 0 })[0]?.path || '', /Free\.Guy/);
  assert.match(ix.lookup('mousetrp', { deadline: 0 })[0]?.path || '', /Mousetrap/i); // a typo
  assert.match(ix.lookup('free guy', { deadline: 0 })[0].path, /Free\.Guy/);
  ix.setApps([{ name: 'Google Chrome', path: 'C:\\Chrome\\chrome.exe' }]);
  assert.equal(ix.lookup('chrome', { sections: ['installed_apps'] })[0].path, 'C:\\Chrome\\chrome.exe');
});
