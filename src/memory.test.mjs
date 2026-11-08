import assert from 'node:assert';
import { keyOf, score, MATCH } from './memory.js';

assert.strictEqual(keyOf('Open my Downloads folder!'), 'downloads folder open');
assert.strictEqual(keyOf('open the downloads folder please'), 'downloads folder open');
assert.ok(score(keyOf('open my downloads folder'), keyOf('open downloads folder')) >= MATCH);
assert.ok(score(keyOf('open my downloads folder'), keyOf('delete downloads folder')) < MATCH);
assert.ok(score(keyOf('how much free space'), keyOf('open vs code')) === 0);
assert.strictEqual(score('', 'x'), 0);
console.log('memory: ok');
