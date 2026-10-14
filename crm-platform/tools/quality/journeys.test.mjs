import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expand, validate, variantValues } from './journeys.mjs';

const fixtures = { valid: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], hostile: [{ id: 'h' }] };
const cat = (journeys, extra = {}) => ({
  variants: { role: { values: ['admin', 'member'] }, text: { values: 'unicode:valid' } },
  steps: { 'x.one': 'one', 'x.two': 'two' },
  journeys,
  ...extra,
});
const j = (o = {}) => ({
  id: 'J-001',
  title: 't',
  priority: 'P0',
  domains: ['m'],
  steps: ['x.one'],
  vary: {},
  ...o,
});

test('variant values come from a list or from the unicode fixtures', () => {
  assert.deepEqual(variantValues({ values: ['x'] }, fixtures), ['x']);
  assert.deepEqual(variantValues({ values: 'unicode:valid' }, fixtures), ['a', 'b', 'c']);
  assert.deepEqual(variantValues({ values: 'unicode:hostile' }, fixtures), ['h']);
  assert.throws(() => variantValues({ values: 'nope' }, fixtures), /unknown variant source/);
});
test('a sound catalogue has no problems', () => {
  assert.deepEqual(validate(cat([j({ vary: { role: 'all', text: ['a'] } })]), fixtures), []);
});
test('bad id, duplicate id, unknown step, unknown variant and unknown value are reported', () => {
  const e = validate(
    cat([
      j({ id: 'x' }),
      j({ id: 'J-002', steps: ['x.nope'], vary: { colour: 'all' } }),
      j({ id: 'J-002', vary: { text: ['zzz'] } }),
    ]),
    fixtures,
  );
  assert.ok(e.some((m) => m.includes('id must look like J-001')));
  assert.ok(e.some((m) => m.includes('step "x.nope"')));
  assert.ok(e.some((m) => m.includes('variant "colour" does not exist')));
  assert.ok(e.some((m) => m.includes('duplicate id')));
  assert.ok(e.some((m) => m.includes('no value "zzz"')));
});
test('expand multiplies the variants of a journey and names every run', () => {
  const runs = expand(cat([j({ vary: { role: 'all', text: 'all' } })]), fixtures);
  assert.equal(runs.length, 6);
  assert.equal(runs[0].id, 'J-001/role=admin/text=a');
  assert.deepEqual(runs[5].variant, { role: 'member', text: 'c' });
});
test('a journey with no variants is one run, and an explicit list narrows a dimension', () => {
  assert.equal(expand(cat([j()]), fixtures).length, 1);
  assert.equal(expand(cat([j({ vary: { role: ['admin'], text: 'all' } })]), fixtures).length, 3);
});
test('excluded combinations are left out, with * matching any value', () => {
  const runs = expand(
    cat([
      j({
        vary: { role: 'all', text: 'all' },
        exclude: [
          { role: 'member', text: 'b' },
          { role: 'admin', text: '*' },
        ],
      }),
    ]),
    fixtures,
  );
  assert.deepEqual(
    runs.map((r) => r.id),
    ['J-001/role=member/text=a', 'J-001/role=member/text=c'],
  );
});
