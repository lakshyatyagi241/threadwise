import type { z, ZodTypeAny } from 'zod';
import { arrayBounds, checkKinds, defOf, typeNameOf } from './zod-def';

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
    const def = defOf(cur) as {
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
      case 'ZodPipeline':
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
  return typeNameOf(u) === 'ZodObject' ? ((u as z.ZodObject).shape as Shape) : null;
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
  const typeName = typeNameOf(u);
  const out: Array<{ label: string; value: unknown }> = [];
  const wrong = WRONG[typeName];
  if (wrong !== undefined) out.push({ label: 'wrong type', value: wrong });
  if (typeName === 'ZodString') {
    const str = u as z.ZodString;
    if (str.minLength != null && str.minLength > 0)
      out.push({
        label: `shorter than min ${str.minLength}`,
        value: 'x'.repeat(str.minLength - 1),
      });
    if (str.maxLength != null && str.maxLength < 100_000)
      out.push({ label: `longer than max ${str.maxLength}`, value: 'x'.repeat(str.maxLength + 1) });
    out.push({ label: 'array instead of string', value: ['a'] });
  }
  if (typeName === 'ZodNumber') {
    const num = u as z.ZodNumber;
    if (Number.isFinite(num.minValue))
      out.push({ label: `below min ${num.minValue}`, value: num.minValue! - 1 });
    if (Number.isFinite(num.maxValue))
      out.push({ label: `above max ${num.maxValue}`, value: num.maxValue! + 1 });
    out.push({ label: 'string instead of number', value: 'abc' });
  }
  if (typeName === 'ZodArray') {
    const max = arrayBounds(u).max;
    if (max !== null && max < 10_000)
      out.push({
        label: `more than max ${max} items`,
        value: Array.from({ length: max + 1 }, () => 'x'),
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
  const def = defOf(s) as {
    typeName: string;
    values?: unknown;
    value?: unknown;
    options?: ZodTypeAny[];
    type?: ZodTypeAny;
  };
  const typeName = typeNameOf(s);
  if (typeName === 'ZodString') {
    const kinds = checkKinds(s);
    if (kinds.has('uuid')) return '11111111-1111-4111-8111-111111111111';
    if (kinds.has('email')) return 'negative@example.test';
    if (kinds.has('url')) return 'https://example.test/x';
    if (kinds.has('datetime')) return '2026-01-01T00:00:00.000Z';
    return 'x'.repeat(Math.max((s as z.ZodString).minLength ?? 1, 1));
  }
  if (typeName === 'ZodNumber') {
    // zod 4 reports an unset bound as an infinity (zod 3 as null): only a finite bound is a real limit.
    const num = s as z.ZodNumber;
    return Number.isFinite(num.minValue)
      ? Math.ceil(num.minValue!)
      : Number.isFinite(num.maxValue)
        ? Math.min(1, Math.floor(num.maxValue!))
        : 1;
  }
  if (typeName === 'ZodBoolean') return true;
  if (typeName === 'ZodEnum') return (def.values as string[])[0];
  if (typeName === 'ZodLiteral') return def.value;
  if (typeName === 'ZodArray') {
    const min = arrayBounds(s).min ?? 0;
    const item = min > 0 ? sampleOf((s as z.ZodArray<ZodTypeAny>).element, depth + 1) : undefined;
    return min > 0 ? Array.from({ length: min }, () => item) : [];
  }
  if (typeName === 'ZodUnion' || typeName === 'ZodDiscriminatedUnion') {
    const options = (def.options as unknown as ZodTypeAny[] | Map<string, ZodTypeAny>) ?? [];
    const first = Array.isArray(options)
      ? options[0]
      : [...(options as Map<string, ZodTypeAny>).values()][0];
    return first ? sampleOf(first, depth + 1) : undefined;
  }
  if (typeName === 'ZodRecord') return {};
  if (typeName === 'ZodObject') {
    const out: Record<string, unknown> = {};
    for (const [k, f] of Object.entries((s as z.ZodObject).shape as Shape)) {
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
