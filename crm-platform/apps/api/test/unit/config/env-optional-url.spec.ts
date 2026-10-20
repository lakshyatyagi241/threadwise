import { describe, expect, it } from 'vitest';
import { validateEnv } from '../../../src/config/env.schema';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  CLERK_SECRET_KEY: 'sk_test_x',
  CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
};

const OPTIONAL_URLS = [
  'S3_ENDPOINT',
  'S3_PUBLIC_ENDPOINT',
  'KB_OPENROUTER_BASE_URL',
  'LEAD_SCORING_OPENROUTER_BASE_URL',
] as const;

describe('optional URL settings in the environment schema', () => {
  it.each(OPTIONAL_URLS)(
    '%s: an empty string (compose `${X:-}` for an unset variable) means "not set"',
    (name) => {
      for (const empty of ['', '   ']) {
        const env = validateEnv({ ...base, [name]: empty }) as Record<string, unknown>;
        expect(env[name]).toBeUndefined();
      }
    },
  );

  it.each(OPTIONAL_URLS)('%s: a real URL is kept', (name) => {
    const env = validateEnv({
      ...base,
      [name]: 'https://example.r2.cloudflarestorage.com',
    }) as Record<string, unknown>;
    expect(env[name]).toBe('https://example.r2.cloudflarestorage.com');
  });

  it.each(OPTIONAL_URLS)('%s: a malformed value is still refused', (name) => {
    expect(() => validateEnv({ ...base, [name]: 'not a url' })).toThrow(/Invalid url/);
  });
});
