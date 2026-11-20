import assert from 'node:assert';
import { keyOf, score, MATCH, appsIn } from './memory.js';

const APPS = ['WhatsApp', 'Microsoft Teams (work or school)', 'Google Chrome', 'Files', 'VLC media player', 'Telegram Desktop'];
assert.deepStrictEqual(appsIn('send that pdf to kevin on WhatsApp', APPS), ['whatsapp']);
assert.deepStrictEqual(appsIn('open googlechrome and teams', ['Google Chrome', 'Teams']), ['google chrome', 'teams']);
assert.deepStrictEqual(appsIn('show my files', APPS), []); // generic words are never an app
assert.deepStrictEqual(appsIn('whatsapping around', APPS), []); // whole words only

assert.strictEqual(keyOf('Open my Downloads folder!'), 'downloads folder open');
assert.strictEqual(keyOf('open the downloads folder please'), 'downloads folder open');
assert.ok(score(keyOf('open my downloads folder'), keyOf('open downloads folder')) >= MATCH);
assert.ok(score(keyOf('open my downloads folder'), keyOf('delete downloads folder')) < MATCH);
assert.ok(score(keyOf('how much free space'), keyOf('open vs code')) === 0);
assert.strictEqual(score('', 'x'), 0);
console.log('memory: ok');
