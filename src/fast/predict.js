// The predictor: score every catalog entry for what the person typed, take the best one. Pure code.
// score = nameMatch * (0.7 + 0.3 * prior). nameMatch (0..1) survives typos; prior (0..1) = what kind of thing it is, how much YOU
// use it, how recently, whether it is a favorite, whether the conversation just mentioned it. No app names live in this file.
import { norm } from './catalog.js';
import { labelOf } from './label.js';

export const DO_MIN = 0.62;    // top score needed to act without asking
export const LEAD = 0.12;      // ...and how far ahead of the best DIFFERENT thing it must be
export const LEAD_EXACT = 0.05; // an exact name only needs a small lead over a longer variant ("Spotify" vs "Spotify Beta")
export const ASK_MIN = 0.45;   // between ASK_MIN and DO_MIN (or a close race) -> show a choose card

// Base "how likely is this kind to be what 'open X' means"; real usage (below) shifts it. Kinds, not names.
const KIND_BASE = { app: 1, pwa: 1, store: 1, program: 0.55, site: 0.45, folder: 0.5, file: 0.5 };
// Words that mark helper/installer entries. Generic software words, not app names.
const NOISE = /\b(uninstall\w*|installer|setup|updater?|update|repair|redistributable|crash\w*|readme|helper|runtime|sdk|driver\w*)\b/;

// Edit distance where swapping two neighbouring letters ("paitn" for "paint") costs ONE edit, as a typo really does.
export function lev(a, b, cap = 99) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return Infinity;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length] > cap ? Infinity : d[a.length][b.length];
}
// Sounds-alike key: first letter + consonants, doubles collapsed ("spotfy" and "spotify" -> "sptfy").
export const skeleton = (w) => { const s = String(w).replace(/ph/g, 'f').replace(/ck|q/g, 'k').replace(/[^a-z0-9]/g, ''); return s[0] ? s[0] + s.slice(1).replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1') : ''; };
const grams = (s) => { const t = ` ${s} `; const g = new Set(); for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3)); return g; };
const jac = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };

// One query word against one name word: 1 exact, a bit less for prefix / sounds-alike / small typo.
function wordSim(q, w) {
  if (q === w) return 1;
  if (q.length >= 3 && w.startsWith(q)) return 0.8 + 0.15 * (q.length / w.length);
  const d = lev(q, w, 3), m = Math.max(q.length, w.length);
  let s = m >= 4 ? Math.max(0, 1 - d / m) : 0;                      // "spotfy"~"spotify": 1 edit of 7
  if (m >= 4 && d <= Math.floor(m / 3)) s = Math.max(s, 0.85 - 0.1 * (d - 1 < 0 ? 0 : d - 1));
  if (q.length >= 4 && skeleton(q) === skeleton(w)) s = Math.max(s, 0.85);
  if (q.length >= 5 && w.length >= 5) s = Math.max(s, jac(grams(q), grams(w)) * 1.1);
  return Math.min(1, s);
}

export function nameMatch(query, form) {
  const q = norm(query), n = norm(form);
  if (!q || !n) return 0;
  if (q === n) return 1;
  const qt = q.split(' '), nt = n.split(' ');
  const per = qt.map((t) => Math.max(...nt.map((w) => wordSim(t, w))));
  const cover = per.reduce((a, b) => a + b, 0) / qt.length;          // how well every query word is found
  const used = nt.filter((w) => qt.some((t) => wordSim(t, w) >= 0.8)).length / nt.length; // how much of the name the query explains
  let s = cover * (0.8 + 0.2 * used);
  const joined = qt.join(''), nj = nt.join('');
  if (qt.length === 1 && nt.length > 1) s = Math.max(s, wordSim(joined, nj) * 0.95);   // "visualstudiocode"
  if (qt.length > 1) s = Math.max(s, wordSim(joined, nj));                              // "kevin cv" ~ "kevincv"
  return Math.min(1, s);
}

/** ctx: { prefs, now, mentioned: [normalized names the conversation just used] } */
export function prior(e, ctx, maxUses, kindUses, kindTotal) {
  const learned = kindTotal > 0 ? (kindUses[e.kind] || 0) / kindTotal : 0;               // share of YOUR opens that were this kind
  const kind = Math.min(1, 0.7 * (KIND_BASE[e.kind] ?? 0.4) + 0.3 * learned + (learned > 0.5 ? 0.1 : 0));
  const use = maxUses > 0 ? Math.log1p(e.uses || 0) / Math.log1p(maxUses) : 0;
  const days = e.last_used ? ((ctx.now || Date.now()) - e.last_used) / 86400000 : 999;
  const recent = days < 30 ? 1 - days / 30 : 0;
  const named = (list) => { const l = list.map((v) => norm(v)); return [e.key, ...(e.aliases || [])].some((f) => l.includes(f)); };
  const fav = named(Object.entries(ctx.prefs || {}).filter(([k]) => k.startsWith('fav:')).map(([, v]) => v)) ? 1 : 0;
  const said = named(ctx.mentioned || []) ? 1 : 0;
  const p = 0.4 * kind + 0.25 * use + 0.1 * recent + 0.15 * fav + 0.1 * said;
  return { p: Math.min(1, p / 0.8), kind, use, recent, fav, said };      // 0.8 = what a normal, somewhat-used app reaches
}

export function predict(entries, text, ctx = {}, { kinds = null, limit = 8, exclude = [] } = {}) {
  const q = norm(text);
  if (!q) return { decision: 'none', ranked: [] };
  const pool = entries.filter((e) => (!kinds || kinds.includes(e.kind)) && !exclude.includes(e.id) && !(e.kind === 'program' && e.launch?.type === 'none'));
  const maxUses = Math.max(0, ...pool.map((e) => e.uses || 0));
  const kindUses = {}; let kindTotal = 0;
  for (const e of entries) if (e.uses) { kindUses[e.kind] = (kindUses[e.kind] || 0) + e.uses; kindTotal += e.uses; }
  const rows = [];
  for (const e of pool) {
    const lab = labelOf(e);   // what the model said about this app (Stage 4): other names, and its kind of app
    let nm = Math.max(nameMatch(q, e.key), ...[...(e.aliases || []), ...(lab?.aliases || [])].map((f) => nameMatch(q, f)), lab?.cat && q === lab.cat ? 0.7 : 0); // the full name beats a derived short name ("Spotify" vs "Spotify Beta")
    const lr = ctx.learned?.[`${q}|${e.id}`];                         // Stage 5: this exact request was opened as this entry before
    if (lr?.wins) nm = Math.max(nm, lr.wins >= 3 ? 1 : 0.9);
    if (nm < 0.4) continue;
    const pr = prior(e, ctx, maxUses, kindUses, kindTotal);
    let score = nm * (0.7 + 0.3 * pr.p);
    if (e.key === q || e.key.replace(/ /g, '') === q.replace(/ /g, '')) score += 0.06; // the full name beats a derived short name ("Spotify" vs "Spotify Beta")
    if (lr?.losses) score *= 0.6 ** Math.min(lr.losses, 3);          // you said "no, the other one" for this request
    if (NOISE.test(e.key) && !NOISE.test(q)) score *= 0.6;            // "Spotify Uninstaller" is not "spotify"
    rows.push({ entry: e, name: Number(nm.toFixed(3)), prior: Number(pr.p.toFixed(3)), score: Number(score.toFixed(3)) });
  }
  rows.sort((a, b) => b.score - a.score || (b.entry.uses || 0) - (a.entry.uses || 0));
  const ranked = rows.slice(0, limit);
  const mass = ranked.reduce((a, r) => a + r.score ** 4, 0) || 1;
  for (const r of ranked) r.p = Number((r.score ** 4 / mass).toFixed(3));
  const top = ranked[0];
  if (!top || top.score < ASK_MIN) return { decision: 'none', ranked };
  // the same real-world thing under another kind (Spotify app + Spotify bookmark) is not a rival
  const rival = ranked.find((r) => r.entry.key !== top.entry.key && !(top.entry.aliases || []).includes(r.entry.key) && r.entry.key !== top.entry.key);
  const gap = top.score - (rival ? rival.score : 0);
  if (top.score >= DO_MIN && gap >= (top.name === 1 ? LEAD_EXACT : LEAD)) return { decision: 'do', pick: top, ranked };
  const picks = []; const seen = new Set();
  for (const r of ranked) { if (seen.has(r.entry.key) || r.score < Math.max(ASK_MIN, top.score * 0.6)) continue; seen.add(r.entry.key); picks.push(r); if (picks.length === 3) break; }
  return { decision: 'choose', picks, ranked };
}
