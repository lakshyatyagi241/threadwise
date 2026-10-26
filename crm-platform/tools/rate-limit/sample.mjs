// A body that a route's own schema accepts (QA sheet 3, item 33). This mirrors `sampleOf` in tools/quality/form-validation.mjs (QA task 12,
// a separate PR); once both are on main the two should share one file. It works on the compiled @crm/contracts schemas by their
// `_def`, so it needs no zod import of its own.
const typeOf = (s) => s?._def?.typeName;
const UUID = '11111111-1111-4111-8111-111111111111';
const CANDIDATES = [
  'a',
  'abc',
  'Abc123',
  'abc_def',
  'abc-def',
  'a1',
  '1',
  '123456',
  '+919876543210',
  '919876543210',
  'a.b',
  'a b',
  'A',
  'ABC',
  '#fff',
  '#ffffff',
  '2026-01-01',
  '12:30',
  'en',
  'en-US',
  'USD',
  'IN',
  'https://example.test',
  'a@example.test',
];

/** Peels optional, nullable, default and similar wrappers; says what it peeled. */
export function unwrap(schema) {
  let s = schema;
  const flags = { optional: false, nullable: false, hasDefault: false, refine: 0, pre: false };
  for (let i = 0; i < 16; i++) {
    const d = s._def;
    switch (d.typeName) {
      case 'ZodOptional':
        flags.optional = true;
        s = d.innerType;
        continue;
      case 'ZodNullable':
        flags.nullable = true;
        s = d.innerType;
        continue;
      case 'ZodDefault':
        flags.hasDefault = true;
        flags.optional = true;
        s = d.innerType;
        continue;
      case 'ZodCatch':
      case 'ZodReadonly':
        s = d.innerType;
        continue;
      case 'ZodEffects':
        if (d.effect?.type === 'refinement') flags.refine++;
        else flags.pre = true;
        s = d.schema;
        continue;
      case 'ZodBranded':
        s = d.type;
        continue;
      case 'ZodPipeline':
        s = d.in;
        continue;
      case 'ZodLazy':
        s = d.getter();
        continue;
      default:
        return { s, flags };
    }
  }
  return { s, flags };
}

const checksOf = (s) => s._def.checks ?? [];
const hasCheck = (s, kind) => checksOf(s).find((c) => c.kind === kind);

/** A value the schema accepts, or undefined when none could be built. */
export function sampleOf(schema, depth = 0) {
  if (depth > 6) return undefined;
  const { s } = unwrap(schema);
  const ok = (v) => (schema.safeParse(v).success ? v : undefined);
  switch (typeOf(s)) {
    case 'ZodString': {
      const min = hasCheck(s, 'min')?.value ?? hasCheck(s, 'length')?.value ?? 0;
      const max = hasCheck(s, 'max')?.value ?? hasCheck(s, 'length')?.value ?? 1e9;
      const fixed = hasCheck(s, 'uuid')
        ? UUID
        : hasCheck(s, 'email')
          ? 'a@example.test'
          : hasCheck(s, 'url')
            ? 'https://example.test'
            : hasCheck(s, 'datetime')
              ? '2026-01-01T00:00:00Z'
              : null;
      const tries = fixed
        ? [fixed]
        : [
            'a'.repeat(Math.min(Math.max(min, 1), max)),
            ...CANDIDATES,
            ...CANDIDATES.map((c) => c.repeat(Math.max(1, Math.ceil(min / c.length)))),
          ];
      for (const t of tries) if (schema.safeParse(t).success) return t;
      return undefined;
    }
    case 'ZodNumber': {
      const lo = hasCheck(s, 'min');
      const hi = hasCheck(s, 'max');
      for (const t of [
        lo ? lo.value + (lo.inclusive ? 0 : 1) : undefined,
        1,
        0,
        hi ? hi.value - (hi.inclusive ? 0 : 1) : undefined,
        10,
        100,
      ])
        if (t !== undefined && schema.safeParse(t).success) return t;
      return undefined;
    }
    case 'ZodBigInt':
      return ok(BigInt(1));
    case 'ZodBoolean':
      return ok(false) ?? ok(true);
    case 'ZodDate':
      return ok(new Date('2026-01-01T00:00:00Z'));
    case 'ZodEnum':
      return s._def.values[0];
    case 'ZodNativeEnum':
      return Object.values(s._def.values)[0];
    case 'ZodLiteral':
      return s._def.value;
    case 'ZodNull':
      return null;
    case 'ZodUndefined':
      return undefined;
    case 'ZodArray': {
      const min = s._def.minLength?.value ?? s._def.exactLength?.value ?? 0;
      const item = sampleOf(s._def.type, depth + 1);
      if (min > 0 && item === undefined) return undefined;
      return ok(Array.from({ length: min }, () => item));
    }
    case 'ZodSet':
    case 'ZodMap':
      return undefined;
    case 'ZodRecord':
      return ok({});
    case 'ZodTuple': {
      const v = s._def.items.map((i) => sampleOf(i, depth + 1));
      return v.some((x) => x === undefined) ? undefined : ok(v);
    }
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const opts = Array.isArray(s._def.options) ? s._def.options : [...s._def.options.values()];
      for (const o of opts) {
        const v = sampleOf(o, depth + 1);
        if (v !== undefined && schema.safeParse(v).success) return v;
      }
      return undefined;
    }
    case 'ZodObject': {
      const out = {};
      for (const [k, f] of Object.entries(s.shape)) {
        const { flags } = unwrap(f);
        const v = sampleOf(f, depth + 1);
        if (v === undefined) {
          if (!flags.optional && !flags.nullable) return undefined;
          continue;
        }
        out[k] = v;
      }
      return ok(out);
    }
    case 'ZodAny':
    case 'ZodUnknown':
      return ok('x');
    default:
      return undefined;
  }
}
