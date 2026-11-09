import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newer, pickAsset } from './version.js';

test('newer compares versions', () => {
  assert.equal(newer('v1.2.0', '1.1.1'), true);
  assert.equal(newer('1.1.10', '1.1.9'), true);
  assert.equal(newer('1.1.1', '1.1.1'), false);
  assert.equal(newer('1.0.9', '1.1.0'), false);
  assert.equal(newer('2', '1.9.9'), true);
});

test('only a checksummed GitHub installer is accepted', () => {
  const sha = 'a'.repeat(64);
  const rel = (asset) => ({ tag_name: 'v1.2.0', assets: [asset] });
  const good = { name: 'Genisys-Setup.exe', size: 10, digest: `sha256:${sha}`, browser_download_url: 'https://github.com/kevin-250/genisys-app/releases/download/v1.2.0/Genisys-Setup.exe' };
  assert.deepEqual(pickAsset(rel(good)), { url: good.browser_download_url, size: 10, sha256: sha, version: '1.2.0' });
  assert.equal(pickAsset(rel({ ...good, digest: undefined })), null);
  assert.equal(pickAsset(rel({ ...good, browser_download_url: 'https://evil.example/Genisys-Setup.exe' })), null);
  assert.equal(pickAsset(rel({ ...good, name: 'Other.exe' })), null);
});
