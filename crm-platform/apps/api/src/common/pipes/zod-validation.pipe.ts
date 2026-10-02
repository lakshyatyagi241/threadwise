import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
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
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    // PostgreSQL text cannot hold a NUL (0x00): the write fails and the caller used to get a 500 for input that is theirs to fix.
    const nul = findNul(value);
    if (nul !== null) {
      throw AppError.validation('Request payload failed validation', [
        { path: nul, message: 'must not contain a NUL (0x00) character' },
      ]);
    }
    const result = this.schema.safeParse(value);
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

/** The path of the first string holding a NUL character anywhere in a JSON-like value, or null. */
export function findNul(value: unknown, path = '', depth = 0): string | null {
  if (typeof value === 'string') return value.includes('\u0000') ? path : null;
  if (depth > 32 || value === null || typeof value !== 'object') return null;
  for (const [key, item] of Object.entries(value)) {
    const found = findNul(item, path === '' ? key : `${path}.${key}`, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/** Convenience factory so call sites read as `ZodBody(schema)`. */
export const zodPipe = <T>(schema: ZodSchema<T>): ZodValidationPipe<T> =>
  new ZodValidationPipe(schema);
