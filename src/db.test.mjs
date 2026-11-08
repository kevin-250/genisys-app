// Run with Electron's Node (has node:sqlite): ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/db.test.mjs
import assert from 'node:assert';
import * as db from './db.js';
db.openDb(':memory:');
db.remember('open my Downloads folder', ['start "" "%USERPROFILE%\Downloads"'], 'Opening');
db.remember('open the downloads folder', ['start "" "%USERPROFILE%\Downloads"'], 'Opening');
const m = db.listMemory(); assert.strictEqual(m.length, 1); assert.strictEqual(m[0].uses, 2);
assert.strictEqual(db.findMemory('open downloads folder')[0].id, m[0].id);
assert.strictEqual(db.findMemory('delete everything').length, 0);
db.useMemory(m[0].id, false); assert.strictEqual(db.findMemory('open downloads folder').length, 0); // broken commands stop matching
db.addProfile('interest', 'anime'); db.addProfile('interest', 'anime'); assert.strictEqual(db.listProfile().length, 1);
db.logTask('main', 'x', 2, 1.5, false); db.logTask('main', 'x', 1, 1, true);
assert.deepStrictEqual({ ...db.todayStats() }, { tasks: 2, steps: 3, ok: 1 }); assert.strictEqual(db.failsToday('x'), 1);
db.addNote('idea', 'hi'); assert.strictEqual(db.unseenNotes(), 1); db.markNotesSeen(); assert.strictEqual(db.unseenNotes(), 0);
db.setSetting('models', ['a']); assert.deepStrictEqual(db.getSetting('models'), ['a']); assert.strictEqual(db.getSetting('nope', 5), 5);
db.remember('open downloads folder', ['x'], ''); assert.ok(db.findExact('Open my downloads folder')); assert.ok(!db.findExact('open downloads')); assert.ok(!db.findExact('open downloads folder now please extra'));
// Stage 4 + 9
db.cachePut('open chrome', 'open_app', { name: 'chrome' }); db.cachePut('open chrome', 'open_app', { name: 'chrome' });
assert.deepStrictEqual(db.cacheGet('open chrome').params, { name: 'chrome' }); assert.strictEqual(db.cacheCount(), 1);
db.cacheUse('open chrome'); assert.strictEqual(db.cacheGet('open chrome').uses, 2);
db.cacheDrop('open chrome'); assert.strictEqual(db.cacheGet('open chrome'), null);
db.cachePut('a', 'x', {}); db.cachePut('b', 'x', {}); assert.strictEqual(db.cacheClear(), 2); assert.strictEqual(db.cacheCount(), 0);
db.scriptRecord('h1', 'cmd', 'Get-Date', true); assert.strictEqual(db.scriptsGood().length, 0);
db.scriptRecord('h1', 'cmd', 'Get-Date', true); db.scriptRecord('h1', 'cmd', 'Get-Date', false); assert.strictEqual(db.scriptsGood()[0].ok_runs, 2);
console.log('db: ok');
