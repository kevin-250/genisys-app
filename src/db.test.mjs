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
// per-app know-how: a different wording for the same app still gets what worked there
db.catalogApply({ upserts: [{ id: 'store:wa', kind: 'store', name: 'WhatsApp', key: 'whatsapp' }] });
db.remember('send report.pdf to kevin on whatsapp', ['start "" whatsapp:'], 'ok');
db.scriptRecord('h2', 'share file with mom in whatsapp', 'Set-Clipboard -Path x', true);
const ah = db.appHints('send my cv to mom on WhatsApp');
assert.strictEqual(ah.length, 1); assert.strictEqual(ah[0].app, 'whatsapp');
assert.strictEqual(ah[0].mem.length, 1); assert.strictEqual(ah[0].scripts[0].script, 'Set-Clipboard -Path x');
assert.deepStrictEqual(db.appHints('open downloads folder'), []);
// chats are kept: "New chat" hides old turns from the AI, the history stays; tool uses are logged per tool
db.convoAdd('main', { task: 'old question', say: 'old answer', ts: Date.now() - 1000 });
db.convoClear('main');
assert.strictEqual(db.convoRecent('main').length, 0);
assert.ok(db.chatHistory(10).some((c) => c.task === 'old question'));
db.toolLog('timer', 'seconds 60', '1 minute timer'); db.toolLog('timer', 'op cancel', 'Cancelled', false);
assert.strictEqual(db.toolLogs('timer').length, 2); assert.strictEqual(db.toolCounts().timer.n, 2);
// chat sessions: named by the first question, turns in order, newest session first, search finds them
db.convoAdd('main', { task: 'plan my week', say: 'Here is a plan', sid: 's1', ts: Date.now() - 5000 });
db.convoAdd('main', { task: 'add gym on monday', say: 'Added', sid: 's1', ts: Date.now() - 4000 });
db.convoAdd('main', { task: 'what time is it in tokyo', say: '14:00', sid: 's2', ts: Date.now() - 1000 });
const ss = db.chatSessions(10);
assert.strictEqual(ss[0].s, 's2'); const s1 = ss.find((x) => x.s === 's1');
assert.strictEqual(s1.title, 'plan my week'); assert.strictEqual(s1.n, 2);
assert.deepStrictEqual(db.sessionTurns('s1').map((t) => t.task), ['plan my week', 'add gym on monday']);
assert.deepStrictEqual(db.chatSessions(10, 'gym').map((x) => x.s), ['s1']);
assert.strictEqual(db.lastSession('main').sid, 's2');
console.log('db: ok');
