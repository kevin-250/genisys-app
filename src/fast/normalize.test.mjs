import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, typoDistance } from './normalize.js';

test('lowercases, strips punctuation, filler and years', () => {
  assert.equal(normalize('Please can you open the movie Mousetrap (2019)!'), 'open movie mousetrap');
  assert.equal(normalize('  hey genisys, open my Downloads folder pls '), 'open downloads folder');
  assert.equal(normalize('search for elon musk net worth 2024'), 'search for elon musk net worth');
});
test('keeps file names, paths and urls intact', () => {
  assert.equal(normalize('open test.txt'), 'open test.txt');
  assert.equal(normalize('go to github.com/anthropics'), 'go to github.com/anthropics');
  assert.equal(normalize('open C:\\Users\\me\\a.mp4'), 'open c:\\users\\me\\a.mp4');
});
test('a lone year is kept (it is the query)', () => { assert.equal(normalize('2024'), '2024'); });
test('same meaning, same key', () => { assert.equal(normalize('Open chrome!'), normalize('can you please open the chrome for me')); });
test('typoDistance counts a swap as one typo', () => {
  assert.equal(typoDistance('opne', 'open'), 1);
  assert.equal(typoDistance('serch', 'search'), 1);
  assert.equal(typoDistance('abc', 'xyz'), 3);
});
