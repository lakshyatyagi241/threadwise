import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = resolve(__dirname, '../../../src/modules/install-update-licensing');

/**
 * Platform-wide data is reached only through the sanctioned doors (PlatformStore, TenantDirectory). This domain
 * adds no door of its own: a `.privileged(` call here would be a new way past tenant isolation.
 */
describe('install-update-licensing privileged access', () => {
  it('has no .privileged( call and no raw SQL builder', () => {
    for (const f of readdirSync(DIR).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(join(DIR, f), 'utf8');
      expect(src, f).not.toMatch(/\.privileged\(/);
      expect(src, f).not.toMatch(/sql\.raw\(/);
    }
  });
});
