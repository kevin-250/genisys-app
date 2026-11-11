// Pieces of the agent's chat that show WHAT it did (patterns from shadcn.io/ui "AI", rebuilt in plain DOM):
// confirmation (Deny / Approve), file tree (files it found), citation chips (web sources), changed-files card,
// environment-variables card. Every node is built with textContent, never from AI text as HTML.
const svg = (d, cls = '') => `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${d}</svg>`;
const I = {
  term: '<path d="m5 8 4 4-4 4M12 17h7"/>',
  alert: '<path d="M12 3 2 20h20zM12 10v4M12 17.5v.01"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  dir: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  copy: '<rect width="12" height="12" x="8" y="8" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  ok: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const copyWithCheck = async (btn, text) => {
  try { await navigator.clipboard.writeText(text); } catch { return; }
  const was = btn.innerHTML; btn.innerHTML = svg(I.ok); btn.classList.add('done');
  setTimeout(() => { btn.innerHTML = was; btn.classList.remove('done'); }, 1500);
};

// ---- Confirmation: the agent stops before something that changes the PC. Deny comes first, so a quick Enter can't run it.
// Resolves true/false; the row then turns into a one-line record of the answer.
export function confirmItem(host, { title, code = '', desc = '', danger = false }) {
  return new Promise((resolve) => {
    const box = el('div', `confirm${danger ? ' danger' : ''}`);
    box.setAttribute('role', 'group');
    box.innerHTML = `<span class="cf-ic">${svg(danger ? I.alert : I.term)}</span><div class="cf-c"><b></b></div><div class="cf-a"><button type="button" class="btn cf-no">Deny</button><button type="button" class="btn primary cf-yes">Approve</button></div>`;
    box.querySelector('b').textContent = title;
    box.setAttribute('aria-label', title);
    if (code) box.querySelector('.cf-c').append(el('code', 'cf-code', code));
    if (desc) box.querySelector('.cf-c').append(el('span', 'cf-d', desc));
    const answer = (yes) => {
      const line = el('div', `cf-done ${yes ? 'ok' : 'no'}`);
      line.innerHTML = `${svg(yes ? I.ok : I.x)}<span></span>`;
      line.lastChild.textContent = `${yes ? 'Approved' : 'Denied'}: ${title.replace(/\?$/, '')}`;
      box.replaceWith(line);
      resolve(yes);
    };
    box.querySelector('.cf-no').onclick = () => answer(false);
    box.querySelector('.cf-yes').onclick = () => answer(true);
    host.append(box);
  });
}

// ---- File tree: the files a search found, as folders that open and close. Rows slide in one after another;
// the best match is marked (aria-current). Click a file to open it with its default app.
export function fileTree(paths, { current = '', open } = {}) {
  const list = paths.filter(Boolean);
  const split = (p) => p.split(/[\\/]+/).filter(Boolean);
  const parts = list.map(split);
  // drop the folders every path shares ("C:\Users\me") so the tree starts where they differ
  let common = 0;
  while (parts.every((p) => p.length - 1 > common && p[common].toLowerCase() === parts[0][common].toLowerCase())) common++;
  const rootPath = parts[0] ? parts[0].slice(0, common).join('\\') : '';
  const root = { kids: new Map() };
  list.forEach((full, i) => {
    let node = root;
    const rest = parts[i].slice(common);
    rest.forEach((name, k) => {
      const key = name.toLowerCase();
      if (!node.kids.has(key)) node.kids.set(key, { name, kids: new Map(), file: k === rest.length - 1 ? full : null });
      node = node.kids.get(key);
    });
  });
  const wrap = el('div', 'ftree');
  if (rootPath) { const h = el('div', 'ft-root'); h.innerHTML = svg(I.dir); h.append(el('span', '', rootPath)); wrap.append(h); }
  let n = 0;
  const build = (node, host) => {
    for (const k of node.kids.values()) {
      if (k.file && !k.kids.size) {
        const b = el('button', 'ft-f');
        b.type = 'button'; b.title = k.file; b.style.setProperty('--i', n++);
        b.innerHTML = svg(I.file); b.append(el('span', '', k.name));
        if (k.file.toLowerCase() === current.toLowerCase()) b.setAttribute('aria-current', 'true');
        b.onclick = () => { wrap.querySelectorAll('[aria-current]').forEach((x) => x.removeAttribute('aria-current')); b.setAttribute('aria-current', 'true'); open?.(k.file); };
        host.append(b);
      } else {
        const d = el('div', 'ft-d open');
        const t = el('button', 'ft-t');
        t.type = 'button'; t.setAttribute('aria-expanded', 'true'); t.style.setProperty('--i', n++);
        t.innerHTML = `${svg(I.chev, 'ft-chev')}${svg(I.dir)}`; t.append(el('span', '', k.name));
        const inner = el('div', 'ft-in');
        t.onclick = () => { const o = d.classList.toggle('open'); t.setAttribute('aria-expanded', o); };
        d.append(t, inner); host.append(d);
        build(k, inner);
      }
    }
  };
  build(root, wrap);
  return wrap;
}

// ---- Citations: a chip with the site's name, after the sentence it supports; hover or focus shows the page.
export const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return String(url).slice(0, 30); } };
export function citeChip(src, { open } = {}) {
  const w = el('span', 'cite');
  const b = el('button', 'cite-b', hostOf(src.url));
  b.type = 'button'; b.setAttribute('aria-label', `Source: ${src.title || hostOf(src.url)}`);
  b.onclick = () => open?.(src.url);
  const card = el('span', 'cite-card');
  card.setAttribute('role', 'tooltip');
  card.append(el('b', '', src.title || hostOf(src.url)));
  if (src.snippet) card.append(el('span', 'cite-s', String(src.snippet).slice(0, 180)));
  const a = el('button', 'cite-l', `${hostOf(src.url)} ↗`);
  a.type = 'button'; a.title = src.url; a.onclick = () => open?.(src.url);
  card.append(a);
  w.append(b, card);
  return w;
}
// Replace "[2]" marks in already-rendered text with chips for sources[1]. Unknown numbers stay as text.
export function addCitations(root, sources, opts) {
  if (!sources.length) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = [];
  for (let t = walker.nextNode(); t; t = walker.nextNode()) if (/\[\d{1,2}\]/.test(t.data) && !t.parentElement.closest('.cb, code, pre')) hits.push(t);
  for (const t of hits) {
    const frag = document.createDocumentFragment();
    let at = 0;
    for (const m of t.data.matchAll(/\s?\[(\d{1,2})\]/g)) {
      const src = sources[+m[1] - 1];
      if (!src) continue;
      frag.append(t.data.slice(at, m.index), ' ', citeChip(src, opts));
      at = m.index + m[0].length;
    }
    frag.append(t.data.slice(at));
    t.replaceWith(frag);
  }
}
// The sites a web search found, as a row of chips (inside the search step).
export function sourceChips(sources, opts) {
  const row = el('div', 'cite-row');
  sources.forEach((s) => row.append(citeChip(s, opts)));
  return row;
}

// ---- Changed files: one card per turn that touched 2+ files. Click the header to see each file, its letter
// (A added, M modified, D deleted, R restored) and line counts. Copy puts the list of paths on the clipboard.
export const lineDiff = (before, after) => { // multiset of lines: cheap, close enough for +/- counts
  const a = String(before ?? '').split('\n'), b = String(after ?? '').split('\n');
  const m = new Map();
  for (const l of a) m.set(l, (m.get(l) || 0) + 1);
  let add = 0;
  for (const l of b) { const c = m.get(l) || 0; if (c) m.set(l, c - 1); else add++; }
  let del = 0; for (const c of m.values()) del += c;
  return { add, del };
};
const WORD = { A: 'added', M: 'modified', D: 'deleted', R: 'restored' };
export function changesCard(changes, { message = '', open } = {}) {
  const card = el('div', 'commit');
  const add = changes.reduce((s, c) => s + (c.add || 0), 0), del = changes.reduce((s, c) => s + (c.del || 0), 0);
  card.innerHTML = `<div class="cm-h"><button type="button" class="cm-t" aria-expanded="false"><span class="cm-m"></span><span class="cm-meta"></span>${svg(I.chev, 'cm-chev')}</button><button type="button" class="cm-copy" aria-label="Copy the file paths">${svg(I.copy)}</button></div><ul class="cm-files"></ul>`;
  card.querySelector('.cm-m').textContent = message || `Changed ${changes.length} files`;
  const meta = card.querySelector('.cm-meta');
  meta.append(el('span', '', `${changes.length} files`));
  if (add) meta.append(el('span', 'cm-add', `+${add}`));
  if (del) meta.append(el('span', 'cm-del', `−${del}`));
  meta.append(el('span', '', 'just now'));
  const t = card.querySelector('.cm-t');
  t.onclick = () => { const o = card.classList.toggle('open'); t.setAttribute('aria-expanded', o); };
  card.querySelector('.cm-copy').onclick = (e) => copyWithCheck(e.currentTarget, changes.map((c) => c.path).join('\n'));
  const ul = card.querySelector('.cm-files');
  for (const c of changes) {
    const li = el('li');
    const st = el('span', `cm-s s-${c.status}`, c.status);
    st.setAttribute('aria-label', WORD[c.status] || c.status);
    const p = el(c.status === 'D' ? 'span' : 'button', 'cm-p', c.path);
    if (c.status !== 'D') { p.type = 'button'; p.title = 'Open'; p.onclick = () => open?.(c.path); }
    li.append(st, el('span', 'cm-ic'), p);
    li.children[1].innerHTML = svg(I.file);
    const n = el('span', 'cm-n');
    if (c.add) n.append(el('span', 'cm-add', `+${c.add}`));
    if (c.del) n.append(el('span', 'cm-del', `−${c.del}`));
    li.append(n);
    ul.append(li);
  }
  return card;
}

// ---- Environment variables: KEY=value lines as rows, values masked until the switch shows them.
// Masking is for screen-sharing, not security: the values are in the page.
export const parseEnv = (text) => String(text).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
  .map((l) => { const i = l.indexOf('='); return { name: l.slice(0, i).replace(/^export\s+/, '').trim(), value: l.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2') }; })
  .filter((v) => /^[A-Za-z_][\w.]*$/.test(v.name));
export function envCard(vars, { title = 'Environment variables' } = {}) {
  const card = el('div', 'envc');
  card.innerHTML = `<div class="env-h"><span class="env-t">${svg(I.key)}<span></span></span><label class="env-sw"><input type="checkbox" role="switch"><i></i><span>Show values</span></label></div><div class="env-rows"></div>`;
  card.querySelector('.env-t span').textContent = title;
  const rows = card.querySelector('.env-rows');
  const vals = [];
  for (const v of vars) {
    const r = el('div', 'env-r');
    const val = el('code', 'env-v');
    val.setAttribute('dir', 'ltr');
    vals.push([val, v.value]);
    const b = el('button', 'env-copy');
    b.type = 'button'; b.setAttribute('aria-label', `Copy the value of ${v.name}`); b.innerHTML = svg(I.copy);
    b.onclick = () => copyWithCheck(b, v.value);
    r.append(el('code', 'env-n', v.name), val, b);
    rows.append(r);
  }
  const paint = (show) => vals.forEach(([n, v]) => { n.textContent = show ? v : '•'.repeat(Math.min(20, Math.max(8, v.length))); n.classList.toggle('masked', !show); n.setAttribute('aria-label', show ? v : 'Hidden'); });
  card.querySelector('input').onchange = (e) => paint(e.target.checked);
  paint(false);
  return card;
}
