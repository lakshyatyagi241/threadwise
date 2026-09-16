import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';

export interface AuditInput {
  module: string;
  recordId: number;
  action: 'insert' | 'update' | 'delete' | 'merge' | 'login' | 'export';
  /** Field-level {old,new}. Omit unchanged fields — a full row snapshot is noise. */
  delta?: Record<string, { old: unknown; new: unknown }>;
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
