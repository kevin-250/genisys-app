import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClock, durationOf, parseNote, parseQuick, daysUntil, fmtSecs, clashWarning } from './siri.js';

test('alarms or timers ringing at the same time are flagged', () => {
  const t = new Date(2026, 10, 18, 6, 30).getTime();
  assert.equal(clashWarning([{ at: t }, { at: t + 3600e3 }]), '');
  assert.match(clashWarning([{ at: t }, { at: t + 20e3 }, { at: t + 3600e3 }], 'alarms'), /^2 alarms ring at the same time \(06:30\)/);
});

const now = new Date(2026, 10, 17, 21, 0, 0);
test('durations', () => {
  assert.equal(durationOf('1 hour 30 minutes'), 5400);
  assert.equal(durationOf('an hour and a half'), 5400);
  assert.equal(durationOf('90 seconds'), 90);
  assert.equal(durationOf('half an hour'), 1800);
});
test('timers: Siri phrasing', () => {
  assert.deepEqual(parseClock('set a timer for 10 minutes', now), { action: 'timer', params: { op: 'set', seconds: 600 } });
  assert.deepEqual(parseClock('timer 5 minutes', now), { action: 'timer', params: { op: 'set', seconds: 300 } });
  assert.deepEqual(parseClock('set a 20 minute timer for the rice', now), { action: 'timer', params: { op: 'set', seconds: 1200, label: 'rice' } });
  assert.deepEqual(parseClock('how much time is left on my timer', now), { action: 'timer', params: { op: 'status' } });
  assert.deepEqual(parseClock('cancel the timer', now), { action: 'timer', params: { op: 'cancel' } });
  assert.deepEqual(parseClock('stop the timer', now), { action: 'timer', params: { op: 'cancel' } });
  assert.deepEqual(parseClock('cancel all timers', now), { action: 'timer', params: { op: 'cancel', all: 'yes' } });
});
test('alarms and reminders list', () => {
  const w = parseClock('wake me up at 6am', now);
  assert.equal(w.action, 'alarm'); assert.equal(new Date(w.params.at).getHours(), 6); assert.equal(new Date(w.params.at).getDate(), 18);
  assert.deepEqual(parseClock('set an alarm for 7:30', now), { action: 'alarm', params: { op: 'ask', h: 7, m: 30 } }); // morning or evening? ask
  assert.equal(new Date(parseClock('set an alarm for 6:45 am tomorrow', now).params.at).getHours(), 6);
  assert.equal(new Date(parseClock('set an alarm for 19:00', now).params.at).getHours(), 19);
  assert.equal(new Date(parseClock('alarm at 11 tonight', now).params.at).getHours(), 23);
  assert.equal(parseClock('alarm at 8 tonight', now).params.op, 'ask'); // 20:00 already passed at 21:00: ask, don't set tomorrow silently
  // a countdown said as an alarm: a timer, never tomorrow
  assert.deepEqual(parseClock('set alarm in 1 upcoming minute', now), { action: 'timer', params: { op: 'set', seconds: 60, label: 'alarm' } });
  assert.deepEqual(parseClock('alarm for 3 minutes', now), { action: 'timer', params: { op: 'set', seconds: 180, label: 'alarm' } });
  assert.deepEqual(parseClock('set a timer for 2 more minutes', now), { action: 'timer', params: { op: 'set', seconds: 120 } });
  assert.deepEqual(parseClock('what alarms do i have', now), { action: 'alarm', params: { op: 'list' } });
  assert.deepEqual(parseClock('cancel my alarm', now), { action: 'alarm', params: { op: 'cancel' } });
  assert.deepEqual(parseClock('what are my reminders', now), { action: 'alarm', params: { op: 'list' } });
  assert.equal(parseClock('open the clock app', now), null);
});
test('stopwatch', () => {
  assert.deepEqual(parseClock('start a stopwatch', now), { action: 'stopwatch', params: { op: 'start' } });
  assert.deepEqual(parseClock('stop the stopwatch', now), { action: 'stopwatch', params: { op: 'stop' } });
  assert.deepEqual(parseClock('how long has the stopwatch been running', now), { action: 'stopwatch', params: { op: 'status' } });
});
test('notes and quick answers', () => {
  assert.deepEqual(parseNote('take a note buy milk and bread'), { op: 'add', text: 'buy milk and bread' });
  assert.deepEqual(parseNote('note: call the landlord'), { op: 'add', text: 'call the landlord' });
  assert.deepEqual(parseNote('read my notes'), { op: 'show' });
  assert.deepEqual(parseNote('show my notes'), { op: 'show' });
  assert.equal(parseNote('notepad'), null);
  assert.deepEqual(parseQuick('flip a coin'), { op: 'coin' });
  assert.deepEqual(parseQuick('roll a dice'), { op: 'dice', n: 1 });
  assert.deepEqual(parseQuick('pick a number between 1 and 10'), { op: 'number', min: 1, max: 10 });
  const c = parseQuick('how many days until christmas', new Date(2026, 10, 17));
  assert.equal(daysUntil(c.date, new Date(2026, 10, 17)), 38);
  assert.equal(fmtSecs(5400), '1 hour 30 minutes');
});
import { calc } from './siri.js';
test('calculator: answers sums exactly, refuses units and currency (those go to the web)', () => {
  assert.equal(calc("what's 15% of 2400"), 360);
  assert.equal(calc('what is 25 times 4'), 100);
  assert.equal(calc('(3+4)*2'), 14);
  assert.equal(calc('square root of 81'), 9);
  assert.equal(calc('2 to the power of 10'), 1024);
  assert.equal(calc('1,200 + 350'), 1550);
  assert.equal(calc('10 - -2'), 12);
  assert.equal(calc('convert 100 dollars to rwf'), null);
  assert.equal(calc('what is 5 km in miles'), null);
  assert.equal(calc('1/0'), null, 'no Infinity answers');
  assert.equal(calc('2 +'), null);
});
import { parseMedia } from './siri.js';
test('media: control the player that is open; a title means open that file instead', () => {
  assert.deepEqual(parseMedia('play current movie in potplayer'), { op: 'play', app: 'potplayer' });
  assert.deepEqual(parseMedia('play potplayer'), { op: 'play', app: 'potplayer' });
  assert.deepEqual(parseMedia('pause the music'), { op: 'pause' });
  assert.deepEqual(parseMedia('next song on vlc'), { op: 'next', app: 'vlc' });
  assert.equal(parseMedia('play free guy in potplayer'), null);
  assert.equal(parseMedia('play some chill music'), null);
  assert.equal(parseMedia('play trigger ep 2'), null);
});
import { parseOverview } from './siri.js';
test('overview: asking to SEE two or more kinds of things -> one grid; doing something is not an overview', () => {
  assert.deepEqual(parseOverview('show me all alarm i have and timer'), { parts: 'timers,alarms' });
  assert.deepEqual(parseOverview('what timers and reminders do i have'), { parts: 'timers,reminders' });
  assert.deepEqual(parseOverview('show my notes and shopping list'), { parts: 'shopping,notes' });
  assert.equal(parseOverview('show my alarms'), null, 'one kind: the normal list');
  assert.equal(parseOverview('cancel my alarms and timers'), null);
});
import { parseIntent } from './intent.js';
test('round 7: tips/discounts, weather with a question, site search, app RAM', () => {
  assert.equal(calc('what is 18% tip on 45000'), 8100);
  assert.equal(calc('20% off 5000'), 4000);
  assert.deepEqual(parseIntent("what's the weather tomorrow in kigali, should i take an umbrella?").params, { place: 'kigali', when: 'tomorrow', ask: 'rain' });
  assert.deepEqual(parseIntent('open youtube and search for lofi music').params, { query: 'lofi music', site: 'youtube' });
  assert.deepEqual(parseIntent('how much ram is chrome using right now').params, { name: 'chrome' });
});

test('typos and the in-app calendar, from real chats ("show me callender", "stop that remider")', async () => {
  const { parseIntent } = await import('./intent.js');
  const { fixTypos } = await import('./siri.js');
  assert.equal(fixTypos('stop that remider'), 'stop that reminder');
  assert.equal(fixTypos('show me all alrams'), 'show me all alarms');
  assert.equal(fixTypos('the remainder of 10 / 3'), 'the remainder of 10 / 3');
  assert.equal(parseIntent('show me callender').action, 'calendar');
  assert.equal(parseIntent("what's on my calendar").action, 'calendar');
  assert.equal(parseIntent('open google calendar').action, 'open_app');
  assert.deepEqual(parseIntent('stop that remider').params, { op: 'cancel', kind: 'reminder' });
  assert.deepEqual(parseIntent('cancel all reminders').params, { op: 'cancel', kind: 'reminder', all: 'yes' });
});

test('cancel a reminder or alarm by its name', () => {
  const now = new Date(2026, 10, 18, 12, 0);
  assert.deepEqual(parseClock('cancel the water the plants reminder', now).params, { op: 'cancel', kind: 'reminder', label: 'water the plants' });
  assert.deepEqual(parseClock('cancel my reminder to pay rent', now).params, { op: 'cancel', kind: 'reminder', label: 'pay rent' });
  assert.deepEqual(parseClock('stop that reminder', now).params, { op: 'cancel', kind: 'reminder' });
  assert.deepEqual(parseClock('delete the gym alarm', now).params, { op: 'cancel', label: 'gym' });
  assert.deepEqual(parseClock('cancel my alarm', now).params, { op: 'cancel' });
});

test('a timer to a clock time counts down from the PC clock ("timer for 5:50 pm" at 17:49 is 1 minute, not tomorrow)', () => {
  const now = new Date(2026, 10, 18, 17, 49, 20);
  const secs = (s) => parseClock(s, now).params.seconds;
  assert.equal(secs('set a timer for 5:50 pm'), 40);
  assert.equal(secs('Set timer for 5.50 today, PM'), 40);
  assert.equal(secs('set a timer for 5.50'), 40); // no am/pm: the next 5:50
  assert.equal(secs('set a timer until 6 pm called pasta'), 10 * 60 + 40);
  assert.equal(parseClock('set a timer until 6 pm called pasta', now).params.label, 'pasta');
  assert.equal(secs('set timer at today 6:31pm'), 41 * 60 + 40);
  const past = parseClock('set a timer for 4 pm today', now);
  assert.equal(past.action, 'alarm'); assert.equal(past.params.past, 'yes');
  assert.equal(parseClock('set a timer for 5', now), null); // 5 what? the AI asks
});
