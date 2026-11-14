// File tables: scan a folder, filter/sort/group what is there, and hand back a table the page draws.
// Three tools share it (browse_files, file_summary, find_duplicates) plus parseFileQuery, which turns plain
// requests ("all movies in videos newest first", "what's taking space in downloads") into those tools with no AI call.
// Pure except scanFiles/hashSample, which get fs injected (node:fs/promises in the app, a temp folder in tests).
import { win32 as path } from 'node:path';
import { skipDir } from './index.js';

import { kindOf, parseSizeRule, parseWhen } from './fileQuery.js';

export { parseFileQuery, parseWhen, parseSize, parseSizeRule, KINDS, kindOf } from './fileQuery.js';

// ---- formatting
const pad = (x) => String(x).padStart(2, '0');
export const fmtDate = (ms) => { if (!ms) return ''; const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export function fmtSize(b) {
  if (b == null) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${i && v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

// ---- scanning (fs injected). Each entry: { path, name, ext, kind, size, arrived, modified, rel }.
// "arrived" = creation time on THIS PC: a download or copy gets a new one, while "modified" keeps the original's date.
export async function scanFiles(root, fsp, { maxFiles = 100000, maxDepth = 12, deadline = Date.now() + 15000 } = {}) {
  const files = [];
  const queue = [[root, 0]];
  let partial = false;
  while (queue.length) {
    if (files.length >= maxFiles || Date.now() > deadline) { partial = true; break; }
    const [dir, depth] = queue.shift();
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!skipDir(e.name) && depth < maxDepth) queue.push([full, depth + 1]); continue; }
      if (!e.isFile() || e.name.startsWith('~$') || /^(desktop\.ini|thumbs\.db)$/i.test(e.name)) continue;
      let st;
      try { st = await fsp.stat(full); } catch { continue; }
      const ext = path.extname(e.name).slice(1).toLowerCase();
      files.push({ path: full, name: e.name, ext, kind: kindOf(ext), size: st.size, arrived: st.birthtimeMs || st.mtimeMs, modified: st.mtimeMs, rel: path.relative(root, dir) });
    }
  }
  return { files, partial };
}

// ---- filtering + sorting (browse_files)
const extSet = (s) => new Set(String(s || '').toLowerCase().split(/[\s,;|]+/).map((x) => x.replace(/^\*?\./, '')).filter(Boolean));
export function makeFilter(p = {}, now = Date.now()) {
  const when = p.when ? parseWhen(p.when, now) : {};
  if (when === null) return { error: `didn't understand the time "${p.when}" (try "last week", "october", "2025", "last 30 days")` };
  const size = p.size ? parseSizeRule(p.size) : {};
  const exts = extSet(p.ext);
  const kind = p.kind && p.kind !== 'any' ? p.kind : null;
  const words = String(p.name || '').toLowerCase().split(/\s+/).filter(Boolean);
  const dateKey = p.sort === 'modified' ? 'modified' : 'arrived';
  return {
    test: (f) => (!exts.size || exts.has(f.ext)) && (!kind || f.kind === kind)
      && (!words.length || words.every((w) => f.name.toLowerCase().includes(w)))
      && (when.from == null || f[dateKey] >= when.from) && (when.to == null || f[dateKey] < when.to)
      && (size.min == null || f.size >= size.min) && (size.max == null || f.size <= size.max),
  };
}
const ASC_FIRST = new Set(['name', 'type', 'folder']);
const KEY = { arrived: (f) => f.arrived, modified: (f) => f.modified, size: (f) => f.size, name: (f) => f.name.toLowerCase(), type: (f) => f.ext, folder: (f) => f.rel.toLowerCase() };
export function sortFiles(list, sort = 'arrived', order) {
  const k = KEY[sort] || KEY.arrived;
  const dir = (order || (ASC_FIRST.has(sort) ? 'asc' : 'desc')) === 'asc' ? 1 : -1;
  return list.sort((a, b) => { const x = k(a), y = k(b); return (x < y ? -1 : x > y ? 1 : 0) * dir || a.name.localeCompare(b.name); });
}

const SORT_SAY = { arrived: 'date arrived', modified: 'date modified', size: 'size', name: 'name', type: 'type', folder: 'folder' };
const describeSort = (sort = 'arrived', order) => {
  const asc = (order || (ASC_FIRST.has(sort) ? 'asc' : 'desc')) === 'asc';
  if (sort === 'arrived' || sort === 'modified') return `${SORT_SAY[sort]}, ${asc ? 'oldest' : 'newest'} first`;
  if (sort === 'size') return `size, ${asc ? 'smallest' : 'biggest'} first`;
  return `${SORT_SAY[sort] || sort}${asc ? '' : ' (Z-A)'}`;
};
const what = (p) => (p.ext ? `.${[...extSet(p.ext)].join('/.')} files` : p.kind && p.kind !== 'any' ? `${p.kind} files` : 'files');
const filtersSay = (p) => [p.name && `named "${p.name}"`, p.when && `from ${p.when}`, p.size && `size ${p.size}`].filter(Boolean).join(', ');

// files -> { table, message, data }. table = what the page draws; message = one line; data = compact rows for the AI.
export function browseTable(files, p = {}, root = '', now = Date.now()) {
  const f = makeFilter(p, now);
  if (f.error) return { error: f.error };
  const hits = sortFiles(files.filter(f.test), p.sort, p.order);
  const limit = Math.min(Math.max(1, p.limit || 300), 2000);
  const shown = hits.slice(0, limit);
  const total = hits.reduce((n, x) => n + x.size, 0);
  // Name + date always; size / type / folder only when the user asked (p.show) or the request implies it (sorted or filtered by it).
  const show = new Set(String(p.show || '').split(',').map((s) => s.trim()).filter(Boolean));
  if (p.sort === 'size' || p.size) show.add('size');
  if (p.sort === 'type') show.add('type');
  if (p.sort === 'folder') show.add('folder');
  const columns = ['Name', p.sort === 'modified' ? 'Modified' : 'Arrived', ...(show.has('size') ? ['Size'] : []), ...(show.has('type') ? ['Type'] : []), ...(show.has('folder') ? ['Folder'] : [])];
  const rows = shown.map((x) => [x.name, fmtDate(p.sort === 'modified' ? x.modified : x.arrived), ...(show.has('size') ? [fmtSize(x.size)] : []), ...(show.has('type') ? [x.ext || '-'] : []), ...(show.has('folder') ? [x.rel || '.'] : [])]);
  const extra = filtersSay(p);
  const title = `${shown.length < hits.length ? `${shown.length} of ` : ""}${hits.length} ${what(p)}${extra ? ` ${extra}` : ''} in ${root} · ${fmtSize(total)} · by ${describeSort(p.sort, p.order)}`;
  const message = hits.length ? title : `No ${what(p)}${extra ? ` ${extra}` : ''} in ${root}.`;
  return {
    message,
    table: hits.length ? { title, columns, rows, paths: shown.map((x) => x.path), more: hits.length - shown.length } : null,
    data: shown.slice(0, 60).map((x) => [x.name, fmtDate(p.sort === 'modified' ? x.modified : x.arrived), fmtSize(x.size), x.rel || '.'].join(' | ')).join('\n') + (hits.length > 60 ? `\n…and ${hits.length - 60} more` : ''), // the AI always gets name | date | size | folder, even when the table shows fewer columns
  };
}

// ---- grouping (file_summary): what is in a folder, by kind / ext / month / year / top folder
const GROUP = {
  kind: (f) => f.kind, type: (f) => f.ext || '(none)', ext: (f) => f.ext || '(none)',
  month: (f) => fmtDate(f.arrived).slice(0, 7), year: (f) => fmtDate(f.arrived).slice(0, 4),
  folder: (f) => f.rel.split('\\')[0] || '(top level)',
};
export function summaryTable(files, p = {}, root = '', now = Date.now()) {
  const g = GROUP[p.group] ? p.group : 'kind';
  const f = makeFilter(p, now);
  if (f.error) return { error: f.error };
  const groups = new Map();
  for (const x of files.filter(f.test)) {
    const k = GROUP[g](x);
    const s = groups.get(k) || { n: 0, size: 0, newest: 0 };
    s.n++; s.size += x.size; s.newest = Math.max(s.newest, x.arrived);
    groups.set(k, s);
  }
  const list = [...groups].sort((a, b) => (g === 'month' || g === 'year' ? (a[0] < b[0] ? 1 : -1) : b[1].size - a[1].size));
  const n = list.reduce((a, [, s]) => a + s.n, 0), size = list.reduce((a, [, s]) => a + s.size, 0);
  const label = { kind: 'Kind', type: 'Type', ext: 'Type', month: 'Month', year: 'Year', folder: 'Folder' }[g];
  const title = `${n} ${what(p)} in ${root} · ${fmtSize(size)} · by ${label.toLowerCase()}`;
  const rows = list.map(([k, s]) => [k, String(s.n), fmtSize(s.size), size ? `${Math.round((s.size / size) * 100)}%` : '0%', fmtDate(s.newest).slice(0, 10)]);
  return {
    message: n ? title : `No ${what(p)} in ${root}.`,
    table: n ? { title, columns: [label, 'Files', 'Size', 'Share', 'Newest'], rows, paths: g === 'folder' ? list.map(([k]) => (k === '(top level)' ? root : path.join(root, k))) : null, more: 0 } : null,
    data: rows.slice(0, 40).map((r) => r.join(' | ')).join('\n'),
  };
}

// ---- duplicates: same size first (cheap), then the same sample hash (start + end of the file)
// Files up to 32 MB are hashed whole.
// shortcut: bigger files (videos) compare 64 KB from each end, so two that differ only in the middle would match; hash them whole if that ever matters.
export async function hashSample(file, fsp, createHash, chunk = 65536) {
  const h = createHash('sha1');
  if (file.size <= 32 * 1024 * 1024) return h.update(await fsp.readFile(file.path)).digest('hex');
  const fd = await fsp.open(file.path, 'r');
  try {
    const buf = Buffer.alloc(Math.min(chunk, file.size));
    await fd.read(buf, 0, buf.length, 0); h.update(buf);
    if (file.size > chunk) { await fd.read(buf, 0, buf.length, Math.max(chunk, file.size - chunk)); h.update(buf); }
  } finally { await fd.close(); }
  return h.digest('hex');
}
export async function dupesTable(files, p = {}, root = '', hashOf, now = Date.now()) {
  const f = makeFilter(p, now);
  if (f.error) return { error: f.error };
  const bySize = new Map();
  for (const x of files.filter(f.test)) if (x.size > 0) bySize.set(x.size, [...(bySize.get(x.size) || []), x]);
  const groups = [];
  for (const same of bySize.values()) {
    if (same.length < 2) continue;
    const byHash = new Map();
    for (const x of same) { let h; try { h = await hashOf(x); } catch { continue; } byHash.set(h, [...(byHash.get(h) || []), x]); }
    for (const g of byHash.values()) if (g.length > 1) groups.push(g.sort((a, b) => a.arrived - b.arrived));
  }
  groups.sort((a, b) => b[0].size * (b.length - 1) - a[0].size * (a.length - 1));
  const wasted = groups.reduce((n, g) => n + g[0].size * (g.length - 1), 0);
  const shown = groups.flat();
  const rows = groups.flatMap((g, i) => g.map((x, j) => [`#${i + 1}${j ? '' : ' (oldest)'}`, x.name, fmtSize(x.size), fmtDate(x.arrived), x.rel || '.']));
  const title = `${groups.length} sets of duplicate ${what(p)} in ${root} · ${fmtSize(wasted)} could be freed`;
  return {
    message: groups.length ? title : `No duplicate ${what(p)} in ${root}.`,
    table: groups.length ? { title, columns: ['Set', 'Name', 'Size', 'Arrived', 'Folder'], rows, paths: shown.map((x) => x.path), more: 0 } : null,
    data: rows.slice(0, 60).map((r) => r.join(' | ')).join('\n'),
  };
}

