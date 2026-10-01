import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import { decodeCursor } from '../../../common/pagination/cursor';

const { contactImportJobs } = schema;

export type ImportJobRow = typeof contactImportJobs.$inferSelect;
type JobPatch = Partial<typeof contactImportJobs.$inferInsert>;

/** Data access for `contact_import_jobs`. */
@Injectable()
export class ContactImportRepository {
  async insert(
    tx: Tx,
    orgId: number,
    values: {
      createdBy: number | null;
      fileName: string;
      byteSize: number;
      totalRows: number;
      options: Record<string, unknown>;
      sourceCsv: string;
    },
  ): Promise<ImportJobRow> {
    const [row] = await tx
      .insert(contactImportJobs)
      .values({ orgId, uuid: sql`gen_random_uuid()`, status: 'queued', ...values })
      .returning();
    return row!;
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<ImportJobRow | undefined> {
    const rows = await tx
      .select()
      .from(contactImportJobs)
      .where(and(eq(contactImportJobs.orgId, orgId), eq(contactImportJobs.uuid, uuid)));
    return rows[0];
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<ImportJobRow | undefined> {
    const rows = await tx
      .select()
      .from(contactImportJobs)
      .where(and(eq(contactImportJobs.orgId, orgId), eq(contactImportJobs.id, id)));
    return rows[0];
  }

  /** Newest first, `limit + 1` rows. The uploaded text is never selected for a listing. */
  async list(
    tx: Tx,
    orgId: number,
    filter: { limit: number; cursor?: string },
  ): Promise<ImportJobRow[]> {
    const conditions = [eq(contactImportJobs.orgId, orgId)];
    if (filter.cursor) {
      const c = decodeCursor(filter.cursor);
      conditions.push(
        or(
          lt(contactImportJobs.createdAt, c.createdAt),
          and(eq(contactImportJobs.createdAt, c.createdAt), lt(contactImportJobs.id, c.id)),
        )!,
      );
    }
    const rows = await tx
      .select()
      .from(contactImportJobs)
      .where(and(...conditions))
      .orderBy(desc(contactImportJobs.createdAt), desc(contactImportJobs.id))
      .limit(filter.limit + 1);
    return rows.map((r) => ({ ...r, sourceCsv: null }));
  }

  async update(tx: Tx, orgId: number, id: number, patch: JobPatch): Promise<void> {
    await tx
      .update(contactImportJobs)
      .set(patch)
      .where(and(eq(contactImportJobs.orgId, orgId), eq(contactImportJobs.id, id)));
  }
}
