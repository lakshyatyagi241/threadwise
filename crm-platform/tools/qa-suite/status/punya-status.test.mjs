import test from 'node:test';
import assert from 'node:assert/strict';
import { render, verdictOf } from './punya-status.mjs';

test('no script is "not built", whatever else is said', () => {
  assert.equal(verdictOf({ built: false, checks: [], target: { met: true } }), 'notBuilt');
});
test('a failing check or an unmet target is "open findings", even when another target says met', () => {
  assert.equal(
    verdictOf({ built: true, checks: [{ status: 'fail' }], target: { met: true } }),
    'open',
  );
  assert.equal(verdictOf({ built: true, checks: [], target: { met: false } }), 'open');
});
test('only a met target is done; an unmeasured target (needs a live run) is never done', () => {
  assert.equal(
    verdictOf({ built: true, checks: [{ status: 'pass' }], target: { met: true } }),
    'done',
  );
  assert.equal(
    verdictOf({
      built: true,
      checks: [{ status: 'pass' }, { status: 'skip' }],
      target: { met: null },
    }),
    'needsRun',
  );
});
test('the report lists pending items and flags a sheet that says Completed', () => {
  const rows = [
    {
      item: 'A',
      claimed: 'Completed',
      target: 't',
      verdict: 'open',
      targetText: 'x',
      failing: [{ title: 'bad', evidence: ['f.ts:1'] }],
      skipped: 0,
      rerun: 'pnpm qa 1',
    },
    {
      item: 'B',
      claimed: 'Completed',
      target: 't',
      verdict: 'done',
      targetText: 'ok',
      failing: [],
      skipped: 0,
      rerun: 'pnpm qa 2',
    },
  ];
  const html = render(rows, { owner: 'X', commit: 'abc', generatedAt: 'now', live: false });
  assert.match(html, /Pending \(not done\): 1/);
  assert.match(html, /\(differs\)/);
  assert.match(html, /f\.ts:1/);
});
