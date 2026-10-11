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
const production = {
  ...base,
  NODE_ENV: 'production',
  DATABASE_REPLICA_URL: 'postgres://r:p@localhost:5432/db',
};

describe('the FAQ engine settings in the central environment schema', () => {
  it('are optional, and kept (a .env key the schema does not declare never reaches process.env)', () => {
    const env = validateEnv({ ...base });
    expect(env.FAQ_AI_DRIVER).toBeUndefined();
    const set = validateEnv({
      ...base,
      FAQ_AI_DRIVER: 'fixture',
      FAQ_OPENROUTER_BASE_URL: 'http://gateway.test/v1',
    });
    expect(set.FAQ_AI_DRIVER).toBe('fixture');
    expect(set.FAQ_OPENROUTER_BASE_URL).toBe('http://gateway.test/v1');
  });

  it('refuse a driver that does not exist and a base URL that is not a URL', () => {
    expect(() => validateEnv({ ...base, FAQ_AI_DRIVER: 'openai' })).toThrow();
    expect(() => validateEnv({ ...base, FAQ_OPENROUTER_BASE_URL: 'nope' })).toThrow();
  });

  it('the fixture is fine in development and test, and stops a production process from booting', () => {
    for (const NODE_ENV of ['development', 'test']) {
      expect(() => validateEnv({ ...base, NODE_ENV, FAQ_AI_DRIVER: 'fixture' })).not.toThrow();
    }
    expect(() => validateEnv({ ...production, FAQ_AI_DRIVER: 'fixture' })).toThrow(/fixture/);
    expect(() => validateEnv({ ...production, FAQ_AI_DRIVER: 'openrouter' })).not.toThrow();
  });
});
