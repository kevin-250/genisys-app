import test from 'node:test';
import assert from 'node:assert/strict';
import { fixSpelling, spellVariants, fixWord } from './spell.js';
import { parseIntent } from './intent.js';

test('real typos from chats are fixed', () => {
  assert.equal(fixSpelling('right set a timer for 1 minutet'), 'right set a timer for 1 minute');
  assert.equal(fixSpelling('hellohiwhat time is it'), 'hello hi what time is it');
  assert.equal(fixSpelling('set a timmer for 5 minuets'), 'set a timer for 5 minutes');
  assert.equal(fixSpelling('wgat\'s the wether tomorow'), "what's the weather tomorrow");
  assert.equal(fixSpelling('noge: call the landlord'), 'note: call the landlord');
  assert.equal(fixWord('sop'), 'stop');
  assert.equal(fixWord('tiiimer'), 'timer');
});

test("the user's own words are never changed", () => {
  for (const s of ['play UKO ABANA B_ABAKIRE BIGISHWA', 'remind me to by bred and cal mom', 'set a timer called brekfast',
    'search for cheap flights to nairobi', 'note that the wifi pasword is on the fridge', 'send hello to Kevin', 'open C:\\Users\\me\\notes.txt',
    'convert 100 dollars to rwandan francs', 'open film called trigger', 'predict spotfy', 'what is the remainder of 10 divided by 3'])
    assert.equal(fixSpelling(s), s, s);
});

test('a typo that leaves two readings is decided by what the parser understands', () => {
  assert.ok(spellVariants('what timed is it').includes('what time is it'));
  assert.equal(parseIntent('what timed is it').action, 'pc');
  assert.equal(parseIntent('sjow my shopping list and reminders').action, 'overview');
  assert.equal(parseIntent('set a 2 minute timer called eggs and a 4 minuet timer called rice').params.op, 'set');
  assert.equal(parseIntent('stop that remider').params.op, 'cancel');
});

test('words speech-to-text mishears are read as the command word', () => {
  assert.equal(parseIntent('set a remind her at 5 pm to call mom').action, 'remind');
  assert.equal(parseIntent('set a time a for 5 minutes called tea').action, 'timer');
  assert.equal(parseIntent("what's the whether in kigali tomorrow").action, 'weather');
  assert.equal(parseIntent('set a lamb at 7 am').action, 'alarm');
});
