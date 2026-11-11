// Code editor for Script Writer windows. Without a folder: ONE shared buffer the AI and the user both write in.
// With a folder open (Folder button): a VS Code-style workspace: explorer tree + open editors on the left, a tab per file,
// breadcrumbs. Line numbers, syntax colors, auto-indent, auto-close brackets,
// comment toggle, line move/duplicate/delete, find & replace, zoom, save (Ctrl+S), run. Edits go through execCommand so
// the browser's own undo/redo (Ctrl+Z / Ctrl+Y) keeps working.
const LANG = { py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', json: 'json', html: 'xml', htm: 'xml', xml: 'xml',
  css: 'css', ps1: 'powershell', bat: 'dos', cmd: 'dos', sh: 'bash', md: 'markdown', cs: 'csharp', java: 'java', cpp: 'cpp', c: 'c', go: 'go', rs: 'rust',
  sql: 'sql', yml: 'yaml', yaml: 'yaml', ini: 'ini', txt: '' };
const COMMENT = { python: '# ', bash: '# ', powershell: '# ', yaml: '# ', ini: '; ', dos: 'REM ', sql: '-- ', css: '', xml: '', json: '', markdown: '', '': '# ' };
const INDENT = '  ';
const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
let hljs = null;
const loadHljs = () => import('highlight.js/lib/common').then((m) => { hljs = m.default; });

export const langOf = (file) => LANG[(file.split('.').pop() || '').toLowerCase()] ?? '';

export function createEditor({ onSave, onSaveAs, onOpen, onOpenFolder, onRead, onRun, onRename }) {
  const el = document.createElement('div');
  el.className = 'ed';
  el.innerHTML = `
    <aside class="ed-side" hidden>
      <div class="sd-h"><span>EXPLORER</span><button type="button" class="sd-x" data-a="closefolder" title="Close folder">✕</button></div>
      <input class="sd-q" placeholder="Search files…" spellcheck="false">
      <div class="sd-t">OPEN EDITORS</div><div class="sd-open"></div>
      <div class="sd-t sd-root"></div><div class="sd-tree"></div>
    </aside>
    <div class="ed-pane">
    <div class="ed-tabs"><button type="button" class="ed-file" data-a="name"><span class="dot"></span><span class="nm"></span></button><div class="ed-tablist"></div>
      <span class="ed-sp"></span>
      <button type="button" class="ed-btn" data-a="open" title="Open a file (Ctrl+O)">Open</button>
      <button type="button" class="ed-btn" data-a="folder" title="Open a folder">Folder</button>
      <button type="button" class="ed-btn" data-a="save" title="Save (Ctrl+S)">Save</button>
      <button type="button" class="ed-btn run" data-a="run" title="Run in its own window (F5)">▶ Run</button>
      <button type="button" class="ed-btn" data-a="out" title="Show / hide the chat panel (Ctrl+J)">Chat</button>
    </div>
    <div class="ed-crumbs" hidden></div>
    <div class="ed-find" hidden>
      <input class="f-q" placeholder="Find" spellcheck="false"><input class="f-r" placeholder="Replace" spellcheck="false">
      <button type="button" class="ed-btn f-case" title="Match case">Aa</button>
      <button type="button" class="ed-btn f-prev" title="Previous (Shift+Enter)">↑</button>
      <button type="button" class="ed-btn f-next" title="Next (Enter)">↓</button>
      <button type="button" class="ed-btn f-rep">Replace</button><button type="button" class="ed-btn f-all">All</button>
      <span class="f-n"></span><button type="button" class="ed-btn f-x" title="Close (Esc)">✕</button>
    </div>
    <div class="ed-main">
      <pre class="ed-gutter"></pre>
      <div class="ed-code"><div class="ed-cur"></div><pre class="ed-hl"><code></code></pre><textarea class="ed-ta" spellcheck="false" wrap="off" autocapitalize="off" autocomplete="off" placeholder="Type code here, or describe a script in the chat and I'll write it here."></textarea></div>
    </div>
    <div class="ed-status"><span class="s-pos">Ln 1, Col 1</span><span class="s-lang">Plain text</span><span class="s-zoom"></span><span class="s-dirty"></span></div>
    </div>`;
  const $q = (s) => el.querySelector(s);
  const ta = $q('.ed-ta'), hl = $q('.ed-hl code'), hlPre = $q('.ed-hl'), gutter = $q('.ed-gutter'), cur = $q('.ed-cur');
  // Open files. Without a folder there is just one (the shared buffer). path is '' until it is saved (Save asks where).
  let active = { path: '', name: 'untitled', saved: '', text: '' };
  const files = [active];
  let folder = null; // { root, name, entries: [{ p: 'src\\a.js', d: false }] }
  const openDirs = new Set();
  const isDirty = (f) => { const t = f === active ? ta.value : f.text; return t !== f.saved && !!t; };
  let fs = 13;
  let hlRaf = 0;
  const lh = () => Math.round(fs * 1.55);
  const applyFont = () => { el.style.setProperty('--ed-fs', `${fs}px`); el.style.setProperty('--ed-lh', `${lh()}px`); $q('.s-zoom').textContent = fs === 13 ? '' : `${Math.round((fs / 13) * 100)}%`; place(); };

  // ---- rendering ----
  const lang = () => langOf(active.path || active.name);
  function paint() {
    hlRaf = 0;
    const v = ta.value;
    let html;
    try { html = hljs && v.length < 300000 && lang() ? hljs.highlight(v, { language: lang(), ignoreIllegals: true }).value : esc(v); } catch { html = esc(v); }
    hl.innerHTML = `${html}\n`;
  }
  const schedule = () => { if (!hlRaf) hlRaf = requestAnimationFrame(paint); };
  function lines() {
    const n = ta.value.split('\n').length;
    gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
  }
  function pos() {
    const v = ta.value, i = ta.selectionStart;
    const before = v.slice(0, i);
    return { line: before.split('\n').length, col: i - before.lastIndexOf('\n') };
  }
  function place() {
    const { line, col } = pos();
    $q('.s-pos').textContent = `Ln ${line}, Col ${col}`;
    cur.style.height = `${lh()}px`;
    cur.style.transform = `translateY(${8 + (line - 1) * lh() - ta.scrollTop}px)`;
  }
  function dirty() {
    const d = ta.value !== active.saved && !!ta.value;
    $q('.s-dirty').textContent = d ? '● unsaved' : '';
    $q('.ed-file').classList.toggle('dirty', d);
    el.querySelectorAll('[data-tab]').forEach((t) => t.classList.toggle('dirty', isDirty(files[+t.dataset.tab])));
  }
  function refresh() { lines(); schedule(); place(); dirty(); }
  const rel = (p) => (folder && p.toLowerCase().startsWith(folder.root.toLowerCase() + '\\') ? p.slice(folder.root.length + 1) : p);
  function tabs() {
    $q('.ed-file .nm').textContent = active.name;
    $q('.ed-file').title = `${active.path || 'Not saved yet'} · click to rename · Ctrl+F find · Ctrl+S save`;
    el.classList.add('has-file');
    el.classList.toggle('multi', !!folder || files.length > 1);
    $q('.s-lang').textContent = lang() || 'Plain text';
    const strip = $q('.ed-tablist'), list = $q('.sd-open');
    strip.replaceChildren(); list.replaceChildren();
    files.forEach((f, i) => {
      for (const host of [strip, list]) {
        const t = document.createElement('div');
        t.className = `ed-tab${f === active ? ' on' : ''}${isDirty(f) ? ' dirty' : ''}`; t.dataset.tab = i; t.title = f.path || 'Not saved yet';
        t.innerHTML = `<i class="fi" data-ext="${(f.name.split('.').pop() || '').toLowerCase()}"></i><span class="nm"></span><span class="dot"></span><i class="x" title="Close">✕</i>`;
        t.querySelector('.nm').textContent = f.name;
        t.onclick = (e) => { if (e.target.classList.contains('x')) closeTab(f); else show(f); };
        t.ondblclick = (e) => { if (!e.target.classList.contains('x') && f === active) rename(); };
        host.append(t);
      }
    });
    const cr = $q('.ed-crumbs');
    cr.hidden = !folder;
    if (folder) { cr.replaceChildren(); [folder.name, ...rel(active.path || active.name).split('\\')].forEach((seg, i, a) => { if (i) cr.append(Object.assign(document.createElement('i'), { textContent: '›' })); cr.append(Object.assign(document.createElement('span'), { textContent: seg, className: i === a.length - 1 ? 'last' : '' })); }); }
    markTree();
  }
  function stash() { active.text = ta.value; active.sel = [ta.selectionStart, ta.selectionEnd]; active.scroll = [ta.scrollTop, ta.scrollLeft]; }
  function show(f) {
    if (f !== active) stash();
    active = f; ta.value = f.text ?? ''; ta.setSelectionRange(...(f.sel || [0, 0]));
    tabs(); refresh(); ta.scrollTop = f.scroll?.[0] || 0; ta.scrollLeft = f.scroll?.[1] || 0; sync(); ta.focus();
  }
  function closeTab(f) {
    if (isDirty(f) && !confirm(`${f.name} has unsaved changes. Close it anyway?`)) return;
    const i = files.indexOf(f); files.splice(i, 1);
    if (!files.length) files.push({ path: '', name: 'untitled', saved: '', text: '' });
    if (f === active) { active = files[Math.max(0, i - 1)]; show(active); } else tabs();
  }
  // Open a file from disk as a tab (or switch to it if it is open already).
  async function openPathTab(p) {
    const have = files.find((f) => f.path && f.path.toLowerCase() === p.toLowerCase());
    if (have) return show(have);
    const text = await onRead(p);
    if (text == null) return;
    stash();
    const scratch = files.length === 1 && !active.path && !ta.value.trim() ? active : null; // an empty untitled tab is reused
    const f = { path: p, name: p.split(/[\\/]/).pop(), saved: text, text };
    if (scratch) files.splice(0, 1, f); else files.push(f);
    show(f);
  }

  // ---- explorer (folder tree) ----
  function treeData() {
    const root = { kids: new Map() };
    for (const e of folder.entries) {
      let node = root; const parts = e.p.split('\\');
      parts.forEach((name, k) => {
        if (!node.kids.has(name)) node.kids.set(name, { name, rel: parts.slice(0, k + 1).join('\\'), d: k < parts.length - 1 || e.d, kids: new Map() });
        node = node.kids.get(name);
      });
    }
    return root;
  }
  const sortKids = (n) => [...n.kids.values()].sort((a, b) => (b.d - a.d) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  function renderTree() {
    const host = $q('.sd-tree'); host.replaceChildren();
    if (!folder) return;
    $q('.sd-root').textContent = folder.name.toUpperCase();
    const q = $q('.sd-q').value.trim().toLowerCase();
    const row = (n, depth) => {
      const r = document.createElement('button');
      r.type = 'button'; r.className = `sd-r${n.d ? ' dir' : ''}${n.d && openDirs.has(n.rel) ? ' open' : ''}`; r.style.paddingLeft = `${8 + depth * 12}px`;
      r.dataset.rel = n.rel; r.title = n.rel;
      r.innerHTML = n.d ? '<i class="chev"></i><i class="fo"></i><span></span>' : `<i class="sp"></i><i class="fi" data-ext="${(n.name.split('.').pop() || '').toLowerCase()}"></i><span></span>`;
      r.querySelector('span').textContent = n.name;
      r.onclick = () => { if (n.d) { openDirs.has(n.rel) ? openDirs.delete(n.rel) : openDirs.add(n.rel); renderTree(); } else openPathTab(`${folder.root}\\${n.rel}`); };
      return r;
    };
    if (q) { // search: a flat list of matching files
      for (const e of folder.entries) if (!e.d && e.p.toLowerCase().includes(q)) { const n = { name: e.p.split('\\').pop(), rel: e.p, d: false }; const r = row(n, 0); r.querySelector('span').textContent = e.p; host.append(r); }
      if (!host.children.length) host.append(Object.assign(document.createElement('div'), { className: 'sd-none', textContent: 'No matching files' }));
    } else {
      const walk = (n, depth) => { for (const k of sortKids(n)) { host.append(row(k, depth)); if (k.d && openDirs.has(k.rel)) walk(k, depth + 1); } };
      walk(treeData(), 0);
    }
    markTree();
  }
  function markTree() {
    const cur = active.path && folder ? rel(active.path).toLowerCase() : '';
    el.querySelectorAll('.sd-r').forEach((r) => r.classList.toggle('on', !!cur && r.dataset.rel.toLowerCase() === cur));
  }
  $q('.sd-q').addEventListener('input', renderTree);
  $q('.sd-q').addEventListener('keydown', (e) => e.stopPropagation());
  async function openFolder() {
    const f = await onOpenFolder(); if (!f) { ta.focus(); return; }
    folder = f; openDirs.clear();
    el.classList.add('folder'); $q('.ed-side').hidden = false;
    renderTree(); tabs();
  }
  function closeFolder() { folder = null; el.classList.remove('folder'); $q('.ed-side').hidden = true; tabs(); ta.focus(); }
  function sync() { hlPre.scrollTop = ta.scrollTop; hlPre.scrollLeft = ta.scrollLeft; gutter.scrollTop = ta.scrollTop; place(); }
  ta.addEventListener('scroll', sync);
  ta.addEventListener('input', refresh);
  ta.addEventListener('click', place);
  ta.addEventListener('keyup', place);

  // ---- editing helpers (all via execCommand so undo/redo work) ----
  function put(start, end, text, s1, s2) {
    ta.focus(); ta.setSelectionRange(start, end);
    if (text === '') document.execCommand('delete'); else document.execCommand('insertText', false, text);
    if (s1 != null) ta.setSelectionRange(s1, s2 ?? s1);
  }
  const lineStart = (i) => ta.value.lastIndexOf('\n', i - 1) + 1;
  const lineEnd = (i) => { const k = ta.value.indexOf('\n', i); return k < 0 ? ta.value.length : k; };
  function selLines() { // whole lines touched by the selection
    let a = ta.selectionStart, b = ta.selectionEnd;
    if (b > a && ta.value[b - 1] === '\n') b--;
    return [lineStart(a), lineEnd(b)];
  }
  function indentSel(out) {
    const [a, b] = selLines(), s0 = ta.selectionStart, e0 = ta.selectionEnd;
    const block = ta.value.slice(a, b).split('\n');
    const next = block.map((l) => (out ? (l.startsWith(INDENT) ? l.slice(INDENT.length) : l.replace(/^ ?/, '')) : INDENT + l));
    const delta0 = next[0].length - block[0].length, total = next.join('\n').length - block.join('\n').length;
    put(a, b, next.join('\n'), Math.max(a, s0 + delta0), e0 + total);
  }
  function toggleComment() {
    const cm = (lang() in COMMENT) ? COMMENT[lang()] : '// ';
    if (!cm) return;
    const [a, b] = selLines(), s0 = ta.selectionStart, e0 = ta.selectionEnd;
    const block = ta.value.slice(a, b).split('\n');
    const allOn = block.filter((l) => l.trim()).every((l) => l.trimStart().startsWith(cm.trim()));
    const next = block.map((l) => {
      if (!l.trim()) return l;
      const ws = l.match(/^\s*/)[0];
      return allOn ? ws + l.slice(ws.length).replace(new RegExp(`^${cm.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ?`), '') : ws + cm + l.slice(ws.length);
    });
    const total = next.join('\n').length - block.join('\n').length;
    put(a, b, next.join('\n'), Math.max(a, s0 + (next[0].length - block[0].length)), e0 + total);
  }
  function moveLines(dir) {
    const [a, b] = selLines(), v = ta.value;
    const s0 = ta.selectionStart - a, e0 = ta.selectionEnd - a;
    if (dir < 0 && a === 0) return;
    if (dir > 0 && b >= v.length) return;
    if (dir < 0) {
      const pa = lineStart(a - 1), prev = v.slice(pa, a - 1), mine = v.slice(a, b);
      put(pa, b, `${mine}\n${prev}`, pa + s0, pa + e0);
    } else {
      const nb = lineEnd(b + 1), next = v.slice(b + 1, nb), mine = v.slice(a, b);
      put(a, nb, `${next}\n${mine}`, a + next.length + 1 + s0, a + next.length + 1 + e0);
    }
  }
  function dupLines() { const [a, b] = selLines(); const t = ta.value.slice(a, b); put(b, b, `\n${t}`, ta.selectionStart + t.length + 1, ta.selectionEnd + t.length + 1); }
  function delLines() { const [a, b] = selLines(); const end = b < ta.value.length ? b + 1 : b; const st = end === b && a > 0 ? a - 1 : a; put(st, end, '', st); }
  function newline() {
    const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    const ls = lineStart(s), ind = v.slice(ls, s).match(/^[ \t]*/)[0];
    const prev = v[s - 1], next = v[e];
    const opens = '{[(:'.includes(prev || ' ');
    if (opens && PAIRS[prev] && PAIRS[prev] === next) { // {|}  →  split onto three lines
      const text = `\n${ind}${INDENT}\n${ind}`;
      put(s, e, text, s + 1 + ind.length + INDENT.length);
    } else put(s, e, `\n${ind}${opens ? INDENT : ''}`);
  }
  function onKey(e) {
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (k.length === 1 && !ctrl) e.stopPropagation(); // typing must not trigger app shortcuts like "?" for help
    if (ctrl && k.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    if (ctrl && k.toLowerCase() === 'o') { e.preventDefault(); openFile(); return; }
    if (ctrl && k.toLowerCase() === 'f') { e.preventDefault(); openFind(false); return; }
    if (ctrl && k.toLowerCase() === 'h') { e.preventDefault(); openFind(true); return; }
    if (ctrl && k === '/') { e.preventDefault(); toggleComment(); return; }
    if (ctrl && k.toLowerCase() === 'd') { e.preventDefault(); dupLines(); return; }
    if (ctrl && e.shiftKey && k.toLowerCase() === 'k') { e.preventDefault(); delLines(); return; }
    if (ctrl && (k === '=' || k === '+')) { e.preventDefault(); fs = Math.min(26, fs + 1); applyFont(); return; }
    if (ctrl && k === '-') { e.preventDefault(); fs = Math.max(9, fs - 1); applyFont(); return; }
    if (ctrl && k === '0') { e.preventDefault(); fs = 13; applyFont(); return; }
    if (k === 'F5') { e.preventDefault(); run(); return; }
    if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown')) { e.preventDefault(); moveLines(k === 'ArrowUp' ? -1 : 1); return; }
    if (k === 'Tab') {
      e.preventDefault();
      const multi = ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n');
      if (e.shiftKey || multi) indentSel(e.shiftKey); else put(ta.selectionStart, ta.selectionEnd, INDENT);
      return;
    }
    if (k === 'Enter' && !ctrl && !e.shiftKey && !e.altKey) { e.preventDefault(); newline(); return; }
    if (ctrl || e.altKey) return;
    const s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
    if (k === 'Backspace' && s === en && PAIRS[v[s - 1]] && PAIRS[v[s - 1]] === v[s]) { e.preventDefault(); put(s - 1, s + 1, '', s - 1); return; }
    if (PAIRS[k]) {
      const close = PAIRS[k], quote = k === close;
      if (s !== en) { e.preventDefault(); const sel = v.slice(s, en); put(s, en, k + sel + close, s + 1, en + 1); return; }
      if (quote && v[s] === k) { e.preventDefault(); ta.setSelectionRange(s + 1, s + 1); return; } // type over the closing quote
      if (quote && /\w/.test(v[s - 1] || '')) return; // apostrophes in words
      e.preventDefault(); put(s, s, k + close, s + 1); return;
    }
    if (')]}'.includes(k) && v[s] === k && s === en) { e.preventDefault(); ta.setSelectionRange(s + 1, s + 1); }
  }
  ta.addEventListener('keydown', onKey);
  ta.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); fs = Math.max(9, Math.min(26, fs + (e.deltaY < 0 ? 1 : -1))); applyFont(); } }, { passive: false });

  // ---- find & replace ----
  const fbar = $q('.ed-find'), fq = $q('.f-q'), fr = $q('.f-r');
  let matchCase = false;
  function matches() {
    const q = fq.value; if (!q) return [];
    const v = matchCase ? ta.value : ta.value.toLowerCase(), needle = matchCase ? q : q.toLowerCase();
    const out = []; let i = 0;
    while ((i = v.indexOf(needle, i)) >= 0) { out.push(i); i += Math.max(1, needle.length); }
    return out;
  }
  function go(dir, from) {
    const m = matches(); $q('.f-n').textContent = m.length ? `${m.length} found` : (fq.value ? 'none' : '');
    if (!m.length) return;
    const at = from ?? (dir > 0 ? ta.selectionEnd : ta.selectionStart - 1);
    const pick = dir > 0 ? (m.find((i) => i >= at) ?? m[0]) : ([...m].reverse().find((i) => i <= at) ?? m[m.length - 1]);
    ta.focus(); ta.setSelectionRange(pick, pick + fq.value.length);
    const line = ta.value.slice(0, pick).split('\n').length;
    ta.scrollTop = Math.max(0, (line - 4) * lh()); sync();
  }
  function openFind(replace) {
    fbar.hidden = false; el.classList.add('finding');
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (sel && !sel.includes('\n')) fq.value = sel;
    fr.style.display = replace ? '' : 'none'; $q('.f-rep').style.display = $q('.f-all').style.display = replace ? '' : 'none';
    (replace && fq.value ? fr : fq).focus(); fq.select(); go(1, ta.selectionStart);
  }
  const closeFind = () => { fbar.hidden = true; el.classList.remove('finding'); ta.focus(); };
  fq.addEventListener('input', () => go(1, ta.selectionStart));
  fbar.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
    else if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
  });
  $q('.f-next').onclick = () => go(1); $q('.f-prev').onclick = () => go(-1); $q('.f-x').onclick = closeFind;
  $q('.f-case').onclick = (e) => { matchCase = !matchCase; e.currentTarget.classList.toggle('on', matchCase); go(1, ta.selectionStart); };
  $q('.f-rep').onclick = () => {
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if ((matchCase ? sel : sel.toLowerCase()) === (matchCase ? fq.value : fq.value.toLowerCase()) && fq.value) put(ta.selectionStart, ta.selectionEnd, fr.value);
    go(1);
  };
  $q('.f-all').onclick = () => {
    const m = matches(); if (!m.length) return;
    let out = '', last = 0; for (const i of m) { out += ta.value.slice(last, i) + fr.value; last = i + fq.value.length; }
    put(0, ta.value.length, out + ta.value.slice(last), 0); go(1, 0);
  };

  // ---- file actions ----
  // Inline name box in the header (first save of an untitled buffer, or a rename).
  function askName() {
    return new Promise((resolve) => {
      const box = document.createElement('input');
      box.className = 'ed-name'; box.value = active.name === 'untitled' ? '' : active.name; box.placeholder = 'file name, e.g. tool.py'; box.spellcheck = false;
      const lbl = $q('.ed-file'); lbl.hidden = true; lbl.after(box); box.focus(); box.select();
      let done = false;
      const fin = (ok) => { if (done) return; done = true; const n = box.value.trim().replace(/[\\/:*?"<>|]/g, ''); box.remove(); lbl.hidden = false; resolve(ok && n ? n : null); };
      box.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') fin(true); else if (e.key === 'Escape') fin(false); };
      box.onblur = () => fin(false);
    });
  }
  // Not saved yet: Windows' "Save as" dialog picks the place and name. After that, Save writes to the same file.
  async function save() {
    const text = ta.value;
    const full = active.path ? await onSave(active.path, text) : await onSaveAs(active.name, text, folder?.root);
    if (!full) { ta.focus(); return; }
    active.path = full; active.name = full.split(/[\\/]/).pop();
    if (folder && rel(full) !== full && !folder.entries.some((e) => e.p.toLowerCase() === rel(full).toLowerCase())) { folder.entries.push({ p: rel(full), d: false }); renderTree(); }
    active.saved = text; tabs(); dirty(); schedule(); ta.focus();
  }
  async function openFile() {
    if (folder || files.length > 1) { const f = await onOpen(); if (f) { stash(); const t = { path: f.path, name: f.path.split(/[\\/]/).pop(), saved: f.text, text: f.text }; files.push(t); show(t); } return; }
    if (ta.value !== active.saved && ta.value.trim() && !confirm('Open another file? Your unsaved changes here will be lost.')) return;
    const f = await onOpen(); if (!f) { ta.focus(); return; }
    active.path = f.path; active.name = f.path.split(/[\\/]/).pop(); active.saved = f.text;
    ta.value = f.text; ta.setSelectionRange(0, 0); ta.scrollTop = 0; tabs(); refresh(); sync(); ta.focus();
  }
  async function rename() {
    const n = await askName(); if (!n || n === active.name) { ta.focus(); return; }
    if (active.path && active.saved) { const to = await onRename(active.path, n); if (!to) { ta.focus(); return; } active.path = to; }
    else if (active.path) active.path = active.path.replace(/[^\\/]+$/, n);
    active.name = n; tabs(); schedule(); ta.focus();
  }
  async function run() { if (!active.path || ta.value !== active.saved) await save(); if (active.path) onRun(active.path); }
  $q('.sd-x').onclick = closeFolder;
  el.querySelector('.ed-tabs').addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'save') save(); else if (a === 'open') openFile(); else if (a === 'folder') openFolder(); else if (a === 'run') run(); else if (a === 'name') rename();
    else if (a === 'out') el.dispatchEvent(new CustomEvent('toggle-output', { bubbles: true }));
  });

  applyFont();
  tabs(); refresh();
  loadHljs().then(schedule);
  return {
    el,
    // The AI wrote a file (path = saved on disk) or a snippet (no path: an unsaved buffer called `name`): it replaces the buffer.
    // With several tabs (folder open) the AI's file goes into the tab with that name, or a new unsaved tab: never over another file.
    open(path, text, name) {
      name = name || (path ? path.split(/[\\/]/).pop() : 'untitled');
      if (folder || files.length > 1) {
        stash();
        let f = files.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (!f) { f = { path: path || '', name, saved: path ? text : '' }; files.push(f); }
        f.text = text; f.sel = [0, 0]; f.scroll = [0, 0];
        if (f === active) { ta.value = text; tabs(); refresh(); sync(); } else show(f);
        return;
      }
      active.path = path || ''; active.name = name;
      active.saved = path ? text : ''; ta.value = text; ta.setSelectionRange(0, 0); ta.scrollTop = 0;
      tabs(); refresh(); sync();
    },
    current: () => (ta.value.trim() ? { path: active.path || `${active.name} (not saved yet)`, text: ta.value } : null),
    // For the AI: which folder is open and its files (short).
    folder: () => (folder ? { root: folder.root, files: folder.entries.filter((e) => !e.d).map((e) => e.p).slice(0, 150) } : null),
    focus: () => ta.focus(),
    save,
  };
}
