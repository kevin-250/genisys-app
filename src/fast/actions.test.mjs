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

test('file_info: size, dates and place of one file or folder; outside the allowed folders it refuses', async () => {
  const f = 'C:\\Users\\me\\Videos\\Movies\\film.mkv';
  const { A } = fake({ files: [f] });
  assert.equal((await A.file_info({ path: f })).status, 'fall'); // no statPath in this fake: nothing to say, so the next route tries
  const d2 = { exists: () => true, isAllowed: (p) => p.startsWith('C:\\Users\\me\\'), statPath: (p) => (p.endsWith('.mkv') ? { isDir: false, size: 1.2 * 1024 ** 3, birth: new Date(2026, 10, 11, 19, 6).getTime(), mtime: new Date(2026, 10, 11, 19, 6).getTime() } : { isDir: true, size: 37 * 1024 ** 3, items: 246 }) };
  const B = makeActions(d2);
  const r = await B.file_info({ path: f });
  assert.equal(r.status, 'done');
  assert.match(r.message, /^film\.mkv · 1\.2 GB · arrived 2026-11-11 19:06/);
  assert.match(r.message, /in C:\\Users\\me\\Videos\\Movies$/);
  assert.match((await B.file_info({ path: 'C:\\Users\\me\\Videos\\Movies' })).message, /37 GB · 246 files inside/);
  assert.equal((await B.file_info({ path: 'D:\\secret.txt' })).status, 'fall');
});

// ---- Stage 3: folder names resolve by meaning; every listing rescans ----
function tree(over = {}) {
  const roots = []; let refreshed = 0;
  const dirs = { 'C:\\u\\Videos': ['Movies\\', 'MEMES\\', 'a.mp4'], 'C:\\u\\Downloads': ['Zips\\'], 'C:\\u\\Documents': [], 'C:\\u\\Videos\\Movies': ['Show\\'] };
  const d = {
    shell: {}, resolveApp: () => null, spawnDetached() {}, paths: { home: 'C:\\u', videos: 'C:\\u\\Videos', downloads: 'C:\\u\\Downloads', documents: 'C:\\u\\Documents' },
    findFiles: async () => ({ matches: over.matches || [{ path: 'C:\\u\\Videos\\MEMES', score: 0.9 }] }),
    exists: () => true, isAllowed: () => true, isDir: (p) => p in dirs,
    listDir: (p) => dirs[p] || [],
    scanFiles: async (root) => { roots.push(root); return { files: [], partial: false }; },
    refreshIndex: () => { refreshed++; },
  };
  return { A: makeActions(d), roots, get refreshed() { return refreshed; } };
}
test('folders: "in movies" / "movie folder" pick the real Movies folder, not MEMES or the Videos root', async () => {
  for (const where of ['movies', 'movie folder', 'my movies folder', 'Movies', 'videos/movie folder', 'videos/movies', 'movie']) {
    const t = tree(); await t.A.browse_files({ in: where, kind: 'video' });
    assert.deepEqual(t.roots, ['C:\\u\\Videos\\Movies'], where);
  }
});
test('folders: library names, nested names, no wrong guess', async () => {
  let t = tree(); await t.A.browse_files({ in: 'videos', kind: 'video' }); assert.deepEqual(t.roots, ['C:\\u\\Videos']);
  t = tree(); await t.A.browse_files({ in: 'downloads/zip', kind: 'any' }); assert.deepEqual(t.roots, ['C:\\u\\Downloads\\Zips']);
  t = tree(); await t.A.browse_files({ in: 'dowloads', kind: 'any' }); assert.deepEqual(t.roots, []); // typo of a library name: not in the fake search; no wrong folder
  t = tree({ matches: [{ path: 'C:\\u\\Videos\\MEMES', score: 0.9 }] });
  const r = await t.A.browse_files({ in: 'movie night', kind: 'video' });
  assert.equal(r.status, 'fall'); assert.deepEqual(t.roots, [], 'a fuzzy hit whose name does not fit is never used');
  t = tree(); const r2 = await t.A.browse_files({ in: 'videos/nothing here', kind: 'video' }); assert.equal(r2.status, 'fall');
});
test('every file listing rescans the folder tree', async () => {
  const t = tree(); await t.A.browse_files({ in: 'videos', kind: 'video' }); await t.A.browse_files({ kind: 'video' });
  assert.equal(t.refreshed, 2); assert.equal(t.roots.length, 2);
});

// ---- browser profiles ----
function browserFake(profiles) {
  const calls = [];
  const d = { shell: { openExternal: async (u) => calls.push(['ext', u]) }, resolveApp: (n) => (n === 'chrome' ? 'C:\\c\\chrome.exe' : null), spawnDetached: (...a) => calls.push(['spawn', ...a]),
    paths: {}, findFiles: async () => ({ matches: [] }), exists: () => true, isAllowed: () => true, browserProfiles: async () => profiles };
  return { A: makeActions(d), calls };
}
const PROFS = [{ dir: 'Default', name: 'Personal', email: 'me@gmail.com' }, { dir: 'Profile 1', name: 'Kevin', email: 'kevin.w@gmail.com' }, { dir: 'Profile 2', name: 'Work', email: 'k@corp.com' }];
test('open_url with a profile starts that profile (already signed in)', async () => {
  for (const want of ['kevin', 'Kevin', 'kevins', 'kevin.w']) {
    const { A, calls } = browserFake(PROFS);
    const r = await A.open_url({ url: 'https://mail.google.com', browser: 'chrome', profile: want });
    assert.equal(r.status, 'done', want);
    assert.deepEqual(calls[0], ['spawn', 'C:\\c\\chrome.exe', ['--profile-directory=Profile 1', 'https://mail.google.com']], want);
  }
  const w = browserFake(PROFS); await w.A.search_web({ query: 'cats', profile: 'work' });
  assert.deepEqual(w.calls[0][2], ['--profile-directory=Profile 2', 'https://www.google.com/search?q=cats']);
});
test('unknown profile or no profile list: no wrong launch, the reason lists the profiles', async () => {
  const a = browserFake(PROFS); const r = await a.A.open_url({ url: 'https://x.com', browser: 'chrome', profile: 'bob' });
  assert.equal(r.status, 'fall'); assert.match(r.reason, /Kevin \(Profile 1\)/); assert.equal(a.calls.length, 0);
  const b = browserFake([]); assert.equal((await b.A.open_url({ url: 'https://x.com', profile: 'kevin' })).status, 'fall'); assert.equal(b.calls.length, 0);
});

test('catalog action: empty, summary, search, and open_app counts a use', async () => {
  const { buildEntries } = await import('./catalog.js');
  const es = buildEntries([{ kind: 'pwa', name: 'Spotify', launch: { type: 'lnk', target: 'C:\\s.lnk', args: '--app-id=a' }, source: 'startmenu' }, { kind: 'app', name: 'Notepad', launch: { type: 'exe', target: 'C:\\n.exe' }, source: 'startmenu' }]);
  const touched = [];
  const dd = { shell: { openPath: async () => '', openExternal: async () => {} }, resolveApp: (n) => (n === 'notepad' ? 'C:\\n.exe' : null), spawnDetached() {}, paths: {}, exists: () => true, isAllowed: () => true, catalogTouch: (t) => touched.push(t), catalog: () => es };
  const A = makeActions(dd);
  assert.match((await A.catalog({ op: 'summary' })).message, /2 things.*1 pwa.*1 app/);
  const s = await A.catalog({ op: 'search', query: 'spotfy' });
  assert.match(s.message, /pwa\s+Spotify\s+->\s+C:\\s\.lnk --app-id=a/);
  assert.match((await makeActions({ ...dd, catalog: () => [] }).catalog({ op: 'summary' })).message, /empty/);
  const r = await A.open_app({ name: 'notepad' });
  assert.equal(r.status, 'done'); assert.deepEqual(touched, ['notepad']);
});

test('open_app predicts from the catalog: typo -> the Chrome app by its shortcut; two close -> a choose card; id launches exactly', async () => {
  const { buildEntries } = await import('./catalog.js');
  const es = buildEntries([
    { kind: 'pwa', name: 'Spotify', launch: { type: 'lnk', target: 'C:\\s\\Spotify.lnk', args: '--app-id=a' }, source: 's' },
    { kind: 'app', name: 'OneDrive', launch: { type: 'exe', target: 'C:\\od.exe' }, source: 's' },
    { kind: 'app', name: 'OneNote', launch: { type: 'exe', target: 'C:\\on.exe' }, source: 's' },
  ]);
  const calls = [];
  const dd = { shell: { openPath: async () => '', openExternal: async () => {} }, resolveApp: () => 'C:\\chrome.exe', spawnDetached: (...a) => calls.push(a), paths: {}, exists: () => true, isAllowed: () => true, catalog: () => es };
  const A = makeActions(dd);
  const r = await A.open_app({ name: 'spotfy' });
  assert.equal(r.status, 'done'); assert.deepEqual(calls[0], ['C:\\s\\Spotify.lnk', []]); assert.match(r.message, /Spotify \(pwa/);
  const c = await A.open_app({ name: 'one' });
  assert.equal(c.status, 'choose'); assert.equal(c.options.length, 2); assert.ok(c.options[0].params.id);
  await A.open_app(c.options[1].params);
  assert.equal(calls.length, 2);
  assert.equal((await A.open_app({ id: 'app:gone' })).status, 'fall');
  const p = await A.catalog({ op: 'predict', query: 'spotfy' });
  assert.match(p.message, /DO Spotify/);
});

// ---- chat_send: opens the chat and attaches, never sends; deep app search once
test('chat_send: checks the file and app, opens the app, hands the chat app the contact and file', async () => {
  const f = 'C:\\Users\\me\\Documents\\list.pdf';
  const sent = [];
  const B = makeActions({ ...fakeDeps(f), chatSend: async (o) => { sent.push(o); return { ok: true }; } });
  assert.equal((await B.chat_send({ app: 'WhatsApp', to: 'Kevin', path: f })).status, 'done');
  assert.deepEqual(sent[0], { title: 'WhatsApp', search: '^f', to: 'Kevin', path: f, text: '' });
  assert.equal((await B.chat_send({ app: 'whatsapp', to: 'Kevin', path: 'D:\\secret.pdf' })).status, 'fall'); // outside allowed folders
  assert.equal((await B.chat_send({ app: 'whatsapp', to: 'Kevin', path: 'C:\\Users\\me\\nope.pdf' })).status, 'fall'); // missing file
  assert.equal((await B.chat_send({ app: 'teams', to: 'Kevin', text: 'hi' })).status, 'fall'); // no built-in way: the AI scripts it
  assert.equal((await B.chat_send({ app: 'whatsapp', to: '', text: 'hi' })).status, 'fall');
  assert.equal(sent.length, 1);
});
test('open_app: a missing app gets one deep search, found paths launch', async () => {
  let asked = 0;
  const calls = [];
  const B = makeActions({ ...fakeDeps(), spawnDetached: (exe) => calls.push(exe), findAppDeep: async (n) => { asked++; return n === 'mytool' ? 'D:\\Tools\\MyTool\\bin\\mytool.exe' : null; } });
  assert.equal((await B.open_app({ name: 'mytool' })).status, 'done');
  assert.deepEqual(calls, ['D:\\Tools\\MyTool\\bin\\mytool.exe']);
  assert.equal((await B.open_app({ name: 'nothing' })).status, 'fall');
  assert.equal(asked, 2);
});
function fakeDeps(file) {
  return {
    shell: { openPath: async () => '', openExternal: async () => {} }, resolveApp: (n) => (n === 'whatsapp' ? 'C:\\w\\WhatsApp.exe' : null), spawnDetached() {},
    findFiles: async () => ({ matches: [] }), paths: {}, exists: (p) => p === file, isAllowed: (p) => p.startsWith('C:\\Users\\me\\'),
  };
}
