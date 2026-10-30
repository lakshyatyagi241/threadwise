// Tests of the two helpers the fix pipeline's safety rests on: which paths may never auto-merge, and which failing tests are new.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREFIX, appRelative, failingTests, isProtected } from './lib.mjs';

test('auth, database, deploy, CI and the automation itself are protected; ordinary web code is not', () => {
  for (const p of [
    'apps/api/src/modules/auth/x.ts',
    'packages/db/src/a.ts',
    'deploy/hostinger/ci-entry.sh',
    '.github/workflows/a.yml',
    'apps/web/qa-daily/fix.mjs',
    'apps/web/qa-daily/live/qa.ts',
  ])
    assert.equal(isProtected(p), true, p);
  for (const p of ['apps/web/src/app/api/ready/route.ts', 'apps/web/src/lib/option-label.ts'])
    assert.equal(isProtected(p), false, p);
});

test('a changed path is read relative to the app folder, and a path outside it is always protected', () => {
  assert.equal(appRelative(`${PREFIX}apps/web/src/a.ts`), 'apps/web/src/a.ts');
  assert.equal(isProtected(appRelative(`${PREFIX}apps/api/src/modules/auth/a.ts`)), true);
  if (PREFIX) assert.equal(isProtected(appRelative('some-other-folder/x.ts')), true);
});

test('failing unit tests are read from vitest output, colours and all', () => {
  const out =
    '\x1b[31m FAIL \x1b[39m src/app/api/ready/route.test.ts > web health > ready is 200 when the API answers\n' +
    ' FAIL  src/lib/auth/next-config.test.ts > redirects > are temporary\n PASS other\n';
  const got = failingTests(out);
  assert.equal(got.size, 2);
  assert.ok(
    got.has('src/app/api/ready/route.test.ts > web health > ready is 200 when the API answers'),
  );
});
