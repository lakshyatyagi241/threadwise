import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DEPLOYMENT_STALL_MINUTES, type DeploymentStatus } from '@crm/contracts';
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
}

export type Raw = Record<string, unknown>;
