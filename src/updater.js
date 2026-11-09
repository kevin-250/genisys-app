// Automatic updates (installed app only). Twice a day: is there a newer GitHub release? Then download the installer in
// the background, check its SHA-256 against the one GitHub publishes, and install it silently while Genisys is idle.
// The installer (/VERYSILENT) updates in place and starts Genisys again in the tray.
import { app, net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { newer, pickAsset } from './version.js';

const LATEST = 'https://api.github.com/repos/kevin-250/genisys-app/releases/latest';

const sha256 = (file) => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});
const verified = async (file, a) => fs.existsSync(file) && fs.statSync(file).size === a.size && (await sha256(file)) === a.sha256;

// Resumes after a dropped connection (the .part file keeps what already arrived).
async function download(url, part, size, log) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    if (have >= size) return;
    try {
      const res = await net.fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {} });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.status === 206) fs.appendFileSync(part, buf); else fs.writeFileSync(part, buf);
      if (fs.statSync(part).size >= size) return;
    } catch (e) { log('update download', attempt, e.message); }
    await new Promise((r) => setTimeout(r, 15000 * attempt));
  }
  throw new Error('download kept failing');
}

/** { log, enabled(): bool, isIdle(): bool, report(err), found(version) } -> { checkNow, installNow } */
export function startUpdater({ log, enabled, isIdle, report, found }) {
  if (!app.isPackaged) return null;
  const dir = path.join(app.getPath('userData'), 'updates');
  let ready = null, busy = null, told = null, now = false;
  const latest = async () => {
    const res = await net.fetch(LATEST, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Genisys' } });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    return pickAsset(await res.json());
  };

  // One download at a time; a second caller waits for the same one.
  const check = (force) => busy || (busy = fetchUpdate(force).finally(() => { busy = null; }));
  async function fetchUpdate(force) {
    if (ready || (!force && !enabled())) return;
    try {
      const a = await latest();
      if (!a || !newer(a.version, app.getVersion())) return;
      if (told !== a.version) { told = a.version; found?.(a.version); }
      fs.mkdirSync(dir, { recursive: true });
      for (const f of fs.readdirSync(dir)) if (!f.includes(a.version)) fs.rmSync(path.join(dir, f), { force: true }); // old downloads
      const file = path.join(dir, `Genisys-Setup-${a.version}.exe`);
      if (!(await verified(file, a))) {
        await download(a.url, `${file}.part`, a.size, log);
        fs.renameSync(`${file}.part`, file);
        if (!(await verified(file, a))) { fs.rmSync(file, { force: true }); throw new Error('update checksum did not match, deleted'); }
      }
      ready = { file, version: a.version };
      log('update ready', a.version);
      tryInstall();
    } catch (e) { log('update failed', e.message); report?.(e); if (force) throw e; }
  }

  function tryInstall() {
    if (!ready || (!now && (!enabled() || !isIdle()))) return;
    log('installing update', ready.version);
    const c = spawn(ready.file, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { detached: true, stdio: 'ignore' });
    c.on('error', (e) => { log('update start failed', e.message); report?.(e); });
    c.unref();
    setTimeout(() => app.quit(), 500); // the installer replaces the files, then starts Genisys again in the tray
  }

  setTimeout(() => check(), 5 * 60e3);     // 5 min after start
  setInterval(() => check(), 12 * 3600e3); // then twice a day
  setInterval(tryInstall, 10 * 60e3);      // a downloaded update waits until Genisys is idle

  return {
    // { current, latest, newer, ready }: only asks GitHub, the download starts in the background
    async checkNow() {
      const a = await latest();
      const isNewer = !!a && newer(a.version, app.getVersion());
      if (isNewer) check().catch(() => {});
      return { current: app.getVersion(), latest: a?.version || null, newer: isNewer, ready: !!ready };
    },
    // The user clicked "Download and install": finish the download, then install right away (Genisys restarts).
    async installNow() { now = true; try { await check(true); } catch (e) { now = false; throw e; } if (!ready) { now = false; throw new Error('No update to install'); } tryInstall(); },
  };
}
