import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  baselineOf,
  boundSchemas,
  build,
  priorityOf,
  runScenario,
  sampleOf,
  scenariosOf,
  statsOf,
  unresolvedOf,
} from './form-validation.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(ROOT, 'packages/contracts/package.json'));
const { z } = require('zod');
const contracts = require('./dist/index.js');

const rules = (schema) =>
  scenariosOf(schema).scenarios.map((s) => `${s.field}:${s.rule}:${s.kind}`);

test('a required string with limits gets required, type, empty, min, max and unicode scenarios', () => {
  const r = rules(z.object({ name: z.string().min(2).max(10) }));
  for (const want of [
    'name:required:refuse',
    'name:type:refuse',
    'name:empty:refuse',
    'name:min:refuse',
    'name:min:accept',
    'name:max:accept',
    'name:max:refuse',
    'name:unicode:accept',
  ])
    assert.ok(r.includes(want), `missing ${want} in ${r.join(', ')}`);
});

test('an optional field is not required, and a nullable one accepts null', () => {
  const r = rules(z.object({ note: z.string().max(5).optional(), tag: z.string().nullable() }));
  assert.ok(!r.includes('note:required:refuse'));
  assert.ok(r.includes('note:null:refuse'));
  assert.ok(r.includes('tag:null:accept'));
});

test('numbers: whole-number, exclusive minimum and maximum boundaries behave', () => {
  const schema = z.object({ qty: z.number().int().gt(0).max(5) });
  const { scenarios } = scenariosOf(schema);
  assert.ok(scenarios.length >= 5);
  for (const s of scenarios) assert.equal(runScenario(schema, s), null, `${s.label}`);
});

test('an enum and an array get their boundary scenarios', () => {
  const r = rules(z.object({ kind: z.enum(['a', 'b']), ids: z.array(z.string()).min(1).max(3) }));
  for (const want of ['kind:enum:refuse', 'kind:enum:accept', 'ids:size:refuse', 'ids:size:accept'])
    assert.ok(r.includes(want), want);
});

test('a refusal must point at the right field', () => {
  const schema = z.object({ a: z.string().min(2), b: z.string().min(2) });
  const sc = { field: 'a', rule: 'min', kind: 'refuse', label: 'x', body: { a: 'ok', b: 'x' } };
  assert.match(runScenario(schema, sc), /not on "a"/);
});

test('a cross-field rule is counted as not generated, never reported as a defect', () => {
  const schema = z
    .object({ lo: z.number(), hi: z.number() })
    .refine((v) => v.hi >= v.lo, { message: 'hi must be at least lo', path: ['hi'] });
  const { uncovered, scenarios } = scenariosOf(schema);
  assert.ok(uncovered.some((u) => /cross-field/.test(u.reason)));
  for (const s of scenarios) assert.equal(runScenario(schema, s), null);
});

test('coerced fields skip the wrong-type scenario; a body that cannot be built is reported', () => {
  assert.ok(!rules(z.object({ n: z.coerce.number() })).includes('n:type:refuse'));
  const none = scenariosOf(z.object({ x: z.string().regex(/^\d{3}-[a-z]{3}$/) }));
  assert.equal(none.unbuildable, true);
  assert.equal(none.scenarios.length, 0);
});

test('sampleOf builds a body the schema accepts', () => {
  const schema = z.object({
    id: z.string().uuid(),
    mail: z.string().email(),
    when: z.string().datetime(),
    n: z.number().min(5),
    tags: z.array(z.string()).min(1),
  });
  assert.equal(schema.safeParse(sampleOf(schema)).success, true);
});

test('priority: a P0 module makes core rules P0; a sensitive field lifts a P1 module', () => {
  assert.equal(priorityOf('P0', 'max', 'title'), 'P0');
  assert.equal(priorityOf('P0', 'unicode', 'title'), 'P1');
  assert.equal(priorityOf('P1', 'max', 'title'), 'P1');
  assert.equal(priorityOf('P1', 'max', 'password'), 'P0');
  assert.equal(priorityOf('P2', 'max', 'title'), 'P2');
});

test('every body schema of every controller resolves (but the known ones), and every scenario behaves as promised', () => {
  const bound = boundSchemas();
  assert.ok(bound.length > 500, `only ${bound.length} bound schemas found`);
  const cat = build(contracts, bound);
  const known =
    JSON.parse(readFileSync(join(ROOT, 'docs/quality/form-validation/baseline.json'), 'utf8'))
      ._unresolved ?? [];
  const bad = [];
  for (const u of unresolvedOf(cat))
    if (!known.includes(u))
      bad.push(`${u} is defined outside @crm/contracts and is not on the known list`);
  for (const m of cat)
    for (const s of m.schemas)
      if (s.drop) bad.push(`${m.module}/${s.schema}: ${s.drop} scenario(s) misbehave`);
  assert.deepEqual(bad, []);
});

test('the suite is deterministic: building twice gives the same catalogue (no flaky scenario)', () => {
  const a = JSON.stringify(build(contracts));
  const b = JSON.stringify(build(contracts));
  assert.equal(a, b);
});

test('P0 and P1 scenario coverage stays at or above 95%', () => {
  const cat = build(contracts);
  for (const k of ['P0', 'P1']) {
    const n = cat.reduce((t, m) => t + statsOf(m).rows[k].n, 0);
    const miss = cat.reduce((t, m) => t + statsOf(m).rows[k].miss, 0);
    assert.ok(
      (100 * n) / (n + miss) >= 95,
      `${k} coverage is ${((100 * n) / (n + miss)).toFixed(1)}%`,
    );
  }
  assert.equal(typeof baselineOf(cat), 'object');
});
