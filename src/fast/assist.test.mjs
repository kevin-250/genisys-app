import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTimeIn, timeIn, zoneOf, parseReminder, parsePlay, parseChatSend } from './assist.js';

test('time in a city: parsed and computed from the real clock, not guessed', () => {
  assert.deepEqual(parseTimeIn('what time is it in new york right now'), { place: 'new york' });
  assert.deepEqual(parseTimeIn("what's the time in Tokyo?"), { place: 'Tokyo' });
  assert.equal(parseTimeIn('what time is it in narnia'), null);
  assert.equal(zoneOf('kigali'), 'Africa/Kigali');
  const t = timeIn('new york', new Date('2026-11-17T19:05:00Z'));
  assert.match(t.text, /14:05 in New York/);
});
test('reminders: in N minutes / at a time, with the text', () => {
  const now = new Date(2026, 10, 17, 21, 0, 0);
  const a = parseReminder('remind me in 2 minutes to call mom', now);
  assert.equal(a.at - now.getTime(), 120000); assert.equal(a.text, 'call mom');
  const b = parseReminder('remind me at 6:30 pm to pray', now);
  assert.equal(new Date(b.at).getHours(), 18); assert.equal(new Date(b.at).getDate(), 18); // 18:30 already passed today -> tomorrow
  assert.equal(parseReminder('set a reminder for 10 minutes', now).text, 'Reminder');
  assert.equal(parseReminder('set a timer for 10 minutes', now), null); // timers are their own tool (siri.js)
  assert.equal(parseReminder('remind me about mom', now), null); // no time: the AI asks when
});
test('play: music words or a named player only; films and files are not music', () => {
  assert.deepEqual(parsePlay('play some chill music'), { query: 'chill', app: null });
  assert.deepEqual(parsePlay('play music'), { query: '', app: null });
  assert.deepEqual(parsePlay('play burna boy on spotify'), { query: 'burna boy', app: 'spotify' });
  assert.equal(parsePlay('play trigger episode 2'), null);
  assert.equal(parsePlay('play trigger'), null);
});
test('chat send: a reference to the file just made, or a short text', () => {
  assert.deepEqual(parseChatSend('send that pdf to Kevin on whatsapp'), { app: 'whatsapp', to: 'Kevin', ref: true });
  assert.deepEqual(parseChatSend('that pdf file you created send to kevin on whatsapp'), null); // other word order: the AI handles it
  assert.deepEqual(parseChatSend('send hello to mom via telegram'), { app: 'telegram', to: 'mom', text: 'hello' });
  assert.equal(parseChatSend('send my cv to kevin on whatsapp'), null); // a file to find first
  assert.equal(parseChatSend('send an email to kevin'), null);
});
test('play: a film in a local player or a reference is not a music request', () => {
  assert.equal(parsePlay('play trigger ep 1 in vlc'), null);
  assert.equal(parsePlay('play the last song'), null);
  assert.deepEqual(parsePlay('play some gospel in vlc'), { query: 'gospel', app: 'vlc' });
});
import { nameFits } from './assist.js';
test('delete / move guard: the path must really be what the user named', () => {
  const t = 'delete the genisys todo file';
  assert.equal(nameFits(t, String.raw`C:\Users\me\Desktop\genisys todo.txt`), true);
  assert.equal(nameFits(t, String.raw`C:\Users\me\Documents\HR-SYSTEM\app\api\todos`), false, 'a folder is not a file, and "todos" is not "genisys todo"');
  assert.equal(nameFits(t, String.raw`C:\Users\me\Desktop\todo.txt`), false, '"genisys" is missing');
  assert.equal(nameFits('delete my cv', String.raw`C:\Users\me\Documents\kevin cv.pdf`), true);
  assert.equal(nameFits('delete the photos folder', String.raw`C:\Users\me\Pictures\photos`), true);
});
test('reminder text keeps its words; "tomorrow" is a day, not text (bug: "morrow to call the bank")', () => {
  const now = new Date(2026, 10, 18, 10, 0);
  const r = parseReminder('remind me tomorrow at 9 to call the bank', now);
  assert.equal(r.text, 'call the bank'); assert.equal(new Date(r.at).getDate(), 19); assert.equal(new Date(r.at).getHours(), 9);
  assert.equal(parseReminder('remind me at 5pm today to buy bread', now).text, 'buy bread');
  assert.equal(parseReminder('remind me in 10 minutes to take the tomatoes out', now).text, 'take the tomatoes out');
});

test('a reminder "for 5 pm" (how people say it) is a clock time, "for 5 minutes" stays relative', () => {
  const now = new Date(2026, 10, 18, 13, 0);
  const a = parseReminder('set a reminder for 5 pm to call mom', now);
  assert.equal(new Date(a.at).getHours(), 17); assert.equal(a.text, 'call mom');
  assert.equal(new Date(parseReminder('remind me for 6:30 to stretch', now).at).getMinutes(), 30);
  assert.equal(parseReminder('remind me for 5 minutes to check the oven', now).at, now.getTime() + 5 * 60000);
});

test('a place with its country or region around it still finds the time zone', () => {
  assert.equal(zoneOf('USA California'), 'America/Los_Angeles');
  assert.equal(zoneOf('America/Los Angeles'), 'America/Los_Angeles'); // the AI's spelling
  assert.equal(zoneOf('Kigali Rwanda'), 'Africa/Kigali');
  assert.equal(zoneOf('nowhere land'), null);
});
