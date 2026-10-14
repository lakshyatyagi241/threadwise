import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCatalogue, validateFile } from './check-edge-cases.mjs';

const good = (over = {}) => ({
  id: 'EC-contacts-001', feature: 'create', category: 'input', scenario: 's', expected: 'e',
  priority: 'P1', status: 'gap', ...over,
});
const doc = (cases, over = {}) => ({ module: 'contacts', tier: 'P1', cases, ...over });

const run = (docs, { modules = ['contacts'], texts = {}, strict = true } = {}) =>
  checkCatalogue({
    strict,
    root: '/r', catalogueDir: '/c', modulesDir: '/m',
    readJson: (p) => docs[p.slice(3)],
    listDir: (d) => (d === '/m' ? modules : Object.keys(docs)),
    exists: (p) => p in texts,
    readText: (p) => texts[p],
  });

test('a valid file has no problems', () => {
  assert.deepEqual(validateFile(doc([good()]), 'contacts.json'), []);
});
test('bad id, bad enum, unknown key and missing tests are reported', () => {
  const e = validateFile(doc([good({ id: 'x', category: 'nope', extra: 1, status: 'covered' })]), 'contacts.json');
  assert.ok(e.some((m) => m.includes('id must look like')));
  assert.ok(e.some((m) => m.includes('category must be')));
  assert.ok(e.some((m) => m.includes('unknown key "extra"')));
  assert.ok(e.some((m) => m.includes('covered needs')));
});
test('the id must carry the module name and the file must match the module', () => {
  const e = validateFile(doc([good({ id: 'EC-other-001' })]), 'x.json');
  assert.ok(e.some((m) => m.includes('must start with EC-contacts-')));
  assert.ok(e.some((m) => m.includes('does not match the file name')));
});
test('a module with no catalogue file is an error', () => {
  const r = run({ 'contacts.json': doc([good()]) }, { modules: ['contacts', 'deals'] });
  assert.ok(r.errors.some((m) => m.includes('"deals" has no deals.json')));
});
test('a covered case needs its test file, and the file must mention the id or the title', () => {
  const covered = good({ status: 'covered', tests: [{ file: 't/a.ts' }, { file: 't/b.ts', match: 'refuses 256' }, { file: 't/missing.ts' }] });
  const r = run({ 'contacts.json': doc([covered]) }, { texts: { '/r/t/a.ts': "it('[EC-contacts-001] x')", '/r/t/b.ts': "it('nothing')" } });
  assert.ok(r.errors.some((m) => m.includes('t/missing.ts does not exist')));
  assert.ok(r.errors.some((m) => m.includes('t/b.ts does not contain the title "refuses 256"')));
  assert.ok(!r.errors.some((m) => m.includes('t/a.ts')));
});
test('duplicate ids across files are reported', () => {
  const r = run({ 'contacts.json': doc([good(), good()]) });
  assert.ok(r.errors.some((m) => m.includes('duplicate id EC-contacts-001')));
});
test('a P0 module fails on an untested P0 case but a P1 module does not', () => {
  const p0 = run({ 'contacts.json': doc([good({ priority: 'P0' })], { tier: 'P0' }) });
  assert.ok(p0.errors.some((m) => m.includes('untested P0')));
  const lenient = run({ 'contacts.json': doc([good({ priority: 'P0' })], { tier: 'P0' }) }, { strict: false });
  assert.deepEqual(lenient.errors, []);
  assert.equal(lenient.warnings.length, 1);
  const p1 = run({ 'contacts.json': doc([good({ priority: 'P0' })]) });
  assert.deepEqual(p1.errors, []);
  assert.equal(p1.rows[0].p0gaps, 1);
});
