import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const d = (v: unknown): Date | null =>
  v === null || v === undefined ? null : v instanceof Date ? v : new Date(v as string);

export type ConnectionStatus = 'active' | 'needs_reconnect';

export interface CalendarConnectionRow {
  id: number;
  uuid: string;
  connectedBy: number | null;
  accountEmail: string | null;
  accountSub: string | null;
  /** Sealed with the credentials key: only the token service opens these. */
  refreshTokenEnc: string;
  accessTokenEnc: string | null;
  accessTokenExpiresAt: Date | null;
  scopes: string | null;
  calendarId: string;
  calendarName: string | null;
  status: ConnectionStatus;
  statusReason: string | null;
  connectedAt: Date;
  lastErrorCode: string | null;
  lastErrorAt: Date | null;
  lastErrorCapability: string | null;
  lastUsedAt: Date | null;
  nextReconcileAt: Date | null;
  lastReconcileAt: Date | null;
  reconcileFailures: number;
  rowVersion: number;
}

function toRow(r: Raw): CalendarConnectionRow {
  return {
    id: Number(r.id),
    uuid: r.uuid as string,
    connectedBy: r.connected_by === null ? null : Number(r.connected_by),
    accountEmail: s(r.account_email),
    accountSub: s(r.account_sub),
    refreshTokenEnc: r.refresh_token_enc as string,
    accessTokenEnc: s(r.access_token_enc),
    accessTokenExpiresAt: d(r.access_token_expires_at),
    scopes: s(r.scopes),
    calendarId: r.calendar_id as string,
    calendarName: s(r.calendar_name),
    status: r.status as ConnectionStatus,
    statusReason: s(r.status_reason),
    connectedAt: d(r.connected_at)!,
    lastErrorCode: s(r.last_error_code),
    lastErrorAt: d(r.last_error_at),
    lastErrorCapability: s(r.last_error_capability),
    lastUsedAt: d(r.last_used_at),
    nextReconcileAt: d(r.next_reconcile_at),
    lastReconcileAt: d(r.last_reconcile_at),
    reconcileFailures: Number(r.reconcile_failures ?? 0),
    rowVersion: Number(r.row_version),
  };
}

export interface ConnectInput {
  connectedBy: number | null;
  accountEmail: string | null;
  accountSub: string | null;
  refreshTokenEnc: string;
  accessTokenEnc: string;
  accessTokenExpiresAt: Date;
  scopes: string;
}

/** The workspace's Google Calendar grant (`appointment_calendar_connections`): one row per workspace. */
@Injectable()
export class GoogleCalendarConnectionRepository {
  async find(tx: Tx, orgId: number, forUpdate = false): Promise<CalendarConnectionRow | undefined> {
    const res = await tx.execute(sql`
      SELECT * FROM appointment_calendar_connections WHERE org_id = ${orgId} ${forUpdate ? sql`FOR UPDATE` : sql``}`);
    const row = (res.rows as Raw[])[0];
    return row ? toRow(row) : undefined;
  }

  /**
   * Stores a fresh consent. The same Google account keeps the calendar the admin had chosen; another account starts on `primary` (the old
   * account's calendar id means nothing to it).
   */
  async upsert(tx: Tx, orgId: number, c: ConnectInput): Promise<CalendarConnectionRow> {
    const res = await tx.execute(sql`
      INSERT INTO appointment_calendar_connections
        (org_id, connected_by, account_email, account_sub, refresh_token_enc, access_token_enc, access_token_expires_at, scopes)
      VALUES (${orgId}, ${c.connectedBy}, ${c.accountEmail}, ${c.accountSub}, ${c.refreshTokenEnc}, ${c.accessTokenEnc},
              ${c.accessTokenExpiresAt.toISOString()}::timestamptz, ${c.scopes})
      ON CONFLICT (org_id) DO UPDATE SET
        calendar_id = CASE WHEN appointment_calendar_connections.account_sub IS NOT DISTINCT FROM EXCLUDED.account_sub
                           THEN appointment_calendar_connections.calendar_id ELSE 'primary' END,
        calendar_name = CASE WHEN appointment_calendar_connections.account_sub IS NOT DISTINCT FROM EXCLUDED.account_sub
                             THEN appointment_calendar_connections.calendar_name ELSE NULL END,
        connected_by = EXCLUDED.connected_by, account_email = EXCLUDED.account_email, account_sub = EXCLUDED.account_sub,
        refresh_token_enc = EXCLUDED.refresh_token_enc, access_token_enc = EXCLUDED.access_token_enc,
        access_token_expires_at = EXCLUDED.access_token_expires_at, scopes = EXCLUDED.scopes,
        status = 'active', status_reason = NULL, status_at = now(), connected_at = now(),
        last_error_code = NULL, last_error_at = NULL, last_error_capability = NULL
      RETURNING *`);
    return toRow((res.rows as Raw[])[0]!);
  }

  /**
   * Stores a refreshed access token, but only onto the grant it was minted for: a refresh in flight while an admin connected another
   * account must not put the old account's token on the new account's row.
   */
  async saveAccessToken(
    tx: Tx,
    orgId: number,
    id: number,
    accessTokenEnc: string,
    expiresAt: Date,
    forRefreshTokenEnc: string,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE appointment_calendar_connections
         SET access_token_enc = ${accessTokenEnc}, access_token_expires_at = ${expiresAt.toISOString()}::timestamptz
       WHERE org_id = ${orgId} AND id = ${id} AND refresh_token_enc = ${forRefreshTokenEnc}`);
  }

  /** Drops the cached access token (Google refused it): the next call refreshes. */
  async clearAccessToken(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE appointment_calendar_connections SET access_token_enc = NULL, access_token_expires_at = NULL
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** True only for the call that made the change, so the event and the audit row are written once however many callers saw the failure. */
  async markNeedsReconnect(tx: Tx, orgId: number, id: number, reason: string): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE appointment_calendar_connections
         SET status = 'needs_reconnect', status_reason = ${reason.slice(0, 200)}, status_at = now(),
             access_token_enc = NULL, access_token_expires_at = NULL
       WHERE org_id = ${orgId} AND id = ${id} AND status = 'active'
       RETURNING id`);
    return (res.rows as Raw[]).length > 0;
  }

  /** Stamps "used just now", at most once a minute per workspace however many calls there are. */
  async touchUsed(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE appointment_calendar_connections SET last_used_at = now()
       WHERE org_id = ${orgId} AND id = ${id}
         AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`);
  }

  /**
   * Records an account-level failure (`code` and the capability that met it), or clears it (`code` null) after a success OF THAT CAPABILITY:
   * a success of another one says nothing about it. Returns whether the row changed.
   */
  async setLastError(
    tx: Tx,
    orgId: number,
    id: number,
    code: string | null,
    capability: string | null,
  ): Promise<boolean> {
    if (code === null) {
      const res = await tx.execute(sql`
        UPDATE appointment_calendar_connections
           SET last_error_code = NULL, last_error_at = NULL, last_error_capability = NULL
         WHERE org_id = ${orgId} AND id = ${id} AND last_error_code IS NOT NULL
           AND (last_error_capability IS NULL OR last_error_capability = ${capability}::text)
         RETURNING id`);
      return (res.rows as Raw[]).length > 0;
    }
    const res = await tx.execute(sql`
      UPDATE appointment_calendar_connections
         SET last_error_code = ${code}::text, last_error_at = now(), last_error_capability = ${capability}::text
       WHERE org_id = ${orgId} AND id = ${id}
         AND (last_error_code IS DISTINCT FROM ${code}::text OR last_error_capability IS DISTINCT FROM ${capability}::text)
       RETURNING id`);
    return (res.rows as Raw[]).length > 0;
  }

  /** The reconcile job's schedule: when it is next due, how many passes in a row failed, and (when a pass ran) when. */
  async setReconcileSchedule(
    tx: Tx,
    orgId: number,
    id: number,
    s: { nextAt: Date; failures: number; ran: boolean },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE appointment_calendar_connections
         SET next_reconcile_at = ${s.nextAt.toISOString()}::timestamptz, reconcile_failures = ${s.failures},
             last_reconcile_at = CASE WHEN ${s.ran} THEN now() ELSE last_reconcile_at END
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /**
   * Workspaces whose reconcile is due (across all of them: the caller is the scheduler, privileged), oldest first. Claims them by pushing
   * `next_reconcile_at` a little way ahead in the same statement, so several workers asking at once get different workspaces.
   */
  async claimDueReconciles(tx: Tx, limit: number, claimMs: number): Promise<number[]> {
    const res = await tx.execute(sql`
      UPDATE appointment_calendar_connections c SET next_reconcile_at = now() + (${claimMs} || ' milliseconds')::interval
       WHERE (c.org_id, c.id) IN (
         SELECT org_id, id FROM appointment_calendar_connections
          WHERE status = 'active' AND (next_reconcile_at IS NULL OR next_reconcile_at <= now())
            AND scopes LIKE '%calendar.events%'
          ORDER BY next_reconcile_at ASC NULLS FIRST LIMIT ${limit} FOR UPDATE SKIP LOCKED)
       RETURNING c.org_id`);
    return (res.rows as Raw[]).map((r) => Number(r.org_id));
  }

  async setCalendar(
    tx: Tx,
    orgId: number,
    id: number,
    calendarId: string,
    calendarName: string | null,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE appointment_calendar_connections SET calendar_id = ${calendarId}, calendar_name = ${calendarName}
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(
      sql`DELETE FROM appointment_calendar_connections WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }
}
