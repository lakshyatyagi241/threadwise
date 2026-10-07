import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { acceptedChecksums, migrationChecksum, recordedChecksumMatches } from '@crm/db';
import { buildMigrationReport } from '../../../src/modules/install-update-licensing/migration-report';

const sha = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);
const LF = 'CREATE TABLE a (id int);\nINSERT INTO a VALUES (1);\n';
const CRLF = LF.replace(/\n/g, '\r\n');

describe('migration checksums ignore line endings', () => {
  it('hashes a CRLF checkout of the SQL the same as the LF original', () => {
    expect(migrationChecksum(CRLF)).toBe(migrationChecksum(LF));
    expect(migrationChecksum(LF)).toBe(sha(LF));
  });

  it('accepts a checksum recorded from the LF text, the CRLF text, or the normalised text', () => {
    for (const recorded of [sha(LF), sha(CRLF), migrationChecksum(CRLF)]) {
      expect(recordedChecksumMatches(recorded, LF)).toBe(true);
      expect(recordedChecksumMatches(recorded, CRLF)).toBe(true);
    }
  });

  it('still refuses a real change to the SQL', () => {
    const changed = LF.replace('VALUES (1)', 'VALUES (2)');
    expect(recordedChecksumMatches(sha(LF), changed)).toBe(false);
    expect(recordedChecksumMatches(sha(CRLF), changed.replace(/\n/g, '\r\n'))).toBe(false);
  });

  it('lists the current checksum first and never repeats one', () => {
    expect(acceptedChecksums(LF)[0]).toBe(migrationChecksum(LF));
    expect(acceptedChecksums(LF)).toEqual([...new Set(acceptedChecksums(LF))]);
    expect(acceptedChecksums(LF)).toHaveLength(2);
    expect(acceptedChecksums('SELECT 1;\r\nSELECT 2;\r\n')).toHaveLength(3);
  });
});

describe('the migration report with a Windows ledger', () => {
  const at = new Date('2026-10-06T00:00:00Z');
  const accepted = acceptedChecksums(LF);

  it('calls a file applied when the ledger holds its CRLF checksum', () => {
    const report = buildMigrationReport(
      [{ id: '0001_a', checksum: accepted[0]!, accepted }],
      [{ id: '0001_a', checksum: sha(CRLF), appliedAt: at }],
    );
    expect(report.rows[0]?.state).toBe('applied');
    expect(report.status).toBe('current');
  });

  it('still calls a genuinely changed file modified', () => {
    const report = buildMigrationReport(
      [{ id: '0001_a', checksum: accepted[0]!, accepted }],
      [{ id: '0001_a', checksum: sha('something else'), appliedAt: at }],
    );
    expect(report.rows[0]?.state).toBe('modified');
    expect(report.status).toBe('drift');
  });
});
