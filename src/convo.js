// Conversation memory: what you asked in this window and what Genisys did, so "how large is it" / "open that one" / "again" work.
// Pure code (no DOM, no database): the page keeps one of these per window, saves every turn to the database (db.js: convo table)
// and reloads the recent ones when the window opens. Both the AI router and the full AI get prompt() as context.
const MAX_TURNS = 12;
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// A table result's compact lines ("name | date | size") + the full paths of the shown rows -> [{ text, path }]
export function rowsFrom(data = '', paths = [], n = 10) {
  return String(data).split('\n').filter((l) => l && !l.startsWith('…')).slice(0, n).map((text, i) => ({ text: clip(text, 160), path: paths[i] ? String(paths[i]) : '' }));
}

// "delete them / those / these / it / all of them": a delete that points at what was just listed, no names in it.
export const DELETE_REF = /^(?:please\s+|pls\s+|now\s+)?(?:delete|remove|trash|bin|get rid of|erase)\s+(?:(?:all\s+)?(?:of\s+)?(?:them|those|these|it|that|this)(?:\s+(?:all|now|please|pls|too|again|ones|files?|zips?|items?))?)[.!\s]*$/i;

export function normalizeTurn(t = {}) {
  return {
    ts: Number(t.ts) || Date.now(),
    task: clip(t.task, 300),
    route: String(t.route || ''),
    action: String(t.action || ''),
    params: t.params && typeof t.params === 'object' ? t.params : {},
    say: clip(t.say, 300),
    n: Number.isFinite(t.n) ? t.n : 0, // rows the listing really had (rows below keeps at most 10)
    rows: Array.isArray(t.rows) ? t.rows.slice(0, 10).map((r) => ({ text: clip(r.text, 160), path: r.path ? String(r.path) : '' })) : [],
  };
}

export function makeConvo(initial = [], max = MAX_TURNS) {
  let turns = initial.map(normalizeTurn).filter((t) => t.task).slice(-max);
  return {
    all: () => turns.slice(),
    last: () => turns[turns.length - 1] || null,
    size: () => turns.length,
    add(t) { const n = normalizeTurn(t); if (!n.task) return null; turns = [...turns, n].slice(-max); return n; },
    load(rows) { turns = rows.map(normalizeTurn).filter((t) => t.task).slice(-max); },
    clear() { turns = []; },
    // true when params point at something listed in this chat (a path or file name from the rows): such an answer belongs to THIS
    // conversation, so it must never be cached for the same words later ("how large is it" is a different file next time).
    dependsOn(params = {}) {
      const vals = Object.values(params ?? {}).filter((v) => typeof v === 'string' && v.length >= 4).map((v) => v.toLowerCase());
      return turns.some((t) => t.rows.some((r) => {
        const name = r.text.split(' | ')[0].trim().toLowerCase(), path = (r.path || '').toLowerCase();
        return vals.some((v) => (name.length >= 4 && (name.includes(v) || v.includes(name))) || (path && v.includes(path)));
      }));
    },
    // The turn that "them / those / it" means: the most recent one that listed rows. Never an older one.
    latestListing() { for (let i = turns.length - 1; i >= 0; i--) if (turns[i].rows.length) return turns[i]; return null; },
    // "delete them" -> exactly the paths of the latest listing, or null when it is not a plain reference or not safe to do in code
    // (no listing, a row without a path, or a listing longer than what was kept: then the AI asks which ones).
    deleteRef(task) {
      if (!DELETE_REF.test(String(task || '').trim())) return null;
      const t = this.latestListing();
      if (!t || t.rows.some((r) => !r.path) || (t.n && t.n > t.rows.length)) return null;
      return { turn: t, paths: t.rows.map((r) => r.path), names: t.rows.map((r) => r.text.split(' | ')[0]) };
    },
    // Text for a model. skipRoutes: turns the model already has some other way (the full AI keeps its own chat history).
    // Only the last 2 turns list their rows; older ones are one line each. Oldest turns are dropped first to fit maxChars.
    prompt({ maxChars = 3500, skipRoutes = [] } = {}) {
      const use = turns.filter((t) => !skipRoutes.includes(t.route));
      if (!use.length) return '';
      const head = 'CONVERSATION SO FAR in this window, oldest first. Words like "it", "that", "those", "the first one", "the same", "again", "how big is it" refer to what is listed here: use the exact names and paths below, and do not ask which one when it is clear. Turns are in time order: the LAST turn is the newest, and what it lists is what exists now. A listing that appears after a delete proves those items exist; never say they are already deleted.';
      const latest = this.latestListing();
      const block = (t, i, withRows) => {
        const p = Object.keys(t.params).length ? ` ${JSON.stringify(t.params)}` : '';
        const lines = [`${i + 1}. user: "${t.task}"${t === latest ? '   <== MOST RECENT LISTING: "them / those / these / it / all of them" mean exactly its rows' : ''}`, `   genisys: ${t.action || 'answered'}${p}${t.say ? ` -> ${t.say}` : ''}`];
        if (withRows && t.rows.length) { lines.push('   rows:'); for (const r of t.rows) lines.push(`   - ${r.text}${r.path ? ` (path: ${r.path})` : ''}`); }
        return lines.join('\n');
      };
      const blocks = use.map((t, i) => block(t, i, i >= use.length - 2 || t === latest)); // the latest listing always keeps its rows
      let out = blocks;
      while (out.length > 1 && head.length + out.join('\n').length > maxChars) out = out.slice(1);
      return `${head}\n${out.join('\n')}`;
    },
  };
}
