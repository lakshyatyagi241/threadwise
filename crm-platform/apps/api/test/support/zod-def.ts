/**
 * Reads a zod schema's kind and checks, for the test harnesses that walk schemas (the fuzz targets and the negative sweep).
 *
 * Zod 4 keeps the definition on `_zod.def` with lower-case `type` names and formats (`email`, `uuid`) on the schema itself. The
 * walkers were written against zod 3 (`_def.typeName`, `checks[].kind`), so this maps the zod 4 shape onto those names. A zod 3
 * schema still reads through `_def`, so the walkers keep working either way.
 */

/** Zod 4 `_zod.def.type` to the zod 3 `typeName` the walkers branch on. */
const TYPE_NAMES: Record<string, string> = {
  object: 'ZodObject',
  string: 'ZodString',
  number: 'ZodNumber',
  boolean: 'ZodBoolean',
  enum: 'ZodEnum',
  literal: 'ZodLiteral',
  array: 'ZodArray',
  tuple: 'ZodTuple',
  record: 'ZodRecord',
  map: 'ZodMap',
  set: 'ZodSet',
  union: 'ZodUnion',
  intersection: 'ZodIntersection',
  optional: 'ZodOptional',
  nullable: 'ZodNullable',
  default: 'ZodDefault',
  prefault: 'ZodDefault',
  catch: 'ZodCatch',
  readonly: 'ZodReadonly',
  lazy: 'ZodLazy',
  pipe: 'ZodPipeline',
  promise: 'ZodPromise',
};

type Zod4Schema = { _zod: { def: Record<string, unknown> } };

const isZod4 = (s: unknown): s is Zod4Schema =>
  typeof s === 'object' && s !== null && typeof (s as Zod4Schema)._zod === 'object';

/** The zod 3-style type name of a schema, e.g. `ZodString`. */
export function typeNameOf(s: unknown): string {
  if (isZod4(s)) {
    const type = String(s._zod.def.type);
    return TYPE_NAMES[type] ?? `Zod:${type}`;
  }
  return (s as { _def: { typeName: string } })._def.typeName;
}

/** The check kinds on a string schema: `uuid`, `email`, `url`, `datetime` ... (a zod 4 format counts as its kind). */
export function checkKinds(s: unknown): Set<string> {
  if (isZod4(s)) {
    const kinds = new Set<string>();
    const format = s._zod.def.format;
    if (typeof format === 'string') kinds.add(format);
    for (const c of (s._zod.def.checks as Array<{
      _zod?: { def?: { check?: string; format?: string } };
    }>) ?? []) {
      const cd = c._zod?.def ?? {};
      kinds.add(cd.format ?? cd.check ?? '');
    }
    return kinds;
  }
  return new Set(
    ((s as { _def: { checks: Array<{ kind: string }> } })._def.checks ?? []).map((c) => c.kind),
  );
}

/**
 * The zod 3 definition fields the walkers read (`innerType`, `schema`, `type`, `options`, `values`, `value`), for a zod 4 schema.
 * A zod 3 schema returns its own `_def`.
 */
export function defOf(s: unknown): Record<string, unknown> & { typeName: string } {
  if (!isZod4(s)) return (s as { _def: Record<string, unknown> & { typeName: string } })._def;
  const d = s._zod.def;
  return {
    ...d,
    typeName: typeNameOf(s),
    // zod 3 names: the element of an array, the entries of an enum, the single value of a literal, the in-side of a pipe.
    type: d.type === 'array' ? d.element : d.type,
    values: d.type === 'enum' ? Object.values(d.entries as Record<string, unknown>) : d.values,
    schema: d.in,
    innerType: d.innerType,
    value: d.type === 'literal' ? (d.values as unknown[])[0] : d.value,
    checks: [...checkKinds(s)].map((kind) => ({ kind })),
  };
}

/** The min and max item count of a zod 4 array, from its `min_length` and `max_length` checks (zod 3 kept them on `_def`). */
export function arrayBounds(s: unknown): { min: number | null; max: number | null } {
  if (!isZod4(s)) {
    const d = (
      s as { _def: { minLength: { value: number } | null; maxLength: { value: number } | null } }
    )._def;
    return { min: d.minLength?.value ?? null, max: d.maxLength?.value ?? null };
  }
  let min: number | null = null;
  let max: number | null = null;
  for (const c of (s._zod.def.checks as Array<{
    _zod?: { def?: { check?: string; minimum?: number; maximum?: number } };
  }>) ?? []) {
    const cd = c._zod?.def ?? {};
    if (cd.check === 'min_length') min = cd.minimum ?? null;
    if (cd.check === 'max_length') max = cd.maximum ?? null;
  }
  return { min, max };
}
