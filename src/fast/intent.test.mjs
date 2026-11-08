import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent, FAST_MIN } from './intent.js';

// [text, action, params subset]. confidence must be >= FAST_MIN for every row here.
const GOOD = [
  ['open chrome', 'open_app', { name: 'chrome' }],
  ['Open Chrome please', 'open_app', { name: 'chrome' }],
  ['opne chrome', 'open_app', { name: 'chrome' }],            // typo in the verb
  ['launch spotify', 'open_app', { name: 'spotify' }],
  ['can you open the calculator for me', 'open_app', { name: 'calculator' }],
  ['open google chrome', 'open_app', { name: 'chrome' }],
  ['start notepad', 'open_app', { name: 'notepad' }],
  ['open vs code', 'open_app', { name: 'code' }],
  ['open task manager', 'open_app', { name: 'taskmgr' }],
  ['open downloads', 'open_folder', { folder: 'downloads' }],
  ['open my downloads folder', 'open_folder', { folder: 'downloads' }],
  ['show me the documents folder', 'open_folder', { folder: 'documents' }],
  ['open desktop', 'open_folder', { folder: 'desktop' }],
  ['open my pictures', 'open_folder', { folder: 'pictures' }],
  ['open the folder projects', 'open_folder', { name: 'projects' }],
  ['open the movie mousetrap', 'open_file', { query: 'mousetrap', media: true }],
  ['open the movie Mousetrap (2019)', 'open_file', { query: 'mousetrap' }],
  ['play mousetrap', 'open_file', { query: 'mousetrap' }],
  ['watch the film free guy', 'open_file', { query: 'free guy' }],
  ['open resume.pdf', 'open_file', { query: 'resume', ext: 'pdf' }],
  ['search elon musk net worth', 'search_web', { query: 'elon musk net worth' }],
  ['search for elon musk net worth in chrome', 'search_web', { query: 'elon musk net worth', browser: 'chrome' }],
  ['open chrome and search elon musk net worth', 'search_web', { query: 'elon musk net worth', browser: 'chrome' }],
  ['google best pizza near me', 'search_web', { query: 'best pizza near me' }],
  ['serch cats on youtube', 'search_web', { query: 'cats', site: 'youtube' }],
  ['look up how to tie a tie', 'search_web', { query: 'how to tie a tie' }],
  ['search salt and pepper recipe', 'search_web', { query: 'salt and pepper recipe' }],
  ['open youtube', 'open_url', { url: 'https://www.youtube.com' }],
  ['go to github.com', 'open_url', { url: 'https://github.com' }],
  ['youtube.com', 'open_url', { url: 'https://youtube.com' }],
  ['open https://example.com/a?b=1', 'open_url', { url: 'https://example.com/a?b=1' }],
  ['open youtube in edge', 'open_url', { url: 'https://www.youtube.com', browser: 'edge' }],
];
for (const [text, action, params] of GOOD) {
  test(`fast: "${text}"`, () => {
    const r = parseIntent(text);
    assert.equal(r.action, action, JSON.stringify(r));
    assert.ok(r.confidence >= FAST_MIN, `confidence ${r.confidence} for ${text}`);
    for (const [k, v] of Object.entries(params)) assert.equal(r.params[k], v, `${k} in ${JSON.stringify(r.params)}`);
  });
}

// Anything that is not a plain open/search must NOT reach the fast path.
const NOT_FAST = [
  'play my dear by element on spotify', 'what is my ip', 'set volume to 30', 'create a file test.txt on desktop',
  'delete my downloads folder', 'delete everything and open chrome', 'open chrome and then close it', 'open downloads and delete old files',
  'how do I open the task manager', 'hello', 'find my cv', 'open', '', 'send an email to john', 'install vlc', 'open the file about taxes and summarize it',
];
for (const text of NOT_FAST) {
  test(`not fast: "${text}"`, () => {
    const r = parseIntent(text);
    assert.ok(r.action === 'unknown' || r.confidence < FAST_MIN, `${text} -> ${JSON.stringify(r)}`);
  });
}

test('url keeps its letter case', () => { assert.equal(parseIntent('open https://Example.com/AbC').params.url, 'https://Example.com/AbC'); });
test('unknown names get a lower confidence than known apps', () => {
  assert.ok(parseIntent('open obsidian').confidence > parseIntent('open some random tool').confidence);
});
