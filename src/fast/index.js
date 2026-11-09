// Stage 8: the path index. A background scan keeps names + paths of the user's files in a few SECTIONS
// (installed_apps, personal_files, media_library, system_files). Lookup is in-memory and takes a few ms.
// Models only ever see the few relevant lines (contextFor), never the whole index.
import { win32 as path } from 'node:path'; // the app is Windows-only; win32 keeps paths identical in tests on any OS
import { fuzzy } from '../fuzzy.js';

export const SKIP_DIRS = /^(node_modules|appdata|\.git|\.svn|\.hg|\$recycle\.bin|system volume information|__pycache__|cache|caches|temp|tmp|windows|program files|program files \(x86\)|programdata|venv|\.venv|dist|build|\.next|\.gradle|\.npm)$/i;
const MEDIA = new Set(['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg']);
export const SECTIONS = ['installed_apps', 'personal_files', 'media_library', 'system_files'];
const STOP = /^(the|in|of|a|an|file|folder|season|episode|ep|video|movie|please|my)$/;
const EP_Q = /\b(?:episode|ep|e)\s*0*(\d{1,3})\b/i;
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

export const skipDir = (name) => name.startsWith('.') || name.startsWith('$') || SKIP_DIRS.test(name);
export const sectionOf = (e) => (e.t === 'app' ? 'installed_apps' : e.sys ? 'system_files' : MEDIA.has(e.e) ? 'media_library' : 'personal_files');
const mkEntry = (dir, c) => {
  const ext = c.d ? '' : path.extname(c.n).slice(1).toLowerCase();
  return { n: c.n, l: c.n.toLowerCase(), p: path.join(dir, c.n), e: ext, t: c.d ? 'dir' : 'file', s: c.s ?? null, m: c.m ?? null };
};

export class PathIndex {
  constructor() { this.dirs = new Map(); this.apps = []; this.sys = []; this.sec = Object.fromEntries(SECTIONS.map((s) => [s, []])); this.pins = []; this.ready = false; this.scannedAt = 0; this.count = 0; }

  // fsp = a promises-style fs: readdir(dir,{withFileTypes}), stat(p). Yields to the event loop so the app stays smooth.
  async scan(roots, fsp, { maxEntries = 300000, pause = () => new Promise((r) => setTimeout(r, 4)), every = 40, isStopped = () => false } = {}) {
    const seen = new Set();
    const queue = roots.map((r) => [r, 0]);
    const next = new Map();
    let total = 0, n = 0;
    while (queue.length && total < maxEntries && !isStopped()) {
      const [dir, depth] = queue.shift();
      const key = dir.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      let mtime = 0;
      try { mtime = (await fsp.stat(dir)).mtimeMs; } catch { continue; }
      let rec = this.dirs.get(dir);
      if (!rec || rec.m !== mtime) { // changed (or new): read it again; unchanged folders reuse the saved listing
        let ents;
        try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
        const kids = [];
        for (const e of ents) {
          if (e.name.startsWith('.') && !e.isDirectory()) continue;
          if (e.isDirectory() && skipDir(e.name)) continue;
          const k = { n: e.name, d: e.isDirectory() };
          if (!k.d && MEDIA.has(path.extname(e.name).slice(1).toLowerCase())) { try { const st = await fsp.stat(path.join(dir, e.name)); k.s = st.size; k.m = st.mtimeMs; } catch {} }
          kids.push(k);
        }
        rec = { m: mtime, kids };
      }
      next.set(dir, rec);
      total += rec.kids.length;
      if (depth < 7) for (const k of rec.kids) if (k.d) queue.push([path.join(dir, k.n), depth + 1]);
      if (++n % every === 0) await pause();
    }
    this.dirs = next;
    this.rebuild();
    this.scannedAt = Date.now();
    this.ready = true;
    return this.count;
  }

  setApps(apps) { this.apps = apps.map((a) => ({ n: a.name, l: a.name.toLowerCase(), p: a.path, e: 'exe', t: 'app' })); this.rebuild(); this.ready = this.ready || this.apps.length > 0; }
  setSystem(files) { this.sys = files; this.rebuild(); }

  rebuild() {
    const sec = Object.fromEntries(SECTIONS.map((s) => [s, []]));
    for (const [dir, rec] of this.dirs) for (const k of rec.kids) { const e = mkEntry(dir, k); sec[sectionOf(e)].push(e); }
    sec.installed_apps = this.apps.slice();
    sec.system_files = this.sys.map((f) => ({ ...f, sys: true }));
    this.sec = sec;
    this.count = SECTIONS.reduce((n, s) => n + sec[s].length, 0);
  }

  // my_paths.json: { "pins": [{ "name": "movies", "path": "D:\\Movies" }], "roots": ["D:\\Movies"] }
  setPins(pins) { this.pins = (pins || []).filter((p) => p && p.name && p.path).map((p) => ({ words: squash(p.name), path: p.path })); }
  pinned(query, exists = () => true) {
    const q = squash(query);
    return this.pins.filter((p) => p.words && (q === p.words || q.includes(p.words)) && exists(p.path)).map((p) => ({ path: p.path, score: 1, pinned: true }));
  }

  // -> [{ path, score, dir }] best first. kind: any|file|dir; ext: 'mp4,mkv'. Pinned paths always win.
  lookup(query, { kind = 'any', ext, sections = ['personal_files', 'media_library'], limit = 8, exists } = {}) {
    const pin = this.pinned(query, exists);
    if (pin.length) return pin.slice(0, limit);
    const want = new Set(String(ext || '').toLowerCase().split(/[\s,;|]+/).map((x) => x.replace(/^\./, '')).filter(Boolean));
    const ep = EP_Q.exec(query);
    const q = ep ? query.replace(EP_Q, ' ') : query;
    const words = q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.test(w));
    if (!words.length) return [];
    const epRe = ep ? new RegExp(`(?:e|ep|episode|x)[ ._-]?0*${+ep[1]}(?!\\d)`, 'i') : null;
    const pool = sections.flatMap((s) => this.sec[s] || []).filter((e) => (kind === 'any' || e.t === kind) && (!want.size || (e.t === 'file' && want.has(e.e))));
    const hits = [];
    for (const e of pool) { // pass 1: every word appears in the name or its folders (fast, handles most lookups)
      const hay = squash(e.p.slice(-(e.n.length + 60)));
      if (epRe && !epRe.test(e.n)) continue;
      if (words.every((w) => hay.includes(w))) hits.push({ path: e.p, score: squash(e.n).includes(words.join('')) || words.every((w) => squash(e.n).includes(w)) ? 1 : 0.92, dir: e.t === 'dir' });
    }
    if (!hits.length && !epRe) { // pass 2 (typos, only when pass 1 found nothing): letter-pair similarity on names
      const qs = words.join(' ');
      for (const e of pool) { const sc = fuzzy(qs, e.n); if (sc >= 0.7) hits.push({ path: e.p, score: Math.round(sc * 100) / 100, dir: e.t === 'dir' }); }
    }
    hits.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
    const uniq = [...new Map(hits.map((h) => [h.path.toLowerCase(), h])).values()];
    return (exists ? uniq.filter((h) => exists(h.path)) : uniq).slice(0, limit);
  }

  // best installed app exe for a name ("chrome" -> C:\...\chrome.exe)
  app(name, exists = () => true) {
    const w = squash(name);
    if (!w) return null;
    const c = this.sec.installed_apps.filter((a) => { const s = squash(a.n); return s === w || s.includes(w) || (s.length > 3 && w.includes(s)); })
      .sort((a, b) => (squash(a.n) === w ? 0 : 1) - (squash(b.n) === w ? 0 : 1) || a.p.length - b.p.length);
    return c.find((a) => exists(a.p))?.p || null;
  }

  // A few relevant lines per section for the script fallback. Never the whole index.
  contextFor(command, { exists } = {}) {
    const out = {};
    const words = String(command).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.test(w));
    const seenW = new Set();
    for (const w of words) {
      if (seenW.has(w)) continue; seenW.add(w);
      for (const sec of ['personal_files', 'media_library']) {
        const r = this.lookup(w, { sections: [sec], limit: 3, exists });
        if (r.length) out[sec] = [...new Set([...(out[sec] || []), ...r.map((x) => x.path)])].slice(0, 6);
      }
      const a = this.app(w, exists);
      if (a) out.installed_apps = [...new Set([...(out.installed_apps || []), a])].slice(0, 4);
    }
    return out;
  }

  /** Compact tree of the user's FOLDER names (no files), for the AI on file tasks. Each root gets a fair share of maxChars. */
  folderMap(roots, maxChars = 3000) {
    const have = roots.filter((r) => this.dirs.has(r));
    const per = Math.max(250, Math.floor(maxChars / Math.max(1, have.length)));
    return have.map((root) => {
      let block = `${root}\n`;
      const walk = (dir, depth) => {
        const kids = (this.dirs.get(dir)?.kids || []).filter((k) => k.d);
        for (let i = 0; i < kids.length; i++) {
          const line = `${'  '.repeat(depth)}${kids[i].n}\n`;
          if (block.length + line.length > per) { block += `${'  '.repeat(depth)}(+${kids.length - i} more)\n`; return false; }
          block += line;
          if (depth < 3 && walk(path.join(dir, kids[i].n), depth + 1) === false) return false;
        }
        return true;
      };
      walk(root, 1);
      return block.trimEnd();
    }).join('\n');
  }

  toJSON() { return { v: 1, t: this.scannedAt, dirs: [...this.dirs].map(([d, r]) => [d, r.m, r.kids]), apps: this.apps.map((a) => ({ name: a.n, path: a.p })) }; }
  static fromJSON(j) {
    const x = new PathIndex();
    if (!j || j.v !== 1) return x;
    x.dirs = new Map((j.dirs || []).map(([d, m, kids]) => [d, { m, kids }]));
    x.apps = (j.apps || []).map((a) => ({ n: a.name, l: a.name.toLowerCase(), p: a.path, e: 'exe', t: 'app' }));
    x.scannedAt = j.t || 0;
    x.rebuild();
    x.ready = x.count > 0;
    return x;
  }
}
