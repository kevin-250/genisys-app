import test from 'node:test';
import assert from 'node:assert/strict';
import { learnMessages, parseLearned, habitLines } from './learn.js';

test('learning: only new, valid, non-secret facts are kept', () => {
  const known = [{ kind: 'fact', text: 'Lives in Kigali' }];
  const raw = 'Here you go: [{"kind":"fact","text":"Lives in Kigali"},{"kind":"preference","text":"Watches series in PotPlayer"},{"kind":"person","text":"Has a friend called Kevin, messages him on WhatsApp"},{"kind":"fact","text":"His password is hunter22"},{"kind":"weird","text":"Studies software engineering"},{"kind":"fact","text":"ok"}]';
  const got = parseLearned(raw, known);
  assert.deepEqual(got.map((g) => g.text), ['Watches series in PotPlayer', 'Has a friend called Kevin, messages him on WhatsApp', 'Studies software engineering']);
  assert.equal(got[2].kind, 'fact', 'unknown kinds become fact');
  assert.deepEqual(parseLearned('no json here'), []);
  const m = learnMessages(known, ['play trigger in potplayer']);
  assert.match(m[1].content, /ALREADY KNOWN:\n- fact: Lives in Kigali/);
});
test('habits: counted from what the user does; one-offs are not habits', () => {
  const lines = habitLines({
    apps: [{ name: 'PotPlayer', uses: 12 }, { name: 'Chrome', uses: 7 }, { name: 'Paint', uses: 1 }],
    music: ['query afrobeats', 'query afrobeats', 'query jazz'],
    weather: ['place kigali, when today', 'place kigali, when tomorrow'],
    contacts: ['app whatsapp, to Kevin, path x', 'app whatsapp, to Kevin, text hi'],
    alarms: [new Date(2026, 10, 18, 6, 30).getTime(), new Date(2026, 10, 19, 6, 30).getTime()],
  });
  assert.deepEqual(lines, ['Opens most: PotPlayer, Chrome', 'Music they ask for: afrobeats', 'Places they check the weather for: kigali', 'People they message: Kevin', 'Usual alarm time: 06:30']);
});
