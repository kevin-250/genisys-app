// Typo-tolerant name matching: "freegut" ≈ "Free.Guy.(NKIRI.COM)2021.mkv".
const norm = (s) => s.toLowerCase().replace(/\.[a-z0-9]{1,5}$/, '').replace(/[^a-z0-9]+/g, '');
const bigrams = (s) => { const out = new Set(); for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2)); return out; };

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
