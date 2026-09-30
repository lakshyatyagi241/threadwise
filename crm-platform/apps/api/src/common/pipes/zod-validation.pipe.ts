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

/** Convenience factory so call sites read as `ZodBody(schema)`. */
export const zodPipe = <T>(schema: ZodSchema<T>): ZodValidationPipe<T> =>
  new ZodValidationPipe(schema);
