// Stage 3 + 7: the NATIVE executors (no PowerShell, no .bat). main.js builds them with the real Electron pieces,
// tests build them with fakes. Every executor returns:
//   { status: 'done',    message, resolved? }   resolved = what to cache ({action, params}) so a repeat is instant
//   { status: 'choose',  message, options }      2-3 clickable candidates ({label, detail, action, params})
//   { status: 'confirm', preview }               destructive: the page must ask the user, then call again with confirmed=true
//   { status: 'fall',    reason }                not handled here: carry on with the next route
import path from 'node:path';
import { byNumbers } from './fit.js';
import { browseTable, summaryTable, dupesTable, fmtSize, fmtDate } from './files.js';
import { Q, runningTable, installedTable, drivesTable, startupTable, wifiTable } from './tables.js';

const SYSTEM = { // opened through the Windows shell, no search needed
  calculator: 'calc.exe', notepad: 'notepad.exe', paint: 'mspaint.exe', cmd: 'cmd.exe', powershell: 'powershell.exe', terminal: 'wt.exe',
  taskmgr: 'taskmgr.exe', control: 'control.exe', explorer: 'explorer.exe', 'snipping tool': 'snippingtool.exe', word: 'winword.exe', excel: 'excel.exe', powerpoint: 'powerpnt.exe',
};
const SYSTEM_URI = { settings: 'ms-settings:' };
// Files that RUN code are never opened from a fuzzy match or a model's path.
const BLOCKED_EXT = /\.(exe|bat|cmd|ps1|psm1|msi|scr|vbs|vbe|js|jse|wsf|wsh|com|reg|jar|hta|pif|cpl|dll)$/i;
const MEDIA_EXT = 'mp4,mkv,avi,mov,wmv,webm,mp3,flac,wav,m4a';
const SEARCH_URL = {
  google: 'https://www.google.com/search?q=', youtube: 'https://www.youtube.com/results?search_query=', bing: 'https://www.bing.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=', wikipedia: 'https://en.wikipedia.org/w/index.php?search=', github: 'https://github.com/search?q=', amazon: 'https://www.amazon.com/s?k=', stackoverflow: 'https://stackoverflow.com/search?q=',
};

// Words joined with "+": "elon musk net worth" -> q=elon+musk+net+worth
export function searchUrl(query, site = 'google') {
  const base = SEARCH_URL[site] || SEARCH_URL.google;
  return base + String(query).trim().split(/\s+/).map(encodeURIComponent).join('+');
}
export const isHttpUrl = (u) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };

// One clear winner opens; a few close ones become buttons; nothing means "not here".
export function pick(matches) {
  const list = (matches || []).filter((m) => m && m.score >= 0.6);
  const [a, b] = list;
  if (!a) return { kind: 'none' };
  if (a.score >= 0.75 && (!b || a.score - b.score >= 0.08)) return { kind: 'one', match: a };
  const close = list.filter((m) => a.score - m.score < 0.2).slice(0, 3);
  return { kind: 'many', matches: close };
}

export function makeActions(d) {
  const base = (p) => path.basename(p) || p;
  const fall = (reason) => ({ status: 'fall', reason });
  const openTarget = async (p, resolved, app) => {
    if (BLOCKED_EXT.test(p)) return fall(`not opening ${base(p)} this way (program or script file)`);
    if (app) { // "… in potplayer": that app instead of the default program
      const exe = d.resolveApp(String(app).toLowerCase().trim());
      if (!exe) return fall(`${app} was not found on this PC`);
      d.spawnDetached(exe, [p]);
      return { status: 'done', message: `opened ${p} with ${app}`, resolved };
    }
    const err = await d.shell.openPath(p);
    return err ? fall(`could not open ${base(p)}: ${err}`) : { status: 'done', message: `opened ${p}`, resolved };
  };
  const choose = async (matches, label, app) => {
    const r = pick(matches);
    const at = (p) => ({ path: p, ...(app && { with: app }) });
    if (r.kind === 'none') return fall(`no ${label} matched`);
    if (r.kind === 'one') return openTarget(r.match.path, { action: 'open_path', params: at(r.match.path) }, app);
    return {
      status: 'choose', message: r.matches.length > 1 ? 'found a few, which one?' : 'is this the one?',
      options: r.matches.map((m) => ({ label: base(m.path), detail: m.path, action: 'open_path', params: at(m.path) })),
    };
  };
  // A browser profile by what the user calls it: "kevin" -> the profile named Kevin, or with kevin@... as its account.
  const matchProfile = (list, want) => {
    const w = norm(want), w2 = w.replace(/s$/, ''); // "kevins chrome" -> kevin
    const score = (p) => Math.max(...[p.name, p.email, String(p.email || '').split('@')[0], p.dir].filter(Boolean).map((x) => { const a = norm(x); return a === w || a === w2 ? 3 : a.startsWith(w2) && w2.length >= 3 ? 2 : a.includes(w2) && w2.length >= 3 ? 1 : 0; }), 0);
    const ranked = list.map((p) => ({ p, sc: score(p) })).filter((x) => x.sc).sort((a, b) => b.sc - a.sc);
    return ranked.length && (ranked.length === 1 || ranked[0].sc > ranked[1].sc) ? ranked[0].p : null;
  };
  const viaBrowser = async (url, browser, profile) => {
    if (!isHttpUrl(url)) return fall('only http(s) links can be opened');
    if (profile) { // its own sign-ins: the browser is started with that profile's folder, so you are already logged in
      const b = browser || 'chrome';
      const exe = d.resolveApp(b);
      if (!exe) return fall(`${b} is not installed or not found`);
      const list = (await d.browserProfiles?.(b)) || [];
      if (!list.length) return fall(`could not read the ${b} profiles on this PC`);
      const hit = matchProfile(list, profile);
      if (!hit) return fall(`no ${b} profile called "${profile}". Profiles: ${list.map((x) => `${x.name} (${x.dir})`).join(', ')}`);
      d.spawnDetached(exe, [`--profile-directory=${hit.dir}`, url]);
      return { status: 'done', message: `opened ${url} in ${b}, profile "${hit.name}" (${hit.dir})` };
    }
    if (browser) {
      const exe = d.resolveApp(browser);
      if (!exe) return fall(`${browser} is not installed or not found`);
      d.spawnDetached(exe, [url]);
      return { status: 'done', message: `opened ${url} in ${browser}` };
    }
    await d.shell.openExternal(url);
    return { status: 'done', message: `opened ${url}` };
  };
  const inside = (p) => d.isAllowed(p);
  // File tables: "videos" / "C:\x" / "my movies folder" -> one folder; nothing given -> the library that fits the kind.
  const LIB = { video: 'videos', audio: 'music', image: 'pictures', document: 'documents' };
  // Folder names by meaning, not by luck: exact > singular/plural > prefix > contains, then a small typo allowance.
  const norm = (w) => String(w).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const sing = (w) => w.replace(/ies$/, 'y').replace(/s$/, '');
  const lev = (a, b) => { const m = [...Array(a.length + 1)].map((_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) m[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return m[a.length][b.length]; };
  const nameScore = (name, want) => {
    const a = norm(name), b = norm(want);
    if (!a || !b) return 0;
    if (a === b) return 4;
    if (sing(a) === sing(b)) return 3.5;
    if (a.startsWith(b) || b.startsWith(a)) return 3;
    if (a.includes(b)) return 2;
    return lev(a, b) <= Math.max(1, Math.floor(b.length / 4)) ? 1.5 : 0; // "dowloads" -> Downloads
  };
  const childDir = async (parent, want, min = 1.5) => {
    let names = [];
    try { names = await d.listDir(parent); } catch { return null; }
    const dirs = (names || []).filter((n) => /[\\/]$/.test(n)).map((n) => n.replace(/[\\/]+$/, ''));
    let best = null;
    for (const n of dirs) { const sc = nameScore(n, want); if (sc >= min && (!best || sc > best.sc || (sc === best.sc && n.length < best.n.length))) best = { n, sc }; }
    return best ? path.join(parent, best.n) : null;
  };
  const SAYS = { movies: 'videos', movie: 'videos', films: 'videos', film: 'videos', songs: 'music', photos: 'pictures', docs: 'documents', download: 'downloads' };
  // File tables: "videos" / "C:\x" / "videos/movie folder" / "movies" -> one folder; nothing given -> the library that fits the kind.
  // A real subfolder of that name ("Videos\\Movies") wins over a library alias; a fuzzy search never picks a folder whose name does not fit.
  const folderOf = async (where, kind) => {
    let w = String(where || '').trim();
    if (!w) return d.paths[LIB[kind]] || d.paths.home;
    if (/^[a-z]:\\/i.test(w)) return d.isDir(w) ? w : null;
    w = w.replace(/\s+(folder|folders|directory|dir)$/i, '').trim();
    const segs = w.split(/[\\/]+/).map((x) => x.replace(/^(my|the)\s+/i, '').replace(/\s+(folder|folders|directory|dir)$/i, '').trim()).filter(Boolean);
    if (!segs.length) return d.paths[LIB[kind]] || d.paths.home;
    const first = segs[0].toLowerCase();
    let cur = d.paths[first] || null; // a library name: videos, downloads, documents ...
    if (!cur) { // a real folder inside a library, the one for this kind of file first
      const libs = [...new Set([d.paths[LIB[kind]], d.paths.downloads, d.paths.documents, d.paths.videos, d.paths.desktop, d.paths.pictures, d.paths.music, d.paths.home].filter(Boolean))];
      for (const lib of libs) { cur = await childDir(lib, segs[0], 3); if (cur) break; }
    }
    if (!cur && SAYS[first]) cur = d.paths[SAYS[first]] || null;
    if (!cur) { // last resort: the search, but only a folder whose NAME fits
      const r = pick((await d.findFiles({ name: segs[0], kind: 'dir' })).matches);
      const list = r.kind === 'one' ? [r.match] : r.kind === 'many' ? r.matches : [];
      cur = list.find((m) => nameScore(base(m.path), segs[0]) >= 1.5)?.path || null;
    }
    for (const seg of segs.slice(1)) { if (!cur) return null; cur = await childDir(cur, seg); }
    return cur;
  };
  const fileTool = (build) => async (p) => {
    const root = await folderOf(p.in, p.kind);
    if (!root) return fall(`no folder "${p.in}" on this PC`);
    d.refreshIndex?.(); // rescan the folder tree in the background; the listing below reads the disk live, never a saved copy
    const { files, partial } = await d.scanFiles(root);
    const r = await build(files, p, root);
    if (r.error) return fall(r.error);
    const note = partial ? ' (big folder: stopped early, list may be incomplete)' : '';
    return { status: 'done', message: r.message + note, table: r.table && { ...r.table, title: r.table.title + note }, data: r.data };
  };
  const sysTool = (name, build) => async (p) => {
    const raw = await d.sysQuery(Q[name]);
    if (raw === '' || raw == null) return fall(`couldn't read ${name.replace(/_/g, ' ')} on this PC`);
    const r = build(raw, p);
    return { status: 'done', message: r.message, table: r.table, stats: r.stats, data: r.data };
  };

  const A = {
    pc: (p, confirmed) => d.system(p, confirmed), // built-in PC controls (src/fast/system.js)
    async open_app({ name, url }) {
      const key = String(name || '').toLowerCase().trim();
      if (!key) return fall('no app name');
      if (url) { // app-or-site ("whatsapp"): the desktop app when installed, else its website
        const exe = d.resolveApp(key);
        if (exe) { d.spawnDetached(exe, []); return { status: 'done', message: `opened ${key}`, resolved: { action: 'open_app', params: { name: key, url } } }; }
        const r = await viaBrowser(url);
        return r.status === 'done' ? { ...r, message: `${key} isn't installed, opened ${url}`, resolved: { action: 'open_app', params: { name: key, url } } } : r;
      }
      if (SYSTEM_URI[key]) { await d.shell.openExternal(SYSTEM_URI[key]); return { status: 'done', message: `opened ${key}` }; }
      if (SYSTEM[key] && !['word', 'excel', 'powerpoint'].includes(key)) {
        const err = await d.shell.openPath(SYSTEM[key]);
        if (!err) return { status: 'done', message: `opened ${key}` };
      }
      const exe = d.resolveApp(key);
      if (!exe) return fall(`${key} was not found on this PC`);
      d.spawnDetached(exe, []);
      return { status: 'done', message: `opened ${key}`, resolved: { action: 'open_app', params: { name: key } } };
    },
    open_url: ({ url, browser, profile }) => viaBrowser(url, browser, profile),
    search_web: ({ query, browser, site, profile }) => (String(query || '').trim() ? viaBrowser(searchUrl(query, site), browser, profile) : fall('empty search')),
    async open_folder({ folder, name }) {
      if (folder) {
        const p = d.paths[folder];
        return p ? openTarget(p) : fall(`unknown folder ${folder}`);
      }
      if (!String(name || '').trim()) return fall('no folder name');
      const r = await d.findFiles({ name, kind: 'dir' });
      return choose(r.matches, 'folder');
    },
    async open_file({ query, ext, media: m, with: app }) {
      const media = m === true || m === 'true';
      if (!String(query || '').trim()) return fall('no file name');
      const r = await d.findFiles({ name: query, kind: 'file', ext: ext || (media ? MEDIA_EXT : undefined) });
      return choose(byNumbers(query, r.matches), 'file', app);
    },
    async open_path({ path: p, with: app }) {
      if (!p || !d.exists(p)) return fall('that path no longer exists');
      return openTarget(p, undefined, app);
    },
    // ---- file actions (Stage 7). All paths must be inside the allowed folders.
    async create_file({ path: p, content = '' }) {
      if (!inside(p)) return fall(`${p} is outside the allowed folders`);
      if (d.exists(p)) return fall(`${base(p)} already exists, not overwriting`);
      d.mkdirp(path.dirname(p)); d.writeFile(p, String(content));
      return { status: 'done', message: `created ${p}` };
    },
    async read_file({ path: p }) {
      if (!inside(p)) return fall(`${p} is outside the allowed folders`);
      if (!d.exists(p)) return fall('file not found');
      return { status: 'done', message: d.readFile(p).slice(0, 4000) };
    },
    // One file or folder: how large, when it arrived, where it is. d.statPath(p) -> { isDir, size, mtime, birth, items } | null
    async file_info({ path: p }) {
      if (!inside(p)) return fall(`${p} is outside the allowed folders`);
      const i = d.statPath ? d.statPath(p) : null;
      if (!i) return fall('not found');
      const name = p.split(/[\\/]/).filter(Boolean).pop() || p;
      const where = p.slice(0, Math.max(0, p.length - name.length)).replace(/[\\/]+$/, '');
      const bits = [name, fmtSize(i.size), i.isDir ? `${i.items} files inside` : null, i.birth ? `arrived ${fmtDate(i.birth)}` : null, i.mtime ? `modified ${fmtDate(i.mtime)}` : null, where ? `in ${where}` : null];
      return { status: 'done', message: bits.filter(Boolean).join(' · ') };
    },
    async list_files({ path: p }) {
      if (!inside(p)) return fall(`${p} is outside the allowed folders`);
      if (!d.exists(p)) return fall('folder not found');
      return { status: 'done', message: d.listDir(p).slice(0, 80).join('\n') };
    },
    browse_files: fileTool((files, p, root) => browseTable(files, p, root)),
    file_summary: fileTool((files, p, root) => summaryTable(files, p, root)),
    find_duplicates: fileTool((files, p, root) => dupesTable(files, p, root, d.hashOf)),
    running_apps: sysTool('running_apps', (raw, p) => runningTable(raw, p, d.totalRam)),
    installed_apps: sysTool('installed_apps', installedTable),
    drives: sysTool('drives', drivesTable),
    startup_apps: sysTool('startup_apps', startupTable),
    wifi_networks: sysTool('wifi_networks', wifiTable),
    async copy_file({ from, to }) {
      if (!inside(from) || !inside(to)) return fall('both paths must be inside the allowed folders');
      if (!d.exists(from)) return fall('source not found');
      if (d.exists(to)) return fall(`${base(to)} already exists, not overwriting`);
      d.copy(from, to);
      return { status: 'done', message: `copied to ${to}` };
    },
    async move_file({ from, to }, confirmed) {
      if (!inside(from) || !inside(to)) return fall('both paths must be inside the allowed folders');
      if (!d.exists(from)) return fall('source not found');
      if (d.exists(to)) return fall(`${base(to)} already exists, not overwriting`);
      if (!confirmed) return { status: 'confirm', preview: `Move\n${from}\nto\n${to}` };
      d.move(from, to);
      return { status: 'done', message: `moved to ${to}` };
    },
    async delete_file({ path: p }, confirmed) {
      if (!inside(p)) return fall(`${p} is outside the allowed folders`);
      if (!d.exists(p)) return fall('nothing to delete there');
      if (!confirmed) return { status: 'confirm', preview: `Move to the Recycle Bin (can be restored):\n${p}` };
      await d.trash(p);
      return { status: 'done', message: `moved to the Recycle Bin: ${p}` };
    },
  };
  return A;
}
