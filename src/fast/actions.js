// Stage 3 + 7: the NATIVE executors (no PowerShell, no .bat). main.js builds them with the real Electron pieces,
// tests build them with fakes. Every executor returns:
//   { status: 'done',    message, resolved? }   resolved = what to cache ({action, params}) so a repeat is instant
//   { status: 'choose',  message, options }      2-3 clickable candidates ({label, detail, action, params})
//   { status: 'confirm', preview }               destructive: the page must ask the user, then call again with confirmed=true
//   { status: 'fall',    reason }                not handled here: carry on with the next route
import path from 'node:path';
import { byNumbers } from './fit.js';
import { candidates, summary as catSummary, norm as catNorm } from './catalog.js';
import { predict } from './predict.js';
import { labelOf, needsLabel, pickMessages, parsePick } from './label.js';
import { applyBrowserFavorites, appForCategory, favoriteProfile, categoryOf } from './favorites.js';
import { SITES } from './intent.js';
import { timeIn } from './assist.js';
import { fmtSecs, daysUntil, clashWarning, calc } from './siri.js';
import { textToHtml, BINARY_DOCS } from './doc.js';
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

// Desktop chat apps Genisys can drive: window title (for focusing it) and the key that opens "search chats".
// Enter then opens the top match. Teams is left out: its search key opens a results page, not a chat.
export const CHAT_APPS = {
  whatsapp: { title: 'WhatsApp', search: '^f' },
  telegram: { title: 'Telegram', search: '^f' },
  signal: { title: 'Signal', search: '^f' },
  discord: { title: 'Discord', search: '^k' },
  slack: { title: 'Slack', search: '^k' },
};

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
    if (!w2) return null;
    const near = (a, b) => b.length >= 4 && lev(a, b) <= Math.max(1, Math.floor(b.length / 4)); // "kevn" -> Kevin
    // The NAME you see in Chrome counts most, then the account, then the folder name ("Default", "Profile 1").
    const fieldScore = (x, weight) => {
      const a = norm(x || '');
      if (!a) return 0;
      if (a === w || a === w2) return weight + 3;
      if (w2.length >= 3 && a.startsWith(w2)) return weight + 2;
      if (w2.length >= 3 && a.includes(w2)) return weight + 1;
      return near(a, w2) ? weight + 0.5 : 0;
    };
    const score = (p) => Math.max(fieldScore(p.name, 30), fieldScore(String(p.email || '').split('@')[0], 20), fieldScore(p.email, 20), fieldScore(p.dir, 10));
    const ranked = list.map((p) => ({ p, sc: score(p) })).filter((x) => x.sc).sort((a, b) => b.sc - a.sc);
    return ranked.length && (ranked.length === 1 || ranked[0].sc > ranked[1].sc) ? ranked[0].p : null;
  };
  const viaBrowser = async (url, browser, profile, opts = {}) => {
    if (!(profile && !url) && !isHttpUrl(url)) return fall('only http(s) links can be opened');
    // Favorites fill only what the request left out (a named browser/profile always wins).
    let favNote = '';
    if (!opts.noFavorites) {
      const f = applyBrowserFavorites({ browser, profile }, d.prefs?.() || {});
      if (f.usedFavorite && f.browser && d.resolveApp(f.browser)) { browser = f.browser; profile = f.profile || profile; favNote = ' (your favorite)'; }
    }
    if (profile) { // its own sign-ins: the browser is started with that profile's folder, so you are already logged in
      const b = browser || 'chrome';
      const exe = d.resolveApp(b);
      if (!exe) return fall(`${b} is not installed or not found`);
      const list = (await d.browserProfiles?.(b)) || [];
      if (!list.length) return fall(`could not read the ${b} profiles on this PC`);
      const hit = matchProfile(list, profile);
      if (!hit) return fall(`no ${b} profile called "${profile}". Profiles: ${list.map((x) => `${x.name} (${x.dir})`).join(', ')}`);
      d.spawnDetached(exe, [`--profile-directory=${hit.dir}`, ...(url ? [url] : [])]);
      d.prefBump?.(`count:browser:${b}`); d.prefBump?.(`count:profile:${b}:${hit.name}`); // what you really use becomes a favorite after a few times
      return { status: 'done', message: `opened ${url || b} in ${b}, profile "${hit.name}" (${hit.dir})${favNote}` };
    }
    if (browser) {
      const exe = d.resolveApp(browser);
      if (!exe) return fall(`${browser} is not installed or not found`);
      d.spawnDetached(exe, [url]);
      d.prefBump?.(`count:browser:${browser}`);
      return { status: 'done', message: `opened ${url} in ${browser}${favNote}` };
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
  const lev = (a, b) => { const m = [...Array(a.length + 1)].map((_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) m[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? m[i - 2][j - 2] + 1 : Infinity); return m[a.length][b.length]; };
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
    return best ? path.win32.join(parent, best.n) : null; // Windows paths on every OS (tests run on Linux too)
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

  // Start one catalog entry the way its kind needs: program/shortcut/Store app, or a bookmark in its own browser profile.
  // What was opened last by the predictor, so "no, the other one" knows what "no" is about (10 minutes).
  let last = null;
  const ctxOf = () => ({ prefs: d.prefs?.() || {}, learned: d.learned?.() || {} });
  const KINDS_OPEN = ['app', 'pwa', 'store', 'program', 'site'];
  const bare = (x) => catNorm(x).replace(/\b(desktop|application|program)\b/g, '').replace(/\s+/g, ''); // "github desktop" = "GitHub Desktop" = "github"
  const INSTALLED = ['app', 'pwa', 'store', 'program'];
  const launchEntry = async (e, p, q) => {
    const L = e.launch || {}, sure = p ? ` (${e.kind}, ${Math.round(p * 100)}% sure)` : ` (${e.kind})`;
    let r;
    if (L.type === 'url') { r = await viaBrowser(L.url, L.browser, L.profile); if (r.status === 'done') r = { ...r, message: `opened ${e.name}${sure}` }; }
    else if (L.type === 'path') { const err = await d.shell.openPath(L.target); if (err) return fall(err); d.catalogTouch?.(e.key); r = { status: 'done', message: `opened ${e.name}${sure}` }; }
    else if (!L.target) return fall(`${e.name} has no way to start`);
    else { d.spawnDetached(L.target, []); d.catalogTouch?.(e.key); r = { status: 'done', message: `opened ${e.name}${sure}` }; }
    if (r.status === 'done' && q) { last = { q: catNorm(q), id: e.id, name: e.name, ts: Date.now() }; d.learn?.(last.q, e.id, 1, 0); } // kept unless you say "no"
    delete r.resolved; // never cached: the predictor is fast and learns, a cached pick could repeat a mistake
    return r;
  };

  const A = {
    pc: (p, confirmed) => d.system(p, confirmed), // built-in PC controls (src/fast/system.js)
    // "no, the other one" / "no, I meant X": learn from the mistake, then open what you meant. The wrong pick is remembered for that request.
    async wrong_pick({ text }) {
      if (!last || Date.now() - last.ts > 10 * 60e3) return fall('nothing I opened recently to correct');
      const cat = d.catalog?.() || [], was = last;
      d.learn?.(was.q, was.id, -1, 1);
      const want = String(text || '').trim();
      const pr = predict(cat, want || was.q, ctxOf(), { kinds: KINDS_OPEN, exclude: want ? [] : [was.id] });
      if (want && pr.decision === 'do' && pr.pick.entry.id !== was.id) {
        d.learn?.(was.q, pr.pick.entry.id, 2, 0); d.confuse?.({ query: was.q, wrong: was.name, right: pr.pick.entry.name, how: `you said "${want}"` });
        const r = await launchEntry(pr.pick.entry, pr.ranked[0].p, want);
        return r.status === 'done' ? { ...r, message: `${r.message}. Noted: "${was.q}" meant this, not ${was.name}.` } : r;
      }
      d.confuse?.({ query: was.q, wrong: was.name, right: want || '', how: want ? 'you named another' : 'you said no' });
      last = null;
      if (pr.decision === 'do' && !want) { const r = await launchEntry(pr.pick.entry, pr.ranked[0].p, was.q); return r.status === 'done' ? { ...r, message: `${r.message}. Noted: not ${was.name} for "${was.q}". (I can't close what I already opened.)` } : r; }
      if (pr.decision === 'choose' || (!want && pr.ranked.length)) {
        const picks = (pr.picks || pr.ranked.slice(0, 3)).slice(0, 3);
        if (picks.length) return { status: 'choose', message: `Not ${was.name}. Which one did you mean?`, options: picks.map((r) => ({ label: r.entry.name, detail: r.entry.kind, action: 'open_app', params: { id: r.entry.id, q: want || was.q } })) };
      }
      return fall(`nothing else looks like "${want || was.q}"`);
    },
    // What Genisys knows about this PC (the catalog), so you can check it: "catalog", "catalog spotify", "rescan catalog".
    async catalog({ op, query }) {
      if (op === 'rescan') { await d.catalogRefresh?.(); }
      const all = d.catalog?.() || [];
      if (!all.length) return { status: 'done', message: 'The catalog is empty so far. It fills in a few seconds after the app starts; say "rescan catalog" to run it now.' };
      if (op === 'search' && String(query || '').trim()) {
        const rows = candidates(all, query, { limit: 8 });
        if (!rows.length) return { status: 'done', message: `Nothing in the catalog looks like "${query}".` };
        return { status: 'done', message: `Best matches for "${query}":\n` + rows.map((r) => `${r.sim.toFixed(2)}  ${r.entry.kind}  ${r.entry.name}  ->  ${r.entry.launch.url || r.entry.launch.target}${r.entry.launch.args ? ' ' + r.entry.launch.args : ''}${labelOf(r.entry) ? `  [${labelOf(r.entry).cat}]` : ''}${r.entry.uses ? `  (opened ${r.entry.uses}x)` : ''}`).join('\n') };
      }
      if (op === 'predict') {
        const pr = predict(all, query, ctxOf(), { kinds: KINDS_OPEN });
        const lines = pr.ranked.map((r) => `${(r.p * 100).toFixed(0).padStart(3)}%  score ${r.score.toFixed(2)} (name ${r.name.toFixed(2)}, prior ${r.prior.toFixed(2)})  ${r.entry.kind}  ${r.entry.name}`);
        return { status: 'done', message: `"${query}" -> ${pr.decision.toUpperCase()}${pr.pick ? ' ' + pr.pick.entry.name : ''}\n${lines.join('\n') || '(nothing close)'}` };
      }
      if (op === 'confusions') {
        const rows = d.confusions?.(15) || [];
        return { status: 'done', message: rows.length ? 'Mistakes I learned from (newest first):\n' + rows.map((r) => `${new Date(r.ts).toLocaleString()}  you said "${r.query}"  I opened ${r.wrong}  ${r.right_name ? `you meant ${r.right_name}` : ''} (${r.how})`).join('\n') : 'No mistakes recorded yet. When I open the wrong thing, say "no, the other one" or "no, I meant <name>".' };
      }
      if (op === 'label' || op === 'label_off') {
        if (op === 'label_off') { d.labelOff?.(); return { status: 'done', message: 'PC labeling is off. Nothing is sent to the model any more (labels already saved stay).' }; }
        if (!d.labelRun) return fall('labeling is not available');
        const r = await d.labelRun();
        const n = all.filter((e) => ['app', 'pwa', 'store', 'program'].includes(e.kind)).length;
        return { status: 'done', message: `PC labeling is ON: only app NAMES are sent to your AI model (no files, no paths). Labeled ${r.done} now, ${r.left} still to do${r.busy ? ' (already running)' : ''} of ${n} apps. Say "stop labeling my pc" to turn it off.` };
      }
      const sm = catSummary(all);
      return { status: 'done', message: `I know ${sm.total} things on this PC: ` + Object.entries(sm.byKind).map(([k, n]) => `${n} ${k}`).join(', ') + `. ${sm.used} opened through me so far.` + (d.labelOn?.() ? ` Model labels: ${all.filter((e) => labelOf(e)).length} apps labeled, ${all.filter(needsLabel).length} to do.` : ' Model labeling is off (say "label my pc" to turn it on).') };
    },
    // Settings by voice/text: "my favorite browser is chrome", "make kevin my default chrome profile", "forget my favorite email", "what are my favorites".
    async favorite({ op, category, value, browser }) {
      const prefs = d.prefs?.() || {};
      if (op === 'list') {
        const rows = Object.entries(prefs).filter(([k]) => k.startsWith('fav:')).map(([k, v]) => `${k.slice(4).replace(':', ' ')}: ${v}`);
        return { status: 'done', message: rows.length ? `Your favorites: ${rows.join(', ')}` : 'No favorites saved yet. Try: "my favorite browser is chrome".' };
      }
      const key = category === 'profile' ? `fav:profile:${browser || 'chrome'}` : `fav:${category}`;
      if (op === 'forget') { d.prefDel?.(key); return { status: 'done', message: `Forgot your favorite ${category === 'profile' ? `${browser || 'chrome'} profile` : category}.` }; }
      if (!value) return fall('no value to save');
      if (category === 'profile') { // keep it only if that profile exists, so a typo is caught now, not later
        const list = (await d.browserProfiles?.(browser || 'chrome')) || [];
        const hit = list.length ? matchProfile(list, value) : null;
        if (list.length && !hit) return fall(`no ${browser || 'chrome'} profile called "${value}". Profiles: ${list.map((x) => x.name).join(', ')}`);
        d.prefSet?.(key, hit ? hit.name : value);
        return { status: 'done', message: `Saved: your favorite ${browser || 'chrome'} profile is ${hit ? hit.name : value}. I will use it when you don't name one.` };
      }
      d.prefSet?.(key, String(value).toLowerCase());
      return { status: 'done', message: `Saved: your favorite ${category} is ${value}. A different one you name in a request always wins.` };
    },
    // Opens a Gmail draft with everything filled in, in the right browser profile. It never sends: you press Send.
    async compose_email({ to, subject, body, browser, profile }) {
      const addr = String(to || '').trim();
      if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(addr)) return fall('no valid recipient email address');
      if (/@(example|test|domain|email)\.(com|org|net)$/i.test(addr)) return fall(`"${addr}" is a placeholder, not a real recipient`);
      const q = new URLSearchParams({ view: 'cm', fs: '1', to: addr, su: String(subject || ''), body: String(body || '') });
      const r = await viaBrowser(`https://mail.google.com/mail/u/0/?${q}`, browser, profile);
      return r.status === 'done' ? { ...r, message: `Opened a Gmail draft to ${addr}${subject ? ` ("${subject}")` : ''}. It is NOT sent: press Send in Gmail. ${r.message.replace(/^opened [^ ]+ /, '')}`.trim() } : r;
    },
    // "what time is it in new york": from the PC clock and the time-zone database, never guessed by a model.
    world_time({ place }) {
      const r = timeIn(String(place || ''));
      return r ? { status: 'done', message: r.text, card: { type: 'clock', zone: r.zone, place: String(place).replace(/\b\w/g, (c) => c.toUpperCase()), note: r.text.replace(/^.*?\(/, '').replace(/\)\.?$/, '') } } : fall(`I don't know the time zone of "${place}"`);
    },
    // "remind me in 10 minutes to call mom": a Windows notification at that time (kept across restarts by main).
    async remind({ at, text }) {
      const when = Number(at);
      if (!Number.isFinite(when) || when < Date.now() - 1000 || when > Date.now() + 7 * 864e5) return fall('that time is not within the next 7 days');
      if (!d.remind) return fall('reminders are not available here');
      d.remind(when, String(text || 'Reminder'), 'reminder');
      const card = { type: 'alarms', items: [{ at: when, text: String(text || 'Reminder'), kind: 'reminder' }] };
      const t = new Date(when), mins = Math.round((when - Date.now()) / 60000);
      const hm = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return { status: 'done', message: `OK, I'll remind you ${mins < 60 ? `in ${Math.max(1, mins)} minute${mins === 1 ? '' : 's'}` : `at ${hm}`} (${hm}): "${text}". Keep Genisys running (it can sit in the tray).`, card };
    },
    // "play current movie in potplayer" / "pause the music" / "next song on vlc": the app that is already open, never a new
    // one. Its real state is read first, so "play" never pauses a film that is playing. Not open: a play opens the app.
    async media({ op = 'play', app = '' }) {
      if (!d.mediaControl) return fall('media control is not available here');
      const NAME = { potplayer: 'PotPlayer', vlc: 'VLC', spotify: 'Spotify', browser: 'the browser', 'media player': 'Media Player', aimp: 'AIMP', netflix: 'Netflix' };
      const who = NAME[app] || app;
      const r = await d.mediaControl(app, op);
      if (!r?.running) {
        if (app && op === 'play' && app !== 'browser') { const o = await A.open_app({ name: app }); return o.status === 'done' ? { ...o, message: `${who} wasn't open, so I opened it. Pick what to play.` } : o; }
        return { status: 'done', message: app ? `${who} isn't open.` : 'Nothing is playing right now.' };
      }
      const title = String(r.title || '').replace(/\s+-\s+(PotPlayer|VLC media player|Spotify.*)$/i, '');
      const verb = { play: 'Playing', pause: 'Paused', toggle: r.after === 'Playing' ? 'Playing' : 'Paused', next: 'Next', prev: 'Back to' }[op];
      let message;
      if (r.via === 'session') {
        if (op === 'play' && r.before === 'Playing') message = `${who || 'It'} is already playing${title ? `: ${title}` : ''}.`;
        else if (op === 'pause' && r.before !== 'Playing') message = `${who || 'It'} is already paused${title ? `: ${title}` : ''}.`;
        else message = `${verb}${title ? ` ${title}` : ''} in ${who || 'the player'}${r.before && r.after && r.before !== r.after ? ` (was ${r.before.toLowerCase()})` : ''}.`;
      } else message = `${who} doesn't report if it's playing, so I brought it forward and pressed ${op === 'next' ? 'next' : op === 'prev' ? 'previous' : 'play/pause'}${title ? ` (${title})` : ''}.`;
      const state = r.via === 'session' ? String(r.after || '').toLowerCase() : 'sent';
      return { status: 'done', message, card: { type: 'music', title: title || who, source: who, sub: state === 'sent' ? 'key sent' : state, mediaApp: app || '_current', paused: state === 'paused' } };
    },
    // "show me all my alarms and timers": each kind's own list, all in one grid of small cards
    async overview({ parts = '' }) {
      const want = String(parts).split(',').map((x) => x.trim()).filter(Boolean);
      const runs = { timers: () => A.timer({ op: 'status' }), alarms: () => A.alarm({ op: 'list' }), reminders: () => A.alarm({ op: 'list' }), notes: () => A.note({ op: 'show' }),
        shopping: () => A.note({ op: 'show', list: 'shopping' }), todo: () => A.note({ op: 'show', list: 'to-do' }), stopwatch: () => A.stopwatch({ op: 'status' }) };
      const seen = new Set(), cards = [], lines = [];
      for (const k of want) {
        const key = k === 'reminders' && want.includes('alarms') ? 'alarms' : k; // one list holds alarms and reminders
        if (seen.has(key) || !runs[key]) continue; seen.add(key);
        const r = await Promise.resolve().then(() => runs[key]()).catch(() => null);
        if (!r || r.status !== 'done') continue;
        lines.push(r.message);
        cards.push(r.card || { type: 'big', icon: 'star', title: key[0].toUpperCase() + key.slice(1), value: 'None', sub: r.message });
      }
      if (!cards.length) return fall('nothing to show');
      return { status: 'done', message: lines.join('\n'), card: { type: 'grid', cards } };
    },
    // "good morning" / "what does my day look like": one summary of today (like Cortana's): the date, the weather,
    // today's alarms and reminders, running timers, open notes and the shopping list. Each part is skipped if it is empty.
    async briefing() {
      const n = new Date(), h = n.getHours();
      const hello = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
      const lines = [`It's ${n.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}, ${n.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`];
      try { const j = d.weather ? await d.weather('') : null; const c = j?.current_condition?.[0], t = j?.weather?.[0]; if (c && t) lines.push(`Weather: ${c.temp_C}°C, ${String(c.weatherDesc?.[0]?.value || '').trim()}, ${t.mintempC}°–${t.maxtempC}° today.`); } catch {}
      const end = new Date(n); end.setHours(23, 59, 59, 999);
      const items = d.clock ? d.clock.list() : [];
      const today = items.filter((r) => r.kind !== 'timer' && r.paused == null && r.at >= n.getTime() && r.at <= end.getTime()).sort((a, b) => a.at - b.at);
      const hm = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (today.length) lines.push(`Today: ${today.map((r) => `${hm(r.at)} ${r.kind === 'alarm' ? 'alarm' : 'reminder'}${r.text && !/^(alarm|reminder)$/i.test(r.text) ? ` (${r.text})` : ''}`).join(', ')}.`);
      const timers = items.filter((r) => r.kind === 'timer');
      if (timers.length) lines.push(`Timers: ${timers.map((r) => `${r.label || 'timer'} ${r.paused != null ? '(paused)' : `rings ${hm(r.at)}`}`).join(', ')}.`);
      if (d.notes) {
        const open = d.notes.list(null).filter((x) => !x.done), shop = d.notes.list('shopping').filter((x) => !x.done), todo = d.notes.list('to-do').filter((x) => !x.done);
        if (todo.length) lines.push(`To do: ${todo.slice(0, 5).map((x) => x.text).join(', ')}${todo.length > 5 ? ` +${todo.length - 5} more` : ''}.`);
        if (open.length) lines.push(`Notes: ${open.slice(0, 3).map((x) => x.text).join('; ')}${open.length > 3 ? ` +${open.length - 3} more` : ''}.`);
        if (shop.length) lines.push(`Shopping list: ${shop.length} item${shop.length === 1 ? '' : 's'}.`);
      }
      if (lines.length === 1) lines.push('Nothing planned yet: say "remind me…" or "add … to my to-do list".');
      return { status: 'done', message: `${hello}! ${lines.join(' ')}`, card: { type: 'brief', title: hello, lines } };
    },
    // "show me calendar": this month, today, and every alarm / reminder in the next 6 weeks (from the clock store)
    calendar() {
      const up = (d.clock ? d.clock.list() : []).filter((r) => r.kind !== 'timer' && r.at > Date.now() && r.at < Date.now() + 42 * 864e5).sort((a, b) => a.at - b.at);
      const now = new Date();
      const hm = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const lines = up.slice(0, 5).map((r) => `${new Date(r.at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${hm(r.at)}: ${r.text && !/^(alarm|reminder)$/i.test(r.text) ? r.text : (r.kind || 'reminder')}`);
      return { status: 'done', message: `Today is ${now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.${up.length ? ` Coming up: ${lines.join('; ')}.` : ' Nothing scheduled.'}`,
        card: { type: 'calendar', year: now.getFullYear(), month: now.getMonth(), items: up.map((r) => ({ at: r.at, text: r.text, kind: r.kind || 'reminder' })) } };
    },
    // "how much ram is chrome using": every process of that app counted (Chrome runs as many), never "not running" by mistake
    async app_usage({ name }) {
      const ALIAS = { 'google chrome': 'chrome', chrome: 'chrome', edge: 'msedge', 'microsoft edge': 'msedge', word: 'winword', 'microsoft word': 'winword', excel: 'excel', powerpoint: 'powerpnt', 'vs code': 'code', vscode: 'code', 'visual studio code': 'code', teams: 'ms-teams', whatsapp: 'whatsapp', spotify: 'spotify', potplayer: 'potplayer', 'file explorer': 'explorer', genisys: 'electron' };
      const want = String(name || '').toLowerCase().trim();
      const proc = (ALIAS[want] || want).replace(/[^a-z0-9 ._-]/g, '').trim();
      if (!proc || !d.procMem) return fall('no app name');
      const r = await d.procMem(proc);
      const label = want.replace(/\b\w/g, (x) => x.toUpperCase());
      if (!r || r === 'none' || !r.count) return { status: 'done', message: `${label} isn't running right now.` };
      const pct = d.totalRam ? Math.round((r.mb * 1048576 / d.totalRam) * 100) : null;
      return { status: 'done', message: `${label} is using ${r.mb >= 1024 ? `${(r.mb / 1024).toFixed(1)} GB` : `${r.mb} MB`} of RAM${pct != null ? ` (${pct}% of your memory)` : ''} across ${r.count} process${r.count === 1 ? '' : 'es'}.`,
        card: { type: 'big', icon: 'star', title: `${label} · RAM`, value: r.mb >= 1024 ? `${(r.mb / 1024).toFixed(1)} GB` : `${r.mb} MB`, sub: `${pct != null ? `${pct}% of your memory · ` : ''}${r.count} process${r.count === 1 ? '' : 'es'}` } };
    },
    // "what's the weather in kigali (tomorrow)": the answer here (wttr.in, no key), the web search only if that fails
    async weather({ place = '', when = 'today', ask = '' }) {
      const where = String(place || '').trim();
      const web = () => viaBrowser(searchUrl(`weather ${where} ${when === 'today' ? '' : when}`.trim()));
      if (!d.weather) return web();
      let j = null; try { j = await d.weather(where); } catch {}
      const c = j?.current_condition?.[0], days = j?.weather || [];
      if (!c || !days.length) { const r = await web(); return { ...r, message: `I couldn't get the forecast right now, so I opened a search. ${r.message || ''}`.trim() }; }
      const name = where ? where.replace(/\b\w/g, (x) => x.toUpperCase()) : (j.nearest_area?.[0]?.areaName?.[0]?.value || 'Here');
      const desc = (x) => String(x?.weatherDesc?.[0]?.value || '').trim();
      if (when === 'tomorrow' && days[1]) {
        const t = days[1], mid = t.hourly?.[4] || t.hourly?.[0];
        const rain = Math.max(...(t.hourly || []).map((h) => Number(h.chanceofrain) || 0));
        const tip = ask === 'rain' ? (rain >= 50 ? ` Yes, take an umbrella.` : rain >= 25 ? ` Maybe take an umbrella, just in case.` : ` No umbrella needed.`) : '';
        return { status: 'done', message: `Tomorrow in ${name}: ${desc(mid)}, ${t.mintempC}° to ${t.maxtempC}°C${rain ? `, ${rain}% chance of rain` : ''}.${tip}`,
          card: { type: 'weather', place: name, temp: Number(t.maxtempC), desc: desc(mid), hi: t.maxtempC, lo: t.mintempC, rain, label: 'Tomorrow', tip: tip.trim() } };
      }
      const t = days[0], rain = Math.max(...(t.hourly || []).map((h) => Number(h.chanceofrain) || 0));
      const tip = ask === 'rain' ? (rain >= 50 ? ' Yes, take an umbrella.' : rain >= 25 ? ' Maybe take an umbrella, just in case.' : ' No umbrella needed.') : '';
      return { status: 'done', message: `${name}: ${c.temp_C}°C, ${desc(c)} (feels like ${c.FeelsLikeC}°). Today ${t.mintempC}° to ${t.maxtempC}°${rain ? `, ${rain}% chance of rain` : ''}.${tip}`,
        card: { type: 'weather', place: name, temp: Number(c.temp_C), feels: c.FeelsLikeC, desc: desc(c), hi: t.maxtempC, lo: t.mintempC, rain, label: 'Now', tip: tip.trim(),
          next: days[1] ? `Tomorrow ${days[1].mintempC}°–${days[1].maxtempC}°, ${desc(days[1].hourly?.[4] || days[1].hourly?.[0])}` : '' } };
    },
    // ---- Siri-style clock tools. One-line answers like a phone assistant.
    // Every timer has its own id: cancel / pause touch only that one ("cancel the timer" with no id = all of them).
    async timer({ op = 'set', seconds, label, total, id, all }) { // total: the original length when a paused timer resumes
      if (!d.clock) return fall('timers are not available here');
      // "pause the rice timer": the timer with that name (no match = say so, never touch the others)
      if (op !== 'set' && op !== 'status' && !id && label) {
        const hit = d.clock.list().find((r) => r.kind === 'timer' && String(r.label || '').toLowerCase() === String(label).toLowerCase());
        if (!hit) return { status: 'done', message: `You have no timer called "${label}".` };
        id = hit.id;
      }
      // several timers and no name ("cancel the timer"): ask which one, like a phone does; "All of them" is one choice
      if ((op === 'cancel' || op === 'pause' || op === 'resume') && !id && all !== 'yes') {
        const cands = d.clock.list().filter((r) => r.kind === 'timer' && (op === 'cancel' || (op === 'pause' ? r.paused == null : r.paused != null)));
        if (cands.length > 1) {
          const lft = (r) => fmtSecs((r.paused != null ? r.paused : r.at - Date.now()) / 1000);
          return { status: 'choose', message: `Which timer should I ${op}?`, options: [
            ...cands.map((r) => ({ label: r.label ? `${r.label} timer` : 'Timer', detail: `${lft(r)} left${r.paused != null ? ', paused' : ''}`, action: 'timer', params: { op, id: r.id } })),
            { label: 'All of them', detail: `${cands.length} timers`, action: 'timer', params: { op, all: 'yes' } }] };
        }
      }
      const leftMs = (r) => (r.paused != null ? r.paused : r.at - Date.now());
      const left = (r) => fmtSecs(leftMs(r) / 1000);
      const name = (r) => (r.label ? `${r.label} timer` : 'timer');
      const mine = () => d.clock.list().filter((r) => r.kind === 'timer').sort((a, b) => leftMs(a) - leftMs(b));
      const running = () => mine().filter((r) => r.paused == null);
      const item = (r) => ({ id: r.id, ends: r.paused != null ? Date.now() + r.paused : r.at, total: r.total || Math.max(1, leftMs(r) / 1000), label: r.label, paused: r.paused != null });
      if (op === 'status') { const l = mine(); return { status: 'done', message: l.length ? l.map((r) => `${name(r)}: ${left(r)} left${r.paused != null ? ' (paused)' : ''}`).join('\n') : 'No timer is running.', ...(l.length ? { card: { type: 'timer', items: l.map(item), warn: clashWarning(running(), 'timers') } } : {}) }; }
      if (op === 'cancel') { const gone = d.clock.cancel('timer', id || undefined); return { status: 'done', message: gone.length ? `Cancelled ${gone.length === 1 ? `your ${name(gone[0])}` : `${gone.length} timers`}.` : 'No timer was running.' }; }
      if (op === 'pause' || op === 'resume') {
        const hit = op === 'pause' ? d.clock.pause(id || undefined) : d.clock.resume(id || undefined);
        if (!hit.length) return { status: 'done', message: op === 'pause' ? 'No running timer to pause.' : 'No paused timer to resume.' };
        const one = hit.length === 1 ? hit[0] : null;
        return { status: 'done', message: `${op === 'pause' ? 'Paused' : 'Resumed'} ${one ? `your ${name(one)} (${left(one)} left)` : `${hit.length} timers`}.`, ...(one ? { card: { type: 'timer', ...item(one) } } : {}) };
      }
      const s = Number(seconds);
      if (!Number.isFinite(s) || s < 1 || s > 24 * 3600) return fall('a timer needs a length between 1 second and 24 hours');
      const ends = Date.now() + s * 1000;
      const full = Math.max(s, Number(total) || 0);
      const r = d.remind(ends, label ? `${label} timer is done` : 'Timer is done', 'timer', { total: full, ...(label ? { label } : {}) });
      // the new timer gets the card; other running ones are one line, and a warning only when they ring with this one
      const others = mine().filter((x) => x.id !== r?.id);
      const same = others.filter((x) => x.paused == null && Math.abs(x.at - ends) < 60000); // a paused timer rings at no time yet
      const hm = new Date(ends).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const warn = same.length ? `Rings at the same time as your ${same.map(name).join(' and ')} (${hm}).` : '';
      return { status: 'done', message: `${fmtSecs(s)} timer${label ? ` for ${label}` : ''}, starting now. I'll ring when it's done.${warn ? ` Careful: ${warn}` : ''}`,
        card: { type: 'timer', id: r?.id, ends, total: full, label, warn, also: others.map((x) => ({ label: x.label, ends: x.at, paused: x.paused != null })) } };
    },
    async alarm({ op = 'set', at, label, kind, h, m = 0, day: dayWord, past, id, all }) {
      if (!d.clock) return fall('alarms are not available here');
      const hm = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const day = (ms) => (new Date(ms).toDateString() === new Date().toDateString() ? 'today' : new Date(ms).toDateString() === new Date(Date.now() + 864e5).toDateString() ? 'tomorrow' : new Date(ms).toLocaleDateString());
      // the time was not clear ("alarm for 7", or a time today that already passed): offer the real choices, set nothing yet
      if (op === 'ask') {
        const at24 = (H, plusDay) => { const x = new Date(); x.setHours(H, Number(m) || 0, 0, 0); if (plusDay) x.setDate(x.getDate() + 1); return x.getTime(); };
        const hours = past ? [Number(h)] : [Number(h) % 12, (Number(h) % 12) + 12];
        let opts = [];
        for (const H of hours) for (const plus of [false, true]) { const t2 = at24(H, plus); if (t2 > Date.now() && (dayWord !== 'today' || !plus) && (dayWord !== 'tomorrow' || plus)) opts.push(t2); }
        opts = [...new Set(opts)].sort((a, b) => a - b).slice(0, 3);
        if (!opts.length) return fall('that time has already passed today');
        const inTxt = (t2) => { const mins = Math.round((t2 - Date.now()) / 60000); return mins < 60 ? `in ${mins} min` : `in ${Math.floor(mins / 60)} h ${mins % 60} min`; };
        return { status: 'choose', message: past ? `${hm(at24(Number(h)))} has already passed today. Set it for tomorrow?` : `Which ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}?`,
          options: opts.map((t2) => ({ label: `${hm(t2)} ${day(t2)}`, detail: inTxt(t2), action: 'alarm', params: { op: 'set', at: t2, ...(label ? { label } : {}) } })) };
      }
      if (op === 'list') {
        const l = d.clock.list().filter((r) => r.kind !== 'timer').sort((a, b) => a.at - b.at);
        return { status: 'done', message: l.length ? l.map((r) => `${r.kind === 'alarm' ? 'Alarm' : 'Reminder'} ${day(r.at)} at ${hm(r.at)}${r.text && r.text !== 'Alarm' ? `: ${r.text}` : ''}`).join('\n') : 'You have no alarms or reminders.', card: { type: 'alarms', items: l.map((r) => ({ id: r.id, at: r.at, text: r.text, kind: r.kind || 'reminder' })), warn: clashWarning(l, 'alarms') } };
      }
      if (op === 'cancel') {
        const pool = d.clock.list().filter((r) => r.kind !== 'timer');
        const kindOf = (r) => r.kind || 'reminder';
        let k = kind === 'reminder' ? 'reminder' : 'alarm';
        if (!id && label) { // by name, alarms and reminders alike: "call mom" finds the reminder "call mom" (or "call mom at 5")
          const want = String(label).toLowerCase().trim();
          const hits = pool.filter((r) => String(r.label || r.text || '').toLowerCase() === want);
          const hit = hits[0] || pool.find((r) => String(r.text || '').toLowerCase().includes(want));
          // never "done": the AI must not tell the user something was cancelled when nothing was
          if (!hit) return { status: 'fall', reason: `nothing cancelled: there is no alarm or reminder called "${label}"` };
          id = hit.id; k = kindOf(hit);
        }
        const mine = pool.filter((r) => kindOf(r) === k);
        // several and none named: which one? (never wipe them all by surprise)
        if (!id && all !== 'yes' && mine.length > 1) {
          return { status: 'choose', message: `Which ${k} should I cancel?`, options: [
            ...mine.sort((a, b) => a.at - b.at).map((r) => ({ label: `${r.text && !/^(alarm|reminder)$/i.test(r.text) ? `${r.text} · ` : ''}${hm(r.at)} ${day(r.at)}`, detail: k, action: 'alarm', params: { op: 'cancel', id: r.id, ...(k === 'reminder' ? { kind: k } : {}) } })),
            { label: 'All of them', detail: `${mine.length} ${k}s`, action: 'alarm', params: { op: 'cancel', all: 'yes', ...(k === 'reminder' ? { kind: k } : {}) } }] };
        }
        const gone = d.clock.cancel(k, id || undefined);
        return { status: 'done', message: gone.length ? (gone.length === 1 ? `Cancelled the ${k} for ${hm(gone[0].at)} ${day(gone[0].at)}.` : `Cancelled ${gone.length} ${k}s.`) : `You had no ${k}s.` };
      }
      const when = Number(at);
      if (!Number.isFinite(when) || when < Date.now() - 1000 || when > Date.now() + 7 * 864e5) return fall('that time is not within the next 7 days');
      const text = label || 'Alarm';
      const before = d.clock.list().filter((r) => r.kind === 'alarm');
      // the very same alarm again (same minute, same name): keep the one there is, never stack copies
      const twin = before.find((r) => Math.abs(r.at - when) < 60000 && String(r.text || '').toLowerCase() === text.toLowerCase());
      if (twin) return { status: 'done', message: `You already have that alarm: ${hm(twin.at)} ${day(twin.at)}${label ? ` (${label})` : ''}.`, card: { type: 'alarms', items: [{ id: twin.id, at: twin.at, text: twin.text, kind: 'alarm' }] } };
      const r = d.remind(when, text, 'alarm');
      // the reply is about THIS alarm; others are one line, and a warning only when one rings with it
      const same = before.filter((x) => Math.abs(x.at - when) < 60000);
      const warn = same.length ? `${same.length === 1 ? 'Another alarm rings' : `${same.length} other alarms ring`} at the same time (${hm(when)}${same.some((x) => x.text && x.text !== 'Alarm') ? `: ${same.map((x) => x.text).join(', ')}` : ''}).` : '';
      return { status: 'done', message: `Alarm set for ${hm(when)} ${day(when)}${label ? ` (${label})` : ''}. Keep the PC on and Genisys running (it can sit in the tray).${warn ? ` Careful: ${warn}` : ''}`,
        card: { type: 'alarms', items: [{ id: r?.id, at: when, text, kind: 'alarm' }], warn, also: before.sort((a, b) => a.at - b.at).map((x) => ({ at: x.at, text: x.text })) } };
    },
    stopwatch({ op = 'status' }) {
      if (!d.stopwatch) return fall('the stopwatch is not available here');
      const r = d.stopwatch[op]?.();
      if (!r) return fall(`unknown stopwatch command ${op}`);
      const t = fmtSecs(r.ms / 1000);
      const msg = { start: r.was ? `The stopwatch is already running: ${t}.` : 'Stopwatch started.', stop: r.ran ? `Stopped at ${t}.` : `The stopwatch isn't running${r.ms ? ` (it stopped at ${t})` : ''}.`, status: r.running ? `${t} so far.` : r.ms ? `Stopped at ${t}.` : "The stopwatch isn't running. Say \"start a stopwatch\".", reset: 'Stopwatch reset.' }[op];
      const cur = d.stopwatch.status();
      return { status: 'done', message: msg, card: { type: 'stopwatch', running: cur.running, ms: cur.ms } };
    },
    // Notes live in Genisys (its database), shown in the notes card: add, tick off, delete.
    note({ op = 'add', text, id, list }) {
      if (!d.notes) return fall('notes are not available here');
      const L = list ? String(list).toLowerCase() : null; // a list ("shopping") or plain notes
      const title = L ? `${L[0].toUpperCase()}${L.slice(1)} list` : 'Notes';
      const card = (added) => { const items = d.notes.list(L).map((n) => ({ id: n.id, ts: n.ts, text: n.text, done: !!n.done })); return { type: 'notes', items, added, title, list: L }; };
      // "add eggs, milk and bread to my shopping list": one item each
      if (op === 'add' && L) {
        const items = String(text || '').split(/\s*(?:,|\band\b|&)\s*/).map((x) => x.trim()).filter(Boolean);
        if (!items.length) return fall('nothing to add');
        const have = new Set(d.notes.list(L).filter((n) => !n.done).map((n) => n.text.toLowerCase()));
        const fresh = items.filter((x) => !have.has(x.toLowerCase()));
        let last = null; for (const x of fresh) last = d.notes.add(x, L);
        const c = card(last);
        return { status: 'done', message: fresh.length ? `Added ${fresh.join(', ')} to your ${L} list (${c.items.filter((n) => !n.done).length} items).` : `${items.join(', ')} ${items.length === 1 ? 'is' : 'are'} already on your ${L} list.`, card: c };
      }
      if (op === 'remove' && L) {
        const want = String(text || '').toLowerCase().split(/\s*(?:,|\band\b|&)\s*/).filter(Boolean);
        const hit = d.notes.list(L).filter((n) => want.includes(n.text.toLowerCase()));
        for (const n of hit) d.notes.del(n.id);
        return { status: 'done', message: hit.length ? `Removed ${hit.map((n) => n.text).join(', ')} from your ${L} list.` : `${text} isn't on your ${L} list.`, card: card() };
      }
      if (op === 'clear' && L) { const all = d.notes.list(L); for (const n of all) d.notes.del(n.id); return { status: 'done', message: all.length ? `Cleared your ${L} list (${all.length} items).` : `Your ${L} list was already empty.`, card: card() }; }
      if (op === 'show' && L) { const c = card(), open = c.items.filter((n) => !n.done); return { status: 'done', message: open.length ? `Your ${L} list: ${open.map((n) => n.text).join(', ')}.` : `Your ${L} list is empty.`, card: c }; }
      if (op === 'done' || op === 'undo') { d.notes.done(id, op === 'done'); return { status: 'done', message: op === 'done' ? 'Ticked off.' : 'Back on the list.', card: card() }; }
      if (op === 'delete') { d.notes.del(id); return { status: 'done', message: 'Note deleted.', card: card() }; }
      if (op === 'show') {
        const c = card(), open = c.items.filter((n) => !n.done);
        return { status: 'done', message: c.items.length ? `Your notes (${open.length} open):\n${open.slice(0, 15).map((n) => `- ${n.text}`).join('\n')}` : 'You have no notes yet. Say "take a note …".', card: c };
      }
      const t = String(text || '').trim();
      if (!t) return fall('no note text');
      const nid = d.notes.add(t, L);
      return { status: 'done', message: `Noted: "${t}".`, card: card(nid) };
    },
    quick({ op, n = 1, min = 1, max = 100, what, date }) {
      const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
      if (op === 'when') { // straight from the clock (Siri once famously couldn't say the month)
        const n = new Date(), w = String(what || 'date');
        const week = (() => { const x = new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day); return Math.ceil(((x - new Date(Date.UTC(x.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7); })();
        const text = w === 'month' ? n.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : w === 'year' ? String(n.getFullYear()) : w === 'week' ? `Week ${week}` : w === 'day' ? n.toLocaleDateString(undefined, { weekday: 'long' }) : n.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        return { status: 'done', message: `It's ${text}.`, card: { type: 'big', icon: 'star', title: w === 'date' ? 'Today' : `This ${w}`, value: text, sub: w === 'date' ? '' : n.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) } };
      }
      if (op === 'calc') { // worked out here, exactly; the card shows the answer big
        const v = calc(String(what || ''));
        if (v == null) return fall('not a calculation I can do here');
        const shown = Math.abs(v) >= 1e15 || (v !== 0 && Math.abs(v) < 1e-6) ? v.toExponential(6) : v.toLocaleString('en-US', { maximumFractionDigits: 8 });
        return { status: 'done', message: `${what} = ${shown}`, card: { type: 'big', icon: 'star', title: String(what).replace(/^(?:what(?:'s| is)|whats|how much is|calculate|compute)\s+/i, '').replace(/[?\s]+$/, ''), value: shown } };
      }
      if (op === 'coin') { const side = Math.random() < 0.5 ? 'heads' : 'tails'; return { status: 'done', message: `It's ${side}.`, card: { type: 'coin', side } }; }
      if (op === 'dice') { const k = Math.max(1, Math.min(10, Number(n) || 1)); const r = Array.from({ length: k }, () => rnd(1, 6)); return { status: 'done', message: k === 1 ? `You rolled a ${r[0]}.` : `You rolled ${r.join(', ')} (total ${r.reduce((x, y) => x + y, 0)}).`, card: { type: 'dice', rolls: r } }; }
      if (op === 'number') { const a = Math.min(Number(min), Number(max)), b = Math.max(Number(min), Number(max)); const v = rnd(a, b); return { status: 'done', message: `${v}.`, card: { type: 'big', icon: 'dice', title: 'Random number', value: v, sub: `between ${a} and ${b}` } }; }
      if (op === 'days_until' && date) { const k = daysUntil(String(date)); return { status: 'done', message: k === 0 ? `${what} is today!` : `${k} day${k === 1 ? '' : 's'} until ${what} (${new Date(`${date}T00:00:00`).toDateString()}).`, card: { type: 'big', icon: 'star', title: `Until ${what}`, value: k === 0 ? 'Today!' : `${k} day${k === 1 ? '' : 's'}`, sub: new Date(`${date}T00:00:00`).toDateString() } }; }
      return fall('unknown quick request');
    },
    // "play some chill music": whatever THIS PC has. A named app if it is installed; else the user's own songs
    // (Music folder, matching words first) as a playlist in their default player; else YouTube.
    async play_music({ query = '', app, path: one }) {
      const q = String(query || '').trim(), a = String(app || '').toLowerCase();
      // one exact song (from a list on screen): it plays first in Genisys's own player, the rest of its folder after it
      if (one && !a && d.mediaUrl?.(one)) {
        if (!inside(one) || !d.exists(one)) return fall(`${base(one)} not found`);
        let more = [];
        if (d.scanFiles) { try { more = (await d.scanFiles(path.dirname(one))).files.filter((f) => f.kind === 'audio' && f.path !== one).map((f) => f.path).slice(0, 99); } catch {} }
        const tracks = [one, ...more].map((p) => ({ url: d.mediaUrl(p), title: base(p).replace(/\.\w+$/, '').replace(/[_]+/g, ' ').replace(/\s*\((?:m4a|mp3)[ _]?\d+k\)\s*$/i, ''), path: p }));
        return { status: 'done', message: `Playing ${tracks[0].title} in Genisys.`, card: { type: 'player', title: tracks[0].title, tracks } };
      }
      const yt = async (why) => { await d.shell.openExternal(`https://www.youtube.com/results?search_query=${encodeURIComponent(`${q || 'chill'} music`)}`); return { status: 'done', message: `${why}Opened YouTube with ${q || 'chill'} music: press play on a video you like.`, card: { type: 'music', title: q || 'Chill music', source: 'YouTube', sub: 'press play on a video you like', controls: false } }; };
      if (a === 'youtube' || a === 'youtube music') return yt('');
      if (a === 'spotify') {
        if (!d.resolveApp('spotify') && !(d.catalog?.() || []).some((e) => /spotify/i.test(e.name) && e.kind !== 'site' && e.kind !== 'pwa')) return yt("Spotify isn't installed on this PC. ");
        await d.shell.openExternal(`spotify:search:${encodeURIComponent(q || 'chill')}`);
        return { status: 'done', message: `Opened Spotify on "${q || 'chill'}": press play on the top result (Spotify only lets you start it).`, card: { type: 'music', title: q || 'Chill', source: 'Spotify', sub: 'press play on the top result' } };
      }
      let songs = [];
      if (d.scanFiles && d.paths.music) { try { songs = (await d.scanFiles(d.paths.music)).files.filter((f) => f.kind === 'audio'); } catch {} }
      if (!songs.length) return a ? fall(`no songs found in your Music folder for ${a}`) : yt("I found no songs in your Music folder, so ");
      const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !/^(some|music|songs?|chill|relax\w*)$/.test(w));
      const hit = words.length ? songs.filter((f) => words.some((w) => f.path.toLowerCase().includes(w))) : [];
      const list = (hit.length ? hit : songs).map((f) => f.path).sort(() => Math.random() - 0.5).slice(0, 100);
      const exe = a ? (d.resolveApp(a) || null) : null;
      const what = `${list.length} of your own song${list.length === 1 ? '' : 's'}${hit.length ? ` matching "${words.join(' ')}"` : words.length ? ` (none matched "${words.join(' ')}", so all of them shuffled)` : ', shuffled'}`;
      if ((!a || !exe) && d.mediaUrl?.(list[0])) { // Genisys's own player: the songs stream into the chat card, no other program
        const tracks = list.map((p) => ({ url: d.mediaUrl(p), title: base(p).replace(/\.\w+$/, '').replace(/[_]+/g, ' ').replace(/\s*\((?:m4a|mp3)[ _]?\d+k\)\s*$/i, ''), path: p }));
        return { status: 'done', message: `Playing ${what} in Genisys.`, card: { type: 'player', title: hit.length ? words.join(' ') : 'Your music', tracks } };
      }
      const m3u = path.join(d.tempDir || d.paths.music, 'genisys-playlist.m3u'); // a player the user named: hand it the playlist
      try { d.writeFile(m3u, `#EXTM3U\r\n${list.join('\r\n')}\r\n`); } catch (e) { return fall(`could not make the playlist: ${e.message}`); }
      if (exe) d.spawnDetached(exe, [m3u]);
      else { const err = d.openPlaylist ? await d.openPlaylist(m3u, list[0]) : await d.shell.openPath(m3u); if (err) return fall(err); } // the player is not ready yet: the PC's own
      return { status: 'done', message: `Playing ${what} in ${a || 'your music player'}.`, card: { type: 'music', title: hit.length ? words.join(' ') : 'Your music', source: a || 'music player', controls: !!a, sub: `${list.length} song${list.length === 1 ? '' : 's'}, shuffled` } };
    },
    // Opens the chat with a contact in a desktop chat app and pastes the file/text. It never sends: you press Send.
    // Apps not in CHAT_APPS fall back to the AI, which writes a script; a script that works is remembered for that app.
    async chat_send({ app, to, path: p, text }) {
      const a = String(app || '').toLowerCase().replace(/\s+(desktop|app)$/, '').trim(), who = String(to || '').trim();
      const how = CHAT_APPS[a];
      if (!how) return fall(`no built-in way to drive ${app || 'that app'} yet`);
      if (!who) return fall('no contact name');
      if (p && !inside(p)) return fall(`${p} is outside the allowed folders`);
      if (p && !d.exists(p)) return fall(`${base(p)} not found`);
      if (!p && !String(text || '').trim()) return fall('nothing to send: no file and no text');
      if (!d.chatSend) return fall('cannot drive apps here');
      const o = await A.open_app({ name: a });
      if (o.status !== 'done') return o;
      const r = await d.chatSend({ title: how.title, search: how.search, to: who, path: p || '', text: p ? '' : String(text) });
      if (!r?.ok) return fall(`opened ${how.title} but could not open the chat with ${who}${r?.error ? `: ${r.error}` : ''}`);
      return { status: 'done', message: `Opened ${how.title} on the chat with "${who}"${p ? ` and attached ${base(p)}` : ' and typed the message'}. It is NOT sent: check it is the right person, then press Send.` };
    },
    async open_app({ name, url, profile, id, q }) {
      let key = String(name || '').toLowerCase().trim(), noFav = '';
      if (id) { // a choice from a choose card: that exact catalog entry
        const e = (d.catalog?.() || []).find((x) => x.id === id);
        if (!e) return fall('that item is no longer in the catalog');
        if (q) d.learn?.(catNorm(q), e.id, 1, 0); // chosen from a card: that request means this
        return launchEntry(e, 0, q);
      }
      if (!key) return fall('no app name');
      // "open my email" / "open my music": the favorite app of that kind (set it with "my email is outlook"), else a sensible default.
      const kind = appForCategory(key, d.prefs?.() || {});
      if (kind && !profile) {
        if (!kind.app) noFav = kind.category; // no favorite yet: the catalog may still know exactly one such app
        else if (SITES[kind.app]) { const r = await viaBrowser(SITES[kind.app]); return { ...r, message: `${r.message} (your favorite ${kind.category}: ${kind.app})` }; }
        else key = kind.app;
      }
      // "open chrome" with a favorite profile for it: that profile, so you are signed in
      const favP = !profile && !url ? favoriteProfile(d.prefs?.() || {}, key) : null;
      if (favP) { const r = await viaBrowser('', key, favP, { noFavorites: true }); if (r.status === 'done') return { ...r, message: `${r.message} (your favorite profile)` }; }
      if (profile) { // "open the Kevin chrome profile": the browser itself, in that profile, no page
        const r = await viaBrowser('', key, profile);
        return r;
      }
      if (SYSTEM_URI[key]) { await d.shell.openExternal(SYSTEM_URI[key]); d.catalogTouch?.(key); return { status: 'done', message: `opened ${key}` }; }
      // 1. Predict what was meant from everything this PC has (typos, Chrome apps, Store apps, programs, bookmarks): best score wins.
      //    With a website fallback ("whatsapp", "netflix") only INSTALLED things count, so a bookmark never replaces the real site.
      const cat = d.catalog?.() || [];
      if (cat.length) {
        const pr = predict(cat, key, ctxOf(), { kinds: url ? INSTALLED : KINDS_OPEN });
        if (pr.decision === 'do' && (!url || bare(pr.pick.entry.key) === bare(key))) return launchEntry(pr.pick.entry, pr.ranked[0].p, key); // with a website: only an installed app of that EXACT name ("open google" must not open Google Chrome)
        if (!url && pr.decision === 'choose' && d.labelOn?.() && d.ask && pr.picks.length > 1) { // unsure: ONE tiny question (names only) instead of the whole AI loop
          try {
            const opts = pr.picks.map((r) => ({ name: r.entry.name, kind: r.entry.kind, cat: labelOf(r.entry)?.cat }));
            const i = parsePick(await d.ask(pickMessages(key, opts), { maxTokens: 12, timeoutMs: 4000 }), opts.length);
            if (i >= 0) { const r = await launchEntry(pr.picks[i].entry, 0, key); return r.status === 'done' ? { ...r, message: `${r.message.replace(/ \(.*\)$/, '')} (picked by the model from ${opts.length} close matches)` } : r; }
          } catch {}
        }
        if (!url && pr.decision === 'choose') return { status: 'choose', message: `"${key}": which one?`, options: pr.picks.map((r) => ({ label: r.entry.name, detail: `${r.entry.kind} (${Math.round(r.p * 100)}%)`, action: 'open_app', params: { id: r.entry.id, q: key } })) };
      }
      // 2. Not in the catalog (not scanned yet, or not installed): the website if there is one, then Windows built-ins, then the old lookup.
      if (url) {
        const exe = d.resolveApp(key); // no deep search here: the website is a good answer, a 20 s wait is not
        if (exe) { d.spawnDetached(exe, []); d.catalogTouch?.(key); return { status: 'done', message: `opened ${key}`, resolved: { action: 'open_app', params: { name: key, url } } }; }
        const r = await viaBrowser(url);
        return r.status === 'done' ? { ...r, message: `${key} isn't installed, opened ${url}`, resolved: { action: 'open_app', params: { name: key, url } } } : r;
      }
      if (SYSTEM[key] && !['word', 'excel', 'powerpoint'].includes(key)) {
        const err = await d.shell.openPath(SYSTEM[key]);
        if (!err) { d.catalogTouch?.(key); return { status: 'done', message: `opened ${key}` }; }
      }
      const exe = d.resolveApp(key) || (noFav ? null : await d.findAppDeep?.(key)); // a deeper search once; found paths are remembered
      if (!exe) return fall(noFav ? `you have no favorite ${noFav} app yet. Tell me: "my ${noFav} is <app>"` : `${key} was not found on this PC`);
      d.spawnDetached(exe, []); d.catalogTouch?.(key);
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
      const ext = path.extname(p).slice(1).toLowerCase();
      d.mkdirp(path.dirname(p));
      if (ext === 'pdf') { // a REAL pdf (printed from the text), checked after writing: never plain text under a .pdf name
        if (!d.writePdf) return fall('cannot write a real PDF here');
        const r = await d.writePdf(p, textToHtml(content, base(p).replace(/\.pdf$/i, '')), String(content));
        if (!r?.ok) return fall(`the PDF was not created correctly${r?.error ? `: ${r.error}` : ''}`);
        return { status: 'done', message: `created ${p} (a real PDF, ${fmtSize(r.size)}, opens in any PDF viewer)`, paths: [p] };
      }
      if (BINARY_DOCS.has(ext)) return fall(`.${ext} is not a text format: text saved under that name would be a broken file, so I did not create it`);
      d.writeFile(p, String(content));
      return { status: 'done', message: `created ${p}`, paths: [p] };
    },
    async read_file({ path: p }) {
      if (!inside(p)) return fall(`${p} is outside the allowed folders`);
      if (!d.exists(p)) return fall('file not found');
      const text = String(d.readFile(p) || '');
      return { status: 'done', message: text.trim() ? `${base(p)}:\n${text.slice(0, 4000)}${text.length > 4000 ? '\n…' : ''}` : `${base(p)} is empty.` };
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
