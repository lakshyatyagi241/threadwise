import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const AUTH_DIR = resolve(__dirname, '../../../src/modules/auth');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/**
 * `.privileged(` is reachable from request handlers in exactly two
 * places. A third caller would widen the cross-tenant surface without anyone
 * deciding to, so this fails the build until the allow-list here is changed on purpose.
 */
describe('privileged database access in the auth module', () => {
  it('is confined to the platform store, the tenant directory and the worker-only maintenance job', () => {
    const allowed = new Set([
      'platform/platform-store.ts',
      'platform/tenant-directory.ts',
      'maintenance/auth-maintenance.service.ts',
    ]);
    const offenders = files(AUTH_DIR)
      .filter((f) => /\.privileged\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(AUTH_DIR, f))
      .filter((f) => !allowed.has(f));
    expect(offenders).toEqual([]);
  });

  it('never passes caller input into SQL text in the gateways', () => {
    for (const f of ['platform/tenant-directory.ts', 'platform/platform-store.ts']) {
      const src = readFileSync(join(AUTH_DIR, f), 'utf8');
      // sql.raw() would bypass parameterisation entirely.
      expect(src).not.toMatch(/sql\.raw\(/);
    }
  });
});
