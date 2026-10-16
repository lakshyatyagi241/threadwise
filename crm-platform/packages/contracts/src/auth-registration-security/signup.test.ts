import { describe, expect, it } from 'vitest';
import {
  signupStartRequestSchema,
  signupVerifyEmailCodeRequestSchema,
  signupSetPasswordRequestSchema,
} from './signup';

describe('signupStartRequestSchema', () => {
  it('accepts name + email with no phone', () => {
    const r = signupStartRequestSchema.safeParse({
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
    });
    expect(r.success).toBe(true);
  });
  it('rejects a missing email', () => {
    const r = signupStartRequestSchema.safeParse({ fullName: 'Ada Lovelace' });
    expect(r.success).toBe(false);
  });
});

describe('signupVerifyEmailCodeRequestSchema', () => {
  it('requires a token and a 4-8 char code', () => {
    const r = signupVerifyEmailCodeRequestSchema.safeParse({ token: 'abc', code: '123456' });
    expect(r.success).toBe(true);
  });
});

describe('signupSetPasswordRequestSchema', () => {
  it('requires acceptTerms to be literal true', () => {
    const r = signupSetPasswordRequestSchema.safeParse({
      token: 'abc',
      password: 'Sup3rSecret!',
      acceptTerms: false,
    });
    expect(r.success).toBe(false);
  });
});
