import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { unexplainedWords } from './fileQuery.js';
import { parseFileQuery, parseWhen, parseSizeRule, scanFiles, browseTable, summaryTable, dupesTable, hashSample } from './files.js';

const NOW = new Date(2026, 10, 12, 12, 0).getTime(); // Thu 12 Nov 2026
const q = (t) => parseFileQuery(t, NOW);
const is = (t, action, params) => assert.deepStrictEqual(q(t), { action, params }, t);

// ---- what different people type -> which tool, with which filters
is('search in all movies in videos , and show me all their date and arranges them from new ones to old ones', 'browse_files', { in: 'videos', kind: 'video', sort: 'arrived', order: 'desc' });
is('show me all movies in videos newest first', 'browse_files', { in: 'videos', kind: 'video', sort: 'arrived', order: 'desc' });
is('list my downloads from oldest to newest', 'browse_files', { in: 'downloads', sort: 'arrived', order: 'asc' });
is('biggest files in downloads', 'browse_files', { in: 'downloads', sort: 'size' });
is('top 10 largest videos', 'browse_files', { kind: 'video', sort: 'size', limit: 10 });
is('show me large movies i have in movie folder', 'browse_files', { in: 'movie', kind: 'video', sort: 'size', limit: 20 });
is('show me large movie files i have', 'browse_files', { kind: 'video', sort: 'size', limit: 20 });
is('show me the latest download', 'browse_files', { in: 'downloads', sort: 'arrived', order: 'desc', limit: 1 });
is('show me the newest movie in my movies folder', 'browse_files', { in: 'movies', kind: 'video', sort: 'arrived', order: 'desc', limit: 1 });
is('show pdfs in documents from last month', 'browse_files', { in: 'documents', ext: 'pdf', when: 'last month' });
is('list photos in pictures taken in october', 'browse_files', { in: 'pictures', kind: 'image', when: 'october' });
is('list songs in music a-z', 'browse_files', { in: 'music', kind: 'audio', sort: 'name' });
is('show zip files in downloads older than 6 months', 'browse_files', { in: 'downloads', ext: 'zip', when: 'older than 6 months' });
is('which videos in videos are over 2 gb', 'browse_files', { in: 'videos', kind: 'video', size: 'over 2 gb' });
is('show me files named avatar in videos', 'browse_files', { in: 'videos', name: 'avatar' });
is('list all mkv in videos', 'browse_files', { in: 'videos', ext: 'mkv' });
is('show screenshots from today', 'browse_files', { kind: 'image', when: 'today' });
is('list documents modified this week', 'browse_files', { kind: 'document', sort: 'modified', when: 'this week' });
is('show me what is in d drive', 'browse_files', { in: 'D:\\' });
is('show files in "C:\\Users\\me\\Videos\\Movies" sorted by size', 'browse_files', { in: 'C:\\Users\\me\\Videos\\Movies', sort: 'size' });
is('list files in C:\\DEV-PROJECTS bigger than 100mb', 'browse_files', { in: 'C:\\DEV-PROJECTS', size: 'bigger than 100mb' });
is('what is taking space in my downloads', 'file_summary', { in: 'downloads', group: 'folder' });
is('how many files of each type are on my desktop', 'file_summary', { in: 'desktop', group: 'kind' });
is('how many photos per month in pictures', 'file_summary', { in: 'pictures', kind: 'image', group: 'month' });
is('find duplicate photos in pictures', 'find_duplicates', { in: 'pictures', kind: 'image' });
is('show duplicates in downloads', 'find_duplicates', { in: 'downloads' });
// ...and what is NOT a file listing (other routes handle these)
for (const t of ['open the latest episode of avatar', 'play movie trigger', 'show me the weather', 'search elon musk net worth', 'what is my ip', 'delete old files in downloads', 'show desktop', 'download vlc'])
  assert.strictEqual(q(t), null, t);

// ---- time and size words
const d = (y, m, day) => new Date(y, m - 1, day).getTime();
assert.deepStrictEqual(parseWhen('october', NOW), { from: d(2026, 10, 1), to: d(2026, 11, 1) });
assert.deepStrictEqual(parseWhen('december', NOW), { from: d(2025, 12, 1), to: d(2026, 1, 1) }); // not in the future
assert.deepStrictEqual(parseWhen('2025', NOW), { from: d(2025, 1, 1), to: d(2026, 1, 1) });
assert.deepStrictEqual(parseWhen('last week', NOW), { from: d(2026, 11, 2), to: d(2026, 11, 9) });
assert.deepStrictEqual(parseWhen('since 2026-11-01', NOW), { from: d(2026, 11, 1) });
assert.strictEqual(parseWhen('older than 6 months', NOW).to, NOW - 180 * 86400000);
assert.strictEqual(parseWhen('blue moon', NOW), null);
assert.deepStrictEqual(parseWhen('5 november', NOW), { from: d(2026, 11, 5), to: d(2026, 11, 6) });
assert.deepStrictEqual(parseWhen('november 5th', NOW), { from: d(2026, 11, 5), to: d(2026, 11, 6) });
assert.deepStrictEqual(parseWhen('20 december', NOW), { from: d(2025, 12, 20), to: d(2025, 12, 21) }); // not in the future
assert.deepStrictEqual(parseWhen('1 october to 5 october', NOW), { from: d(2026, 10, 1), to: d(2026, 10, 6) }); // the end day is included
assert.deepStrictEqual(parseWhen('between 2026-10-01 and 2026-10-31', NOW), { from: d(2026, 10, 1), to: d(2026, 11, 1) });
assert.deepStrictEqual(parseWhen('2026-10-01 to 2026-10-31', NOW), { from: d(2026, 10, 1), to: d(2026, 11, 1) });
assert.deepStrictEqual(parseWhen('from june to august', NOW), { from: d(2026, 6, 1), to: d(2026, 9, 1) });
assert.deepStrictEqual(parseSizeRule('between 100mb and 1gb'), { min: 100 * 1024 ** 2, max: 1024 ** 3 });
assert.deepStrictEqual(parseSizeRule('100mb to 1gb'), { min: 100 * 1024 ** 2, max: 1024 ** 3 });
// the gate: the code only runs a file request itself when it acted on every word; anything else goes to the model
assert.deepStrictEqual(unexplainedWords('show me tiny pictures', { kind: 'image' }), ['tiny']);
assert.deepStrictEqual(unexplainedWords('list all mkv in videos', { in: 'videos', ext: 'mkv' }), []);
assert.deepStrictEqual(unexplainedWords('show pdfs in documents from last month', { in: 'documents', ext: 'pdf', when: 'last month' }), []);
assert.deepStrictEqual(unexplainedWords('show me moveis with horror', { name: 'horror' }), ['moveis']);
assert.ok(unexplainedWords('show me files that are not videos', { kind: 'video' }).includes('not')); // a negation the table cannot express
assert.ok(unexplainedWords('the 2 newest videos and 2 biggest videos', { kind: 'video', sort: 'size', limit: 2 }).length); // two requests in one
assert.deepStrictEqual(unexplainedWords('list videos from oldest to newest', { kind: 'video', sort: 'arrived', order: 'asc' }), []);
assert.ok(unexplainedWords('files between 1 november and 7 november', { limit: 1 }).includes('november')); // dates the parser dropped
assert.deepStrictEqual(unexplainedWords('show me images from 2026-10-15', { kind: 'image', when: '2026-10-15' }), []);
assert.strictEqual(q('show me files between 1 november and 7 november').params.limit, undefined); // "1 november" is a date, not "show 1 file"
assert.deepStrictEqual(parseSizeRule('over 2 gb'), { min: 2 * 1024 ** 3 });
assert.deepStrictEqual(parseSizeRule('under 500mb'), { max: 500 * 1024 ** 2 });

// ---- the real tools on a real folder
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gfiles-'));
const put = (rel, bytes, daysAgo) => {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, bytes);
  const t = new Date(NOW - daysAgo * 86400000);
  fs.utimesSync(f, t, t);
};
put('Movies\\Old.Film.mkv', Buffer.alloc(3000, 1), 300);
put('Movies\\New.Show.S01E01.mkv', Buffer.alloc(5000, 2), 1);
put('clip.mp4', Buffer.alloc(1000, 3), 10);
put('notes.txt', 'hi', 2);
put('Copies\\clip (1).mp4', Buffer.alloc(1000, 3), 5);
put('node_modules\\skip.mp4', Buffer.alloc(10, 4), 1); // skipped folder
const { files, partial } = await scanFiles(root, fs.promises);
assert.strictEqual(partial, false);
assert.strictEqual(files.length, 5);
// "arrived" is the creation time (set by the OS), so sort by modified to get a stable order in a test
const b = browseTable(files, { kind: 'video', sort: 'modified' }, root, NOW);
assert.deepStrictEqual(b.table.rows.map((r) => r[0]), ['New.Show.S01E01.mkv', 'clip (1).mp4', 'clip.mp4', 'Old.Film.mkv']);
assert.deepStrictEqual(b.table.columns, ['Name', 'Modified']); // size / folder only when asked
assert.deepStrictEqual(browseTable(files, { kind: 'video', sort: 'modified', show: 'size,folder' }, root, NOW).table.columns, ['Name', 'Modified', 'Size', 'Folder']);
// "only 10" / "just 5" / "show me 10 movies" limit the rows; bare "size" is a column, not a sort
is('search in all movies i have latest i have only 10', 'browse_files', { kind: 'video', sort: 'arrived', order: 'desc', limit: 10 });
is('show me 10 movies', 'browse_files', { kind: 'video', limit: 10 });
is('show the last 10 movies i added', 'browse_files', { kind: 'video', sort: 'arrived', order: 'desc', limit: 10 });
is('10 newest files in downloads with size', 'browse_files', { in: 'downloads', sort: 'arrived', order: 'desc', limit: 10, show: 'size' });
is('list my movies and where they are', 'browse_files', { kind: 'video', show: 'folder' });
is('show me 2025 photos', 'browse_files', { kind: 'image', when: '2025' });
assert.match(b.message, /^4 video files in .* by date modified, newest first$/);
assert.strictEqual(browseTable(files, { sort: 'size', limit: 1 }, root, NOW).table.rows[0][0], 'New.Show.S01E01.mkv');
assert.strictEqual(browseTable(files, { ext: 'mkv', size: 'under 4kb' }, root, NOW).table.rows.length, 1);
assert.strictEqual(browseTable(files, { kind: 'audio' }, root, NOW).table, null);
assert.match(browseTable(files, { when: 'blue moon' }, root, NOW).error, /didn't understand/);
const s = summaryTable(files, { group: 'folder' }, root, NOW);
assert.deepStrictEqual(s.table.rows.map((r) => [r[0], r[1]]), [['Movies', '2'], ['(top level)', '2'], ['Copies', '1']]);
const dup = await dupesTable(files, {}, root, (f) => hashSample(f, fs.promises, createHash), NOW);
assert.strictEqual(dup.table.rows.length, 2);
assert.match(dup.message, /^1 sets of duplicate files .* 1000 B could be freed$/);
fs.rmSync(root, { recursive: true, force: true });
console.log('files: ok');
// The conversation of 12 Nov 2026: "old" / "new" and a count anywhere in the sentence, "i have" means this PC
is('search  movies i have old films have only 10', 'browse_files', { kind: 'video', sort: 'arrived', order: 'asc', limit: 10 });
is('search  movies folder i have old films have only 10', 'browse_files', { kind: 'video', sort: 'arrived', order: 'asc', limit: 10 });
is('i have many films list new ones only 7', 'browse_files', { kind: 'video', sort: 'arrived', order: 'desc', limit: 7 });
is('show 3 old movies', 'browse_files', { kind: 'video', sort: 'arrived', order: 'asc', limit: 3 });
is('show files over 2 gb in downloads', 'browse_files', { in: 'downloads', size: 'over 2 gb' });
is('show photos from last 30 days', 'browse_files', { kind: 'image', sort: 'arrived', order: 'desc', when: 'last 30 days' });
assert.strictEqual(q('show episode 3 of trigger'), null); // one episode: open it, not a table
