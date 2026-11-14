// Replays the pasted chat through the real parser, actions and conversation memory (fake disk, no model).
import { parseIntent, FAST_MIN } from './intent.js';
import { makeActions } from './actions.js';
import { makeConvo, rowsFrom } from '../convo.js';

const U = '/u';
const dirs = { [`${U}/Videos`]: ['Movies\\', 'MEMES\\'], [`${U}/Videos/Movies`]: [], [`${U}/Videos/MEMES`]: [], [`${U}/Downloads`]: [] };
const mk = (p, name, ext, kind, day) => ({ path: `${p}/${name}`, name, ext, kind, size: 1e6, arrived: Date.parse(`2026-11-${day}T10:00:00`), modified: Date.parse(`2026-11-${day}T10:00:00`), rel: name });
const disk = {
  [`${U}/Videos/Movies`]: ['A.S01E01.mkv', 'B.S01E02.mkv', 'C.mp4'].map((n, i) => mk(`${U}/Videos/Movies`, n, n.split('.').pop(), 'video', 10 + i)),
  [`${U}/Videos/MEMES`]: [mk(`${U}/Videos/MEMES`, 'meme.png', 'png', 'image', 5)],
  [`${U}/Downloads`]: ['metron-fixed (3).zip', 'metron-fixed (2).zip', 'RAY-Markets-main.zip'].map((n, i) => mk(`${U}/Downloads`, n, 'zip', 'archive', 13 - i)),
};
let refreshed = 0;
const d = {
  shell: {}, resolveApp: () => null, spawnDetached() {}, paths: { home: U, videos: `${U}/Videos`, downloads: `${U}/Downloads`, documents: `${U}/Documents` },
  findFiles: async () => ({ matches: [{ path: `${U}/Videos/MEMES`, score: 0.9 }] }), // the old bug: fuzzy search points at MEMES
  exists: () => true, isAllowed: () => true, isDir: (p) => p in dirs, listDir: (p) => dirs[p] || [],
  scanFiles: async (root) => ({ files: Object.entries(disk).filter(([k]) => k === root || k.startsWith(root + '/')).flatMap(([, v]) => v), partial: false }),
  refreshIndex: () => { refreshed++; },
};
const A = makeActions(d);
const convo = makeConvo();
const say = (...a) => console.log(...a);
let fails = 0; const check = (ok, msg) => { say(ok ? '  ok ' : '  FAIL', msg); if (!ok) fails++; };

for (const task of ['show me latest movies in videos/movie folder', 'show me in movies', 'show me 5 movies in movies folder', 'show me all zip folders in download']) {
  const ref = convo.deleteRef(task);
  const it = parseIntent(task);
  say(`> ${task}`);
  check(!ref, 'not mistaken for a delete');
  check(it.action === 'browse_files' && it.confidence >= FAST_MIN, `fast path: ${it.action} ${JSON.stringify(it.params)}`);
  const r = await A[it.action](it.params);
  say('   ', r.message);
  convo.add({ task, route: 'fast', action: it.action, params: it.params, say: r.message, rows: rowsFrom(r.data, r.table?.paths), n: String(r.data || '').split('\n').filter((l) => l && !l.startsWith('…')).length });
  if (/movies/.test(task)) check(/Movies/.test(r.message) && !/MEMES/.test(r.message), 'listed the real Movies folder');
  if (/zip/.test(task)) check(r.table?.paths?.length === 3, '3 zips listed');
}
say('> delete them');
const ref = convo.deleteRef('delete them');
check(ref && ref.paths.length === 3 && ref.paths.every((p) => p.endsWith('.zip') && p.includes('/Downloads/')), `binds to the latest listing: ${ref && ref.names.join(', ')}`);
check(refreshed >= 4, `rescanned on every listing (${refreshed})`);
const p = convo.prompt();
check(p.indexOf('MOST RECENT LISTING') > p.lastIndexOf('show me 5 movies'), 'model text marks the zips listing as the latest');
say(fails ? `\n${fails} FAILED` : '\nreplay passed');
process.exit(fails ? 1 : 0);
