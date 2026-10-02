import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = resolve(__dirname, '../../../src/modules/ai-keys-usage-admin');
const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'));
const text = (f: string) => readFileSync(join(DIR, f), 'utf8');

/**
 * The platform's keys (`admin_ai_keys`) and the cross-workspace ledger totals are operator data: their row-level
 * security opens only under the privileged flag. This module never opens that flag itself. It goes through the auth
 * module's PlatformStore, the one sanctioned door, so the cross-tenant surface stays a file anyone can read.
 */
describe('privileged database access in the AI keys module', () => {
  it('finds the module sources (the scan is not vacuous)', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'platform-keys.service.ts',
        'ai-key-resolver.service.ts',
        'ai-usage.service.ts',
        'ai-token-meter.service.ts',
      ]),
    );
  });

  it('never calls `.privileged(` itself', () => {
    expect(files.filter((f) => /\.privileged\(/.test(text(f)))).toEqual([]);
  });

  it('reads and writes the operator tables only through the platform door', () => {
    for (const f of [
      'platform-keys.service.ts',
      'ai-key-resolver.service.ts',
      'ai-models.service.ts',
    ]) {
      expect(text(f), f).toMatch(/PlatformStore/);
    }
    expect(text('platform-keys.service.ts')).not.toMatch(/DatabaseService/);
  });

  it('keeps the controllers away from the database and the store', () => {
    for (const f of files.filter((n) => n.endsWith('.controller.ts'))) {
      expect(text(f), f).not.toMatch(/DatabaseService|PlatformStore|\.privileged\(|\.primary\b/);
    }
  });

  it('uses sql.raw only for the constant column lists', () => {
    for (const f of files) {
      for (const m of text(f).matchAll(/sql\.raw\(([^)]*)\)/g)) {
        expect(m[1], f).toMatch(/^\s*'[^'$`]*',?\s*$/);
      }
    }
  });

  it('puts operator routes behind the operator guard and never trusts a tenant id from the request', () => {
    const c = text('platform-ai.controller.ts');
    expect(c.match(/@UseGuards\(OperatorGuard\)/g)).toHaveLength(2);
    expect(c).toMatch(/@OperatorRoles\('super_admin'\)/);
    for (const f of ['workspace-ai.controller.ts', 'workspace-keys.service.ts']) {
      expect(text(f), f).not.toMatch(/@Query\([^)]*orgId|@Body\([^)]*orgId/);
    }
  });
});
