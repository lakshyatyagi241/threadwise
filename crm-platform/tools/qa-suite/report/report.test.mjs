// Fast checks for the per-task report generator (no stack, no browser). Run: node --test tools/qa-suite/report/report.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReports, indexMarkdown } from './generate.mjs';
import { REPORT_TASKS } from './builders.mjs';
import { esc } from './render.mjs';

const check = (id, status, extra = {}) => ({
  id,
  title: `title of ${id}`,
  status,
  detail: '',
  evidence: [],
  ...extra,
});
const task = (id, checks, metrics = {}) => ({
  task: { id, name: `task ${id}`, priority: 'P1', owner: 'Punya', target: `target ${id}` },
  checks,
  metrics,
});
const meta = { commit: 'abc1234', generatedAt: '2026-10-17T00:00:00Z', live: { db: false } };

const results = {
  meta,
  results: [
    task(
      30,
      [
        check('inj-raw-request', 'pass'),
        check('inj-raw-review', 'warn', {
          detail: '1 finding(s)',
          evidence: ['apps/api/src/modules/crm/a.ts:3  sql.raw(`${alias}.x`)'],
        }),
        check('inj-concat', 'warn', {
          evidence: ['apps/api/src/modules/auth/cli/seed.ts:9  .query( `INSERT ${x}`'],
        }),
        check('inj-live', 'skip'),
      ],
      { 'sql.raw calls': 1, 'live requests': 0 },
    ),
    task(31, [
      check('xss-sink-dangerouslysetinnerhtml', 'warn', {
        evidence: [
          'apps/web/src/features/x/site/site-head.tsx:37  <style id="tw-custom-css" dangerouslySetInnerHTML={{ __html: css }} />',
          'apps/web/src/features/y/NEW-sink.tsx:5  <div dangerouslySetInnerHTML={{ __html: <script>alert(1)</script> }} />',
        ],
      }),
      check('xss-live', 'skip'),
    ]),
    task(
      36,
      [
        check('aud-module-coverage', 'fail', {
          evidence: [
            'some-module: 2 mutating route(s), 0 audit calls  (apps/api/src/modules/some-module/x.controller.ts)',
          ],
        }),
        check('aud-append-only', 'pass'),
      ],
      { modules: 3 },
    ),
    task(
      40,
      [
        check('idx-critical', 'pass'),
        check('idx-redundant', 'warn', {
          evidence: ['payments: idx_a(org_id,paid_at) is a prefix of idx_b(org_id,paid_at,id)'],
        }),
        check('idx-fk', 'warn', {
          evidence: ['teams(org_id,x_id) -> users   [packages/db/migrations/0003_foundation.sql]'],
        }),
      ],
      { 'foreign keys': 5 },
    ),
    task(
      41,
      [
        check('slow-pss-docker-compose.yml', 'pass'),
        check('slow-log-docker-compose.yml', 'pass', { detail: 'logged' }),
        check('slow-live', 'skip'),
      ],
      { 'threshold ms': 100, 'statements ranked': 0 },
    ),
  ],
};
const baseline = { 30: [{ key: 'file sql.raw(x)', reason: 'a typed column' }] };
const sinkReview = [
  {
    file: 'site/site-head.tsx',
    contains: 'tw-custom-css',
    verdict: 'accepted risk',
    why: 'raw by design',
  },
];

test('builds one report per task, never mixed', () => {
  const reports = buildReports({ results, baseline, sinkReview });
  assert.deepEqual(
    reports.map((r) => r.id),
    REPORT_TASKS,
  );
  assert.deepEqual(
    reports.map((r) => r.file),
    [
      'qa-30-injection-testing',
      'qa-31-xss-testing',
      'qa-36-audit-logging',
      'qa-40-db-indexing-audit',
      'qa-41-slow-query-analysis',
    ],
  );
  for (const r of reports) {
    assert.match(r.html, /^<!doctype html>/);
    assert.match(r.html, new RegExp(`QA task ${r.id}:`));
    for (const other of REPORT_TASKS.filter((t) => t !== r.id))
      assert.doesNotMatch(r.html, new RegExp(`QA task ${other}:`));
  }
});

test('--tasks selects a subset', () => {
  assert.deepEqual(
    buildReports({ results, baseline, sinkReview, only: [36, 40] }).map((r) => r.id),
    [36, 40],
  );
});

test('a skipped live check is shown as not run, never as a pass', () => {
  const html = buildReports({ results, baseline, sinkReview, only: [30] })[0].html;
  assert.match(html, /Target not yet demonstrated/);
  assert.match(html, /t-skip">skip/);
});

test('a failing audit check makes the report red and names the module', () => {
  const [r] = buildReports({ results, baseline, sinkReview, only: [36] });
  assert.match(r.html, /class="banner red"/);
  assert.match(r.html, /some-module/);
  assert.match(r.verdict, /Target not met/);
});

test('a sink with no review entry is shown as not reviewed, and a reviewed one carries its reason', () => {
  const html = buildReports({ results, baseline, sinkReview, only: [31] })[0].html;
  assert.match(html, /raw by design/);
  assert.match(html, /not reviewed/);
  assert.match(html, /add one/);
});

test('page content from checks is escaped', () => {
  const html = buildReports({ results, baseline, sinkReview, only: [31] })[0].html;
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.equal(esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('the index lists every report with its verdict', () => {
  const reports = buildReports({ results, baseline, sinkReview });
  const md = indexMarkdown(reports, meta);
  for (const r of reports) assert.ok(md.includes(`${r.file}.html`) && md.includes(`${r.file}.pdf`));
  assert.match(md, /abc1234/);
});
