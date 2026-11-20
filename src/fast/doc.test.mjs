import test from 'node:test';
import assert from 'node:assert/strict';
import { textToHtml, BINARY_DOCS, looksLikePdf } from './doc.js';
import { makeActions } from './actions.js';

test('text becomes a clean document: headings, bullets, paragraphs, escaped', () => {
  const h = textToHtml('# Kevin W\nDeveloper\n\n## Experience\n- Built <apps> & APIs\n- **Led** a team\n\nThanks', 'cv');
  assert.match(h, /<h1>Kevin W<\/h1>/); assert.match(h, /<p>Developer<\/p>/); assert.match(h, /<h2>Experience<\/h2>/);
  assert.match(h, /<ul><li>Built &lt;apps&gt; &amp; APIs<\/li><li><strong>Led<\/strong> a team<\/li><\/ul>/); assert.match(h, /<p>Thanks<\/p>/);
  assert.match(h, /Content-Security-Policy/); assert.ok(!/<script/i.test(textToHtml('<script>x</script>')));
});
test('looksLikePdf: %PDF- header and a real size, never plain text', () => {
  assert.equal(looksLikePdf(Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(300)])), true);
  assert.equal(looksLikePdf(Buffer.from('I have 5 years of experience')), false);
});
function rig(writePdf) {
  const files = []; const d = { shell: {}, resolveApp: () => null, spawnDetached() {}, paths: {}, findFiles: async () => ({ matches: [] }), exists: () => false, isAllowed: () => true, mkdirp() {}, writeFile: (p, c) => files.push([p, c]), writePdf };
  return { A: makeActions(d), files };
}
test('create_file: a .pdf is a real PDF (verified), never text under a .pdf name', async () => {
  let got; const r = rig(async (p, html) => { got = [p, html]; return { ok: true, size: 20480 }; });
  const x = await r.A.create_file({ path: 'C:\\Users\\k\\Documents\\kevin cv.pdf', content: '# Kevin\n- Node.js' });
  assert.equal(x.status, 'done'); assert.match(x.message, /real PDF/); assert.deepEqual(x.paths, ['C:\\Users\\k\\Documents\\kevin cv.pdf']);
  assert.match(got[1], /<h1>Kevin<\/h1>/); assert.equal(r.files.length, 0, 'no plain-text file was written');
  assert.equal((await rig(async () => ({ ok: false, error: 'bad output' })).A.create_file({ path: 'a.pdf', content: 'x' })).status, 'fall');
  assert.equal((await rig(undefined).A.create_file({ path: 'a.pdf', content: 'x' })).status, 'fall');
});
test('create_file: docx/xlsx/zip are refused instead of faked; txt still works', async () => {
  for (const ext of ['docx', 'xlsx', 'pptx', 'zip']) { const r = rig(); assert.equal((await r.A.create_file({ path: `a.${ext}`, content: 'x' })).status, 'fall', ext); assert.equal(r.files.length, 0); }
  const t = rig(); const ok = await t.A.create_file({ path: 'note.txt', content: 'hi' }); assert.equal(ok.status, 'done'); assert.deepEqual(t.files, [['note.txt', 'hi']]);
  assert.ok(BINARY_DOCS.has('docx'));
});
