import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = [
  resolve(__dirname, '../../../src/modules/localization-translation'),
  resolve(__dirname, '../../../src/infra/providers/localization-translation'),
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/**
 * The language registry, provider catalogue and platform settings are platform data. This domain reaches them only
 * through the auth module's PlatformStore (the sanctioned door), so it adds no privileged call of its own.
 */
describe('privileged database access in the localization-translation domain', () => {
  const all = ROOTS.flatMap(files);

  it('finds the sources (the scan is not vacuous)', () => {
    expect(all.length).toBeGreaterThan(15);
  });

  it('contains no `.privileged(` call', () => {
    const offenders = all
      .filter((f) => /\.privileged\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(resolve(__dirname, '../../..'), f));
    expect(offenders).toEqual([]);
  });

  it('keeps controllers away from the database and the store', () => {
    for (const f of all.filter((p) => p.endsWith('.controller.ts'))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(
        /DatabaseService|PlatformStore|\.privileged\(/,
      );
    }
  });

  it('builds SQL with bound parameters only', () => {
    for (const f of all) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/sql\.raw\(/);
      expect(src, f).not.toMatch(/\.execute\(\s*[`'"]/);
    }
  });

  it('never writes a credential value into an audit payload', () => {
    const src = readFileSync(join(ROOTS[0]!, 'providers-admin.service.ts'), 'utf8');
    // the payloads name keys (fieldsSet / missingFields) and never the credential map itself
    expect(src).not.toMatch(/payload:\s*\{[^}]*credentials[^}]*\}/);
  });
});
