import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import {
  fieldErrorMap,
  fieldMessages,
  firstFieldMessage,
  requestIdOf,
  retryAfterSeconds,
  zodFieldMap,
} from './error-utils';

const err = (fieldErrors: Array<{ path: string; message: string }>) =>
  new ApiError(429, 'RATE_LIMITED', 'slow down', 'req-9', fieldErrors);

describe('retryAfterSeconds', () => {
  it('reads the wait from the rate-limit entry', () => {
    expect(retryAfterSeconds(err([{ path: 'retryAfterSeconds', message: '42' }]))).toBe(42);
  });
  it('rounds fractions up so the button never re-enables early', () => {
    expect(retryAfterSeconds(err([{ path: 'retryAfterSeconds', message: '1.2' }]))).toBe(2);
  });
  it('is null when absent, zero, negative, garbage or not an API error', () => {
    expect(retryAfterSeconds(err([]))).toBeNull();
    expect(retryAfterSeconds(err([{ path: 'retryAfterSeconds', message: '0' }]))).toBeNull();
    expect(retryAfterSeconds(err([{ path: 'retryAfterSeconds', message: '-3' }]))).toBeNull();
    expect(retryAfterSeconds(err([{ path: 'retryAfterSeconds', message: 'soon' }]))).toBeNull();
    expect(retryAfterSeconds(new Error('x'))).toBeNull();
  });
});

describe('field errors', () => {
  const e = err([
    { path: 'password', message: 'Use at least 8 characters.' },
    { path: 'password', message: 'Include at least one number.' },
    { path: 'newEmail', message: 'Already in use.' },
  ]);
  it('collects every message for a path', () => {
    expect(fieldMessages(e, 'password')).toEqual([
      'Use at least 8 characters.',
      'Include at least one number.',
    ]);
    expect(fieldMessages(e, 'password', 'newEmail')).toHaveLength(3);
    expect(fieldMessages(new Error('x'), 'password')).toEqual([]);
  });
  it('first message / map', () => {
    expect(firstFieldMessage(e, 'password')).toBe('Use at least 8 characters.');
    expect(firstFieldMessage(e, 'nope')).toBeUndefined();
    expect(fieldErrorMap(e)).toEqual({
      password: 'Use at least 8 characters.',
      newEmail: 'Already in use.',
    });
  });
  it('request id', () => {
    expect(requestIdOf(e)).toBe('req-9');
    expect(requestIdOf('x')).toBeUndefined();
  });
  it('zod issues', () => {
    expect(
      zodFieldMap([
        { path: ['name'], message: 'Too short' },
        { path: ['name'], message: 'Other' },
        { path: ['a', 0], message: 'Bad' },
      ]),
    ).toEqual({ name: 'Too short', 'a.0': 'Bad' });
  });
});
