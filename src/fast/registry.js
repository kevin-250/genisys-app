// Stage 7: the action registry. An action = a folder in actions/<name>/ with action.json, prompt.md and
// either template.ps1 (filled by code) or a native function (see actions.js). Adding an action = adding a folder.
// Pure code (no node imports) so the page can use it too. Forward slashes work for fs on Windows.
const join = (...a) => a.join('/');

const TYPES = new Set(['string', 'int', 'path', 'url', 'enum']);

// fs is injected (node:fs in the app, a fake in tests). Returns Map(name -> spec).
export function loadActions(fs, dir) {
  const reg = new Map();
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return reg; }
  for (const n of names) {
    const folder = join(dir, n);
    const jf = join(folder, 'action.json');
    if (!fs.existsSync(jf)) continue;
    try {
      const spec = JSON.parse(fs.readFileSync(jf, 'utf8'));
      if (!spec.name || spec.name !== n) throw new Error(`name must equal the folder name "${n}"`);
      for (const [k, def] of Object.entries(spec.params || {})) if (!TYPES.has(def.type)) throw new Error(`param ${k}: unknown type ${def.type}`);
      if (spec.template) spec.templateText = fs.readFileSync(join(folder, spec.template), 'utf8');
      else if (!spec.native) throw new Error('needs "template" or "native"');
      const pf = join(folder, 'prompt.md');
      spec.prompt = fs.existsSync(pf) ? fs.readFileSync(pf, 'utf8') : '';
      reg.set(spec.name, { destructive: false, needs_ai: false, internal: false, triggers: [], params: {}, paths: [], ...spec });
    } catch (e) { reg.bad = [...(reg.bad || []), `${n}: ${e.message}`]; }
  }
  return reg;
}

const BAD_PATH = /[\0*?<>|"]/;
// Check/clean the params a model (or the parser) produced against the spec. Never throws.
export function validateParams(spec, input, ctx = {}) {
  const out = {};
  const given = input && typeof input === 'object' ? input : {};
  for (const [k, def] of Object.entries(spec.params || {})) {
    let v = given[k];
    if (v === undefined || v === null || v === '') {
      if (def.required === false) continue;
      if (def.default !== undefined) { out[k] = def.default; continue; }
      return { ok: false, error: `missing param "${k}"` };
    }
    if (def.type === 'int') {
      const n = Number(v);
      if (!Number.isInteger(n)) return { ok: false, error: `"${k}" must be a whole number` };
      if ((def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) return { ok: false, error: `"${k}" must be ${def.min}-${def.max}` };
      v = n;
    } else {
      if (typeof v !== 'string') return { ok: false, error: `"${k}" must be text` };
      v = v.trim();
      if (v.length > 2000 || /[\r\n]/.test(v) && def.type !== 'string') return { ok: false, error: `"${k}" is not valid` };
      if (def.type === 'enum' && !def.values?.includes(v)) return { ok: false, error: `"${k}" must be one of ${def.values?.join(', ')}` };
      if (def.type === 'url' && !/^https?:\/\/\S+$/i.test(v)) return { ok: false, error: `"${k}" must be an http(s) link` };
      if (def.type === 'path') {
        if (BAD_PATH.test(v)) return { ok: false, error: `"${k}" has characters that are not allowed in a path` };
        if (v.split(/[\\/]+/).includes('..')) return { ok: false, error: `"${k}" must not contain ".."` };
        if (!/^(?:[a-zA-Z]:[\\/]|\\\\)/.test(v)) return { ok: false, error: `"${k}" must be a full path like C:\\Users\\...` };
        if (spec.restrictPaths && ctx.isAllowed && !ctx.isAllowed(v)) return { ok: false, error: `"${k}" is outside the allowed folders` };
      }
    }
    out[k] = v;
  }
  return { ok: true, params: out };
}

// PowerShell single-quoted literal. PowerShell also treats the curly quotes as quotes, so those are doubled too.
export const psQuote = (s) => `'${String(s).replace(/['\u2018\u2019\u201a\u201b]/g, (c) => c + c)}'`;

// {{NAME}} -> quoted literal (text, path, url) or bare digits (int). Newlines are refused so a value can never start a new command.
export function fillTemplate(tpl, params, spec) {
  const text = tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, up) => {
    const key = Object.keys(spec.params || {}).find((k) => k.toUpperCase() === up);
    if (!key || params[key] === undefined) throw new Error(`template needs a value for ${m}`);
    const v = params[key];
    if (spec.params[key].type === 'int') { if (!Number.isInteger(v)) throw new Error(`${m} must be an integer`); return String(v); }
    if (/[\r\n\0]/.test(String(v))) throw new Error(`${m} contains a line break`);
    return psQuote(v);
  });
  const left = text.match(/\{\{[A-Z0-9_]+\}\}/);
  if (left) throw new Error(`unfilled placeholder ${left[0]}`);
  return text;
}

// What the router sees: one short line per public action.
export function routerLines(reg) {
  return [...reg.values()].filter((s) => !s.internal).map((s) => {
    const ps = Object.entries(s.params).map(([k, d]) => `${k}${d.required === false ? '?' : ''}:${d.type === 'enum' ? d.values.join('|') : d.type}`).join(', ');
    return `${s.name}(${ps}) - ${s.description}`;
  });
}

// The action whose triggers/description overlap the command most: its prompt.md is the example for the script fallback.
export function similarPrompt(reg, command) {
  const words = new Set(String(command).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  let best = null, bestN = 0;
  for (const s of reg.values()) {
    if (!s.prompt || s.internal) continue;
    const hay = new Set([...s.triggers, ...s.description.toLowerCase().split(/[^a-z0-9]+/)].filter((w) => w.length > 2));
    let n = 0; for (const w of words) if (hay.has(w)) n++;
    if (n > bestN) { best = s; bestN = n; }
  }
  return best ? { name: best.name, prompt: best.prompt } : null;
}
