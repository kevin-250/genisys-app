// Stage 3 + 7: the NATIVE executors (no PowerShell, no .bat). main.js builds them with the real Electron pieces,
// tests build them with fakes. Every executor returns:
//   { status: 'done',    message, resolved? }   resolved = what to cache ({action, params}) so a repeat is instant
//   { status: 'choose',  message, options }      2-3 clickable candidates ({label, detail, action, params})
//   { status: 'confirm', preview }               destructive: the page must ask the user, then call again with confirmed=true
//   { status: 'fall',    reason }                not handled here: carry on with the next route
import path from 'node:path';

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
  duckduckgo: 'https://duckduckgo.com/?q=', wikipedia: 'https://en.wikipedia.org/w/index.php?search=', github: 'https://github.com/search?q=', amazon: 'https://www.amazon.com/s?k=',
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
  const openTarget = async (p, resolved) => {
    if (BLOCKED_EXT.test(p)) return fall(`not opening ${base(p)} this way (program or script file)`);
    const err = await d.shell.openPath(p);
    return err ? fall(`could not open ${base(p)}: ${err}`) : { status: 'done', message: `opened ${p}`, resolved };
  };
  const choose = async (matches, label) => {
    const r = pick(matches);
    if (r.kind === 'none') return fall(`no ${label} matched`);
    if (r.kind === 'one') return openTarget(r.match.path, { action: 'open_path', params: { path: r.match.path } });
    return {
      status: 'choose', message: r.matches.length > 1 ? 'found a few, which one?' : 'is this the one?',
      options: r.matches.map((m) => ({ label: base(m.path), detail: m.path, action: 'open_path', params: { path: m.path } })),
    };
  };
  const viaBrowser = async (url, browser) => {
    if (!isHttpUrl(url)) return fall('only http(s) links can be opened');
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

  const A = {
    pc: (p, confirmed) => d.system(p, confirmed), // built-in PC controls (src/fast/system.js)
    async open_app({ name }) {
      const key = String(name || '').toLowerCase().trim();
      if (!key) return fall('no app name');
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
    open_url: ({ url, browser }) => viaBrowser(url, browser),
    search_web: ({ query, browser, site }) => (String(query || '').trim() ? viaBrowser(searchUrl(query, site), browser) : fall('empty search')),
    async open_folder({ folder, name }) {
      if (folder) {
        const p = d.paths[folder];
        return p ? openTarget(p) : fall(`unknown folder ${folder}`);
      }
      if (!String(name || '').trim()) return fall('no folder name');
      const r = await d.findFiles({ name, kind: 'dir' });
      return choose(r.matches, 'folder');
    },
    async open_file({ query, ext, media: m }) {
      const media = m === true || m === 'true';
      if (!String(query || '').trim()) return fall('no file name');
      const r = await d.findFiles({ name: query, kind: 'file', ext: ext || (media ? MEDIA_EXT : undefined) });
      return choose(r.matches, 'file');
    },
    async open_path({ path: p }) {
      if (!p || !d.exists(p)) return fall('that path no longer exists');
      return openTarget(p);
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
    async list_files({ path: p }) {
      if (!inside(p)) return fall(`${p} is outside the allowed folders`);
      if (!d.exists(p)) return fall('folder not found');
      return { status: 'done', message: d.listDir(p).slice(0, 80).join('\n') };
    },
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
