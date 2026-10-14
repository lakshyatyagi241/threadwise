import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { badValues, mutations, sampleOf, schemaOfPipe, shapeOf, validSample } from '../../support/negative';

const schema = z.object({
  name: z.string().trim().min(1).max(5),
  age: z.number().int().min(18).max(99),
  kind: z.enum(['a', 'b']),
  note: z.string().max(3).nullish(),
  tags: z.array(z.string()).max(2).optional(),
});
const ok = { name: 'Ann', age: 30, kind: 'a' };

describe('mutations(schema)', () => {
  const cases = mutations(schema, ok);
  const labels = cases.map((c) => c.label);

  it('only returns bodies the schema refuses', () => {
    for (const c of cases) expect(schema.safeParse(c.body).success, c.label).toBe(false);
  });
  it('drops each required field, but not an optional one', () => {
    expect(labels).toContain('missing "name"');
    expect(labels).toContain('missing "age"');
    expect(labels).not.toContain('missing "note"');
    expect(labels).not.toContain('missing "tags"');
  });
  it('goes one past each limit', () => {
    expect(cases.find((c) => c.label === '"name" longer than max 5')?.body).toMatchObject({ name: 'xxxxxx' });
    expect(cases.find((c) => c.label === '"age" below min 18')?.body).toMatchObject({ age: 17 });
    expect(cases.find((c) => c.label === '"age" above max 99')?.body).toMatchObject({ age: 100 });
    expect(labels).toContain('"tags" more than max 2 items');
  });
  it('tries a value outside the enum, a wrong type, and an empty string', () => {
    expect(cases.find((c) => c.label === '"kind" wrong type')?.body).toMatchObject({ kind: '__not_in_enum__' });
    expect(labels).toContain('"age" string instead of number');
    expect(labels).toContain('"name" is an empty string');
  });
  it('refuses a body that is not an object', () => {
    expect(labels).toEqual(expect.arrayContaining(['not an object (string)', 'not an object (array)', 'null body']));
  });
  it('does not report an unknown field when the schema lets them through', () => {
    const loose = z.object({ a: z.string() }).passthrough();
    expect(mutations(loose, { a: 'x' }).map((c) => c.label)).not.toContain('unknown field');
    expect(mutations(z.object({ a: z.string() }).strict(), { a: 'x' }).map((c) => c.label)).toContain('unknown field');
  });
});

describe('helpers', () => {
  it('sees through optional, default and effects wrappers', () => {
    const wrapped = z.object({ a: z.string() }).refine(() => true).optional();
    expect(Object.keys(shapeOf(wrapped) ?? {})).toEqual(['a']);
  });
  it('gives no length case for an unbounded string', () => {
    expect(badValues(z.string()).map((b) => b.label)).not.toContain('longer than max null');
  });
  it('reads the schema off a pipe', () => {
    expect(schemaOfPipe({ schema })).toBe(schema);
    expect(schemaOfPipe({})).toBeNull();
    expect(schemaOfPipe(undefined)).toBeNull();
  });
});

describe('validSample(schema)', () => {
  it('builds a body from the required fields only', () => {
    expect(validSample(schema)).toEqual({ name: 'x', age: 18, kind: 'a' });
  });
  it('knows uuid, email, url and nested objects', () => {
    const s = z.object({ id: z.string().uuid(), mail: z.string().email(), site: z.string().url(), inner: z.object({ n: z.number() }) });
    expect(validSample(s)).not.toBeNull();
  });
  it('gives up (null) on a shape it cannot build, such as a regex', () => {
    expect(validSample(z.object({ code: z.string().regex(/^[A-Z]{3}-\d{4}$/) }))).toBeNull();
    expect(sampleOf(z.any())).toBeUndefined();
  });
});
