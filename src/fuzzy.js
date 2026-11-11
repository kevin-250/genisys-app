// Typo-tolerant name matching: "freegut" ≈ "Free.Guy.(NKIRI.COM)2021.mkv".
const norm = (s) => s.toLowerCase().replace(/\.[a-z0-9]{1,5}$/, '').replace(/[^a-z0-9]+/g, '');
const bigrams = (s) => { const out = new Set(); for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2)); return out; };

// Typos counted like a person would: a missing, extra or wrong letter, or two letters swapped ("recieve"), is one edit.
// Stops early once it is over `max`. (Damerau / optimal string alignment distance.)
export function editDist(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let p2 = null, p = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const c = [i]; let low = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
      c[j] = v; if (v < low) low = v;
    }
    if (low > max) return max + 1;
    p2 = p; p = c;
  }
  return p[b.length];
}
const allowedEdits = (w) => (w.length <= 3 ? 0 : w.length <= 6 ? 1 : 2);
// For the file search: build once per query, then score each name (0 = no match). A cheap letter-pair check first
// (numbers, no strings), so a whole-PC index is scanned quickly; only likely names get the word-by-word typo check.
// squashed = the name lowercased with only letters and digits ("resume2026pdf"); name = the original name.
export function typoMatcher(words) {
  const joined = words.join('');
  const qb = new Set();
  for (let i = 0; i < joined.length - 1; i++) qb.add(joined.charCodeAt(i) * 65536 + joined.charCodeAt(i + 1));
  const need = Math.max(1, Math.ceil(qb.size * 0.4));
  const seen = new Set();
  return (squashed, name) => {
    seen.clear();
    let hit = 0;
    for (let i = 0; i < squashed.length - 1; i++) {
      const b = squashed.charCodeAt(i) * 65536 + squashed.charCodeAt(i + 1);
      if (qb.has(b) && !seen.has(b)) { seen.add(b); hit++; }
    }
    if (hit < need) return 0;
    const tokens = name.toLowerCase().replace(/\.[a-z0-9]{1,5}$/, '').split(/[^a-z0-9]+/).filter(Boolean);
    let edits = 0;
    const each = words.every((w) => {
      if (squashed.includes(w)) return true;
      const max = allowedEdits(w);
      let best = max + 1;
      for (const t of tokens) { // whole word, or the start of a longer one ("resme" ~ "resume2026")
        for (let L = Math.max(1, w.length - max); L <= Math.min(t.length, w.length + max) && best; L++) best = Math.min(best, editDist(w, t.slice(0, L), max));
        if (!best) break;
      }
      edits += best;
      return best <= max;
    });
    const share = hit / qb.size;
    return Math.max(each ? 0.9 - 0.04 * edits : 0, share >= 0.75 ? share * 0.85 : 0); // second: run-together words ("freegut")
  };
}

// 0..1: 1 when every query word appears in the name, else the share of the query's letter pairs found in it.
export function fuzzy(query, name) {
  const n = norm(name);
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  if (!n || !words.length) return 0;
  if (words.every((w) => n.includes(w)) || n.includes(words.join(''))) return 1;
  const q = bigrams(words.join(''));
  if (!q.size) return 0;
  const nb = bigrams(n);
  let hit = 0;
  for (const b of q) if (nb.has(b)) hit++;
  return hit / q.size;
}
