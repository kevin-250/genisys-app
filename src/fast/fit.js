// Fast providers (Groq…) only take prompts under FAST_CAP chars (main.js). When the history is just over it, shrink old
// step results and replies so the call still goes to Groq (seconds) instead of the slow free models (up to a minute).
export const FAST_CAP = 18000;
export function fitFast(history, keep = [], cap = FAST_CAP, cut = 600) {
  const size = () => JSON.stringify(history).length;
  // The newest step results and reply stay whole: a short answer ("yes", "ep1") needs the paths found just before it.
  const recent = new Set();
  for (let i = history.length - 1, users = 0, bots = 0; i > 0; i--) {
    if (keep.includes(i)) continue;
    if (history[i].role === 'user' && users < 1) { recent.add(i); users++; }
    if (history[i].role === 'assistant' && bots < 1) { recent.add(i); bots++; }
  }
  // never the system prompt, a task the user typed, the newest message, or the recent results above; oldest first
  for (let i = 1; i < history.length - 1 && size() >= cap; i++) {
    if (keep.includes(i) || recent.has(i) || history[i].content.length <= cut) continue;
    history[i] = { ...history[i], content: `${history[i].content.slice(0, cut)}\n…(cut)` };
  }
  // still too big: the recent ones too, but keeping more (best matches are listed first)
  for (const i of recent) if (size() >= cap && history[i].content.length > cut * 4) history[i] = { ...history[i], content: `${history[i].content.slice(0, cut * 4)}\n…(cut)` };
  return history;
}

// Numbers in the request pick between near-identical names: "ep 1" -> S01E01 (not S01E02 or S02E01), "v2" -> report v2,
// "2024" -> invoice 2024. Among close matches holding every requested number, the one with the fewest OTHER numbers wins.
const nums = (t) => (String(t).match(/\d+/g) || []).map(Number);
export function byNumbers(query, matches, near = 0.08) {
  const want = new Set(nums(query));
  if (!want.size || matches.length < 2) return matches;
  const top = matches[0].score;
  const rank = matches.map((m) => {
    const have = nums(m.path.split(/[\\/]/).pop());
    const ok = top - m.score < near && [...want].every((n) => have.includes(n));
    return { m, ok, extra: have.filter((n) => !want.has(n)).length };
  });
  const fit = rank.filter((r) => r.ok);
  if (!fit.length) return matches;
  // fewest other numbers, then the lowest ones: "ep 3" with no season -> S01E03 before S02E03 (the natural default)
  const sum = (r) => nums(r.m.path.split(/[\\/]/).pop()).filter((n) => !want.has(n)).reduce((a, n) => a + n, 0);
  const least = Math.min(...fit.map((r) => r.extra));
  const low = Math.min(...fit.filter((r) => r.extra === least).map(sum));
  const best = fit.filter((r) => r.extra === least && sum(r) === low);
  if (best.length !== 1) return [...best.map((r) => r.m), ...matches.filter((m) => !best.some((r) => r.m === m))]; // still a tie
  // one clear winner: put it first with a score that beats the rest by the "clear" margin
  return [{ ...best[0].m, score: top }, ...matches.filter((m) => m !== best[0].m).map((m) => ({ ...m, score: Math.min(m.score, +(top - near - 0.01).toFixed(3)) }))];
}

// Removes the "USER FOLDER MAP" block that main.js 'context' adds for file tasks (keeps the matching files).
export const dropFolderMap = (s) => s.replace(/\nUSER FOLDER MAP \(folder names only\):\n[\s\S]*?(?=\nMATCHING THIS TASK:|\n\nOPEN IN THE EDITOR|$)/, '');
