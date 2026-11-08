// Stage 4: the command cache. `db` is (op, ...args) => Promise, i.e. window.api.db in the page, a fake in tests.
import { normalize } from './normalize.js';

export const cacheKey = (task) => normalize(task);

// Never cache destructive actions, the script fallback, or anything with a huge payload.
export function cacheable(action, params, reg) {
  const spec = reg?.get?.(action) ?? reg?.[action];
  if (!spec || spec.destructive || spec.pseudo) return false;
  return JSON.stringify(params ?? {}).length < 1500;
}

// -> { action, params } when the saved entry is still valid, else null (a stale entry is deleted on the spot).
export async function cacheLookup(db, validate, task) {
  const key = cacheKey(task);
  if (!key) return null;
  const hit = await db('cacheGet', key);
  if (!hit) return null;
  let ok = false;
  try { ok = await validate(hit.action, hit.params); } catch { ok = false; }
  if (!ok) { await db('cacheDrop', key); return null; }
  await db('cacheUse', key);
  return { action: hit.action, params: hit.params, uses: hit.uses + 1 };
}

export async function cacheStore(db, task, action, params, reg) {
  const key = cacheKey(task);
  if (!key || !cacheable(action, params, reg)) return false;
  await db('cachePut', key, action, params);
  return true;
}
