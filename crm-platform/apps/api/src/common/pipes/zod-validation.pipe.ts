import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';
import { AppError } from '../errors/app-error';

/**
 * Validates and *transforms* a payload with a Zod schema from @crm/contracts.
 *
 * The output is the parsed value, so defaults and coercions (`limit` as a
 * number, email lowercased) reach the handler already applied. A handler never
 * re-checks what the schema already guarantees.
 *
 * Usage:
 *   @Body(new ZodValidationPipe(createContactSchema)) body: CreateContactInput
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  // The input type is open: a schema may transform a query string (`"true"` to `true`), so what goes in is not what comes out.
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    // PostgreSQL text cannot hold a NUL (0x00): the write fails and the caller used to get a 500 for input that is theirs to fix.
    const nul = findNul(value);
    if (nul !== null) {
      throw AppError.validation('Request payload failed validation', [
        { path: nul, message: 'must not contain a NUL (0x00) character' },
      ]);
    }
    // A schema can throw instead of failing: `z.coerce.number()` on `{"toString": []}` (a query string `?limit[toString]=1` parses to
    // that) is a TypeError, and a `.refine` that stringifies a very deep body is a RangeError. Both are the caller's bad input.
    let result: ReturnType<ZodType<T, ZodTypeDef, unknown>['safeParse']>;
    try {
      result = this.schema.safeParse(value);
    } catch (e) {
      if (e instanceof Error && /Async refinement/.test(e.message)) throw e;
      throw AppError.validation('Request payload failed validation', [
        { path: '', message: 'the value could not be read' },
      ]);
    }
    if (!result.success) {
      throw AppError.validation(
        'Request payload failed validation',
        result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}

/**
 * The path of the first string, or object key, holding a NUL character anywhere in a JSON-like value, or null. Walks the whole value
 * (no depth cut-off: a NUL at depth 40 is as fatal to Postgres as one at depth 1) without recursion, so a body nested 30 000 deep is
 * fine. Keys count: `{"a\u0000b": 1}` stored in jsonb fails like a value does.
 */
export function findNul(value: unknown, path = ''): string | null {
  type Node = { v: unknown; key: string; parent: Node | null };
  const pathOf = (n: Node): string => {
    const keys: string[] = [];
    for (let c: Node | null = n; c && c.parent; c = c.parent) keys.push(c.key);
    return [path, ...keys.reverse()].filter((k) => k !== '').join('.');
  };
  const stack: Node[] = [{ v: value, key: '', parent: null }];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (typeof n.v === 'string') {
      if (n.v.includes('\u0000')) return pathOf(n);
    } else if (n.v !== null && typeof n.v === 'object') {
      for (const [key, item] of Object.entries(n.v)) {
        if (key.includes('\u0000')) return pathOf({ v: item, key, parent: n });
        stack.push({ v: item, key, parent: n });
      }
    }
  }
  return null;
}

/** Convenience factory so call sites read as `ZodBody(schema)`. */
export const zodPipe = <T>(schema: ZodType<T, ZodTypeDef, unknown>): ZodValidationPipe<T> =>
  new ZodValidationPipe(schema);
