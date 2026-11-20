// Stage 4: the model labels your PC. Pure code: builds the small prompts and checks every answer. Only NAMES are ever sent
// (no paths, no files, no file contents), only for apps, and only after the user turned it on ("label my pc").
import { norm } from './catalog.js';

export const LABEL_KINDS = ['app', 'pwa', 'store', 'program'];
export const CATS = ['browser', 'email', 'chat', 'music', 'video', 'notes', 'editor', 'terminal', 'game', 'office', 'utility', 'dev', 'system', 'design', 'storage', 'other'];

export function nameHash(e) { let h = 5381; for (const c of `${e.kind}|${e.name}`) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return h.toString(36); }
export const labelOf = (e) => { try { const l = typeof e.label === 'string' && e.label ? JSON.parse(e.label) : null; return l && l.cat ? l : null; } catch { return null; } };
export const needsLabel = (e) => LABEL_KINDS.includes(e.kind) && (!labelOf(e) || e.label_hash !== nameHash(e));

export function labelMessages(batch) {
  return [
    { role: 'system', content: `You label Windows apps from their NAME only. Reply with ONLY a JSON array, one object per line given: {"i":<number>,"cat":"<one of ${CATS.join('|')}>","aliases":[up to 3 other names or common misspellings people type for it],"verbs":[up to 3 of: open, play, edit, write, watch, browse, chat, code, search]}. If you do not know the app, use cat "other" and empty aliases. Never invent.` },
    { role: 'user', content: batch.map((e, i) => `${i}. ${e.name}`).join('\n') },
  ];
}

// raw model text -> Map(entry id -> { cat, aliases, verbs }); anything malformed is dropped, never guessed.
export function parseLabels(raw, batch) {
  const text = String(raw ?? ''); const a = text.indexOf('['), b = text.lastIndexOf(']');
  const out = new Map();
  if (a < 0 || b <= a) return out;
  let arr; try { arr = JSON.parse(text.slice(a, b + 1)); } catch { return out; }
  if (!Array.isArray(arr)) return out;
  for (const r of arr) {
    const e = batch[Number(r?.i)];
    if (!e || !CATS.includes(r.cat)) continue;
    const aliases = [...new Set((Array.isArray(r.aliases) ? r.aliases : []).filter((x) => typeof x === 'string').map(norm).filter((x) => x.length >= 2 && x.length <= 30))].slice(0, 3);
    const verbs = (Array.isArray(r.verbs) ? r.verbs : []).filter((x) => typeof x === 'string' && /^[a-z]{3,10}$/.test(x)).slice(0, 3);
    out.set(e.id, { cat: r.cat, aliases, verbs });
  }
  return out;
}

// One tiny question when the predictor cannot decide between a few close candidates.
export function pickMessages(query, options) {
  return [
    { role: 'system', content: 'The user typed a request to open something on their Windows PC. Pick which listed item they most likely mean, using spelling, sound and common sense. Reply with ONLY the number, or the word none if no item fits. Never guess when nothing fits.' },
    { role: 'user', content: `Request: "open ${query}"\n${options.map((o, i) => `${i}. ${o.name} (${o.kind}${o.cat ? `, ${o.cat}` : ''})`).join('\n')}` },
  ];
}
export function parsePick(raw, n) {
  const m = /^\s*"?\s*(\d{1,2}|none)\b/i.exec(String(raw ?? ''));
  if (!m || /none/i.test(m[1])) return -1;
  const i = Number(m[1]);
  return i >= 0 && i < n ? i : -1;
}
