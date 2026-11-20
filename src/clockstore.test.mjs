// Logic audit of the everyday tools: the timer/alarm store, and the actions on top of it (timer, alarm, notes, quick,
// stopwatch), checked against how a phone's Clock app behaves (named timers, pause/resume per timer, "which one?" when
// several match, missed alarms are not rung late, snooze 9 min…). Every test names the bug it guards against.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeClockStore } from './clockstore.js';
import { makeActions } from './fast/actions.js';
import { parseClock } from './fast/siri.js';

function fakeStore(t0 = Date.now()) {
  let saved = [], clock = t0;
  const armed = new Set();
  const s = makeClockStore({
    load: () => JSON.parse(JSON.stringify(saved)), // fresh objects every time, like the real JSON in prefs
    save: (l) => { saved = JSON.parse(JSON.stringify(l)); },
    arm: (r) => armed.add(r.id), disarm: (id) => armed.delete(id), now: () => clock,
  });
  return { s, armed, tick: (ms) => { clock += ms; }, raw: () => saved };
}

test('store: cancel removes exactly that item from storage (bug: cancelled timers came back)', () => {
  const { s, armed } = fakeStore();
  const a = s.add(Date.now() + 60e3, 'a', 'timer'), b = s.add(Date.now() + 90e3, 'b', 'timer'), al = s.add(Date.now() + 3600e3, 'wake', 'alarm');
  assert.equal(s.cancel('timer', a.id).length, 1);
  assert.deepEqual(s.list().map((r) => r.id).sort(), [b.id, al.id].sort());
  assert.ok(!armed.has(a.id) && armed.has(b.id));
  s.cancel('timer'); // all timers, alarms untouched
  assert.deepEqual(s.list().map((r) => r.kind), ['alarm']);
});
test('store: pause keeps the timer with its time left, resume continues from there (bug: paused timer kept running)', () => {
  const { s, armed, tick } = fakeStore();
  const t = s.add(Date.now() + 120e3, 'pasta', 'timer');
  tick(20e3);
  const p = s.pause(t.id);
  assert.equal(p.length, 1); assert.ok(!armed.has(t.id), 'a paused timer must not ring');
  const kept = s.list().find((r) => r.id === t.id);
  assert.ok(Math.abs(kept.paused - 100e3) < 50, 'it keeps the 100 s that were left');
  assert.equal(s.pause(t.id).length, 0, 'pausing twice changes nothing');
  tick(300e3); // a long pause
  const r = s.resume(t.id);
  assert.equal(r.length, 1); assert.ok(armed.has(t.id));
  const back = s.list().find((x) => x.id === t.id);
  assert.equal(back.paused, undefined); assert.ok(Math.abs(back.at - (Date.now() + 320e3 + 100e3)) < 2000, 'still 100 s left after resume');
  assert.equal(s.resume(t.id).length, 0, 'resuming a running timer changes nothing');
});
test('store: at start, missed timers/alarms are not rung late; future and paused ones are kept; late reminders still fire', () => {
  const { s, armed } = fakeStore();
  const now = Date.now();
  const missedT = s.add(now - 5 * 60e3, 'old', 'timer'), missedA = s.add(now - 3600e3, 'old alarm', 'alarm');
  const future = s.add(now + 600e3, 'f', 'timer'), lateRem = s.add(now - 3600e3, 'pay bills', 'reminder');
  const paused = s.add(now + 600e3, 'p', 'timer'); s.pause(paused.id);
  armed.clear();
  const missed = s.startup();
  assert.deepEqual(missed.map((r) => r.id).sort(), [missedT.id, missedA.id].sort());
  assert.ok(armed.has(future.id) && armed.has(lateRem.id) && !armed.has(paused.id));
  assert.ok(s.list().some((r) => r.id === paused.id), 'a paused timer survives a restart');
});

function tools() {
  const { s } = fakeStore();
  let memos = [], nid = 0, sw = { start: 0, acc: 0 };
  const swNow = () => sw.acc + (sw.start ? Date.now() - sw.start : 0);
  const A = makeActions({
    shell: {}, resolveApp: () => null, spawnDetached() {}, findFiles: async () => ({ matches: [] }), paths: {}, exists: () => true, isAllowed: () => true,
    clock: s, remind: (...a) => s.add(...a),
    notes: { add: (t) => { memos.push({ id: ++nid, ts: Date.now(), text: t, done: 0 }); return nid; }, list: () => [...memos].sort((a, b) => a.done - b.done || b.ts - a.ts), done: (id, v) => { const m = memos.find((x) => x.id === Number(id)); if (m) m.done = v ? 1 : 0; }, del: (id) => { memos = memos.filter((x) => x.id !== Number(id)); } },
    stopwatch: { start: () => { const was = !!sw.start; if (!sw.start) sw.start = Date.now(); return { was, ms: swNow() }; }, stop: () => { const ran = !!sw.start; sw.acc = swNow(); sw.start = 0; return { ran, ms: sw.acc }; }, status: () => ({ running: !!sw.start, ms: swNow() }), reset: () => { sw.start = 0; sw.acc = 0; return { ms: 0 }; } },
  });
  return { A, s };
}

test('timer: names, one card per new timer, same-time warning only against running timers', async () => {
  const { A, s } = tools();
  const a = await A.timer({ op: 'set', seconds: 600, label: 'rice' });
  assert.equal(a.card.label, 'rice'); assert.ok(a.card.id); assert.deepEqual(a.card.also, []);
  const b = await A.timer({ op: 'set', seconds: 600, label: 'beans' });
  assert.match(b.card.warn, /same time as your rice timer/); assert.equal(b.card.also.length, 1, 'other timers are one line, not more cards');
  await A.timer({ op: 'pause', label: 'rice' });
  const c = await A.timer({ op: 'set', seconds: 600, label: 'tea' });
  assert.match(c.card.warn, /beans/); assert.doesNotMatch(c.card.warn, /rice/, 'a paused timer rings at no time: no warning');
  const st = await A.timer({ op: 'status' });
  assert.match(st.message, /rice timer: .* \(paused\)/);
  assert.equal(s.list().filter((r) => r.kind === 'timer').length, 3);
});
test('timer: "cancel/pause the timer" with several asks which one; by name or id touches only that one', async () => {
  const { A, s } = tools();
  const r1 = await A.timer({ op: 'set', seconds: 300, label: 'eggs' }); await A.timer({ op: 'set', seconds: 900, label: 'oven' });
  const ask = await A.timer({ op: 'cancel' });
  assert.equal(ask.status, 'choose'); assert.equal(ask.options.length, 3); assert.equal(ask.options.at(-1).label, 'All of them');
  assert.equal((await A.timer({ op: 'cancel', label: 'nope' })).message, 'You have no timer called "nope".');
  await A.timer({ op: 'cancel', id: r1.card.id });
  assert.deepEqual(s.list().map((r) => r.label), ['oven']);
  const one = await A.timer({ op: 'cancel' }); // only one left: no question
  assert.equal(one.status, 'done'); assert.equal(s.list().length, 0);
  assert.equal((await A.timer({ op: 'set', seconds: 0 })).status, 'fall', 'no 0-second timers');
  assert.equal((await A.timer({ op: 'set', seconds: 25 * 3600 })).status, 'fall', 'no timers over 24 h');
});
test('alarm: unclear time asks (both am/pm), a passed time today asks for tomorrow, cancel asks which one', async () => {
  const { A } = tools();
  const ask = await A.alarm({ op: 'ask', h: 7, m: 0 });
  assert.equal(ask.status, 'choose'); assert.ok(ask.options.length >= 2);
  assert.ok(ask.options.every((o) => o.params.at > Date.now()), 'never offers a time in the past');
  assert.deepEqual(new Set(ask.options.map((o) => new Date(o.params.at).getHours())), new Set([7, 19]));
  const a1 = await A.alarm({ op: 'set', at: Date.now() + 3600e3, label: 'gym' });
  await A.alarm({ op: 'set', at: Date.now() + 7200e3 });
  assert.ok(a1.card.items.every((i) => i.id), 'cards know each alarm id (bug: a switch turned every alarm off)');
  const c = await A.alarm({ op: 'cancel' });
  assert.equal(c.status, 'choose'); assert.equal(c.options.length, 3);
  const g = await A.alarm({ op: 'cancel', label: 'gym' });
  assert.match(g.message, /Cancelled the alarm/);
  assert.equal((await A.alarm({ op: 'set', at: Date.now() - 60e3 })).status, 'fall', 'no alarms in the past');
});
test('alarm: the reply is the new alarm (others one line), the same alarm twice is not stacked', async () => {
  const { A, s } = tools();
  const at = Date.now() + 5 * 3600e3;
  await A.alarm({ op: 'set', at: at + 3600e3, label: 'gym' });
  const a = await A.alarm({ op: 'set', at, label: 'eat' });
  assert.equal(a.card.items.length, 1); assert.equal(a.card.items[0].text, 'eat'); assert.equal(a.card.also.length, 1);
  const again = await A.alarm({ op: 'set', at, label: 'eat' });
  assert.match(again.message, /already have that alarm/);
  assert.equal(s.list().filter((r) => r.kind === 'alarm').length, 2, 'no copy was added');
  const other = await A.alarm({ op: 'set', at, label: 'call mom' }); // same minute, different name: allowed, but flagged
  assert.match(other.card.warn, /Another alarm rings at the same time .*eat/);
  assert.equal(parseClock('set alarm called eat at today 23:10', new Date(2026, 10, 17, 23, 0)).params.label, 'eat');
});
test('notes, quick answers, stopwatch: edges', async () => {
  const { A } = tools();
  const n = await A.note({ op: 'add', text: 'buy milk' });
  assert.equal(n.card.items[0].text, 'buy milk'); assert.equal(n.card.added, n.card.items[0].id);
  assert.equal((await A.note({ op: 'add', text: '   ' })).status, 'fall', 'no empty notes');
  await A.note({ op: 'done', id: n.card.added });
  assert.equal((await A.note({ op: 'show' })).card.items[0].done, true);
  await A.note({ op: 'delete', id: n.card.added });
  assert.equal((await A.note({ op: 'show' })).card.items.length, 0);
  assert.equal((await A.quick({ op: 'dice', n: 50 })).card.rolls.length, 10, 'at most 10 dice');
  const num = await A.quick({ op: 'number', min: 10, max: 1 });
  assert.ok(num.card.value >= 1 && num.card.value <= 10, 'min > max still works');
  assert.match((await A.stopwatch({ op: 'stop' })).message, /isn't running/);
  await A.stopwatch({ op: 'start' });
  assert.match((await A.stopwatch({ op: 'start' })).message, /already running/);
  assert.equal((await A.stopwatch({ op: 'status' })).card.running, true);
});
test('parser: pause / resume / cancel a timer by name; "name it" works for timers and alarms', () => {
  const now = new Date(2026, 10, 17, 21, 0);
  assert.deepEqual(parseClock('pause the rice timer', now).params, { op: 'pause', label: 'rice' });
  assert.deepEqual(parseClock('resume my timer', now).params, { op: 'resume' });
  assert.deepEqual(parseClock('cancel the tea timer', now).params, { op: 'cancel', label: 'tea' });
  assert.deepEqual(parseClock('set timer for 30 sec and name it workout', now).params, { op: 'set', seconds: 30, label: 'workout' });
  assert.equal(parseClock('set an alarm for 6:30 am named gym', now).params.label, 'gym');
  assert.equal(parseClock('set an alarm for 7 and name it set 2', now).params.op, 'ask', 'a name with a number is not a time');
});
