import test from 'node:test';
import assert from 'node:assert/strict';
import { searchUrl, pick, makeActions, isHttpUrl } from './actions.js';

test('search url joins words with +', () => {
  assert.equal(searchUrl('elon musk net worth'), 'https://www.google.com/search?q=elon+musk+net+worth');
  assert.equal(searchUrl('cats & dogs', 'youtube'), 'https://www.youtube.com/results?search_query=cats+%26+dogs');
});
test('isHttpUrl', () => { assert.ok(isHttpUrl('https://a.com')); assert.ok(!isHttpUrl('file:///C:/x')); assert.ok(!isHttpUrl('javascript:alert(1)')); });
test('pick: one clear winner, several close, or none', () => {
  assert.equal(pick([]).kind, 'none');
  assert.equal(pick([{ path: 'a', score: 1 }, { path: 'b', score: 0.7 }]).kind, 'one');
  assert.equal(pick([{ path: 'a', score: 0.92 }, { path: 'b', score: 0.92 }]).kind, 'many');
  assert.equal(pick([{ path: 'a', score: 0.5 }]).kind, 'none');
});

function fake(over = {}) {
  const calls = [];
  const files = new Set(over.files || []);
  const d = {
    shell: { openPath: async (p) => { calls.push(['openPath', p]); return ''; }, openExternal: async (u) => { calls.push(['openExternal', u]); } },
    resolveApp: (n) => (over.apps || {})[n] || null,
    spawnDetached: (exe, args) => calls.push(['spawn', exe, ...args]),
    findFiles: async () => ({ matches: over.matches || [] }),
    paths: { downloads: 'C:\\Users\\me\\Downloads' },
    exists: (p) => files.has(p),
    isAllowed: (p) => p.startsWith('C:\\Users\\me\\'),
    mkdirp() {}, writeFile: (p) => files.add(p), readFile: () => 'hello', listDir: () => ['a.txt'],
    copy: (a, b) => files.add(b), move: (a, b) => { files.delete(a); files.add(b); }, trash: async (p) => { files.delete(p); },
  };
  return { A: makeActions(d), calls, files };
}

test('open_app: known app launches, unknown falls through', async () => {
  const { A, calls } = fake({ apps: { chrome: 'C:\\c\\chrome.exe' } });
  assert.equal((await A.open_app({ name: 'chrome' })).status, 'done');
  assert.deepEqual(calls[0], ['spawn', 'C:\\c\\chrome.exe']);
  assert.equal((await A.open_app({ name: 'nosuchapp' })).status, 'fall');
});
test('open_app: system apps use the shell', async () => {
  const { A, calls } = fake();
  assert.equal((await A.open_app({ name: 'calculator' })).status, 'done');
  assert.deepEqual(calls[0], ['openPath', 'calc.exe']);
});
test('search_web: default browser vs named browser', async () => {
  const a = fake();
  await a.A.search_web({ query: 'elon musk' });
  assert.deepEqual(a.calls[0], ['openExternal', 'https://www.google.com/search?q=elon+musk']);
  const b = fake({ apps: { chrome: 'C:\\c\\chrome.exe' } });
  await b.A.search_web({ query: 'elon musk', browser: 'chrome' });
  assert.deepEqual(b.calls[0], ['spawn', 'C:\\c\\chrome.exe', 'https://www.google.com/search?q=elon+musk']);
  assert.equal((await fake().A.search_web({ query: 'x', browser: 'chrome' })).status, 'fall'); // browser not installed
});
test('open_url refuses non-http links', async () => { assert.equal((await fake().A.open_url({ url: 'file:///C:/Windows/notepad.exe' })).status, 'fall'); });
test('open_folder: known folder', async () => {
  const { A, calls } = fake();
  assert.equal((await A.open_folder({ folder: 'downloads' })).status, 'done');
  assert.deepEqual(calls[0], ['openPath', 'C:\\Users\\me\\Downloads']);
});
test('open_file: one clear match opens and is cacheable', async () => {
  const { A, calls } = fake({ matches: [{ path: 'C:\\Users\\me\\Videos\\Mousetrap.mkv', score: 1 }, { path: 'C:\\x\\Other.mkv', score: 0.7 }] });
  const r = await A.open_file({ query: 'mousetrap', media: 'true' });
  assert.equal(r.status, 'done');
  assert.deepEqual(r.resolved, { action: 'open_path', params: { path: 'C:\\Users\\me\\Videos\\Mousetrap.mkv' } });
  assert.deepEqual(calls[0], ['openPath', 'C:\\Users\\me\\Videos\\Mousetrap.mkv']);
});
test('open_file: ambiguous -> choices, nothing opened', async () => {
  const { A, calls } = fake({ matches: [{ path: 'C:\\a\\Mousetrap 1.mkv', score: 0.92 }, { path: 'C:\\a\\Mousetrap 2.mkv', score: 0.92 }, { path: 'C:\\a\\Mousetrap 3.mkv', score: 0.9 }] });
  const r = await A.open_file({ query: 'mousetrap' });
  assert.equal(r.status, 'choose');
  assert.equal(r.options.length, 3);
  assert.equal(calls.length, 0);
});
test('open_file: no match falls through', async () => { assert.equal((await fake().A.open_file({ query: 'zzz' })).status, 'fall'); });
test('program files are never opened from a match', async () => {
  const { A, calls } = fake({ matches: [{ path: 'C:\\Users\\me\\Downloads\\setup.exe', score: 1 }] });
  assert.equal((await A.open_file({ query: 'setup' })).status, 'fall');
  assert.equal(calls.length, 0);
});
test('open_path: missing path falls', async () => { assert.equal((await fake().A.open_path({ path: 'C:\\gone.txt' })).status, 'fall'); });

test('delete_file: asks first, then goes to the recycle bin', async () => {
  const { A, files } = fake({ files: ['C:\\Users\\me\\Desktop\\old.txt'] });
  const ask = await A.delete_file({ path: 'C:\\Users\\me\\Desktop\\old.txt' }, false);
  assert.equal(ask.status, 'confirm');
  assert.ok(files.has('C:\\Users\\me\\Desktop\\old.txt'));
  assert.equal((await A.delete_file({ path: 'C:\\Users\\me\\Desktop\\old.txt' }, true)).status, 'done');
  assert.ok(!files.has('C:\\Users\\me\\Desktop\\old.txt'));
});
test('file actions refuse paths outside the allowed folders', async () => {
  const { A } = fake({ files: ['C:\\Windows\\win.ini'] });
  assert.equal((await A.delete_file({ path: 'C:\\Windows\\win.ini' }, true)).status, 'fall');
  assert.equal((await A.read_file({ path: 'C:\\Windows\\win.ini' })).status, 'fall');
  assert.equal((await A.create_file({ path: 'C:\\Windows\\x.txt' })).status, 'fall');
});
test('create/copy/move never overwrite', async () => {
  const { A } = fake({ files: ['C:\\Users\\me\\a.txt', 'C:\\Users\\me\\b.txt'] });
  assert.equal((await A.create_file({ path: 'C:\\Users\\me\\a.txt' })).status, 'fall');
  assert.equal((await A.copy_file({ from: 'C:\\Users\\me\\a.txt', to: 'C:\\Users\\me\\b.txt' })).status, 'fall');
  assert.equal((await A.move_file({ from: 'C:\\Users\\me\\a.txt', to: 'C:\\Users\\me\\b.txt' }, true)).status, 'fall');
  assert.equal((await A.create_file({ path: 'C:\\Users\\me\\new.txt', content: 'x' })).status, 'done');
});
test('move_file needs confirmation', async () => {
  const { A } = fake({ files: ['C:\\Users\\me\\a.txt'] });
  assert.equal((await A.move_file({ from: 'C:\\Users\\me\\a.txt', to: 'C:\\Users\\me\\c.txt' }, false)).status, 'confirm');
});
