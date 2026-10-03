import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = resolve(__dirname, '../../../src/modules/coupons-credits-referral-currency');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/**
 * The coupon, credit-package, currency and referral tables are platform data that accept writes only under the privileged flag.
 * Every transaction on them goes through CpnStore, which delegates to the auth module's PlatformStore (the sanctioned door), so
 * this module never calls `.privileged(` itself and its cross-tenant surface is one small file.
 */
describe('privileged database access in the CPN module', () => {
  it('finds the module sources (the scan is not vacuous)', () => {
    const names = files(DIR).map((f) => relative(DIR, f));
    expect(names).toEqual(
      expect.arrayContaining(['cpn-store.ts', 'coupon-admin.service.ts', 'coupons.controller.ts']),
    );
  });

  it('never calls `.privileged(` directly', () => {
    const callers = files(DIR)
      .filter((f) => /\.privileged\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(DIR, f));
    expect(callers).toEqual([]);
  });

  it('keeps the controllers away from the database and the stores', () => {
    for (const f of files(DIR).filter((x) => x.endsWith('.controller.ts'))) {
      const src = readFileSync(f, 'utf8');
      expect(src, relative(DIR, f)).not.toMatch(
        /DatabaseService|CpnStore|PlatformStore|\.privileged\(|\.primary\b/,
      );
    }
  });

  it('builds statements with bound parameters only', () => {
    for (const f of files(DIR)) {
      const src = readFileSync(f, 'utf8');
      expect(src, relative(DIR, f)).not.toMatch(/\.execute\(\s*[`'"]/);
      expect(src, relative(DIR, f)).not.toMatch(/\.query\(/);
      // sql.raw is allowed for constant column lists only: never with interpolation
      for (const m of src.matchAll(/sql\.raw\(([^)]*)\)/g)) {
        expect(m[1], relative(DIR, f)).not.toMatch(/\$\{/);
      }
    }
  });
});
