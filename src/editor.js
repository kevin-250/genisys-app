// VS Code-style code editor for Script Writer windows: tabs, line numbers, syntax colors, auto-indent, auto-close brackets,
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

export function createEditor({ onSave, onRun, onNew }) {
  const el = document.createElement('div');
  el.className = 'ed';
  el.innerHTML = `
    <div class="ed-tabs"><div class="ed-tablist"></div>
      <button type="button" class="ed-btn" data-a="new" title="New file">＋</button>
      <span class="ed-sp"></span>
      <button type="button" class="ed-btn" data-a="find" title="Find (Ctrl+F)">Find</button>
      <button type="button" class="ed-btn" data-a="save" title="Save (Ctrl+S)">Save</button>
      <button type="button" class="ed-btn run" data-a="run" title="Run in its own window (F5)">▶ Run</button>
      <button type="button" class="ed-btn" data-a="out" title="Show / hide output (Ctrl+J)">Output</button>
    </div>
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
      <div class="ed-code"><div class="ed-cur"></div><pre class="ed-hl"><code></code></pre><textarea class="ed-ta" spellcheck="false" wrap="off" autocapitalize="off" autocomplete="off"></textarea></div>
      <div class="ed-empty">No file open yet.<br>Describe a script below, or press <kbd>＋</kbd> to start a new one.</div>
    </div>
    <div class="ed-status"><span class="s-pos">Ln 1, Col 1</span><span>Spaces: 2</span><span class="s-lang">Plain text</span><span>UTF-8</span><span class="s-zoom"></span><span class="s-dirty"></span></div>`;
  const $q = (s) => el.querySelector(s);
  const ta = $q('.ed-ta'), hl = $q('.ed-hl code'), hlPre = $q('.ed-hl'), gutter = $q('.ed-gutter'), cur = $q('.ed-cur');
  const files = []; // {path, name, saved}
  let active = null;
  let fs = 13;
  let hlRaf = 0;
  const lh = () => Math.round(fs * 1.55);
  const applyFont = () => { el.style.setProperty('--ed-fs', `${fs}px`); el.style.setProperty('--ed-lh', `${lh()}px`); $q('.s-zoom').textContent = `${Math.round((fs / 13) * 100)}%`; place(); };

  // ---- rendering ----
  const lang = () => (active ? langOf(active.path) : '');
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
    const d = active && ta.value !== active.saved;
    $q('.s-dirty').textContent = d ? '● unsaved' : '';
    const tab = el.querySelector('.ed-tab.on'); if (tab) tab.classList.toggle('dirty', !!d);
  }
  function refresh() { lines(); schedule(); place(); dirty(); }
  function tabs() {
    const list = $q('.ed-tablist');
    list.replaceChildren();
    for (const f of files) {
      const t = document.createElement('div');
      t.className = `ed-tab${f === active ? ' on' : ''}`; t.title = f.path;
      t.innerHTML = '<span class="dot"></span><span class="nm"></span><i class="x" title="Close">✕</i>';
      t.querySelector('.nm').textContent = f.name;
      t.onclick = (e) => { if (e.target.classList.contains('x')) close(f); else switchTo(f); };
      list.append(t);
    }
    el.classList.toggle('has-file', !!active);
    $q('.s-lang').textContent = active ? (lang() || 'Plain text') : 'Plain text';
  }
  function stash() { if (active) { active.text = ta.value; active.sel = [ta.selectionStart, ta.selectionEnd]; active.scroll = [ta.scrollTop, ta.scrollLeft]; } }
  function switchTo(f) {
    stash(); active = f; ta.value = f.text; ta.setSelectionRange(...(f.sel || [0, 0]));
    tabs(); refresh(); ta.scrollTop = f.scroll?.[0] || 0; ta.scrollLeft = f.scroll?.[1] || 0; sync(); ta.focus();
  }
  function close(f) {
    const i = files.indexOf(f);
    files.splice(i, 1);
    if (active === f) { active = null; const n = files[Math.max(0, i - 1)]; if (n) switchTo(n); else { ta.value = ''; tabs(); refresh(); } } else tabs();
  }
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
  async function save() { if (!active) return; const text = ta.value; await onSave(active.path, text); active.saved = text; dirty(); }
  function run() { if (active) onRun(active.path); }
  el.querySelector('.ed-tabs').addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'save') save(); else if (a === 'run') run(); else if (a === 'find') openFind(false);
    else if (a === 'out') el.dispatchEvent(new CustomEvent('toggle-output', { bubbles: true }));
    else if (a === 'new') onNew();
  });

  applyFont();
  loadHljs().then(() => { if (active) schedule(); });
  return {
    el,
    // Open (or refresh) a file. The AI rewriting an open file replaces its buffer.
    open(path, text) {
      let f = files.find((x) => x.path.toLowerCase() === path.toLowerCase());
      if (!f) { f = { path, name: path.split(/[\\/]/).pop() }; files.push(f); }
      f.saved = text; f.text = text; f.sel = [0, 0];
      if (active === f) { ta.value = text; refresh(); tabs(); } else switchTo(f);
    },
    current: () => (active ? { path: active.path, text: ta.value } : null),
    focus: () => ta.focus(),
    save,
  };
}
