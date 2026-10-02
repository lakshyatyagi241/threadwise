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

describe('CHANNEL_SIMULATOR_ENABLED in the central environment schema', () => {
  it('is false by default and parses the usual boolean spellings', () => {
    expect(validateEnv({ ...base }).CHANNEL_SIMULATOR_ENABLED).toBe(false);
    expect(
      validateEnv({ ...base, CHANNEL_SIMULATOR_ENABLED: 'true' }).CHANNEL_SIMULATOR_ENABLED,
    ).toBe(true);
    expect(validateEnv({ ...base, CHANNEL_SIMULATOR_ENABLED: '0' }).CHANNEL_SIMULATOR_ENABLED).toBe(
      false,
    );
  });

  it('is accepted in development and test', () => {
    for (const NODE_ENV of ['development', 'test']) {
      expect(() =>
        validateEnv({ ...base, NODE_ENV, CHANNEL_SIMULATOR_ENABLED: 'true' }),
      ).not.toThrow();
    }
  });

  it('a production process that sets it fails validation, so the API and the worker both refuse to start', () => {
    expect(() => validateEnv({ ...production, CHANNEL_SIMULATOR_ENABLED: 'true' })).toThrow(
      /CHANNEL_SIMULATOR_ENABLED/,
    );
    expect(() => validateEnv({ ...production })).not.toThrow();
    expect(() => validateEnv({ ...production, CHANNEL_SIMULATOR_ENABLED: 'false' })).not.toThrow();
  });
});
