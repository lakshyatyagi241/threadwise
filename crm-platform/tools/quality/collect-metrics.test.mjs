import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countBlocks, coverageByGroup, groupOf, summariseVitest } from './collect-metrics.mjs';

test('summariseVitest reads totals and counts files that did not pass', () => {
  const s = summariseVitest({
    numTotalTests: 10,
    numPassedTests: 7,
    numFailedTests: 2,
    numPendingTests: 1,
    numTodoTests: 0,
    testResults: [{ status: 'passed' }, { status: 'failed' }],
  });
  assert.deepEqual(s, { files: 2, failedFiles: 1, tests: 10, passed: 7, failed: 2, skipped: 1 });
});
test('groupOf sorts a path into rules, mappers, common, repositories, services, workers or other', () => {
  assert.equal(groupOf('src/modules/campaigns/campaign-rules.ts'), 'rules');
  assert.equal(groupOf('src/modules/x/y.rules.ts'), 'rules');
  assert.equal(groupOf('src/modules/crm/tags/tags.mapper.ts'), 'mappers');
  assert.equal(groupOf('src/common/errors/app-error.ts'), 'common');
  assert.equal(groupOf('src/modules/crm/tags/tags.repository.ts'), 'repositories');
  assert.equal(groupOf('src/modules/crm/tags/tags.service.ts'), 'services');
  assert.equal(groupOf('src/modules/x/y.processor.ts'), 'workers');
  assert.equal(groupOf('src/modules/x/y.ts'), 'other');
});
test('coverageByGroup adds lines and branches of the files in a group', () => {
  const c = (l, lc, b, bc) => ({
    lines: { total: l, covered: lc },
    branches: { total: b, covered: bc },
  });
  const g = coverageByGroup({
    total: c(0, 0, 0, 0),
    'src/a-rules.ts': c(10, 9, 4, 2),
    'src/b-rules.ts': c(10, 5, 0, 0),
    'src/c.service.ts': c(20, 0, 2, 0),
  });
  assert.deepEqual(g.rules, { files: 2, linePct: 70, branchPct: 50, lines: 20, branches: 4 });
  assert.equal(g.services.linePct, 0);
});
test('a group with no branches has no branch percentage', () => {
  const g = coverageByGroup({
    'src/a-rules.ts': { lines: { total: 4, covered: 4 }, branches: { total: 0, covered: 0 } },
  });
  assert.equal(g.rules.branchPct, null);
});
test('countBlocks counts it/test lines, including .each and .fails, and ignores other text', () => {
  const t = [
    "describe('x', () => {",
    "  it('a', () => {})",
    "  it.each([1,2])('b', () => {})",
    "  test('c', () => {})",
    "  it.fails('d', () => {})",
    "  // it('commented'",
    "  const split = 'it(x)';",
    '})',
  ].join('\n');
  assert.equal(countBlocks(t), 4);
});
