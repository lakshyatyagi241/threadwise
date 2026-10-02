import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { findNul, ZodValidationPipe } from '../../../src/common/pipes/zod-validation.pipe';
import { AppError } from '../../../src/common/errors/app-error';

describe('findNul', () => {
  it('finds a NUL at any depth and names the path', () => {
    expect(findNul({ title: 'a\u0000b' })).toBe('title');
    expect(findNul({ lines: [{ description: 'ok' }, { description: 'x\u0000' }] })).toBe(
      'lines.1.description',
    );
    expect(findNul('only\u0000string')).toBe('');
  });

  it('leaves clean input alone', () => {
    expect(findNul({ a: 'x', b: [1, null, { c: true }], d: undefined })).toBeNull();
    expect(findNul(null)).toBeNull();
  });
});

describe('ZodValidationPipe NUL guard', () => {
  const pipe = new ZodValidationPipe(z.object({ title: z.string() }));

  it('answers a validation error, not a database failure, for a NUL in a text field', () => {
    try {
      pipe.transform({ title: 'a\u0000b' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).getStatus()).toBe(422);
      expect((err as AppError).details?.[0]?.path).toBe('title');
    }
  });

  it('still parses clean input', () => {
    expect(pipe.transform({ title: 'fine' })).toEqual({ title: 'fine' });
  });
});
