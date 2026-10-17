// Tests for the NOT VALID tracker (QA task 48). Run: node --test tools/qa-suite/lib/not-valid.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { neverValidated, validates } from './not-valid.mjs';

const mig = (file, sql) => ({ file, sql });
const add = (name) => `ALTER TABLE t ADD CONSTRAINT ${name} CHECK (x > 0) NOT VALID;`;

test('a constraint added NOT VALID and never validated is reported', () => {
  assert.deepEqual(neverValidated([mig('001_add', add('chk_a'))]), [
    { file: '001_add', name: 'chk_a' },
  ]);
});

test('a constraint added VALID is not a candidate', () => {
  assert.deepEqual(
    neverValidated([mig('001', 'ALTER TABLE t ADD CONSTRAINT chk_a CHECK (x > 0);')]),
    [],
  );
});

test('a literal VALIDATE CONSTRAINT in a later migration counts', () => {
  const m = [mig('001', add('chk_a')), mig('002', 'ALTER TABLE t VALIDATE CONSTRAINT chk_a;')];
  assert.deepEqual(neverValidated(m), []);
});

test('a validation in the same migration counts', () => {
  assert.deepEqual(
    neverValidated([mig('001', `${add('chk_a')}\nALTER TABLE t VALIDATE CONSTRAINT chk_a;`)]),
    [],
  );
});

test('a validation that runs BEFORE the constraint exists does not count', () => {
  const m = [mig('001', 'ALTER TABLE t VALIDATE CONSTRAINT chk_a;'), mig('002', add('chk_a'))];
  assert.deepEqual(neverValidated(m), [{ file: '002', name: 'chk_a' }]);
});

test('a loop that builds the statement from a list of names counts for every name in the list (the cat_validate migration)', () => {
  const loop = `
    FOR c IN SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
      WHERE NOT convalidated AND conname IN ('chk_a', 'chk_b')
    LOOP EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', c.tbl, c.conname); END LOOP;`;
  const m = [mig('001', `${add('chk_a')}\n${add('chk_b')}\n${add('chk_c')}`), mig('002', loop)];
  // chk_a and chk_b are named in the loop; chk_c is not, so it is still reported.
  assert.deepEqual(neverValidated(m), [{ file: '001', name: 'chk_c' }]);
});

test('a loop that does not name the constraint does not validate it', () => {
  assert.equal(
    validates("EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', t, n); -- 'other'", 'chk_a'),
    false,
  );
});

test('a name that only appears as a longer name does not match', () => {
  assert.equal(validates('ALTER TABLE t VALIDATE CONSTRAINT chk_a_long;', 'chk_a'), false);
  assert.equal(validates("... VALIDATE CONSTRAINT %I ... 'chk_a_long'", 'chk_a'), false);
});

test('the real migrations leave nothing reported (the four the old check flagged are validated by the cat migration)', async () => {
  const { migrations: list } = await import('./core.mjs');
  const { readFileSync } = await import('node:fs');
  const all = list().map((f) => ({ file: f.split('/').pop(), sql: readFileSync(f, 'utf8') }));
  assert.deepEqual(neverValidated(all), []);
});
