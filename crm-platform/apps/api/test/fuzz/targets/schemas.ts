import * as contracts from '@crm/contracts';
import { anything, confuse, perturb, type Rng } from '../gen';
import { Violation, type Target } from '../engine';
import { ZodValidationPipe } from '../../../src/common/pipes/zod-validation.pipe';
import { AppError } from '../../../src/common/errors/app-error';

/**
 * Every Zod schema exported by @crm/contracts, found at run time (a new schema is fuzzed without anyone adding it here).
 *
 * Every input goes through the same entry the request path uses, `ZodValidationPipe` (what `zodPipe(schema)` builds). Invariants: it
 * returns data or throws the 422 `AppError` and nothing else (a TypeError or RangeError out of a schema is a 500); parsed data holds no
 * object whose prototype a key such as `__proto__` changed and no NUL character at any depth (Postgres text and jsonb refuse it); and for a
 * schema with no transform, the data it returns is itself valid for the schema (a response schema that accepts its own output).
 */

type Def = Record<string, unknown> & { typeName?: string };
type Z = {
  _def: Def;
  safeParse(v: unknown): { success: boolean; data?: unknown; error?: { issues?: unknown } };
};

const isSchema = (v: unknown): v is Z =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Z).safeParse === 'function' &&
  typeof (v as Z)._def === 'object';

const defOf = (s: unknown): Def => (s as Z)._def;

/** The schemas an object holds, one level down. */
function children(s: Z): unknown[] {
  const d = defOf(s);
  const out: unknown[] = [];
  const add = (x: unknown) => {
    if (x !== undefined && x !== null) out.push(x);
  };
  switch (d.typeName) {
    case 'ZodObject': {
      const shape =
        typeof d.shape === 'function'
          ? (d.shape as () => Record<string, unknown>)()
          : (d.shape as Record<string, unknown>);
      Object.values(shape ?? {}).forEach(add);
      add(d.catchall);
      break;
    }
    case 'ZodArray':
    case 'ZodPromise':
    case 'ZodBranded':
      add(d.type);
      break;
    case 'ZodSet':
      add(d.valueType);
      break;
    case 'ZodMap':
    case 'ZodRecord':
      add(d.keyType);
      add(d.valueType);
      break;
    case 'ZodTuple':
      ((d.items as unknown[]) ?? []).forEach(add);
      add(d.rest);
      break;
    case 'ZodUnion':
      ((d.options as unknown[]) ?? []).forEach(add);
      break;
    case 'ZodDiscriminatedUnion': {
      const o = d.options as unknown;
      (o instanceof Map ? [...o.values()] : ((o as unknown[]) ?? [])).forEach(add);
      break;
    }
    case 'ZodIntersection':
      add(d.left);
      add(d.right);
      break;
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
    case 'ZodCatch':
    case 'ZodReadonly':
      add(d.innerType);
      break;
    case 'ZodEffects':
      add(d.schema);
      break;
    case 'ZodLazy':
      add((d.getter as () => unknown)());
      break;
    case 'ZodPipeline':
      add(d.in);
      add(d.out);
      break;
    default:
  }
  return out;
}

/** True when the schema rewrites its input (transform, preprocess, pipeline, catch), so its output need not be valid input again. */
function rewrites(s: Z, seen = new Set<unknown>()): boolean {
  if (seen.has(s)) return false;
  seen.add(s);
  const d = defOf(s);
  if (d.typeName === 'ZodPipeline' || d.typeName === 'ZodCatch' || d.typeName === 'ZodFunction')
    return true;
  if (
    d.typeName === 'ZodEffects' &&
    (d.effect as { type?: string } | undefined)?.type !== 'refinement'
  )
    return true;
  return children(s).some((c) => isSchema(c) && rewrites(c, seen));
}

/** A value the schema accepts, built from its own shape. Best effort: it only has to be close enough to be worth damaging. */
export function sampleOf(s: unknown, depth = 0): unknown {
  if (!isSchema(s) || depth > 7) return undefined;
  const d = defOf(s);
  const checks = (d.checks as Array<{ kind: string; value?: number }> | undefined) ?? [];
  const has = (k: string) => checks.some((c) => c.kind === k);
  const val = (k: string) => checks.find((c) => c.kind === k)?.value;
  switch (d.typeName) {
    case 'ZodString': {
      if (has('uuid')) return '11111111-1111-4111-8111-111111111111';
      if (has('email')) return 'fuzz@example.com';
      if (has('url')) return 'https://example.com/x';
      if (has('datetime')) return '2026-01-01T00:00:00.000Z';
      if (has('ip')) return '93.184.216.34';
      const min = val('min') ?? 1;
      const max = val('max') ?? 12;
      return 'a'.repeat(Math.max(1, Math.min(Math.max(min, 1), max)));
    }
    case 'ZodNumber': {
      const min = val('min');
      const max = val('max');
      return min !== undefined
        ? Math.ceil(min)
        : max !== undefined
          ? Math.min(1, Math.floor(max))
          : 1;
    }
    case 'ZodBigInt':
      return 1n;
    case 'ZodBoolean':
      return true;
    case 'ZodDate':
      return new Date(0);
    case 'ZodNull':
      return null;
    case 'ZodLiteral':
      return d.value;
    case 'ZodEnum':
      return (d.values as unknown[])[0];
    case 'ZodNativeEnum':
      return Object.values(d.values as object).find(
        (v) => typeof v === 'string' || typeof v === 'number',
      );
    case 'ZodArray':
      return [sampleOf(d.type, depth + 1)].filter((x) => x !== undefined);
    case 'ZodTuple':
      return ((d.items as unknown[]) ?? []).map((x) => sampleOf(x, depth + 1));
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const o = d.options as unknown;
      const first = o instanceof Map ? [...o.values()][0] : (o as unknown[])[0];
      return sampleOf(first, depth + 1);
    }
    case 'ZodRecord':
      return { key: sampleOf(d.valueType, depth + 1) };
    case 'ZodIntersection': {
      const l = sampleOf(d.left, depth + 1);
      const r = sampleOf(d.right, depth + 1);
      return typeof l === 'object' && typeof r === 'object'
        ? { ...(l as object), ...(r as object) }
        : l;
    }
    case 'ZodObject': {
      const shape = (
        typeof d.shape === 'function' ? (d.shape as () => Record<string, unknown>)() : d.shape
      ) as Record<string, unknown>;
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(shape)) {
        const x = sampleOf(v, depth + 1);
        if (x !== undefined) o[k] = x;
      }
      return o;
    }
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
    case 'ZodCatch':
    case 'ZodReadonly':
      return sampleOf(d.innerType, depth + 1);
    case 'ZodEffects':
      return sampleOf(d.schema, depth + 1);
    case 'ZodBranded':
      return sampleOf(d.type, depth + 1);
    case 'ZodLazy':
      return sampleOf((d.getter as () => unknown)(), depth + 1);
    case 'ZodPipeline':
      return sampleOf(d.in, depth + 1);
    case 'ZodAny':
    case 'ZodUnknown':
      return {};
    default:
      return undefined;
  }
}

const STD_PROTOS = new Set<unknown>([
  Object.prototype,
  Array.prototype,
  null,
  Date.prototype,
  Map.prototype,
  Set.prototype,
]);

/** An object in `v` (a few levels down) whose prototype is not a standard one. */
function oddPrototype(v: unknown, depth = 0): boolean {
  if (v === null || typeof v !== 'object' || depth > 6) return false;
  if (!STD_PROTOS.has(Object.getPrototypeOf(v))) return true;
  const items = Array.isArray(v) ? v.slice(0, 50) : Object.values(v).slice(0, 50);
  return items.some((x) => oddPrototype(x, depth + 1));
}

const ASYNC_SCHEMA = /Async refinement encountered/;

/** True when a string anywhere in `v` holds a NUL. Iterative: the input can be as deep as a request body allows. */
function holdsNul(v: unknown): boolean {
  const stack: unknown[] = [v];
  for (let n = 0; stack.length > 0 && n < 200_000; n += 1) {
    const x = stack.pop();
    if (typeof x === 'string') {
      if (x.includes('\u0000')) return true;
    } else if (x !== null && typeof x === 'object') {
      for (const [k, item] of Object.entries(x)) {
        if (k.includes('\u0000')) return true;
        stack.push(item);
      }
    }
  }
  return false;
}

/** All exported schemas, as `[export name, schema]`, with a second export of the same schema object dropped. */
export function exportedSchemas(): Array<[string, Z]> {
  const seen = new Set<unknown>();
  const out: Array<[string, Z]> = [];
  for (const [name, value] of Object.entries(contracts)) {
    if (isSchema(value) && !seen.has(value)) {
      seen.add(value);
      out.push([name, value]);
    }
  }
  return out;
}

export function schemaTargets(): Target[] {
  return exportedSchemas().map(([name, schema]): Target => {
    const sample = (() => {
      try {
        return sampleOf(schema);
      } catch {
        return undefined;
      }
    })();
    const reparse = !rewrites(schema);
    const pipe = new ZodValidationPipe(schema as never);
    return {
      name: `schema:${name}`,
      group: 'schemas',
      weight: 1,
      gen: (r: Rng) => {
        const k = r.next();
        if (sample === undefined || k < 0.2) return anything(r);
        if (k < 0.3) return confuse(r, sample);
        return perturb(r, sample);
      },
      allow: (e) =>
        (e instanceof AppError && e.getStatus() === 422 && e.code === 'VALIDATION_FAILED') ||
        (e instanceof Error && ASYNC_SCHEMA.test(e.message)),
      run: (input) => {
        const data = pipe.transform(input);
        if (oddPrototype(data))
          throw new Violation('parsed data holds an object whose prototype was changed');
        if (holdsNul(data))
          throw new Violation('parsed data holds a NUL character (Postgres cannot store it)');
        if (reparse && !schema.safeParse(data).success)
          throw new Violation('the schema rejects its own output');
      },
    };
  });
}
