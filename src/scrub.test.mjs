import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrub } from './scrub.js';

test('scrub removes the home folder and user name, and caps length', () => {
  const home = 'C:\Users\kevin', user = 'kevin';
  assert.equal(scrub('ENOENT C:\Users\kevin\Downloads\a.pdf', 500, home, user), 'ENOENT ~\Downloads\a.pdf');
  assert.equal(scrub('owner kevin denied', 500, home, user), 'owner <user> denied');
  assert.equal(scrub('abcdef', 3, home, user), 'abc');
  assert.equal(scrub(undefined, 10, home, user), '');
  assert.equal(scrub('an apple', 50, 'C:\Users\an', 'an'), 'an apple'); // 2-letter name left alone
});
