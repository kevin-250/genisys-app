// The one store for timers, alarms and reminders (main.js owns the real timeouts and the saved list).
// Pure logic, so it is tested on its own (clockstore.test.mjs): load()/save() read and write the saved list,
// arm(r)/disarm(id) start and stop the real timeout of one item. An item: { id, at, text, kind, label?, total?, paused? }
// paused = ms that were left when it was paused (a paused timer is kept, but never armed).
export function makeClockStore({ load, save, arm, disarm, now = () => Date.now() }) {
  const list = () => load();
  const newId = (at) => `${at}-${Math.random().toString(36).slice(2, 7)}`;
  function add(at, text, kind = 'reminder', extra = {}) {
    const r = { ...extra, id: newId(at), at, text, kind };
    save([...load(), r]);
    arm(r);
    return r;
  }
  // kind: 'timer' | 'alarm' | 'reminder' | undefined (= timers and alarms); id: just that one. Returns what was removed.
  function cancel(kind, id) {
    const l = load();
    const hit = l.filter((r) => (id ? r.id === id : kind ? (r.kind || 'reminder') === kind : r.kind === 'timer' || r.kind === 'alarm'));
    for (const r of hit) disarm(r.id);
    const gone = new Set(hit.map((r) => r.id)); // by id: load() returns fresh objects, identity never matches
    save(l.filter((r) => !gone.has(r.id)));
    return hit;
  }
  function pause(id) {
    const l = load(), hit = l.filter((r) => r.kind === 'timer' && r.paused == null && (!id || r.id === id));
    for (const r of hit) { disarm(r.id); r.paused = Math.max(1000, r.at - now()); }
    if (hit.length) save(l);
    return hit;
  }
  function resume(id) {
    const l = load(), hit = l.filter((r) => r.kind === 'timer' && r.paused != null && (!id || r.id === id));
    for (const r of hit) { r.at = now() + r.paused; delete r.paused; }
    if (hit.length) { save(l); for (const r of hit) arm(r); }
    return hit;
  }
  // it rang: off the list
  const done = (id) => { const l = load(); if (l.some((r) => r.id === id)) save(l.filter((r) => r.id !== id)); };
  // app start: timers / alarms that were due while the app was closed are not rung late (they come back as "missed");
  // everything still ahead is armed. A late reminder still fires: it is a to-do, not a wake-up.
  function startup(graceMs = 60000) {
    const l = load();
    const missed = l.filter((r) => r.paused == null && r.at < now() - graceMs && (r.kind === 'timer' || r.kind === 'alarm'));
    if (missed.length) { const m = new Set(missed.map((r) => r.id)); save(l.filter((r) => !m.has(r.id))); }
    for (const r of load()) if (r.paused == null) arm(r);
    return missed;
  }
  return { list, add, cancel, pause, resume, done, startup };
}
