// Code block for code the AI writes in a chat (main window, Alt+Space runner, agent windows):
// header (title + wrap / open / copy), line numbers outside the selection, highlighting, "Show more" past 16 lines.
// highlight.js loads on the first block; until then the block is plain and repaints.
let hljs = null;
export const loadHljs = () => (hljs ? Promise.resolve(hljs) : import('highlight.js/lib/common').then((m) => (hljs = m.default)));
const CB_SVG = {
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  term: '<path d="m5 8 4 4-4 4M12 17h7"/>',
  wrap: '<path d="M3 6h18M3 12h15a3 3 0 0 1 0 6h-4"/><path d="m16 16-2 2 2 2M3 18h7"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/>',
  copy: '<rect width="12" height="12" x="8" y="8" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  ok: '<path d="m5 12 5 5 9-10"/>',
};
const SHELL = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'powershell', 'ps1', 'bat', 'cmd', 'batch', 'dos', 'terminal']);
export function codeBlock(code, { title = '', lang = '', path = '' } = {}) {
  code = String(code).replace(/\n+$/, '');
  const lines = code.split('\n');
  const ext = (lang || (path.match(/\.(\w+)$/)?.[1] ?? '')).toLowerCase();
  const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const b = document.createElement('div');
  b.className = lines.length === 1 ? 'cb one' : 'cb'; // a one-line command needs no line number
  b.innerHTML = `<div class="cb-h"><span class="cb-t"><svg viewBox="0 0 24 24" aria-hidden="true">${SHELL.has(ext) ? CB_SVG.term : CB_SVG.file}</svg><span></span></span><span class="cb-a"></span><span class="cb-live" aria-live="polite"></span></div>
    <div class="cb-body"><pre class="cb-g" aria-hidden="true"></pre><pre class="cb-c" tabindex="0" dir="ltr"><code class="hljs"></code></pre></div>`;
  const name = path ? path.split(/[\\/]/).slice(-2).join('\\') : title;
  const tEl = b.querySelector('.cb-t span');
  const codeEl = b.querySelector('code'), body = b.querySelector('.cb-body');
  b.querySelector('.cb-g').textContent = lines.map((_, i) => i + 1).join('\n');
  const paint = () => {
    const known = hljs && ext && hljs.getLanguage(ext);
    if (!hljs) { codeEl.innerHTML = esc(code); tEl.textContent = name || ext || 'code'; return; }
    const r = known ? hljs.highlight(code, { language: ext, ignoreIllegals: true }) : lines.length > 1 ? hljs.highlightAuto(code) : { value: esc(code) };
    codeEl.innerHTML = r.value;
    const ln = known ? hljs.getLanguage(ext).name : r.language && hljs.getLanguage(r.language)?.name;
    tEl.textContent = name ? `${name}${ln ? ` · ${ln}` : ''}` : ln || 'code';
  };
  paint();
  if (!hljs) loadHljs().then(paint).catch(() => {});
  b.title = path || '';
  const acts = b.querySelector('.cb-a'), live = b.querySelector('.cb-live');
  const btn = (label, svg, fn) => {
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'cb-b'; x.title = label; x.setAttribute('aria-label', label);
    x.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg>`;
    x.onclick = () => fn(x);
    acts.append(x);
    return x;
  };
  btn('Wrap lines', CB_SVG.wrap, (x) => { const on = b.classList.toggle('wrap'); x.setAttribute('aria-pressed', on); }).setAttribute('aria-pressed', 'false');
  if (path) btn('Open the file', CB_SVG.open, () => window.api.openPath(path));
  btn('Copy', CB_SVG.copy, async (x) => {
    try { await navigator.clipboard.writeText(code); } catch { return; }
    x.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${CB_SVG.ok}</svg><span>Copied</span>`; x.classList.add('done');
    live.textContent = 'Copied';
    setTimeout(() => { x.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${CB_SVG.copy}</svg>`; x.classList.remove('done'); live.textContent = ''; }, 1600);
  });
  if (lines.length > 16) { // long file: show the top, the rest on demand (then scroll inside, capped)
    b.classList.add('capped');
    const id = `cb${Math.random().toString(36).slice(2, 8)}`;
    body.id = id;
    const f = document.createElement('button');
    f.type = 'button'; f.className = 'cb-more'; f.setAttribute('aria-controls', id); f.setAttribute('aria-expanded', 'false');
    f.textContent = `Show ${lines.length - 16} more lines`;
    f.onclick = () => { const open = b.classList.toggle('capped') === false; f.setAttribute('aria-expanded', open); f.textContent = open ? 'Show less' : `Show ${lines.length - 16} more lines`; };
    b.append(f);
  }
  return b;
}
// "text ```lang\ncode``` text" -> [{ text }, { code, lang }, ...]; an unclosed fence (still streaming) runs to the end.
export const splitFences = (s) => {
  const out = [];
  const re = /```([\w+#.-]*)[^\n]*\n([\s\S]*?)(?:\n?```|$)/g;
  let at = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > at) out.push({ text: s.slice(at, m.index).trim() });
    out.push({ code: m[2], lang: m[1] });
    at = re.lastIndex;
  }
  if (at < s.length) out.push({ text: s.slice(at).trim() });
  return out.filter((p) => p.code != null || p.text);
};
