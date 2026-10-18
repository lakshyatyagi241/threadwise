import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';
import type { FailedOperationStatus, FailureCategory } from './failure-taxonomy';

/**
 * The only door to `failed_operations` and its event history. Both tables are privileged-only (no workspace policy exists), so every
 * method runs privileged; nothing a customer can call reaches this class. A grep for `.privileged(` in this module must find this
 * file and nothing else.
 */

export interface FailedOperationRow {
  id: number;
  uuid: string;
  org_id: number | null;
  source_queue: string;
  job_name: string;
  original_job_id: string;
  status: FailedOperationStatus;
  failure_category: FailureCategory;
  error_code: string;
  error_summary: string | null;
  attempts_made: number;
  max_attempts: number;
  payload_hash: string | null;
  has_payload: boolean;
  payload_schema_version: number;
  correlation_id: string | null;
  policy_version: string;
  replay_count: number;
  last_replay_at: Date | null;
  claimed_at: Date | null;
  resolved_at: Date | null;
  resolution_reason: string | null;
  first_failed_at: Date;
  last_failed_at: Date;
  created_at: Date;
  row_version: number;
}

const COLUMNS = sql`id, uuid, org_id, source_queue, job_name, original_job_id, status, failure_category, error_code, error_summary,
  attempts_made, max_attempts, payload_hash, (payload_sealed IS NOT NULL) AS has_payload, payload_schema_version, correlation_id,
  policy_version, replay_count, last_replay_at, claimed_at, resolved_at, resolution_reason, first_failed_at, last_failed_at,
  created_at, row_version`;

const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const toDateOrNull = (v: unknown): Date | null =>
  v === null || v === undefined ? null : toDate(v);

/**
 * The driver hands raw-SQL rows back with bigint columns and timestamps as strings; every row leaves this class typed the way
 * {@link FailedOperationRow} says, so callers never meet a string where they expect a Date.
 */
function normalize(raw: unknown): FailedOperationRow {
  const r = raw as Record<string, unknown>;
  return {
    ...(r as unknown as FailedOperationRow),
    id: Number(r.id),
    org_id: r.org_id === null || r.org_id === undefined ? null : Number(r.org_id),
    last_replay_at: toDateOrNull(r.last_replay_at),
    claimed_at: toDateOrNull(r.claimed_at),
    resolved_at: toDateOrNull(r.resolved_at),
    first_failed_at: toDate(r.first_failed_at),
    last_failed_at: toDate(r.last_failed_at),
    created_at: toDate(r.created_at),
  };
}

export interface NewFailedOperation {
  orgId: number | null;
  sourceQueue: string;
  jobName: string;
  originalJobId: string;
  status: FailedOperationStatus;
  category: FailureCategory;
  errorCode: string;
  errorSummary: string;
  attemptsMade: number;
  maxAttempts: number;
  payloadHash: string | null;
  payloadSealed: string | null;
  payloadSchemaVersion: number;
  correlationId: string | null;
  policyVersion: string;
  firstFailedAt: Date;
  lastFailedAt: Date;
}

export type EventType =
  | 'CAPTURED'
  | 'FAILED_AGAIN'
  | 'REDRIVE_ENQUEUED'
  | 'REDRIVE_REJECTED'
  | 'REDRIVE_REVERTED'
  | 'REDRIVE_STALE'
  | 'RESOLVED'
  | 'TERMINATED'
  | 'ESCALATED';

export interface Actor {
  type: 'system' | 'platform_operator';
  id: number | null;
}

export interface ListFilter {
  status?: FailedOperationStatus;
  queue?: string;
  openOnly?: boolean;
  limit: number;
}

@Injectable()
export class FailedOperationsRepository {
  constructor(private readonly db: DatabaseService) {}

  private tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.privileged(fn);
  }

  private async event(
    tx: Tx,
    id: number,
    type: EventType,
    actor: Actor,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO failed_operation_events (failed_operation_id, event_type, actor_type, actor_id, detail)
      VALUES (${id}, ${type}, ${actor.type}, ${actor.id}, ${JSON.stringify(detail)}::jsonb)
    `);
  }

  /**
   * Records a failure once per logical operation. A second report of the same job (the worker event fired twice, the reconcile sweep
   * saw it again) changes nothing and says so, so one failure is one incident however many notifications arrive.
   */
  async capture(n: NewFailedOperation): Promise<{ created: boolean; uuid: string | null }> {
    return this.tx(async (tx) => {
      const res = await tx.execute(sql`
        INSERT INTO failed_operations
          (org_id, source_queue, job_name, original_job_id, status, failure_category, error_code, error_summary, attempts_made,
           max_attempts, payload_hash, payload_sealed, payload_schema_version, correlation_id, policy_version, first_failed_at, last_failed_at)
        VALUES
          (${n.orgId}, ${n.sourceQueue}, ${n.jobName}, ${n.originalJobId}, ${n.status}, ${n.category}, ${n.errorCode}, ${n.errorSummary},
           ${n.attemptsMade}, ${n.maxAttempts}, ${n.payloadHash}, ${n.payloadSealed}, ${n.payloadSchemaVersion}, ${n.correlationId},
           ${n.policyVersion}, ${n.firstFailedAt}, ${n.lastFailedAt})
        ON CONFLICT (source_queue, original_job_id) DO NOTHING
        RETURNING id, uuid
      `);
      const row = res.rows[0] as { id: number; uuid: string } | undefined;
      if (!row) {
        const known = await tx.execute(
          sql`SELECT uuid FROM failed_operations WHERE source_queue = ${n.sourceQueue} AND original_job_id = ${n.originalJobId}`,
        );
        return {
          created: false,
          uuid: (known.rows[0] as { uuid: string } | undefined)?.uuid ?? null,
        };
      }
      await this.event(
        tx,
        row.id,
        'CAPTURED',
        { type: 'system', id: null },
        {
          category: n.category,
          code: n.errorCode,
          attemptsMade: n.attemptsMade,
          status: n.status,
        },
      );
      return { created: true, uuid: row.uuid };
    });
  }

  async byUuid(uuid: string): Promise<FailedOperationRow | null> {
    return this.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT ${COLUMNS} FROM failed_operations WHERE uuid = ${uuid}`,
      );
      const row = res.rows[0];
      return row ? normalize(row) : null;
    });
  }

  async sealedPayload(uuid: string): Promise<string | null> {
    return this.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT payload_sealed FROM failed_operations WHERE uuid = ${uuid}`,
      );
      return (res.rows[0] as { payload_sealed: string | null } | undefined)?.payload_sealed ?? null;
    });
  }

  async list(f: ListFilter): Promise<FailedOperationRow[]> {
    return this.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT ${COLUMNS} FROM failed_operations
        WHERE (${f.status ?? null}::text IS NULL OR status = ${f.status ?? null})
          AND (${f.queue ?? null}::text IS NULL OR source_queue = ${f.queue ?? null})
          AND (${f.openOnly === true} = false OR status NOT IN ('RESOLVED', 'TERMINAL'))
        ORDER BY last_failed_at DESC, id DESC
        LIMIT ${f.limit}
      `);
      return res.rows.map(normalize);
    });
  }

  async events(uuid: string): Promise<
    Array<{
      eventType: string;
      actorType: string;
      actorId: number | null;
      detail: unknown;
      createdAt: Date;
    }>
  > {
    return this.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT e.event_type, e.actor_type, e.actor_id, e.detail, e.created_at
        FROM failed_operation_events e JOIN failed_operations f ON f.id = e.failed_operation_id
        WHERE f.uuid = ${uuid} ORDER BY e.id
      `);
      return (res.rows as Array<Record<string, unknown>>).map((r) => ({
        eventType: String(r.event_type),
        actorType: String(r.actor_type),
        actorId: r.actor_id === null ? null : Number(r.actor_id),
        detail: r.detail,
        createdAt: new Date(String(r.created_at)),
      }));
    });
  }

  /** Whether a workspace may still run work. null: no such workspace (erased), which is not active either. */
  async orgActive(orgId: number): Promise<boolean> {
    return this.tx(async (tx) => {
      const res = await tx.execute(sql`SELECT status FROM organizations WHERE id = ${orgId}`);
      return (res.rows[0] as { status?: string } | undefined)?.status === 'active';
    });
  }

  /**
   * Takes the record for one redrive. Compare-and-swap on the status the decision was made against and on the version the caller
   * read: of two operators (or a double click) exactly one gets a row back. The replay number it returns is the one the job id uses.
   */
  async claim(row: FailedOperationRow, actor: Actor): Promise<{ replay: number } | null> {
    return this.tx(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE failed_operations
        SET status = 'REDRIVING', replay_count = replay_count + 1, last_replay_at = now(), claimed_at = now()
        WHERE uuid = ${row.uuid} AND status = ${row.status} AND row_version = ${row.row_version}
        RETURNING id, replay_count
      `);
      const got = res.rows[0] as { id: number; replay_count: number } | undefined;
      if (!got) return null;
      await this.event(tx, got.id, 'REDRIVE_ENQUEUED', actor, {
        replay: got.replay_count,
        from: row.status,
      });
      return { replay: Number(got.replay_count) };
    });
  }

  /** The enqueue after a claim failed: nothing ran, so the attempt does not count against the budget. */
  async revertClaim(
    uuid: string,
    backTo: FailedOperationStatus,
    reason: string,
    actor: Actor,
  ): Promise<void> {
    await this.tx(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE failed_operations
        SET status = ${backTo}, replay_count = greatest(replay_count - 1, 0), claimed_at = NULL
        WHERE uuid = ${uuid} AND status = 'REDRIVING'
        RETURNING id
      `);
      const got = res.rows[0] as { id: number } | undefined;
      if (got) await this.event(tx, got.id, 'REDRIVE_REVERTED', actor, { reason });
    });
  }

  async reject(row: FailedOperationRow, code: string, reason: string, actor: Actor): Promise<void> {
    await this.tx((tx) => this.event(tx, row.id, 'REDRIVE_REJECTED', actor, { code, reason }));
  }

  /** A redriven job failed again: back to a state a person can act on, or ESCALATED once the budget is used. */
  async replayFailed(
    uuid: string,
    next: {
      status: FailedOperationStatus;
      category: FailureCategory;
      errorCode: string;
      summary: string;
      attemptsMade: number;
    },
  ): Promise<boolean> {
    return this.tx(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE failed_operations
        SET status = ${next.status}, failure_category = ${next.category}, error_code = ${next.errorCode},
            error_summary = ${next.summary}, attempts_made = ${next.attemptsMade}, last_failed_at = now(), claimed_at = NULL
        WHERE uuid = ${uuid} AND status = 'REDRIVING'
        RETURNING id
      `);
      const got = res.rows[0] as { id: number } | undefined;
      if (!got) return false;
      await this.event(
        tx,
        got.id,
        next.status === 'ESCALATED' ? 'ESCALATED' : 'FAILED_AGAIN',
        { type: 'system', id: null },
        {
          category: next.category,
          code: next.errorCode,
          status: next.status,
        },
      );
      return true;
    });
  }

  /**
   * Closes a record and drops its payload (the only place sensitive data lives): nothing needs it once the operation is accounted for.
   * `from` guards the transition, so closing twice or closing a record that moved on changes nothing.
   */
  async close(
    uuid: string,
    to: 'RESOLVED' | 'TERMINAL',
    from: FailedOperationStatus[],
    reason: string,
    actor: Actor,
  ): Promise<boolean> {
    return this.tx(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE failed_operations
        SET status = ${to}, resolved_at = now(), resolution_reason = ${reason}, payload_sealed = NULL, claimed_at = NULL
        WHERE uuid = ${uuid} AND status IN (${sql.join(
          from.map((s) => sql`${s}`),
          sql`, `,
        )})
        RETURNING id
      `);
      const got = res.rows[0] as { id: number } | undefined;
      if (!got) return false;
      await this.event(tx, got.id, to === 'RESOLVED' ? 'RESOLVED' : 'TERMINATED', actor, {
        reason,
      });
      return true;
    });
  }

  /** Records stuck REDRIVING past the grace period: the process that claimed them may have died before it enqueued or reported. */
  async staleRedriving(
    olderThanMs: number,
  ): Promise<Array<{ uuid: string; source_queue: string; replay_count: number }>> {
    return this.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT uuid, source_queue, replay_count FROM failed_operations
        WHERE status = 'REDRIVING' AND claimed_at < now() - ${`${Math.ceil(olderThanMs / 1000)} seconds`}::interval
        ORDER BY claimed_at LIMIT 100
      `);
      return res.rows as unknown as Array<{
        uuid: string;
        source_queue: string;
        replay_count: number;
      }>;
    });
  }

  async markStale(uuid: string): Promise<void> {
    await this.tx(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE failed_operations SET status = 'OPEN', claimed_at = NULL
        WHERE uuid = ${uuid} AND status = 'REDRIVING' RETURNING id
      `);
      const got = res.rows[0] as { id: number } | undefined;
      if (got) await this.event(tx, got.id, 'REDRIVE_STALE', { type: 'system', id: null }, {});
    });
  }

  /** Open backlog and the age of its oldest member, per queue: what the dashboards and the alert read. */
  async backlog(): Promise<
    Array<{ queue: string; open: number; oldestSeconds: number; escalated: number }>
  > {
    return this.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT source_queue AS queue, count(*)::int AS open,
               coalesce(extract(epoch FROM now() - min(first_failed_at)), 0)::int AS oldest_seconds,
               count(*) FILTER (WHERE status = 'ESCALATED')::int AS escalated
        FROM failed_operations WHERE status NOT IN ('RESOLVED', 'TERMINAL')
        GROUP BY source_queue
      `);
      return (res.rows as Array<Record<string, unknown>>).map((r) => ({
        queue: String(r.queue),
        open: Number(r.open),
        oldestSeconds: Number(r.oldest_seconds),
        escalated: Number(r.escalated),
      }));
    });
  }

  /** Closed records past retention, and their payloads, go. Unresolved records are never touched. */
  async purgeClosed(olderThanDays: number): Promise<number> {
    return this.tx(async (tx) => {
      const res = await tx.execute(sql`
        DELETE FROM failed_operations
        WHERE status IN ('RESOLVED', 'TERMINAL') AND resolved_at < now() - ${`${olderThanDays} days`}::interval
        RETURNING id
      `);
      return res.rows.length;
    });
  }
}
