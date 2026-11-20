// The catalog: everything on this PC that can be opened, in one list ("know my PC"). Pure code (no node imports).
// Stage 2 only KNOWS things: apps, Chrome apps, Store apps, installed programs, bookmarks, recent files and folders.
// Stage 3 will score these against a sentence. Nothing in here is a hard-coded list of app names: names, aliases and
// what counts as "generic" all come from the PC itself.

export const KINDS = ['app', 'pwa', 'store', 'program', 'site', 'file', 'folder'];

export const norm = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokensOf = (s) => norm(s).split(' ').filter(Boolean);
const isVersion = (t) => /^v?\d+([.]\d+)*$/.test(t) || /^x(64|86)$/.test(t);

// The id is the same every scan, so uses and last-used survive a rescan.
export const idOf = (kind, launchKey) => `${kind}:${String(launchKey ?? '').toLowerCase()}`;

/**
 * Other ways a person says the same name, derived from the name itself and from how common each word is across the whole PC:
 * "Visual Studio Code" -> visual studio code, visualstudiocode, vsc, studio?, code? (a word is only an alias when it is rare
 * enough to point at ONE thing: "microsoft" or "app" appear everywhere, so they never become aliases).
 */
export function deriveAliases(name, df = {}, total = 1) {
  const full = norm(name.replace(/\([^)]*\)/g, ' '));
  const toks = tokensOf(full).filter((t) => !isVersion(t));
  const out = new Set();
  if (toks.length) out.add(toks.join(' '));
  if (toks.length > 1) out.add(toks.join('')); // "visualstudiocode"
  if (toks.length > 1) { const ac = toks.map((t) => t[0]).join(''); if (ac.length >= 2) out.add(ac); } // "vsc"
  // "visual studio code" -> "vs code" / "vscode": initials of the first words + the rest
  for (let k = 2; k < toks.length; k++) { const head = toks.slice(0, k).map((t) => t[0]).join(''), rest = toks.slice(k); out.add([head, ...rest].join(' ')); out.add([head, ...rest].join('')); }
  // "microsoft power point" -> "power point" / "powerpoint": leading words that are common on this PC are the maker's name, not the app's
  const common = (t) => (df[t] ?? 0) > Math.max(2, Math.floor(total * 0.01));
  for (let k = 1; k < toks.length - 0 && common(toks[k - 1]); k++) { const rest = toks.slice(k); if (rest.join('').length >= 3) { out.add(rest.join(' ')); out.add(rest.join('')); } }
  const rare = (t) => t.length >= 3 && (df[t] ?? 1) <= Math.max(2, Math.floor(total * 0.01));
  for (const t of toks) if (toks.length > 1 && rare(t)) out.add(t);
  out.delete(full === toks.join(' ') ? '' : '');
  return [...out].filter(Boolean);
}

// How many catalog entries each word appears in (the "how common is this word" table).
export function wordFrequency(entries) {
  const df = {};
  for (const e of entries) for (const t of new Set(tokensOf(e.name))) df[t] = (df[t] || 0) + 1;
  return df;
}

/** Turn raw scanner items into entries. item: { kind, name, launch, meta?, source } where launch = { type, target, args?, url?, browser?, profile? }. */
export function buildEntries(items) {
  const seen = new Map();
  for (const it of items) {
    if (!it?.name || !it.launch || !KINDS.includes(it.kind)) continue;
    const launchKey = it.launch.url || (it.launch.args ? `${it.launch.target} ${it.launch.args}` : it.launch.target);
    const id = idOf(it.kind, it.launch.profile ? `${launchKey}#${it.launch.profile}` : launchKey);
    if (!seen.has(id)) seen.set(id, { id, kind: it.kind, name: String(it.name).trim(), key: norm(it.name), launch: it.launch, meta: it.meta || {}, source: it.source || it.kind });
  }
  const list = [...seen.values()];
  const df = wordFrequency(list);
  for (const e of list) e.aliases = deriveAliases(e.name, df, list.length);
  return list;
}

/**
 * Merge a fresh scan into what is stored. Keeps uses / last_used / first_seen / label. An entry that a scanner no longer
 * sees is only removed after `grace` scans in a row (one slow or failed scan must not wipe your apps), and only judged
 * for sources that actually ran (ranSources).
 */
export function mergeScan(existing, scanned, now, ranSources, grace = 2) {
  const old = new Map(existing.map((e) => [e.id, e]));
  const fresh = new Map(scanned.map((e) => [e.id, e]));
  const upserts = [], removes = [];
  for (const e of scanned) {
    const o = old.get(e.id);
    upserts.push({ ...e, uses: o?.uses ?? 0, last_used: o?.last_used ?? 0, first_seen: o?.first_seen ?? now, last_seen: now, misses: 0, label: o?.label ?? '', label_hash: o?.label_hash ?? '' });
  }
  for (const o of existing) {
    if (fresh.has(o.id) || !ranSources.has(o.source)) continue;
    if ((o.misses ?? 0) + 1 >= grace) removes.push(o.id); else upserts.push({ ...o, misses: (o.misses ?? 0) + 1 });
  }
  return { upserts, removes };
}

export function summary(entries) {
  const byKind = {};
  for (const e of entries) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  return { total: entries.length, byKind, used: entries.filter((e) => e.uses > 0).length };
}

// ---- retrieval: a cheap first filter (letter triples + words). Stage 3 does the real scoring on what this returns. ----
const grams = (s) => { const t = ` ${norm(s)} `; const g = new Set(); for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3)); return g; };
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };

export function candidates(entries, text, { limit = 10, kinds = null } = {}) {
  const q = norm(text);
  if (!q) return [];
  const qg = grams(q), qt = q.split(' ');
  const rows = [];
  for (const e of entries) {
    if (kinds && !kinds.includes(e.kind)) continue;
    let best = 0;
    for (const n of [e.key, ...(e.aliases || [])]) {
      let s = n === q ? 1 : jaccard(qg, grams(n));
      if (n.startsWith(q) || q.startsWith(n)) s = Math.max(s, 0.8 + 0.2 * Math.min(q.length, n.length) / Math.max(q.length, n.length));
      if (qt.every((t) => n.split(' ').some((w) => w.startsWith(t)))) s = Math.max(s, 0.75);
      best = Math.max(best, s);
    }
    if (best >= 0.25) rows.push({ entry: e, sim: Number(best.toFixed(3)) });
  }
  return rows.sort((a, b) => b.sim - a.sim || (b.entry.uses || 0) - (a.entry.uses || 0)).slice(0, limit);
}
