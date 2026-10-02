import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MigrationRow } from '@crm/contracts';

export interface LedgerEntry {
  id: string;
  checksum: string;
  appliedAt: Date;
}
export interface MigrationFileFact {
  id: string;
  checksum: string;
}

export interface MigrationReport {
  /** `unknown`: no migration files to compare with, so only the ledger is reported. */
  status: 'current' | 'pending' | 'drift' | 'unknown';
  appliedCount: number;
  rows: MigrationRow[];
}

/**
 * Same checksum the runner (packages/db/src/migrator.ts) records: first 16 hex characters of the file's sha256.
 * Duplicated rather than imported because @crm/db does not export the loader and the runner is a kernel file; if
 * the runner's scheme ever changes, `modified` shows up on every row, which is the loud failure we want.
 */
export function readMigrationFiles(dir: string): MigrationFileFact[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({
      id: f.replace(/\.sql$/, ''),
      checksum: createHash('sha256')
        .update(readFileSync(join(dir, f), 'utf8'))
        .digest('hex')
        .slice(0, 16),
    }));
}

/**
 * Compares the migration files with the database's ledger (WD-INST-024: never swallow drift). Pure.
 *
 *   pending       a file the database has not applied
 *   modified      an applied file whose content changed (the runner refuses to proceed on this)
 *   missing-file  applied in the database, gone from the build (the wrong image is running)
 */
export function buildMigrationReport(
  files: readonly MigrationFileFact[] | null,
  ledger: readonly LedgerEntry[],
): MigrationReport {
  const applied = new Map(ledger.map((l) => [l.id, l]));
  if (files === null) {
    return {
      status: 'unknown',
      appliedCount: ledger.length,
      rows: ledger.map((l) => ({
        id: l.id,
        state: 'applied' as const,
        appliedAt: l.appliedAt.toISOString(),
      })),
    };
  }
  const rows: MigrationRow[] = files.map((f) => {
    const a = applied.get(f.id);
    if (!a) return { id: f.id, state: 'pending', appliedAt: null };
    return {
      id: f.id,
      state: a.checksum === f.checksum ? 'applied' : 'modified',
      appliedAt: a.appliedAt.toISOString(),
    };
  });
  const known = new Set(files.map((f) => f.id));
  for (const l of ledger) {
    if (!known.has(l.id)) {
      rows.push({ id: l.id, state: 'missing-file', appliedAt: l.appliedAt.toISOString() });
    }
  }
  rows.sort((x, y) => x.id.localeCompare(y.id));
  const status = rows.some((r) => r.state === 'modified' || r.state === 'missing-file')
    ? 'drift'
    : rows.some((r) => r.state === 'pending')
      ? 'pending'
      : 'current';
  return { status, appliedCount: ledger.length, rows };
}
