import test from 'node:test';
import assert from 'node:assert/strict';
import { makeConvo, rowsFrom } from './convo.js';

const film = 'C:\\Users\\me\\Videos\\Movies\\VisionQuest.S01E08.mkv';
const turn = () => ({ task: 'latest film in movies folder', route: 'fast', action: 'browse_files', params: { in: 'movies', limit: 1 }, say: '1 of 246 video files', rows: rowsFrom('VisionQuest.S01E08.mkv | 2026-11-11 19:06 | 1.2 GB | .', [film]) });

test('the last turn is what "it" points at: its row and exact path are in the model text', () => {
  const c = makeConvo(); c.add(turn());
  const p = c.prompt();
  assert.match(p, /VisionQuest\.S01E08\.mkv/);
  assert.ok(p.includes(`path: ${film}`));
  assert.match(p, /how big is it/);
});
test('turns are capped and a window starts empty after clear()', () => {
  const c = makeConvo([], 3);
  for (let i = 0; i < 5; i++) c.add({ ...turn(), task: `q${i}` });
  assert.equal(c.size(), 3); assert.equal(c.last().task, 'q4');
  c.clear(); assert.equal(c.prompt(), '');
});
test('turns reload from saved rows (the database) in order', () => {
  const c = makeConvo(); c.load([{ ...turn(), ts: 1 }, { ...turn(), task: 'second', ts: 2 }]);
  assert.deepEqual(c.all().map((t) => t.task), ['latest film in movies folder', 'second']);
});
test('dependsOn: an answer that uses a path or name from this chat is not cacheable', () => {
  const c = makeConvo(); c.add(turn());
  assert.equal(c.dependsOn({ path: film }), true);
  assert.equal(c.dependsOn({ name: 'VisionQuest.S01E08' }), true);
  assert.equal(c.dependsOn({ kind: 'video', sort: 'size' }), false);
  assert.equal(makeConvo().dependsOn({ path: film }), false);
});

// ---- Stage 2: "delete them" follows the latest listing (the zips chat) ----
const zipRows = rowsFrom('metron-fixed (3).zip | 2026-11-13 14:15\nmetron-fixed (2).zip | 2026-11-13 00:47\nRAY-Markets-main.zip | 2026-10-14 13:43', ['C:\\Users\\F\\Downloads\\metron-fixed (3).zip', 'C:\\Users\\F\\Downloads\\metron-fixed (2).zip', 'C:\\Users\\F\\Downloads\\RAY-Markets-main.zip']);

test('"delete them" means the rows of the latest listing, not an older delete', () => {
  const c = makeConvo();
  c.add({ task: 'delete last 3 zip folder in downloads', route: 'ai', action: 'trashed', say: 'Trashed 3 zips [checked: moved to the Recycle Bin: a.zip, b.zip, c.zip]' });
  c.add({ task: 'show me all zip folders in download', route: 'fast', action: 'browse_files', say: '3 .zip files', rows: zipRows, n: 3 });
  const r = c.deleteRef('delete them');
  assert.deepEqual(r.names, ['metron-fixed (3).zip', 'metron-fixed (2).zip', 'RAY-Markets-main.zip']);
  assert.equal(r.paths.length, 3);
  for (const t of ['delete those', 'delete these', 'remove it', 'please delete them all', 'trash all of them', 'Delete them.']) assert.ok(c.deleteRef(t), t);
});

test('delete reference refuses to guess', () => {
  const c = makeConvo();
  assert.equal(c.deleteRef('delete them'), null, 'no listing yet');
  c.add({ task: 'show videos', route: 'fast', rows: rowsFrom('a.mkv | x', ['C:\\v\\a.mkv']), n: 40 });
  assert.equal(c.deleteRef('delete them'), null, 'listing longer than the rows kept: ask which');
  c.add({ task: 'zips', route: 'fast', rows: zipRows, n: 3 });
  for (const t of ['delete the first one', 'delete old zips in downloads', 'how big are them']) assert.equal(c.deleteRef(t), null, t);
  const d = makeConvo(); d.add({ task: 'x', route: 'fast', rows: [{ text: 'a.zip | x', path: '' }], n: 1 });
  assert.equal(d.deleteRef('delete it'), null, 'a row with no path');
});

test('the prompt keeps AI turns, in order, and marks the latest listing', () => {
  const c = makeConvo();
  c.add({ task: 'show me all zips', route: 'fast', action: 'browse_files', rows: zipRows, n: 3 });
  c.add({ task: 'delete last 3 zips', route: 'ai', action: 'trashed', say: 'checked: moved to the Recycle Bin: x.zip' });
  c.add({ task: 'show me all zips again', route: 'fast', action: 'browse_files', rows: zipRows, n: 3 });
  const p = c.prompt();
  assert.ok(p.includes('delete last 3 zips'), 'AI turn present');
  assert.ok(p.indexOf('show me all zips"') < p.indexOf('delete last 3 zips') && p.indexOf('delete last 3 zips') < p.indexOf('show me all zips again'), 'time order');
  assert.equal((p.match(/MOST RECENT LISTING/g) || []).length, 1);
  assert.ok(p.indexOf('MOST RECENT LISTING') > p.indexOf('show me all zips again'), 'marker is on the newest listing');
  assert.ok(/never say they are already deleted/.test(p));
});
