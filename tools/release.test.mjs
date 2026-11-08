import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextVersion } from './release.mjs';

test('nextVersion bumps and accepts explicit versions', () => {
  assert.equal(nextVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(nextVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(nextVersion('1.2.3', 'major'), '2.0.0');
  assert.equal(nextVersion('1.2.3', '1.5.0'), '1.5.0');
  assert.equal(nextVersion('1.2.3', 'nope'), null);
  assert.equal(nextVersion('1.2.3', undefined), null);
});
