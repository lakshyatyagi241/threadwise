import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBugs } from './report.mjs';

const t = (title, results) => ({ title, file: 'journeys/x.spec.ts', tests: [{ results }] });
const fail = (message, retry = 0) => ({
  status: 'failed',
  retry,
  error: { message },
  attachments: [{ name: 'screenshot', contentType: 'image/png', path: '/tmp/a.png' }],
});
const ok = { status: 'passed', retry: 1 };
const fixture = {
  suites: [
    {
      file: 'x.spec.ts',
      specs: [
        t('[contacts] create a contact', [
          fail('Error: expect(locator).toBeVisible()\nTimeout 10000ms exceeded 123'),
        ]),
      ],
      suites: [
        {
          specs: [
            t('[reports] export', [fail('Error: boom\n\u001b[31mx\u001b[39m'), ok]),
            t('[inbox] send reply', [
              fail('The flow passed but the app misbehaved underneath:\nPOST /api/x -> 502'),
            ]),
            t('[settings] save', [fail('page.goto: net::ERR_CONNECTION_REFUSED at https://x')]),
            t('[auth] login', [
              fail('sign-in /api/auth/login answered 503 on https://x. Is the stack up'),
            ]),
            t('[reports] other', [fail('expect(received).toBe(expected)')]),
            t('[reports] fine', [{ status: 'passed', retry: 0 }]),
          ],
        },
      ],
    },
  ],
};

test('classifies kinds, severity, env problems', () => {
  const { bugs, envProblems } = toBugs(fixture, { env: 'prod', date: '2026-01-01' });
  const by = (a) => bugs.find((b) => b.test === a);
  assert.equal(bugs.length, 4);
  assert.equal(envProblems.length, 2);
  assert.deepEqual(
    [by('[contacts] create a contact').kind, by('[contacts] create a contact').severity],
    ['journey-timeout', 'High'],
  );
  assert.deepEqual(
    [by('[reports] export').kind, by('[reports] export').severity],
    ['flaky', 'Low'],
  );
  assert.deepEqual(
    [by('[inbox] send reply').kind, by('[inbox] send reply').severity],
    ['http-5xx', 'High'],
  );
  assert.deepEqual(
    [by('[reports] other').kind, by('[reports] other').severity],
    ['journey-failed', 'Medium'],
  );
  assert.equal(by('[reports] export').area, 'reports');
  assert.ok(!by('[reports] export').description.includes('\u001b'));
});

test('id is stable across digits and differs by env; screenshot is planned', () => {
  const a = toBugs(fixture, { env: 'prod', date: 'd1' });
  const f2 = structuredClone(fixture);
  f2.suites[0].specs[0].tests[0].results[0].error.message =
    'Error: expect(locator).toBeVisible()\nTimeout 99ms exceeded 7';
  const b = toBugs(f2, { env: 'prod', date: 'd2' });
  const c = toBugs(fixture, { env: 'local', date: 'd1' });
  assert.equal(a.bugs[0].id, b.bugs[0].id);
  assert.notEqual(a.bugs[0].id, c.bugs[0].id);
  assert.equal(a.bugs[0].screenshot, `d1/${a.bugs[0].id}.png`);
  assert.equal(a.shots[0].from, '/tmp/a.png');
});
