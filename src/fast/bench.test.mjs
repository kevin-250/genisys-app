// Accuracy gate: no change may ship if these drop. Numbers come from src/fast/bench.mjs (a fake PC of ~70 entries).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runBench, CASES, HELDOUT } from './bench.mjs';

test('tuned set: opens the right thing, never the wrong one, never junk', async () => {
  const r = await runBench(CASES);
  assert.ok(r.top1Rate >= 0.97, `top-1 ${(r.top1Rate * 100).toFixed(1)}%`);
  assert.ok(r.wrongRate <= 0.01, `wrong ${(r.wrongRate * 100).toFixed(1)}%`);
  assert.equal(r.blind, 0);
});

test('held-out set (not used for tuning): still accurate', async () => {
  const r = await runBench(HELDOUT);
  assert.ok(r.top1Rate >= 0.85, `top-1 ${(r.top1Rate * 100).toFixed(1)}%`);
  assert.ok(r.wrongRate <= 0.02, `wrong ${(r.wrongRate * 100).toFixed(1)}%`);
  assert.equal(r.blind, 0);
});
