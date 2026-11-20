import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEntries } from './catalog.js';
import { predict } from './predict.js';
import { nameHash, labelOf, needsLabel, labelMessages, parseLabels, pickMessages, parsePick, CATS } from './label.js';
import { makeActions } from './actions.js';

const es = buildEntries([
  { kind: 'app', name: 'Brave', launch: { type: 'exe', target: 'b.exe' }, source: 's' },
  { kind: 'app', name: 'Notion', launch: { type: 'exe', target: 'n.exe' }, source: 's' },
  { kind: 'app', name: 'OneDrive', launch: { type: 'exe', target: 'od.exe' }, source: 's' },
  { kind: 'app', name: 'OneNote', launch: { type: 'exe', target: 'on.exe' }, source: 's' },
  { kind: 'file', name: 'cv.pdf', launch: { type: 'path', target: 'c:\\cv.pdf' }, source: 'r' },
]);

test('prompt has names only, numbered; never paths', () => {
  const m = labelMessages(es.slice(0, 2));
  assert.match(m[1].content, /0\. Brave\n1\. Notion/); assert.ok(!/b\.exe|n\.exe/.test(JSON.stringify(m)));
});

test('parseLabels keeps only valid answers', () => {
  const raw = 'Sure!\n[{"i":0,"cat":"browser","aliases":["Brave Browser","brav","x"],"verbs":["browse","open","BAD VERB!"]},{"i":1,"cat":"nonsense"},{"i":9,"cat":"notes"},{"i":2,"cat":"storage","aliases":"no"}]';
  const m = parseLabels(raw, es);
  assert.equal(m.size, 2);
  assert.deepEqual(m.get(es[0].id), { cat: 'browser', aliases: ['brave browser', 'brav'], verbs: ['browse', 'open'] });
  assert.deepEqual(m.get(es[2].id).aliases, []);
  assert.equal(parseLabels('not json', es).size, 0); assert.equal(parseLabels('[{bad', es).size, 0);
  assert.ok(CATS.includes('browser'));
});

test('labels are cached by name hash; a renamed app is relabeled; files are never labeled', () => {
  const e = { ...es[0], label: JSON.stringify({ cat: 'browser', aliases: [], verbs: [] }), label_hash: nameHash(es[0]) };
  assert.equal(needsLabel(e), false);
  assert.equal(needsLabel({ ...e, name: 'Brave Nightly' }), true);
  assert.equal(needsLabel(es[0]), true); assert.equal(needsLabel(es[4]), false);
  assert.equal(labelOf(es[0]), null);
});

test('a model alias and a category word now find the app', () => {
  const lab = (e, l) => ({ ...e, label: JSON.stringify(l), label_hash: nameHash(e) });
  const L = es.map((e) => (e.name === 'Notion' ? lab(e, { cat: 'notes', aliases: ['notes app'], verbs: [] }) : e.name === 'Brave' ? lab(e, { cat: 'browser', aliases: ['lion browser'], verbs: [] }) : e));
  assert.equal(predict(L, 'lion browser', {}).pick.entry.name, 'Brave');
  assert.equal(predict(L, 'browser', {}).pick.entry.name, 'Brave');
  assert.equal(predict(es, 'lion browser', {}).decision, 'none');
});

test('pick prompt and answer parsing', () => {
  assert.match(pickMessages('one', [{ name: 'OneDrive', kind: 'app', cat: 'storage' }, { name: 'OneNote', kind: 'app' }])[1].content, /0\. OneDrive \(app, storage\)\n1\. OneNote \(app\)/);
  assert.equal(parsePick('1', 3), 1); assert.equal(parsePick(' "0".', 3), 0); assert.equal(parsePick('none', 3), -1); assert.equal(parsePick('7', 3), -1); assert.equal(parsePick('I think OneNote', 3), -1);
});

function mk(over = {}) {
  const calls = [], asked = [];
  const d = { shell: { openPath: async () => '', openExternal: async () => {} }, resolveApp: () => null, spawnDetached: (...a) => calls.push(a), paths: {}, exists: () => true, isAllowed: () => true, catalog: () => es, labelOn: () => true, ask: async (m) => { asked.push(m); return over.answer ?? '1'; }, ...over.d };
  return { A: makeActions(d), calls, asked };
}
test('unsure open: ONE tiny model ask picks; "none"/off/failure keep the choose card', async () => {
  let t = mk({ answer: '1' });
  let r = await t.A.open_app({ name: 'one' });
  assert.equal(r.status, 'done'); assert.match(r.message, /picked by the model/); assert.equal(t.asked.length, 1);
  assert.ok(t.asked[0][1].content.includes('OneDrive') && !t.asked[0][1].content.includes('.exe'));
  assert.equal((await mk({ answer: 'none' }).A.open_app({ name: 'one' })).status, 'choose');
  assert.equal((await mk({ d: { labelOn: () => false } }).A.open_app({ name: 'one' })).status, 'choose');
  assert.equal((await mk({ d: { ask: async () => { throw new Error('offline'); } } }).A.open_app({ name: 'one' })).status, 'choose');
  t = mk({}); await t.A.open_app({ name: 'brave' }); assert.equal(t.asked.length, 0); // a clear winner never costs a model call
});

test('label commands', async () => {
  const { parseIntent } = await import('./intent.js');
  assert.deepEqual(parseIntent('label my pc').params, { op: 'label' });
  assert.deepEqual(parseIntent('stop labeling my pc').params, { op: 'label_off' });
  const t = mk({ d: { labelRun: async () => ({ done: 3, left: 1 }) } });
  assert.match((await t.A.catalog({ op: 'label' })).message, /only app NAMES.*Labeled 3 now, 1 still/);
});
