import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadActions, validateParams, fillTemplate, psQuote, routerLines, similarPrompt } from './registry.js';

const ACTIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'actions');

test('psQuote doubles single quotes, including curly ones', () => {
  assert.equal(psQuote("it's"), "'it''s'");
  assert.equal(psQuote('a\u2019b'), "'a\u2019\u2019b'");
  assert.equal(psQuote("x'; Remove-Item C:\\ -Recurse; '"), "'x''; Remove-Item C:\\ -Recurse; '''");
});
test('fillTemplate fills {{PLACEHOLDERS}} (text quoted, ints bare)', () => {
  const spec = { params: { path: { type: 'path' }, level: { type: 'int' } } };
  assert.equal(fillTemplate('Get-Item -LiteralPath {{PATH}}; $l = {{LEVEL}}', { path: "C:\\a b\\it's.txt", level: 30 }, spec), "Get-Item -LiteralPath 'C:\\a b\\it''s.txt'; $l = 30");
});
test('fillTemplate refuses line breaks, missing and leftover placeholders', () => {
  const spec = { params: { name: { type: 'string' } } };
  assert.throws(() => fillTemplate('x {{NAME}}', { name: 'a\nRemove-Item *' }, spec), /line break/);
  assert.throws(() => fillTemplate('x {{NAME}}', {}, spec), /needs a value/);
  assert.throws(() => fillTemplate('x {{OTHER}}', { name: 'a' }, spec), /needs a value/);
});
test('validateParams: types, ranges, enums, paths', () => {
  const spec = { restrictPaths: true, params: { level: { type: 'int', min: 0, max: 100 }, p: { type: 'path' }, site: { type: 'enum', values: ['youtube'], required: false } } };
  const ok = { level: 30, p: 'C:\\Users\\me\\a.txt' };
  assert.equal(validateParams(spec, ok, { isAllowed: () => true }).ok, true);
  assert.equal(validateParams(spec, { ...ok, level: 130 }).ok, false);
  assert.equal(validateParams(spec, { ...ok, level: 'abc' }).ok, false);
  assert.equal(validateParams(spec, { ...ok, site: 'evil' }).ok, false);
  assert.equal(validateParams(spec, { level: 1 }).ok, false);                                   // missing p
  assert.equal(validateParams(spec, { ...ok, p: 'C:\\Users\\me\\..\\..\\Windows\\x' }).ok, false); // traversal
  assert.equal(validateParams(spec, { ...ok, p: 'relative\\x.txt' }).ok, false);
  assert.equal(validateParams(spec, { ...ok, p: 'C:\\Users\\*.txt' }).ok, false);
  assert.equal(validateParams(spec, { ...ok, p: 'C:\\Windows\\x' }, { isAllowed: () => false }).ok, false);
  assert.deepEqual(validateParams(spec, { ...ok, extra: 'dropped' }, { isAllowed: () => true }).params, ok);
});

test('the real actions/ folder loads and every action is complete', () => {
  const reg = loadActions(fs, ACTIONS);
  assert.deepEqual(reg.bad, undefined, String(reg.bad));
  for (const n of ['open_app', 'open_url', 'search_web', 'open_folder', 'open_file', 'create_file', 'read_file', 'list_files', 'copy_file', 'move_file', 'delete_file', 'pc']) {
    const s = reg.get(n);
    assert.ok(s, n);
    assert.ok(s.description && s.prompt.includes('Example'), `${n} needs a description and prompt.md`);
  }
  assert.equal(reg.get('delete_file').destructive, true);
  assert.equal(reg.get('move_file').destructive, true);
  assert.ok(reg.get('open_path').internal);
  assert.ok(!routerLines(reg).some((l) => l.startsWith('open_path')));
});
test('templates fill ints bare and text quoted', () => {
  const s = { params: { level: { type: 'int' }, who: { type: 'string' } } };
  assert.equal(fillTemplate('$level = {{LEVEL}}; $w = {{WHO}}', { level: 30, who: "it's" }, s), "$level = 30; $w = 'it''s'");
});

// A brand-new action folder works with NO other code change (fake disk).
test('a dummy action folder is picked up by the loader', () => {
  const disk = {
    'A/hello/action.json': JSON.stringify({ name: 'hello', description: 'say hello to a name', triggers: ['hello', 'greet'], params: { who: { type: 'string' } }, template: 'template.ps1' }),
    'A/hello/template.ps1': 'Write-Output ("hi " + {{WHO}})',
    'A/hello/prompt.md': '# hello\nExample: {"action":"hello"}',
    'A/broken/action.json': '{ not json',
    'A/wrongname/action.json': JSON.stringify({ name: 'other', native: 'x' }),
  };
  const fake = {
    readdirSync: () => ['hello', 'broken', 'wrongname', 'notanaction'],
    existsSync: (p) => p.replace(/\\/g, '/') in disk,
    readFileSync: (p) => disk[p.replace(/\\/g, '/')],
  };
  const reg = loadActions(fake, 'A');
  assert.deepEqual([...reg.keys()], ['hello']);
  assert.equal(reg.bad.length, 2);
  const s = reg.get('hello');
  assert.equal(fillTemplate(s.templateText, { who: "o'neil" }, s), `Write-Output ("hi " + 'o''neil')`);
  assert.ok(routerLines(reg)[0].startsWith('hello(who:string)'));
  assert.equal(similarPrompt(reg, 'please greet bob').name, 'hello');
});
