import { app, BrowserWindow, ipcMain, globalShortcut, screen, Notification, shell, webContents } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import started from 'electron-squirrel-startup';
import * as db from './db.js';
import seedKeys from '../default-keys.json';
import { batName, fixCmd } from './memory.js';
import { fuzzy } from './fuzzy.js';
import { makeActions } from './fast/actions.js';
import { loadActions, validateParams, fillTemplate, routerLines, similarPrompt } from './fast/registry.js';
import { PathIndex } from './fast/index.js';
import { checkScript, isInside } from './fast/safety.js';
import { hashScript } from './fast/scriptFallback.js';
import { parseLog, formatStats } from './fast/stats.js';

// Diagnostics: if the app ever exits on its own, say who asked for it and why (also saved to %TEMP%\genisys-debug.log).
const dlog = (...a) => { const line = `[${new Date().toISOString()}] ${a.join(' ')}`; console.log('[genisys]', line); try { fs.appendFileSync(path.join(os.tmpdir(), 'genisys-debug.log'), line + '\n'); } catch {} };
process.on('uncaughtException', (e) => dlog('uncaughtException', e?.stack || e));
process.on('unhandledRejection', (e) => dlog('unhandledRejection', e?.stack || e));
app.on('render-process-gone', (_e, wc, d) => dlog('render-process-gone', d.reason, d.exitCode));
app.on('child-process-gone', (_e, d) => dlog('child-process-gone', d.type, d.reason, d.exitCode));
const realQuit = app.quit.bind(app);
app.quit = () => { dlog('app.quit called from', new Error().stack.split('\n').slice(2, 5).join(' | ')); realQuit(); };
dlog('starting; started =', started, '; packaged =', app.isPackaged);
if (started) app.quit();
// Launching again (e.g. desktop shortcut) just brings the running app forward.
// (Dev runs skip the lock: an installed/background Genisys would make `npm start` exit silently.)
if (app.isPackaged && !app.requestSingleInstanceLock()) {
  // Another Genisys is already running (maybe stuck/hidden): kill it, then start fresh.
  try { execFileSync('taskkill', ['/F', '/T', '/IM', path.basename(process.execPath), '/FI', `PID ne ${process.pid}`], { stdio: 'ignore' }); } catch {}
  app.relaunch();
  app.exit(0);
}
app.on('second-instance', () => mainWin && showMain());

const ASSETS = app.isPackaged ? path.join(process.resourcesPath, 'assets') : path.join(__dirname, '../../assets');
const DEFAULT_MODELS = ['nvidia/nemotron-3-ultra-550b-a55b:free', 'nvidia/nemotron-3.5-super-vl:free', 'google/gemma-4-31b-it:free'];

// Keys live outside the repo: %APPDATA%/Executor/config.json ({"apiKeys": [...]}) or OPENROUTER_API_KEY env var.
const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
function readCfg() {
  try { return JSON.parse(fs.readFileSync(cfgPath(), 'utf8')); } catch { return {}; }
}
const writeCfg = (cfg) => fs.writeFileSync(cfgPath(), JSON.stringify(cfg, null, 2));
function loadConfig() {
  const cfg = readCfg();
  const keys = [...new Set([...(cfg.apiKeys || []), cfg.apiKey, process.env.OPENROUTER_API_KEY].filter(Boolean))];
  return {
    keys,
    // Free open models, in order; OpenRouter falls through to the next when one is rate-limited (429). Editable in Settings.
    models: db.getSetting('models', null) || cfg.models || DEFAULT_MODELS,
  };
}
const keyId = (k) => k.slice(-8);
const mask = (k) => `${k.slice(0, 9)}…${k.slice(-4)}`;
// A key that hit its free daily limit rests until OpenRouter's reset (00:00 UTC).
const nextUtcMidnight = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.getTime(); };
const restingUntil = (k) => db.getSetting('keyRest', {})[keyId(k)] || 0;
function rest(k, reason) {
  const r = db.getSetting('keyRest', {});
  r[keyId(k)] = nextUtcMidnight();
  db.setSetting('keyRest', r);
  db.setSetting('keyReason', { ...db.getSetting('keyReason', {}), [keyId(k)]: reason });
}

// Notes are saved silently. A Windows toast appears ONLY when a task finished/failed while no Genisys window is focused.
function notify(kind, text) {
  if (kind === 'done' || kind === 'failed') {
    if (!Notification.isSupported() || BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible() && w.isFocused())) return;
    const n = new Notification({ title: kind === 'done' ? 'Genisys finished' : "Genisys couldn't finish", body: text, icon: path.join(ASSETS, 'icon.png') });
    n.on('click', () => showMain());
    n.show();
    return;
  }
  db.addNote(kind, text);
  mainWin?.webContents.send('notes-changed');
}

// Daily: new strong free models on OpenRouter → toast (first run only records the list).
async function checkModels(force) {
  if (!force && Date.now() - db.getSetting('lastModelCheck', 0) < 24 * 3600e3) return;
  db.setSetting('lastModelCheck', Date.now());
  try {
    const free = (await (await fetch('https://openrouter.ai/api/v1/models')).json()).data.map((m) => m.id).filter((id) => id.endsWith(':free'));
    const known = db.getSetting('knownFreeModels', null);
    db.setSetting('knownFreeModels', free);
    if (!known) return;
    const strong = /nemotron|gemma|qwen|deepseek|llama|mistral|kimi|glm|gpt-oss/i;
    for (const id of free.filter((m) => !known.includes(m) && strong.test(m)).slice(0, 3)) {
      notify('model', `${id} is now free on OpenRouter. Try it in Settings → models.`);
    }
  } catch {} // offline: try again next time
}

// Packaged app only: project source newer than this build → remind to rebuild.
function checkCode() {
  if (!app.isPackaged) return;
  let newest = 0;
  const walk = (p) => {
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) fs.readdirSync(p).forEach((f) => walk(path.join(p, f)));
      else newest = Math.max(newest, st.mtimeMs);
    } catch {}
  };
  ['src', 'index.html', 'assets'].forEach((f) => walk(path.join(__PROJECT_DIR__, f)));
  if (newest > __BUILD_TIME__ + 60e3 && db.getSetting('codeNotified', 0) < newest) {
    db.setSetting('codeNotified', newest);
    notify('code', 'Your app source changed since this build. Run "npm run package" in my-app to update genisys.exe.');
  }
}

// Renderer → database, through an allow-list (no raw SQL from the page).
const DB_OPS = ['getSetting', 'setSetting', 'remember', 'findMemory', 'findExact', 'listMemory', 'updateMemory', 'deleteMemory', 'useMemory',
  'listProfile', 'addProfile', 'updateProfile', 'deleteProfile', 'logTask', 'todayStats', 'failsToday',
  'listNotes', 'unseenNotes', 'markNotesSeen', 'deleteNote',
  'cacheGet', 'cachePut', 'cacheUse', 'cacheDrop', 'cacheCount', 'cacheClear', 'scriptRecord', 'scriptsGood'];
ipcMain.handle('db', (_e, op, ...args) => {
  if (!DB_OPS.includes(op)) throw new Error(`unknown db op ${op}`);
  const r = db[op](...args);
  if (op === 'remember' || op === 'updateMemory' || op === 'deleteMemory') syncBats();
  return r;
});

// Every remembered task also lives as a double-clickable .bat in %APPDATA%/Executor/bats.
const batsDir = () => path.join(app.getPath('userData'), 'bats');
// In a .bat, %20 in a URL is eaten as an argument (%2 + "0"): double lone % before two hex digits, keep %VARS% and %%i.
const batSafe = (t) => t.replace(/(?<!%)%(?=[0-9A-Fa-f]{2})/g, (m, off, str) => (/^%[A-Za-z_]\w*%/.test(str.slice(off)) ? m : '%%'));
const batText = (m) => `@echo off\r\nchcp 65001 >nul\r\nREM Genisys task: ${m.task.replace(/[\r\n]+/g, ' ')}\r\n${batSafe(m.cmds.map(fixCmd).join('\r\n')).replace(/\r?\n/g, '\r\n')}\r\n`;
function syncBats() {
  try {
    fs.mkdirSync(batsDir(), { recursive: true });
    const rows = db.listMemory();
    const keep = new Set(rows.map(batName));
    for (const f of fs.readdirSync(batsDir())) if (f.endsWith('.bat') && !keep.has(f)) fs.rmSync(path.join(batsDir(), f), { force: true });
    for (const m of rows) fs.writeFileSync(path.join(batsDir(), batName(m)), batText(m));
  } catch {}
}
ipcMain.on('openBats', () => { fs.mkdirSync(batsDir(), { recursive: true }); shell.openPath(batsDir()); });
ipcMain.handle('notify', (_e, kind, text) => notify(kind, text));
ipcMain.handle('checkUpdates', async () => { await checkModels(true); checkCode(); });
const setAutostart = (on) => { if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: ['--autostart'] }); };
ipcMain.handle('autostart', (_e, on) => { db.setSetting('autostart', on); setAutostart(on); return app.isPackaged; });

ipcMain.handle('config', () => {
  const { keys, models } = loadConfig();
  return { model: models[0], models, hasKey: keys.length > 0, keyCount: keys.length, path: cfgPath() };
});

// Settings → keys. The page only ever sees masked keys.
ipcMain.handle('keys', async (_e, op, arg) => {
  const cfg = readCfg();
  cfg.apiKeys = loadConfig().keys.filter((k) => k !== process.env.OPENROUTER_API_KEY);
  delete cfg.apiKey;
  if (op === 'add') {
    const k = String(arg || '').trim();
    if (!/^sk-or-v1-[0-9a-f]{64}$/.test(k)) throw new Error('That does not look like an OpenRouter key (sk-or-v1-…)');
    if (!cfg.apiKeys.includes(k)) cfg.apiKeys.push(k);
    writeCfg(cfg);
  } else if (op === 'remove' || op === 'up') {
    const i = cfg.apiKeys.findIndex((k) => keyId(k) === arg);
    if (i >= 0 && op === 'remove') cfg.apiKeys.splice(i, 1);
    if (i > 0 && op === 'up') [cfg.apiKeys[i - 1], cfg.apiKeys[i]] = [cfg.apiKeys[i], cfg.apiKeys[i - 1]];
    writeCfg(cfg);
  } else if (op === 'wake') {
    const r = db.getSetting('keyRest', {}); delete r[arg]; db.setSetting('keyRest', r);
  }
  const reasons = db.getSetting('keyReason', {});
  return Promise.all(loadConfig().keys.map(async (k) => {
    let usage = null;
    try {
      const d = (await (await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${k}` } })).json()).data;
      usage = d?.free_model_daily_requests ? { used: d.free_model_daily_requests.used, limit: d.free_model_daily_requests.limit } : null;
    } catch {}
    const until = restingUntil(k);
    return { id: keyId(k), masked: mask(k), usage, resting: until > Date.now() ? until : 0, reason: reasons[keyId(k)] || '' };
  }));
});

// ---- Stage 5: fast providers (OpenAI-compatible). Config, not hardcoded: put your own list in config.json under "providers".
// Endpoints/models checked against Groq and Cerebras docs on 2026-11-08; limits there are small, so prompts must stay short.
const DEFAULT_PROVIDERS = [
  { id: 'groq', url: 'https://api.groq.com/openai/v1/chat/completions', models: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'], env: 'GROQ_API_KEY', prefix: 'gsk_' },
  { id: 'cerebras', url: 'https://api.cerebras.ai/v1/chat/completions', models: ['gpt-oss-120b'], env: 'CEREBRAS_API_KEY', prefix: 'csk-' },
];
const providerDefs = () => { const c = readCfg(); return Array.isArray(c.providers) && c.providers.length ? c.providers : DEFAULT_PROVIDERS; };
// Providers that have at least one key (config.json providerKeys.<id>, or the env var).
function providerList() {
  const c = readCfg();
  return providerDefs().map((p) => ({ ...p, keys: [...new Set([...(c.providerKeys?.[p.id] || []), p.env && process.env[p.env]].filter(Boolean))] })).filter((p) => p.keys.length);
}
const provRest = new Map(); // "provider:keyId" -> ms until which it is skipped (rate limit / bad key)
async function callCompat(p, key, model, messages, { think, maxTokens, timeoutMs }) {
  const body = { model, messages, [p.tokensParam || 'max_completion_tokens']: maxTokens || (think ? 3000 : 1000), stream: false };
  if (/gpt-oss/i.test(model)) body.reasoning_effort = think ? 'medium' : 'low';
  const go = async (b) => {
    const res = await fetch(p.url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b), signal: AbortSignal.timeout(timeoutMs) });
    return { res, data: await res.json().catch(() => ({})) };
  };
  let r = await go(body);
  if (r.res.status === 400 && body.reasoning_effort && /reasoning/i.test(JSON.stringify(r.data))) { delete body.reasoning_effort; r = await go(body); }
  return r;
}
// First valid answer wins. Per-call timeout 5 s, then the next provider. null = none answered (caller falls back to OpenRouter).
async function tryProviders(messages, think, rec, opts) {
  const timeoutMs = opts.timeoutMs || 5000;
  const lanes = [];
  for (const p of providerList()) for (const key of p.keys) {
    if ((provRest.get(`${p.id}:${keyId(key)}`) || 0) > Date.now()) continue;
    for (const model of p.models.slice(0, opts.fast ? 1 : 2)) lanes.push({ p, key, model });
  }
  if (!lanes.length) return null;
  const one = async ({ p, key, model }) => {
    const at = Date.now();
    const note = (r) => rec.attempts.push({ provider: p.id, model, key: 0, ms: Date.now() - at, r });
    try {
      const { res, data } = await callCompat(p, key, model, messages, { think, maxTokens: opts.maxTokens, timeoutMs });
      const text = data.choices?.[0]?.message?.content;
      if (res.ok && text) { note('ok'); rec.provider = p.id; rec.model = model; rec.usage = data.usage || null; return text; }
      if (res.status === 429) provRest.set(`${p.id}:${keyId(key)}`, Date.now() + 60000);
      if ([401, 403].includes(res.status)) provRest.set(`${p.id}:${keyId(key)}`, Date.now() + 3600e3);
      note(res.ok ? 'empty' : `http ${res.status}`);
    } catch (err) { note(err.name === 'TimeoutError' ? 'timeout' : 'error'); }
    throw new Error('provider failed');
  };
  if (db.getSetting('raceProviders', false)) { // optional, default OFF: first provider to answer wins (costs more requests)
    const firsts = [...new Map(lanes.map((l) => [l.p.id, l])).values()];
    try { return await Promise.any(firsts.map(one)); } catch { return null; }
  }
  for (const lane of lanes.slice(0, 4)) { try { return await one(lane); } catch {} }
  return null;
}
// Settings > Keys: keys for the fast providers (masked in the page).
ipcMain.handle('pkeys', (_e, op, provider, arg) => {
  const cfg = readCfg();
  cfg.providerKeys = cfg.providerKeys || {};
  const defs = providerDefs();
  const def = defs.find((p) => p.id === provider);
  if (op === 'add' || op === 'remove') {
    if (!def) throw new Error('unknown provider');
    const list = cfg.providerKeys[provider] || [];
    if (op === 'add') {
      const k = String(arg || '').trim();
      if (k.length < 20 || /\s/.test(k) || (def.prefix && !k.startsWith(def.prefix))) throw new Error(`That does not look like a ${provider} key${def.prefix ? ` (${def.prefix}…)` : ''}`);
      if (!list.includes(k)) list.push(k);
    } else { const i = list.findIndex((k) => keyId(k) === arg); if (i >= 0) list.splice(i, 1); }
    cfg.providerKeys[provider] = list;
    writeCfg(cfg);
  }
  return defs.map((p) => ({ id: p.id, models: p.models, fromEnv: !!(p.env && process.env[p.env]), keys: (cfg.providerKeys[p.id] || []).map((k) => ({ id: keyId(k), masked: mask(k) })) }));
});

// Settings → models: free OpenRouter models, biggest first (size from the "550b"-style id, else context length).
ipcMain.handle('freeModels', async () => {
  const data = (await (await fetch('https://openrouter.ai/api/v1/models')).json()).data;
  const size = (id) => Number((id.match(/(\d+(?:\.\d+)?)b\b/i) || [])[1] || 0);
  return data.filter((m) => m.id.endsWith(':free'))
    .map((m) => ({ id: m.id, name: m.name, ctx: m.context_length, size: size(m.id) }))
    .sort((a, b) => b.size - a.size || b.ctx - a.ctx);
});

// Snapshot of the user's real folders so the AI can resolve "movie folder in videos" without searching.
ipcMain.handle('context', () => {
  const dirs = (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !/^[.$]/.test(d.name)).map((d) => d.name).slice(0, 40);
    } catch { return []; }
  };
  // Two levels deep, e.g. "KEVIN (PROJECTS, NOTES)", so nested folders resolve in one step.
  const tree = (dir) => dirs(dir).map((n) => {
    const kids = dirs(path.join(dir, n)).slice(0, 15);
    return kids.length ? `${n} (${kids.join(', ')})` : n;
  }).join(', ');
  const lines = ['home', 'desktop', 'documents', 'downloads', 'videos', 'pictures', 'music'].map((k) => {
    const p = app.getPath(k);
    return `${k}: ${p}\n  contains: ${(k === 'home' ? dirs(p).join(', ') : tree(p)) || '(none)'}`;
  });
  const drives = 'CDEFGHIJ'.split('').filter((d) => fs.existsSync(`${d}:\\`)).map((d) => `${d}:`).join(' ');
  return `User: ${os.userInfo().username} on ${os.hostname()}, ${new Date().toString()}\nDrives: ${drives}\n${lines.join('\n')}`;
});

// Key + model rotation. A daily-limit error ("free-models-per-day") is account-wide, so that key rests until 00:00 UTC and the
// next key takes over. A busy/rate-limited model (or provider hiccup) is NOT the key's fault: try the next model on the same key
// first, then the next key, and only report a limit when every key and model has been tried.
const DAILY = /per-day|daily|credits|quota|insufficient|limit exceeded.*day/i;
const BAD_KEY = /user not found|invalid|no auth|disabled|banned/i;
let lastGood = { key: 0, model: 0 };

// ---- Stage 1: timing. Main-side numbers (model attempts, .bat start-up) wait here per window until the renderer
// finishes the command and sends its own numbers; both go out as ONE JSON line in %APPDATA%\Executor\timing.log.
const tpend = new Map(); // webContents id -> { ai: [], run: [] }
const tp = (id) => { let t = tpend.get(id); if (!t) tpend.set(id, t = { ai: [], run: [] }); return t; };
const timingFile = () => path.join(app.getPath('userData'), 'timing.log');
ipcMain.handle('timing', (e, op, rec) => {
  const id = e.sender.id;
  if (op === 'start') { tpend.delete(id); return true; }
  const m = tpend.get(id) || { ai: [], run: [] };
  tpend.delete(id);
  const sum = (arr, k) => Math.round(arr.reduce((n, x) => n + (x[k] || 0), 0));
  const stages = { ...(rec?.stages || {}) };
  if (m.ai.length) stages.modelNet = sum(m.ai, 'ms');       // time inside main for the model calls (network + key/model switching)
  if (m.run.length) {
    stages.batWrite = sum(m.run, 'writeMs');                 // writing the temp .bat
    stages.procExit = sum(m.run, 'exitMs');                  // cmd.exe start-up + the command itself, until it exits
    stages.exitGrace = sum(m.run, 'graceMs');                // fixed wait after exit for late output
  }
  const extra = {}; for (const k of ['mode', 'action', 'provider', 'script', 'result', 'asked', 'fails', 'cached']) if (rec?.[k] !== undefined) extra[k] = rec[k];
  const line = { ...extra, ts: new Date().toISOString(), text: String(rec?.text || '').slice(0, 200), route: rec?.route || 'old', ok: !!rec?.ok, modelCalls: rec?.modelCalls ?? m.ai.length, steps: rec?.steps ?? 0, totalMs: rec?.totalMs ?? 0, stages, ai: m.ai, runs: m.run };
  try {
    const f = timingFile();
    try { if (fs.statSync(f).size > 5_000_000) fs.renameSync(f, f.replace(/\.log$/, '.old.log')); } catch {}
    fs.appendFileSync(f, JSON.stringify(line) + '\n');
  } catch (err) { dlog('timing write failed', err.message); }
  return true;
});

const aiHandler = async (e, messages, think, rec, opts = {}) => {
  // Speed mode: try the fast providers first (short prompts only: their free limits are small), then fall back to OpenRouter below.
  if (opts.fast || (db.getSetting('speedMode', 'old') === 'new' && rec.promptChars < 18000)) {
    const fast = await tryProviders(messages, think, rec, opts);
    if (fast != null) return fast;
  }
  const { keys, models: cfgModels } = loadConfig();
  if (!keys.length) throw new Error('No API key. Add one in Settings → keys.');
  const usable = keys.map((k, n) => ({ k, n: n + 1 })).filter(({ k }) => restingUntil(k) < Date.now());
  if (!usable.length) throw new Error(`All ${keys.length} API keys hit their daily limit. They reset at 00:00 UTC, or add another key in Settings → keys.`);
  const models = [...new Set([...cfgModels, ...DEFAULT_MODELS])];
  const say = (t) => { try { e.sender.send('ai-progress', t); } catch {} };
  // Start from the combination that worked last time.
  const kOrder = [...usable.slice(lastGood.key % usable.length), ...usable.slice(0, lastGood.key % usable.length)];
  const mOrder = [...models.slice(lastGood.model % models.length), ...models.slice(0, lastGood.model % models.length)];
  let lastErr = '';
  let transient = false;
  let tries = 0;
  for (const { k, n } of kOrder) {
    if (opts.fast && tries >= 2) break; // router calls: at most 2 OpenRouter attempts, the target is seconds not minutes
    let keyDead = false;
    for (const model of mOrder) {
      if (keyDead) break;
      if (opts.fast && tries++ >= 2) break;
      say(`${model.split('/').pop().replace(/:free$/, '')} · key ${n}/${keys.length}`);
      let res, data;
      const at = Date.now();
      try {
        res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
          // No response_format: Nemotron Ultra doesn't support it; the renderer extracts the {...} from the reply instead.
          body: JSON.stringify({ model, messages, max_tokens: opts.maxTokens || (think ? 3000 : 1000), reasoning: { enabled: !!think } }),
          signal: AbortSignal.timeout(opts.fast ? 8000 : think ? 90000 : 60000),
        });
        data = await res.json().catch(() => ({}));
      } catch (err) { rec.attempts.push({ model, key: n, ms: Date.now() - at, r: err.name === 'TimeoutError' ? 'timeout' : 'error' }); lastErr = `${model}: ${err.name === 'TimeoutError' ? 'timed out' : err.message}`; transient = true; say('slow, switching model…'); continue; }
      if (res.ok && data.choices?.[0]?.message?.content) {
        rec.attempts.push({ model, key: n, ms: Date.now() - at, r: 'ok' });
        rec.model = model; rec.usage = data.usage || null;
        lastGood = { key: usable.findIndex((u) => u.k === k), model: models.indexOf(model) };
        return data.choices[0].message.content;
      }
      lastErr = data.error?.message || `HTTP ${res.status}`;
      rec.attempts.push({ model, key: n, ms: Date.now() - at, r: res.ok ? 'empty' : `http ${res.status}` });
      if ([401, 402, 403].includes(res.status) || BAD_KEY.test(lastErr) || (res.status === 429 && DAILY.test(lastErr))) {
        rest(k, lastErr.slice(0, 120));
        notify('problem', `API key ${mask(k)} is used up for today (${lastErr.slice(0, 60)}). Switched to the next key.`);
        say(`key ${n} used up, switching key…`);
        keyDead = true;
      } else { transient = true; say('model busy, switching model…'); } // 429 w/o daily wording, 5xx, empty reply
    }
  }
  const left = keys.filter((k) => restingUntil(k) < Date.now()).length;
  throw new Error(left ? `Every model is busy right now (${lastErr.slice(0, 80)}). Try again in a minute.` : `All ${keys.length} API keys hit their daily limit. They reset at 00:00 UTC, or add another key in Settings → keys.`);
};
ipcMain.handle('ai', async (e, messages, think, opts) => {
  const rec = { provider: 'openrouter', think: !!think, promptChars: JSON.stringify(messages).length, attempts: [], model: null, usage: null, ms: 0, ok: false };
  const t = Date.now();
  try { const out = await aiHandler(e, messages, think, rec, opts || {}); rec.ok = true; rec.outChars = String(out).length; return out; }
  finally { rec.ms = Date.now() - t; rec.keySwitches = new Set(rec.attempts.map((a) => a.key)).size - 1; try { tp(e.sender.id).ai.push(rec); } catch {} }
});

// Internet for agents: web search (DuckDuckGo lite, no key) and reading a page as plain text.
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36' };
const unhtml = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
// Web: ONE call does the whole job. A search also reads the top pages in parallel (short timeouts) and results are cached
// for 10 minutes, so the AI usually needs a single request instead of search → read → read.
const webCache = new Map();
const cached = (key, make) => {
  const hit = webCache.get(key);
  if (hit && Date.now() - hit.t < 600000) return hit.p;
  const p = make();
  webCache.set(key, { t: Date.now(), p });
  p.catch(() => webCache.delete(key));
  if (webCache.size > 40) webCache.delete(webCache.keys().next().value);
  return p;
};
async function readPage(href, max = 3500, ms = 6000) {
  const url = new URL(href);
  if (!/^https?:$/.test(url.protocol)) throw new Error('only http(s) pages can be read');
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms), redirect: 'follow' });
  const html = (await res.text()).slice(0, 900_000);
  const title = unhtml((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const text = unhtml(html.replace(/<(script|style|noscript|svg|head|nav|footer|header)[\s\S]*?<\/\1>/gi, ' '));
  return { status: res.status, url: res.url, title, text: text.slice(0, max) };
}
async function ddg(q) {
  const parse = (html, lite) => {
    if (lite) {
      const links = [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*class='result-link'>([\s\S]*?)<\/a>/g)];
      const snips = [...html.matchAll(/result-snippet'>([\s\S]*?)<\/td>/g)].map((m) => unhtml(m[1]));
      return links.map((m, i) => ({ title: unhtml(m[2]), url: m[1], snippet: snips[i] || '' }));
    }
    const links = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
    const snips = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => unhtml(m[1]));
    return links.map((m, i) => ({ title: unhtml(m[2]), url: m[1], snippet: snips[i] || '' }));
  };
  const real = (r) => { const u = r.url.match(/uddg=([^&]+)/); return { ...r, url: u ? decodeURIComponent(u[1]) : r.url }; };
  const ask = async (url, lite) => parse(await (await fetch(url, { headers: UA, signal: AbortSignal.timeout(7000) })).text(), lite).map(real).filter((r) => /^https?:/.test(r.url));
  // Both endpoints at once: the first one with results wins (no waiting for a slow one to fail first).
  const tries = [ask(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, true), ask(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, false)];
  const settled = await Promise.race([
    Promise.any(tries.map((t) => t.then((r) => (r.length ? r : Promise.reject(new Error('empty')))))),
    new Promise((res) => setTimeout(() => res([]), 8000)),
  ]).catch(() => []);
  return settled;
}
ipcMain.handle('web', (_e, kind, q) => cached(`${kind}:${q}`, async () => {
  if (kind === 'search') {
    const results = (await ddg(q)).filter((r, i, a) => a.findIndex((x) => new URL(x.url).hostname === new URL(r.url).hostname) === i).slice(0, 6);
    // Read the top 2 pages in parallel so the AI can answer straight away.
    const pages = (await Promise.allSettled(results.slice(0, 2).map((r) => readPage(r.url, 2800, 5000)))).filter((p) => p.status === 'fulfilled' && p.value.text.length > 200).map((p) => p.value);
    return { results, pages };
  }
  return readPage(q, 6000, 8000);
}));

// Agents write scripts/code here; refuses to overwrite unless force (renderer asks the user first).
ipcMain.handle('write', (_e, file, content, force) => {
  const full = path.resolve(os.homedir(), file.replace(/%(\w+)%/g, (m, v) => process.env[v] ?? m));
  if (fs.existsSync(full) && !force) return { exists: true, full };
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return { full };
});

ipcMain.on('win', (e, action) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (action === 'close') w.close();
  else if (action === 'min') w.minimize();
  else if (action === 'max') toggleMax(w);
});
// Transparent windows must not be OS-resizable (Electron: "setting resizable to true may break transparency"), so the
// OS never sees a resizable window. Maximize/restore and edge-dragging are done by hand with setBounds.
function toggleMax(w) {
  if (w.userMax) {
    w.setBounds(w.userMax); w.userMax = null; w.webContents.send('maxed', false);
  } else {
    w.userMax = w.getBounds();
    w.setBounds(screen.getDisplayMatching(w.userMax).workArea);
    w.webContents.send('maxed', true);
  }
}

ipcMain.handle('winBounds', (e) => BrowserWindow.fromWebContents(e.sender).getBounds());
ipcMain.on('setWinBounds', (e, b) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w || w.userMax) return;
  w.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: Math.max(360, Math.round(b.width)), height: Math.max(220, Math.round(b.height)) });
});

const MAX_OUT = 8000;
// Run a .bat with stdin = NUL so `pause` / `set /p` return immediately instead of hanging until the timeout.
function runFile(file, temp, tm = {}) {
  return new Promise((resolve) => {
    const s0 = Date.now();
    const p = spawn('cmd.exe', ['/c', file], { cwd: os.homedir(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const add = (d) => { if (out.length < MAX_OUT) out += d.toString(); };
    p.stdout.on('data', add);
    p.stderr.on('data', add);
    let finished = false;
    const finish = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (temp) fs.rm(file, () => {});
      try { p.stdout.destroy(); p.stderr.destroy(); } catch {}
      tm.totalMs = Date.now() - s0; tm.graceMs = tm.exitMs != null ? tm.totalMs - tm.exitMs : 0;
      resolve({ code, out: out.slice(0, MAX_OUT) });
    };
    const timer = setTimeout(() => {
      out += '\n[killed after 60s: too slow or waiting for something. Use a narrower search, or start "" it in its own window.]';
      spawn('taskkill', ['/pid', p.pid, '/t', '/f']);
    }, 60000);
    // A GUI app started with `start` keeps the output pipes open until it quits, so 'close' never fires.
    // The batch itself is done at 'exit': wait a moment for last output, then return.
    p.on('exit', (code) => { tm.exitMs = Date.now() - s0; setTimeout(() => finish(code), 350); });
    p.on('close', (code) => finish(code));
  });
}
ipcMain.handle('run', async (e, cmd) => {
  const w0 = Date.now();
  const file = path.join(os.tmpdir(), `exec-${Date.now()}-${Math.random().toString(36).slice(2)}.bat`);
  fs.writeFileSync(file, `@echo off\r\nchcp 65001 >nul\r\n${batSafe(cmd).replace(/\r?\n/g, '\r\n')}\r\n`);
  const tm = { writeMs: Date.now() - w0 };
  const r = await runFile(file, true, tm);
  try { tp(e.sender.id).run.push({ cmd: cmd.slice(0, 80), ...tm }); } catch {}
  return r;
});
const expandEnv = (p) => String(p || '').replace(/%([^%]+)%/g, (m, n) => process.env[n] || m);
// Open a file/folder/URL with the default app; returns '' on success, else the error text.
ipcMain.handle('openPath', async (_e, p) => {
  p = expandEnv(p);
  if (/^https?:\/\//i.test(p)) { await shell.openExternal(p); return ''; }
  return shell.openPath(p);
});
// Fuzzy file finder: typo-tolerant ("freegut" finds "Free.Guy..."), bounded in depth, entries and time.
const normName = (t) => t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
// Best approximate substring match (Sellers): 1 = contained, lower = more edits.
function fuzzyScore(query, base) {
  const n = normName(query), t = normName(base);
  if (!n || !t) return 0;
  if (t.includes(n)) return 1;
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => t.includes(w))) return 0.95;
  let prev = new Array(t.length + 1).fill(0), best = n.length;
  for (let i = 1; i <= n.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (n[i - 1] === t[j - 1] ? 0 : 1));
    prev = cur;
  }
  best = Math.min(...prev);
  return Math.max(0, 1 - best / n.length);
}
const FIND_SKIP = /^(node_modules|appdata|\.git|\$recycle\.bin|system volume information|crossdevice|windows|program files|program files \(x86\))$/i;
const EP_Q = /\b(?:episode|ep|e)\s*0*(\d{1,3})\b/i;
const STOP = /^(the|in|of|a|an|file|folder|season|episode|ep|video|movie|please|my)$/;
// "mouse trap episode 3" matches Mousetrap.S01E03.mkv inside a folder called "mouse trap": words may match folder names,
// and episode numbers match S01E03 / E03 / ep3 / 1x03.
function pathScore(query, parts, base) {
  const m = EP_Q.exec(query);
  if (m && !new RegExp(`(?:e|ep|episode|x)[ ._-]?0*${+m[1]}(?!\\d)`, 'i').test(base)) return 0;
  const q = m ? query.replace(EP_Q, ' ') : query;
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.test(w));
  if (!words.length) return m ? 0.9 : 0;
  const hay = normName(`${parts.join(' ')} ${base}`);
  return words.every((w) => hay.includes(w)) ? 0.92 : 0;
}
const findFiles = async ({ name, in: dir, kind = 'any', ext } = {}) => {
  const envPath = (p) => path.resolve(os.homedir(), String(p).replace(/%(\w+)%/g, (m, v) => process.env[v] ?? m));
  const home = os.homedir();
  const roots = dir ? [envPath(dir)] : [...new Set(['documents', 'desktop', 'downloads', 'videos', 'pictures', 'music'].map((k) => app.getPath(k))
    .concat([path.join(home, 'OneDrive'), home]))].filter((r) => fs.existsSync(r));
  const end = Date.now() + 8000;
  const found = [];
  let seen = 0;
  const wantExt = new Set(String(ext || '').toLowerCase().split(/[\s,;|]+/).map((x) => x.replace(/^\./, '')).filter(Boolean));
  const queue = roots.map((r) => [r, 0, []]);
  const visited = new Set();
  while (queue.length && Date.now() < end && seen < 60000) {
    const [d, depth, parts] = queue.shift();
    if (visited.has(d.toLowerCase())) continue;
    visited.add(d.toLowerCase());
    let ents;
    try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      seen++;
      if (e.name.startsWith('.') || FIND_SKIP.test(e.name)) continue;
      const full = path.join(d, e.name);
      const isDir = e.isDirectory();
      if (isDir && depth < 6) queue.push([full, depth + 1, [...parts, e.name]]);
      if ((kind === 'file' && isDir) || (kind === 'dir' && !isDir)) continue;
      if (wantExt.size && (isDir || !wantExt.has(path.extname(e.name).slice(1).toLowerCase()))) continue;
      const base = isDir ? e.name : path.parse(e.name).name;
      let sc = fuzzyScore(name, base);
      if (!isDir) sc = Math.max(sc, pathScore(name, parts.slice(-3), base));
      if (sc >= 0.6) found.push({ path: full, score: Math.round(sc * 100) / 100, dir: isDir });
    }
  }
  found.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  // The same file reached through two roots (OneDrive inside home) counts once.
  const uniq = [...new Map(found.map((f) => [f.path.toLowerCase(), f])).values()];
  return { matches: uniq.slice(0, 8), scanned: seen, partial: Date.now() >= end };
};
ipcMain.handle('find', (_e, o) => findFiles(o));
// Deleting goes to the Recycle Bin so it can be undone; "restore" brings items back by (part of) name or original path.
ipcMain.handle('trash', async (_e, list) => {
  const out = [];
  for (const raw of [].concat(list || []).slice(0, 200)) {
    const p = path.resolve(os.homedir(), expandEnv(raw));
    try { await shell.trashItem(p); out.push({ path: p, ok: true }); } catch (e) { out.push({ path: p, ok: false, error: /not found|ENOENT|cannot find/i.test(e.message) ? 'not found' : e.message }); }
  }
  return out;
});
ipcMain.handle('restoreTrash', (_e, query) => new Promise((resolve) => {
  const ps = '$q=$env:GQ; $s=New-Object -ComObject Shell.Application; $b=$s.Namespace(10); $n=0; $names=@(); foreach($i in @($b.Items())){ $o=$b.GetDetailsOf($i,1); $full=Join-Path $o $i.Name; if(($full -like "*$q*") -or ($i.Name -like "*$q*")){ foreach($v in $i.Verbs()){ if($v.Name -match "estore|ndelete"){ $v.DoIt(); $n++; $names+=$full; break } } } }; Write-Output "restored $n"; $names';
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, env: { ...process.env, GQ: String(query || '') } });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.on('error', () => resolve({ ok: false, text: 'could not run PowerShell' }));
  p.on('close', () => { const m = /restored (\d+)/.exec(out); resolve({ ok: !!m && +m[1] > 0, text: out.trim().slice(0, 600) }); });
  setTimeout(() => { try { p.kill(); } catch {} }, 20000);
}));
// After many failures the renderer asks for a different brain: move the starting model one step along.
ipcMain.handle('switchModel', () => { lastGood = { ...lastGood, model: lastGood.model + 1 }; return true; });
// Find an installed app by name (Start Menu shortcuts first, then Program Files) and start it, optionally with a file.
function resolveApp(name) {
  const want = normName(name);
  if (!want) return null;
  const cands = [];
  const bad = /unins|uninstall|setup|update|crash|helper|repair|readme/i;
  const walk = (root, maxDepth, fn) => {
    const stack = [[root, 0]];
    while (stack.length) {
      const [d, dep] = stack.pop();
      let ents;
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) { if (dep < maxDepth) stack.push([f, dep + 1]); } else fn(f, e.name);
      }
    }
  };
  const pd = process.env.ProgramData || 'C:\\ProgramData';
  for (const r of [path.join(pd, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')]) {
    walk(r, 3, (f, n) => {
      if (!/\.lnk$/i.test(n) || bad.test(n)) return;
      const base = normName(n.replace(/\.lnk$/i, ''));
      if (!(base.includes(want) || (base.length > 3 && want.includes(base)))) return;
      try { const t = shell.readShortcutLink(f).target; if (t && /\.exe$/i.test(t) && fs.existsSync(t)) cands.push({ p: t, s: base === want ? 3 : 2 }); } catch {}
    });
  }
  if (!cands.length) {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], path.join(process.env.LOCALAPPDATA || '', 'Programs'), process.env.LOCALAPPDATA].filter(Boolean);
    for (const r of roots) walk(r, 3, (f, n) => { if (/\.exe$/i.test(n) && !bad.test(n) && normName(n.replace(/\.exe$/i, '')).includes(want)) cands.push({ p: f, s: 1 }); });
  }
  cands.sort((a, b) => b.s - a.s || a.p.length - b.p.length);
  return cands[0]?.p || null;
}
ipcMain.handle('launchApp', (_e, name, file) => {
  const exe = resolveApp(name);
  if (!exe) return { ok: false };
  try {
    const c = spawn(exe, file ? [expandEnv(file)] : [], { detached: true, stdio: 'ignore', cwd: path.dirname(exe) });
    c.on('error', () => {});
    c.unref();
    return { ok: true, exe };
  } catch (e) { return { ok: false, error: e.message }; }
});
// Rerun a saved task's .bat directly (no AI).
ipcMain.handle('runBat', (_e, id) => {
  syncBats();
  const m = db.listMemory().find((r) => r.id === id);
  if (!m) return { code: 1, out: 'saved .bat not found' };
  return runFile(path.join(batsDir(), batName(m)), false);
});

// ======================= Stages 3-9: the fast path (native actions, registry, path index, providers, scripts) =======================
const userDir = () => app.getPath('userData');
const homeDirs = () => ['documents', 'desktop', 'downloads', 'videos', 'pictures', 'music'].map((k) => app.getPath(k));
// my_paths.json (in the Executor folder): { "pins": [{ "name": "movies", "path": "D:\\Movies" }], "roots": ["D:\\Movies"], "allowedFolders": [] }
const myPaths = () => {
  try { const j = JSON.parse(fs.readFileSync(path.join(userDir(), 'my_paths.json'), 'utf8')); return { pins: j.pins || [], roots: j.roots || [], allowed: j.allowedFolders || [] }; } catch { return { pins: [], roots: [], allowed: [] }; }
};
// Where file actions and AI scripts may touch things. Change with the "allowedFolders" setting or my_paths.json.
const allowedFolders = () => [...(db.getSetting('allowedFolders', null) || [...homeDirs(), path.join(os.homedir(), 'OneDrive')]), ...myPaths().roots, ...myPaths().allowed];
const launchRoots = () => [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], path.join(process.env.LOCALAPPDATA || '', 'Programs'), process.env.windir].filter(Boolean);
const scriptEnv = () => ({ USERPROFILE: os.homedir(), APPDATA: app.getPath('appData'), LOCALAPPDATA: process.env.LOCALAPPDATA || '', TEMP: os.tmpdir(), DESKTOP: app.getPath('desktop') });

// ---- path index (Stage 8)
let pindex = new PathIndex();
let indexBusy = false;
function scanApps() {
  const out = new Map();
  const bad = /unins|uninstall|setup|update|crash|helper|repair|readme/i;
  const pd = process.env.ProgramData || 'C:\\ProgramData';
  const stack = [path.join(pd, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')].map((r) => [r, 0]);
  while (stack.length) {
    const [d, dep] = stack.pop();
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (dep < 3) stack.push([f, dep + 1]); continue; }
      if (!/\.lnk$/i.test(e.name) || bad.test(e.name)) continue;
      try { const t = shell.readShortcutLink(f).target; if (t && /\.exe$/i.test(t) && fs.existsSync(t)) out.set(t.toLowerCase(), { name: e.name.replace(/\.lnk$/i, ''), path: t }); } catch {}
    }
  }
  return [...out.values()];
}
const scanSystem = () => {
  const dir = path.join(process.env.windir || 'C:\\Windows', 'System32');
  try { return fs.readdirSync(dir).filter((n) => /\.exe$/i.test(n)).map((n) => ({ n, l: n.toLowerCase(), p: path.join(dir, n), e: 'exe', t: 'file' })); } catch { return []; }
};
async function startIndex(force) {
  if (indexBusy) return;
  indexBusy = true;
  try {
    const file = path.join(userDir(), 'path-index.json');
    if (!pindex.ready && fs.existsSync(file)) { try { pindex = PathIndex.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch {} }
    const mp = myPaths();
    pindex.setPins(mp.pins);
    if (!force && pindex.ready && Date.now() - pindex.scannedAt < 6 * 3600e3) return;
    pindex.setApps(scanApps());
    pindex.setSystem(scanSystem());
    const roots = [...new Set([...homeDirs(), path.join(os.homedir(), 'OneDrive'), ...mp.roots])].filter((r) => fs.existsSync(r));
    await pindex.scan(roots, fs.promises);
    fs.writeFileSync(file, JSON.stringify(pindex.toJSON()));
    dlog('path index ready:', pindex.count, 'entries');
  } catch (e) { dlog('path index failed', e?.message); } finally { indexBusy = false; }
}
// Index first (a few ms); the live folder walk only when the index is missing or knows nothing.
async function findSmart(opts = {}) {
  if (!opts.in && pindex.ready && opts.name) {
    const t = Date.now();
    const matches = pindex.lookup(opts.name, { kind: opts.kind, ext: opts.ext, exists: fs.existsSync }).slice(0, 8).map((m) => ({ path: m.path, score: m.score, dir: m.dir }));
    if (matches.length) return { matches, scanned: 0, partial: false, fromIndex: true, ms: Date.now() - t };
  }
  return findFiles(opts);
}
const resolveAppFast = (name) => (pindex.ready && pindex.app(name, fs.existsSync)) || resolveApp(name);

// ---- PowerShell runner (templates and AI scripts)
function runPowerShell(script, ms = 30000) {
  return new Promise((resolve) => {
    const file = path.join(os.tmpdir(), `genisys-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`);
    fs.writeFileSync(file, '\ufeff' + script);
    const t0 = Date.now();
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { cwd: os.homedir(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const add = (d) => { if (out.length < MAX_OUT) out += d.toString(); };
    p.stdout.on('data', add); p.stderr.on('data', add);
    let done = false;
    const fin = (code) => { if (done) return; done = true; clearTimeout(timer); fs.rm(file, () => {}); resolve({ code, out: out.slice(0, MAX_OUT), ms: Date.now() - t0 }); };
    const timer = setTimeout(() => { out += '\n[killed: too slow]'; spawn('taskkill', ['/pid', p.pid, '/t', '/f']); }, ms);
    p.on('error', () => fin(1));
    p.on('close', (c) => fin(c));
  });
}

// ---- the action registry (Stage 7): actions/<name>/ folders, loaded once
const ACTIONS_DIR = app.isPackaged ? path.join(process.resourcesPath, 'actions') : path.join(__dirname, '../../actions');
let fastState;
function getFast() {
  if (fastState) return fastState;
  const reg = loadActions(fs, ACTIONS_DIR);
  if (reg.bad) dlog('actions skipped:', reg.bad.join(' | '));
  dlog('actions loaded:', [...reg.keys()].join(', ') || '(none)', 'from', ACTIONS_DIR);
  const paths = { home: os.homedir(), ...Object.fromEntries(['downloads', 'documents', 'desktop', 'pictures', 'videos', 'music'].map((k) => [k, app.getPath(k)])) };
  const A = makeActions({
    shell: { openPath: (p) => shell.openPath(p), openExternal: (u) => shell.openExternal(u) },
    resolveApp: resolveAppFast,
    spawnDetached: (exe, args) => { const c = spawn(exe, args, { detached: true, stdio: 'ignore', cwd: path.dirname(exe) }); c.on('error', () => {}); c.unref(); },
    findFiles: findSmart,
    paths,
    exists: (p) => fs.existsSync(p),
    isAllowed: (p) => isInside(p, allowedFolders()),
    mkdirp: (p) => fs.mkdirSync(p, { recursive: true }),
    writeFile: (p, c) => fs.writeFileSync(p, c),
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    listDir: (p) => fs.readdirSync(p, { withFileTypes: true }).map((e) => (e.isDirectory() ? `${e.name}\\` : e.name)),
    copy: (a, b) => fs.cpSync(a, b, { recursive: true, errorOnExist: true, force: false }),
    move: (a, b) => fs.renameSync(a, b),
    trash: (p) => shell.trashItem(p),
  });
  return (fastState = { reg, A, paths });
}
async function runTemplate(spec, params, confirmed) {
  const script = fillTemplate(spec.templateText, params, spec);
  if (spec.destructive && !confirmed) return { status: 'confirm', preview: script };
  const r = await runPowerShell(script, 20000);
  return r.code === 0 ? { status: 'done', message: r.out.trim() || 'done' } : { status: 'fall', reason: (r.out.trim() || `exit ${r.code}`).slice(0, 200) };
}
const boolsToText = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, typeof v === 'boolean' ? String(v) : v]));
// One entry point for every action: params are validated HERE (the page is not trusted), destructive ones need confirmed=true.
ipcMain.handle('fast', async (_e, action, params, confirmed) => {
  const t = Date.now();
  try {
    const { reg, A } = getFast();
    const spec = reg.get(action);
    if (!spec) return { status: 'fall', reason: `unknown action ${action}` };
    const v = validateParams(spec, boolsToText(params), { isAllowed: (p) => isInside(p, allowedFolders()) });
    if (!v.ok) return { status: 'fall', reason: v.error };
    const r = spec.template ? await runTemplate(spec, v.params, !!confirmed) : await A[spec.native](v.params, !!confirmed);
    return { ...r, ms: Date.now() - t };
  } catch (e) { return { status: 'fall', reason: e.message, ms: Date.now() - t }; }
});
// Is a cached {action, params} still safe and valid? (path still exists, action still known, not destructive)
ipcMain.handle('fastValid', (_e, action, params) => {
  try {
    const spec = getFast().reg.get(action);
    if (!spec || spec.destructive) return false;
    const v = validateParams(spec, boolsToText(params), {});
    return v.ok && (action !== 'open_path' || fs.existsSync(v.params.path));
  } catch { return false; }
});
// What the page needs to build the router prompt and check its answer.
ipcMain.handle('fastSpecs', () => {
  const { reg, paths } = getFast();
  const specs = [...reg.values()].map(({ templateText, prompt, ...s }) => s);
  return { specs, lines: routerLines(reg), folders: Object.entries(paths).map(([k, v]) => `${k}=${v}`).join(' ; '), env: scriptEnv() };
});

// ---- AI-written scripts (Stage 9): checked again here, always confirmed, always logged
const scriptCheckNow = (script) => checkScript(script, { allowed: allowedFolders(), launchRoots: launchRoots(), exists: fs.existsSync, env: scriptEnv() });
ipcMain.handle('scriptCheck', (_e, script) => scriptCheckNow(String(script || '')));
ipcMain.handle('scriptRun', async (_e, script, confirmed, command) => {
  script = String(script || '');
  const check = scriptCheckNow(script);
  if (check.level === 'block') return { status: 'blocked', check };
  if (!confirmed) return { status: 'confirm', check };
  const r = await runPowerShell(script, 30000);
  try { db.scriptRecord(hashScript(script), String(command || '').slice(0, 300), script, r.code === 0); } catch {}
  return { status: r.code === 0 ? 'done' : 'failed', code: r.code, out: r.out, ms: r.ms, check };
});

// ---- Settings helpers
ipcMain.handle('indexInfo', () => ({ ready: pindex.ready, count: pindex.count, scannedAt: pindex.scannedAt, busy: indexBusy }));
ipcMain.handle('indexRescan', () => { startIndex(true); return true; });
ipcMain.handle('indexContext', (_e, command) => pindex.ready ? pindex.contextFor(command, { exists: fs.existsSync }) : {});
ipcMain.handle('similarPrompt', (_e, command) => similarPrompt(getFast().reg, command));
ipcMain.handle('openMyPaths', () => {
  const f = path.join(userDir(), 'my_paths.json');
  if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify({ pins: [{ name: 'example movies', path: 'D:\\Movies' }], roots: [], allowedFolders: [] }, null, 2));
  return shell.openPath(f);
});
ipcMain.handle('speedStats', () => {
  const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
  return formatStats(parseLog(read(timingFile().replace(/\.log$/, '.old.log')) + read(timingFile())));
});

// One window per agent; the main window is a launcher that lists them (id → {id, kind, title, st}).
let mainWin;
let nextId = 1;
const agents = new Map();
const wins = new Map();
const pushAgents = () => mainWin?.webContents.send('agents', [...agents.values()]);

// Small "hacker film" windows that tile across the screen; a closed window frees its slot for the next one.
const SIZES = { main: [1100, 760], agent: [614, 326], script: [614, 326], runner: [740, 96] };
const usedSlots = new Set();
function placeTile(w, h) {
  const wa = screen.getPrimaryDisplay().workArea;
  const cols = Math.max(1, Math.floor(wa.width / w));
  const rows = Math.max(1, Math.floor(wa.height / h));
  let slot = 0;
  while (usedSlots.has(slot)) slot++;
  usedSlots.add(slot);
  const s = slot % (cols * rows); // past a full screen, start overlapping from the top again
  return { slot, x: wa.x + wa.width - (s % cols + 1) * w, y: wa.y + Math.floor(s / cols) * h };
}

// Show a window only when its page says it has laid itself out (IPC 'pageReady' from app.js, after two animation frames).
// A fallback timer shows it anyway after ~600 ms so it can never stay hidden.
const pageReadyCbs = new Map(); // webContents id -> show()
function showWhenReady(win, show, ms = 600) {
  const wid = win.webContents.id;
  let done = false;
  const go = () => { clearTimeout(timer); pageReadyCbs.delete(wid); if (done || win.isDestroyed()) return; done = true; show(); };
  const timer = setTimeout(go, ms);
  pageReadyCbs.set(wid, go);
  win.once('closed', () => { clearTimeout(timer); pageReadyCbs.delete(wid); });
}
ipcMain.on('pageReady', (e) => pageReadyCbs.get(e.sender.id)?.());

const createWindow = (query, pos = {}) => {
  const [width, height] = SIZES[query.mode];
  const win = new BrowserWindow({
    width,
    height,
    ...pos,
    // Windows 11 acrylic: the page's semi-transparent edge shows the blurred desktop (macOS-style glass).
    // Transparent + frameless: the page draws its own rounded corners (CSS) and resize grips.
    // Native rounding: an opaque frameless window gets real rounded corners from Windows 11 itself (DWM), the proven way.
    // (Transparent windows can silently turn into a sharp square on some Windows builds.)
    transparent: false,
    resizable: true,
    roundedCorners: true,
    backgroundColor: '#1b1917',
    hasShadow: true,
    icon: path.join(ASSETS, 'icon.png'),
    show: false, // shown by showWhenReady below (an --autostart main window stays hidden)
    // Frameless: our own red/yellow/green dots in #bar replace Windows' min/max/close.
    frame: false,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  const qs = new URLSearchParams({ ...query, nat: 1 }).toString();
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) win.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}?${qs}`);
  else win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), { query: { ...query, nat: 1 } });
  if (!(query.mode === 'main' && process.argv.includes('--autostart'))) showWhenReady(win, () => win.show());
  return win;
};

// Alt+Space runner: a small glass bar, bottom center, 100px above the taskbar. Exists only while shown (0 RAM idle).
let runnerWin = null;
function toggleRunner() {
  if (runnerWin) { runnerWin.close(); return; }
  const wa = screen.getPrimaryDisplay().workArea;
  const [w, h] = SIZES.runner;
  runnerWin = new BrowserWindow({
    width: w, height: h, x: Math.round(wa.x + (wa.width - w) / 2), y: wa.y + wa.height - 100 - h,
    frame: false, transparent: true, hasShadow: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false,
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  const query = { mode: 'runner', id: 0, title: '~/runner' };
  const qs = new URLSearchParams(query).toString();
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) runnerWin.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}?${qs}`);
  else runnerWin.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), { query });
  // Above everything: other topmost windows, full-screen apps and the taskbar.
  runnerWin.setAlwaysOnTop(true, 'screen-saver');
  runnerWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  showWhenReady(runnerWin, () => { runnerWin?.show(); runnerWin?.moveTop(); runnerWin?.focus(); });
  runnerWin.on('show', () => runnerWin?.moveTop());
  runnerWin.pinned = false; // once a task is sent the panel stays open until Esc / ✕
  runnerWin.on('blur', () => { if (runnerWin && !runnerWin.pinned) runnerWin.close(); });
  runnerWin.on('closed', () => { runnerWin = null; });
}
ipcMain.on('hideRunner', () => runnerWin?.close());
// A task was sent: grow upward into a full results panel (bottom edge stays put, always fully on screen).
ipcMain.on('runnerOpen', () => {
  if (!runnerWin) return;
  runnerWin.pinned = true;
  const wa = screen.getPrimaryDisplay().workArea;
  const b = runnerWin.getBounds();
  const h = Math.min(520, wa.height - 130);
  runnerWin.setBounds({ ...b, y: b.y + b.height - h, height: h });
});

// Floating plan widget (bottom-right corner of the screen). Created on demand, never steals focus, gone when the task ends.
let todoWin = null, todoState = null, todoTimer = 0, todoHidden = null;
function showTodo(st) {
  const wa = screen.getPrimaryDisplay().workArea;
  const w = 316, h = Math.min(460, 118 + (st.rows ?? st.items?.length ?? 0) * 29);
  const bounds = { x: wa.x + wa.width - w - 16, y: wa.y + wa.height - h - 16, width: w, height: h };
  if (!todoWin) {
    todoWin = new BrowserWindow({ ...bounds, frame: false, transparent: true, hasShadow: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false,
      icon: path.join(ASSETS, 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js') } });
    const query = { mode: 'todo' };
    const qs = new URLSearchParams(query).toString();
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) todoWin.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}?${qs}`);
    else todoWin.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), { query });
    todoWin.once('ready-to-show', () => todoWin?.showInactive());
    todoWin.on('closed', () => { todoWin = null; });
  } else {
    todoWin.setBounds(bounds);
    if (!todoWin.isVisible() && !todoWin.webContents.isLoading()) todoWin.showInactive();
    todoWin.webContents.send('todo-state', st);
  }
}
ipcMain.handle('todoInit', () => todoState);
ipcMain.on('todo', (_e, st) => {
  clearTimeout(todoTimer);
  if (st?.fresh) todoHidden = null;
  if (!st || st.hide) { todoState = null; todoWin?.close(); return; }
  if (todoHidden === st.agent) return; // user closed it for this run
  todoState = st;
  showTodo(st);
  if (st.finished) todoTimer = setTimeout(() => todoWin?.close(), 6000);
});
ipcMain.on('todoClose', () => { todoHidden = todoState?.agent ?? null; todoWin?.close(); });

// opts (all optional, strings/booleans): web = browser-style agent, child = spawned by a manager (can't spawn more),
// group + idx = which team/slot it is, so it can report back to the window that manages it.
const groupParent = new Map(); // team id -> webContents id of the managing window
const reported = new Set();     // "group:idx" of agents that already sent their result
function openAgent(kind, task = '', opts = {}, parentId) {
  const id = nextId++;
  const title = `~/${opts.web ? 'browser' : kind}-${id}`;
  const { slot, x, y } = placeTile(...SIZES[kind]);
  const query = { mode: kind, id, title, task };
  if (opts.web) query.web = '1';
  if (opts.child) query.child = '1';
  if (opts.group) { query.group = opts.group; query.idx = String(opts.idx ?? 0); if (parentId != null) groupParent.set(opts.group, parentId); }
  const win = createWindow(query, { x, y });
  agents.set(id, { id, kind: opts.web ? 'browser' : kind, title, st: 'idle' });
  wins.set(id, win);
  win.on('closed', () => {
    agents.delete(id); wins.delete(id); usedSlots.delete(slot); pushAgents();
    if (opts.group && !reported.has(`${opts.group}:${opts.idx ?? 0}`)) { // closed before finishing: tell the manager so its card doesn't hang
      const wc = groupParent.has(opts.group) ? webContents.fromId(groupParent.get(opts.group)) : null;
      if (wc && !wc.isDestroyed()) wc.send('agent-done', { group: opts.group, idx: opts.idx ?? 0, ok: false, stopped: true, summary: 'window closed' });
    }
  });
  pushAgents();
  return id;
}
ipcMain.on('open', (e, kind, task, opts) => openAgent(kind === 'script' ? 'script' : 'agent', String(task || ''), opts || {}, e.sender.id));
// Several windows at once, a moment apart so the machine isn't hit by 8 window creations in one frame.
ipcMain.on('openMany', (e, specs) => {
  const pid = e.sender.id;
  [].concat(specs || []).slice(0, 8).forEach((sp, i) => setTimeout(() => openAgent(sp.kind === 'script' ? 'script' : 'agent', String(sp.task || ''), sp.opts || {}, pid), i * 160));
});
// A managed agent finished: tell the window that spawned the team.
ipcMain.on('agentDone', (_e, info) => {
  reported.add(`${info?.group}:${info?.idx ?? 0}`);
  const wc = groupParent.get(info?.group) != null ? webContents.fromId(groupParent.get(info.group)) : null;
  if (wc && !wc.isDestroyed()) wc.send('agent-done', info);
});
ipcMain.on('runnerGrow', (_e, extra) => {
  if (!runnerWin || runnerWin.pinned) return;
  const b = runnerWin.getBounds();
  const h = SIZES.runner[1] + Math.max(0, Math.min(300, Math.round(extra || 0)));
  runnerWin.setBounds({ ...b, y: b.y + b.height - h, height: h });
});
// Light/dark is per window and handled in the page; nothing global (nativeTheme would flip every window).
ipcMain.on('theme', () => {});

const showMain = () => { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); };
ipcMain.on('status', (_e, id, st) => {
  if (agents.has(id)) { agents.get(id).st = st; pushAgents(); }
});
ipcMain.on('focus', (_e, id) => { const w = wins.get(id); if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
ipcMain.on('closeAgent', (_e, id) => wins.get(id)?.close());
// Rename a window (from its own title or the main window's chip); the window updates its labels.
ipcMain.on('rename', (_e, id, name) => {
  const a = agents.get(id);
  if (!a) return;
  a.title = `~/${name}`;
  wins.get(id)?.webContents.send('renamed', name);
  pushAgents();
});
// Open the settings panel on a given page in the main window (icons in agent windows use this).
ipcMain.on('nav', (_e, tab) => { showMain(); mainWin.webContents.send('nav', tab); });

// The app is now called Genisys, but its data (keys, memory, bats) stays in the old %APPDATA%/Executor folder.
app.setPath('userData', path.join(app.getPath('appData'), 'Executor'));

// Lighter: no spare renderer process, capped JS heap.
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');
app.whenReady().then(() => {
  dlog('ready');
  // productName changed my-app → Executor, which moved userData; carry the API key over once.
  const cfg = path.join(app.getPath('userData'), 'config.json');
  const old = path.join(app.getPath('appData'), 'my-app', 'config.json');
  if (!fs.existsSync(cfg) && fs.existsSync(old)) { fs.mkdirSync(path.dirname(cfg), { recursive: true }); fs.copyFileSync(old, cfg); }
  db.openDb(path.join(app.getPath('userData'), 'executor.db'));
  // Seed the extra free accounts once (new ones only); the existing rotation then switches key when one hits its limit.
  // Manage or remove them in Settings → Keys.
  const seeded = db.getSetting('seededKeys', []);
  const fresh = (seedKeys.apiKeys || []).filter((k) => !seeded.includes(k));
  if (fresh.length) {
    const c = readCfg();
    c.apiKeys = [...new Set([...(c.apiKeys || []), ...fresh])];
    fs.mkdirSync(path.dirname(cfgPath()), { recursive: true });
    writeCfg(c);
    db.setSetting('seededKeys', [...seeded, ...fresh]);
  }
  // Same idea for fast-provider keys (default-keys.json -> "providerKeys": { "groq": [...] }), added to config.json once each.
  {
    const seededP = db.getSetting('seededProviderKeys', []);
    const c = readCfg();
    c.providerKeys = c.providerKeys || {};
    const added = [];
    for (const [prov, list] of Object.entries(seedKeys.providerKeys || {})) {
      for (const k of [].concat(list || [])) {
        if (!k || seededP.includes(k)) continue;
        c.providerKeys[prov] = [...new Set([...(c.providerKeys[prov] || []), k])];
        added.push(k);
      }
    }
    if (added.length) { fs.mkdirSync(path.dirname(cfgPath()), { recursive: true }); writeCfg(c); db.setSetting('seededProviderKeys', [...seededP, ...added]); }
  }
  app.setAppUserModelId('Genisys'); // toast title/icon on Windows
  setAutostart(db.getSetting('autostart', true));

  for (const m of db.listMemory()) { const fixed = m.cmds.map(fixCmd); if (fixed.some((c, i) => c !== m.cmds[i])) db.updateMemory(m.id, fixed); }
  syncBats();
  mainWin = createWindow({ mode: 'main' });
  // Login launch starts hidden-to-taskbar (minimized) instead of popping up.
  if (process.argv.includes('--autostart')) mainWin.once('ready-to-show', () => { mainWin.showInactive(); mainWin.minimize(); });
  setTimeout(() => { checkModels(); checkCode(); }, 8000);
  setInterval(() => checkModels(), 6 * 3600e3);
  mainWin.on('closed', () => { mainWin = null; app.quit(); }); // closing the launcher closes every agent
  // System-wide hotkeys (work from any app while Genisys runs); keep in sync with the F1 help panel.
  globalShortcut.register('Control+Alt+Space', showMain);
  // Alt+Space is often taken (Windows window menu, PowerToys Run): fall back to Alt+Shift+Space.
  if (!globalShortcut.register('Alt+Space', toggleRunner)) {
    if (globalShortcut.register('Alt+Shift+Space', toggleRunner)) notify('problem', 'Alt+Space is taken by another app, so the runner uses Alt+Shift+Space.');
  }
  globalShortcut.register('Control+Alt+N', () => openAgent('agent'));
  globalShortcut.register('Control+Alt+S', () => openAgent('script'));
  setTimeout(() => startIndex(), 15000); // low-priority background scan, 15 s after start
  dlog('main window created');
}).catch((e) => dlog('startup failed', e?.stack || e));
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
