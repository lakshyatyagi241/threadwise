import { describe, expect, it } from 'vitest';
import { sanitizeErrorText } from './sanitize-error';

describe('sanitizeErrorText', () => {
  it.each([
    [
      'a bearer token',
      'Request failed: Authorization: Bearer EAAGm0PX4ZCpsBAKzZB9qWxyz123',
      'EAAGm0PX4ZCpsBAKzZB9qWxyz123',
    ],
    [
      'an access_token parameter',
      'GET /v19/me?access_token=EAAGabc123def456&fields=id failed',
      'EAAGabc123def456',
    ],
    [
      'a key in JSON',
      '{"api_key":"sk_live_1234567890abcdef"} rejected',
      'sk_live_1234567890abcdef',
    ],
    ['an email address', 'cannot deliver to jane.doe@example.com', 'jane.doe@example.com'],
    ['a phone number', 'send to +91 98765 43210 failed', '98765 43210'],
    [
      'a signed url query',
      'GET https://cdn.example.com/f.jpg?X-Amz-Signature=abcdef123456 timed out',
      'abcdef123456',
    ],
    [
      'a jwt',
      'bad token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      'eyJhbGci',
    ],
    [
      'a long opaque string',
      'id 0123456789abcdef0123456789abcdef0123 unknown',
      '0123456789abcdef0123456789abcdef0123',
    ],
  ])('removes %s', (_name, input, secret) => {
    const out = sanitizeErrorText(input);
    expect(out).not.toContain(secret);
    expect(out.length).toBeGreaterThan(0);
  });

  it('keeps the readable part of the message', () => {
    expect(sanitizeErrorText('connect ECONNREFUSED 10.0.0.5:5432')).toContain('ECONNREFUSED');
  });

  it('keeps one line only: a stack trace is dropped', () => {
    const e = new Error('boom');
    e.stack = 'Error: boom\n    at secret (/srv/app/key.js:1:1)';
    expect(sanitizeErrorText(e)).toBe('Error: boom');
  });

  it('cuts to the limit and marks the cut', () => {
    const out = sanitizeErrorText('connection refused by upstream '.repeat(40), 50);
    expect(out).toHaveLength(50);
    expect(out.endsWith('…')).toBe(true);
  });

  it.each([null, undefined, '', 0])('is empty or plain for %s', (v) => {
    expect(typeof sanitizeErrorText(v)).toBe('string');
  });

  it('survives an object that cannot be serialized', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => sanitizeErrorText(a)).not.toThrow();
  });
});
