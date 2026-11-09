// Fast providers (Groq…) only take prompts under FAST_CAP chars (main.js). When the history is just over it, shrink old
// step results and replies so the call still goes to Groq (seconds) instead of the slow free models (up to a minute).
export const FAST_CAP = 18000;
export function fitFast(history, keep = [], cap = FAST_CAP, cut = 600) {
  const size = () => JSON.stringify(history).length;
  // never the system prompt, a task the user typed, or the newest message
  for (let i = 1; i < history.length - 1 && size() >= cap; i++) {
    if (keep.includes(i) || history[i].content.length <= cut) continue;
    history[i] = { ...history[i], content: `${history[i].content.slice(0, cut)}\n…(cut)` };
  }
  return history;
}
