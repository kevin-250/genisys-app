// Stage 2: turn what the user typed into a clean, comparable string. Pure code, no model.
// "Please can you open the movie Mousetrap (2019)!"  ->  "open movie mousetrap"

const PHRASES = [
  /\b(?:can|could|would|will) you(?: please)?\b/g,
  /\bi (?:want|need|would like|wanna|d like) (?:you )?to\b/g,
  /\bi (?:want|need|wanna)\b/g,
  /\b(?:please|pls|plz|kindly|genisys)\b/g,
  /^\s*(?:hey|hi|hello|ok|okay)\b[,\s]*/g,       // greetings only at the start ("ok go lyrics" keeps its "ok")
  /\s+(?:now|quickly|thanks|thank you)\s*$/g,      // and closers only at the end
  /\s+for me\b(?=\s*$)/g,
];
const FILLER = new Set(['the', 'my', 'a', 'an', 'me', 'some']);
const YEAR = /^(?:19|20)\d\d$/;

// Punctuation becomes a space, except the characters that live inside file names, paths and URLs.
// { keepAll: true } keeps filler words and years: used for search queries, which must reach the search engine word for word.
export function normalize(text, { keepAll = false } = {}) {
  let s = String(text ?? '').toLowerCase().replace(/[‘’“”]/g, "'");
  s = s.replace(/'s\b/g, 's').replace(/['"`]/g, ' ');
  for (const re of PHRASES) s = s.replace(re, ' ');
  s = s.replace(/[^\p{L}\p{N}\s.:/\\_+@%~#?=&-]/gu, ' ');
  let words = s.split(/\s+/).map((w) => w.replace(/^[.,:;!?-]+|[.,:;!?-]+$/g, '')).filter(Boolean);
  if (!keepAll) {
    words = words.filter((w) => !FILLER.has(w));
    const noYears = words.filter((w) => !YEAR.test(w));
    if (noYears.length) words = noYears; // "2024" alone is a real query, so only drop years when something else remains
  }
  return words.join(' ');
}

export const tokens = (text) => normalize(text).split(' ').filter(Boolean);

// Optimal-string-alignment distance (counts a swapped pair like "opne" as ONE typo).
export function typoDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
