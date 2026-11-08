import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScriptMessages, extractScript, hashScript } from './scriptFallback.js';

test('takes only the code block', () => {
  assert.deepEqual(extractScript('Here you go:\n```powershell\nStart-Process notepad\n```\nEnjoy!'), { script: 'Start-Process notepad' });
  assert.deepEqual(extractScript('```\nGet-Date\n```'), { script: 'Get-Date' });
});
test('NOT_FOUND, no block, two blocks, empty block', () => {
  assert.deepEqual(extractScript('NOT_FOUND: the file mousetrap'), { notFound: 'the file mousetrap' });
  assert.ok(extractScript('Just run Start-Process notepad').error);
  assert.ok(extractScript('```powershell\na\n```\n```powershell\nb\n```').error);
  assert.ok(extractScript('```powershell\n\n```').error);
});
test('prompt carries only the given context and rules', () => {
  const m = buildScriptMessages('open taxes', { personal_files: ['C:\\U\\Taxes 2024.pdf'] }, { name: 'open_file', prompt: '# open_file\nExample' });
  assert.match(m[1].content, /C:\\U\\Taxes 2024\.pdf/);
  assert.match(m[1].content, /SIMILAR EXAMPLE \(open_file\)/);
  assert.match(m[0].content, /NOT_FOUND/);
  assert.match(m[0].content, /NEVER invent a path/);
});
test('hash is stable and differs', () => { assert.equal(hashScript('a'), hashScript('a')); assert.notEqual(hashScript('a'), hashScript('b')); });
