import test from 'node:test';
import assert from 'node:assert/strict';
import { needsFresh, freshQuery } from './fresh.js';

test('questions whose answer changes over time search the web first', () => {
  for (const s of ['Can you tell me when GTA 6 will come out?', 'When GTA 6 will come out in 2026', "what's the latest news in Rwanda",
    'how much is bitcoin worth', 'who won the champions league', 'is the new iPhone out yet', 'price of a PS5 in Kigali', 'who is the president of the USA'])
    assert.ok(needsFresh(s), s);
});

test('PC tasks, the user\'s own things and plain chat never do', () => {
  for (const s of ['open the latest file in my downloads', 'how much ram is chrome using', 'set a timer for 5 minutes', 'hi', 'what is 25 times 4',
    'make a folder on my desktop called voice test', 'what time is it right now in Los Angeles California', 'current time in California USA', 'what time is it', 'show me my latest notes', 'tell me a joke'])
    assert.ok(!needsFresh(s), s);
  assert.ok(!needsFresh('find the newest pdf', { isFile: true }));
});

test('the search query is the question without the chat around it', () => {
  assert.equal(freshQuery('Can you tell me when GTA 6 will come out?'), 'when GTA 6 will come out');
  assert.equal(freshQuery('hey genisys, please tell me the latest news in Rwanda.'), 'the latest news in Rwanda');
});
