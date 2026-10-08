import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { ReportScope } from '@crm/contracts';
import type { Tx } from '@crm/db';

export interface ReportDocumentRow {
  id: number;
  uuid: string;
  name: string;
  extension: string;
  mime: string | null;
  sizeBytes: number;
  charCount: number;
  truncated: boolean;
  status: string;
  failureReason: string | null;
  createdAt: Date;
}

/** A row with the text the assistant reads; it never leaves the module except through the assistant's tools. */
export interface ReportDocumentFull extends ReportDocumentRow {
  extractedText: string;
}

export interface ReportDocumentInsert {
  name: string;
  extension: string;
  mime: string | null;
  sizeBytes: number;
  charCount: number;
  truncated: boolean;
  extractedText: string;
  /** users.id in a workspace; platform_operators.id on the platform. */
  createdBy: number | null;
}

type Raw = Record<string, unknown>;

const LIST_COLUMNS = sql.raw(
  'id, uuid, name, extension, mime, size_bytes, char_count, truncated, status, failure_reason, created_at',
);

const toRow = (r: Raw): ReportDocumentRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  name: r.name as string,
  extension: r.extension as string,
  mime: (r.mime as string | null) ?? null,
  sizeBytes: Number(r.size_bytes),
  charCount: Number(r.char_count),
  truncated: r.truncated as boolean,
  status: r.status as string,
  failureReason: (r.failure_reason as string | null) ?? null,
  createdAt: new Date(r.created_at as string),
});

/**
 * `report_documents` (a workspace's library) and `platform_report_documents` (the operator's), behind one set of queries. The table is
 * chosen from a closed list, never from input. A workspace query also names its `org_id` next to the RLS policy that already confines it,
 * so a missing tenant context fails closed twice; the platform table has no `org_id` and is reachable only through the platform door.
 */
@Injectable()
export class ReportDocumentsRepository {
  private table(scope: ReportScope) {
    return sql.raw(scope === 'workspace' ? 'report_documents' : 'platform_report_documents');
  }

  private scoped(scope: ReportScope, orgId: number) {
    return scope === 'workspace' ? sql`org_id = ${orgId}` : sql`TRUE`;
  }

  async list(
    tx: Tx,
    scope: ReportScope,
    orgId: number,
    limit: number,
  ): Promise<ReportDocumentRow[]> {
    const res = await tx.execute(sql`
      SELECT ${LIST_COLUMNS} FROM ${this.table(scope)}
      WHERE ${this.scoped(scope, orgId)}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}`);
    return (res.rows as Raw[]).map(toRow);
  }

  async count(tx: Tx, scope: ReportScope, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM ${this.table(scope)} WHERE ${this.scoped(scope, orgId)}`,
    );
    return Number((res.rows[0] as Raw).n);
  }

  /**
   * Serialises uploads into one library for the length of the transaction, so two uploads at 24 of 25 cannot both pass the count.
   * Released on commit or rollback.
   */
  async lockLibrary(tx: Tx, scope: ReportScope, orgId: number): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`report-library:${scope}:${orgId}`}, 0))`,
    );
  }

  async findByUuid(
    tx: Tx,
    scope: ReportScope,
    orgId: number,
    uuid: string,
  ): Promise<ReportDocumentRow | undefined> {
    const res = await tx.execute(sql`
      SELECT ${LIST_COLUMNS} FROM ${this.table(scope)}
      WHERE ${this.scoped(scope, orgId)} AND uuid = ${uuid}`);
    const r = res.rows[0] as Raw | undefined;
    return r ? toRow(r) : undefined;
  }

  async findFullByUuid(
    tx: Tx,
    scope: ReportScope,
    orgId: number,
    uuid: string,
  ): Promise<ReportDocumentFull | undefined> {
    const res = await tx.execute(sql`
      SELECT ${LIST_COLUMNS}, extracted_text FROM ${this.table(scope)}
      WHERE ${this.scoped(scope, orgId)} AND uuid = ${uuid}`);
    const r = res.rows[0] as Raw | undefined;
    return r ? { ...toRow(r), extractedText: r.extracted_text as string } : undefined;
  }

  async insert(
    tx: Tx,
    scope: ReportScope,
    orgId: number,
    input: ReportDocumentInsert,
  ): Promise<ReportDocumentRow> {
    const values = sql`${input.name}, ${input.extension}, ${input.mime}, ${input.sizeBytes}, ${input.charCount},
      ${input.truncated}, ${input.extractedText}, ${input.createdBy}`;
    const res =
      scope === 'workspace'
        ? await tx.execute(sql`
            INSERT INTO report_documents (org_id, name, extension, mime, size_bytes, char_count, truncated, extracted_text, created_by)
            VALUES (${orgId}, ${values})
            RETURNING ${LIST_COLUMNS}`)
        : await tx.execute(sql`
            INSERT INTO platform_report_documents (name, extension, mime, size_bytes, char_count, truncated, extracted_text, created_by)
            VALUES (${values})
            RETURNING ${LIST_COLUMNS}`);
    return toRow(res.rows[0] as Raw);
  }

  async delete(tx: Tx, scope: ReportScope, orgId: number, id: number): Promise<void> {
    await tx.execute(
      sql`DELETE FROM ${this.table(scope)} WHERE ${this.scoped(scope, orgId)} AND id = ${id}`,
    );
  }
}
