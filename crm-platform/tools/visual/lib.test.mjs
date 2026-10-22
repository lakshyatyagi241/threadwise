import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverage, coverageGate, flakeGate, flakiness } from './lib.mjs';

const sc = (id, priority) => ({ id, priority, url: '/' + id, viewport: 'desktop' });
const report = (tests) => ({
  suites: [
    {
      file: 'e2e/visual/visual.spec.ts',
      specs: tests.map(([title, statuses, status = 'expected']) => ({
        title,
        file: 'e2e/visual/visual.spec.ts',
        tests: [{ projectName: 'visual', status, results: statuses.map((s) => ({ status: s })) }],
      })),
    },
  ],
});

test('coverage counts a scenario once it has a baseline, per priority, and lists what is missing', () => {
  const scenarios = [sc('a', 'P0'), sc('b', 'P0'), sc('c', 'P1'), sc('d', 'P2')];
  const cov = coverage({ scenarios, baselines: ['a.png', 'c.png'] });
  assert.equal(cov.byPriority.P0.coverage, 0.5);
  assert.equal(cov.byPriority.P1.coverage, 1);
  assert.deepEqual(
    cov.missing.map((m) => m.id),
    ['b'],
  );
});

test('the gate blocks a P0 under 95% as Critical and a P1 as High, and passes at the target', () => {
  const scenarios = Array.from({ length: 20 }, (_, i) => sc(`p${i}`, 'P0'));
  const ok = coverage({ scenarios, baselines: scenarios.slice(0, 19).map((s) => `${s.id}.png`) });
  assert.deepEqual(coverageGate(ok), []);
  const low = coverage({ scenarios, baselines: scenarios.slice(0, 18).map((s) => `${s.id}.png`) });
  assert.equal(coverageGate(low)[0].severity, 'Critical');
  const p1 = coverage({
    scenarios: scenarios.map((s) => ({ ...s, priority: 'P1' })),
    baselines: [],
  });
  assert.equal(coverageGate(p1).find((f) => f.subject === 'P1 coverage').severity, 'High');
});

test('a scenario that is known-broken is not covered even if a baseline file exists', () => {
  const cov = coverage({
    scenarios: [sc('more', 'P0')],
    baselines: ['more.png'],
    known: { '/more': 'throws' },
  });
  assert.equal(cov.byPriority.P0.coverage, 0);
  assert.match(cov.missing[0].why, /known/);
});

test('a baseline with no scenario is reported as stale, and does not block', () => {
  const cov = coverage({ scenarios: [sc('a', 'P0')], baselines: ['a.png', 'gone.png'] });
  const f = coverageGate(cov);
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'Medium');
});

test('verified coverage counts only scenarios that were compared and matched in the run', () => {
  const scenarios = [sc('a', 'P0'), sc('b', 'P0')];
  const cov = coverage({ scenarios, baselines: ['a.png', 'b.png'], passed: new Set(['a']) });
  assert.equal(cov.byPriority.P0.verifiedCoverage, 0.5);
  assert.ok(coverageGate(cov).some((f) => f.subject === 'P0 verified'));
});

test('a scenario that passed once and failed once is flaky; a stable pass and a stable failure are not', () => {
  const fl = flakiness([
    report([
      ['P0 /a @ desktop', ['passed', 'passed', 'passed']],
      ['P0 /b @ desktop', ['passed', 'failed', 'passed']],
      ['P1 /c @ desktop', ['failed', 'failed', 'failed']],
    ]),
  ]);
  assert.deepEqual(
    fl.flaky.map((x) => x.title),
    ['P0 /b @ desktop'],
  );
  assert.deepEqual(
    fl.failed.map((x) => x.title),
    ['P1 /c @ desktop'],
  );
  assert.deepEqual([...fl.passedIds], ['P0 /a @ desktop']);
  assert.equal(fl.runs, 3);
});

test('results from several reports are joined, and a retry that passed counts as flaky', () => {
  const fl = flakiness([
    report([['P0 /a @ desktop', ['passed']]]),
    report([['P0 /a @ desktop', ['failed']]]),
    report([['P1 /r @ mobile', ['failed', 'passed'], 'flaky']]),
  ]);
  assert.equal(fl.flaky.length, 2);
  const f = flakeGate(fl);
  assert.equal(f.find((x) => x.subject.startsWith('P0')).severity, 'Critical');
  assert.equal(f.find((x) => x.subject.startsWith('P1')).severity, 'High');
});

test('a skipped scenario (a known page) is neither flaky nor failed', () => {
  const fl = flakiness([report([['P0 /more @ desktop', [], 'skipped']])]);
  assert.equal(fl.flaky.length + fl.failed.length, 0);
});
