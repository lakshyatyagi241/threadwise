import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';

const { auditLog } = schema;

export interface AuditInput {
  module: string;
  recordId: number;
  action: 'insert' | 'update' | 'delete' | 'merge' | 'login' | 'export' | 'read';
  /** Field-level {old,new}. Omit unchanged fields — a full row snapshot is noise. */
  delta?: Record<string, { old: unknown; new: unknown }>;
}

export interface AuditLogRow {
  actorId: number | null;
  actorType: string;
  action: string;
  delta: Record<string, { old: unknown; new: unknown }> | null;
  at: Date;
}

/**
 * Append-only audit trail.
 *
 * Not event sourcing: the business tables stay the source of truth. This
 * answers "who changed this, when, from what to what" — which is what a
 * disputed commission, a deleted lead, or a compliance request actually needs.
 *
 * Streams (messages, message_events, campaign_recipients) are exempt: they are
 * already an immutable log, and auditing an append-only table doubles the write
 * volume to record nothing new.
 */
@Injectable()
export class AuditService {
  async record(tx: Tx, input: AuditInput): Promise<void> {
    const ctx = RequestContextStore.require();

    await tx.execute(sql`
      INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
      VALUES (
        ${ctx.orgId},
        ${ctx.actorId},
        ${ctx.actorType},
        ${input.module},
        ${input.recordId},
        ${input.action},
        ${input.delta ? JSON.stringify(input.delta) : null}::jsonb,
        ${ctx.requestId}
      )
    `);
  }

  /**
   * Rows for one record, newest first — backs "field history" reads over
   * the existing audit trail instead of a dedicated per-module table.
   * Self-contained keyset pagination over (at, id) desc; `cursor` is an
   * opaque base64url token this method both produces and consumes.
   */
  async listByRecord(
    tx: Tx,
    orgId: number,
    module: string,
    recordId: number,
    opts: { limit: number; cursor?: string },
  ): Promise<{
    items: (AuditLogRow & { id: number })[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const conditions = [
      eq(auditLog.orgId, orgId),
      eq(auditLog.module, module),
      eq(auditLog.recordId, recordId),
    ];

    if (opts.cursor) {
      const [atRaw, idRaw] = Buffer.from(opts.cursor, 'base64url').toString('utf8').split('|');
      const at = new Date(atRaw ?? '');
      const id = Number.parseInt(idRaw ?? '', 10);
      if (!Number.isNaN(at.getTime()) && !Number.isNaN(id)) {
        conditions.push(sql`(${auditLog.at}, ${auditLog.id}) < (${at.toISOString()}, ${id})`);
      }
    }

    const rows = await tx
      .select({
        id: auditLog.id,
        actorId: auditLog.actorId,
        actorType: auditLog.actorType,
        action: auditLog.action,
        delta: auditLog.delta,
        at: auditLog.at,
      })
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(opts.limit + 1);

    const hasMore = rows.length > opts.limit;
    const items = (hasMore ? rows.slice(0, opts.limit) : rows) as (AuditLogRow & { id: number })[];
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? Buffer.from(`${last.at.toISOString()}|${last.id}`, 'utf8').toString('base64url')
        : null;

    return { items, nextCursor, hasMore };
  }

  /**
   * Field-level diff of two versions of a row.
   *
   * Only changed keys survive, and only keys present in `next` are considered,
   * so a partial update does not read as "everything else was set to null".
   */
  diff(
    previous: Record<string, unknown>,
    next: Record<string, unknown>,
  ): Record<string, { old: unknown; new: unknown }> {
    const delta: Record<string, { old: unknown; new: unknown }> = {};
    for (const key of Object.keys(next)) {
      const before = previous[key];
      const after = next[key];
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        delta[key] = { old: before ?? null, new: after ?? null };
      }
    }
    return delta;
  }
}
