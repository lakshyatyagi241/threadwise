import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

export interface SourceRow {
  id: number;
  uuid: string;
  assistantId: number | null;
  assistantUuid: string | null;
  kind: string;
  label: string;
  url: string | null;
  hasFile: boolean;
  status: string;
  tokensEstimate: number | null;
  error: string | null;
  createdAt: Date;
}

/** A row with everything a duplicate or the ingest job needs; never leaves the module. */
export interface SourceFull extends SourceRow {
  filePath: string | null;
  content: string | null;
  question: string | null;
  answer: string | null;
}

export interface SourceInsert {
  assistantId: number | null;
  userId: number | null;
  kind: string;
  label: string;
  url?: string | null;
  filePath?: string | null;
  content?: string | null;
  question?: string | null;
  answer?: string | null;
  status: string;
  tokensEstimate?: number | null;
  error?: string | null;
}

type Raw = Record<string, unknown>;
const num = (v: unknown): number => Number(v);
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const COLUMNS = sql`
  s.id, s.uuid, s.assistant_id, a.uuid AS assistant_uuid, s.kind, s.label, s.url, (s.file_path IS NOT NULL) AS has_file,
  s.status, s.tokens_estimate, s.error, s.created_at`;
const FROM = sql`
  ai_training_sources s
  LEFT JOIN ai_chat_assistants a ON a.org_id = s.org_id AND a.id = s.assistant_id`;

const toRow = (r: Raw): SourceRow => ({
  id: num(r.id),
  uuid: r.uuid as string,
  assistantId: r.assistant_id === null ? null : num(r.assistant_id),
  assistantUuid: text(r.assistant_uuid),
  kind: r.kind as string,
  label: r.label as string,
  url: text(r.url),
  hasFile: r.has_file as boolean,
  status: r.status as string,
  tokensEstimate: r.tokens_estimate === null ? null : num(r.tokens_estimate),
  error: text(r.error),
  createdAt: new Date(r.created_at as string),
});

const toFull = (r: Raw): SourceFull => ({
  ...toRow(r),
  filePath: text(r.file_path),
  content: text(r.content),
  question: text(r.question),
  answer: text(r.answer),
});

/** `ai_training_sources`. The assistant's own entries plus the workspace-wide ones (no assistant), as Reference lists them. */
@Injectable()
export class SourcesRepository {
  async listFor(tx: Tx, orgId: number, assistantId: number): Promise<SourceRow[]> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM ${FROM}
      WHERE s.org_id = ${orgId} AND (s.assistant_id = ${assistantId} OR s.assistant_id IS NULL)
      ORDER BY s.id DESC`);
    return (res.rows as Raw[]).map(toRow);
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<SourceFull | undefined> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS}, s.file_path, s.content, s.question, s.answer FROM ${FROM}
      WHERE s.org_id = ${orgId} AND s.uuid = ${uuid}`);
    const r = res.rows[0] as Raw | undefined;
    return r ? toFull(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<SourceFull | undefined> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS}, s.file_path, s.content, s.question, s.answer FROM ${FROM}
      WHERE s.org_id = ${orgId} AND s.id = ${id}`);
    const r = res.rows[0] as Raw | undefined;
    return r ? toFull(r) : undefined;
  }

  /** Every entry of one assistant with its text, for a duplicate. */
  async ownedBy(tx: Tx, orgId: number, assistantId: number): Promise<SourceFull[]> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS}, s.file_path, s.content, s.question, s.answer FROM ${FROM}
      WHERE s.org_id = ${orgId} AND s.assistant_id = ${assistantId}
      ORDER BY s.id`);
    return (res.rows as Raw[]).map(toFull);
  }

  /** Stored file keys of one assistant's entries, read before the assistant is deleted (the cascade removes the rows). */
  async fileKeysOf(tx: Tx, orgId: number, assistantId: number): Promise<string[]> {
    const res = await tx.execute(sql`
      SELECT file_path FROM ai_training_sources
      WHERE org_id = ${orgId} AND assistant_id = ${assistantId} AND file_path IS NOT NULL`);
    return (res.rows as Array<{ file_path: string }>).map((r) => r.file_path);
  }

  async insert(tx: Tx, orgId: number, s: SourceInsert): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO ai_training_sources (
        org_id, assistant_id, user_id, kind, label, url, file_path, content, question, answer, status, tokens_estimate, error)
      VALUES (
        ${orgId}, ${s.assistantId}, ${s.userId}, ${s.kind}, ${s.label}, ${s.url ?? null}, ${s.filePath ?? null},
        ${s.content ?? null}, ${s.question ?? null}, ${s.answer ?? null}, ${s.status}, ${s.tokensEstimate ?? null},
        ${s.error ?? null})
      RETURNING id`);
    return num((res.rows[0] as Raw).id);
  }

  /**
   * Finishes an entry the background job was reading. Only a row still `processing` is touched, so a job delivered twice (or one
   * that lost the race with a delete) changes nothing the second time. Returns whether a row was finished.
   */
  async finish(
    tx: Tx,
    orgId: number,
    id: number,
    r: {
      status: 'ready' | 'failed';
      content: string | null;
      tokensEstimate: number | null;
      error: string | null;
    },
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE ai_training_sources
      SET status = ${r.status}, content = ${r.content}, tokens_estimate = ${r.tokensEstimate}, error = ${r.error}
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'processing'
      RETURNING id`);
    return res.rows.length > 0;
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM ai_training_sources WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
