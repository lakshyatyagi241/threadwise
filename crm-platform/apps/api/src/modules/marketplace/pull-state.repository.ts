import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;

export interface PullStateRow {
  lastPollAt: Date | null;
  /** A narrower window than the recipe's, after a window held more leads than one answer carries. */
  pollWindowSeconds: number | null;
}

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

  async stateOf(tx: Tx, orgId: number, connectionId: number): Promise<PullStateRow> {
    const res = await tx.execute(sql`
      SELECT last_poll_at, poll_window_seconds FROM marketplace_connections
       WHERE org_id = ${orgId} AND id = ${connectionId}`);
    const r = (res.rows as Raw[])[0];
    return {
      lastPollAt: r?.last_poll_at ? new Date(r.last_poll_at as string) : null,
      pollWindowSeconds:
        r?.poll_window_seconds === null || r?.poll_window_seconds === undefined
          ? null
          : Number(r.poll_window_seconds),
    };
  }

  /** A request to the portal is about to be made: the portal's minimum interval is kept against this time, whatever comes of it. */
  async markPolling(tx: Tx, orgId: number, connectionId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE marketplace_connections SET last_poll_at = now() WHERE org_id = ${orgId} AND id = ${connectionId}`,
    );
  }

  /** Not yet: nothing was asked, the next try is this far off. */
  async deferred(tx: Tx, orgId: number, connectionId: number, seconds: number): Promise<void> {
    await tx.execute(sql`
      UPDATE marketplace_connections SET next_poll_at = now() + (${seconds} || ' seconds')::interval
       WHERE org_id = ${orgId} AND id = ${connectionId}`);
  }

  /** The leads of a poll did not all get in: resume from `cursor` (unchanged) soon; the pipeline's idempotency absorbs the repeats. */
  async scheduled(
    tx: Tx,
    orgId: number,
    connectionId: number,
    cursor: string | null,
    seconds: number,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE marketplace_connections
         SET poll_cursor = ${cursor}, next_poll_at = now() + (${seconds} || ' seconds')::interval
       WHERE org_id = ${orgId} AND id = ${connectionId}`);
  }

  /**
   * A poll that worked, even if it found nothing: the connection resumes from `cursor` after `nextInSeconds`, and remembers how wide a
   * window the portal answered (`windowSeconds`, null = the recipe's own width) and how many leads this one found. It is healthy again
   * unless some of what the portal returned could not be read (`clean` false): that error stays on the page until a clean poll.
   */
  async succeeded(
    tx: Tx,
    orgId: number,
    connectionId: number,
    installationId: number,
    s: {
      cursor: string | null;
      nextInSeconds: number;
      windowSeconds: number | null;
      leads: number;
      clean: boolean;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE marketplace_connections SET
        poll_cursor = ${s.cursor}, next_poll_at = now() + (${s.nextInSeconds} || ' seconds')::interval,
        poll_window_seconds = ${s.windowSeconds}, last_poll_leads = ${s.leads},
        last_success_at = now(), last_event_at = now(),
        consecutive_failures = CASE WHEN ${s.clean} THEN 0 ELSE consecutive_failures END,
        last_error = CASE WHEN ${s.clean} THEN NULL ELSE last_error END
      WHERE org_id = ${orgId} AND id = ${connectionId}`);
    if (s.clean) {
      await tx.execute(sql`
        UPDATE workspace_app_installations
           SET health_status = 'healthy', health_checked_at = now(), last_error = NULL
         WHERE org_id = ${orgId} AND id = ${installationId} AND status = 'active'`);
    }
  }

  /** The window held more leads than one answer carries: nothing was taken, ask again for `windowSeconds`. */
  async narrowed(
    tx: Tx,
    orgId: number,
    connectionId: number,
    windowSeconds: number,
    seconds: number,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE marketplace_connections
         SET poll_window_seconds = ${windowSeconds}, next_poll_at = now() + (${seconds} || ' seconds')::interval
       WHERE org_id = ${orgId} AND id = ${connectionId}`);
  }

  /**
   * A poll that failed. A retryable failure backs off (the interval doubled for each failure in a row, at most six hours, and never sooner
   * than the portal's own stated penalty) and the connection stays active; one that cannot succeed by retrying (the portal refused the
   * credentials) stops the connection and says why.
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
      retryAfterSeconds?: number;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE marketplace_connections SET
        consecutive_failures = consecutive_failures + 1, failed_count = failed_count + 1,
        last_error = ${f.message}, last_error_at = now(), last_event_at = now(),
        status = CASE WHEN ${f.retry} AND consecutive_failures + 1 < 8 THEN status ELSE 'error' END,
        next_poll_at = now() + (GREATEST(
          ${f.retryAfterSeconds ?? 0},
          LEAST(${f.intervalSeconds} * power(2, LEAST(consecutive_failures, 5)), 21600)
        ) || ' seconds')::interval
      WHERE org_id = ${orgId} AND id = ${connectionId}`);
    await tx.execute(sql`
      UPDATE workspace_app_installations
         SET health_status = ${f.health}, health_checked_at = now(), last_error = ${f.message}, last_error_at = now()
       WHERE org_id = ${orgId} AND id = ${installationId} AND status = 'active'`);
  }

  /**
   * "Sync now", and a connection given new credentials: the next poll is brought forward to the soonest the portal allows (its minimum
   * interval after the last request), and a connection that had stopped on an error is started again. Returns when it will run.
   */
  async requestSync(
    tx: Tx,
    orgId: number,
    connectionId: number,
    minIntervalSeconds: number,
  ): Promise<Date> {
    const res = await tx.execute(sql`
      UPDATE marketplace_connections SET
        status = 'active', consecutive_failures = 0,
        next_poll_at = GREATEST(now(), COALESCE(last_poll_at + (${minIntervalSeconds} || ' seconds')::interval, now()))
      WHERE org_id = ${orgId} AND id = ${connectionId}
      RETURNING next_poll_at`);
    return new Date((res.rows as Raw[])[0]!.next_poll_at as string);
  }

  /** Retention: delivery rows older than this many days go (the lead pipeline keeps the lead and its own raw event). */
  async trimEvents(tx: Tx, days: number): Promise<number> {
    const res = await tx.execute(sql`
      DELETE FROM marketplace_connection_events WHERE received_at < now() - (${days} || ' days')::interval RETURNING id`);
    return (res.rows as Raw[]).length;
  }
}
