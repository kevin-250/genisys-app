import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSystem, confirmText, makeSystem } from './system.js';
import { parseIntent } from './intent.js';

const p = (t) => parseSystem(t);
test('everyday controls are understood without AI', () => {
  assert.deepEqual(p('volume 40'), { do: 'volume', value: 40 });
  assert.deepEqual(p('set volume to 40%'), { do: 'volume', value: 40 });
  assert.deepEqual(p('put volume at 40'), { do: 'volume', value: 40 });
  assert.deepEqual(p('turn it up'), { do: 'volume_up' });
  assert.deepEqual(p('mute'), { do: 'mute' });
  assert.deepEqual(p('open camera'), { do: 'camera' });
  assert.deepEqual(p('take a screenshot'), { do: 'screenshot' });
  assert.deepEqual(p('brightness 70'), { do: 'brightness', value: 70 });
  assert.deepEqual(p('next song'), { do: 'next_track' });
  assert.deepEqual(p('pause'), { do: 'play_pause' });
  assert.deepEqual(p('close spotify'), { do: 'close_app', name: 'spotify' });
  assert.deepEqual(p('force close chrome'), { do: 'close_app', name: 'chrome', value: 1 });
  assert.deepEqual(p('close all apps'), { do: 'close_all' });
  assert.deepEqual(p('shut down in 30 minutes'), { do: 'shutdown_in', value: 30 });
  assert.deepEqual(p('cancel shutdown'), { do: 'cancel_shutdown' });
  assert.deepEqual(p('shutdown'), { do: 'shutdown' });
  assert.deepEqual(p('sleep'), { do: 'sleep' });
  assert.deepEqual(p('lock pc'), { do: 'lock' });
  assert.deepEqual(p('turn off bluetooth'), { do: 'bluetooth_off' });
  assert.deepEqual(p('dark mode'), { do: 'dark_mode' });
  assert.deepEqual(p('open bluetooth settings'), { do: 'open_settings', name: 'bluetooth' });
  assert.deepEqual(p('battery'), { do: 'battery' });
  assert.deepEqual(p('empty recycle bin'), { do: 'empty_recycle_bin' });
});
test('normal sentences and app settings are left alone', () => {
  for (const t of ['open chrome', 'search volume knob', 'open chrome settings', 'close it', 'play mouse trap episode 3', 'volume 500']) assert.equal(p(t), null, t);
});
test('parseIntent routes controls to the pc action', () => {
  const r = parseIntent('Please put the volume at 40%');
  assert.equal(r.action, 'pc'); assert.deepEqual(r.params, { do: 'volume', value: 40 }); assert.ok(r.confidence >= 0.75);
  assert.equal(parseIntent('open spotify').action, 'open_app');
});
test('risky controls ask first, safe ones do not', async () => {
  assert.match(confirmText({ do: 'shutdown' }), /Shut down/);
  assert.match(confirmText({ do: 'shutdown_in', value: 30 }), /30 minutes/);
  assert.equal(confirmText({ do: 'lock' }), '');
  const launched = [];
  const run = makeSystem({ launch: (e, a) => launched.push([e, ...a]), helper: {}, os: {}, openExternal: async () => {} });
  assert.equal((await run({ do: 'shutdown' })).status, 'confirm');
  assert.equal(launched.length, 0);
  assert.equal((await run({ do: 'shutdown' }, true)).status, 'done');
  assert.deepEqual(launched[0], ['shutdown.exe', '/s', '/t', '5']);
  assert.equal((await run({ do: 'volume' })).status, 'fall'); // needs a number
});

import { splitTask } from './intent.js';
test('two-part commands split, and every part must be understood', () => {
  assert.deepEqual(splitTask('open spotify and put volume at 40%'), ['open spotify', 'put volume at 40%']);
  assert.deepEqual(splitTask('mute, then lock pc'), ['mute', 'lock pc']);
  assert.equal(splitTask('open spotify'), null);
  const parts = splitTask('open spotify and put volume at 40%').map((p) => parseIntent(p));
  assert.deepEqual(parts.map((r) => r.action), ['open_app', 'pc']);
  assert.ok(parts.every((r) => r.confidence >= 0.75));
  const cats = splitTask('search cats and dogs').map((p) => parseIntent(p));
  assert.ok(!cats.every((r) => r.action !== 'unknown' && r.confidence >= 0.75), 'dogs alone is not a command');
});

import { isFileTask } from './intent.js';
import { PathIndex } from './index.js';
test('folder map only for file tasks, and it stays small', () => {
  for (const t of ['move the pdfs in downloads to documents', 'find my cv.docx', 'open my school folder', 'delete old screenshots']) assert.ok(isFileTask(t), t);
  for (const t of ['open spotify', 'what is the weather', 'volume 40', 'tell me a joke']) assert.ok(!isFileTask(t), t);
  const x = new PathIndex();
  const kids = (n) => Array.from({ length: n }, (_, i) => ({ n: `Folder ${i}`, d: true }));
  const docs = String.raw`C:\U\Documents`;
  x.dirs = new Map([[docs, { m: 1, kids: [...kids(500), { n: 'a.txt', d: false }] }], [String.raw`C:\U\Documents\Folder 0`, { m: 1, kids: kids(3) }]]);
  const map = x.folderMap([docs, String.raw`C:\U\Missing`], 1000);
  assert.ok(map.length <= 1100, `map is ${map.length} chars`);
  assert.ok(map.startsWith(`${docs}\n  Folder 0\n    Folder 0\n`), map.slice(0, 80));
  assert.match(map, /\(\+\d+ more\)/);
  assert.ok(!map.includes('a.txt'), 'files are never listed');
});

test('natural questions about the PC are answered without AI', () => {
  const ask = (t) => parseIntent(t);
  for (const [t, id] of [['how much battery do I have', 'battery'], ['check my battery', 'battery'], ['how much free space do I have', 'disk_space'],
    ["what's my ip", 'ip_address'], ['what is my ram usage', 'memory'], ['show me cpu usage', 'cpu']]) {
    const r = ask(t);
    assert.equal(r.action, 'pc', `${t} -> ${JSON.stringify(r)}`); assert.equal(r.params.do, id, t);
  }
  assert.notEqual(ask('how much is a flight to paris').action, 'pc');
});

import { fitFast } from './fit.js';
import { buildRouterMessages } from './router.js';
test('"search" stays a web search unless it is about this PC', () => {
  for (const t of ['search trigger trailer', 'search best movies 2026', 'google latest movies in my folder', 'search cats in chrome', 'search movies online', 'search the history of rome'])
    assert.equal(parseIntent(t).action, 'search_web', t);
  for (const t of ['search in movie folder and tell me latest movies i added there', 'search my downloads for cv', 'search on my pc for invoice', 'search the movies folder for trigger'])
    assert.notEqual(parseIntent(t).action, 'search_web', t);
});
test('media: filler words dropped, "in <app>" opens it with that app', () => {
  assert.deepEqual(parseIntent('open film called trigger in  trigger ep 1 in potplayer').params, { query: 'trigger ep 1', media: true, with: 'potplayer' });
  assert.deepEqual(parseIntent('play trigger ep 1 in vlc').params, { query: 'trigger ep 1', media: true, with: 'vlc' });
  assert.deepEqual(parseIntent('open movie free guy').params, { query: 'free guy', media: true });
  assert.ok(isFileTask('open fiml called trigger in potplayer'));
  assert.ok(!isFileTask('open spotify'));
});
test('router: whole request only', () => {
  assert.match(buildRouterMessages([], 'x')[0].content, /WHOLE request/);
});
test('fitFast shrinks old steps under the fast cap, never the tasks', () => {
  const h = [{ role: 'system', content: 's'.repeat(9000) }, { role: 'user', content: 'open trigger' }, { role: 'assistant', content: 'a'.repeat(5000) },
    { role: 'user', content: 'r'.repeat(5000) }, { role: 'user', content: 'Episode 1' }];
  fitFast(h, [1, 4]);
  assert.ok(JSON.stringify(h).length < 18000);
  assert.equal(h[0].content.length, 9000); assert.equal(h[1].content, 'open trigger'); assert.equal(h[4].content, 'Episode 1');
});

import { byNumbers, dropFolderMap } from './fit.js';
const M = (...p) => p.map(([path, score]) => ({ path, score }));
const first = (q, m) => byNumbers(q, m)[0];
const clear = (q, m) => { const [a, b] = byNumbers(q, m); return a.score - b.score >= 0.08 ? a.path : null; };
test('numbers in the request pick between near-identical names', () => {
  assert.equal(clear('trigger ep 1', M(['V/Trigger.S01E02.mkv', 0.9], ['V/Trigger.S01E01.mkv', 0.89], ['V/Trigger.S02E01.mkv', 0.88])), 'V/Trigger.S01E01.mkv');
  assert.equal(clear('lazarus ep1', M(['S2/Lazarus.S02E01.mkv', 0.9], ['S1/Lazarus.S01E01.(NKIRI.COM).x.mkv', 0.9])), 'S1/Lazarus.S01E01.(NKIRI.COM).x.mkv');
  assert.equal(clear('report v2', M(['D/report v1.docx', 0.95], ['D/report v2.docx', 0.95])), 'D/report v2.docx');
  assert.equal(clear('invoice 2024', M(['D/invoice 2025.pdf', 0.9], ['D/invoice 2024.pdf', 0.9])), 'D/invoice 2024.pdf');
  assert.equal(clear('chapter 3', M(['D/chapter 13.pdf', 0.9], ['D/chapter 3.pdf', 0.88])), 'D/chapter 3.pdf');
  assert.equal(clear('notes', M(['D/notes work.txt', 0.9], ['D/notes home.txt', 0.9])), null, 'no numbers: a real tie stays a tie');
  assert.equal(first('song 2', M(['M/a.mp3', 0.95], ['M/song 2.mp3', 0.5])).path, 'M/a.mp3', 'far-off matches are not promoted');
});
test('fitFast keeps the newest results whole, cuts older ones', () => {
  const h = [{ role: 'system', content: 's'.repeat(8000) }, { role: 'user', content: 'old task' }, { role: 'user', content: 'o'.repeat(6000) },
    { role: 'user', content: 'play ep1' }, { role: 'assistant', content: 'a'.repeat(300) }, { role: 'user', content: 'r'.repeat(5000) }, { role: 'user', content: 'yes' }];
  fitFast(h, [1, 3, 6]);
  assert.ok(h[2].content.length < 700, 'old results cut');
  assert.equal(h[5].content.length, 5000, 'latest results kept for the short reply');
});
test('folder map only on the first step', () => {
  const s = 'SYS\n\nPC CONTEXT:\nUser: x\nUSER FOLDER MAP (folder names only):\nC:\U\Videos\n  Movies\nMATCHING THIS TASK:\nfiles: a.mkv';
  assert.equal(dropFolderMap(s), 'SYS\n\nPC CONTEXT:\nUser: x\nMATCHING THIS TASK:\nfiles: a.mkv');
  assert.equal(dropFolderMap('no map'), 'no map');
});
test('router never guesses a left-out detail', () => {
  assert.match(buildRouterMessages([], 'x')[0].content, /Never fill in a detail/);
});
