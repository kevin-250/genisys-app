import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEntries } from './catalog.js';
import { predict } from './predict.js';
import { makeActions } from './actions.js';
import { parseIntent } from './intent.js';

const es = buildEntries([
  { kind: 'app', name: 'Spotify', launch: { type: 'exe', target: 'sp.exe' }, source: 's' },
  { kind: 'app', name: 'Spotify Beta', launch: { type: 'exe', target: 'spb.exe' }, source: 's' },
  { kind: 'app', name: 'Notepad', launch: { type: 'exe', target: 'np.exe' }, source: 's' },
  { kind: 'app', name: 'Notes Plus', launch: { type: 'exe', target: 'npl.exe' }, source: 's' },
]);
const idOf = (n) => es.find((e) => e.name === n).id;

function mk() {
  const calls = [], learn = {}, conf = [];
  const d = {
    shell: { openPath: async () => '', openExternal: async () => {} }, resolveApp: () => null, spawnDetached: (...a) => calls.push(a[0]), paths: {}, exists: () => true, isAllowed: () => true,
    catalog: () => es, prefs: () => ({}),
    learned: () => Object.fromEntries(Object.entries(learn).map(([k, v]) => [k, { ...v }])),
    learn: (q, id, dw, dl) => { const k = `${q}|${id}`; const c = learn[k] || (learn[k] = { wins: 0, losses: 0 }); c.wins = Math.max(0, c.wins + dw); c.losses = Math.max(0, c.losses + dl); },
    confuse: (c) => conf.push(c), confusions: () => conf.map((c, i) => ({ ts: i, query: c.query, wrong: c.wrong, right_name: c.right, how: c.how })),
  };
  return { A: makeActions(d), calls, learn, conf };
}

test('a request that was opened as X before keeps meaning X (learned alias)', () => {
  const learned = { [`spotf|${idOf('Spotify Beta')}`]: { wins: 3, losses: 0 } };
  assert.equal(predict(es, 'spotf', { learned }).ranked[0].entry.name, 'Spotify Beta');
  assert.ok(predict(es, 'spotf', {}).ranked[0].entry.name !== undefined);
});

test('a loss pushes that pick below the alternative for that request', () => {
  const base = predict(es, 'spotify', {}).ranked[0];
  assert.equal(base.entry.name, 'Spotify');
  const after = predict(es, 'spotify', { learned: { [`spotify|${idOf('Spotify')}`]: { wins: 0, losses: 2 } } }).ranked[0];
  assert.equal(after.entry.name, 'Spotify Beta');
  assert.equal(predict(es, 'spotify', {}, { exclude: [idOf('Spotify')] }).ranked[0].entry.name, 'Spotify Beta');
});

test('"no, the other one": records the loss, logs it, opens the next best; nothing recent = no-op', async () => {
  const t = mk();
  assert.equal((await t.A.wrong_pick({})).status, 'fall');
  await t.A.open_app({ name: 'spotify' });
  assert.deepEqual(t.calls, ['sp.exe']); assert.equal(t.learn[`spotify|${idOf('Spotify')}`].wins, 1);
  const r = await t.A.wrong_pick({});
  assert.equal(t.learn[`spotify|${idOf('Spotify')}`].wins, 0); assert.equal(t.learn[`spotify|${idOf('Spotify')}`].losses, 1);
  assert.ok(['done', 'choose'].includes(r.status));
  assert.equal(t.conf[0].wrong, 'Spotify');
  // and the next "open spotify" no longer picks the one you rejected
  await t.A.open_app({ name: 'spotify' });
  assert.notEqual(t.calls.at(-1), 'sp.exe');
});

test('"no, I meant notepad": opens it, teaches the original request', async () => {
  const t = mk();
  await t.A.open_app({ id: idOf('Notes Plus'), q: 'notes' });
  const first = t.calls[0];
  const r = await t.A.wrong_pick({ text: 'notepad' });
  assert.equal(r.status, 'done'); assert.equal(t.calls.at(-1), 'np.exe'); assert.match(r.message, /Noted/);
  assert.equal(t.learn[`notes|${idOf('Notepad')}`].wins, 2);
  assert.equal(t.conf[0].right, 'Notepad'); assert.ok(first);
});

test('a card choice teaches the request', async () => {
  const t = mk();
  await t.A.open_app({ id: idOf('Notes Plus'), q: 'notes' });
  assert.ok(t.learn[`notes|${idOf('Notes Plus')}`].wins >= 1);
});

test('confusion log and the correction phrases', async () => {
  const t = mk();
  assert.match((await t.A.catalog({ op: 'confusions' })).message, /No mistakes recorded/);
  await t.A.open_app({ name: 'spotify' }); await t.A.wrong_pick({});
  assert.match((await t.A.catalog({ op: 'confusions' })).message, /you said "spotify".*I opened Spotify/);
  for (const s of ['no', 'no, the other one', 'the other one', 'wrong one', 'not that', 'another one', 'nope']) assert.equal(parseIntent(s).action, 'wrong_pick', s);
  assert.deepEqual(parseIntent('no, I meant notepad').params, { text: 'notepad' });
  assert.deepEqual(parseIntent('not that, open notepad').params, { text: 'notepad' });
  assert.equal(parseIntent('show my mistakes').params.op, 'confusions');
  assert.notEqual(parseIntent('no way is that true, explain it').action, 'wrong_pick');
});
