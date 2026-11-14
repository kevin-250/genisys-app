// Stage 6: the AI router. One tiny prompt (action list + the command), one tiny JSON answer, all checked in code.
import { validateParams } from './registry.js';

export const PSEUDO = {
  script: 'one simple PC task that no action above can do (needs a PowerShell script)',
  old: 'a question, chat, web research, or a task with several steps',
  unknown: 'nothing fits or the request is unclear',
};

// Extra rules for requests about the user's files: the model must turn EVERY condition in the sentence into a param.
export function fileRules(now = new Date()) {
  const pad = (x) => String(x).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
  return `File requests (today is ${day} ${today}). browse_files lists ANY kind of file (movies, photos, documents, music, zips, code...), not only movies, and it does the sorting, newest/oldest, top-N and counting itself: for file requests those words are NOT a reason to answer old. Read the WHOLE sentence and turn EVERY condition into a param; never drop one, never invent one the user did not say:
- what: kind (video|audio|image|document|archive|program|code) or ext ("pdf,docx"); words in the file name -> name; where -> in.
- dates -> when: "today", "yesterday", "last week", "october", "2025", "last 30 days", "older than 6 months", "since 2026-10-01", "before 2026-01-01", one day "2026-11-05", or a range "2026-10-01 to 2026-10-31". Work out relative days from today.
- size -> size: "over 500mb", "under 10mb", "between 100mb and 1gb". A size word with no number: large/big/huge/heavy -> sort size, order desc; small/tiny/light -> sort size, order asc.
- order: oldest/old -> sort arrived, order asc; newest/latest/recent -> sort arrived, order desc; "modified/edited" -> sort modified; "a-z" -> sort name.
- count: "only 10", "just 5", "top 3", "the 3 oldest" -> limit (a few = 5; with no number and no wish for everything, a "large/biggest" list is limit 20).
- extra columns the user asked for (size, where they are, type) -> show.
If a condition cannot be expressed with these params, answer {"action":"old"} so the full AI handles it.
Examples:
"spreadsheets over 2mb since september" -> {"action":"browse_files","params":{"ext":"xlsx,xls,csv","size":"over 2mb","when":"since 2026-09-01"}}
"my lightest videos" -> {"action":"browse_files","params":{"kind":"video","sort":"size","order":"asc","limit":20}}
"archives older than 3 months, newest first" -> {"action":"browse_files","params":{"kind":"archive","when":"older than 3 months","sort":"arrived","order":"desc"}}
"sounds added from 2 to 9 october, only 5" -> {"action":"browse_files","params":{"kind":"audio","when":"2026-10-02 to 2026-10-09","limit":5}}`;
}

// "how large is it" / "open that one" / "the first one": the words point at a row of the conversation, so this beats the rule about details left out.
export const REFERENCE_RULE = 'REFERENCES: if the command says it / that / this / those / the first one / the same / again, it means a row listed under CONVERSATION SO FAR. Use that row\'s exact path: file_info for its size, dates or location ("how large is it"), open_path or open_file to open it. Never answer old or unknown only because the user said "it". If the conversation does not show what it refers to, answer old.';

export function buildRouterMessages(lines, command, folders = '', extra = '') {
  const pseudo = Object.entries(PSEUDO).map(([k, v]) => `${k}() - ${v}`);
  return [
    { role: 'system', content: `You route a Windows PC command to ONE action. Reply with ONLY JSON: {"action":"<name>","params":{...}} or {"action":"unknown"}. No other text.\nActions:\n${[...lines, ...pseudo].join('\n')}\nRules: use the exact action and param names. Paths must be full Windows paths. Never invent a path or link; if unsure answer unknown. Never fill in a detail the user left out (which season, which of several files, which account): reply {"action":"old"}. Only pick an action that does the WHOLE request: if the user wants something sorted, compared, counted, the newest/latest, or an answer back, reply {"action":"old"}. Delete/move actions are fine to choose, the user confirms.${folders ? `\nFolders: ${folders}` : ''}${extra ? `\n${extra}` : ''}${/CONVERSATION SO FAR/.test(extra) ? `\n${REFERENCE_RULE}` : ''}` },
    { role: 'user', content: command },
  ];
}

// Expand ~ and %VAR% (env is a plain object so tests don't need Windows).
export function expandPath(p, env = {}) {
  if (typeof p !== 'string') return p;
  let s = p.trim().replace(/^~(?=[\\/]|$)/, env.USERPROFILE || '~');
  s = s.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, v) => env[v] ?? m);
  return s.replace(/\//g, '\\');
}

// raw model text -> { ok:true, action, params } | { ok:false, error }. Never throws.
export function validateRouterReply(raw, reg, ctx = {}) {
  const text = String(raw ?? '');
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return { ok: false, error: 'reply was not JSON' };
  let j;
  try { j = JSON.parse(text.slice(a, b + 1)); } catch { return { ok: false, error: 'reply was not valid JSON' }; }
  if (!j || typeof j !== 'object' || typeof j.action !== 'string') return { ok: false, error: 'missing "action"' };
  const action = j.action.trim();
  if (action in PSEUDO) return { ok: true, action, params: {} };
  const spec = reg.get(action);
  if (!spec || spec.internal) return { ok: false, error: `unknown action "${action}"` };
  const given = { ...(j.params && typeof j.params === 'object' ? j.params : {}) };
  for (const [k, def] of Object.entries(spec.params)) if (def.type === 'path' && given[k]) given[k] = expandPath(given[k], ctx.env);
  const v = validateParams(spec, given, ctx);
  return v.ok ? { ok: true, action, params: v.params } : { ok: false, error: v.error };
}
