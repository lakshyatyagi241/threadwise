import { describe, expect, it } from 'vitest';
import { devSeedPassword, seedRefusal } from '@crm/db';

const LOCAL = 'postgres://crm:secret@127.0.0.1:5432/crm';
const ALLOWED = { ALLOW_DEV_SEED: '1' };

/** Issue #1168: the seed created a super_admin with a public password and refused only NODE_ENV=production. */
describe('development seed guard (#1168)', () => {
  it('runs only with the explicit opt-in', () => {
    expect(seedRefusal({}, LOCAL)).toMatch(/ALLOW_DEV_SEED=1/);
    expect(seedRefusal({ ALLOW_DEV_SEED: 'true' }, LOCAL)).toMatch(/ALLOW_DEV_SEED=1/);
    expect(seedRefusal(ALLOWED, LOCAL)).toBeNull();
  });

  it('refuses production, even with the opt-in', () => {
    expect(seedRefusal({ ...ALLOWED, NODE_ENV: 'production' }, LOCAL)).toMatch(/production/);
  });

  it('refuses any database that is not on this machine', () => {
    expect(seedRefusal(ALLOWED, 'postgres://crm:x@db.internal.example:5432/crm')).toMatch(
      /db\.internal\.example/,
    );
    expect(seedRefusal(ALLOWED, 'postgres://crm:x@10.0.0.5:5432/crm')).toMatch(/10\.0\.0\.5/);
  });

  it('accepts localhost, 127.0.0.1 and ::1', () => {
    expect(seedRefusal(ALLOWED, 'postgres://crm:x@localhost:5432/crm')).toBeNull();
    expect(seedRefusal(ALLOWED, 'postgres://crm:x@127.0.0.1:5432/crm')).toBeNull();
    expect(seedRefusal(ALLOWED, 'postgres://crm:x@[::1]:5432/crm')).toBeNull();
  });

  it('refuses a URL it cannot read, rather than guessing its host', () => {
    expect(seedRefusal(ALLOWED, 'not a url')).toMatch(/cannot read/);
  });

  it('uses DEV_SEED_PASSWORD when the developer sets one, and ignores a short one', () => {
    expect(devSeedPassword({ DEV_SEED_PASSWORD: 'a-long-dev-password-1' })).toBe(
      'a-long-dev-password-1',
    );
    expect(devSeedPassword({ DEV_SEED_PASSWORD: 'short' })).not.toBe('short');
  });

  it('generates a different password every run, never the old public one', () => {
    const a = devSeedPassword({});
    const b = devSeedPassword({});
    expect(a).not.toBe(b);
    expect(a).not.toBe('Passw0rd!');
    expect(a.length).toBeGreaterThanOrEqual(20);
  });
});
