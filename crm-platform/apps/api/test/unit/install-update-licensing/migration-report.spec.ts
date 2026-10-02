import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildMigrationReport,
  readMigrationFiles,
} from '../../../src/modules/install-update-licensing/migration-report';
import { buildReleaseInfo } from '../../../src/modules/install-update-licensing/release-info';
import { readInstEnv } from '../../../src/config/domains/install-update-licensing.env';

const at = new Date('2026-10-01T10:00:00Z');
const files = [
  { id: '0001_a', checksum: 'aaaa' },
  { id: '0002_b', checksum: 'bbbb' },
];

describe('migration report (WD-INST-024: drift is reported, never swallowed)', () => {
  it('current when every file is applied unchanged', () => {
    const r = buildMigrationReport(files, [
      { id: '0001_a', checksum: 'aaaa', appliedAt: at },
      { id: '0002_b', checksum: 'bbbb', appliedAt: at },
    ]);
    expect(r.status).toBe('current');
    expect(r.rows.map((x) => x.state)).toEqual(['applied', 'applied']);
    expect(r.appliedCount).toBe(2);
  });

  it('pending when the build ships a migration the database has not run', () => {
    const r = buildMigrationReport(files, [{ id: '0001_a', checksum: 'aaaa', appliedAt: at }]);
    expect(r.status).toBe('pending');
    expect(r.rows[1]).toEqual({ id: '0002_b', state: 'pending', appliedAt: null });
  });

  it('drift when an applied file changed or an applied migration is no longer shipped', () => {
    const changed = buildMigrationReport(files, [
      { id: '0001_a', checksum: 'CHANGED', appliedAt: at },
      { id: '0002_b', checksum: 'bbbb', appliedAt: at },
    ]);
    expect(changed.status).toBe('drift');
    expect(changed.rows[0]?.state).toBe('modified');

    const gone = buildMigrationReport(files, [
      { id: '0001_a', checksum: 'aaaa', appliedAt: at },
      { id: '0002_b', checksum: 'bbbb', appliedAt: at },
      { id: '0003_old', checksum: 'cccc', appliedAt: at },
    ]);
    expect(gone.status).toBe('drift');
    expect(gone.rows.at(-1)).toMatchObject({ id: '0003_old', state: 'missing-file' });
  });

  it('unknown (ledger only) when the build ships no migration files', () => {
    const r = buildMigrationReport(null, [{ id: '0001_a', checksum: 'aaaa', appliedAt: at }]);
    expect(r.status).toBe('unknown');
    expect(r.appliedCount).toBe(1);
  });

  it('reads files in order with the same short sha256 the runner records', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inst-mig-'));
    try {
      writeFileSync(join(dir, '0002_b.sql'), 'SELECT 2;');
      writeFileSync(join(dir, '0001_a.sql'), 'SELECT 1;');
      writeFileSync(join(dir, 'README.md'), 'ignored');
      const read = readMigrationFiles(dir);
      expect(read.map((f) => f.id)).toEqual(['0001_a', '0002_b']);
      expect(read[0]?.checksum).toMatch(/^[0-9a-f]{16}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('release info (WD-INST-027)', () => {
  it('carries the injected build metadata and the demo flag', () => {
    const env = readInstEnv({ GIT_SHA: 'abc1234', BUILD_NUMBER: '42', DEMO_MODE: 'true' });
    expect(buildReleaseInfo(env, 'production', '1.2.3')).toEqual({
      version: '1.2.3',
      gitSha: 'abc1234',
      buildNumber: '42',
      builtAt: null,
      environment: 'production',
      demoMode: true,
    });
  });
  it('reads the real package version when none is given', () => {
    const info = buildReleaseInfo(readInstEnv({}), 'test');
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(info.version).not.toBe('0.0.0');
  });
});
