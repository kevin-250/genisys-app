// Stage 6: the AI router. One tiny prompt (action list + the command), one tiny JSON answer, all checked in code.
import { validateParams } from './registry.js';

export const PSEUDO = {
  script: 'one simple PC task that no action above can do (needs a PowerShell script)',
  old: 'a question, chat, web research, or a task with several steps',
  unknown: 'nothing fits or the request is unclear',
};

export function buildRouterMessages(lines, command, folders = '') {
  const pseudo = Object.entries(PSEUDO).map(([k, v]) => `${k}() - ${v}`);
  return [
    { role: 'system', content: `You route a Windows PC command to ONE action. Reply with ONLY JSON: {"action":"<name>","params":{...}} or {"action":"unknown"}. No other text.\nActions:\n${[...lines, ...pseudo].join('\n')}\nRules: use the exact action and param names. Paths must be full Windows paths. Never invent a path or link; if unsure answer unknown. Delete/move actions are fine to choose, the user confirms.${folders ? `\nFolders: ${folders}` : ''}` },
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
