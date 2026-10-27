import { describe, expect, it } from 'vitest';
import { devSeedRefusal } from '../../../src/modules/auth/cli/dev-seed-guard';

const LOCAL = 'postgres://crm:crm@localhost:5432/crm';

describe('devSeedRefusal', () => {
  it('allows a local database when NODE_ENV is unset', () => {
    expect(devSeedRefusal({}, LOCAL)).toBeNull();
  });

  it('allows a local database on 127.0.0.1 and [::1]', () => {
    expect(
      devSeedRefusal({ NODE_ENV: 'development' }, 'postgres://u:p@127.0.0.1:5432/crm'),
    ).toBeNull();
    expect(devSeedRefusal({ NODE_ENV: 'development' }, 'postgres://u:p@[::1]:5432/crm')).toBeNull();
  });

  it('refuses NODE_ENV=production even against a local database', () => {
    expect(devSeedRefusal({ NODE_ENV: 'production' }, LOCAL)).toBe(
      'refusing to seed with NODE_ENV=production',
    );
  });

  it('refuses a non-local host when NODE_ENV is unset, the case the old guard let through', () => {
    const refusal = devSeedRefusal({}, 'postgres://u:p@db.staging.internal:5432/crm');
    expect(refusal).toBe('refusing to seed a non-local database host (db.staging.internal)');
  });

  it('refuses a non-local host for NODE_ENV=staging', () => {
    expect(
      devSeedRefusal({ NODE_ENV: 'staging' }, 'postgres://u:p@10.0.0.5:5432/crm'),
    ).not.toBeNull();
  });

  it('never echoes the password from the URL', () => {
    const refusal = devSeedRefusal({}, 'postgres://admin:s3cret-value@db.example.com:5432/crm');
    expect(refusal).not.toContain('s3cret-value');
  });

  it('refuses a value that is not a URL', () => {
    expect(devSeedRefusal({}, 'not a url')).toBe('The database URL is not a valid URL.');
  });
});
