// Talks to the Genisys website's small backend (Upstash behind it): the first-run account, error reports and
// the Report tab. Runs in the main process (the page's CSP blocks network calls, and net.fetch follows the system proxy).
import { app, net } from 'electron';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as db from './db.js';
import { scrub } from './scrub.js';

const API = process.env.GENISYS_API || 'https://genisys-landingpage.vercel.app/api/app';

const installId = () => {
  let id = db.getSetting('installId', null);
  if (!id) { id = crypto.randomUUID(); db.setSetting('installId', id); }
  return id;
};

async function post(route, body) {
  const res = await net.fetch(`${API}/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ installId: installId(), version: app.getVersion(), os: `Windows ${os.release()}`, ...body }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${route}: HTTP ${res.status}`);
}

// The installer writes a new stamp to install.ini next to the exe on every fresh install (not on updates), so the setup
// shows once per install, again after uninstall + reinstall, and never in dev (npm start). No file (zip) = stamp 'none'.
const installStamp = () => {
  try { return /stamp=(\S+)/.exec(fs.readFileSync(path.join(path.dirname(process.execPath), 'install.ini'), 'utf8'))?.[1] || 'none'; } catch { return 'none'; }
};

/** What the first-run setup needs to know. */
export const state = () => ({ onboarded: !app.isPackaged || db.getSetting('onboardedStamp', null) === installStamp(), account: db.getSetting('account', null), sendErrors: db.getSetting('sendErrors', false) });

/** First-run setup finished: save locally, then create the account online (retried at next start if offline). */
export async function register(acc) {
  const account = { email: String(acc.email || '').trim().toLowerCase(), name: String(acc.name || '').trim().slice(0, 60), theme: acc.theme };
  db.setSetting('account', account);
  db.setSetting('sendErrors', !!acc.sendErrors);
  db.setSetting('onboardedStamp', installStamp());
  try { await post('register', account); db.setSetting('pendingRegister', false); return { sent: true }; }
  catch { db.setSetting('pendingRegister', true); return { sent: false }; }
}

/** Startup: finish a sign-up that happened offline. */
export async function flushPending() {
  if (!db.getSetting('pendingRegister', false)) return;
  try { await post('register', db.getSetting('account', {})); db.setSetting('pendingRegister', false); } catch {}
}

export function sendReport({ type, message, includeEmail }) {
  const acc = db.getSetting('account', null) || {};
  return post('report', { type, message: String(message || '').slice(0, 2000), name: acc.name, ...(includeEmail ? { email: acc.email } : {}) });
}

// Error reports: only when the user allowed it in setup, never the user's folder or Windows user name,
// at most 20 per run and each distinct message once.
const home = os.homedir();
const user = (() => { try { return os.userInfo().username; } catch { return ''; } })();
const clean = (s, max) => scrub(s, max, home, user);
const seen = new Set();
export function reportError(kind, err) {
  try {
    if (db.getSetting('sendErrors', false) !== true) return; // also false before the DB is open
  } catch { return; }
  const message = clean(err?.message ?? err, 500);
  const key = `${kind}:${message}`;
  if (!message || seen.has(key) || seen.size >= 20) return;
  seen.add(key);
  post('error', { kind, message, stack: err?.stack ? clean(err.stack, 4000) : undefined }).catch(() => {});
}
