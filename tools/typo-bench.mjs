// How well Genisys survives typos. Takes every request it understands (Siri-style phrases + your own past chats when the
// database is there), misspells one word the way people do, and checks the result is understood EXACTLY like the clean one.
// Usage: node tools/typo-bench.mjs [more-requests.txt]    (prints the score and the failures)
import fs from 'node:fs';
import { parseIntent, parseCore, FAST_MIN } from '../src/fast/intent.js';
import { SIRI } from './siri-check.mjs';

const corpus = new Set(SIRI);
try {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(`${process.env.APPDATA}/Executor/executor.db`, { readOnly: true });
  for (const r of db.prepare('SELECT DISTINCT task FROM convo').all()) corpus.add(r.task);
} catch { /* no database on this machine: Siri phrases only */ }
if (process.argv[2]) for (const l of fs.readFileSync(process.argv[2], 'utf8').split('\n')) if (l.trim()) corpus.add(l.trim());

// only requests the fast path understands without typos (the AI gets the rest anyway)
// times made from "now" (reminders in 30 minutes) differ by a few ms between two reads: that is the same answer
// a calculation keeps the sentence as typed in "what" (shown as the card title): the answer is what must match
const key = (x) => JSON.stringify(x.params, (k, v) => (k === 'at' ? Math.round(v / 60000) : k === 'what' && x.params.op === 'calc' ? undefined : v));
const same = (x, y) => x.action === y.action && key(x) === key(y);
const base = [...corpus].map((q) => ({ q, r: parseCore(q) })).filter((x) => x.r.action !== 'unknown' && x.r.confidence >= FAST_MIN);

let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const nb = (c) => { for (let y = 0; y < 3; y++) { const x = ROWS[y].indexOf(c); if (x >= 0) { const o = [ROWS[y][x - 1], ROWS[y][x + 1], ROWS[y - 1]?.[x], ROWS[y + 1]?.[x]].filter(Boolean); return o[Math.floor(rnd() * o.length)]; } } return c; };
const OPS = {
  neighbour: (w, i) => w.slice(0, i) + nb(w[i]) + w.slice(i + 1),
  missing: (w, i) => w.slice(0, i) + w.slice(i + 1),
  extra: (w, i) => w.slice(0, i + 1) + nb(w[i]) + w.slice(i + 1),
  swapped: (w, i) => (i < w.length - 1 ? w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2) : w),
  doubled: (w, i) => w.slice(0, i + 1) + w[i] + w.slice(i + 1),
};

// 1) clean requests must not change (no "fixing" what was right)
const broken = base.filter((x) => !same(parseIntent(x.q), x.r));
// 2) one typo in a command word (the words Genisys listens for) / 3) in any word
const vocabWords = new Set(); for (const x of base) for (const w of x.q.toLowerCase().match(/[a-z]+/g) || []) vocabWords.add(w);
let ok = 0, n = 0, okAny = 0, nAny = 0; const fails = [];
for (const { q, r } of base) {
  const words = [...q.matchAll(/[A-Za-z]{4,}/g)];
  for (const m of words) for (const [op, f] of Object.entries(OPS)) {
    const i = 1 + Math.floor(rnd() * (m[0].length - 1)); // the first letter is rarely the typo
    const typo = f(m[0].toLowerCase(), i);
    if (typo === m[0].toLowerCase()) continue;
    const t = q.slice(0, m.index) + typo + q.slice(m.index + m[0].length);
    const good = same(parseIntent(t), r);
    // a command word = one that changes what the request does when it is missing ("timer"), not the user's own text ("bread")
    // the user's own words (a reminder's text, a timer's name, a search): a typo there stays, as typed
    const own = ['text', 'label', 'query', 'q', 'title', 'place'].some((k) => typeof r.params[k] === 'string' && r.params[k].toLowerCase().includes(m[0].toLowerCase()));
    const cmd = !own;
    nAny++; if (good) okAny++;
    if (cmd) { n++; if (good) ok++; else if (fails.length < 60) fails.push(`${op.padEnd(9)} ${t}  ->  ${parseIntent(t).action}`); }
  }
}
console.log(`requests understood without typos: ${base.length}`);
console.log(`clean requests changed by the fixer: ${broken.length}${broken.length ? `\n  ${broken.map((x) => x.q).join('\n  ')}` : ''}`);
console.log(`one typo in a command word: ${ok}/${n} = ${(100 * ok / n).toFixed(1)}% understood exactly as without the typo`);
console.log(`one typo in any word (incl. names / note text): ${okAny}/${nAny} = ${(100 * okAny / nAny).toFixed(1)}%`);
console.log(`\nfailures (first ${fails.length}):\n  ${fails.join('\n  ')}`);
