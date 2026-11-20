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
  ['open google chrome', 'open_app', { name: 'google chrome' }],
  ['start notepad', 'open_app', { name: 'notepad' }],
  ['open vs code', 'open_app', { name: 'vs code' }],
  ['open task manager', 'pc', { do: 'task_manager' }],
  ['what is my ip', 'pc', { do: 'ip_address' }],
  ['set volume to 30', 'pc', { do: 'volume', value: 30 }],
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
  ['open youtube', 'open_app', { name: 'youtube', url: 'https://www.youtube.com' }], // the installed app of that name if any, else the site
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
  'create a file test.txt on desktop',
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
test('any short name goes to the catalog (no app list in the parser); long or qualified ones do not', () => {
  const o = parseIntent('open obsidian'); assert.equal(o.action, 'open_app'); assert.ok(o.confidence >= FAST_MIN);
  assert.equal(parseIntent('open some random tool').action, 'open_app');
  assert.ok(parseIntent('open some random tool').confidence >= FAST_MIN);
  assert.ok(parseIntent('open spotfy').confidence >= FAST_MIN);
  assert.ok(parseIntent('open chrome in incognito').confidence < FAST_MIN);
  assert.ok(parseIntent('open the thing i was working on yesterday').confidence < FAST_MIN);
});

test('app-or-site names: the desktop app first, the website only when asked for or not installed', () => {
  const a = parseIntent('open whatsapp');
  assert.equal(a.action, 'open_app');
  assert.deepEqual(a.params, { name: 'whatsapp', url: 'https://web.whatsapp.com' });
  { const w = parseIntent('open whatsapp web'); assert.equal(w.params.url, 'https://web.whatsapp.com'); assert.equal(w.params.name, 'whatsapp web'); } // no installed app is named that, so the site opens
  const c = parseIntent('open whatsapp in chrome');
  assert.equal(c.action, 'open_url');
  assert.equal(c.params.browser, 'chrome');
  assert.equal(parseIntent('open youtube').params.url, 'https://www.youtube.com'); // site fallback
});

// Training rounds (Nov 2026): phrases real users typed that used to misfire or fall to the slow AI.
const TRAINED = [
  ['opn chrome', 'open_app', { name: 'chrome' }],
  ['open the folder called projects', 'open_folder', { name: 'projects' }],
  ['search wikipedia for einstein', 'search_web', { query: 'einstein', site: 'wikipedia' }],
  ['search stack overflow for electron ipc', 'search_web', { query: 'electron ipc', site: 'stackoverflow' }],
  ['open c:', 'open_path', { path: 'C:\\' }],
  ['open d drive', 'open_path', { path: 'D:\\' }],
  ['open C:\\Users', 'open_path', { path: 'C:\\Users' }],
  ['open the pdf called resume', 'open_file', { query: 'resume', ext: 'pdf' }],
  ['open excel file budget', 'open_file', { query: 'budget', ext: 'xlsx' }],
  ['open calculator app', 'open_app', { name: 'calculator' }],
  ['open stack overflow', 'open_app', { name: 'stack overflow', url: 'https://stackoverflow.com' }],
  ['whats the weather', 'weather', { when: 'today' }], // answered in the app now (weather tool)
  ['weather in kigali', 'weather', { place: 'kigali', when: 'today' }],
  ['will it rain tomorrow in kigali', 'weather', { place: 'kigali', when: 'tomorrow' }],
  ['what is 15% of 200', 'quick', { op: 'calc', what: 'what is 15% of 200' }], // worked out locally now, no Google
  ['convert 5 miles to km', 'search_web', { query: '5 miles to km' }],
  ['what time is it', 'pc', { do: 'clock' }],
  ['files i downloaded yesterday', 'browse_files', { in: 'downloads', when: 'yesterday' }],
];
for (const [text, action, params] of TRAINED) {
  test(`trained: "${text}"`, () => {
    const r = parseIntent(text);
    assert.equal(r.action, action, JSON.stringify(r));
    assert.ok(r.confidence >= FAST_MIN, `confidence ${r.confidence} for ${text}`);
    for (const [k, v] of Object.entries(params)) assert.equal(r.params[k], v, `${k} in ${JSON.stringify(r.params)}`);
  });
}
// These used to run as a nonsense app name or a wrong search; now the AI decides.
for (const text of ['search for resume.pdf', 'open chrome in incognito', 'open chrome settings', 'open 3 chrome windows', 'open latest download', 'play the last song', 'close chrome and open edge', 'what is a pdf', 'what is windows 11', 'show hidden files', 'weather app']) {
  test(`trained, not fast: "${text}"`, () => {
    const r = parseIntent(text);
    assert.ok(r.action === 'unknown' || r.confidence < FAST_MIN, `${text} -> ${JSON.stringify(r)}`);
  });
}

test('"in movies" keeps the folder word so a real Movies folder can win (Stage 3)', async () => {
  const { parseFileQuery } = await import('./fileQuery.js');
  assert.equal(parseFileQuery('show me in movies').params.in, 'movies');
  assert.equal(parseFileQuery('show me 5 movies in movies folder').params.in, 'movies');
  assert.equal(parseFileQuery('show me latest movies in videos/movie folder').params.in, 'videos/movie');
  assert.equal(parseFileQuery('list of movies').params.in, undefined);
});

test('browser profiles: "in kevin chrome profile" is a profile, "in chrome" is only a browser', () => {
  const r = (t) => parseIntent(t);
  assert.deepEqual(r('open gmail in kevin chrome profile').params, { url: 'https://mail.google.com/mail/u/0/#inbox', browser: 'chrome', profile: 'kevin' });
  assert.equal(r('open gmail in kevins chrome').params.profile, 'kevins');
  assert.equal(r('open youtube with my work profile').params.profile, 'work');
  assert.deepEqual(r('search cats in kevin chrome profile').params, { query: 'cats', browser: 'chrome', profile: 'kevin' });
  assert.equal(r('open gmail in chrome').params.profile, undefined);
  assert.equal(r('open gmail in my chrome').params.profile, undefined);
  assert.equal(r('open gmail').params.profile, undefined);
});
test('typo in a site name ("gmain") and "chatgpt deskrop app"', () => {
  const g = parseIntent('open gmain in kevin chrome profile');
  assert.equal(g.action, 'open_url'); assert.equal(g.params.url, 'https://mail.google.com/mail/u/0/#inbox'); assert.ok(g.confidence >= FAST_MIN);
  const g2 = parseIntent('open gmain'); assert.equal(g2.action, 'open_app'); assert.equal(g2.params.name, 'gmail'); assert.equal(g2.params.url, 'https://mail.google.com/mail/u/0/#inbox');
  for (const t of ['open chatgpt deskrop app', 'open chatgpt desktop app']) { const x = parseIntent(t); assert.equal(x.action, 'open_app'); assert.ok(['chatgpt', 'chatgpt desktop'].includes(x.params.name)); assert.ok(x.params.url); }
});

test('favorites: settings parse, "my email" is a kind of app, named things are untouched', () => {
  const f = (t) => parseIntent(t);
  assert.equal(f('my favorite browser is chrome').action, 'favorite');
  assert.deepEqual(f('make kevin my default chrome profile').params, { op: 'set', category: 'profile', value: 'kevin', browser: 'chrome' });
  assert.equal(f('forget my favorite email').params.op, 'forget');
  assert.equal(f('what are my favorites').params.op, 'list');
  assert.equal(f('open my email').action, 'open_app'); assert.equal(f('open my email').params.name, 'email');
  assert.equal(f('open gmail').action, 'open_app'); assert.equal(f('open gmail').params.url, 'https://mail.google.com/mail/u/0/#inbox');
  assert.equal(f('open kevin chrome profile and search gmail').params.url, 'https://mail.google.com/mail/u/0/#inbox');
  assert.equal(f('open kevin chrome profile and search gmail').params.profile, 'kevin');
});

test('catalog commands', () => {
  assert.deepEqual([parseIntent('catalog').action, parseIntent('catalog').params], ['catalog', { op: 'summary' }]);
  assert.deepEqual(parseIntent('catalog spotify').params, { op: 'search', query: 'spotify' });
  assert.deepEqual(parseIntent('rescan catalog').params, { op: 'rescan' });
});

test('predict commands', () => {
  assert.deepEqual(parseIntent('predict spotfy').params, { op: 'predict', query: 'spotfy' });
  assert.deepEqual(parseIntent('why open spotfy').params, { op: 'predict', query: 'spotfy' });
  assert.notEqual(parseIntent('why is the sky blue').action, 'catalog');
});
