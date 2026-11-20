import test from 'node:test';
import assert from 'node:assert/strict';
import { shortcutLaunch, isShortcut } from './shortcut.js';

test('a shortcut with arguments (Spotify as a Chrome app) starts as the shortcut, not as plain chrome.exe', () => {
  const lnk = 'C:\\Users\\k\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Chrome Apps\\Spotify.lnk';
  assert.equal(shortcutLaunch(lnk, { target: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome_proxy.exe', args: '--profile-directory=Default --app-id=abc' }), lnk);
});
test('a plain shortcut starts its program; a missing or non-exe target gives nothing', () => {
  assert.equal(shortcutLaunch('a.lnk', { target: 'C:\\x\\app.exe', args: '' }), 'C:\\x\\app.exe');
  assert.equal(shortcutLaunch('a.lnk', { target: 'C:\\x\\app.exe', args: '  ' }), 'C:\\x\\app.exe');
  assert.equal(shortcutLaunch('a.lnk', { target: 'C:\\x\\app.exe' }, () => false), null);
  assert.equal(shortcutLaunch('a.lnk', { target: 'C:\\x\\readme.txt' }), null);
  assert.equal(shortcutLaunch('a.lnk', null), null);
  assert.ok(isShortcut('X.LNK') && !isShortcut('x.exe'));
});
