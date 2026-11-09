import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadActions } from './registry.js';
import { validateRouterReply, buildRouterMessages, expandPath } from './router.js';

const reg = loadActions(fs, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'actions'));
const env = { USERPROFILE: 'C:\\Users\\me' };
const ctx = { env, isAllowed: (p) => p.toLowerCase().startsWith('c:\\users\\me\\') };
const v = (raw) => validateRouterReply(raw, reg, ctx);

test('valid answers', () => {
  assert.deepEqual(v('{"action":"pc","params":{"do":"volume","value":30}}'), { ok: true, action: 'pc', params: { do: 'volume', value: 30 } });
  assert.deepEqual(v('Sure!\n```json\n{"action":"search_web","params":{"query":"cats"}}\n```'), { ok: true, action: 'search_web', params: { query: 'cats' } });
  assert.deepEqual(v('{"action":"unknown"}'), { ok: true, action: 'unknown', params: {} });
  assert.equal(v('{"action":"script"}').action, 'script');
  assert.equal(v('{"action":"old"}').action, 'old');
});
test('bad JSON', () => { for (const raw of ['', 'nope', '{ action: open_app }', '{"action": ']) assert.equal(v(raw).ok, false, raw); });
test('unknown or internal action', () => {
  assert.equal(v('{"action":"format_disk","params":{}}').ok, false);
  assert.equal(v('{"action":"open_path","params":{"path":"C:\\\\Users\\\\me\\\\a.txt"}}').ok, false); // internal only
  assert.equal(v('{"params":{}}').ok, false);
  assert.equal(v('{"action":42}').ok, false);
});
test('missing or wrong-typed params', () => {
  assert.equal(v('{"action":"open_app","params":{}}').ok, false);
  assert.equal(v('{"action":"pc","params":{"do":"volume","value":"loud"}}').ok, false);
  assert.equal(v('{"action":"pc","params":{"do":"format_c"}}').ok, false);
  assert.equal(v('{"action":"open_url","params":{"url":"javascript:alert(1)"}}').ok, false);
  assert.equal(v('{"action":"open_url","params":{"url":"ftp://x.com"}}').ok, false);
});
test('path traversal and paths outside the allowed folders', () => {
  assert.equal(v('{"action":"delete_file","params":{"path":"C:\\\\Users\\\\me\\\\..\\\\..\\\\Windows\\\\win.ini"}}').ok, false);
  assert.equal(v('{"action":"delete_file","params":{"path":"%USERPROFILE%\\\\..\\\\..\\\\Windows"}}').ok, false);
  assert.equal(v('{"action":"read_file","params":{"path":"C:\\\\Windows\\\\win.ini"}}').ok, false);
  assert.equal(v('{"action":"read_file","params":{"path":"notes.txt"}}').ok, false);
  assert.equal(v('{"action":"read_file","params":{"path":"C:\\\\Users\\\\me\\\\Documents\\\\notes.txt"}}').ok, true);
});
test('~ and %VARS% are expanded before checking', () => {
  assert.equal(expandPath('~/Desktop/a.txt', env), 'C:\\Users\\me\\Desktop\\a.txt');
  assert.equal(v('{"action":"read_file","params":{"path":"%USERPROFILE%\\\\Desktop\\\\a.txt"}}').params.path, 'C:\\Users\\me\\Desktop\\a.txt');
});
test('the prompt is small: actions + command only', () => {
  const lines = ['open_app(name:string) - open a program'];
  const m = buildRouterMessages(lines, 'open chrome', 'desktop=C:\\Users\\me\\Desktop');
  assert.equal(m.length, 2);
  assert.equal(m[1].content, 'open chrome');
  assert.ok(m[0].content.includes('open_app(name:string)') && m[0].content.length < 1500);
});
