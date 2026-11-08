// highlight.js is loaded lazily, only in Script Writer windows.
let hljs = null;
if (new URLSearchParams(location.search).get('mode') === 'script') import('highlight.js/lib/common').then((m) => { hljs = m.default; });
import logoUrl from '../assets/icon.svg';
import { isRisky } from './risky.js';
import { fixCmd } from './memory.js';
import { createEditor } from './editor.js';
import { initTabs, render, panelOpen } from './tabs.js';
import { spin } from './globe.js';
import { mountGlobe } from './cobeglobe.js';
import { applyAccent } from './accent.js';
import { mountDots } from './dots.js';
import { ANIM } from './anim.js';
import { cookbookHints } from './cookbook.js';
import { parseIntent, FAST_MIN } from './fast/intent.js';
import { cacheLookup, cacheStore, cacheKey } from './fast/cache.js';
import { buildRouterMessages, validateRouterReply } from './fast/router.js';
import { buildScriptMessages, extractScript } from './fast/scriptFallback.js';
applyAccent();

// Editor card: path header + "LANG · N LINES", zero-padded gutter, theme token colors (index.html).
// Code "types in" a few lines per frame so you can watch it being written.
function codeView(file, content) {
  const name = file.split(/[\\/]/).pop();
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const lang = hljs && hljs.getLanguage(ext) ? ext : null;
  const paint = (src) => (!hljs ? esc(src) : lang ? hljs.highlight(src, { language: lang }).value : hljs.highlightAuto(src).value);
  const langName = (hljs ? (lang ? hljs.getLanguage(lang).name : hljs.highlightAuto(content).language) : null) || 'text';
  const lines = content.replace(/\n$/, '').split('\n');

  const ed = document.createElement('div');
  ed.className = 'editor';
  ed.innerHTML = `<div class="eh"><span class="path"></span><span class="meta"></span></div>
    <div class="body"><pre class="gutter"></pre><pre class="src"><code class="hljs"></code></pre></div>`;
  ed.querySelector('.path').textContent = file.split(/[\\/]/).slice(-3).join('/');
  ed.querySelector('.meta').textContent = `${langName} · ${lines.length} lines`;
  const code = ed.querySelector('code');
  const gutter = ed.querySelector('.gutter');
  const pad = String(lines.length).length < 2 ? 2 : String(lines.length).length;
  const per = Math.max(1, Math.ceil(lines.length / 30)); // whole file appears in ~30 frames
  let n = 0;
  const frame = () => {
    n = Math.min(lines.length, n + per);
    code.innerHTML = paint(lines.slice(0, n).join('\n'));
    gutter.textContent = lines.slice(0, n).map((_, i) => String(i + 1).padStart(pad, '0')).join('\n');
    ed.closest('.log')?.scrollTo(0, 1e9);
    if (n < lines.length) setTimeout(frame, 16);
  };
  requestAnimationFrame(frame);
  return ed;
}

// Serious commands (deleting, system/registry/network changes, killing things) are never replayed from memory: the AI re-checks them every time.
const serious = (c) => isRisky(c) || /\b(del|erase|rmdir|rd|format|diskpart|reg\s+(add|delete|import)|shutdown|taskkill|sc\s+(delete|stop|config)|net\s+user|icacls|takeown|netsh|bcdedit|schtasks|Remove-Item|Set-ExecutionPolicy|Stop-Process|Stop-Service|Clear-Disk)\b/i.test(c);

const SYSTEM = `You are Genisys, an autonomous Windows executor and coder. The user's home is %USERPROFILE%.
Each reply MUST be ONE JSON object and nothing else:
{"say": "<one short sentence>", "ask": "<question for the user, or omit>", "options": ["<short answer>", ...] or omit, "decided": "<a choice you made yourself, or omit>", "plan": ["<step>", ...] or omit, "step": <current plan step number, or omit>, "file": {"path": "<path>", "content": "<full file text>"} or null, "cmd": "<cmd.exe batch lines, or empty>", "find": {"name": "<words from the user, typos ok>", "in": "<folder or omit>", "kind": "file|dir|any", "ext": "<pdf, mkv... or omit>", "open": true|false, "with": "<app name to open it with, or omit>"} or omit, "app": {"name": "<app name>", "file": "<path or omit>"} or omit, "trash": ["<path>", ...] or omit, "restore": "<file name or path>" or omit, "web": {"search": "<query>"} or {"read": "<https url>"} or omit, "learn": {"kind": "interest|trait|fact", "text": "<short fact about the user>"} or omit, "improve": "<idea to improve this app or the user's setup, or omit>", "done": true|false}
- "file" is written first (use it for ANY script or code: .py, .js, .ps1, .bat, .html…; never write files with echo). Paths may use %USERPROFILE%; relative paths are under home.
- "cmd" is then written to a .bat file and run; you receive the exit code and output next turn.
THINK before acting:
- DECIDE small things yourself (file names, folders, which of two equal options, sensible defaults) and state it in "decided". Don't bother the user with minor choices.
- AMBIGUOUS TARGET: if the request doesn't say WHERE or WITH WHAT and the choice changes the result ("search this song", "play X", "open my mail", "look this up", "message John"), do NOT guess an app/site: ask first, with 2-4 clickable "options" (e.g. ["Spotify", "YouTube", "Browser search"]). Skip the question only when ABOUT THE USER or the request already tells you (they named the app, or you learned their usual choice). When they pick an option, add "learn" (kind "trait") with their preference so you never ask again.
- ASK only when it really matters (two very different meanings, data could be lost, missing info you can't guess). Give 2-4 "options" the user can click.
- Be HONEST: if an idea is bad, dumb, pointless, harmful or impossible (would wipe data, break Windows, makes no sense), say so plainly in "ask" with the reason, suggest a better way as an option, set cmd empty and done=true. Never just go along with a bad idea.
- When the user reveals something lasting about themselves, ALWAYS add "learn" in that same reply: hobbies and things they collect or love ("i collect anime wallpapers" → interest), job/school/projects (fact), habits and how they like things done (trait). Skip it for plain one-off tasks.
- If you notice something that keeps failing or could clearly work better, put a short suggestion in "improve".
- COMPLEX tasks (3+ actions): in your FIRST reply send "plan": short, simple to-do steps in order, then do them one by one, setting "step" to the step you are working on. Simple tasks: no plan.
INTERNET: you can browse. "web": {"search": "..."} returns the top results (title, url, snippet); "web": {"read": "url"} returns that page as text. Results come back next turn (set done=false). Use it for anything current or that you don't know for sure: news, prices, docs, versions, download links, how-tos. ONE search call already reads the text of the top 2 pages for you, so answer from it right away (done=true) and DON'T read again unless it truly lacks the answer. Use at most 2 web calls per task, and make the query short and specific. To SHOW a site to the user, open it with start "" "<url>" instead.
Be FAST and SMART (every extra step costs the user real seconds):
- Think the WHOLE task through before the first action, pick the shortest path, and finish it in ONE reply when you can. Don't narrate: "say" is one short line (max ~10 words) and is only needed in the FINAL reply or when you ask something; in middle steps leave it "" unless something surprising happened.
- The user types fast: read through typos and loose names ("exploer" = Explorer, "movie folder" = a folder named Movies/movies/Movie). Match folder names case-insensitively and by closest meaning.
- Use the PC CONTEXT below for real paths (Desktop/Documents/Pictures may live in OneDrive). Never search for something already listed there. Ignore copies under CrossDevice, AppData or OneDrive backups unless the user asks for them.
- When the last action needs no checking (opening a folder/app/file/website, starting something), put it in the same reply and set done=true.
- When the user ASKS something (free space, IP, what's in a folder…), set done=false, read the output next turn, then answer in "say" with done=true and empty cmd.
- cmd runs as a .bat FILE: write FOR variables as %%i (not %i). Prefer PowerShell over deprecated wmic.
- FINDING FILES: NEVER guess paths with dir patterns or "where /r C:\" (minutes slow). Use "find": a fast typo-tolerant search ("freegut" finds "Free.Guy"). Put ALL the user's words in "name", including a parent folder and an episode: "mouse trap episode 3" finds Mousetrap.S01E03.mkv inside the folder "mouse trap" (episode numbers match S01E03 / E03 / ep3). Do NOT search the folder first and the file second: ONE find with "in" set to the library folder from PC CONTEXT (Videos, Documents, Downloads…) does it. Set "ext" only for file types ("mkv mp4 avi"). Set "open": true when they want it opened: the app opens the best match itself; if several are equally good, or none, you get candidates back (done=false): ask with them as "options", or retry with other words.
- OPENING WITH A SPECIFIC APP ("play it in PotPlayer", "open in VLC"): add "with": "potplayer" to the find (or {"app":{"name":"potplayer","file":"<path>"}} when you already know the path). The app looks the program up in the Start Menu and Program Files itself. NEVER write Program Files paths from memory and never run "if exist" chains to hunt for an app. If the reply says the app is not installed, tell the user and offer the default player as an option.
- To just open an app ("open spotify", "open notepad"): {"app":{"name":"spotify"}} (or start "" "<name>" for built-in tools like notepad, calc, explorer).
- DELETING and UNDO: to delete files/folders ALWAYS use "trash": ["path", ...] (Recycle Bin, so it can be undone). NEVER use del / rd / Remove-Item unless the user says "permanently". When the user says undo / restore / bring it back, use "restore": "<file name>" (done=true); to undo a move or rename, reverse it. If something was already deleted permanently, do NOT just say it is gone: try "restore" first (it may be in the Recycle Bin), then offer Windows File Recovery: winget install --id Microsoft.WindowsFileRecovery -e, then winfr C: D:\recovered /regular /n \Users\<name>\Music\<file> (destination must be ANOTHER drive, needs admin, works best soon after deleting), or OneDrive/Previous Versions.
- If an approach fails twice, CHANGE strategy (other tool, other command, smaller steps, web search) instead of retrying the same thing. The app will then hand you known-good recipes: use them.
- A command that timed out or failed proves NOTHING (e.g. "killed after 60s" can mean the app DID open). Never conclude "not installed" or "not found" from a timeout: check with find/app or say you're unsure.
- A step that FAILED is never "done": read the error, then try another way. Never say "found it, opening" unless a result confirmed it.
- Commands have NO keyboard input and are killed after 60s: never use pause or set /p, never search whole drives. To show the user a script's output or an interactive program, open it in its own window: start "" cmd /k "<script>".
- Scripts you write for the user may use pause (they run in their own window).
- Open folders/apps/URLs with start "" "<path or url>" so the batch does not block.
- Long-running servers/watchers: start "" cmd /k "cd /d <dir> && <cmd>" so they run in their own window.
- PowerShell is allowed via: powershell -NoProfile -Command "..."
- Before sending a cmd, silently double-check it: the user's words are copied EXACTLY (never swap or add characters in names, songs or search text), quotes balance, paths exist in PC CONTEXT, and the command really does what was asked. A search must contain the user's real words with normal spaces.
- In a .bat file a literal % must be written %% (a URL space is %%20, not %20). The app repairs lone %20, but write it right.
- "OPEN <browser> AND SEARCH X": the user wants to SEE the search in the browser, so do NOT just answer from the "web" tool. Run ONE command that opens the results page in that browser with the exact words: Chrome → start chrome "https://www.google.com/search?q=elon+musk+net+worth"; Edge → start msedge "https://www.bing.com/search?q=..."; Firefox → start firefox "https://www.google.com/search?q=..."; no browser named → start "" "https://www.google.com/search?q=...". Join the words with +. Opening the browser without the search is a failure. You may add a short answer in "say" afterwards, but the browser must show the search.
- Spotify: to search, start "" "spotify:search:<words joined with %%20>" (e.g. song "my dear" by Element → spotify:search:my%%20dear%%20element). To play something specific, search first and tell the user to press play; you cannot click inside apps.
- If you are NOT sure of an app's command-line or URI syntax (Spotify, WhatsApp, Discord, Steam, Teams…), look it up first with "web" search, then build the command from what you found. Never guess syntax.
- Earlier messages in this chat are context: "it", "that folder", "again" refer to them.
- In the FINAL "say", wrap 1-3 key words in **double asterisks** ONLY when the answer carries real information (a name, number, result the user asked for). Never for plain confirmations like "opened it".
- Keep "say" short. Set done=true once the task is finished (or impossible). Never repeat a step that already succeeded.`;
const SCRIPT = `
You are in SCRIPT WRITER mode: your job is writing clean, complete, working scripts and code.
- Unless the user gives a path, save scripts in %USERPROFILE%\\scripts\\ with a clear file name.
- One file per reply; after writing, run or syntax-check it when that is safe, and fix errors you see.
- Briefly tell the user how to run it in your final "say".`;

// Tone for "say"/"ask" only; commands, paths and code always stay exact.
const PERSONALITIES = {
  chill: 'Casual and friendly, like a chill friend who is good with computers. Use light slang now and then ("bro", "ngl", "fr", "lowkey", "no cap") and an occasional emoji (😎 👌 🔥 😅). Keep it short.',
  genz: 'Full Gen Z energy: slang like "bro", "fr fr", "ngl", "sheesh", "bet", "lowkey", "it\'s giving", "no cap", "geez", and emojis in most messages (💀 🔥 😭 ✨ 🫡). Still clear and helpful.',
  pro: 'Professional and concise. No slang, no emojis.',
};
const PREFS = { personality: 'chill', custom: '', emoji: true, learning: true, deep: false, maxSteps: 20 };
const getPrefs = async () => ({ ...PREFS, ...(await window.api.db('getSetting', 'prefs', {})) });

// Extra system-prompt blocks: personality, what we know about the user, commands that worked before.
async function promptExtras(task, P) {
  const tone = PERSONALITIES[P.personality] || PERSONALITIES.chill;
  const parts = [`PERSONALITY (applies to "say" and "ask" only): ${tone}${P.emoji ? '' : ' Never use emojis.'}${P.custom ? `\nUser's own instructions: ${P.custom}` : ''}`];
  const me = await window.api.db('listProfile');
  if (me.length) parts.push(`ABOUT THE USER (use it to personalize choices):\n${me.slice(-30).map((p) => `- ${p.kind}: ${p.text}`).join('\n')}`);
  const mem = await window.api.db('findMemory', task, 3);
  const safeMem = mem.filter((m) => !m.cmds.some(serious));
  if (safeMem.length) parts.push(`COMMANDS THAT WORKED BEFORE for similar tasks (reuse when they fit):\n${safeMem.map((m) => `- "${m.task}" → ${m.cmds.join(' && ')}`).join('\n')}`);
  return parts.join('\n\n');
}


const q = new URLSearchParams(location.search);
const mode = q.get('mode') || 'main';
if (q.get('nat')) document.documentElement.classList.add('native');
const id = Number(q.get('id'));
const isChild = q.get('child') === '1';           // opened by a manager window: works on its one job, can't open more agents
const webMode = q.get('web') === '1';             // /browser agent: works on the internet
const teamGroup = q.get('group'), teamIdx = Number(q.get('idx') || 0);
const canDelegate = !isChild && (mode === 'main' || mode === 'agent' || mode === 'runner');
const $ = (s) => document.getElementById(s);

$('w-close').onclick = () => window.api.win('close');
$('w-min').onclick = () => window.api.win('min');
$('w-max').onclick = () => window.api.win('max');
document.querySelector('.logo').src = logoUrl;
window.api.config().then(({ model, hasKey, path }) => {
  $('model').textContent = hasKey ? '' : '⚠ add an API key in Settings → keys'; // the model name lives in Settings only
});
// Quiet dot-grid behind everything (not in the little runner popup), and a calm offline badge.
let dotsOff = null;
const syncDots = () => {
  if (mode === 'runner') return;
  if (ANIM.dots && !dotsOff) dotsOff = mountDots();
  else if (!ANIM.dots && dotsOff) { dotsOff(); dotsOff = null; }
};
syncDots();
addEventListener('anim-change', syncDots);
{
  const net = document.createElement('span');
  net.id = 'net';
  net.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2 8.8a15 15 0 0 1 4-2.6M22 8.8a15 15 0 0 0-8.6-4.3M5 12.9a10 10 0 0 1 3-1.8M19 12.9a10 10 0 0 0-2.4-1.6M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M2 2l20 20"/></svg>offline';
  $('st').after(net);
  const sync = () => document.body.classList.toggle('offline', !navigator.onLine);
  addEventListener('online', sync); addEventListener('offline', sync); sync();
}

// Theme is per window. The main window saves its choice for next time (localStorage); every other window starts with the
// main window's theme and then keeps its own (sessionStorage is private to one window), so switching one never touches the rest.
const sysDark = matchMedia('(prefers-color-scheme: dark)');
const store = mode === 'main' ? localStorage : sessionStorage;
const readTheme = () => { try { return store.getItem('theme') || (mode === 'main' ? null : localStorage.getItem('theme')); } catch { return null; } };
function applyTheme() {
  document.documentElement.dataset.theme = readTheme() || (sysDark.matches ? 'dark' : 'light');
}
$('theme').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { store.setItem('theme', next); } catch {}
  applyTheme();
};
sysDark.addEventListener('change', applyTheme);
applyTheme();

// macOS-style centered title: "genisys — agent-3 — 520x330". The name is editable (click it).
let winName = mode === 'main' ? 'main' : (q.get('title') || mode).replace('~/', '');
const setTitle = () => {
  $('wtitle').textContent = `genisys — ${winName} — ${innerWidth}x${innerHeight}`;
  $('host').textContent = `${winName}@local`;
  if (mode !== 'main') document.title = winName;
};
addEventListener('resize', setTitle);

document.body.classList.add(mode === 'main' ? 'main' : 'agent', `m-${mode}`);
initTabs(mode === 'main');
if (mode === 'main') {
  launcher();
  window.api.db('getSetting', 'mainName', 'main').then((n) => { winName = n; setTitle(); });
}
window.api.onRenamed?.((n) => { winName = n; setTitle(); });
const cleanName = (s) => s.replace(/[^\w .-]/g, '').trim().replace(/\s+/g, '-').slice(0, 24);
function setName(n) {
  n = cleanName(n);
  if (!n) return setTitle();
  winName = n;
  setTitle();
  if (mode === 'main') window.api.db('setSetting', 'mainName', n);
  else window.api.rename(id, n);
}
// Click the name in the header to rename this window; Enter saves, Esc cancels.
$('host').onclick = () => {
  const h = $('host');
  if (h.isContentEditable) return;
  h.contentEditable = 'true';
  h.textContent = winName;
  getSelection().selectAllChildren(h);
  h.focus();
  const done = (save) => { h.contentEditable = 'false'; h.onkeydown = h.onblur = null; save ? setName(h.textContent) : setTitle(); };
  h.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
  h.onblur = () => done(true);
};
agent(); // the main window is an agent too
setTitle();
// Tell main the first layout is done (two animation frames), so it can show the window without flashing a half-built page.
requestAnimationFrame(() => requestAnimationFrame(() => window.api.pageReady?.()));

// Window-local keys; the Ctrl+Alt ones are registered system-wide in main.js.
// Many laptops send F1 as "mute" unless Fn is held, so Ctrl+/ and "?" (in an empty box) open help too.
const isField = (t) => t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
// Pasting outside a field pastes into the command box too.
document.addEventListener('paste', (e) => {
  if (isField(e.target) || panelOpen()) return;
  const t = e.clipboardData?.getData('text');
  if (t) { e.preventDefault(); const i = $('input'); i.focus(); i.setRangeText(t, i.selectionStart, i.selectionEnd, 'end'); i.dispatchEvent(new Event('input')); }
});
const toggleHelp = () => $('help').classList.toggle('show');
document.addEventListener('keydown', (e) => {
  const typing = e.target.isContentEditable || ((e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') && e.target.value);
  if (e.key === 'F1' || e.code === 'F1' || (e.ctrlKey && (e.key === '/' || e.code === 'Slash')) || (e.key === '?' && !typing)) { e.preventDefault(); toggleHelp(); }
  else if (e.ctrlKey && e.key === ',') { e.preventDefault(); mode === 'main' ? render('settings') : window.api.nav('settings'); }
  else if (e.key === 'Escape' && mode === 'runner') window.api.hideRunner();
  else if (e.key === 'Escape') {
    if ($('help').classList.contains('show')) $('help').classList.remove('show');
    else if (panelOpen()) render('close');
    else $('stop').click();
  } else if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); $('log').replaceChildren(); }
  // Just start typing: any printable key outside a field goes straight into the command box.
  else if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1 && !isField(e.target) && !panelOpen() && !$('help').classList.contains('show')) $('input').focus();
});
$('help-btn').onclick = toggleHelp;
$('help-ico').onclick = toggleHelp;
$('help').onclick = (e) => { if (e.target === $('help')) $('help').classList.remove('show'); };

// Status text → badge color.
const badgeClass = (s) => (/done|ready/.test(s) ? 'b-done' : /wait|answer/.test(s) ? 'b-wait' : /stop/.test(s) ? 'b-stop' : /error/.test(s) ? 'b-err' : 'b-run');

function launcher() {
  $('add').onclick = () => window.api.open('agent');
  $('script').onclick = () => window.api.open('script');
  window.api.onAgents((list) => {
    const bar = $('agents');
    bar.replaceChildren();
    for (const a of list) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.title = 'Bring to front';
      chip.innerHTML = `<span class="kind">${a.kind === 'script' ? '✎' : '›_'}</span><span class="name"></span><span class="badge"></span><button title="Close">✕</button>`;
      const nm = chip.querySelector('.name');
      nm.textContent = a.title.replace('~/', '');
      nm.title = 'Double-click to rename';
      nm.ondblclick = (e) => {
        e.stopPropagation();
        const inp = Object.assign(document.createElement('input'), { className: 'field', value: nm.textContent });
        inp.style.width = '120px';
        inp.onclick = (ev) => ev.stopPropagation();
        inp.onkeydown = (ev) => { if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { inp.value = nm.textContent; inp.blur(); } };
        inp.onblur = () => { const n = cleanName(inp.value); if (n && n !== nm.textContent) window.api.rename(a.id, n); inp.replaceWith(nm); };
        nm.replaceWith(inp);
        inp.focus();
        inp.select();
      };
      const b = chip.querySelector('.badge');
      b.textContent = a.st.replace(/ ·.*/, '');
      b.classList.add(badgeClass(a.st));
      chip.onclick = () => window.api.focus(a.id);
      chip.querySelector('button').onclick = (e) => { e.stopPropagation(); window.api.closeAgent(a.id); };
      bar.append(chip);
    }
  });
}

function agent() {
  const title = q.get('title') || '~/main';
  if (mode !== 'main') document.title = title;
  $('title').textContent = mode === 'script' ? 'script-writer' : mode === 'main' ? 'agent' : 'agent';
  $('host').textContent = `${title.replace('~/', '')}@local`;
  $('ps').textContent = mode === 'script' ? 'script⟹' : 'genisys⟹';
  const log = $('log');
  const input = $('input');
  let ed = null;
  if (mode === 'script') {
    const scriptsDir = '%USERPROFILE%\\scripts\\';
    const RUN = { py: (p) => `python "${p}"`, js: (p) => `node "${p}"`, mjs: (p) => `node "${p}"`, ps1: (p) => `powershell -NoProfile -ExecutionPolicy Bypass -File "${p}"`, bat: (p) => `call "${p}"`, cmd: (p) => `call "${p}"` };
    ed = createEditor({
      onSave: async (p, text) => { try { await window.api.write(p, text, true); print('dim', `saved ${p}`, 'save'); } catch (e) { print('err', e.message, 'save'); } },
      onRun: async (p) => {
        const ext = p.split('.').pop().toLowerCase();
        if (!RUN[ext]) { const err = await window.api.openPath(p); if (err) print('err', err, 'open'); return; }
        await ed.save();
        print('cmd', RUN[ext](p), 'run');
        await window.api.run(`start "" cmd /k ${RUN[ext](p)}`);
      },
      onNew: () => { // inline name box in the tab bar
        const name = document.createElement('input');
        name.className = 'ed-name'; name.placeholder = 'file name, e.g. tool.py'; name.spellcheck = false;
        ed.el.querySelector('.ed-tablist').append(name); name.focus();
        const done = async (ok) => {
          const n = name.value.trim().replace(/[\\/:*?"<>|]/g, '');
          name.remove();
          if (ok && n) { const r = await window.api.write(`${scriptsDir}${n}`, '', true); ed.open(r.full, ''); }
          else ed.focus();
        };
        name.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); };
        name.onblur = () => done(false);
      },
    });
    document.body.classList.add('has-ed');
    $('log').before(ed.el);
    ed.el.addEventListener('toggle-output', () => document.body.classList.toggle('log-hidden'));
    document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.key.toLowerCase() === 'j') { e.preventDefault(); document.body.classList.toggle('log-hidden'); } });
  }
  input.placeholder = mode === 'script' ? 'describe the script to write…' : 'tell me what to do…';
  const TEAM = `
AGENT WINDOWS (teamwork): the app can open extra agent windows that work in parallel while you manage them. When the user asks for several agents or parallel work ("open 5 agents to...", "use 3 agents", "split this between agents") or gives a big job with clearly independent parts, reply with "delegate": [{"task": "<complete, self-contained instructions for ONE agent>", "web": true|false}, ...] and set done=true with no cmd. Use exactly N items when the user said N (max 8), otherwise 2-5. Agents cannot see this chat, so every task must carry all the details it needs (names, paths, goal, what to report back) and the parts must not overlap (different files, sites, topics). Set "web": true for jobs that mostly browse the internet. "say" is one short line naming what each agent does.
If the work is small or can't be split (one quick action, one lookup, one file), DO NOT delegate: say "I'm gonna do it myself, it's kinda simple tho" (in your current tone) and do it yourself with the usual actions.`;
  const BROWSER = `
BROWSER AGENT: you were opened with /browser, so you work on the INTERNET. Use "web" search/read for facts, prices, docs and news, and open sites for the user with start "" "<url>". Prefer web actions over local commands, finish with a short answer.`;
  const CHILD = `
TEAM MEMBER: you are one of several agents working in parallel for a manager. Do ONLY the job you were given, don't ask the user questions unless you are truly blocked, and finish with ONE short result line in "say" (what you found or made, with the key facts) so the manager can report it.`;
  const prompt = (mode === 'script' ? SYSTEM + SCRIPT : SYSTEM) + (canDelegate ? TEAM : '') + (webMode ? BROWSER : '') + (isChild ? CHILD : '');
  const history = [{ role: 'system', content: prompt }];
  let running = false;
  let abort = null; // rejects the in-flight AI wait when the user presses stop
  const setRun = (v) => { running = v; $('form').classList.toggle('busy', v); $('send').title = v ? 'Stop' : 'Send (Enter)'; };
  let stopped = false;

  const setSt = (s) => {
    $('st').textContent = s;
    $('st').className = `badge ${badgeClass(s)}`;
    if (id) window.api.status(id, s);
  };
  // One log row: muted label column + content (e.g. "step 01 | dir /b").
  // Live activity card: a collapsible task header + an animated step tree (plan steps are folders, actions are their children).
  const live = (() => {
    let el = null, root = null, tEl = null, t0 = 0, timer = 0, cur = null, groups = [], curGroup = null;
    const fmt = (ms) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
    const code = (t) => { const c = document.createElement('code'); c.textContent = t; return c; };
    const finish = (leaf, ok = true) => {
      if (!leaf) return;
      const li = leaf.li; li.classList.remove('on'); li.classList.add(ok ? 'ok' : 'bad');
      leaf.state = ok ? 'done' : 'bad'; leaf.ms = Date.now() - leaf.t0; li.querySelector('.ms').textContent = fmt(leaf.ms);
    };
    const kidsOf = () => (curGroup ? curGroup.ul : root);
    const open = (g, v) => { g.li.classList.toggle('open', v); };
    return {
      el: () => el,
      slot: () => el?.querySelector('.lorb'),
      start(task = '') {
        this.stop(); groups = []; curGroup = null;
        el = document.createElement('div');
        el.className = 'live';
        el.dataset.phase = 'working';
        el.innerHTML = `<div class="lhead"><span class="lorb orb-slot"></span><button type="button" class="ltask" title="Show / hide the steps"><i class="chev"></i><span class="lt"></span></button><span class="ltime">0.0s</span><button type="button" class="lstop" title="Stop (Esc)"><i></i>stop</button></div>
          <div class="lphase"><em>working</em><span class="dots"><i></i><i></i><i></i></span></div>
          <div class="lbody"><ul class="tree"></ul></div><div class="shimmer"></div>`;
        el.querySelector('.lt').textContent = task;
        el.querySelector('.ltask').onclick = () => el.classList.toggle('collapsed');
        el.querySelector('.lstop').onclick = () => $('stop').click();
        root = el.querySelector('.tree'); tEl = el.querySelector('.ltime'); t0 = Date.now();
        timer = setInterval(() => {
          tEl.textContent = fmt(Date.now() - t0);
          if (cur) cur.li.querySelector('.ms').textContent = fmt(Date.now() - cur.t0);
        }, 200);
        log.append(el); log.scrollTop = log.scrollHeight;
      },
      // Plan steps become folders; later actions nest under the step being worked on.
      plan(items) {
        if (!el) return;
        groups = items.map((text) => {
          const li = document.createElement('li');
          li.className = 'grp todo';
          li.innerHTML = '<div class="grow"><i class="ind"></i><span class="gt"></span><span class="gn"></span><i class="chev"></i></div><div class="kids"><ul></ul></div>';
          li.querySelector('.gt').textContent = text;
          const g = { text, state: 'todo', kids: [], li, ul: li.querySelector('ul') };
          li.querySelector('.grow').onclick = () => open(g, !li.classList.contains('open'));
          root.append(li);
          return g;
        });
      },
      focus(n) {
        if (!groups.length) return;
        const idx = Number.isFinite(n) ? Math.max(1, Math.min(groups.length, n)) : groups.length + 1;
        groups.forEach((g, i) => {
          g.state = i + 1 < idx ? 'done' : i + 1 === idx ? 'now' : 'todo';
          g.li.classList.toggle('ok', g.state === 'done'); g.li.classList.toggle('on', g.state === 'now'); g.li.classList.toggle('todo', g.state === 'todo');
          open(g, g.state === 'now');
        });
        curGroup = groups[idx - 1] || null;
      },
      // Mark the current line done and start a new animated one.
      step(label, detail = '') {
        if (!el) return;
        const phase = /^thinking/.test(label) ? 'thinking' : 'working';
        el.dataset.phase = phase;
        el.querySelector('.lphase em').textContent = phase;
        finish(cur);
        const li = document.createElement('li');
        li.className = 'leaf on';
        li.innerHTML = '<i class="ind"></i><span class="lt2"><b></b> <span class="det"></span></span><span class="ms"></span>';
        li.querySelector('b').textContent = label;
        const d = String(detail).split('\n')[0].slice(0, 90);
        if (d) li.querySelector('.det').append(code(d));
        cur = { li, t0: Date.now(), state: 'now', text: `${label}${d ? ` ${d}` : ''}` };
        const host = kidsOf();
        host.append(li);
        if (curGroup) { curGroup.kids.push(cur); curGroup.li.querySelector('.gn').textContent = curGroup.kids.length; }
        else while (host.children.length > 6) host.firstChild.remove();
        log.scrollTop = log.scrollHeight;
      },
      detail(t) { const d = cur?.li.querySelector('.det'); if (d) d.replaceChildren(code(t)); },
      fail() { finish(cur, false); cur = null; },
      // For the floating plan widget: plan steps with their actions.
      snapshot(upTo, end) {
        const rows = groups.map((g, i) => ({
          text: g.text, state: i + 1 < upTo ? 'done' : i + 1 === upTo ? (end ? 'todo' : 'now') : 'todo',
          kids: g.kids.map((k) => ({ text: k.text, state: k.state === 'now' ? (end ? 'todo' : 'now') : k.state === 'bad' ? 'bad' : 'done' })),
        }));
        return rows;
      },
      hasPlan: () => groups.length > 0,
      stop(ok = true) {
        clearInterval(timer);
        if (el) { finish(cur, ok); cur = null; el.remove(); el = null; }
      },
    };
  })();
  window.api.onAiProgress?.((t) => live.detail(t));

  // The live orb: big on the welcome screen, then it shrinks into the "working" card while a task runs, then into the header.
  const orbOK = (mode === 'main' || mode === 'agent') && ANIM.orb;
  let orbEl = null;
  const orbTo = (slot) => {
    if (!orbOK || !slot) return;
    if (!orbEl) {
      orbEl = document.createElement('div'); orbEl.className = 'orb';
      orbEl.innerHTML = '<canvas></canvas>';
      import('./orb.js').then((m) => { if (orbEl) orbEl._orb = m.createLiveOrb(orbEl.firstChild); }).catch(() => {});
    }
    if (orbEl.parentElement === slot) return;
    const first = orbEl.isConnected ? orbEl.getBoundingClientRect() : null;
    slot.append(orbEl);
    if (first && first.width) { // FLIP: glide from the old spot and size to the new one
      const last = orbEl.getBoundingClientRect();
      const s = first.width / Math.max(1, last.width);
      orbEl.animate([{ transformOrigin: 'top left', transform: `translate(${first.left - last.left}px, ${first.top - last.top}px) scale(${s})` }, { transformOrigin: 'top left', transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  };
  let welcome = null;
  const orbToLive = () => {
    if (welcome) { const w = welcome; welcome = null; w.classList.add('gone'); setTimeout(() => w.remove(), 600); }
    orbTo(live.slot());
  };
  const orbIdle = () => { if (!welcome?.isConnected) orbTo($('orb-head')); };
  const showWelcome = () => {
    if (!orbOK) return;
    welcome = document.createElement('div');
    welcome.className = 'welcome';
    welcome.innerHTML = `<div class="orb-slot big"></div><b class="w-name">Genisys</b><span class="w-sub">Tell me what to do on your PC.</span>`;
    log.append(welcome);
    orbTo(welcome.querySelector('.orb-slot'));
  };
  showWelcome();
  // "New chat": forget this conversation (the AI's memory of it too) and start from the welcome screen.
  $('newchat').onclick = () => {
    if (running) { $('newchat').classList.add('shake'); setTimeout(() => $('newchat').classList.remove('shake'), 400); return; }
    history.length = 1;
    log.replaceChildren();
    if (!orbOK) print('dim', 'New chat. Tell me what to do on your PC.', '');
    showWelcome();
    setSt('ready');
    input.value = ''; input.dispatchEvent(new Event('input'));
    input.focus();
  };
  // TextGenerateEffect (port of the shadcn/ui component): each word fades in from a blur, one after another
  // (default there: stagger 0.2s, duration 0.5s, blur 10px). It plays once, only on "special" answers, then the words
  // are turned back into plain text. **word** / `word` are bold; when the effect plays they also get an underline.
  let revealNext = false; // set by the loop: only a final, noteworthy answer plays the effect
  const focusReveal = (el, text, plain = false) => {
    const raw = String(text);
    const play = !plain && !matchMedia('(prefers-reduced-motion: reduce)').matches && raw.length <= 500;
    const words = [];
    let last = null; // whitespace is kept inside the word before it, so no space is ever lost between animated words
    for (const part of raw.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean)) {
      const kw = /^(\*\*|`)/.test(part);
      const clean = kw ? part.replace(/^(\*\*|`)|(\*\*|`)$/g, '') : part;
      for (const w of clean.split(/(\s+)/)) {
        if (!w) continue;
        if (/^\s+$/.test(w)) { if (last) last.textContent += w; else el.append(w); continue; }
        const sp = document.createElement(kw ? 'b' : 'span');
        if (kw) sp.className = 'kw';
        sp.textContent = w;
        el.append(sp); words.push(sp); last = sp;
      }
    }
    if (!play || words.length < 2) return;
    const per = Math.min(0.2, 2.4 / words.length); // keeps long answers under ~2.5s
    words.forEach((w, i) => { w.classList.add('tg'); w.style.animationDelay = `${(i * per).toFixed(2)}s`; });
    setTimeout(() => words.forEach((w) => { // done: back to normal text, key words get their underline
      w.classList.remove('tg'); w.style.animationDelay = '';
      if (w.classList.contains('kw') && ANIM.underline) w.classList.add('ul');
    }), (words.length * per + 0.6) * 1000);
  };
  // Team manager: opens one agent window per job and keeps a live card of who is working / done. When everyone has
  // reported back it says so (no extra AI request).
  const teams = new Map();
  const startTeam = (jobs) => {
    const group = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const card = document.createElement('div');
    card.className = 'team';
    card.innerHTML = '<div class="tm-h"><b>Team</b><span class="tm-c"></span><div class="tm-bar"><i></i></div></div><ul></ul>';
    const rows = jobs.map((j, i) => {
      const li = document.createElement('li');
      li.innerHTML = '<i class="ind"></i><div><b></b><span class="tm-t"></span><span class="tm-r"></span></div>';
      li.querySelector('b').textContent = `${j.web ? 'Browser agent' : 'Agent'} ${i + 1}`;
      li.querySelector('.tm-t').textContent = j.task.replace(/\s+/g, ' ');
      card.querySelector('ul').append(li);
      return li;
    });
    teams.set(group, { card, rows, total: jobs.length, done: 0, ok: 0, results: [] });
    const count = card.querySelector('.tm-c');
    count.textContent = `0/${jobs.length} done`;
    log.append(card);
    log.scrollTop = log.scrollHeight;
    window.api.openMany(jobs.map((j, idx) => ({ kind: 'agent', task: j.task, opts: { child: true, web: j.web, group, idx } })));
  };
  window.api.onAgentDone((info) => {
    const t = teams.get(info?.group);
    const li = t?.rows[info.idx];
    if (!li || li.className) return; // unknown team, or this agent already reported
    li.className = info.ok ? 'ok' : 'bad';
    li.querySelector('.tm-r').textContent = info.summary || (info.stopped ? 'stopped' : info.ok ? 'done' : "couldn't finish");
    t.done++; if (info.ok) t.ok++;
    t.card.querySelector('.tm-c').textContent = `${t.done}/${t.total} done`;
    t.card.querySelector('.tm-bar i').style.width = `${(t.done / t.total) * 100}%`;
    if (t.done === t.total) {
      const line = t.ok === t.total ? `all ${t.total} agents finished ✅` : `${t.ok} of ${t.total} agents finished, the rest hit a wall 😬`;
      print('ai', line, '›');
      window.api.notify(t.ok === t.total ? 'done' : 'failed', line);
      teams.delete(info.group);
    }
  });
  // Plain-language problem cards: no error codes or stack text ever reach the user.
  const PROB = {
    offline: ['You are offline', "Genisys can't reach the internet right now. Check your Wi-Fi or cable. Things you've done before still work without it.", '<path d="M2 8.8a15 15 0 0 1 4-2.6M22 8.8a15 15 0 0 0-8.6-4.3M5 12.9a10 10 0 0 1 3-1.8M19 12.9a10 10 0 0 0-2.4-1.6M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M2 2l20 20"/>'],
    busy: ['The free AI is busy', 'Every free model is at its limit for the moment. Try again in a minute, or add another key in Settings.', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],
    nokey: ['No API key yet', 'Add a free OpenRouter key in Settings, under Keys, and you are ready to go.', '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>'],
    other: ['That did not work', 'Something got in the way. Try again, and if it keeps happening, say the task a different way.', '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/>'],
  };
  const kindOf = (msg) => !navigator.onLine || /fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|getaddrinfo|network|socket hang up|ERR_INTERNET|Failed to fetch/i.test(msg) ? 'offline'
    : /No API key/i.test(msg) ? 'nokey' : /daily limit|rate.?limit|429|busy|quota|exhausted/i.test(msg) ? 'busy' : 'other';
  const problem = (msg, retryTask) => {
    const k = kindOf(String(msg)), [t, d, ico] = PROB[k];
    const c = document.createElement('div');
    c.className = `prob ${k}`;
    c.innerHTML = `<span class="pi"><svg viewBox="0 0 24 24">${ico}</svg></span><div class="pt"><b></b><span></span></div>`;
    c.querySelector('b').textContent = t;
    c.querySelector('.pt span').textContent = d;
    if (retryTask) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn'; b.textContent = 'Try again';
      b.onclick = () => { if (running) return; c.remove(); input.value = retryTask; $('form').requestSubmit(); };
      c.append(b);
    }
    log.append(c);
    log.scrollTop = log.scrollHeight;
    return k;
  };
  const print = (cls, text, label = '') => {
    const d = document.createElement('div');
    d.className = `row ${cls}`;
    d.innerHTML = '<span class="lbl"></span><span class="txt"></span>';
    d.firstChild.textContent = label;
    if (cls === 'ai' && revealNext) focusReveal(d.lastChild, text); else if (cls === 'ai') focusReveal(d.lastChild, text, true); else d.lastChild.textContent = text;
    if (cls === 'ai') revealNext = false;
    log.append(d);
    log.scrollTop = log.scrollHeight;
    return d;
  };
  if (mode !== 'runner' && !orbOK) print('dim', mode === 'script' ? 'Describe a script; I will write, save and test it.  F1 for shortcuts.' : 'Tell me what to do on your PC.  F1 for shortcuts.', '');

  // Inline Run/Skip prompt so this agent waits without blocking any other window.
  const ask = (msg) => new Promise((resolve) => {
    const d = print('warn', msg, 'confirm');
    setSt('waiting for you');
    const br = document.createElement('div');
    for (const [label, val] of [['run', true], ['skip', false]]) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = label;
      b.onclick = () => { br.remove(); print('dim', label === 'run' ? 'approved' : 'skipped', ''); resolve(val); };
      br.append(b);
    }
    d.lastChild.append(br);
  });

  async function writeFile({ path, content }) {
    let r = await window.api.write(path, content, false);
    if (r.exists) {
      if (!(await ask(`Overwrite existing file?\n${r.full}`))) return `User refused to overwrite ${r.full}.`;
      r = await window.api.write(path, content, true);
    }
    print('file', `${r.full}  +${content.split('\n').length}`, 'write');
    if (ed) { ed.open(r.full, content); document.body.classList.remove('log-hidden'); }
    return `Wrote file ${r.full}.`;
  }

  // Internet step: spinning globe while it searches/reads, then a short summary row.
  async function browse(web) {
    const kind = web.search ? 'search' : 'read';
    const q = String(web.search || web.read || '');
    const d = print('web', q, kind);
    const g = document.createElement('div');
    g.className = 'globe-host';
    d.lastChild.prepend(g);
    let stop = () => {};
    (ANIM.globe ? mountGlobe(g, mode === 'agent' ? 96 : 120) : Promise.reject(new Error('off'))).then((fn) => { stop = fn; if (!g.isConnected) fn(); }).catch(() => { // cobe missing: old ASCII globe
      const pre = document.createElement('pre'); pre.className = 'globe'; g.append(pre); stop = spin(pre, mode === 'agent' ? 26 : 34, mode === 'agent' ? 11 : 15);
    });
    setSt('browsing');
    try {
      const r = await window.api.web(kind, q);
      if (kind === 'search') {
        const res = r.results || [];
        print('out', res.length ? `${res.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}`).join('\n')}${r.pages?.length ? `\n(read ${r.pages.length} page${r.pages.length > 1 ? 's' : ''} for you)` : ''}` : 'no results', 'found');
        return `Web search "${q}":\n${res.map((x, i) => `${i + 1}. ${x.title} — ${x.url}\n   ${x.snippet}`).join('\n') || 'no results'}${(r.pages || []).map((p) => `\n\nPAGE ${p.url} "${p.title}":\n${p.text}`).join('')}\n\n(The top pages are already included above: answer now if you can.)`;
      }
      print('out', `${r.title || r.url} · ${r.text.length} chars`, 'read');
      return `Page ${r.url} (HTTP ${r.status}) "${r.title}":\n${r.text}`;
    } catch (e) {
      const wm = e.message.replace(/^Error invoking remote method 'web': (Error: )?/, '');
      if (kindOf(wm) === 'offline') problem(wm); else print('err', "Couldn't load that page.", 'web');
      return `Web ${kind} failed: ${e.message}`;
    } finally {
      stop();
      g.remove(); // keep the log compact once done
    }
  }

  // Model down / offline: offer the best remembered command for this task.
  async function fromMemory(task) {
    const [m] = await window.api.db('findMemory', task, 1);
    if (!m) { print('dim', 'offline and nothing similar in memory yet', 'memory'); return false; }
    if (m.cmds.some(serious)) { print('dim', 'a similar task used a serious command, so it is not replayed from memory', 'memory'); return false; }
    print('mem', `"${m.task}" worked before (${m.uses}×):\n${m.cmds.join('\n')}`, 'memory');
    if (!(await ask('Run the remembered command?'))) return false;
    let worked = true;
    for (const c of m.cmds) {
      if (isRisky(c) && !(await ask(`Risky command:\n${c}`))) { worked = false; break; }
      setSt('running');
      const { code, out } = await window.api.run(c);
      if (out.trim()) print('out', out.trim(), 'out');
      if (code) { print('err', `exit ${code}`, ''); worked = false; break; }
    }
    await window.api.db('useMemory', m.id, worked);
    if (!worked) window.api.notify('problem', `A remembered command for "${m.task}" failed. Edit or delete it in Memory.`);
    return worked;
  }

  // Exact repeat of a saved task: rerun its saved commands, 0 AI requests. Falls through to the AI on failure.
  async function reuseSaved(task) {
    const m = await window.api.db('findExact', task);
    if (!m) return false;
    if (m.cmds.some(serious)) return false; // serious commands always go through the AI
    if (m.cmds.some((c) => fixCmd(c) !== c)) { await window.api.db('updateMemory', m.id, m.cmds.map(fixCmd)); m.cmds = m.cmds.map(fixCmd); } // repair old saved commands
    live.start(task); live.step('reusing saved .bat', m.task);
    const row = print('mem', 'reused saved .bat · 0 AI requests', '⚡ memory');
    const again = document.createElement('button');
    again.className = 'btn'; again.textContent = 'ask AI instead';
    again.onclick = () => { if (!running) loop(`! ${task}`); };
    row.lastChild.append(' ', again);
    for (const c of m.cmds) {
      if (isRisky(c) && !(await ask(`Risky command:\n${c}`))) { live.stop(false); await window.api.db('useMemory', m.id, false); return false; }
    }
    setSt('running');
    const { code, out } = await window.api.runBat(m.id);
    if (out.trim()) print('out', out.trim(), 'out');
    if (code) { live.stop(false); print('err', `exit ${code}, asking AI instead`, ''); await window.api.db('useMemory', m.id, false); return false; }
    await window.api.db('useMemory', m.id, true);
    live.stop();
    print('done', 'done from memory', 'done');
    return true;
  }

  // ---- Stages 2-9: the fast flow, used only when Settings > Speed mode is on. Order: cache -> code parser -> AI router -> AI script.
  // Returns { handled, calls, ms }. handled=false means "carry on with the old loop" (nothing was run).
  let fastCtx = null;
  const getFastCtx = async () => (fastCtx ||= await window.api.fastSpecs().then((r) => ({ ...r, reg: new Map(r.specs.map((x) => [x.name, x])) })));
  const OPENERS = new Set(['open_app', 'open_url', 'search_web', 'open_folder', 'open_file', 'open_path']);
  const CHAT = /^(what|why|how|who|when|where|which|tell|explain|write|summari[sz]e|translate|hi|hello|hey|thanks?)\b|\?\s*$/i;
  const describe = (a, p) => ({
    open_app: `open ${p.name}`, open_url: `open ${p.url}${p.browser ? ` in ${p.browser}` : ''}`,
    search_web: `search "${p.query}"${p.browser ? ` in ${p.browser}` : ''}${p.site ? ` on ${p.site}` : ''}`,
    open_folder: `open folder ${p.folder || p.name}`, open_file: `find and open "${p.query}"`, open_path: `open ${p.path}`,
  }[a] || `${a} ${JSON.stringify(p)}`);

  async function fastFlow(task) {
    const F0 = performance.now(), S = {}, st = { calls: 0 };
    const mark = (k, t) => { S[k] = Math.round((S[k] || 0) + performance.now() - t); };
    const done = (handled) => ({ handled, calls: st.calls, ms: Math.round(performance.now() - F0) });
    let sp;
    try { sp = await getFastCtx(); } catch { return done(false); }
    window.api.timing('start');
    const record = (route, action, ok, extra = {}, ms = performance.now() - F0) => window.api.timing('log', { text: task, mode: 'new', route, action, ok, modelCalls: st.calls, steps: 1, totalMs: Math.round(ms), stages: S, ...extra }).catch(() => {});
    const finish = async (route, action, ok, extra = {}, ms = performance.now() - F0) => {
      if (ok) print('done', `${(ms / 1000).toFixed(2)}s · ${route}`, 'done');
      await window.api.db('logTask', title, task, 1, ms / 1000, ok);
      await record(route, action, ok, extra, ms);
      setSt(ok ? 'done' : 'error'); setRun(false);
      if (ok && mode === 'runner' && OPENERS.has(action)) setTimeout(() => window.api.hideRunner(), 250); // runner bar hides after window-opening commands
    };
    const store = async (a, p) => { try { await cacheStore(window.api.db, task, a, p, sp.reg); } catch {} };
    // Run one action; destructive ones are confirmed first, showing exactly what will happen.
    const exec = async (action, params) => {
      let t = performance.now();
      let r = await window.api.fast(action, params);
      mark('exec', t);
      if (r.status === 'confirm') {
        if (!(await ask(r.preview))) return { status: 'refused' };
        t = performance.now();
        r = await window.api.fast(action, params, true);
        mark('exec', t);
      }
      return r;
    };
    // true = this route finished the command (ran it, asked, or the user said no); false = try the next route.
    const handle = async (route, action, params) => {
      print('cmd', describe(action, params), route);
      const r = await exec(action, params);
      if (r.status === 'done') {
        print('out', r.message, route);
        if (route !== 'cache') await store(r.resolved?.action || action, r.resolved?.params || params);
        await finish(route, action, true);
        return true;
      }
      if (r.status === 'choose') { // a few close matches: clickable choices, never a guess
        const before = performance.now() - F0;
        const d = print('ask', r.message, 'ask');
        const br = document.createElement('div');
        for (const o of r.options) {
          const b = document.createElement('button');
          b.className = 'btn'; b.textContent = o.label; b.title = o.detail;
          b.onclick = async () => {
            if (running) return;
            br.remove(); setRun(true); setSt('running');
            const t = performance.now();
            const rr = await exec(o.action, o.params);
            if (rr.status === 'done') { print('out', rr.message, 'out'); await store(o.action, o.params); await finish('fast', action, true, { result: 'chosen' }, before + performance.now() - t); }
            else { print('err', rr.reason || 'could not open it', ''); await finish('fast', action, false, { result: 'choice failed' }, before + performance.now() - t); }
          };
          br.append(b);
        }
        d.lastChild.append(br);
        setSt('waiting for your answer'); setRun(false);
        return true;
      }
      if (r.status === 'refused') { print('dim', 'skipped', ''); await finish(route, action, false, { result: 'refused' }); return true; }
      print('dim', `fast path: ${r.reason || 'no match'}`, '');
      return false;
    };

    // 1. cache: a command that worked before (the saved target is re-checked first)
    let t = performance.now();
    const hit = await cacheLookup(window.api.db, window.api.fastValid, task);
    mark('cache', t);
    if (hit) {
      if (await handle('cache', hit.action, hit.params)) return done(true);
      await window.api.db('cacheDrop', cacheKey(task));
    }
    // 2. fast path: the code understands it, zero model calls
    t = performance.now();
    const it = parseIntent(task);
    mark('parse', t);
    if (it.action !== 'unknown' && it.confidence >= FAST_MIN) return done(await handle('fast', it.action, it.params));
    if (CHAT.test(task.trim())) return done(false); // questions and chat go straight to the full AI

    // 3. AI router: ONE short JSON call (max 2 with the retry), everything it says is validated in code
    const msgs = buildRouterMessages(sp.lines, task, sp.folders);
    let routed = null, lastErr = '', lastRaw = '';
    for (let attempt = 0; attempt < 2 && !routed; attempt++) {
      setSt('thinking');
      live.start(task); live.step('picking the right action', 'one short AI call');
      t = performance.now(); st.calls++;
      let raw;
      try { raw = await window.api.ai(attempt ? [...msgs, { role: 'assistant', content: lastRaw }, { role: 'user', content: `Invalid (${lastErr}). Reply with ONLY the JSON.` }] : msgs, false, { fast: true, maxTokens: 200, timeoutMs: 5000 }); }
      catch { mark('router', t); live.stop(false); return done(false); } // providers down: the old loop has its own retries and memory fallback
      mark('router', t);
      live.stop(true);
      const v = validateRouterReply(raw, sp.reg, { env: sp.env });
      if (v.ok) routed = v; else { lastErr = v.error; lastRaw = raw; }
    }
    if (!routed) {
      print('ask', "didn't catch that one. Say it a bit differently, or start with ! to use the full AI.", 'ask');
      await record('router', 'invalid', false, { asked: true, result: lastErr });
      setSt('waiting for your answer'); setRun(false);
      return done(true);
    }
    if (routed.action === 'unknown' || routed.action === 'old') return done(false);
    if (routed.action !== 'script') return done(await handle('router', routed.action, routed.params));

    // 4. AI script fallback: small exact context in, one PowerShell block out, safety-checked, always confirmed
    let smsgs = buildScriptMessages(task, await window.api.indexContext(task), await window.api.similarPrompt(task));
    while (st.calls < 2) {
      setSt('writing a script');
      t = performance.now(); st.calls++;
      let raw;
      try { raw = await window.api.ai(smsgs, false, { fast: true, maxTokens: 700, timeoutMs: 8000 }); } catch { mark('script', t); return done(false); }
      mark('script', t);
      const x = extractScript(raw);
      if (x.notFound) { print('ai', `can't do that one: ${x.notFound}`, '›'); await finish('script', 'script', false, { result: 'not_found' }); return done(true); }
      if (x.error) { smsgs = [...smsgs, { role: 'assistant', content: raw }, { role: 'user', content: `${x.error}. Output exactly one powershell code block.` }]; continue; }
      const chk = await window.api.scriptCheck(x.script);
      if (chk.level === 'block') { print('err', `blocked, not running it:\n- ${chk.reasons.join('\n- ')}`, 'safety'); await finish('script', 'script', false, { result: 'blocked', script: x.script }); return done(true); }
      print('cmd', x.script, 'script');
      if (!(await ask(`AI-written script${chk.reasons.length ? ` (${chk.reasons.join('; ')})` : ''}. Run it?`))) { print('dim', 'skipped', ''); await finish('script', 'script', false, { result: 'refused', script: x.script }); return done(true); }
      setSt('running');
      t = performance.now();
      const r = await window.api.scriptRun(x.script, true, task);
      mark('exec', t);
      if (r.status === 'done') { if (r.out.trim()) print('out', r.out.trim(), 'out'); await finish('script', 'script', true, { script: x.script }); return done(true); }
      if (r.status === 'blocked') { print('err', `blocked: ${r.check.reasons.join('; ')}`, 'safety'); await finish('script', 'script', false, { result: 'blocked', script: x.script }); return done(true); }
      if (st.calls < 2) { print('dim', 'script failed, trying once more…', ''); smsgs = [...smsgs, { role: 'assistant', content: raw }, { role: 'user', content: `The script failed:\n${String(r.out).slice(0, 500)}\nFix it. Same rules.` }]; continue; }
      print('err', String(r.out).trim().slice(0, 400) || 'the script failed', 'script');
      await finish('script', 'script', false, { result: 'failed', script: x.script });
      return done(true);
    }
    return done(false);
  }

  const INSIST = /^!\s*|\b(ask ai|use ai|fresh|redo|think again)\b/gi;

  async function loop(task, want = null) { // want = { n, web } from "/agent N task": this window's AI splits the work across N agents
    setRun(true); stopped = false;
    const speedMode = await window.api.db('getSetting', 'speedMode', 'old'); // 'old' (default) or 'new'
    const insist = /^!|\b(ask ai|use ai|fresh|redo|think again)\b/i.test(task);
    if (insist) task = task.replace(INSIST, '').replace(/\s+/g, ' ').trim() || task;
    else if (!want) { // saved .bat route (timed as route "saved")
      const r0 = performance.now(); window.api.timing('start');
      if (await reuseSaved(task)) { window.api.timing('log', { text: task, route: 'saved', mode: speedMode, ok: true, modelCalls: 0, steps: 1, totalMs: Math.round(performance.now() - r0), stages: {} }).catch(() => {}); setSt('done'); setRun(false); return; }
    }
    // Speed mode "new": cache / code parser / AI router / AI script first. Not handled -> the old loop below runs exactly as before.
    let fastInfo = null;
    if (speedMode === 'new' && !insist && !want && mode !== 'script' && !webMode) {
      fastInfo = await fastFlow(task);
      if (fastInfo.handled) return;
    }
    const t0 = Date.now();
    // Stage 1 timing: stage name -> ms. Written to timing.log (with main-side numbers) when the command ends.
    if (!fastInfo) window.api.timing('start'); // (after a fast-flow miss the router's numbers are still pending and join this row)
    const TM = {};
    const tadd = (k, ms) => { TM[k] = Math.round((TM[k] || 0) + ms); };
    const tm = async (k, p) => { const s = performance.now(); try { return await p; } finally { tadd(k, performance.now() - s); } };
    let modelCalls = fastInfo?.calls || 0;
    if (fastInfo) TM.fastTry = fastInfo.ms;
    const p0 = performance.now();
    const P = await getPrefs(); // re-read each task so Settings changes apply in every window
    live.start(task);
    orbToLive();
    live.step('understanding your request', task);
    const ran = []; // commands that ran, for command memory
    let webSteps = 0;
    let allOk = true;
    let lastSay = '';
    // Fresh folder snapshot + personality/profile/memory each task.
    const open = ed?.current();
    history[0].content = `${prompt}\n\n${await promptExtras(task, P)}\n\nPC CONTEXT:\n${await window.api.context()}${open ? `\n\nOPEN IN THE EDITOR (the user may have edited it; build on this version):\n${open.path}\n${open.text.slice(0, 12000)}` : ''}`;
    tadd('promptBuild', performance.now() - p0);
    history.push({ role: 'user', content: want ? `${task}\n\n[The user asked for ${want.n} agents${want.web ? ' that work on the web' : ''} for this. Split the work into exactly ${want.n} independent jobs with "delegate"${want.web ? ' (set web: true on each)' : ''}, unless it is too small to split: then say you'll do it yourself and do it.]` : task });
    // Fast mode for short commands; long/complex requests (and anything that fails) get deep reasoning.
    const needsThought = /\b(search|spotify|play|song|music|youtube|google|install|download|write|script|code|find|delete|remove|move|copy|rename|zip|schedule|email|send|settings|network|wifi|registry)\b/i;
    let think = P.deep || !!want || task.split(/\s+/).length > 8 || needsThought.test(task);
    let plan = null; // checklist box when the AI breaks the task into steps
    let asked = false;
    let failed = false;
    let offlineOk = false;
    let delegated = false;
    let aiFails = 0;
    let fails = 0; // failed attempts in this task: 3 → recipes + new strategy, 10 → other model + second opinion, 20 → give up
    const STRATS = ['use PowerShell instead of cmd (or the other way round)', 'use a different tool: "find", "app", "web" search, or open the exact settings page', 'break it into the smallest possible steps and verify each one with an output', 'search the web for the exact working command, then adapt it'];
    const limit = () => Math.max(P.maxSteps, fails >= 3 ? 26 : 0);
    const escalate = async (results) => {
      print('ai', "my bad bro 😅 I've flopped 10 times on this one and that's on me. Swapping to a different brain and asking for a second opinion, hold tight 🔧", '›');
      live.step('getting a second opinion', 'switching model');
      think = true;
      try { await window.api.switchModel(); } catch {}
      try {
        const transcript = history.slice(1).map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n').slice(-14000);
        const advice = await window.api.ai([
          { role: 'system', content: 'You are a senior Windows automation engineer coaching a junior AI agent that controls a PC through cmd/PowerShell batch files, a fast file finder, an app launcher and web search. Read the conversation. In under 180 words say exactly what the agent did wrong and the concrete, different approach to try next (specific commands or tools). No JSON.' },
          { role: 'user', content: `TASK: ${task}\n\nCONVERSATION SO FAR:\n${transcript}\n\nWhat should the agent do differently?` },
        ], true);
        results.push(`SECOND OPINION from a senior engineer (follow it, it replaces your previous approach):\n${String(advice).slice(0, 1500)}`);
        print('ai', 'got a second opinion, trying a totally different way now 🫡', '›');
      } catch { /* carry on without it */ }
    };
    const planItems = (upTo, end) => (live.hasPlan() ? live.snapshot(upTo, end) : [...(plan?.querySelectorAll('li') || [])].map((li, i) => ({ text: li.textContent, state: i + 1 < upTo ? 'done' : i + 1 === upTo ? (end ? 'todo' : 'now') : 'todo' })));
    const rowCount = (items) => items.reduce((n, g) => n + 1 + (g.state === 'now' ? (g.kids?.length || 0) : 0), 0);
    let planFresh = true;
    let curStep = 1;
    const tick = (upTo) => {
      if (!plan) return;
      curStep = upTo;
      const lis = [...plan.querySelectorAll('li')];
      lis.forEach((li, i) => { li.className = i + 1 < upTo ? 'ok' : i + 1 === upTo ? 'now' : ''; });
      plan.querySelector('.pbar i').style.width = `${Math.min(100, ((Math.min(upTo, lis.length + 1) - 1) / lis.length) * 100)}%`;
      live.focus(upTo);
      const items = planItems(upTo);
      window.api.todo({ agent: id, fresh: planFresh, finished: upTo === Infinity, title: task.slice(0, 70), items, rows: rowCount(items) });
      planFresh = false;
    };
    for (let step = 1; step <= limit() && !stopped; step++) {
      setSt(think ? 'thinking hard' : 'thinking');
      live.step(think ? 'thinking hard' : 'thinking', 'waiting for the AI model');
      let reply;
      try {
        const m0 = performance.now(); modelCalls++;
        const raw = await Promise.race([window.api.ai(history, think), new Promise((_, rej) => { abort = () => rej(new Error('stopped')); })]).finally(() => tadd('modelWait', performance.now() - m0));
        aiFails = 0;
        history.push({ role: 'assistant', content: raw });
        const q0 = performance.now();
        reply = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
        tadd('parse', performance.now() - q0);
      } catch (e) {
        if (stopped) break;
        // Bad JSON or a provider hiccup: retry once with reasoning on, then fall back to command memory.
        const msg = e.message.replace(/^Error invoking remote method 'ai': (Error: )?/, '');
        // Busy models / a key running out mid-task: the app already rotates key+model on every call, so just wait a moment and call again.
        if (!stopped && aiFails < 3 && !/daily limit|No API key/i.test(msg)) {
          aiFails++;
          live.detail(`all models busy, retrying (${aiFails}/3)…`);
          print('dim', 'switching to another free model…', '');
          tadd('retryWait', 2500 * aiFails);
          await new Promise((r) => setTimeout(r, 2500 * aiFails));
          step--; continue;
        }
        if (!think && !stopped) { think = true; print('dim', 'trying again, thinking harder…', ''); step--; continue; }
        problem(e.message.replace(/^Error invoking remote method 'ai': (Error: )?/, ''), task);
        failed = true;
        if (step === 1 && !stopped) offlineOk = await fromMemory(task);
        break;
      }
      if (reply.cmd) reply.cmd = fixCmd(reply.cmd);
      if (Array.isArray(reply.plan) && reply.plan.length && !plan) {
        plan = document.createElement('div');
        plan.className = 'box plan';
        plan.innerHTML = '<span class="legend">plan</span><div class="pbar"><i></i></div><ol></ol>';
        for (const s of reply.plan) { const li = document.createElement('li'); li.textContent = s; plan.lastChild.append(li); }
        log.append(plan);
        live.plan(reply.plan.map(String));
        tick(1);
      }
      if (reply.step) tick(Number(reply.step));
      if (reply.say) {
        const n = ran.length + webSteps;
        revealNext = !!reply.done && ANIM.focus !== 'off' && (ANIM.focus === 'always' || (n >= 3 && reply.say.length >= 40) || (webSteps > 0 && reply.say.length >= 60));
        print('ai', reply.say, '›');
        lastSay = reply.say;
      }
      if (reply.decided) print('decided', reply.decided, 'decided');
      if (reply.learn?.text && P.learning) {
        const kind = ['interest', 'trait', 'fact'].includes(reply.learn.kind) ? reply.learn.kind : 'fact';
        await window.api.db('addProfile', kind, String(reply.learn.text).slice(0, 200));
        print('dim', `${kind}: ${reply.learn.text}`, 'learned');
      }
      if (reply.improve) window.api.notify('idea', String(reply.improve).slice(0, 240));
      // Teamwork: open the agent windows, show the team card, and finish this turn (the card tracks them).
      // An explicit number ("/agent 5 …") is a promise: exactly that many windows open, whatever the AI split came back as.
      if (want && canDelegate && !stopped && !reply.ask && !delegated) {
        let list = [].concat(reply.delegate || []).map((j) => (typeof j === 'string' ? { task: j } : j)).filter((j) => j && String(j.task || '').trim());
        list = list.slice(0, want.n);
        for (let k = list.length; k < want.n; k++) list.push({ task: `${task}\n\n(You are agent ${k + 1} of ${want.n} working on this in parallel. Take your own angle and report what you found.)` });
        reply.delegate = list;
      }
      if (reply.delegate?.length && canDelegate && !stopped && !reply.ask) {
        const jobs = [].concat(reply.delegate).map((j) => (typeof j === 'string' ? { task: j } : j)).map((j) => ({ task: String(j?.task || '').trim(), web: !!(j?.web || want?.web) })).filter((j) => j.task).slice(0, 8);
        if (jobs.length) {
          live.step('opening agents', `${jobs.length} window${jobs.length === 1 ? '' : 's'}`);
          startTeam(jobs);
          delegated = true;
          tick(Infinity);
          break;
        }
      }
      // A question/warning means "don't act yet": never run anything alongside it.
      if (reply.ask) {
        const d = print('ask', reply.ask, 'ask');
        if (Array.isArray(reply.options) && reply.options.length) {
          const br = document.createElement('div');
          for (const o of reply.options.slice(0, 4)) {
            const b = document.createElement('button');
            b.className = 'btn';
            b.textContent = o;
            b.onclick = () => { if (running) return; br.remove(); input.value = String(o); $('form').requestSubmit(); };
            br.append(b);
          }
          d.lastChild.append(br);
        }
        asked = true;
        break;
      }
      const results = [];
      let stepFailed = false;
      if (reply.app?.name && !stopped) {
        live.step('opening app', reply.app.name);
        print('cmd', `open ${reply.app.name}${reply.app.file ? ` with ${reply.app.file}` : ''}`, 'app');
        const lr = await tm('launchApp', window.api.launchApp(reply.app.name, reply.app.file));
        if (lr.ok) { ran.push(`start "" "${lr.exe}"${reply.app.file ? ` "${reply.app.file}"` : ''}`); results.push(`Launched ${lr.exe}`); print('out', `launched ${lr.exe}`, 'app'); }
        else { results.push(`${reply.app.name} is NOT installed (checked Start Menu and Program Files). Tell the user; offer an alternative or a download link.`); stepFailed = true; print('err', `${reply.app.name} not found`, 'app'); }
      }
      if (reply.trash?.length && !stopped) {
        const list = [].concat(reply.trash).map(String);
        live.step('moving to the Recycle Bin', `${list.length} item${list.length === 1 ? '' : 's'}`);
        print('cmd', `trash ${list.map((q) => `"${q}"`).join(' ')}`, 'trash');
        if (list.length > 10 && !(await ask(`Move ${list.length} items to the Recycle Bin?`))) { results.push('User refused to trash these. Finish or choose another way.'); allOk = false; }
        else {
          const r = await window.api.trash(list);
          const good = r.filter((x) => x.ok), bad = r.filter((x) => !x.ok);
          if (good.length) { results.push(`Moved to the Recycle Bin (can be restored with "restore"): ${good.map((x) => x.path).join(' | ')}`); print('out', `moved ${good.length} item${good.length === 1 ? '' : 's'} to the Recycle Bin (undoable)`, 'trash'); webSteps++; }
          if (bad.length) { results.push(`Could not trash: ${bad.map((x) => `${x.path} (${x.error})`).join(' | ')}`); stepFailed = true; print('err', `couldn't remove ${bad.length} item${bad.length === 1 ? '' : 's'}: ${bad[0].error}`, 'trash'); }
        }
      }
      if (reply.restore && !stopped) {
        live.step('restoring from the Recycle Bin', String(reply.restore));
        print('cmd', `restore "${reply.restore}"`, 'restore');
        const r = await window.api.restoreTrash(String(reply.restore));
        if (r.ok) { results.push(`Restored from the Recycle Bin: ${r.text}`); print('out', 'restored from the Recycle Bin', 'restore'); webSteps++; }
        else { results.push(`Nothing matching "${reply.restore}" in the Recycle Bin (${r.text}). It may have been deleted permanently: offer Windows File Recovery (winfr) or OneDrive/Previous Versions.`); stepFailed = true; print('err', 'not in the Recycle Bin', 'restore'); }
      }
      if (reply.find?.name && !stopped) {
        live.step('searching your files', reply.find.name);
        print('cmd', `find "${reply.find.name}"${reply.find.in ? ` in ${reply.find.in}` : ''}${reply.find.ext ? ` .${String(reply.find.ext).replace(/^\./, '')}` : ''}`, 'find');
        try {
          const r = await tm('find', window.api.find(reply.find));
          const [a, b] = r.matches;
          const clear = a && a.score >= 0.75 && (!b || a.score - b.score >= 0.08);
          if (!a) { results.push(`find found nothing for "${reply.find.name}"${r.partial ? ' (search timed out)' : ''}. Try other words, another folder, or no folder.`); stepFailed = true; print('err', 'no match', 'find'); }
          else if (reply.find.open && clear && reply.find.with) {
            live.step('opening with', reply.find.with);
            const lr = await tm('launchApp', window.api.launchApp(reply.find.with, a.path));
            if (lr.ok) { ran.push(`start "" "${lr.exe}" "${a.path}"`); results.push(`Found ${a.path} and opened it with ${lr.exe}`); print('out', `opened ${a.path} with ${reply.find.with}`, 'open'); }
            else { results.push(`Found ${a.path} but ${reply.find.with} is NOT installed (checked Start Menu and Program Files). Tell the user and ask if the default player is fine (options).`); stepFailed = true; print('err', `${reply.find.with} is not installed`, 'open'); }
          } else if (reply.find.open && clear) {
            live.step('opening', a.path);
            const err = await tm('openPath', window.api.openPath(a.path));
            if (err) { results.push(`Found ${a.path} but opening failed: ${err}`); stepFailed = true; print('err', err, 'open'); }
            else { ran.push(`start "" "${a.path}"`); results.push(`Found and opened ${a.path}`); print('out', `opened ${a.path}`, 'open'); }
          } else {
            results.push(`find matches (score, path):\n${r.matches.map((m) => `${m.score} ${m.path}`).join('\n')}\n${reply.find.open ? 'Not opened: no single clear best match. Ask the user which one (use options), or pick if obvious.' : ''}`);
            print('out', r.matches.slice(0, 5).map((m) => `${m.score}  ${m.path}`).join('\n'), 'find');
            if (reply.find.open) stepFailed = true;
          }
        } catch (e) { results.push(`find failed: ${e.message}`); stepFailed = true; }
      }
      if (reply.web && !stopped) live.step('browsing', reply.web.search || reply.web.read);
      if (reply.web && !stopped) { results.push(await tm('web', browse(reply.web))); webSteps++; }
      try {
        if (reply.file?.path && !stopped) { live.step('writing file', reply.file.path); results.push(await tm('fileWrite', writeFile(reply.file))); }
      } catch (e) {
        print('err', "Couldn't save that file.", 'error');
        results.push(`File write failed: ${e.message}`);
        allOk = false;
      }
      if (reply.cmd?.trim() && !stopped) {
        live.step('running', reply.cmd);
        const cmdRow = print('cmd', reply.cmd, `step ${String(ran.length + 1).padStart(2, '0')}`);
        cmdRow.classList.add('running');
        const cmdT0 = Date.now();
        const cmdDone = (okk) => { cmdRow.classList.remove('running'); cmdRow.classList.add(okk ? 'ok' : 'bad'); const t = document.createElement('span'); t.className = 'dur'; t.textContent = `${okk ? '✓' : '✗'} ${((Date.now() - cmdT0) / 1000).toFixed(1)}s`; cmdRow.lastChild.append(t); };
        if (isRisky(reply.cmd) && !(await ask(`Risky command:\n${reply.cmd}`))) {
          results.push('User refused to run this command. Choose another way or finish.');
          allOk = false;
        } else {
          setSt('running');
          const { code, out } = await tm('cmdRun', window.api.run(reply.cmd));
          ran.push(reply.cmd);
          if (out.trim()) print('out', out.trim(), 'out');
          // dir/where/findstr exit 1 just means "nothing matched": not an error, no need for deep thinking.
          const soft = code === 1 && /^\s*(dir|where|findstr|tasklist|fc)\b/i.test(reply.cmd);
          let openedByApp = false;
          if (code && !soft) {
            // `start` can fail on odd file types: retry through the OS default-app opener.
            const m = reply.cmd.match(/^\s*start\s+""\s+"([^"]+)"\s*$/i);
            if (m && !/^https?:/i.test(m[1]) && !(await window.api.openPath(m[1]))) { openedByApp = true; print('out', `opened ${m[1]} (via default app)`, 'open'); }
          }
          if (code && !soft && !openedByApp) { print('err', `exit ${code}`, ''); think = true; allOk = false; stepFailed = true; }
          else if (soft && code) print('dim', code && !out.trim() ? 'no match' : 'ok (exit 1 = partial match)', '');
          if (out.includes('[killed after 60s')) window.api.notify('problem', `A command for "${task.slice(0, 60)}" timed out after 60s.`);
          results.push(`Command exit code ${openedByApp ? 0 : code}${soft && !out.trim() ? ' (nothing matched)' : ''}\n${out}${openedByApp ? '\n(file opened via the default app)' : ''}`);
        }
      }
      // A reply with no action (just chat, e.g. "hi") is the answer: finish instead of asking the model again and again.
      if (!results.length && !reply.cmd?.trim() && !reply.file?.path && !reply.web && !reply.find && !reply.app && !reply.trash?.length && !reply.restore) { tick(Infinity); break; }
      if (stepFailed) {
        fails++;
        if (fails >= 20) {
          print('ai', 'bro i gave up bro, this shit is not mine at this point 💀😭🫠 20 tries, swapped brains, even phoned a friend and still nothing. Say it a different way or do this one by hand 🙏', '›');
          failed = true;
          break;
        }
        if (fails >= 3) {
          think = true;
          const hint = cookbookHints(`${task} ${reply.cmd || ''} ${reply.find?.name || ''} ${reply.app?.name || ''}`);
          results.push(`ATTEMPT ${fails} FAILED. STOP repeating what failed. Change strategy: ${STRATS[(fails - 3) % STRATS.length]}.${hint ? `\nKnown-good recipes that may fit (check these before inventing anything):\n${hint}` : ''}`);
          live.detail(`attempt ${fails}: changing approach`);
        }
        if (fails === 10) await escalate(results);
      }
      if (results.length) history.push({ role: 'user', content: results.join('\n\n') });
      if (reply.done && stepFailed && step < limit()) { // a failed step is never "done": make the model try again
        history.push({ role: 'user', content: 'The last action FAILED, so the task is NOT done. Try another way.' });
        think = true; continue;
      }
      if (reply.done) { tick(Infinity); break; }
      if (step === limit()) { print('err', `Stopped after ${limit()} steps.`, 'limit'); failed = true; }
    }
    live.stop(!failed && !stopped);
    const secs = (Date.now() - t0) / 1000;
    const ok = (!failed && !stopped && !asked) || offlineOk;
    window.api.timing('log', { text: task, route: 'old', mode: speedMode, ok: !!ok, stopped, asked, failed, fails, modelCalls, steps: ran.length + webSteps, totalMs: Math.round(Date.now() - t0), stages: TM }).catch(() => {});
    if (!asked && !stopped && !failed) { const n = ran.length + webSteps; print('done', `${n} step${n === 1 ? '' : 's'} · ${secs.toFixed(1)}s`, 'done'); }
    // Remember only clean runs: every command exit 0, nothing refused, no question left open.
    if (ok && !offlineOk && allOk && ran.length && !ran.some(serious)) await window.api.db('remember', task, ran, lastSay);
    if (!asked) {
      await window.api.db('logTask', title, task, ran.length, secs, ok);
      if (!ok && !stopped && (await window.api.db('failsToday', task)) >= 2) {
        window.api.notify('problem', `"${task.slice(0, 60)}" failed again today. Try rewording it, or check Settings → models.`);
      }
    }
    if (teamGroup && !asked) window.api.agentDone({ group: teamGroup, idx: teamIdx, ok: ok && !stopped, stopped, summary: String(lastSay || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').slice(0, 220) });
    if (!asked && !stopped && !delegated) window.api.notify(ok ? 'done' : 'failed', ok ? String(lastSay || title).replace(/\*\*/g, '').slice(0, 140) : `${task.slice(0, 70)}: that didn't work out, open Genisys to see why.`);
    setSt(stopped ? 'stopped' : asked ? 'waiting for your answer' : ok ? 'done' : 'error');
    if (asked) input.focus();
    setRun(false);
    { const items = plan ? planItems(stopped || failed || !ok ? curStep : Infinity, true) : null; window.api.todo(plan ? { agent: id, hide: false, finished: true, stopped, failed: failed || !ok, title: task.slice(0, 70), items, rows: items.length } : { hide: true }); }
    orbIdle();
  }

  // Multi-line box: Enter sends, Shift+Enter or Ctrl+Enter = new line. The send button does the same as Enter.
  const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(140, input.scrollHeight)}px`; };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end'); grow(); }
    else if (e.altKey && mode === 'runner') { // Alt+Enter: continue in a full agent window
      e.preventDefault();
      const t = input.value.trim();
      if (t) { window.api.open('agent', t); window.api.hideRunner(); }
    } else if (!e.shiftKey) { e.preventDefault(); $('form').requestSubmit(); }
  });
  if (mode === 'runner') {
    input.placeholder = 'type a task · Enter sends · ⇧Enter new line · Alt+Enter opens a window · Esc closes';
    $('r-close').onclick = () => window.api.hideRunner();
    input.focus();
  }

  // ---- Slash menu (drop-up): type "/" for actions. 1/2/3, arrows + Enter, or click.
  const SL = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
  const SLASH = [
    { cmd: 'agent', title: 'Agent', desc: 'Open AI agent windows. Add a number to open several: /agent 5 task', ic: SL('<rect width="18" height="18" x="3" y="3" rx="4"/><path d="M8 12h8M12 8v8"/>') },
    { cmd: 'browser', title: 'Browser', desc: 'An agent that works on the web: searches, reads and opens sites', ic: SL('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>') },
    { cmd: 'script', title: 'Script writer', desc: 'Write, save and test a script or program', ic: SL('<path d="m18 16 4-4-4-4M6 8l-4 4 4 4M14.5 4l-5 16"/>') },
  ];
  const slashEl = $('slash');
  if (mode === 'runner') slashEl.parentElement.before(slashEl); // the runner card grows around it, next to (not inside) the input bar
  let slashSel = 0;
  const slashList = () => { const m = /^\/([a-z]*)$/i.exec(input.value); return m ? SLASH.filter((x) => x.cmd.startsWith(m[1].toLowerCase())) : []; };
  const slashOpen = () => !slashEl.hidden && !slashEl.classList.contains('use');
  const slashGrow = () => { if (mode === 'runner' && !document.body.classList.contains('open')) window.api.runnerGrow(slashEl.hidden ? 0 : slashEl.offsetHeight + 18); };
  const slashPick = (it) => {
    input.value = `/${it.cmd} `;
    input.focus();
    input.dispatchEvent(new Event('input'));
  };
  const slashRender = () => {
    const items = slashList();
    if (items.length) {
      slashSel = Math.min(slashSel, items.length - 1);
      slashEl.className = 'slash';
      slashEl.replaceChildren();
      const h = document.createElement('div'); h.className = 'sl-h'; h.textContent = 'Actions'; slashEl.append(h);
      items.forEach((it, i) => {
        const r = document.createElement('div');
        r.className = `sl-i${i === slashSel ? ' on' : ''}`;
        r.innerHTML = `<span class="sl-ic">${it.ic}</span><span class="sl-t"><b>/${it.cmd}</b><span></span></span><kbd>${SLASH.indexOf(it) + 1}</kbd>`;
        r.querySelector('.sl-t span').textContent = it.desc;
        r.onmousedown = (e) => { e.preventDefault(); slashPick(it); };
        r.onmouseenter = () => { slashSel = i; [...slashEl.querySelectorAll('.sl-i')].forEach((n, k) => n.classList.toggle('on', k === i)); };
        slashEl.append(r);
      });
      slashEl.hidden = false;
    } else if (/^\/(agent|browser)\s*\d{0,2}\s*$/i.test(input.value)) { // usage hint after the command is chosen
      const web = /browser/i.test(input.value);
      slashEl.className = 'slash use';
      slashEl.innerHTML = web
        ? 'Type the task for a <b>browser agent</b>, e.g. <code>/browser best laptops under $800</code>. Add a number to split it: <code>/browser 3 compare phones</code>'
        : 'Type the task, or just a number to open that many empty windows: <code>/agent 5</code>. With a task, this window splits the work: <code>/agent 3 research X, Y and Z</code>';
      slashEl.hidden = false;
    } else slashEl.hidden = true;
    slashGrow();
  };
  input.addEventListener('input', slashRender);
  input.addEventListener('blur', () => setTimeout(() => { slashEl.hidden = true; slashGrow(); }, 120));
  input.addEventListener('keydown', (e) => { // capture: runs before the Enter/Esc handlers
    if (!slashOpen()) return;
    const items = slashList();
    const digit = /^[1-9]$/.test(e.key) && input.value === '/' ? SLASH[+e.key - 1] : null;
    if (digit) { e.preventDefault(); e.stopImmediatePropagation(); slashPick(digit); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); slashSel = (slashSel + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; slashRender(); }
    else if ((e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); slashPick(items[slashSel] || items[0]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); slashEl.hidden = true; slashGrow(); }
  }, true);
  $('slashbtn')?.addEventListener('click', () => { input.value = '/'; input.focus(); input.dispatchEvent(new Event('input')); });

  $('form').onsubmit = (e) => {
    e.preventDefault();
    const task = input.value.trim();
    if (!task || running) return;
    input.value = ''; grow(); slashEl.hidden = true;
    // "/agent [N] [task]", "/browser [N] [task]", "/script [task]"
    const slash = task.match(/^\/(agent|browser|script)s?(?=\s|\d|$)\s*([\s\S]*)$/i);
    if (slash) {
      const cmd = slash[1].toLowerCase();
      let rest = slash[2].trim(), n = 1;
      const nm = /^(\d{1,2})(?!\d)\s*([\s\S]*)$/.exec(rest);
      if (nm && cmd !== 'script') { n = Math.max(1, Math.min(8, +nm[1])); rest = nm[2].trim(); }
      const web = cmd === 'browser';
      const finish = (msg) => { print('dim', msg, ''); if (mode === 'runner') window.api.hideRunner(); };
      if (cmd === 'script') { window.api.open('script', rest); return finish('opened the script writer'); }
      // "/agent 2 [task one, task two]": one agent per comma-separated task, opened directly (no AI split).
      const br = /^\[([\s\S]*)\]\s*$/.exec(rest);
      if (br) {
        const list = br[1].split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8);
        if (list.length) {
          window.api.openMany(list.map((t, idx) => ({ kind: 'agent', task: t, opts: { web } })));
          return finish(`opened ${list.length} ${web ? 'browser ' : ''}agent${list.length === 1 ? '' : 's'}, one per task${nm && n !== list.length ? ` (you said ${n} but gave ${list.length} tasks, so I went with the tasks)` : ''}`);
        }
      }
      if (!rest) { // just windows: /agent 5
        window.api.openMany(Array.from({ length: n }, () => ({ kind: 'agent', task: '', opts: { web } })));
        return finish(`opened ${n} ${web ? 'browser ' : ''}agent window${n === 1 ? '' : 's'}`);
      }
      if (n === 1 || !canDelegate) { window.api.open('agent', rest, { web }); return finish(`opened ${web ? 'a browser agent' : 'an agent'} for this task`); }
      // N agents + a task: this window's AI splits the work, opens the windows and manages them.
      if (mode === 'runner' && !document.body.classList.contains('open')) { document.body.classList.add('open'); window.api.runnerOpen(); }
      print('user', task, '$');
      loop(rest, { n, web });
      return;
    }
    if (mode === 'runner' && !document.body.classList.contains('open')) { document.body.classList.add('open'); window.api.runnerOpen(); }
    print('user', task, '$');
    loop(task);
  };
  $('stop').onclick = () => { if (running) { stopped = true; setSt('stopping…'); live.step('stopping', 'finishing the current step'); abort?.(); } };
  $('send').addEventListener('click', (e) => { if (running) { e.preventDefault(); $('stop').click(); } });
  input.focus();
  // Opened with a task (from /agent or /script): start right away.
  if (q.get('task')) { input.value = q.get('task'); $('form').requestSubmit(); }
}


// Rounded transparent windows have no OS resize border: invisible grips on the edges do the resizing.
if (mode !== 'runner') {
  const EDGES = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
  for (const [edge, cursor] of Object.entries(EDGES)) {
    const g = document.createElement('div');
    g.className = `grip g-${edge}`; g.style.cursor = cursor;
    g.onpointerdown = async (e) => {
      e.preventDefault(); g.setPointerCapture(e.pointerId);
      const b0 = await window.api.winBounds(); const x0 = e.screenX, y0 = e.screenY;
      let raf = 0;
      g.onpointermove = (m) => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const dx = m.screenX - x0, dy = m.screenY - y0;
          let { x, y, width, height } = b0;
          if (edge.includes('e')) width += dx;
          if (edge.includes('s')) height += dy;
          if (edge.includes('w')) { x += dx; width -= dx; }
          if (edge.includes('n')) { y += dy; height -= dy; }
          window.api.setWinBounds({ x, y, width, height });
        });
      };
      g.onpointerup = () => { g.onpointermove = g.onpointerup = null; };
    };
    document.body.append(g);
  }
  window.api.onMaxed?.((v) => document.documentElement.classList.toggle('maxed', v));
}
