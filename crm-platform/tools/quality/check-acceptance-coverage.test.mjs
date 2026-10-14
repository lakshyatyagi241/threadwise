import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverage, renderReport, scanText } from './check-acceptance-coverage.mjs';

test('reads criterion ids, feature plus number, lists, and feature-only mentions', () => {
  const e = scanText(`
    it('AC-TW-A-001-3 x')
    it('TW-B-002 #1: y')
    it('TW-B-002 #2 and #4: z')
    it('TW-B-003 #5, #6')
    // feature only: TW-C-004
  `);
  assert.deepEqual([...e.criteria].sort(), [
    'AC-TW-A-001-3',
    'AC-TW-B-002-1',
    'AC-TW-B-002-2',
    'AC-TW-B-002-4',
    'AC-TW-B-003-5',
    'AC-TW-B-003-6',
  ]);
  assert.ok(e.features.has('TW-C-004') && e.features.has('TW-A-001'));
  assert.ok(!e.criteria.has('AC-TW-C-004-1'));
});
test('a hash that follows other text is not a criterion number', () => {
  const e = scanText("it('TW-D-001 handles issue #12 later')");
  assert.equal(e.criteria.size, 0);
  assert.ok(e.features.has('TW-D-001'));
});
const list = [
  { id: 'AC-TW-A-001-1', feature: 'TW-A-001', domain: 'a', priority: 'P0' },
  { id: 'AC-TW-A-001-2', feature: 'TW-A-001', domain: 'a', priority: 'P0' },
  { id: 'AC-TW-A-002-1', feature: 'TW-A-002', domain: 'a', priority: 'P1' },
  { id: 'AC-TW-B-001-1', feature: 'TW-B-001', domain: 'b', priority: 'P0' },
];
test('counts proven, feature-only and none by priority and domain', () => {
  const cov = coverage(list, {
    criteria: new Set(['AC-TW-A-001-1', 'AC-TW-X-009-1']),
    features: new Set(['TW-A-001', 'TW-A-002']),
  });
  assert.deepEqual(cov.byPriority.P0, { total: 3, proven: 1, featureOnly: 1, none: 1 });
  assert.deepEqual(cov.byPriority.P1, { total: 1, proven: 0, featureOnly: 1, none: 0 });
  assert.equal(cov.byDomain.find((d) => d.domain === 'a').proven, 1);
  assert.deepEqual(cov.unknownRefs, ['AC-TW-X-009-1']);
});
test('the report states the totals and lists unknown references', () => {
  const cov = coverage(list, {
    criteria: new Set(['AC-TW-A-001-1', 'AC-TW-X-009-1']),
    features: new Set(),
  });
  const md = renderReport(cov, { features: 3 });
  assert.match(md, /Criteria: \*\*4\*\*/);
  assert.match(md, /AC-TW-X-009-1/);
  assert.match(md, /\| P0 \| 3 \| 1 \| 0 \| 2 \| 33.3% \|/);
});
