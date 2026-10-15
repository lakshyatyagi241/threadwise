import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { FlowSubscriberStatus } from '@crm/contracts';

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (res as { rows: Row[] }).rows;

export interface SubscriberRow {
  id: number;
  flowId: number;
  contactId: number;
  status: FlowSubscriberStatus;
  source: string;
  lastRunId: number | null;
  retryCount: number;
}

const toRow = (r: Row): SubscriberRow => ({
  id: Number(r.id),
  flowId: Number(r.flow_id),
  contactId: Number(r.contact_id),
  status: r.status as FlowSubscriberStatus,
  source: String(r.source),
  lastRunId: r.last_run_id === null ? null : Number(r.last_run_id),
  retryCount: Number(r.retry_count),
});

const COLS = sql`id, flow_id, contact_id, status, source, last_run_id, retry_count`;

/** A contact's place in a flow (TW-FLR-011, 051). One row per (flow, contact); the run it last had is `last_run_id`. */
@Injectable()
export class SubscriberRepository {
  async find(tx: Tx, orgId: number, flowId: number, contactId: number, forUpdate = false) {
    const base = sql`SELECT ${COLS} FROM flow_subscribers WHERE org_id = ${orgId} AND flow_id = ${flowId} AND contact_id = ${contactId}`;
    const res = await tx.execute(forUpdate ? sql`${base} FOR UPDATE` : base);
    const r = rowsOf(res)[0];
    return r ? toRow(r) : null;
  }

  async findById(tx: Tx, orgId: number, id: number, forUpdate = false) {
    const base = sql`SELECT ${COLS} FROM flow_subscribers WHERE org_id = ${orgId} AND id = ${id}`;
    const res = await tx.execute(forUpdate ? sql`${base} FOR UPDATE` : base);
    const r = rowsOf(res)[0];
    return r ? toRow(r) : null;
  }

  /** Creates the row, or returns the one that is there. `created` says which: a launch happens only for a new or failed row. */
  async firstOrCreate(
    tx: Tx,
    orgId: number,
    flowId: number,
    contactId: number,
    source: string,
  ): Promise<{ row: SubscriberRow; created: boolean }> {
    const ins = await tx.execute(sql`
      INSERT INTO flow_subscribers (org_id, flow_id, contact_id, enrolled_at, status, source)
      VALUES (${orgId}, ${flowId}, ${contactId}, now(), 'active', ${source})
      ON CONFLICT (org_id, flow_id, contact_id) DO NOTHING
      RETURNING ${COLS}`);
    const made = rowsOf(ins)[0];
    if (made) return { row: toRow(made), created: true };
    return { row: (await this.find(tx, orgId, flowId, contactId, true))!, created: false };
  }

  async reactivate(
    tx: Tx,
    orgId: number,
    id: number,
    source: string,
    retry: boolean,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE flow_subscribers
         SET status = 'active', failed_at = NULL, failure_reason = NULL, completed_at = NULL, source = ${source},
             enrolled_at = CASE WHEN ${retry} THEN enrolled_at ELSE now() END,
             retry_count = retry_count + ${retry ? 1 : 0}, last_retried_at = CASE WHEN ${retry} THEN now() ELSE last_retried_at END
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async attachRun(tx: Tx, orgId: number, id: number, runId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE flow_subscribers SET last_run_id = ${runId} WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  async markCompleted(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE flow_subscribers SET status = 'completed', completed_at = now(), failed_at = NULL, failure_reason = NULL
      WHERE org_id = ${orgId} AND id = ${id} AND status IN ('active', 'failed')`);
  }

  /** The reason is cut to 191 characters, the width Reference's column had. */
  async markFailed(tx: Tx, orgId: number, id: number, reason: string): Promise<void> {
    await tx.execute(sql`
      UPDATE flow_subscribers SET status = 'failed', failed_at = now(), failure_reason = ${reason.slice(0, 191)}
      WHERE org_id = ${orgId} AND id = ${id} AND status IN ('active', 'failed')`);
  }

  /**
   * A start that was refused (a trigger loop): the subscriber shows `failed` with the reason whatever it was before, except a paused
   * one (an operator's hold stays). A failed row may launch again on the next, unrelated, event.
   */
  async markRefused(tx: Tx, orgId: number, id: number, reason: string): Promise<void> {
    await tx.execute(sql`
      UPDATE flow_subscribers SET status = 'failed', failed_at = now(), failure_reason = ${reason.slice(0, 191)}
      WHERE org_id = ${orgId} AND id = ${id} AND status <> 'paused'`);
  }

  async setStatus(tx: Tx, orgId: number, id: number, status: FlowSubscriberStatus): Promise<void> {
    await tx.execute(
      sql`UPDATE flow_subscribers SET status = ${status} WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }
}
