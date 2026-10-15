import { z, type ZodTypeAny } from 'zod';

/**
 * Bad-input generator for the negative sweep (QA task 13).
 *
 * `mutations(schema)` takes the zod schema a route validates its body with and returns bodies that the schema MUST refuse: a
 * required field dropped, the wrong type, one past each min or max, a value outside an enum, an empty string, null, an array
 * where a scalar belongs, and an unknown field. Every returned body is checked against the schema itself, so a case the schema
 * would accept (an optional field, a coercion, `.passthrough()`) is dropped rather than reported as a false failure.
 */
export interface NegativeCase {
  /** Short label, for the test title and the known-gaps list. */
  label: string;
  body: unknown;
}

type Shape = Record<string, ZodTypeAny>;

/** Peels optional, nullable, default, effects and branded wrappers down to the schema that decides the value. */
export function unwrap(s: ZodTypeAny): ZodTypeAny {
  let cur = s;
  for (let i = 0; i < 12; i++) {
    const def = cur._def as {
      typeName?: string;
      innerType?: ZodTypeAny;
      schema?: ZodTypeAny;
      type?: ZodTypeAny;
    };
    switch (def.typeName) {
      case 'ZodOptional':
      case 'ZodNullable':
      case 'ZodDefault':
      case 'ZodCatch':
      case 'ZodReadonly':
        cur = def.innerType!;
        continue;
      case 'ZodEffects':
        cur = def.schema!;
        continue;
      case 'ZodBranded':
        cur = def.type!;
        continue;
      default:
        return cur;
    }
  }
  return cur;
}

/** The object shape of a schema if it is (an effect around) an object. */
export function shapeOf(s: ZodTypeAny): Shape | null {
  const u = unwrap(s);
  return u instanceof z.ZodObject ? (u.shape as Shape) : null;
}

const WRONG: Record<string, unknown> = {
  ZodString: 12345,
  ZodNumber: 'not-a-number',
  ZodBoolean: 'maybe',
  ZodArray: 'not-an-array',
  ZodObject: 'not-an-object',
  ZodEnum: '__not_in_enum__',
  ZodNativeEnum: '__not_in_enum__',
  ZodLiteral: '__not_the_literal__',
};

/** Values for one field that its own schema refuses, labelled. */
export function badValues(field: ZodTypeAny): Array<{ label: string; value: unknown }> {
  const u = unwrap(field);
  const typeName = (u._def as { typeName: string }).typeName;
  const out: Array<{ label: string; value: unknown }> = [];
  const wrong = WRONG[typeName];
  if (wrong !== undefined) out.push({ label: 'wrong type', value: wrong });
  if (u instanceof z.ZodString) {
    if (u.minLength !== null && u.minLength > 0)
      out.push({ label: `shorter than min ${u.minLength}`, value: 'x'.repeat(u.minLength - 1) });
    if (u.maxLength !== null && u.maxLength < 100_000)
      out.push({ label: `longer than max ${u.maxLength}`, value: 'x'.repeat(u.maxLength + 1) });
    out.push({ label: 'array instead of string', value: ['a'] });
  }
  if (u instanceof z.ZodNumber) {
    if (u.minValue !== null) out.push({ label: `below min ${u.minValue}`, value: u.minValue - 1 });
    if (u.maxValue !== null) out.push({ label: `above max ${u.maxValue}`, value: u.maxValue + 1 });
    out.push({ label: 'string instead of number', value: 'abc' });
  }
  if (u instanceof z.ZodArray) {
    const d = u._def as {
      minLength: { value: number } | null;
      maxLength: { value: number } | null;
    };
    if (d.maxLength && d.maxLength.value < 10_000)
      out.push({
        label: `more than max ${d.maxLength.value} items`,
        value: Array.from({ length: d.maxLength.value + 1 }, () => 'x'),
      });
  }
  out.push({ label: 'object instead of scalar', value: { a: 1 } });
  return out;
}

/** A body the schema accepts, to mutate. Built from the schema's own defaults where it can; null when it cannot be built. */
export function validBase(
  schema: ZodTypeAny,
  sample: Record<string, unknown>,
): Record<string, unknown> | null {
  const r = schema.safeParse(sample);
  return r.success ? sample : null;
}

/**
 * @param sample a body the schema accepts (the sweep supplies a minimal one per route, or `{}` when every field is optional).
 */
export function mutations(
  schema: ZodTypeAny,
  sample: Record<string, unknown> = {},
): NegativeCase[] {
  const shape = shapeOf(schema);
  const out: NegativeCase[] = [];
  const keep = (label: string, body: unknown) => {
    if (!schema.safeParse(body).success) out.push({ label, body });
  };
  keep('not an object (string)', 'just a string');
  keep('not an object (array)', []);
  keep('null body', null);
  if (!shape) return out;
  const base = validBase(schema, sample) ?? sample;
  for (const [name, field] of Object.entries(shape)) {
    const { [name]: _dropped, ...without } = base;
    keep(`missing "${name}"`, without);
    keep(`"${name}" is null`, { ...base, [name]: null });
    keep(`"${name}" is an empty string`, { ...base, [name]: '' });
    for (const bad of badValues(field))
      keep(`"${name}" ${bad.label}`, { ...base, [name]: bad.value });
  }
  keep('unknown field', { ...base, __unknown_field__: 1 });
  return out;
}

/** The schema a route validates its body with, read off the pipe (`zodPipe(schema)` keeps it as `schema`). */
export function schemaOfPipe(pipe: unknown): ZodTypeAny | null {
  const s = (pipe as { schema?: unknown } | null | undefined)?.schema;
  return s && typeof (s as ZodTypeAny).safeParse === 'function' ? (s as ZodTypeAny) : null;
}

/**
 * A minimal value the schema accepts, or `undefined` when one cannot be built from its shape (a custom refine, a regex).
 * Only required fields are filled; optional ones are left out. The result is verified with `safeParse` by the caller.
 */
export function sampleOf(schema: ZodTypeAny, depth = 0): unknown {
  if (depth > 6) return undefined;
  const s = unwrap(schema);
  const def = s._def as {
    typeName: string;
    values?: unknown;
    value?: unknown;
    options?: ZodTypeAny[];
    type?: ZodTypeAny;
  };
  if (s instanceof z.ZodString) {
    const kinds = new Set(s._def.checks.map((c) => c.kind));
    if (kinds.has('uuid')) return '11111111-1111-4111-8111-111111111111';
    if (kinds.has('email')) return 'negative@example.test';
    if (kinds.has('url')) return 'https://example.test/x';
    if (kinds.has('datetime')) return '2026-01-01T00:00:00.000Z';
    return 'x'.repeat(Math.max(s.minLength ?? 1, 1));
  }
  if (s instanceof z.ZodNumber)
    return s.minValue !== null
      ? Math.ceil(s.minValue)
      : s.maxValue !== null
        ? Math.min(1, Math.floor(s.maxValue))
        : 1;
  if (s instanceof z.ZodBoolean) return true;
  if (s instanceof z.ZodEnum) return (def.values as string[])[0];
  if (s instanceof z.ZodNativeEnum) return Object.values(def.values as object)[0];
  if (s instanceof z.ZodLiteral) return def.value;
  if (s instanceof z.ZodArray) {
    const min = (s._def as { minLength: { value: number } | null }).minLength?.value ?? 0;
    const item = min > 0 ? sampleOf(s.element, depth + 1) : undefined;
    return min > 0 ? Array.from({ length: min }, () => item) : [];
  }
  if (s instanceof z.ZodUnion || s instanceof z.ZodDiscriminatedUnion) {
    const options = (def.options as unknown as ZodTypeAny[] | Map<string, ZodTypeAny>) ?? [];
    const first = Array.isArray(options)
      ? options[0]
      : [...(options as Map<string, ZodTypeAny>).values()][0];
    return first ? sampleOf(first, depth + 1) : undefined;
  }
  if (s instanceof z.ZodRecord) return {};
  if (s instanceof z.ZodObject) {
    const out: Record<string, unknown> = {};
    for (const [k, f] of Object.entries(s.shape as Shape)) {
      if (f.isOptional()) continue;
      const v = sampleOf(f, depth + 1);
      if (v === undefined) return undefined;
      out[k] = v;
    }
    return out;
  }
  return undefined;
}

/** A body the schema accepts, or null if `sampleOf` could not build one. */
export function validSample(schema: ZodTypeAny): Record<string, unknown> | null {
  const v = sampleOf(schema);
  return v !== null && typeof v === 'object' && !Array.isArray(v) && schema.safeParse(v).success
    ? (v as Record<string, unknown>)
    : null;
}
