import assert from 'node:assert';
import { fuzzy } from './fuzzy.js';
assert.ok(fuzzy('freegut', 'Free.Guy.(NKIRI.COM)2021.Downloaded.from.NKIRI.COM.mkv') >= 0.6);
assert.ok(fuzzy('freegut', 'Free.Guy.(NKIRI.COM)2021.Downloaded.from.NKIRI.COM.mkv') > fuzzy('freegut', 'Scary.Movie.3.mkv'));
assert.strictEqual(fuzzy('curriculum vitae fiston', 'CURRICULUM VITAE Fiston.pdf'), 1);
assert.ok(fuzzy('freegut', 'Wreck-It Ralph (2012).mp4') < 0.6);
console.log('fuzzy: ok');
