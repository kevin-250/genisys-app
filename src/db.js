// App database: Electron's built-in SQLite (node:sqlite), one file in userData.
import { DatabaseSync } from 'node:sqlite';
import { keyOf, score, MATCH } from './memory.js';

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
    CREATE TABLE IF NOT EXISTS scripts (hash TEXT PRIMARY KEY, command TEXT, script TEXT, runs INTEGER DEFAULT 0, ok_runs INTEGER DEFAULT 0, last_used INTEGER);
  `);
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
export const scriptsGood = () => all('SELECT * FROM scripts WHERE ok_runs >= 2 ORDER BY ok_runs DESC, last_used DESC LIMIT 50');
