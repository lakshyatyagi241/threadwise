import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MigrationRow } from '@crm/contracts';
import { acceptedChecksums } from '@crm/db';

export interface LedgerEntry {
  id: string;
  checksum: string;
  appliedAt: Date;
}
export interface MigrationFileFact {
  id: string;
  checksum: string;
  /** Every checksum the file may have been recorded under (line endings normalised, as on disk, CRLF). Falls back to `checksum` when absent. */
  accepted?: string[];
}

export interface MigrationReport {
  /** `unknown`: no migration files to compare with, so only the ledger is reported. */
  status: 'current' | 'pending' | 'drift' | 'unknown';
  appliedCount: number;
  rows: MigrationRow[];
}

/**
 * Same checksums the runner (packages/db/src/migrator.ts) accepts, from the shared helper in @crm/db: the first 16 hex
 * characters of the sha256 of the file with LF line endings, and the as-is and CRLF forms older Windows ledgers hold.
 */
export function readMigrationFiles(dir: string): MigrationFileFact[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => {
      const accepted = acceptedChecksums(readFileSync(join(dir, f), 'utf8'));
      return { id: f.replace(/\.sql$/, ''), checksum: accepted[0]!, accepted };
    });
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
      state: (f.accepted ?? [f.checksum]).includes(a.checksum) ? 'applied' : 'modified',
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
