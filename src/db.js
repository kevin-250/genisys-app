// App database: Electron's built-in SQLite (node:sqlite), one file in userData.
import { DatabaseSync } from 'node:sqlite';
import { keyOf, score, MATCH, appsIn } from './memory.js';

let db;
export function openDb(file) {
  db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory (id INTEGER PRIMARY KEY, task TEXT, key TEXT UNIQUE, cmds TEXT, say TEXT, uses INTEGER DEFAULT 1, ok INTEGER DEFAULT 1, last_used INTEGER);
    CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY, kind TEXT, text TEXT UNIQUE, created INTEGER);
    CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY, day TEXT, ts INTEGER, win TEXT, task TEXT, steps INTEGER, secs REAL, ok INTEGER);
    CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, ts INTEGER, kind TEXT, text TEXT, seen INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS cmd_cache (key TEXT PRIMARY KEY, action TEXT, params TEXT, uses INTEGER DEFAULT 1, last_used INTEGER);
    CREATE TABLE IF NOT EXISTS convo (id INTEGER PRIMARY KEY, cid TEXT, ts INTEGER, task TEXT, route TEXT, action TEXT, params TEXT, say TEXT, rows TEXT);
    CREATE INDEX IF NOT EXISTS convo_cid ON convo (cid, ts);
    CREATE TABLE IF NOT EXISTS prefs (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS catalog (id TEXT PRIMARY KEY, kind TEXT, name TEXT, key TEXT, aliases TEXT, launch TEXT, meta TEXT, source TEXT, uses INTEGER DEFAULT 0, last_used INTEGER DEFAULT 0, first_seen INTEGER, last_seen INTEGER, misses INTEGER DEFAULT 0, label TEXT DEFAULT '', label_hash TEXT DEFAULT '');
    CREATE INDEX IF NOT EXISTS catalog_key ON catalog (key);
    CREATE TABLE IF NOT EXISTS learn (q TEXT, id TEXT, wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0, last INTEGER, PRIMARY KEY (q, id));
    CREATE TABLE IF NOT EXISTS memos (id INTEGER PRIMARY KEY, ts INTEGER, text TEXT, done INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS tool_log (id INTEGER PRIMARY KEY, ts INTEGER, tool TEXT, request TEXT, result TEXT, ok INTEGER DEFAULT 1);
    CREATE INDEX IF NOT EXISTS tool_log_tool ON tool_log (tool, id);
    CREATE TABLE IF NOT EXISTS confusions (id INTEGER PRIMARY KEY, ts INTEGER, query TEXT, wrong TEXT, right_name TEXT, how TEXT);
    CREATE TABLE IF NOT EXISTS scripts (hash TEXT PRIMARY KEY, command TEXT, script TEXT, runs INTEGER DEFAULT 0, ok_runs INTEGER DEFAULT 0, last_used INTEGER);
  `);
  // chat sessions (like ChatGPT's chat list): every turn knows its session; older rows are grouped by window + day
  try { db.exec('ALTER TABLE convo ADD COLUMN sid TEXT'); } catch {}
  try { db.exec('ALTER TABLE memos ADD COLUMN list TEXT'); } catch {} // a note can be on a list (shopping, to-do)
}

const all = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);
const today = () => new Date().toISOString().slice(0, 10);

export function getSetting(k, dflt) {
  const r = db.prepare('SELECT v FROM settings WHERE k = ?').get(k);
  return r ? JSON.parse(r.v) : dflt;
}
export const setSetting = (k, v) => run('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, JSON.stringify(v));

// Command memory
export function remember(task, cmds, say) {
  const key = keyOf(task);
  if (!key || !cmds.length) return;
  run(`INSERT INTO memory (task, key, cmds, say, last_used) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET cmds = excluded.cmds, say = excluded.say, uses = uses + 1, ok = 1, last_used = excluded.last_used`,
  task, key, JSON.stringify(cmds), say || '', Date.now());
}
// Best matches for a task (score >= MATCH), best first.
export function findMemory(task, limit = 3) {
  const k = keyOf(task);
  return all('SELECT * FROM memory WHERE ok > 0')
    .map((m) => ({ ...m, cmds: JSON.parse(m.cmds), score: score(k, m.key) }))
    .filter((m) => m.score >= MATCH)
    .sort((a, b) => b.score - a.score || b.uses - a.uses)
    .slice(0, limit);
}
// Same normalized key (Jaccard 1.0) and still working: safe to rerun with zero AI requests.
export function findExact(task) {
  const k = keyOf(task);
  if (!k) return null;
  const m = db.prepare('SELECT * FROM memory WHERE key = ? AND ok > 0').get(k);
  return m ? { ...m, cmds: JSON.parse(m.cmds) } : null;
}
export const listMemory = () => all('SELECT * FROM memory ORDER BY last_used DESC').map((m) => ({ ...m, cmds: JSON.parse(m.cmds) }));
export const updateMemory = (id, cmds) => run('UPDATE memory SET cmds = ?, ok = 1 WHERE id = ?', JSON.stringify(cmds), id);
export const deleteMemory = (id) => run('DELETE FROM memory WHERE id = ?', id);
export const useMemory = (id, worked) => run(worked
  ? 'UPDATE memory SET uses = uses + 1, ok = 1, last_used = ? WHERE id = ?'
  : 'UPDATE memory SET ok = ok - 1, last_used = ? WHERE id = ?', Date.now(), id);

// What it learned about the user
export const recentTasks = (n = 30) => all('SELECT task FROM convo ORDER BY id DESC LIMIT ?', n).map((r) => r.task).reverse();
export const habitRows = () => ({
  apps: all("SELECT name, uses FROM catalog WHERE uses > 0 AND kind IN ('app','store','program','pwa') ORDER BY uses DESC LIMIT 8"),
  music: all("SELECT request FROM tool_log WHERE tool = 'play_music' ORDER BY id DESC LIMIT 40").map((r) => r.request),
  weather: all("SELECT request FROM tool_log WHERE tool = 'weather' ORDER BY id DESC LIMIT 40").map((r) => r.request),
  contacts: all("SELECT request FROM tool_log WHERE tool = 'chat_send' ORDER BY id DESC LIMIT 40").map((r) => r.request),
});
export const listProfile = () => all('SELECT * FROM profile ORDER BY kind, created');
export const addProfile = (kind, text) => run('INSERT OR IGNORE INTO profile (kind, text, created) VALUES (?, ?, ?)', kind, text.trim(), Date.now());
export const updateProfile = (id, kind, text) => run('UPDATE profile SET kind = ?, text = ? WHERE id = ?', kind, text.trim(), id);
export const deleteProfile = (id) => run('DELETE FROM profile WHERE id = ?', id);

// Daily activity
export const logTask = (win, task, steps, secs, ok) => run('INSERT INTO log (day, ts, win, task, steps, secs, ok) VALUES (?, ?, ?, ?, ?, ?, ?)', today(), Date.now(), win, task, steps, secs, ok ? 1 : 0);
export const todayStats = () => db.prepare('SELECT COUNT(*) tasks, COALESCE(SUM(steps), 0) steps, COALESCE(SUM(ok), 0) ok FROM log WHERE day = ?').get(today());
export const failsToday = (task) => db.prepare('SELECT COUNT(*) n FROM log WHERE day = ? AND task = ? AND ok = 0').get(today(), task).n;

// Self-improvement notes
export const addNote = (kind, text) => run('INSERT INTO notes (ts, kind, text) VALUES (?, ?, ?)', Date.now(), kind, text);
export const listNotes = () => all('SELECT * FROM notes ORDER BY ts DESC LIMIT 200');
export const unseenNotes = () => db.prepare('SELECT COUNT(*) n FROM notes WHERE seen = 0').get().n;
export const markNotesSeen = () => run('UPDATE notes SET seen = 1 WHERE seen = 0');
export const deleteNote = (id) => run('DELETE FROM notes WHERE id = ?', id);

// Stage 4: command cache. normalized command -> { action, params } for commands that already worked once.
export const cacheGet = (key) => { const r = db.prepare('SELECT * FROM cmd_cache WHERE key = ?').get(key); return r ? { ...r, params: JSON.parse(r.params) } : null; };
export const cachePut = (key, action, params) => run(`INSERT INTO cmd_cache (key, action, params, last_used) VALUES (?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET action = excluded.action, params = excluded.params, last_used = excluded.last_used`, key, action, JSON.stringify(params), Date.now());
export const cacheUse = (key) => run('UPDATE cmd_cache SET uses = uses + 1, last_used = ? WHERE key = ?', Date.now(), key);
export const cacheDrop = (key) => run('DELETE FROM cmd_cache WHERE key = ?', key);
export const cacheCount = () => db.prepare('SELECT COUNT(*) n FROM cmd_cache').get().n;
export const cacheClear = () => { const n = cacheCount(); run('DELETE FROM cmd_cache'); return n; };

// Stage 9: every AI-written script and how often it worked, so good ones can be promoted to actions/.
export const scriptRecord = (hash, command, script, ok) => run(`INSERT INTO scripts (hash, command, script, runs, ok_runs, last_used) VALUES (?, ?, ?, 1, ?, ?)
  ON CONFLICT(hash) DO UPDATE SET runs = runs + 1, ok_runs = ok_runs + excluded.ok_runs, last_used = excluded.last_used`, hash, command, script, ok ? 1 : 0, Date.now());
// The user's quick notes ("take a note buy milk"): kept here, in Genisys, not in a file.
export const memoAdd = (text, list = null) => Number(run('INSERT INTO memos (ts, text, list) VALUES (?, ?, ?)', Date.now(), String(text), list ? String(list) : null).lastInsertRowid);
export const memoList = (list = null) => (list ? all('SELECT * FROM memos WHERE list = ? ORDER BY done, ts DESC', String(list)) : all('SELECT * FROM memos WHERE list IS NULL ORDER BY done, ts DESC'));
export const memoDone = (id, done) => run('UPDATE memos SET done = ? WHERE id = ?', done ? 1 : 0, Number(id));
export const memoDel = (id) => run('DELETE FROM memos WHERE id = ?', Number(id));
export const scriptsGood = () => all('SELECT * FROM scripts WHERE ok_runs >= 2 ORDER BY ok_runs DESC, last_used DESC LIMIT 50');

// Know-how per app: what already worked in the apps this task names, whatever the wording ("send to mom on whatsapp"
// reuses what worked for "share file with kevin in whatsapp").
export function appHints(task, n = 3) {
  const names = all("SELECT name FROM catalog WHERE kind IN ('app','store','program','pwa') ORDER BY uses DESC").map((r) => r.name);
  return appsIn(task, names).map((app) => {
    const like = `%${app}%`;
    return {
      app,
      mem: all('SELECT task, cmds FROM memory WHERE ok > 0 AND lower(task) LIKE ? ORDER BY uses DESC, last_used DESC LIMIT ?', like, n).map((m) => ({ task: m.task, cmds: JSON.parse(m.cmds) })),
      scripts: all('SELECT command, script FROM scripts WHERE ok_runs >= 1 AND lower(command) LIKE ? ORDER BY ok_runs DESC, last_used DESC LIMIT 2', like),
    };
  }).filter((h) => h.mem.length || h.scripts.length);
}

// Conversation memory (convo.js): every turn of a window, so a follow-up ("how large is it") still knows what "it" was.
// cid = which window ("main", "agent-3"). Everything is kept, so the user can read their chats later (Tools › Chats).
export function convoAdd(cid, t) {
  run('INSERT INTO convo (cid, ts, task, route, action, params, say, rows, sid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    String(cid), t.ts || Date.now(), t.task, t.route || '', t.action || '', JSON.stringify(t.params || {}), t.say || '', JSON.stringify(t.rows || []), t.sid ? String(t.sid) : null);
}
// ---- Chat sessions: name = the first question, newest first; a session's turns in order; the last session of a window
const SESSION = "COALESCE(sid, cid || ':' || date(ts / 1000, 'unixepoch', 'localtime'))";
export function chatSessions(limit = 100, q = '') {
  const find = q ? `WHERE ${SESSION} IN (SELECT ${SESSION} FROM convo WHERE task LIKE ? OR say LIKE ?)` : '';
  return all(`SELECT ${SESSION} AS s, MIN(ts) AS start, MAX(ts) AS last, COUNT(*) AS n, MIN(id) AS first FROM convo ${find} GROUP BY s ORDER BY last DESC LIMIT ?`, ...(q ? [`%${q}%`, `%${q}%`, limit] : [limit]))
    .map((r) => ({ ...r, title: db.prepare('SELECT task FROM convo WHERE id = ?').get(r.first)?.task || 'Chat' }));
}
export const sessionTurns = (s) => all(`SELECT * FROM convo WHERE ${SESSION} = ? ORDER BY id`, String(s)).map((r) => ({ ...r, params: JSON.parse(r.params || '{}'), rows: JSON.parse(r.rows || '[]') }));
export const lastSession = (cid) => db.prepare('SELECT sid, ts FROM convo WHERE cid = ? AND sid IS NOT NULL ORDER BY id DESC LIMIT 1').get(String(cid)) || null;
// "New chat" only moves the window's starting point: the AI forgets the old turns, the history stays.
const convoCut = (cid) => Number(db.prepare('SELECT value FROM prefs WHERE key = ?').get(`convo_cut:${cid}`)?.value || 0);
export const convoRecent = (cid, limit = 12, since = 0) => all('SELECT * FROM (SELECT * FROM convo WHERE cid = ? AND ts >= ? ORDER BY id DESC LIMIT ?) ORDER BY id', String(cid), Math.max(since, convoCut(cid) + 1), limit)
  .map((r) => ({ ...r, params: JSON.parse(r.params || '{}'), rows: JSON.parse(r.rows || '[]') }));
export const convoClear = (cid) => run('INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', `convo_cut:${cid}`, String(Date.now()));
// every chat turn of every window, newest first (the Chats page)
export const chatHistory = (limit = 300, q = '') => all(`SELECT id, cid, ts, task, say, route, action FROM convo ${q ? 'WHERE task LIKE ? OR say LIKE ?' : ''} ORDER BY id DESC LIMIT ?`, ...(q ? [`%${q}%`, `%${q}%`, limit] : [limit]));

// Every use of an everyday tool (timer, alarm, notes, music…) and every ring: the Tools page shows them per tool.
export const toolLog = (tool, request, result, ok = true) => run('INSERT INTO tool_log (ts, tool, request, result, ok) VALUES (?, ?, ?, ?, ?)', Date.now(), String(tool), String(request || '').slice(0, 500), String(result || '').slice(0, 1000), ok ? 1 : 0);
export const toolLogs = (tool = '', limit = 200) => all(`SELECT * FROM tool_log ${tool ? 'WHERE tool = ?' : ''} ORDER BY id DESC LIMIT ?`, ...(tool ? [tool, limit] : [limit]));
export const toolCounts = () => Object.fromEntries(all('SELECT tool, COUNT(*) n, MAX(ts) last FROM tool_log GROUP BY tool').map((r) => [r.tool, { n: r.n, last: r.last }]));

// Favorites (src/fast/favorites.js): "fav:browser" = chrome, "fav:profile:chrome" = KEVIN, "count:browser:chrome" = 7 (what the user actually uses).
export const prefAll = () => Object.fromEntries(all('SELECT key, value FROM prefs').map((r) => [r.key, r.value]));
export const prefSet = (key, value) => run('INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', String(key), String(value));
export const prefDel = (key) => run('DELETE FROM prefs WHERE key = ?', String(key));
export const prefBump = (key) => run("INSERT INTO prefs (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1", String(key));

// The catalog (src/fast/catalog.js): everything on this PC that can be opened.
const J = (t, d) => { try { return JSON.parse(t); } catch { return d; } };
export const catalogAll = () => all('SELECT * FROM catalog').map((r) => ({ ...r, aliases: J(r.aliases, []), launch: J(r.launch, {}), meta: J(r.meta, {}) }));
export function catalogApply({ upserts = [], removes = [] }) {
  db.exec('BEGIN');
  try {
    const st = db.prepare('INSERT OR REPLACE INTO catalog (id, kind, name, key, aliases, launch, meta, source, uses, last_used, first_seen, last_seen, misses, label, label_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const e of upserts) st.run(e.id, e.kind, e.name, e.key, JSON.stringify(e.aliases || []), JSON.stringify(e.launch || {}), JSON.stringify(e.meta || {}), e.source || '', e.uses || 0, e.last_used || 0, e.first_seen || 0, e.last_seen || 0, e.misses || 0, e.label || '', e.label_hash || '');
    const del = db.prepare('DELETE FROM catalog WHERE id = ?');
    for (const id of removes) del.run(id);
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}
export const catalogUse = (id) => run('UPDATE catalog SET uses = uses + 1, last_used = ? WHERE id = ?', Date.now(), id);
export const catalogLabel = (id, label, hash) => run('UPDATE catalog SET label = ?, label_hash = ? WHERE id = ?', JSON.stringify(label), hash, id);

// Stage 5: what each typed request turned out to mean. learn: wins/losses per (request, catalog entry). confusions: the readable log.
export const learnAll = () => Object.fromEntries(all('SELECT * FROM learn').map((r) => [`${r.q}|${r.id}`, { wins: r.wins, losses: r.losses }]));
export const learnBump = (q, id, dw, dl) => run('INSERT INTO learn (q, id, wins, losses, last) VALUES (?, ?, MAX(0, ?), MAX(0, ?), ?) ON CONFLICT(q, id) DO UPDATE SET wins = MAX(0, wins + ?), losses = MAX(0, losses + ?), last = excluded.last', String(q), String(id), dw, dl, Date.now(), dw, dl);
export const confusionAdd = (c) => { run('INSERT INTO confusions (ts, query, wrong, right_name, how) VALUES (?, ?, ?, ?, ?)', Date.now(), String(c.query || ''), String(c.wrong || ''), String(c.right || ''), String(c.how || '')); run('DELETE FROM confusions WHERE id NOT IN (SELECT id FROM confusions ORDER BY id DESC LIMIT 200)'); };
export const confusionRecent = (n = 15) => all('SELECT * FROM confusions ORDER BY id DESC LIMIT ?', n);
