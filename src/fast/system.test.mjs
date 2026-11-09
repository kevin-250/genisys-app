import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSystem, confirmText, makeSystem } from './system.js';
import { parseIntent } from './intent.js';

const p = (t) => parseSystem(t);
test('everyday controls are understood without AI', () => {
  assert.deepEqual(p('volume 40'), { do: 'volume', value: 40 });
  assert.deepEqual(p('set volume to 40%'), { do: 'volume', value: 40 });
  assert.deepEqual(p('put volume at 40'), { do: 'volume', value: 40 });
  assert.deepEqual(p('turn it up'), { do: 'volume_up' });
  assert.deepEqual(p('mute'), { do: 'mute' });
  assert.deepEqual(p('open camera'), { do: 'camera' });
  assert.deepEqual(p('take a screenshot'), { do: 'screenshot' });
  assert.deepEqual(p('brightness 70'), { do: 'brightness', value: 70 });
  assert.deepEqual(p('next song'), { do: 'next_track' });
  assert.deepEqual(p('pause'), { do: 'play_pause' });
  assert.deepEqual(p('close spotify'), { do: 'close_app', name: 'spotify' });
  assert.deepEqual(p('force close chrome'), { do: 'close_app', name: 'chrome', value: 1 });
  assert.deepEqual(p('close all apps'), { do: 'close_all' });
  assert.deepEqual(p('shut down in 30 minutes'), { do: 'shutdown_in', value: 30 });
  assert.deepEqual(p('cancel shutdown'), { do: 'cancel_shutdown' });
  assert.deepEqual(p('shutdown'), { do: 'shutdown' });
  assert.deepEqual(p('sleep'), { do: 'sleep' });
  assert.deepEqual(p('lock pc'), { do: 'lock' });
  assert.deepEqual(p('turn off bluetooth'), { do: 'bluetooth_off' });
  assert.deepEqual(p('dark mode'), { do: 'dark_mode' });
  assert.deepEqual(p('open bluetooth settings'), { do: 'open_settings', name: 'bluetooth' });
  assert.deepEqual(p('battery'), { do: 'battery' });
  assert.deepEqual(p('empty recycle bin'), { do: 'empty_recycle_bin' });
});
test('normal sentences and app settings are left alone', () => {
  for (const t of ['open chrome', 'search volume knob', 'open chrome settings', 'close it', 'play mouse trap episode 3', 'volume 500']) assert.equal(p(t), null, t);
});
test('parseIntent routes controls to the pc action', () => {
  const r = parseIntent('Please put the volume at 40%');
  assert.equal(r.action, 'pc'); assert.deepEqual(r.params, { do: 'volume', value: 40 }); assert.ok(r.confidence >= 0.75);
  assert.equal(parseIntent('open spotify').action, 'open_app');
});
test('risky controls ask first, safe ones do not', async () => {
  assert.match(confirmText({ do: 'shutdown' }), /Shut down/);
  assert.match(confirmText({ do: 'shutdown_in', value: 30 }), /30 minutes/);
  assert.equal(confirmText({ do: 'lock' }), '');
  const launched = [];
  const run = makeSystem({ launch: (e, a) => launched.push([e, ...a]), helper: {}, os: {}, openExternal: async () => {} });
  assert.equal((await run({ do: 'shutdown' })).status, 'confirm');
  assert.equal(launched.length, 0);
  assert.equal((await run({ do: 'shutdown' }, true)).status, 'done');
  assert.deepEqual(launched[0], ['shutdown.exe', '/s', '/t', '5']);
  assert.equal((await run({ do: 'volume' })).status, 'fall'); // needs a number
});

import { splitTask } from './intent.js';
test('two-part commands split, and every part must be understood', () => {
  assert.deepEqual(splitTask('open spotify and put volume at 40%'), ['open spotify', 'put volume at 40%']);
  assert.deepEqual(splitTask('mute, then lock pc'), ['mute', 'lock pc']);
  assert.equal(splitTask('open spotify'), null);
  const parts = splitTask('open spotify and put volume at 40%').map((p) => parseIntent(p));
  assert.deepEqual(parts.map((r) => r.action), ['open_app', 'pc']);
  assert.ok(parts.every((r) => r.confidence >= 0.75));
  const cats = splitTask('search cats and dogs').map((p) => parseIntent(p));
  assert.ok(!cats.every((r) => r.action !== 'unknown' && r.confidence >= 0.75), 'dogs alone is not a command');
});
