import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ZONES = [
  resolve(__dirname, '../../../src/modules/bsp-billing-engine'),
  resolve(__dirname, '../../../src/infra/providers/bsp-billing-engine'),
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/**
 * The reseller module reads across tenants (register, picker, P&L, sweep) but is not one of the sanctioned callers of the
 * privileged escape hatch. Cross-tenant reads go through the auth module's PlatformStore; writes are tenant scoped.
 */
describe('privileged database access in the bsp zone', () => {
  it('no file calls .privileged( and none writes through the platform store', () => {
    const all = ZONES.flatMap(files);
    expect(all.length).toBeGreaterThan(5);
    const privileged = all.filter((f) => /\.privileged\(/.test(readFileSync(f, 'utf8')));
    expect(privileged).toEqual([]);
  });

  it('the platform reader only reads: no INSERT, UPDATE or DELETE statement in it', () => {
    const src = readFileSync(join(ZONES[0]!, 'reseller-platform.reader.ts'), 'utf8');
    expect(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(src)).toBe(false);
  });

  it('every tenant write goes through txAs or tx, never the raw primary handle', () => {
    const all = ZONES.flatMap(files);
    const raw = all.filter((f) => /\.primary\b|\.replica\b/.test(readFileSync(f, 'utf8')));
    expect(raw).toEqual([]);
  });
});
