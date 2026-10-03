import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;

/** The pull connectors' schedule and failure state on `marketplace_connections`, and the cross-tenant list of what is due. */
@Injectable()
export class PullStateRepository {
  /** Active pull connections whose installation is active and whose time has come. Runs on the privileged path (the worker's sweep). */
  async due(tx: Tx, limit: number): Promise<Array<{ orgId: number; connectionId: number }>> {
    const res = await tx.execute(sql`
      SELECT n.org_id, n.id
      FROM marketplace_connections n
      JOIN workspace_app_installations i ON i.org_id = n.org_id AND i.id = n.installation_id
      WHERE n.connector_type = 'pull' AND n.status = 'active' AND i.status = 'active'
        AND n.next_poll_at IS NOT NULL AND n.next_poll_at <= now()
      ORDER BY n.next_poll_at, n.id LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => ({
      orgId: Number(r.org_id),
      connectionId: Number(r.id),
    }));
  }

  async installationIdOf(tx: Tx, orgId: number, connectionId: number): Promise<number | null> {
    const res = await tx.execute(
      sql`SELECT installation_id FROM marketplace_connections WHERE org_id = ${orgId} AND id = ${connectionId}`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? Number(r.installation_id) : null;
  }

  /** A poll that worked: resume from `cursor` next time and wait the recipe's interval. */
  async scheduled(
    tx: Tx,
    orgId: number,
    connectionId: number,
    cursor: string | null,
    intervalSeconds: number,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE marketplace_connections
         SET poll_cursor = ${cursor}, next_poll_at = now() + (${intervalSeconds} || ' seconds')::interval
       WHERE org_id = ${orgId} AND id = ${connectionId}`);
  }

  /**
   * A poll that failed. A retryable failure backs off (the interval doubled for each failure in a row, at most six hours) and the connection
   * stays active; one that cannot succeed by retrying (the portal refused the credentials) stops the connection and says why.
   */
  async failed(
    tx: Tx,
    orgId: number,
    connectionId: number,
    installationId: number,
    f: {
      message: string;
      retry: boolean;
      health: 'degraded' | 'error' | 'needs_reauth';
      intervalSeconds: number;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE marketplace_connections SET
        consecutive_failures = consecutive_failures + 1, failed_count = failed_count + 1,
        last_error = ${f.message}, last_error_at = now(), last_event_at = now(),
        status = CASE WHEN ${f.retry} AND consecutive_failures + 1 < 8 THEN status ELSE 'error' END,
        next_poll_at = now() + (LEAST(${f.intervalSeconds} * power(2, LEAST(consecutive_failures, 5)), 21600) || ' seconds')::interval
      WHERE org_id = ${orgId} AND id = ${connectionId}`);
    await tx.execute(sql`
      UPDATE workspace_app_installations
         SET health_status = ${f.health}, health_checked_at = now(), last_error = ${f.message}, last_error_at = now()
       WHERE org_id = ${orgId} AND id = ${installationId} AND status = 'active'`);
  }

  /** Retention: delivery rows older than this many days go (the lead pipeline keeps the lead and its own raw event). */
  async trimEvents(tx: Tx, days: number): Promise<number> {
    const res = await tx.execute(sql`
      DELETE FROM marketplace_connection_events WHERE received_at < now() - (${days} || ' days')::interval RETURNING id`);
    return (res.rows as Raw[]).length;
  }
}
