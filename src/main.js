import { app, BrowserWindow, ipcMain, globalShortcut, screen, Notification, shell, webContents, Tray, Menu, dialog, nativeTheme, net, session } from 'electron';
import http from 'node:http';
import { makeClockStore } from './clockstore.js';
import { learnMessages, parseLearned, habitLines } from './learn.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import Anthropic from '@anthropic-ai/sdk';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import started from 'electron-squirrel-startup';
import * as db from './db.js';
import dns from 'node:dns';
import { makeTts, VOICES } from './voice/tts.js';
import { makeWhisper } from './voice/whisper.js';
import seedKeys from '../default-keys.json';
import { batName, fixCmd } from './memory.js';
import { fuzzy } from './fuzzy.js';
import { makeActions } from './fast/actions.js';
import { shortcutLaunch, isShortcut } from './fast/shortcut.js';
import { buildEntries, mergeScan, norm as catKey } from './fast/catalog.js';
import { LABEL_KINDS, nameHash, needsLabel, labelMessages, parseLabels } from './fast/label.js';
import { classifyShortcut, storeItems, programItems, bookmarkItems, recentItems } from './fast/catalogScan.js';
import { scanFiles, hashSample } from './fast/files.js';
import { createHash } from 'node:crypto';
import { loadActions, validateParams, fillTemplate, routerLines, similarPrompt } from './fast/registry.js';
import { PathIndex, skipDir } from './fast/index.js';
import { checkScript, isInside } from './fast/safety.js';
import { hashScript } from './fast/scriptFallback.js';
import { parseLog, formatStats } from './fast/stats.js';
import * as cloud from './cloud.js';
import { createHelper } from './fast/helper.js';
import { makeSystem } from './fast/system.js';
import { isFileTask } from './fast/intent.js';
import { FAST_CAP } from './fast/fit.js';
import { startUpdater, releaseNotes } from './updater.js';
import { newer } from './version.js';
import { isRisky } from './risky.js';
import { textToHtml } from './fast/doc.js';

// Diagnostics: if the app ever exits on its own, say who asked for it and why (also saved to %TEMP%\genisys-debug.log).
// IPv4 first for every fetch (web search, AI, speech-to-text): on networks with a broken IPv6 route Node's fetch hung
// until its timeout (Bing, Google News: 0 results) while browsers and curl quietly fell back to IPv4
dns.setDefaultResultOrder('ipv4first');
const dlog = (...a) => { const line = `[${new Date().toISOString()}] ${a.join(' ')}`; console.log('[genisys]', line); try { fs.appendFileSync(path.join(os.tmpdir(), 'genisys-debug.log'), line + '\n'); } catch {} };
process.on('uncaughtException', (e) => { dlog('uncaughtException', e?.stack || e); cloud.reportError('crash', e); });
process.on('unhandledRejection', (e) => { dlog('unhandledRejection', e?.stack || e); cloud.reportError('crash', e); });
app.on('render-process-gone', (_e, wc, d) => { dlog('render-process-gone', d.reason, d.exitCode); if (d.reason !== 'clean-exit') cloud.reportError('crash', `window process gone: ${d.reason} (${d.exitCode})`); });
app.on('child-process-gone', (_e, d) => { dlog('child-process-gone', d.type, d.reason, d.exitCode); if (d.reason !== 'clean-exit') cloud.reportError('crash', `${d.type} process gone: ${d.reason} (${d.exitCode})`); });
const realQuit = app.quit.bind(app);
app.quit = () => { dlog('app.quit called from', new Error().stack.split('\n').slice(2, 5).join(' | ')); realQuit(); };
dlog('starting; started =', started, '; packaged =', app.isPackaged, '; args =', process.argv.slice(1).join(' '));
if (started) app.quit();
const PREPARE = process.argv.includes('--prepare');
// Launching again (e.g. desktop shortcut) just brings the running app forward.
// (Dev runs skip the lock: an installed/background Genisys would make `npm start` exit silently.)
// Genisys keeps running in the tray after its window is closed, so a second launch hands over to the running copy
// (its 'second-instance' handler shows the window) and exits.
if (app.isPackaged && !PREPARE && !app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => mainWin && showMain());

// Always-ready hidden PowerShell (volume, PC controls, short AI PowerShell commands): no 1-3 s startup per command.
const helper = createHelper({ log: dlog });

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
  if (kind === 'problem') cloud.reportError('problem', text);
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

// Renderer → database, through an allow-list (no raw SQL from the page).
const DB_OPS = ['getSetting', 'setSetting', 'remember', 'findMemory', 'findExact', 'listMemory', 'updateMemory', 'deleteMemory', 'useMemory',
  'listProfile', 'addProfile', 'updateProfile', 'deleteProfile', 'logTask', 'todayStats', 'failsToday',
  'listNotes', 'unseenNotes', 'markNotesSeen', 'deleteNote',
  'cacheGet', 'cachePut', 'cacheUse', 'cacheDrop', 'cacheCount', 'cacheClear', 'scriptRecord', 'scriptsGood', 'appHints', 'chatHistory', 'toolLogs', 'toolCounts', 'chatSessions', 'sessionTurns', 'lastSession','convoAdd', 'convoRecent', 'convoClear', 'prefAll', 'prefSet', 'prefDel', 'catalogAll', 'catalogUse'];
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
// First-run setup, Report tab and renderer errors -> the website backend (see cloud.js).
ipcMain.handle('cloud', (_e, op, data) => {
  if (op === 'state') return cloud.state();
  if (op === 'register') return cloud.register(data || {});
  if (op === 'report') return cloud.sendReport(data || {});
  throw new Error(`unknown cloud op ${op}`);
});
ipcMain.on('reportError', (_e, kind, message, stack) => cloud.reportError(kind === 'renderer' ? 'renderer' : 'error', { message, stack }));
// Notes › Check for updates: newest GitHub release vs this version; installUpdate downloads (if needed) and installs it now.
ipcMain.handle('checkUpdates', async () => { checkModels(true); return updater ? updater.checkNow() : { current: app.getVersion(), latest: null, dev: true }; });
ipcMain.handle('installUpdate', () => updater?.installNow());
ipcMain.handle('updateReady', () => updater?.readyVersion?.() || null); // a window that opens later still shows the button
// Never from the forge build in out\ (testing it overwrote the installed app's Run entry, so Windows started the dev copy).
const setAutostart = (on) => { if (app.isPackaged && !/\\out\\[^\\]+-win32-x64\\/i.test(process.execPath)) app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: ['--autostart'] }); };
ipcMain.handle('autostart', (_e, on) => { db.setSetting('autostart', on); setAutostart(on); return app.isPackaged; });

ipcMain.handle('config', () => {
  const { keys, models } = loadConfig();
  return { dev: !app.isPackaged, version: app.getVersion(), model: models[0], models, hasKey: keys.length > 0 || !!ownActive(), own: ownActive() ? { provider: ownActive().provider, model: ownActive().model } : null, keyCount: keys.length, path: cfgPath() };
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
let updater = null; // set once the app is ready (installed app only)
const provTurn = new Map(); // provider -> next key to start with
const provRest = new Map(); // "provider:keyId" -> ms until which it is skipped (rate limit / bad key)
async function callCompat(p, key, model, messages, { think, maxTokens, timeoutMs }) {
  const body = { model, messages, [p.tokensParam || 'max_completion_tokens']: maxTokens || (think ? 3000 : 1000), stream: false };
  if (/gpt-oss/i.test(model)) body.reasoning_effort = think ? 'medium' : 'low';
  const go = async (b) => {
    const res = await fetch(p.url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b), signal: sig(timeoutMs) });
    return { res, data: await res.json().catch(() => ({})) };
  };
  let r = await go(body);
  if (r.res.status === 400 && body.reasoning_effort && /reasoning/i.test(JSON.stringify(r.data))) { delete body.reasoning_effort; r = await go(body); }
  return r;
}
// First valid answer wins. Per-call timeout 5 s, then the next provider. null = none answered (caller falls back to OpenRouter).
async function tryProviders(messages, think, rec, opts) {
  const timeoutMs = opts.timeoutMs || (think ? 20000 : 10000);
  const lanes = [];
  const resting = (id) => (provRest.get(id) || 0) > Date.now();
  for (const p of providerList()) {
    const models = p.models.slice(0, opts.fast ? 1 : 2);
    if (!opts.fast) models.reverse(); // agent steps: the bigger, steadier model first (it follows the rules; 20b invents options). Router: the quick one
    // Keys take turns (round-robin), so two windows don't both start on key 1; a full key hands over to the next one.
    const start = (provTurn.get(p.id) || 0) % p.keys.length;
    const keys = [...p.keys.slice(start), ...p.keys.slice(0, start)].map((key) => ({ key, n: p.keys.indexOf(key) + 1 }));
    // Every key on the first model, then every key on the next: Groq's free limits are per key AND per model.
    for (const model of models) for (const { key, n } of keys) {
      if (resting(`${p.id}:${keyId(key)}`) || resting(`${p.id}:${keyId(key)}:${model}`)) continue; // bad key / that model is full on it
      lanes.push({ p, key, n, model });
    }
    provTurn.set(p.id, start + 1);
  }
  if (!lanes.length) return null;
  const one = async ({ p, key, n, model }) => {
    const at = Date.now();
    const note = (r) => rec.attempts.push({ provider: p.id, model, key: n, ms: Date.now() - at, r });
    try {
      const { res, data } = await callCompat(p, key, model, messages, { think, maxTokens: opts.maxTokens, timeoutMs });
      const text = data.choices?.[0]?.message?.content;
      if (res.ok && text) { note('ok'); rec.provider = p.id; rec.model = model; rec.usage = data.usage || null; return text; }
      if (res.status === 429) provRest.set(`${p.id}:${keyId(key)}:${model}`, Date.now() + 1000 * Math.min(60, Math.max(5, Number(res.headers.get('retry-after')) || 20)));
      if ([401, 403].includes(res.status)) provRest.set(`${p.id}:${keyId(key)}`, Date.now() + 3600e3);
      note(res.ok ? 'empty' : `http ${res.status}`);
    } catch (err) { note(err.name === 'TimeoutError' ? 'timeout' : 'error'); }
    throw new Error('provider failed');
  };
  if (db.getSetting('raceProviders', false)) { // optional, default OFF: first provider to answer wins (costs more requests)
    const firsts = [...new Map(lanes.map((l) => [l.p.id, l])).values()];
    try { return await Promise.any(firsts.map(one)); } catch { return null; }
  }
  // Hedged: start one key; if it hasn't answered in 2.5 s (a stuck key used to cost 10 s), the next starts alongside it,
  // up to 3 at once. A failure starts the next at once. First answer wins; up to 6 tries (3 keys x 2 models).
  return await new Promise((resolve) => {
    const queue = lanes.slice(0, 6);
    let running = 0, done = false, timer = 0;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const next = () => {
      if (done) return;
      if (!queue.length) { if (!running) finish(null); return; }
      if (running >= 3) return;
      running++;
      one(queue.shift()).then(finish, () => { running--; next(); });
      clearTimeout(timer);
      timer = setTimeout(next, 2500);
    };
    next();
  });
}
// ---- The user's own AI (Settings › Keys › "Your own AI"): their key, their model, used FIRST for every AI call.
// If it fails (bad key, no credit, down) the free chain below takes over, so Genisys keeps working.
// config.json: ownKeys: { anthropic: "sk-ant-…", openai: "sk-…", … }, ownUrl: "<custom base url>", ownModel: { provider, model } | null
const OWN = {
  anthropic: { name: 'Claude (Anthropic)', prefix: 'sk-ant-', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'claude-fable-5-1'], keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { name: 'OpenAI', prefix: 'sk-', url: 'https://api.openai.com/v1', tokens: 'max_completion_tokens', keyUrl: 'https://platform.openai.com/api-keys' },
  gemini: { name: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/apikey' },
  deepseek: { name: 'DeepSeek', prefix: 'sk-', url: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys' },
  mistral: { name: 'Mistral', url: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys' },
  openrouter: { name: 'OpenRouter (paid models)', prefix: 'sk-or-', url: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys' },
  custom: { name: 'Other (OpenAI-compatible URL)', custom: true },
};
const ownUrl = (id, cfg = readCfg()) => (OWN[id].custom ? String(cfg.ownUrl || '').replace(/\/+$/, '').replace(/\/chat\/completions$/, '') : OWN[id].url);
const ownKey = (id, cfg = readCfg()) => cfg.ownKeys?.[id] || '';
function ownActive() {
  const cfg = readCfg(), m = cfg.ownModel;
  return m && OWN[m.provider] && m.model && ownKey(m.provider, cfg) ? { ...m, key: ownKey(m.provider, cfg), url: ownUrl(m.provider, cfg) } : null;
}
// Claude models that support the server-side refusal fallback (a declined request is re-run on another Claude model).
const CLAUDE_FALLBACK = /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/;
async function callOwn({ provider, model, key, url }, messages, { think, maxTokens, timeoutMs }) {
  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: timeoutMs });
    const system = messages.filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n\n');
    const msgs = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }));
    const params = { model, max_tokens: maxTokens || (think ? 16000 : 4000), messages: msgs, ...(system ? { system } : {}) };
    // Effort is the speed/depth control on current Claude models (thinking stays adaptive); Haiku 4.5 doesn't take it.
    if (!/haiku/.test(model)) params.output_config = { effort: think ? 'high' : 'low' };
    const res = CLAUDE_FALLBACK.test(model)
      ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal: aiCalls.getStore()?.signal })
      : await client.messages.create(params, { signal: aiCalls.getStore()?.signal });
    if (res.stop_reason === 'refusal') throw new Error('Claude declined this request');
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!text) throw new Error(res.stop_reason === 'max_tokens' ? 'reply was cut off (max tokens)' : 'empty reply');
    return { text, usage: res.usage };
  }
  const body = { model, messages, [OWN[provider].tokens || 'max_tokens']: maxTokens || (think ? 8000 : 2000) };
  const res = await fetch(`${url}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: sig(timeoutMs) });
  const data = await res.json().catch(() => ({}));
  const text = data.choices?.[0]?.message?.content;
  if (!res.ok || !text) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return { text, usage: data.usage || null };
}
// Plain-language reason for a failed own-AI call (shown in Settings and in the fallback notice).
const ownErr = (err) => (err instanceof Anthropic.AuthenticationError ? 'the key was rejected'
  : err instanceof Anthropic.PermissionDeniedError ? 'this key may not use that model'
  : err instanceof Anthropic.NotFoundError ? 'that model was not found'
  : err instanceof Anthropic.RateLimitError ? 'rate limit reached, try again in a minute'
  : err instanceof Anthropic.APIConnectionError ? 'could not reach the service'
  : err instanceof Anthropic.APIError ? `${err.status || ''} ${err.message}`.trim()
  : err?.name === 'TimeoutError' ? 'it took too long' : String(err?.message || err)).slice(0, 160);
let ownWarned = 0;
ipcMain.handle('ownAI', async (_e, op, a = {}) => {
  const cfg = readCfg();
  cfg.ownKeys = cfg.ownKeys || {};
  if (op === 'setKey') {
    const def = OWN[a.provider]; if (!def) throw new Error('Unknown provider');
    const k = String(a.key || '').trim();
    if (k.length < 16 || /\s/.test(k)) throw new Error('That does not look like an API key.');
    if (def.prefix && !k.startsWith(def.prefix)) throw new Error(`A ${def.name} key starts with ${def.prefix}`);
    if (def.custom) { if (!/^https?:\/\/\S+$/i.test(String(a.url || ''))) throw new Error('Add the service URL, e.g. http://localhost:11434/v1'); cfg.ownUrl = String(a.url).trim(); }
    cfg.ownKeys[a.provider] = k;
    writeCfg(cfg);
  } else if (op === 'removeKey') {
    delete cfg.ownKeys[a.provider];
    if (cfg.ownModel?.provider === a.provider) cfg.ownModel = null;
    writeCfg(cfg);
  } else if (op === 'use') { // { provider, model } or null = back to the free models
    if (a.provider && !ownKey(a.provider, cfg)) throw new Error('Add a key for that provider first.');
    cfg.ownModel = a.provider && a.model ? { provider: a.provider, model: String(a.model).trim() } : null;
    writeCfg(cfg);
  } else if (op === 'models') { // live list from the provider (falls back to the built-in list)
    const key = ownKey(a.provider, cfg); if (!key) return OWN[a.provider]?.models || [];
    try {
      if (a.provider === 'anthropic') {
        const ids = [];
        for await (const m of new Anthropic({ apiKey: key, maxRetries: 1, timeout: 10000 }).models.list()) ids.push(m.id);
        return [...new Set([...OWN.anthropic.models.filter((m) => ids.includes(m)), ...ids])];
      }
      const r = await fetch(`${ownUrl(a.provider, cfg)}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) });
      const d = await r.json();
      return (d.data || []).map((m) => String(m.id).replace(/^models\//, '')).filter(Boolean).sort();
    } catch { return OWN[a.provider]?.models || []; }
  } else if (op === 'test') {
    const key = ownKey(a.provider, cfg); if (!key) throw new Error('Add a key first.');
    const t = Date.now();
    try {
      const r = await callOwn({ provider: a.provider, model: a.model, key, url: ownUrl(a.provider, cfg) }, [{ role: 'user', content: 'Reply with just: ok' }], { think: false, maxTokens: 300, timeoutMs: 30000 });
      return { ok: true, ms: Date.now() - t, text: r.text.slice(0, 80) };
    } catch (err) { return { ok: false, ms: Date.now() - t, error: ownErr(err) }; }
  }
  const c = readCfg();
  return {
    providers: Object.entries(OWN).map(([id, d]) => ({ id, name: d.name, keyUrl: d.keyUrl || '', custom: !!d.custom, url: d.custom ? c.ownUrl || '' : '', masked: c.ownKeys?.[id] ? mask(c.ownKeys[id]) : '', models: d.models || [] })),
    active: c.ownModel || null,
  };
});

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
// What the AI knows about this PC. Always a short line; for tasks about files/folders also the user's folder map
// (folder names only, captured at install and kept fresh) and the few files whose names match the task.
ipcMain.handle('context', (_e, task = '') => {
  const drives = 'CDEFGHIJ'.split('').filter((d) => fs.existsSync(`${d}:\\`)).map((d) => `${d}:`).join(' ');
  const where = ['home', 'desktop', 'documents', 'downloads', 'videos', 'pictures', 'music'].map((k) => `${k}=${app.getPath(k)}`).join('; ');
  const favs = (() => { try { const f = db.prefAll(); return Object.entries(f).filter(([k]) => k.startsWith('fav:')).map(([k, v]) => `${k.slice(4).replace(':', ' ')}=${v}`).join(', '); } catch { return ''; } })();
  const prof = browserProfiles('chrome').map((p) => `${p.name} (${p.dir}${p.email ? `, ${p.email}` : ''})`).join('; ');
  const head = `User: ${os.userInfo().username} on ${os.hostname()}, ${new Date().toString()}\nDrives: ${drives}\nFolders: ${where}${prof ? `\nChrome profiles: ${prof}` : ''}${favs ? `\nUser favorites (use them when the request names no app/browser/profile; a named one always wins): ${favs}` : ''}`;
  if (!isFileTask(task)) return head;
  if (!pindex.ready) return `${head}\n${legacyTree()}`;
  const roots = [...new Set([...homeDirs(), path.join(os.homedir(), 'OneDrive'), ...myPaths().roots])].filter((r) => pindex.dirs.has(r));
  const hits = pindex.contextFor(task);
  const files = Object.entries(hits).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v.join(' | ')}`).join('\n');
  return `${head}\nUSER FOLDER MAP (folder names only):\n${pindex.folderMap(roots, 2000)}${files ? `\nMATCHING THIS TASK:\n${files}` : ''}`;
});
// Before the index exists: the old two-level folder listing.
function legacyTree() {
  const dirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !/^[.$]/.test(d.name)).map((d) => d.name).slice(0, 40); } catch { return []; } };
  return ['desktop', 'documents', 'downloads', 'videos', 'pictures', 'music'].map((k) => {
    const p = app.getPath(k);
    return `${k} contains: ${dirs(p).map((n) => { const kids = dirs(path.join(p, n)).slice(0, 15); return kids.length ? `${n} (${kids.join(', ')})` : n; }).join(', ') || '(none)'}`;
  }).join('\n');
}

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
  if (rec?.text) cloud.sendChat({ ...line, answer: rec.answer, params: rec.params }); // opt-in, see cloud.js
  return true;
});

const aiHandler = async (e, messages, think, rec, opts = {}) => {
  // no internet: say so at once (every model would fail in milliseconds and the user would only see 'failed')
  if (!net.isOnline()) throw new Error("You're offline. Connect to the internet and ask again. Timers, alarms, notes, your music, math and opening apps or files still work without it.");
  // The user's own key + model first. On failure the free chain below answers, and the user is told once.
  const own = ownActive();
  if (own) {
    const at = Date.now();
    try {
      const r = await callOwn(own, messages, { think, maxTokens: opts.maxTokens, timeoutMs: opts.fast ? 15000 : think ? 120000 : 60000 });
      rec.attempts.push({ provider: own.provider, model: own.model, ms: Date.now() - at, r: 'ok' });
      rec.provider = own.provider; rec.model = own.model; rec.usage = r.usage || null;
      return r.text;
    } catch (err) {
      const why = ownErr(err);
      rec.attempts.push({ provider: own.provider, model: own.model, ms: Date.now() - at, r: why.slice(0, 60) });
      dlog('own AI failed', own.provider, own.model, why);
      if (Date.now() - ownWarned > 10 * 60e3) { ownWarned = Date.now(); notify('problem', `Your ${OWN[own.provider].name} model failed (${why}). Using the free models for now; check Settings › Keys.`); }
    }
  }
  // Speed mode: try the fast providers first (short prompts only: their free limits are small), then fall back to OpenRouter below.
  if (aiCalls.getStore()?.signal.aborted) throw new Error('stopped');
  if (opts.fast || rec.promptChars < FAST_CAP) { // fast providers (Groq…) first for every call that fits; OpenRouter is the fallback
    const fast = await tryProviders(messages, think, rec, opts);
    if (fast != null) return fast;
  }
  const { keys, models: cfgModels } = loadConfig();
  if (!keys.length) throw new Error(own ? `Your ${OWN[own.provider].name} model failed and there is no free key to fall back on. Check Settings → keys.` : 'No API key. Add one in Settings → keys.');
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
      if (aiCalls.getStore()?.signal.aborted) throw new Error('stopped'); // Stop: no next model, no next key
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
          signal: sig(opts.fast ? 8000 : think ? 30000 : 12000), // a busy free model fails fast; the next one is tried
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
// Stop: the window's model calls are cancelled at once (not left running in the background). Each call runs with its
// window's AbortController; sig(ms) = that cancel OR the usual timeout.
const aiCalls = new AsyncLocalStorage();
const aiCtl = new Map(); // webContents id -> Set<AbortController>
const sig = (ms) => { const c = aiCalls.getStore(); return c ? AbortSignal.any([AbortSignal.timeout(ms), c.signal]) : AbortSignal.timeout(ms); };
ipcMain.on('aiCancel', (e) => { for (const c of aiCtl.get(e.sender.id) || []) c.abort(new Error('stopped')); aiCtl.delete(e.sender.id); });
ipcMain.handle('ai', async (e, messages, think, opts) => {
  const ctl = new AbortController();
  if (!aiCtl.has(e.sender.id)) aiCtl.set(e.sender.id, new Set());
  aiCtl.get(e.sender.id).add(ctl);
  try { return await aiCalls.run(ctl, () => aiOne(e, messages, think, opts)); } finally { aiCtl.get(e.sender.id)?.delete(ctl); }
});
// Voice: audio from the renderer -> text. Groq Whisper (the fast-provider key), else the user's own OpenAI key.
// The key never leaves main; the audio goes only to that provider and is not stored.
const STT_HINT = 'Genisys, timer, reminder, alarm, stopwatch, shopping list, Kigali, weather';
// Offline first (whisper.cpp in voice/whisper: nothing leaves the PC, works without internet); Groq / OpenAI when the user
// picked online in Settings, or as the fallback when the offline one fails.
let whisperLocal = null;
const LOCAL_HINT = 'Genisys. Kigali, Rwanda.'; // short on purpose: a long word list pulled "tea" towards "Kigali" in tests
ipcMain.handle('stt', async (e, buf, opts = {}) => {
  const groq = providerList().find((p) => p.id === 'groq'), openai = ownKey('openai');
  const ctl = new AbortController();
  if (!aiCtl.has(e.sender.id)) aiCtl.set(e.sender.id, new Set());
  aiCtl.get(e.sender.id).add(ctl);
  whisperLocal ??= makeWhisper({ root: path.join(VOICE_DIR, 'whisper'), log: dlog });
  if (opts.engine !== 'online' && whisperLocal.available() && (!opts.lang || opts.lang === 'auto' || opts.lang === 'en')) {
    const t = Date.now();
    try { const text = await whisperLocal.transcribe(buf, { seconds: Number(opts.seconds) || 0, prompt: LOCAL_HINT, signal: ctl.signal }); aiCtl.get(e.sender.id)?.delete(ctl); return { text, ms: Date.now() - t, engine: 'offline' }; }
    catch (err) { if (err.stopped) { aiCtl.get(e.sender.id)?.delete(ctl); return { error: 'stopped' }; } dlog(`stt offline failed: ${err.message}`); }
  }
  if (!groq && !openai) { aiCtl.get(e.sender.id)?.delete(ctl); return { error: whisperLocal.available() ? 'failed' : 'nokey' }; }
  const names = (() => { try { return db.catalogAll().sort((a, b) => (b.uses || 0) - (a.uses || 0)).slice(0, 25).map((r) => r.name); } catch { return []; } })();
  const prompt = [STT_HINT, ...names].join(', ').slice(0, 600); // Whisper reads ~224 tokens of prompt
  const post = async (url, key, model) => {
    const f = new FormData();
    f.append('file', new Blob([buf], { type: opts.type || 'audio/wav' }), /wav/.test(opts.type || 'audio/wav') ? 'speech.wav' : 'speech.webm');
    f.append('model', model);
    f.append('prompt', prompt);
    f.append('response_format', 'json');
    if (opts.lang && opts.lang !== 'auto') f.append('language', opts.lang);
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: f, signal: AbortSignal.any([AbortSignal.timeout(30000), ctl.signal]) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data?.error?.message || `HTTP ${res.status}`), { status: res.status });
    return String(data.text ?? '');
  };
  const t = Date.now();
  try {
    const tries = [
      ...(groq ? groq.keys.map((k) => () => post('https://api.groq.com/openai/v1/audio/transcriptions', k, 'whisper-large-v3-turbo')) : []),
      ...(openai ? [() => post('https://api.openai.com/v1/audio/transcriptions', openai, 'gpt-4o-mini-transcribe')] : []),
    ];
    let last;
    for (const go of tries) {
      try { const text = await go(); dlog(`stt ${Date.now() - t}ms ${text.length} chars`); return { text, ms: Date.now() - t }; }
      catch (err) { last = err; if (ctl.signal.aborted) return { error: 'stopped' }; }
    }
    const offline = last && !last.status;
    return { error: offline ? 'offline' : 'failed', detail: String(last?.message || '').slice(0, 120) };
  } finally { aiCtl.get(e.sender.id)?.delete(ctl); }
});
ipcMain.handle('openMicPrivacy', () => shell.openExternal('ms-settings:privacy-microphone'));
// Offline voices (voice/ folder, shipped in the installer): spoken answers without the robotic Windows voices.
const VOICE_DIR = app.isPackaged ? path.join(process.resourcesPath, 'voice') : path.join(__dirname, '../../voice');
const tts = makeTts({ root: VOICE_DIR, log: dlog });
app.on('will-quit', () => tts.stop()); // never leave piper.exe running after Genisys closes
ipcMain.handle('tts', async (_e, text, opts) => { try { return await tts.speak(text, opts); } catch (err) { dlog(`tts failed: ${err.message}`); return { error: err.message }; } });
ipcMain.handle('ttsVoices', () => tts.available().map((id) => ({ id, label: VOICES[id].label })));
ipcMain.on('ttsWarm', (_e, voice, speed) => tts.warm(voice, speed));
async function aiOne(e, messages, think, opts) {
  const rec = { provider: 'openrouter', think: !!think, promptChars: JSON.stringify(messages).length, attempts: [], model: null, usage: null, ms: 0, ok: false };
  const t = Date.now();
  try { const out = await aiHandler(e, messages, think, rec, opts || {}); rec.ok = true; rec.outChars = String(out).length; return out; }
  finally { rec.ms = Date.now() - t; rec.keySwitches = new Set(rec.attempts.map((a) => a.key)).size - 1; try { tp(e.sender.id).ai.push(rec); } catch {} }
}

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
  p.then((r) => { if (r?.results && !r.results.length) webCache.delete(key); }, () => webCache.delete(key)); // never keep an empty search
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
// An RSS search feed (Bing, Google News) -> [{ title, url, snippet }]. Descriptions are escaped HTML, hence unhtml twice.
async function rss(url, n = 8) {
  const xml = await (await fetch(url, { headers: UA, signal: AbortSignal.timeout(7000) })).text();
  const tag = (s, t) => (s.match(new RegExp(`<${t}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`)) || [])[1] || '';
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, n).map(([, it]) => {
    const date = new Date(tag(it, 'pubDate')); // Google News items have one, Bing results do not
    return { title: unhtml(unhtml(tag(it, 'title'))), url: unhtml(tag(it, 'link')), snippet: `${Number.isNaN(date.getTime()) ? '' : `${date.toDateString()}: `}${unhtml(unhtml(tag(it, 'description'))).slice(0, 300)}` };
  }).filter((r) => /^https?:/.test(r.url) && r.title);
}
// Recent headlines (with their dates) for news-like questions: releases, prices, results. No key needed.
const newsFor = (q) => rss(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, 4).catch(() => []);
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
  // All endpoints at once: the first one with results wins (no waiting for a slow one to fail first).
  // DuckDuckGo now often answers scripts with a bot check (no results), so Bing's RSS feed is a third source.
  const tries = [ask(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, true), ask(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, false),
    rss(`https://www.bing.com/search?q=${encodeURIComponent(q)}&format=rss`)];
  const settled = await Promise.race([
    Promise.any(tries.map((t) => t.then((r) => (r.length ? r : Promise.reject(new Error('empty')))))),
    new Promise((res) => setTimeout(() => res([]), 8000)),
  ]).catch(() => []);
  return settled;
}
ipcMain.handle('web', (_e, kind, q) => cached(`${kind}:${q}`, async () => {
  if (kind === 'search') {
    const [web, news] = await Promise.all([ddg(q), newsFor(q)]);
    // dated headlines first: for anything recent they are the answer (keyword results can be about something else: "GTA 6" -> GTA V pages)
    const results = [...news.slice(0, 3), ...web.filter((r, i, a) => a.findIndex((x) => new URL(x.url).hostname === new URL(r.url).hostname) === i).slice(0, 6)];
    // Read the top 2 pages in parallel so the AI can answer straight away.
    const pages = (await Promise.allSettled(results.filter((r) => !/^https:\/\/news\.google\./.test(r.url)).slice(0, 2).map((r) => readPage(r.url, 2800, 5000)))).filter((p) => p.status === 'fulfilled' && p.value.text.length > 200).map((p) => p.value);
    return { results, pages };
  }
  return readPage(q, 6000, 8000);
}));

// Agents write scripts/code here; refuses to overwrite unless force (renderer asks the user first).
// A real PDF: the text is laid out as HTML in a hidden window and printed by Chromium. Checked after writing.
// The source text is kept beside our own data, so "add X to that pdf" can read what is already in it.
const pdfSrc = (file) => path.join(app.getPath('userData'), 'pdf-src', `${createHash('sha1').update(path.resolve(file).toLowerCase()).digest('hex')}.txt`);
async function printPdf(file, html, { overwrite = false, text } = {}) {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const buf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-' || buf.length < 200) return { ok: false, error: 'bad output' };
    fs.writeFileSync(file, buf, { flag: overwrite ? 'w' : 'wx' });
    const back = fs.readFileSync(file);
    const ok = back.length === buf.length && back.subarray(0, 5).toString('latin1') === '%PDF-';
    if (ok && text != null) { try { fs.mkdirSync(path.dirname(pdfSrc(file)), { recursive: true }); fs.writeFileSync(pdfSrc(file), String(text)); } catch {} }
    return { ok, size: back.length };
  } catch (e) { return { ok: false, error: e.message }; } finally { if (!win.isDestroyed()) win.destroy(); }
}
ipcMain.handle('write', async (_e, file, content, force) => {
  const full = path.resolve(os.homedir(), file.replace(/%(\w+)%/g, (m, v) => process.env[v] ?? m));
  if (fs.existsSync(full) && !force) return { exists: true, full };
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (/\.pdf$/i.test(full)) { // never plain text under a .pdf name
    if (/^\s*(%PDF|<!doctype|<html)|\bendobj\b/i.test(content)) throw new Error('a .pdf needs the readable text only (# Title, - items); the app makes the PDF. Do not write PDF code or HTML');
    const r = await printPdf(full, textToHtml(content, path.basename(full).replace(/\.pdf$/i, '')), { overwrite: true, text: content });
    if (!r.ok) throw new Error(`the PDF was not written correctly${r.error ? `: ${r.error}` : ''}`);
    return { full };
  }
  fs.writeFileSync(full, content);
  return { full };
});

// Settings › About Genisys: everything about this install in one place (versions, where things live and how big they are,
// the PC, the AI in use, the search index, startup). Read-only; keys are only counted, never shown.
const sizeOf = (p) => {
  try {
    const st = fs.statSync(p);
    if (!st.isDirectory()) return st.size;
    let n = 0;
    for (const e of fs.readdirSync(p, { withFileTypes: true })) n += e.isDirectory() ? sizeOf(path.join(p, e.name)) : (() => { try { return fs.statSync(path.join(p, e.name)).size; } catch { return 0; } })();
    return n;
  } catch { return null; }
};
ipcMain.handle('appInfo', () => {
  const ud = userDir(), cfg = readCfg(), own = ownActive();
  const item = (name, p, what) => ({ name, path: p, what, size: sizeOf(p), exists: fs.existsSync(p) });
  const debugLog = path.join(os.tmpdir(), 'genisys-debug.log');
  let runEntry = null;
  try { runEntry = app.getLoginItemSettings({ path: process.execPath, args: ['--autostart'] }).openAtLogin; } catch {}
  const safe = (fn, d = null) => { try { return fn(); } catch { return d; } };
  return {
    app: {
      name: 'Genisys', version: app.getVersion(), packaged: app.isPackaged, exe: process.execPath, installDir: path.dirname(process.execPath),
      electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, v8: process.versions.v8,
      startedAt: Date.now() - Math.round(process.uptime() * 1000), autostart: db.getSetting('autostart', true), startsWithWindows: runEntry,
      autoUpdate: db.getSetting('autoUpdate', true) !== false, speedMode: db.getSetting('speedMode', 'new'),
    },
    data: {
      folder: ud,
      total: sizeOf(ud),
      files: [
        item('Settings and keys', path.join(ud, 'config.json'), 'config.json: your API keys, models and own-AI choice'),
        item('Database', path.join(ud, 'executor.db'), 'executor.db: memory, profile, notes, task log, settings'),
        item('Your folders index', path.join(ud, 'path-index.json'), 'path-index.json: your user folders, for the AI'),
        item('Whole-PC index', path.join(ud, 'pc-index.json'), 'pc-index.json: every drive, for /search'),
        item('PC specs', path.join(ud, 'pc-specs.json'), 'pc-specs.json: Windows, CPU, RAM, screen'),
        item('Saved commands', path.join(ud, 'bats'), 'bats: tasks that worked, as .bat files'),
        item('Timing log', path.join(ud, 'timing.log'), 'timing.log: how long each task took'),
        item('Downloaded updates', path.join(ud, 'updates'), 'updates: installers waiting to be installed'),
        item('Debug log', debugLog, 'genisys-debug.log (in TEMP): start-up and error log'),
      ],
    },
    system: {
      windows: `${os.version()} (${os.release()})`, arch: os.arch(), cpu: os.cpus()[0]?.model?.trim() || '', cores: os.cpus().length,
      ram: os.totalmem(), freeRam: os.freemem(), user: os.userInfo().username, computer: os.hostname(), locale: app.getLocale(),
      drives: 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((d) => fs.existsSync(`${d}:\\`)).map((d) => `${d}:`).join(' '),
    },
    ai: {
      using: own ? `${OWN[own.provider].name} · ${own.model} (your key)` : 'Free models (Groq / Cerebras first, then OpenRouter)',
      ownKeys: Object.keys(cfg.ownKeys || {}).filter((k) => cfg.ownKeys[k]).map((k) => OWN[k]?.name || k),
      openrouterKeys: loadConfig().keys.length,
      fastKeys: Object.fromEntries(Object.entries(cfg.providerKeys || {}).map(([k, v]) => [k, [].concat(v || []).length])),
    },
    index: {
      userEntries: pindex.count, userScanned: pindex.scannedAt || null,
      pcEntries: pcIndex.count, pcScanned: pcIndex.scannedAt || null, storeApps: storeApps.length,
    },
    saved: {
      memory: safe(() => db.listMemory().length, 0), profile: safe(() => db.listProfile().length, 0), notes: safe(() => db.listNotes().length, 0),
      cached: safe(() => db.cacheCount(), 0), scripts: safe(() => db.scriptsGood().length, 0),
    },
  };
});
// Script Writer: the user picks where to save and what to open (Windows' own dialogs). null = cancelled.
const scriptsHome = () => path.join(os.homedir(), 'scripts');
ipcMain.handle('saveAs', async (e, name, text, dir) => {
  fs.mkdirSync(scriptsHome(), { recursive: true });
  const base = dir && fs.existsSync(dir) ? dir : scriptsHome();
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { title: 'Save script', defaultPath: path.join(base, path.basename(String(name || 'script.txt'))) });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, String(text ?? ''));
  return r.filePath;
});
// Open folder: its files for the explorer tree (junk folders like node_modules / .git skipped, capped so huge folders stay fast).
// Attachments: paths only (the AI works with the file where it is; nothing is read or copied here).
ipcMain.handle('pickFiles', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: 'Attach files', properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('openFolderDialog', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: 'Open a folder', defaultPath: scriptsHome(), properties: ['openDirectory'] });
  const root = r.filePaths?.[0];
  if (r.canceled || !root) return null;
  const entries = [];
  const walk = (dir, relDir, depth) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      if (entries.length >= 5000) return;
      const rel = relDir ? `${relDir}\\${ent.name}` : ent.name;
      if (ent.isDirectory()) { if (skipDir(ent.name)) continue; entries.push({ p: rel, d: true }); if (depth < 12) walk(path.join(dir, ent.name), rel, depth + 1); } else entries.push({ p: rel, d: false });
    }
  };
  walk(root, '', 0);
  return { root, name: path.basename(root) || root, entries };
});
ipcMain.handle('openFileDialog', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: 'Open a file', defaultPath: scriptsHome(), properties: ['openFile'] });
  const f = r.filePaths?.[0];
  if (r.canceled || !f) return null;
  if (fs.statSync(f).size > 5e6) throw new Error('That file is too big to edit here (over 5 MB).');
  return { path: f, text: fs.readFileSync(f, 'utf8') };
});
// The old text of a file the AI is about to replace (for the +/- line counts). Same path rules as 'write'; small text files only.
ipcMain.handle('readText', (_e, file) => {
  const full = path.resolve(os.homedir(), String(file).replace(/%(\w+)%/g, (m, v) => process.env[v] ?? m));
  if (!fs.existsSync(full) || fs.statSync(full).size > 2e6) return null;
  if (/\.pdf$/i.test(full)) { try { return fs.readFileSync(pdfSrc(full), 'utf8'); } catch { return null; } } // only PDFs Genisys made
  return fs.readFileSync(full, 'utf8');
});

ipcMain.on('quit', () => app.quit()); // power button: Genisys fully off, nothing left running
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
// A lone `powershell -Command "…"` from the AI: run it in the warm helper (no PowerShell startup). Anything else: a .bat.
const PS_ONLY = /^\s*powershell(?:\.exe)?(?:\s+-(?:NoProfile|NoLogo|NonInteractive|ExecutionPolicy\s+\w+|WindowStyle\s+\w+))*\s+-(?:Command|c)\s+"((?:[^"]|"")*)"\s*$/i;
// The main process asks for itself: a renderer (AI output shown as HTML) is never trusted to have confirmed.
const confirmRun = async (e, message, detail) => (await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender), {
  type: 'warning', buttons: ['Run', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true, title: 'Genisys', message, detail: String(detail).slice(0, 1500),
})).response === 0;
const CANCELLED = { code: 1, out: 'cancelled by user' };
ipcMain.handle('run', async (e, cmd) => {
  cmd = String(cmd || '');
  if (isRisky(cmd) && !(await confirmRun(e, 'Run this command? It changes things on your PC.', cmd))) return CANCELLED;
  const ps = PS_ONLY.exec(cmd);
  if (ps && !/[\r\n]/.test(cmd)) {
    try {
      const t0 = Date.now();
      const r = await helper.run(ps[1].replace(/""/g, '"'), 60000);
      try { tp(e.sender.id).run.push({ cmd: cmd.slice(0, 80), helperMs: Date.now() - t0 }); } catch {}
      return { code: r.code, out: String(r.out || '').slice(0, MAX_OUT) };
    } catch (err) { dlog('helper run failed, using a new process:', err.message); }
  }
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
  if (isStoreTarget(p)) { launchTarget(p); return ''; } // a Store app from /search
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
ipcMain.handle('find', (_e, o) => findSmart(o)); // the saved index first, then a disk scan
// Deleting goes to the Recycle Bin so it can be undone; "restore" brings items back by (part of) name or original path.
ipcMain.handle('trash', async (_e, list) => {
  const out = [];
  for (const raw of [].concat(list || []).slice(0, 200)) {
    const p = path.resolve(os.homedir(), expandEnv(raw));
    if (!fs.existsSync(p)) { out.push({ path: p, ok: false, error: 'not found (nothing at that path, so nothing was deleted)' }); continue; }
    try {
      await shell.trashItem(p);
      // never trust the call alone: look at the disk. Only a path that is really gone counts as deleted.
      if (fs.existsSync(p)) out.push({ path: p, ok: false, error: 'still on disk after the delete (in use or protected)' });
      else out.push({ path: p, ok: true });
    } catch (e) { out.push({ path: p, ok: false, error: /not found|ENOENT|cannot find/i.test(e.message) ? 'not found' : e.message }); }
  }
  refreshIndexSoon(); // the folder tree changed: rescan it in the background
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
  const saved = db.prefAll()[`apppath:${want}`]; // found once by findAppDeep
  if (saved) { if (fs.existsSync(saved)) return saved; db.prefDel(`apppath:${want}`); }
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
      try { const t = shortcutLaunch(f, shell.readShortcutLink(f), fs.existsSync); if (t) cands.push({ p: t, s: base === want ? 3 : 2 }); } catch {}
    });
  }
  if (!cands.length) { const s = storeApp(name); if (s) return s; } // Store app (WhatsApp, Netflix…): before the slow folder walk
  if (!cands.length) {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], path.join(process.env.LOCALAPPDATA || '', 'Programs'), process.env.LOCALAPPDATA].filter(Boolean);
    for (const r of roots) walk(r, 3, (f, n) => { if (/\.exe$/i.test(n) && !bad.test(n) && normName(n.replace(/\.exe$/i, '')).includes(want)) cands.push({ p: f, s: 1 }); });
  }
  cands.sort((a, b) => b.s - a.s || a.p.length - b.p.length);
  return cands[0]?.p || null;
}
// Microsoft Store apps (WhatsApp, Netflix, Spotify from the Store…) have no .exe shortcut, so the Start-menu scan misses
// them. Windows' own Start-apps list has them; they start through shell:AppsFolder\<AppID>. Refreshed every 30 min.
let storeApps = [];
async function loadStoreApps() {
  const r = await runPowerShell('Get-StartApps | Where-Object { $_.AppID -like "*!*" } | ForEach-Object { "$($_.Name)`t$($_.AppID)" }', 20000);
  const list = r.out.split(/\r?\n/).map((l) => l.split('\t')).filter((a) => a.length === 2 && a[0].trim() && a[1].trim()).map(([n, id]) => ({ name: n.trim(), id: id.trim() }));
  if (list.length) storeApps = list;
  dlog('store apps:', storeApps.length);
}
function storeApp(name) {
  const want = normName(name);
  if (!want) return null;
  const hit = storeApps.filter((a) => { const b = normName(a.name); return b === want || b.startsWith(want) || (want.length > 3 && b.includes(want)); })
    .sort((a, b) => (normName(a.name) === want ? 0 : 1) - (normName(b.name) === want ? 0 : 1) || a.name.length - b.name.length)[0];
  return hit ? `shell:AppsFolder\\${hit.id}` : null;
}
const isStoreTarget = (p) => /^shell:AppsFolder\\/i.test(String(p));
// Start a program (or a Store app) without waiting for it.
// Browser profiles, read from the browser's own "Local State" file: [{ dir: "Profile 1", name: "Kevin", email: "kevin@gmail.com" }].
// Opening a link with --profile-directory=<dir> uses that profile's saved sign-ins instead of a fresh, logged-out one.
const PROFILE_ROOTS = { chrome: ['Google', 'Chrome'], edge: ['Microsoft', 'Edge'], brave: ['BraveSoftware', 'Brave-Browser'] };
function browserProfiles(browser = 'chrome') {
  const parts = PROFILE_ROOTS[browser];
  if (!parts) return [];
  try {
    const j = JSON.parse(fs.readFileSync(path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), ...parts, 'User Data', 'Local State'), 'utf8').replace(/^\uFEFF/, ''));
    const cache = j?.profile?.info_cache || {};
    return Object.entries(cache).map(([dir, v]) => ({ dir, name: String(v.name || v.gaia_name || dir), email: String(v.user_name || '') }));
  } catch { return []; }
}
// ---- the catalog ("know my PC"): scanners feed src/fast/catalog.js; nothing here is a list of names ----
let catalogBusy = false;
async function refreshCatalog() {
  if (catalogBusy) return; catalogBusy = true;
  try {
    const items = [], ran = new Set();
    // Start-menu shortcuts, WITH their arguments (Chrome apps such as Spotify are shortcuts to chrome_proxy.exe --app-id=...)
    try {
      const pd = process.env.ProgramData || 'C:\\ProgramData';
      const stack = [path.join(pd, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')].map((r) => [r, 0]);
      while (stack.length) {
        const [dir, dep] = stack.pop();
        let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const e of ents) {
          const f = path.join(dir, e.name);
          if (e.isDirectory()) { if (dep < 3) stack.push([f, dep + 1]); continue; }
          if (!/\.lnk$/i.test(e.name)) continue;
          try { const it = classifyShortcut(e.name.replace(/\.lnk$/i, ''), f, shell.readShortcutLink(f), fs.existsSync); if (it) items.push(it); } catch {}
        }
      }
      ran.add('startmenu');
    } catch {}
    if (storeApps.length) { items.push(...storeItems(storeApps)); ran.add('store'); }
    try {
      const r = await runPowerShell('$k = "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*","HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*","HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*"; Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | Select-Object DisplayName,Publisher,InstallLocation,DisplayIcon,SystemComponent,ParentKeyName | ConvertTo-Json -Compress', 25000);
      const i = r.out.indexOf('['); const items2 = i >= 0 ? programItems(r.out.slice(i)) : [];
      if (items2.length) { items.push(...items2); ran.add('registry'); }
    } catch {}
    for (const b of Object.keys(PROFILE_ROOTS)) {
      const base = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), ...PROFILE_ROOTS[b], 'User Data');
      for (const pr of browserProfiles(b)) {
        try { const bm = bookmarkItems(fs.readFileSync(path.join(base, pr.dir, 'Bookmarks'), 'utf8').replace(/^\uFEFF/, ''), b, pr.name); items.push(...bm); ran.add(`bookmarks:${b}:${pr.name}`); } catch {}
      }
    }
    try { // recent files and folders: the shortcuts Windows keeps in Recent
      const rd = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Recent'); const rec = [];
      for (const n of fs.readdirSync(rd).filter((x) => /\.lnk$/i.test(x)).slice(0, 400)) {
        try { const t = shell.readShortcutLink(path.join(rd, n)).target; if (!t) continue; const st = fs.statSync(t); rec.push({ name: path.basename(t), target: t, isDir: st.isDirectory(), mtime: st.mtimeMs }); } catch {}
      }
      items.push(...recentItems(rec)); ran.add('recent');
    } catch {}
    const scanned = buildEntries(items);
    const delta = mergeScan(db.catalogAll(), scanned, Date.now(), ran);
    db.catalogApply(delta);
    if (labelOn()) labelCatalog(50).catch(() => {});
    dlog('catalog:', scanned.length, 'scanned,', delta.removes.length, 'removed; sources', [...ran].length);
  } catch (e) { dlog('catalog failed:', e.message); } finally { catalogBusy = false; }
}
// ---- Stage 4: the model labels your apps (names only, opt-in with "label my pc"; cached by name hash) ----
const askModel = (messages, opts = {}) => aiHandler({ sender: { send() {}, id: -1 } }, messages, false, { attempts: [], promptChars: JSON.stringify(messages).length }, { fast: true, ...opts });
const labelOn = () => { try { return db.prefAll()['catalog:ai'] === 'on'; } catch { return false; } };
let labelBusy = false;
async function labelCatalog(limit = 50) {
  if (labelBusy) return { done: 0, left: 0, busy: true }; labelBusy = true;
  let done = 0, left = 0;
  try {
    const todo = db.catalogAll().filter(needsLabel);
    left = todo.length;
    for (let i = 0; i < Math.min(todo.length, limit); i += 25) {
      const batch = todo.slice(i, i + 25);
      let raw; try { raw = await askModel(labelMessages(batch), { maxTokens: 1500, timeoutMs: 20000 }); } catch (e) { dlog('label ask failed:', e.message); break; }
      for (const [id, lab] of parseLabels(raw, batch)) { const en = batch.find((b) => b.id === id); db.catalogLabel(id, lab, nameHash(en)); done++; }
    }
    left = db.catalogAll().filter(needsLabel).length;
    dlog('catalog labels:', done, 'new,', left, 'still unlabeled');
  } catch (e) { dlog('label failed:', e.message); } finally { labelBusy = false; }
  return { done, left };
}
function launchTarget(target, args = []) {
  const c = isStoreTarget(target)
    ? spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' })
    : isShortcut(target) // a shortcut with arguments (Chrome apps such as Spotify): let Windows start it, so its arguments are kept
      ? spawn('cmd.exe', ['/d', '/c', 'start', '', target, ...args], { detached: true, stdio: 'ignore', windowsHide: true })
      : spawn(target, args, { detached: true, stdio: 'ignore', cwd: path.dirname(target) });
  c.on('error', () => {});
  c.unref();
}
ipcMain.handle('launchApp', (_e, name, file) => {
  const exe = resolveApp(name);
  if (!exe) return { ok: false };
  try {
    launchTarget(exe, file ? [expandEnv(file)] : []);
    return { ok: true, exe };
  } catch (e) { return { ok: false, error: e.message }; }
});
// Rerun a saved task's .bat directly (no AI).
ipcMain.handle('runBat', async (e, id) => {
  syncBats();
  const m = db.listMemory().find((r) => r.id === id);
  if (!m) return { code: 1, out: 'saved .bat not found' };
  const file = path.join(batsDir(), batName(m));
  let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch {}
  if (isRisky(text) && !(await confirmRun(e, 'Run this saved task? It changes things on your PC.', text))) return CANCELLED;
  return runFile(file, false);
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
      try { const t = shortcutLaunch(f, shell.readShortcutLink(f), fs.existsSync); if (t) out.set(t.toLowerCase(), { name: e.name.replace(/\.lnk$/i, ''), path: t }); } catch {}
    }
  }
  return [...out.values()];
}
const scanSystem = () => {
  const dir = path.join(process.env.windir || 'C:\\Windows', 'System32');
  try { return fs.readdirSync(dir).filter((n) => /\.exe$/i.test(n)).map((n) => ({ n, l: n.toLowerCase(), p: path.join(dir, n), e: 'exe', t: 'file' })); } catch { return []; }
};
// Rescan the folder tree in the background (at most once a minute) so what the index says matches the disk.
let lastRefresh = 0;
function refreshIndexSoon() { if (Date.now() - lastRefresh < 60e3) return; lastRefresh = Date.now(); startIndex(true).catch(() => {}); }
async function startIndex(force, deadline = 0) {
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
    await pindex.scan(roots, fs.promises, deadline ? { isStopped: () => Date.now() > deadline } : {});
    if (deadline && Date.now() > deadline) pindex.scannedAt = 0; // cut short: the app finishes it on first launch
    fs.writeFileSync(file, JSON.stringify(pindex.toJSON()));
    dlog('path index ready:', pindex.count, 'entries');
  } catch (e) { dlog('path index failed', e?.message); } finally { indexBusy = false; }
}
// Whole-PC tree (every drive, files + folders), separate from the user-folder tree above so the AI context stays small.
// Used by /search now; meant for AI tasks that need the full PC later. Rescanned at start and every 5 min.
let pcIndex = new PathIndex();
let pcBusy = false;
const pcFile = () => path.join(userDir(), 'pc-index.json');
const drives = () => 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`).filter((d) => fs.existsSync(d));
function loadPcIndex() {
  if (!pcIndex.ready && fs.existsSync(pcFile())) { try { pcIndex = PathIndex.fromJSON(JSON.parse(fs.readFileSync(pcFile(), 'utf8'))); } catch {} }
}
async function startPcIndex() {
  if (pcBusy) return;
  pcBusy = true;
  try {
    loadPcIndex();
    const t = Date.now();
    pcIndex.setApps([...scanApps(), ...storeApps.map((a) => ({ name: a.name, path: `shell:AppsFolder\\${a.id}` }))]); // + Store apps
    await pcIndex.scan(drives(), fs.promises, { maxEntries: 600000, maxDepth: 12 });
    fs.writeFileSync(pcFile(), JSON.stringify(pcIndex.toJSON()));
    dlog('pc index ready:', pcIndex.count, 'entries in', Date.now() - t, 'ms');
    setTimeout(() => { try { pcIndex.pairTable(); } catch {} }, 500); // typo table now, so no search waits for it
  } catch (e) { dlog('pc index failed', e?.message); } finally { pcBusy = false; }
}
// /search filters (Ctrl+P in the drop-up)
const SEARCH_FILTERS = {
  all: {},
  folders: { kind: 'dir' },
  documents: { kind: 'file', ext: 'pdf,doc,docx,xls,xlsx,ppt,pptx,txt,md,csv,rtf,odt' },
  images: { kind: 'file', ext: 'jpg,jpeg,png,gif,webp,heic,svg,bmp' },
  media: { kind: 'file', sections: ['media_library'] },
  apps: { sections: ['installed_apps'] },
};
// shortcut: lookup runs on the main process (a brief block, capped at ~400 ms); move it to a worker if the tree passes ~1M entries.
// "Modified" filter (the index has no dates for most files, so the best name matches are checked on disk).
const SEARCH_TIMES = { today: () => new Date().setHours(0, 0, 0, 0), week: () => Date.now() - 7 * 864e5, month: () => Date.now() - 30 * 864e5, year: () => Date.now() - 365 * 864e5 };
ipcMain.handle('search', (_e, q, filter = 'all', time = 'any') => {
  const t = Date.now();
  const ix = pcIndex.scannedAt ? pcIndex : pindex; // not `ready`: that turns true with just the apps, mid first scan
  const f = SEARCH_FILTERS[filter] || {};
  const since = SEARCH_TIMES[time]?.();
  const opts = { sections: ['installed_apps', 'personal_files', 'media_library'], deadline: t + 400, ...f };
  let hits;
  if (!since) hits = ix.lookup(String(q || ''), { ...opts, limit: 8, exists: (x) => isStoreTarget(x) || fs.existsSync(x) });
  else {
    hits = [];
    for (const h of ix.lookup(String(q || ''), { ...opts, limit: 300 })) {
      if (hits.length >= 8 || Date.now() - t > 700) break;
      try { if (fs.statSync(h.path).mtimeMs >= since) hits.push(h); } catch {} // gone from disk: skipped
    }
  }
  dlog('search', JSON.stringify(q), filter, time, hits.length, 'hits in', Date.now() - t, 'ms');
  const storeName = (x) => storeApps.find((a) => `shell:AppsFolder\\${a.id}` === x)?.name;
  return hits.map((h) => ({ path: h.path, dir: !!h.dir, ...(isStoreTarget(h.path) && { name: storeName(h.path) || 'App', app: true }) }));
});
// File actions from the /search results menu. Paths come from the renderer: only act on existing absolute paths.
const realPath = (p) => { p = String(p || ''); if (!path.isAbsolute(p) || !fs.existsSync(p)) throw new Error('That item no longer exists.'); return path.resolve(p); };
ipcMain.on('reveal', (_e, p) => { try { shell.showItemInFolder(realPath(p)); } catch {} });
// Explorer's icon for a result row. Cached per extension; apps, shortcuts and icon files have their own icon, so per path.
const iconCache = new Map();
ipcMain.handle('fileIcon', async (_e, p) => {
  const ext = path.extname(String(p || '')).toLowerCase();
  const key = !ext || /^\.(exe|lnk|ico|url)$/.test(ext) ? String(p).toLowerCase() : ext;
  if (!iconCache.has(key)) {
    try { iconCache.set(key, (await app.getFileIcon(realPath(p), { size: 'normal' })).toDataURL()); } catch { return ''; }
    if (iconCache.size > 2000) iconCache.delete(iconCache.keys().next().value);
  }
  return iconCache.get(key);
});
ipcMain.handle('fileClip', async (_e, p, cut) => {
  const q = realPath(p).replace(/'/g, "''");
  // Explorer's own clipboard format, so Ctrl+V in any folder pastes (cut = move). Drop effect 2 = move, 5 = copy.
  const r = await runPowerShell(`Add-Type -AssemblyName System.Windows.Forms
$l = New-Object System.Collections.Specialized.StringCollection; [void]$l.Add('${q}')
$d = New-Object System.Windows.Forms.DataObject; $d.SetFileDropList($l)
$d.SetData('Preferred DropEffect', (New-Object System.IO.MemoryStream (,[byte[]](${cut ? 2 : 5},0,0,0))))
[System.Windows.Forms.Clipboard]::SetDataObject($d, $true)`, 10000);
  if (r.code) throw new Error(r.out.trim() || 'Could not use the clipboard.');
});
ipcMain.handle('fileRename', async (_e, p, name) => {
  const from = realPath(p);
  name = String(name || '').trim();
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|]/.test(name) || /[. ]$/.test(name)) throw new Error('That name is not allowed in Windows.');
  const to = path.join(path.dirname(from), name);
  if (to.toLowerCase() !== from.toLowerCase() && fs.existsSync(to)) throw new Error(`${name} already exists there.`);
  await fs.promises.rename(from, to);
  return to;
});
ipcMain.handle('fileTrash', (_e, p) => shell.trashItem(realPath(p))); // Recycle Bin: always recoverable
// Index first (a few ms); the live folder walk only when the index is missing or knows nothing.
async function findSmart(opts = {}) {
  if (pindex.ready && opts.name) {
    const t = Date.now();
    // "in" a folder: the same index, only paths under it (instant; the disk scan below takes up to 8 s)
    const under = opts.in ? path.resolve(os.homedir(), String(opts.in).replace(/%(\w+)%/g, (m, v) => process.env[v] ?? m)).toLowerCase() + path.sep : '';
    const all = pindex.lookup(opts.name, { kind: opts.kind, ext: opts.ext, exists: fs.existsSync, limit: under ? 60 : 8 });
    const inside = all.filter((m) => !under || m.path.toLowerCase().startsWith(under));
    // a wrong folder guess ("documents" when they live in OneDrive) must not hide the file: then anywhere
    const matches = (inside.length ? inside : all).slice(0, 8).map((m) => ({ path: m.path, score: m.score, dir: m.dir }));
    if (matches.length) return { matches, scanned: 0, partial: false, fromIndex: true, ms: Date.now() - t };
  }
  return findFiles(opts);
}
const resolveAppFast = (name) => (pindex.ready && pindex.app(name, fs.existsSync)) || resolveApp(name);

// ---- PowerShell runner (templates and AI scripts)
// Read-only info queries for the PC tables (src/fast/tables.js Q): stdout only, up to 4 MB, JSON parsed when it is JSON.
function psRead(script, ms = 20000) {
  return new Promise((resolve) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${script}`], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => { if (out.length < 4e6) out += d; });
    const timer = setTimeout(() => { try { p.kill(); } catch {} }, ms);
    const fin = () => { clearTimeout(timer); const t = out.trim(); try { resolve(/^[[{]/.test(t) ? JSON.parse(t) : t); } catch { resolve(t); } };
    p.on('error', fin); p.on('close', fin);
  });
}
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

// A playlist in the player this PC really uses for that kind of song. A .m3u often has no working default on Windows
// (it shows "Pick an application"), so: the song type's own player with the playlist, else Windows Media Player, else the first song.
async function openPlaylist(m3u, firstSong) {
  const ext = path.extname(firstSong || '.mp3') || '.mp3';
  const r = await psRead(`Add-Type -Namespace A -Name Q -MemberDefinition '[DllImport("shlwapi.dll",CharSet=CharSet.Unicode)] public static extern uint AssocQueryString(int f,int s,string a,string e,System.Text.StringBuilder o,ref uint n);'; $sb=New-Object Text.StringBuilder 1024; $n=[uint32]1024; [void][A.Q]::AssocQueryString(0,2,'${ext.replace(/[^.\w]/g, '')}',$null,$sb,[ref]$n); $sb.ToString()`, 8000).catch(() => '');
  const exe = String(r || '').trim();
  const ok = (p) => p && /\.exe$/i.test(p) && !/openwith|windowsapps/i.test(p) && fs.existsSync(p);
  const wmp = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map((d) => path.join(d, 'Windows Media Player', 'wmplayer.exe')).find((p) => fs.existsSync(p));
  const use = ok(exe) ? exe : wmp;
  if (use) { launchTarget(use, [m3u]); return ''; }
  return shell.openPath(firstSong);
}

// The in-app music player's songs: a tiny HTTP server on 127.0.0.1 only, with a random secret in every link, that
// serves audio files from the allowed folders with byte ranges (the audio element seeks; m4a keeps its index at the end).
const MEDIA_MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wma: 'audio/x-ms-wma', webm: 'audio/webm' };
const media = { port: 0, key: createHash('sha256').update(`${Math.random()}${Date.now()}${process.pid}`).digest('hex').slice(0, 32) };
const mediaUrl = (p) => (media.port ? `http://127.0.0.1:${media.port}/${media.key}/song?p=${encodeURIComponent(p)}` : '');
function startMediaServer() {
  const srv = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      const p = u.searchParams.get('p') || '', ext = path.extname(p).slice(1).toLowerCase();
      if (!u.pathname.startsWith(`/${media.key}/`) || !MEDIA_MIME[ext] || !isInside(p, allowedFolders()) || !fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
      const size = fs.statSync(p).size;
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      const start = m && m[1] ? Number(m[1]) : 0, end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
      res.writeHead(m ? 206 : 200, { 'Content-Type': MEDIA_MIME[ext], 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(m ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}), 'Cache-Control': 'no-store' });
      fs.createReadStream(p, { start, end }).on('error', () => res.destroy()).pipe(res);
    } catch { try { res.writeHead(500); res.end(); } catch {} }
  });
  srv.on('error', (e) => dlog('media server failed', e.message));
  srv.listen(0, '127.0.0.1', () => { media.port = srv.address().port; dlog('media server on', media.port); });
}

// Media control of an app that is ALREADY open (any player): Windows' media sessions tell the real state (paused /
// playing), so "play" only ever plays and never toggles a playing film off. Players without a session: their window is
// brought forward and the media key is pressed (said honestly). Returns { running, via, before, after, title }.
const MEDIA_APPS = { potplayer: ['PotPlayer', 'PotPlayer'], vlc: ['vlc', 'vlc'], spotify: ['Spotify', 'Spotify'], aimp: ['AIMP', 'AIMP'],
  browser: ['chrome|msedge|firefox|brave|opera', 'chrome|msedge|firefox|brave|opera'], 'media player': ['ZuneMusic|ZuneVideo|Media', 'Microsoft.Media.Player|wmplayer'], netflix: ['Netflix', 'Netflix|WWAHost'] };
async function mediaControl(app, op) {
  const [sess, proc] = MEDIA_APPS[app] || ['', ''];
  const arg = Buffer.from(JSON.stringify({ sess, proc, op: String(op) }), 'utf8').toString('base64');
  const script = [
    "$a = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + arg + "')) | ConvertFrom-Json",
    "$out = @{ running = $false; via = 'none' }",
    'try {',
    '  Add-Type -AssemblyName System.Runtime.WindowsRuntime',
    "  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
    '  function Await($o, $t) { $k = $asTask.MakeGenericMethod($t).Invoke($null, @($o)); [void]$k.Wait(4000); $k.Result }',
    '  [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]',
    '  $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])',
    "  $s = if ($a.sess) { $mgr.GetSessions() | Where-Object { $_.SourceAppUserModelId -match $a.sess } | Select-Object -First 1 } else { $mgr.GetCurrentSession() }",
    '  if ($s) {',
    "    $out.running = $true; $out.via = 'session'; $out.app = $s.SourceAppUserModelId",
    '    $out.before = [string]$s.GetPlaybackInfo().PlaybackStatus',
    "    switch ($a.op) { 'play' { if ($out.before -ne 'Playing') { [void](Await ($s.TryPlayAsync()) ([bool])) } } 'pause' { if ($out.before -eq 'Playing') { [void](Await ($s.TryPauseAsync()) ([bool])) } } 'toggle' { [void](Await ($s.TryTogglePlayPauseAsync()) ([bool])) } 'next' { [void](Await ($s.TrySkipNextAsync()) ([bool])) } 'prev' { [void](Await ($s.TrySkipPreviousAsync()) ([bool])) } }",
    '    Start-Sleep -Milliseconds 500',
    '    $out.after = [string]$s.GetPlaybackInfo().PlaybackStatus',
    '    try { $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]); $out.title = $p.Title } catch {}',
    '  }',
    '} catch {}',
    "if ($out.via -eq 'none' -and $a.proc) {",
    "  $w = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.ProcessName -match $a.proc } | Select-Object -First 1",
    '  if ($w) {',
    "    $out.running = $true; $out.via = 'keys'; $out.title = $w.MainWindowTitle",
    '    [void](New-Object -ComObject WScript.Shell).AppActivate($w.Id); Start-Sleep -Milliseconds 300',
    "    Add-Type -Namespace K -Name B -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte k, byte s, uint f, System.UIntPtr e);'",
    "    $vk = switch ($a.op) { 'next' { 0xB0 } 'prev' { 0xB1 } default { 0xB3 } }",
    '    [K.B]::keybd_event($vk, 0, 0, [UIntPtr]::Zero); [K.B]::keybd_event($vk, 0, 2, [UIntPtr]::Zero)',
    '  }',
    '}',
    '$out | ConvertTo-Json -Compress',
  ].join('\n');
  const r = await runPowerShell(script, 15000);
  try { return JSON.parse(String(r.out).trim().split('\n').pop()); } catch { return { running: false, via: 'error', error: String(r.out).slice(0, 200) }; }
}

// ---- Learning about the user (Settings › "Learn about me", on by default). After every few messages, the model reads
// the latest ones and keeps the lasting things (who they are, likes, people, places, routines); once, a catch-up pass
// reads the requests of the past weeks. Everything lands in "About you", where the user sees and deletes it.
const learningOn = () => { try { return (db.getSetting('prefs', {}) || {}).learning !== false; } catch { return true; } };
let learnBusy = false, learnCount = 0;
async function learnFrom(texts) {
  if (learnBusy || !learningOn() || !net.isOnline() || !texts.length) return 0;
  learnBusy = true;
  try {
    const known = db.listProfile();
    const raw = await askModel(learnMessages(known, texts), { maxTokens: 700, timeoutMs: 25000 });
    const add = parseLearned(raw, known);
    for (const m of add) db.addProfile(m.kind, m.text);
    if (add.length) dlog('learned', add.map((m) => m.text).join(' | '));
    return add.length;
  } catch (e) { dlog('learn failed', e.message); return 0; } finally { learnBusy = false; }
}
ipcMain.on('learnTick', () => { if (++learnCount % 5 === 0) learnFrom(db.recentTasks(30)).catch(() => {}); });
// one catch-up over everything asked so far (the timing log keeps every request), in a few small passes
async function learnCatchUp() {
  if (db.getSetting('learnCatchUp', 0) >= 1 || !learningOn()) return;
  let texts = [];
  try { texts = fs.readFileSync(timingFile(), 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l).text; } catch { return ''; } }); } catch {}
  texts = [...new Set([...texts, ...db.recentTasks(200)].map((t) => String(t || '').trim()).filter((t) => t.length > 8))].slice(-320);
  for (let i = 0; i < texts.length; i += 80) { await learnFrom(texts.slice(i, i + 80)); await new Promise((r) => setTimeout(r, 4000)); }
  db.setSetting('learnCatchUp', 1);
}
// habits, counted from what the user does (no AI): for the AI's prompt
ipcMain.handle('habits', () => { try { return habitLines({ ...db.habitRows(), alarms: clockStore.list().filter((r) => r.kind === 'alarm').map((r) => r.at) }); } catch { return []; } });

// Reminders: a Windows notification at the time. Saved in prefs, so a restart before the time still fires them.
const remTimers = new Map();
const remList = () => { try { return JSON.parse(db.prefAll().reminders || '[]'); } catch { return []; } };
// every change reaches every window, so all timer cards (chat, floating card) show the same state
const remSave = (l) => { db.prefSet('reminders', JSON.stringify(l)); setTimeout(() => { for (const w of BrowserWindow.getAllWindows()) try { w.webContents.send('clock-changed'); } catch {} }, 0); };
// Timers and alarms ring INSIDE Genisys: the main window comes forward with a ringing card and its own sound
// (the renderer makes it, see toolcards.js ringCard). The Windows notification is only the backup when the window is hidden.
const userInApp = () => !!mainWin && !mainWin.isDestroyed() && mainWin.isVisible() && !mainWin.isMinimized() && mainWin.isFocused();
const ring = (r) => {
  const msg = { kind: r.kind || 'reminder', text: r.text, at: r.at };
  if (userInApp()) mainWin.webContents.send('clock-ring', msg);
  else showTool({ ring: msg }); // away from Genisys: it rings in the small card at the bottom-right
};

// Floating tool card (bottom-right of the screen, always on top, never takes focus): the live tool (timer, stopwatch,
// music) while the user is in another app, and timers / alarms that go off. Hidden again when they come back.
let toolWin = null, toolActive = null, toolPinned = false, toolPending = null;
function showTool(msg) {
  const wa = screen.getPrimaryDisplay().workArea;
  const w = 300, h = toolWin ? toolWin.getBounds().height : 220;
  const bounds = { x: wa.x + wa.width - w - 12, y: wa.y + wa.height - h - 12, width: w, height: h };
  if (!toolWin) {
    toolPending = msg;
    toolWin = new BrowserWindow({ ...bounds, frame: false, transparent: true, hasShadow: false, thickFrame: false, roundedCorners: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, focusable: true, show: false,
      icon: path.join(ASSETS, 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false } });
    toolWin.setAlwaysOnTop(true, 'floating');
    const query = { mode: 'tool' };
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) toolWin.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}?${new URLSearchParams(query)}`);
    else toolWin.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), { query });
    toolWin.on('closed', () => { toolWin = null; });
    return;
  }
  toolWin.webContents.send('tool-show', msg);
  if (!toolWin.isVisible()) toolWin.showInactive();
}
function hideTool() { toolPinned = false; if (toolWin && !toolWin.isDestroyed()) { toolWin.webContents.send('tool-stop'); toolWin.hide(); } }
ipcMain.on('toolReady', () => { if (toolWin && toolPending) { toolWin.webContents.send('tool-show', toolPending); toolPending = null; toolWin.showInactive(); } });
ipcMain.on('toolSize', (_e, h) => {
  if (!toolWin || !Number.isFinite(h)) return;
  const wa = screen.getPrimaryDisplay().workArea, b = toolWin.getBounds();
  const height = Math.max(120, Math.min(Math.round(h), wa.height - 40));
  if (height !== b.height) toolWin.setBounds({ ...b, y: wa.y + wa.height - height - 12, height });
});
// the main window says what is live; while the user is away the floating card follows it (new song, timer gone…)
ipcMain.on('toolActive', (_e, data) => {
  toolActive = data || null;
  if (toolWin?.isVisible() && !toolWin.webContents.isLoading()) { if (toolActive) toolWin.webContents.send('tool-show', { card: toolActive }); else if (!toolPinned) hideTool(); }
});
ipcMain.on('toolFloat', (_e, data) => { if (data) { toolPinned = true; showTool({ card: data }); } }); // "pop out" from a card in the chat
// closed by the user: it stays closed (the same timer does not come back on the next minimize)
ipcMain.on('toolHide', () => { toolActive = null; hideTool(); });
// is the remembered live tool still live? (bug: a cancelled / finished timer came back as a dead, "stuck" card)
const toolStillLive = (a) => {
  if (!a) return false;
  if (a.type === 'timer') return clockStore.list().some((r) => r.kind === 'timer' && r.paused == null && (a.id ? r.id === a.id : true) && r.at > Date.now());
  if (a.type === 'stopwatch') return stopwatch.status().running;
  return true; // music: the main window says when it stops
};
ipcMain.on('toolOpenApp', () => { hideTool(); if (mainWin && !mainWin.isDestroyed()) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); } });
ipcMain.on('toolCmd', (_e, cmd) => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('tool-cmd', String(cmd)); });
const TITLE = { reminder: 'Genisys reminder', timer: "Time's up", alarm: 'Alarm' };
function remArm(r) {
  if (remTimers.has(r.id) || r.paused != null) return; // a paused timer waits for resume
  remTimers.set(r.id, setTimeout(() => {
    remTimers.delete(r.id);
    // only reminders use a Windows notification; timers and alarms ring in Genisys itself (chat or floating card)
    if (r.kind !== 'timer' && r.kind !== 'alarm') { try { new Notification({ title: TITLE.reminder, body: r.text }).show(); } catch {} }
    ring(r);
    clockStore.done(r.id);
    try { db.toolLog(r.kind === 'reminder' || !r.kind ? 'remind' : r.kind, r.text, 'rang', true); } catch {}
  }, Math.max(0, Math.min(r.at - Date.now(), 2 ** 31 - 1))));
}
// add / cancel / pause / resume / missed-at-start: the tested store (clockstore.js) over the saved list and the timeouts above
const clockStore = makeClockStore({ load: remList, save: remSave, arm: remArm, disarm: (id) => { clearTimeout(remTimers.get(id)); remTimers.delete(id); } });
const addReminder = (...a) => clockStore.add(...a);
// One stopwatch, kept in memory (like the phone's).
const sw = { start: 0, acc: 0 };
const swNow = () => sw.acc + (sw.start ? Date.now() - sw.start : 0);
const stopwatch = {
  start: () => { const was = !!sw.start; if (!sw.start) sw.start = Date.now(); return { was, ms: swNow() }; },
  stop: () => { const ran = !!sw.start; sw.acc = swNow(); sw.start = 0; return { ran, ms: sw.acc }; },
  status: () => ({ running: !!sw.start, ms: swNow() }),
  reset: () => { sw.start = 0; sw.acc = 0; return { ms: 0 }; },
};
// Notes: one plain text file in Documents, so the user can open it in any editor too.
const notes = { add: (t, l) => db.memoAdd(t, l), list: (l) => db.memoList(l), done: (id, v) => db.memoDone(id, v), del: (id) => db.memoDel(id) }; // in Genisys's own database
// At start: the future ones are armed. A timer or alarm that was due while Genisys was closed does not ring late (a phone
// doesn't either): it is logged as missed and one quiet note says so. A missed reminder is still shown, it is a to-do.
const armReminders = () => {
  const late = clockStore.startup();
  for (const r of late) try { db.toolLog(r.kind, r.text, `missed (was due ${new Date(r.at).toLocaleString()}, Genisys was closed)`, false); } catch {}
  if (late.length) try { new Notification({ title: 'Genisys', body: `Missed while Genisys was closed: ${late.map((r) => r.label || r.text).join(', ')}` }).show(); } catch {}
};

// chat_send: focus the chat app, search the contact, open the top match, paste the file (or type the text).
// Values travel as base64 JSON, never inside the script text. It never presses the final Enter: the user sends.
async function chatSend(o) {
  const b64 = Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
  const r = await runPowerShell(`
$a = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')) | ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms
$ws = New-Object -ComObject WScript.Shell
function Keys($s) { [System.Windows.Forms.SendKeys]::SendWait($s) }
function Lit($s) { ($s -replace '([+^%~(){}\\[\\]])', '{$1}') }
$ok = $false
for ($i = 0; $i -lt 16 -and -not $ok; $i++) { Start-Sleep -Milliseconds 500; $ok = $ws.AppActivate($a.title) }
if (-not $ok) { Write-Output 'NOWINDOW'; exit 2 }
Start-Sleep -Milliseconds 800
if ($a.path) { Set-Clipboard -Path $a.path }
Keys $a.search; Start-Sleep -Milliseconds 500
Keys (Lit $a.to); Start-Sleep -Milliseconds 1500
Keys '{ENTER}'; Start-Sleep -Milliseconds 1200
if ($a.path) { Keys '^v' } else { Keys (Lit $a.text) }
Write-Output 'OK'`, 30000);
  return /\bOK\b/.test(r.out) ? { ok: true } : { ok: false, error: /NOWINDOW/.test(r.out) ? 'its window did not come up' : 'the keys could not be sent' };
}

// An app the quick lookups miss (installed deep in a folder, odd name): search harder once, then remember where it is.
const appPathKey = (name) => `apppath:${normName(String(name || ''))}`;
async function findAppDeep(name) {
  const want = normName(String(name || ''));
  if (want.length < 3) return null;
  const b64 = Buffer.from(JSON.stringify({ want: String(name).trim() }), 'utf8').toString('base64');
  const r = await runPowerShell(`
$w = ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')) | ConvertFrom-Json).want
$n = ($w -replace '[^A-Za-z0-9]', '')
$hit = Get-ChildItem 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths' -ErrorAction SilentlyContinue | Where-Object { ($_.PSChildName -replace '[^A-Za-z0-9]', '') -like "*$n*" } | ForEach-Object { (Get-ItemProperty $_.PSPath).'(default)' } | Select-Object -First 1
if (-not $hit) { $c = Get-Command "$n.exe" -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $hit = $c.Source } }
if (-not $hit) {
  $roots = @($env:ProgramFiles, \${env:ProgramFiles(x86)}, $env:LOCALAPPDATA, $env:APPDATA) + (Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -ne "$env:SystemDrive\\" -and $_.Free -ne $null } | ForEach-Object { $_.Root })
  $t0 = Get-Date
  foreach ($r in $roots | Where-Object { $_ -and (Test-Path $_) }) {
    if (((Get-Date) - $t0).TotalSeconds -gt 18) { break }
    $f = Get-ChildItem $r -Recurse -Depth 6 -Filter "*$n*.exe" -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch 'unins|setup|update|crash|helper' } | Sort-Object { $_.Name.Length } | Select-Object -First 1
    if ($f) { $hit = $f.FullName; break }
  }
}
if ($hit) { Write-Output ("FOUND:" + ($hit -replace '"', '')) }`, 25000);
  const m = /FOUND:(.+)/.exec(r.out || '');
  const p = m && m[1].trim();
  if (!p || !fs.existsSync(p)) return null;
  db.prefSet(appPathKey(name), p);
  return p;
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
    spawnDetached: (exe, args) => launchTarget(exe, args),
    findFiles: findSmart,
    paths,
    exists: (p) => fs.existsSync(p),
    isDir: (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
    scanFiles: (root) => scanFiles(root, fs.promises),
    refreshIndex: () => refreshIndexSoon(),
    browserProfiles: (b) => browserProfiles(b),
    writePdf: (file, html, text) => printPdf(file, html, { text }),
    chatSend,
    findAppDeep,
    remind: addReminder,
    clock: clockStore,
    stopwatch,
    notes,
    openPlaylist,
    mediaControl,
    weather: async (place) => (await fetch(`https://wttr.in/${encodeURIComponent(String(place || '').slice(0, 60))}?format=j1`, { headers: { 'User-Agent': 'curl/8', Accept: 'application/json' }, signal: AbortSignal.timeout(7000) })).json(),
    mediaUrl,
    tempDir: os.tmpdir(),
    prefs: () => db.prefAll(),
    prefSet: (k, v) => db.prefSet(k, v),
    prefDel: (k) => db.prefDel(k),
    prefBump: (k) => db.prefBump(k),
    catalog: () => db.catalogAll(),
    catalogRefresh: () => refreshCatalog(),
    learned: () => { try { return db.learnAll(); } catch { return {}; } },
    learn: (q, id, dw, dl) => { try { db.learnBump(q, id, dw, dl); } catch {} },
    confuse: (c) => { try { db.confusionAdd(c); } catch {} },
    confusions: (n) => { try { return db.confusionRecent(n); } catch { return []; } },
    labelOn,
    labelRun: async () => { db.prefSet('catalog:ai', 'on'); if (!db.catalogAll().length) await refreshCatalog(); return labelCatalog(200); },
    labelOff: () => db.prefSet('catalog:ai', 'off'),
    ask: (messages, opts) => askModel(messages, opts),
    catalogTouch: (text) => { // an opened thing gets +1 use: found by its normalized name or alias
      try { const q = catKey(text); if (!q) return; const e = db.catalogAll().find((x) => x.key === q || (x.aliases || []).includes(q)); if (e) db.catalogUse(e.id); } catch {}
    },
    hashOf: (f) => hashSample(f, fs.promises, createHash),
    sysQuery: (script) => psRead(script),
    // every process whose exe name contains `name` -> { count, mb } (working set, like Task Manager's "memory")
    procMem: (name) => new Promise((resolve) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000 }, (e, out) => {
      if (e) return resolve(null);
      let count = 0, kb = 0;
      for (const l of String(out).split(/\r?\n/)) { const c = l.split('","'); if (c.length < 5 || !c[0].replace(/^"/, '').toLowerCase().includes(name)) continue; count++; kb += Number(c[4].replace(/[^\d]/g, '')) || 0; }
      resolve({ count, mb: Math.round(kb / 1024) });
    })),
    totalRam: os.totalmem(),
    isAllowed: (p) => isInside(p, allowedFolders()),
    mkdirp: (p) => fs.mkdirSync(p, { recursive: true }),
    writeFile: (p, c) => fs.writeFileSync(p, c),
    readFile: (p) => (/\.pdf$/i.test(p) ? (() => { try { return fs.readFileSync(pdfSrc(p), 'utf8'); } catch { return '(a PDF made outside Genisys: its text cannot be read)'; } })() : fs.readFileSync(p, 'utf8')),
    listDir: (p) => fs.readdirSync(p, { withFileTypes: true }).map((e) => (e.isDirectory() ? `${e.name}\\` : e.name)),
    statPath: (p) => { // size of one file, or of a whole folder (capped so a huge drive cannot hang the app)
      try {
        const st = fs.statSync(p);
        if (!st.isDirectory()) return { isDir: false, size: st.size, mtime: st.mtimeMs, birth: st.birthtimeMs };
        let size = 0, items = 0, seen = 0; const stack = [p];
        while (stack.length && seen < 200000) for (const e of fs.readdirSync(stack.pop(), { withFileTypes: true })) { seen++; const f = path.join(e.parentPath || e.path, e.name); if (e.isDirectory()) stack.push(f); else { try { size += fs.statSync(f).size; items++; } catch {} } }
        return { isDir: true, size, items, mtime: st.mtimeMs, birth: st.birthtimeMs };
      } catch { return null; }
    },
    copy: (a, b) => fs.cpSync(a, b, { recursive: true, errorOnExist: true, force: false }),
    move: (a, b) => fs.renameSync(a, b),
    trash: (p) => shell.trashItem(p),
    system: makeSystem({
      helper,
      openExternal: (u) => shell.openExternal(u),
      launch: (exe, args) => { const c = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: true }); c.on('error', () => {}); c.unref(); },
      os,
      statfs: (p) => { try { return fs.statfsSync(p); } catch { return null; } },
    }),
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
const LOGGED_TOOLS = new Set(['weather', 'timer', 'alarm', 'remind', 'stopwatch', 'note', 'quick', 'world_time', 'play_music', 'chat_send']);
ipcMain.handle('fast', async (_e, action, params, confirmed) => {
  const t = Date.now();
  try {
    const { reg, A } = getFast();
    const spec = reg.get(action);
    if (!spec) return { status: 'fall', reason: `unknown action ${action}` };
    const v = validateParams(spec, boolsToText(params), { isAllowed: (p) => isInside(p, allowedFolders()) });
    if (!v.ok) return { status: 'fall', reason: v.error };
    const r = spec.template ? await runTemplate(spec, v.params, !!confirmed) : await A[spec.native](v.params, !!confirmed);
    if (LOGGED_TOOLS.has(action) && r.status !== 'fall' && v.params.op !== 'status') { // the Tools page: what each tool did, and when
      const req = Object.entries(v.params).filter(([k, x]) => x !== '' && x != null && !/^(id|total)$/.test(k)).map(([k, x]) => (k === 'at' ? `at ${new Date(Number(x)).toLocaleString()}` : `${k} ${x}`)).join(', ');
      try { db.toolLog(action, req, r.message || r.status, r.status === 'done'); } catch {}
    }
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
ipcMain.handle('scriptRun', async (e, script, _confirmed, command) => {
  script = String(script || '');
  const check = scriptCheckNow(script);
  if (check.level === 'block') return { status: 'blocked', check };
  if (!(await confirmRun(e, 'Genisys needs to run a small program on your PC to do this. Go ahead?', `${check.reasons?.length ? `${check.reasons.join('; ')}\n\n` : ''}${script}`))) return { status: 'refused', check };
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
const SIZES = { main: [1100, 760], agent: [614, 326], script: [1040, 900] /* taller than the others: room for code */, runner: [740, 78] };
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
    // Frameless + opaque: Windows 11 rounds the window corners natively (roundedCorners) and keeps its shadow and edge resizing.
    // Not transparent (it breaks native rounding/resizing) and thickFrame is left at its default (true).
    resizable: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1917' : '#f6f3ef',
    roundedCorners: true,
    icon: path.join(ASSETS, 'icon.png'),
    show: false, // shown by showWhenReady below (an --autostart main window stays hidden)
    // Frameless: our own red/yellow/green dots in #bar replace Windows' min/max/close.
    frame: false,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  const qs = new URLSearchParams(query).toString();
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) win.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}?${qs}`);
  else win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), { query });
  if (!(query.mode === 'main' && process.argv.includes('--autostart'))) showWhenReady(win, () => win.show());
  return win;
};

// Alt+Space runner: a small glass bar, bottom center, 100px above the taskbar. Kept loaded and hidden, so the hotkey only
// shows it (instant). Each hide reloads the page in the background: the next Alt+Space is a fresh, empty bar again.
let runnerWin = null, runnerShown = false, runnerReady = false;
const runnerBounds = () => {
  const wa = screen.getPrimaryDisplay().workArea;
  const [w, h] = SIZES.runner;
  return { width: w, height: h, x: Math.round(wa.x + (wa.width - w) / 2), y: wa.y + wa.height - 100 - h };
};
function makeRunner() {
  if (runnerWin) return;
  runnerReady = false;
  runnerWin = new BrowserWindow({
    ...runnerBounds(),
    frame: false, transparent: true, hasShadow: false, thickFrame: false, roundedCorners: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false,
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  const query = { mode: 'runner', id: 0, title: '~/runner' };
  const qs = new URLSearchParams(query).toString();
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) runnerWin.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}?${qs}`);
  else runnerWin.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), { query });
  // Above everything: other topmost windows, full-screen apps and the taskbar.
  runnerWin.setAlwaysOnTop(true, 'screen-saver');
  runnerWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  runnerWin.on('show', () => runnerWin?.moveTop());
  runnerWin.pinned = false; // once a task is sent the panel stays open until Esc / ✕
  runnerWin.on('blur', () => { if (runnerShown && !runnerWin?.pinned) hideRunnerWin(); });
  runnerWin.webContents.on('did-start-loading', () => { runnerReady = false; });
  runnerWin.on('closed', () => { runnerWin = null; runnerShown = false; runnerReady = false; });
}
function showRunnerNow() {
  if (!runnerWin || runnerWin.isDestroyed() || !runnerShown) return;
  runnerWin.show(); runnerWin.moveTop(); runnerWin.focus();
  runnerWin.webContents.send('runner-show'); // the page starts listening only now (never while hidden)
  dlog('runner shown');
}
function hideRunnerWin() {
  if (!runnerWin || !runnerShown) return;
  runnerShown = false;
  runnerWin.hide();
  runnerWin.pinned = false;
  runnerWin.setBounds(runnerBounds());
  runnerWin.webContents.reload(); // drop this session's chat, mic and speech; ready for the next Alt+Space
  // a timer / stopwatch started from the command bar keeps showing: bottom-right, until the user is back in Genisys
  setTimeout(() => { if (toolActive && !toolStillLive(toolActive)) toolActive = null; if (toolActive && !userInApp()) showTool({ card: toolActive }); }, 200);
}
function toggleRunner() {
  dlog(`runner hotkey (${runnerShown ? 'hide' : runnerReady ? 'show, preloaded' : 'show, still loading'})`);
  if (runnerShown) return hideRunnerWin();
  makeRunner();
  runnerShown = true;
  if (runnerReady) showRunnerNow();
  else showWhenReady(runnerWin, showRunnerNow, 3000); // first press before it finished loading: shown when its page is ready
}
ipcMain.on('pageReady', (e) => { if (runnerWin && !runnerWin.isDestroyed() && e.sender === runnerWin.webContents) runnerReady = true; });
ipcMain.on('hideRunner', () => hideRunnerWin());
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
  const w = 330, h = todoWin ? todoWin.getBounds().height : Math.min(460, 150 + (st.rows ?? st.items?.length ?? 0) * 34); // then the page reports its real height
  const bounds = { x: wa.x + wa.width - w - 16, y: wa.y + wa.height - h - 16, width: w, height: h };
  if (!todoWin) {
    todoWin = new BrowserWindow({ ...bounds, frame: false, transparent: true, hasShadow: false, thickFrame: false, roundedCorners: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false,
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
ipcMain.on('todoSize', (_e, h) => {
  if (!todoWin || !Number.isFinite(h)) return;
  const wa = screen.getPrimaryDisplay().workArea, b = todoWin.getBounds();
  const height = Math.max(120, Math.min(Math.round(h), Math.min(520, wa.height - 40)));
  if (height !== b.height) todoWin.setBounds({ ...b, y: wa.y + wa.height - height - 16, height });
});
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
  // The script writer is a real editor: centred and big (capped to the screen), not a small tile.
  const wa = screen.getPrimaryDisplay().workArea;
  const big = kind === 'script' ? { w: Math.min(SIZES.script[0], wa.width - 40), h: Math.min(SIZES.script[1], wa.height - 40) } : null;
  const { slot, x, y } = big ? { slot: -1, x: wa.x + Math.round((wa.width - big.w) / 2), y: wa.y + Math.round((wa.height - big.h) / 2) } : placeTile(...SIZES[kind]);
  const query = { mode: kind, id, title, task };
  if (opts.web) query.web = '1';
  if (opts.child) query.child = '1';
  if (opts.group) { query.group = opts.group; query.idx = String(opts.idx ?? 0); if (parentId != null) groupParent.set(opts.group, parentId); }
  const win = createWindow(query, big ? { x, y, width: big.w, height: big.h } : { x, y });
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
ipcMain.on('open', (e, kind, task, opts) => openAgent('agent', String(task || ''), opts || {}, e.sender.id)); // Script Writer is off for now
// Several windows at once, a moment apart so the machine isn't hit by 8 window creations in one frame.
ipcMain.on('openMany', (e, specs) => {
  const pid = e.sender.id;
  [].concat(specs || []).slice(0, 8).forEach((sp, i) => setTimeout(() => openAgent('agent', String(sp.task || ''), sp.opts || {}, pid), i * 160));
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
  const h = SIZES.runner[1] + Math.max(0, Math.min(560, Math.round(extra || 0)));
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
// PC specs (no personal data): kept in pc-specs.json for future features and sent with the account so the developer sees them.
async function readSpecs() {
  const cpus = os.cpus();
  const d = screen.getPrimaryDisplay();
  let gpu = '';
  try { gpu = (await app.getGPUInfo('complete'))?.auxAttributes?.glRenderer || ''; } catch {}
  let disk = null;
  try { const st = fs.statfsSync('C:\\'); disk = { sizeGB: Math.round((st.blocks * st.bsize) / 1073741824), freeGB: Math.round((st.bavail * st.bsize) / 1073741824) }; } catch {}
  return {
    os: `${os.version()} (${os.release()})`, cpu: (cpus[0]?.model || '').trim(), cores: cpus.length,
    ramGB: Math.round(os.totalmem() / 1073741824), gpu: gpu.replace(/^ANGLE \((.*)\)$/, '$1').slice(0, 120),
    screen: `${Math.round(d.size.width * d.scaleFactor)}x${Math.round(d.size.height * d.scaleFactor)}`, disk, app: app.getVersion(), at: Date.now(),
  };
}
const specsFile = () => path.join(app.getPath('userData'), 'pc-specs.json');
const saveSpecs = async () => { const sp = await readSpecs(); fs.mkdirSync(path.dirname(specsFile()), { recursive: true }); fs.writeFileSync(specsFile(), JSON.stringify(sp)); return sp; };

// Installer step: capture the folder tree + specs before the first launch, then exit. Never holds the installer > 60 s.
async function prepare() {
  const hard = setTimeout(() => app.exit(0), 60000);
  try { await saveSpecs(); } catch (e) { dlog('prepare specs failed', e?.message); }
  try { await startIndex(true, Date.now() + 50000); } catch (e) { dlog('prepare index failed', e?.message); }
  clearTimeout(hard);
  app.exit(0);
}

app.whenReady().then(() => {
  if (PREPARE) return prepare();
  dlog('ready');
  startMediaServer();
  // productName changed my-app → Executor, which moved userData; carry the API key over once.
  const cfg = path.join(app.getPath('userData'), 'config.json');
  const old = path.join(app.getPath('appData'), 'my-app', 'config.json');
  if (!fs.existsSync(cfg) && fs.existsSync(old)) { fs.mkdirSync(path.dirname(cfg), { recursive: true }); fs.copyFileSync(old, cfg); }
  db.openDb(path.join(app.getPath('userData'), 'executor.db'));
  // Mic for voice input: only this app's own pages get media, and only audio. Other permissions keep Electron's default.
  const ownPage = (u) => { try { const x = new URL(u); return x.protocol === 'file:' || (!!MAIN_WINDOW_VITE_DEV_SERVER_URL && x.origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin); } catch { return false; } };
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => cb(perm !== 'media' || (ownPage(details.requestingUrl || wc.getURL()) && !(details.mediaTypes || []).includes('video'))));
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin) => perm !== 'media' || ownPage(origin || wc?.getURL() || ''));
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
  // v1.2: the fast route is the default now; installs that saved the old setting move over once (they can switch back in Settings).
  if (!db.getSetting('fastRouteMigrated', false)) { db.setSetting('speedMode', 'new'); db.setSetting('fastRouteMigrated', true); }
  setAutostart(db.getSetting('autostart', true));

  for (const m of db.listMemory()) { const fixed = m.cmds.map(fixCmd); if (fixed.some((c, i) => c !== m.cmds[i])) db.updateMemory(m.id, fixed); }
  syncBats();
  // Zoom, the app's own way (every window): Ctrl+= / Ctrl++ bigger, Ctrl+- smaller, Ctrl+0 back to 100%. Kept 50-200%
  // and saved by Genisys, so a stray zoom never sticks forever (Chromium's own per-site zoom is overridden on load).
  const ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
  const zoomNow = () => { const z = Number(db.prefAll().zoom); return ZOOMS.includes(z) ? z : 1; };
  app.on('web-contents-created', (_e, wc) => {
    wc.on('did-finish-load', () => { try { wc.setZoomFactor(zoomNow()); } catch {} });
    wc.on('before-input-event', (ev, i) => {
      if (i.type !== 'keyDown' || !i.control || i.alt) return;
      const k = i.key, z = zoomNow(), at = ZOOMS.indexOf(z);
      const next = k === '0' ? 1 : (k === '=' || k === '+') ? ZOOMS[Math.min(ZOOMS.length - 1, at + 1)] : (k === '-' || k === '_') ? ZOOMS[Math.max(0, at - 1)] : null;
      if (next == null) return;
      ev.preventDefault();
      db.prefSet('zoom', String(next));
      for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.setZoomFactor(next); } catch {} }
    });
  });
  mainWin = createWindow({ mode: 'main' });
  // Login launch starts hidden-to-taskbar (minimized) instead of popping up.
  if (process.argv.includes('--autostart')) mainWin.once('ready-to-show', () => { mainWin.showInactive(); mainWin.minimize(); });
  setTimeout(() => checkModels(), 8000);
  setTimeout(() => cloud.flushPending(), 5000);
  setInterval(() => checkModels(), 6 * 3600e3);
  // Closing the main window only hides it: Genisys keeps running in the tray so the hotkeys keep working.
  // It really quits from the tray menu (or Windows shutdown / the installer).
  mainWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    mainWin.hide();
    if (!db.getSetting('trayTipShown', false) && Notification.isSupported()) {
      db.setSetting('trayTipShown', true);
      new Notification({ title: 'Genisys is still running', body: 'Press Alt+Space for the command bar or Ctrl+Alt+G to open Genisys. To turn it off completely, use the power button or right-click its icon near the clock.', icon: path.join(ASSETS, 'icon.png') }).show();
    }
  });
  mainWin.on('session-end', () => { quitting = true; }); // Windows is shutting down: let it close
  mainWin.on('closed', () => { mainWin = null; app.quit(); });
  // leaving Genisys with something live (timer, stopwatch, music): it follows to the bottom-right; coming back hides it
  const away = () => setTimeout(() => { if (toolActive && !toolStillLive(toolActive)) toolActive = null; if (toolActive && !userInApp() && !BrowserWindow.getFocusedWindow()) showTool({ card: toolActive }); }, 250);
  mainWin.on('blur', away); mainWin.on('minimize', away); mainWin.on('hide', away);
  mainWin.on('focus', () => { if (!toolPinned && toolWin?.isVisible() && toolWin.webContents) toolWin.webContents.executeJavaScript("!!document.querySelector('.ringing')").then((r) => { if (!r) toolWin?.hide(); }).catch(() => {}); });
  // System-wide hotkeys (work from any app while Genisys runs); keep in sync with the F1 help panel.
  // Another app can already own a key combo; log it so a 'hotkey does nothing' report can be checked in genisys-debug.log.
  const hotkey = (keys, fn) => { const ok = globalShortcut.register(keys, fn); dlog('hotkey', keys, ok ? 'registered' : 'TAKEN by another app'); return ok; };
  // Ctrl+Alt+G (G for Genisys) opens the main window. Not Ctrl+Alt+Space: other apps (e.g. Claude) use that one.
  if (!hotkey('Control+Alt+G', showMain)) notify('problem', 'Ctrl+Alt+G is taken by another app. Open Genisys from its icon near the clock instead.');
  // Alt+Space is often taken (Windows window menu, PowerToys Run): fall back to Alt+Shift+Space.
  if (!hotkey('Alt+Space', toggleRunner)) {
    if (hotkey('Alt+Shift+Space', toggleRunner)) notify('problem', 'Alt+Space is taken by another app, so the runner uses Alt+Shift+Space.');
  }
  hotkey('Control+Alt+N', () => openAgent('agent'));
  // Ctrl+Alt+S (Script Writer) is off for now
  // Tray icon: Genisys lives here while its window is closed (built after the hotkeys so it shows the keys in use).
  tray = new Tray(path.join(ASSETS, 'icon.ico'));
  tray.setToolTip('Genisys');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Genisys (Ctrl+Alt+G)', click: showMain },
    { label: 'Command bar (Alt+Space)', click: () => toggleRunner() },
    { label: 'New agent (Ctrl+Alt+N)', click: () => openAgent('agent') },
    { type: 'separator' },
    { label: 'Quit Genisys', click: () => app.quit() },
  ]));
  tray.on('click', showMain);
  // Folder tree: saved by the installer; without it (portable zip, cut-short scan) build it right away.
  setTimeout(() => startIndex(), fs.existsSync(path.join(userDir(), 'path-index.json')) ? 15000 : 1500);
  loadPcIndex(); // saved whole-PC tree: /search works right away, the rescan below refreshes it
  setTimeout(() => { try { if (pcIndex.scannedAt) pcIndex.pairTable(); } catch {} }, 3000);
  setTimeout(() => startPcIndex(), 20000);
  // Every 5 min pick up new/renamed files (cheap: unchanged folders are reused, only changed ones are read again).
  setInterval(() => { startIndex(true); startPcIndex(); }, 5 * 60e3);
  // Specs: refresh after an update, and let the account know (admin › Users).
  setTimeout(async () => {
    try {
      const old = JSON.parse(fs.readFileSync(specsFile(), 'utf8'));
      if (old.app === app.getVersion()) return;
    } catch {}
    try { await saveSpecs(); cloud.sendSpecs(); } catch (e) { dlog('specs failed', e?.message); }
  }, 20000);
  setTimeout(() => helper.warm(), 10000); // so the first volume / PC control is instant
  setTimeout(() => loadStoreApps().catch(() => {}), 4000); // Store apps (WhatsApp…) so "open whatsapp" finds the desktop app
  setInterval(() => loadStoreApps().catch(() => {}), 30 * 60e3);
  try { armReminders(); } catch (e) { dlog('reminders failed', e.message); }
  setTimeout(() => { if (net.isOnline()) learnCatchUp().catch(() => {}); }, 60000); // after start-up has settled
  setTimeout(() => refreshCatalog(), 9000); // the catalog, after the Store apps are known
  setInterval(() => refreshCatalog(), 30 * 60e3);
  // Automatic updates: installs only while no Genisys window is open on screen (Settings › Automatic updates).
  updater = startUpdater({
    log: dlog,
    enabled: () => db.getSetting('autoUpdate', true) !== false,
    isIdle: () => BrowserWindow.getAllWindows().every((w) => w.isDestroyed() || !w.isVisible()),
    report: (e) => cloud.reportError('error', e),
    downloaded: (v) => { for (const w of BrowserWindow.getAllWindows()) try { w.webContents.send('update-ready', v); } catch {} },
    found: (v) => {
      notify('update', `Genisys ${v} is available. It installs by itself when Genisys is closed, or install it now in Notes.`);
      if (!Notification.isSupported()) return;
      const n = new Notification({ title: `Genisys ${v} is available`, body: 'It installs by itself when Genisys is closed. Click to install it now.', icon: path.join(ASSETS, 'icon.png') });
      n.on('click', () => { showMain(); mainWin.webContents.send('nav', 'notes'); });
      n.show();
    },
  });
  {
    const prev = db.getSetting('lastVersion', null), v = app.getVersion();
    db.setSetting('lastVersion', v);
    // Just updated: say what changed (the release notes from GitHub), as a notification and in Notes.
    if (prev && newer(v, prev)) releaseNotes(v).then((what) => {
      notify('update', `Updated to ${v}. ${what || 'Everything you saved is still here.'}`);
      if (Notification.isSupported()) new Notification({ title: `Genisys updated to ${v}`, body: (what || 'New version installed. Everything you saved is still here.').slice(0, 200), icon: path.join(ASSETS, 'icon.png') }).show();
    });
  }
  dlog('main window created');
  setTimeout(makeRunner, 4000); // the Alt+Space bar loads hidden after startup, so the hotkey is instant
}).catch((e) => { dlog('startup failed', e?.stack || e); cloud.reportError('crash', e); });
let quitting = false, tray = null; // tray: kept in a variable so it is not garbage-collected (the icon would vanish)
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { globalShortcut.unregisterAll(); helper.stop(); });
app.on('window-all-closed', () => app.quit());
