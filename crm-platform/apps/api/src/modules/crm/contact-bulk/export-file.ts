import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { and, eq, sql } from 'drizzle-orm';
import { EXPORT_KEEP_DAYS } from '@crm/contracts';
import { schema } from '@crm/db';
import { DatabaseService } from '../../../infra/db/database.service';

const { contactExports } = schema;
const gzipAsync = promisify(gzip);

/**
 * The most CSV lines an export keeps for a re-download (about 50,000 recipients). A bigger export is still recorded in the history,
 * without its file: keeping it would hold the whole file in memory.
 */
export const EXPORT_KEEP_MAX_LINES = 50_001;

/** A CSV kept as it streams, for a re-download. `csv` is null when it went over the line limit, so nothing is kept. */
export class ExportKeeper {
  private lines: string[] = [];
  private over = false;

  constructor(private readonly maxLines: number = EXPORT_KEEP_MAX_LINES) {}

  add(line: string): void {
    if (this.over) return;
    this.lines.push(line);
    if (this.lines.length > this.maxLines) {
      this.over = true;
      this.lines = [];
    }
  }

  get csv(): Buffer | null {
    return this.over ? null : Buffer.from(this.lines.join(''), 'utf8');
  }
}

/**
 * Keeps a finished export so its people can download it again for EXPORT_KEEP_DAYS. Expired files of the workspace go with the
 * next one; a file is not deleted while the workspace is under a workspace-wide legal hold (BL-295).
 */
export async function keepExportFile(
  db: DatabaseService,
  input: {
    orgId: number;
    userId: number | null | undefined;
    exportId: string;
    fileName: string;
    rowCount: number;
    csv: Buffer;
  },
): Promise<void> {
  const gz = await gzipAsync(input.csv);
  await db.txAs({ orgId: input.orgId, userId: input.userId }, async (tx) => {
    // Expired files of this workspace go with the next export; there is no separate sweep.
    await tx.delete(contactExports).where(
      and(
        eq(contactExports.orgId, input.orgId),
        sql`${contactExports.expiresAt} <= now()`,
        // A generated file may be evidence: kept while the workspace is under a workspace-wide legal hold (BL-295).
        sql`NOT is_subject_held(${contactExports.orgId}, 'contact', NULL)`,
      ),
    );
    await tx.insert(contactExports).values({
      orgId: input.orgId,
      uuid: input.exportId,
      createdBy: input.userId ?? null,
      fileName: input.fileName,
      rowCount: input.rowCount,
      byteSize: gz.length,
      csvGz: gz,
      expiresAt: new Date(Date.now() + EXPORT_KEEP_DAYS * 86_400_000),
    });
  });
}
