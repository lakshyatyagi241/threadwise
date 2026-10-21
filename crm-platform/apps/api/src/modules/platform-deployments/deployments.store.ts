import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  DEPLOYMENT_STALL_MINUTES,
  PUBLISH_DONE_WINDOW_DAYS,
  RELEASE_LIST_MAX,
  RELEASE_STALL_MINUTES,
  type DeploymentStatus,
  type PublishStatus,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../infra/db/database.service';

/**
 * The only door through which this module reads across tenants: the Geta publish syncs of every workspace are read privileged, the
 * same way the operator outbox tools read it. Every route is `platform_operator` plus OperatorGuard. A grep for `.privileged(` in
 * this module must find this file and nothing else.
 */
@Injectable()
export class DeploymentsStore {
  constructor(private readonly db: DatabaseService) {}

  /**
   * One row per flow publish that is not idle, with its status derived from the sync row (see the contract for the meaning of each).
   * `queued` is pending before any step has been claimed; `attempted_at` is cleared when a failed push is retried, so a retry that waits
   * in the queue reads as queued, not running.
   */
  list(status: DeploymentStatus | null, limit: number): Promise<{ rows: Raw[]; counts: Raw }> {
    return this.db.privileged(async (tx: Tx) => {
      const deployments = sql`
        WITH d AS (
          SELECT s.uuid AS id, g.uuid AS workspace_id, g.name AS workspace_name,
                 f.uuid AS flow_id, f.flow_name, s.publish_version, s.step, s.failed_step,
                 s.last_error, s.attempted_at, s.updated_at,
                 CASE
                   WHEN s.state = 'pending' AND s.attempted_at IS NULL THEN 'queued'
                   WHEN s.state = 'pending' THEN 'running'
                   WHEN s.state = 'failed' THEN 'failed'
                   ELSE 'live'
                 END AS status,
                 (s.state = 'pending'
                   AND s.updated_at < now() - make_interval(mins => ${DEPLOYMENT_STALL_MINUTES}::int)) AS stalled
          FROM flb_geta_publish_syncs s
          JOIN flows f ON f.org_id = s.org_id AND f.id = s.flow_id
          JOIN organizations g ON g.id = s.org_id
          WHERE s.state IN ('pending', 'failed', 'live')
        )
      `;
      // One statement: the totals (over every row, whatever the filter) and the page, joined to a single counts row. The CTE is
      // evaluated once for both, and the LEFT JOIN keeps the counts row when the filter matches nothing.
      const res = await tx.execute(sql`
        ${deployments},
        c AS (
          SELECT count(*) FILTER (WHERE status = 'running')::int AS c_running,
                 count(*) FILTER (WHERE status = 'queued')::int AS c_queued,
                 count(*) FILTER (WHERE status = 'failed')::int AS c_failed,
                 count(*) FILTER (WHERE status = 'live')::int AS c_live,
                 count(*) FILTER (WHERE stalled)::int AS c_stalled
          FROM d
        )
        SELECT c.*, r.* FROM c
        LEFT JOIN LATERAL (
          SELECT * FROM d
          ${status ? sql`WHERE status = ${status}` : sql``}
          ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END,
                   updated_at DESC, id DESC
          LIMIT ${limit + 1}
        ) r ON true
      `);
      const all = res.rows as Raw[];
      const first = all[0] ?? {};
      const counts: Raw = {
        running: first.c_running,
        queued: first.c_queued,
        failed: first.c_failed,
        live: first.c_live,
        stalled: first.c_stalled,
      };
      return { rows: all.filter((r) => r.id !== null && r.id !== undefined), counts };
    });
  }

  /**
   * Flow publishes: the `flow.published` outbox events of every workspace. Queued is a pending event (attempts 0) or one that is
   * waiting for a retry, running a processing one, failed a dead one (it ran out of retries), done a handled one. Done events older
   * than the window are left out, so the list stays small as history grows; everything still in the queue or failed is always here.
   */
  listPublishes(
    status: PublishStatus | null,
    limit: number,
  ): Promise<{ rows: Raw[]; counts: Raw }> {
    return this.db.privileged(async (tx: Tx) => {
      const events = sql`
        WITH e AS (
          SELECT g.uuid AS workspace_id, g.name AS workspace_name, f.uuid AS flow_id, f.flow_name,
                 o.created_at AS queued_at, o.processed_at, o.attempts, o.last_error, o.status,
                 CASE
                   WHEN o.status = 'processing' THEN 'running'
                   WHEN o.status = 'pending' THEN 'queued'
                   WHEN o.status = 'dead' THEN 'failed'
                   ELSE 'done'
                 END AS publish_status,
                 (o.status IN ('pending', 'processing')
                   AND o.created_at < now() - make_interval(mins => ${DEPLOYMENT_STALL_MINUTES}::int)) AS stalled
          FROM event_outbox o
          JOIN organizations g ON g.id = o.org_id
          JOIN flows f ON f.org_id = o.org_id AND f.id = o.aggregate_id
          WHERE o.event_type = 'flow.published'
            AND (o.status <> 'done' OR o.created_at >= now() - make_interval(days => ${PUBLISH_DONE_WINDOW_DAYS}::int))
        )
      `;
      const res = await tx.execute(sql`
        ${events},
        c AS (
          SELECT count(*) FILTER (WHERE publish_status = 'running')::int AS c_running,
                 count(*) FILTER (WHERE publish_status = 'queued')::int AS c_queued,
                 count(*) FILTER (WHERE publish_status = 'failed')::int AS c_failed,
                 count(*) FILTER (WHERE publish_status = 'done')::int AS c_done,
                 count(*) FILTER (WHERE stalled)::int AS c_stalled
          FROM e
        )
        SELECT c.*, r.* FROM c
        LEFT JOIN LATERAL (
          SELECT * FROM e
          ${status ? sql`WHERE publish_status = ${status}` : sql``}
          ORDER BY CASE publish_status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END,
                   queued_at DESC
          LIMIT ${limit + 1}
        ) r ON true
      `);
      const all = res.rows as Raw[];
      const first = all[0] ?? {};
      const counts: Raw = {
        running: first.c_running,
        queued: first.c_queued,
        failed: first.c_failed,
        done: first.c_done,
        stalled: first.c_stalled,
      };
      return {
        rows: all.filter((r) => r.workspace_id !== null && r.workspace_id !== undefined),
        counts,
      };
    });
  }

  /**
   * Product releases: the newest attempts of platform_releases (written by the deploy scripts on the production and build hosts) and the
   * live tag. Platform data, no tenant; read through the privileged door like the other operator reads.
   */
  listReleases(): Promise<{ rows: Raw[]; live: Raw | null }> {
    return this.db.privileged(async (tx: Tx) => {
      const rows = await tx.execute(sql`
        SELECT attempt, tag, state, step, error, started_at, updated_at, finished_at,
               (state IN ('building', 'shipping', 'releasing')
                 AND updated_at < now() - make_interval(mins => ${RELEASE_STALL_MINUTES}::int)) AS stalled
        FROM platform_releases
        ORDER BY started_at DESC, attempt DESC
        LIMIT ${RELEASE_LIST_MAX}
      `);
      const live = await tx.execute(sql`
        SELECT tag, finished_at FROM platform_releases
        WHERE state = 'ok' ORDER BY finished_at DESC NULLS LAST LIMIT 1
      `);
      return { rows: rows.rows as Raw[], live: (live.rows[0] as Raw | undefined) ?? null };
    });
  }
}

export type Raw = Record<string, unknown>;
