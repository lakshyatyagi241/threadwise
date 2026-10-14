import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sum } from './sum-contract-assertions.mjs';

test('adds up assertions, responses and undeclared fields by label', () => {
  const t = sum(
    '{"label":"GET /a","assertions":10,"undeclared":1}\n{"label":"GET /a","assertions":5,"undeclared":0}\n{"label":"POST /b","assertions":7,"undeclared":2}\n',
  );
  assert.equal(t.responses, 3);
  assert.equal(t.assertions, 22);
  assert.equal(t.undeclaredFields, 3);
  assert.deepEqual(t.byLabel, { 'GET /a': 15, 'POST /b': 7 });
});
test('counts a malformed line instead of failing, and ignores blanks', () => {
  const t = sum('not json\n\n{"assertions":4}\n');
  assert.equal(t.malformed, 1);
  assert.equal(t.assertions, 4);
  assert.deepEqual(t.byLabel, { '(unlabelled)': 4 });
});
