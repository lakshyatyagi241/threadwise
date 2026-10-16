import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const d = (v: unknown): Date | null =>
  v === null || v === undefined ? null : v instanceof Date ? v : new Date(v as string);

export interface MicrosoftConnectionRow {
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
  status: 'active' | 'needs_reconnect';
  statusReason: string | null;
  connectedAt: Date;
  lastErrorCode: string | null;
  lastErrorAt: Date | null;
  lastUsedAt: Date | null;
  rowVersion: number;
}

function toRow(r: Raw): MicrosoftConnectionRow {
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
    status: r.status as MicrosoftConnectionRow['status'],
    statusReason: s(r.status_reason),
    connectedAt: d(r.connected_at)!,
    lastErrorCode: s(r.last_error_code),
    lastErrorAt: d(r.last_error_at),
    lastUsedAt: d(r.last_used_at),
    rowVersion: Number(r.row_version),
  };
}

export interface MicrosoftConnectInput {
  connectedBy: number | null;
  accountEmail: string | null;
  accountSub: string | null;
  refreshTokenEnc: string;
  accessTokenEnc: string;
  accessTokenExpiresAt: Date;
  scopes: string;
}

/** The workspace's Outlook / Microsoft 365 grant (`appointment_microsoft_connections`): one row per workspace. */
@Injectable()
export class MicrosoftCalendarConnectionRepository {
  async find(
    tx: Tx,
    orgId: number,
    forUpdate = false,
  ): Promise<MicrosoftConnectionRow | undefined> {
    const res = await tx.execute(sql`
      SELECT * FROM appointment_microsoft_connections WHERE org_id = ${orgId} ${forUpdate ? sql`FOR UPDATE` : sql``}`);
    const row = (res.rows as Raw[])[0];
    return row ? toRow(row) : undefined;
  }

  /**
   * Stores a fresh consent. The same Microsoft account keeps the calendar the admin had chosen; another account starts on its default
   * calendar (the old account's calendar id means nothing to it).
   */
  async upsert(tx: Tx, orgId: number, c: MicrosoftConnectInput): Promise<MicrosoftConnectionRow> {
    const res = await tx.execute(sql`
      INSERT INTO appointment_microsoft_connections
        (org_id, connected_by, account_email, account_sub, refresh_token_enc, access_token_enc, access_token_expires_at, scopes)
      VALUES (${orgId}, ${c.connectedBy}, ${c.accountEmail}, ${c.accountSub}, ${c.refreshTokenEnc}, ${c.accessTokenEnc},
              ${c.accessTokenExpiresAt.toISOString()}::timestamptz, ${c.scopes})
      ON CONFLICT (org_id) DO UPDATE SET
        calendar_id = CASE WHEN appointment_microsoft_connections.account_sub IS NOT DISTINCT FROM EXCLUDED.account_sub
                           THEN appointment_microsoft_connections.calendar_id ELSE 'primary' END,
        calendar_name = CASE WHEN appointment_microsoft_connections.account_sub IS NOT DISTINCT FROM EXCLUDED.account_sub
                             THEN appointment_microsoft_connections.calendar_name ELSE NULL END,
        connected_by = EXCLUDED.connected_by, account_email = EXCLUDED.account_email, account_sub = EXCLUDED.account_sub,
        refresh_token_enc = EXCLUDED.refresh_token_enc, access_token_enc = EXCLUDED.access_token_enc,
        access_token_expires_at = EXCLUDED.access_token_expires_at, scopes = EXCLUDED.scopes,
        status = 'active', status_reason = NULL, status_at = now(), connected_at = now(),
        last_error_code = NULL, last_error_at = NULL
      RETURNING *`);
    return toRow((res.rows as Raw[])[0]!);
  }

  /**
   * Stores a refreshed access token and the rotated refresh token, but only onto the grant they were minted for: a refresh in flight while
   * an admin connected another account must not put the old account's tokens on the new account's row. Two refreshes with the same old
   * token both succeed at Microsoft; the first to write wins and the second changes nothing (its own tokens stay good for its call).
   */
  async saveTokens(
    tx: Tx,
    orgId: number,
    id: number,
    t: { accessTokenEnc: string; expiresAt: Date; refreshTokenEnc: string | null },
    forRefreshTokenEnc: string,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE appointment_microsoft_connections
         SET access_token_enc = ${t.accessTokenEnc}, access_token_expires_at = ${t.expiresAt.toISOString()}::timestamptz,
             refresh_token_enc = COALESCE(${t.refreshTokenEnc}::text, refresh_token_enc)
       WHERE org_id = ${orgId} AND id = ${id} AND refresh_token_enc = ${forRefreshTokenEnc}
       RETURNING id`);
    return (res.rows as Raw[]).length > 0;
  }

  /** True only for the call that made the change, so the event and the audit row are written once however many callers saw the failure. */
  async markNeedsReconnect(tx: Tx, orgId: number, id: number, reason: string): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE appointment_microsoft_connections
         SET status = 'needs_reconnect', status_reason = ${reason.slice(0, 200)}, status_at = now(),
             access_token_enc = NULL, access_token_expires_at = NULL
       WHERE org_id = ${orgId} AND id = ${id} AND status = 'active'
       RETURNING id`);
    return (res.rows as Raw[]).length > 0;
  }

  /** Stamps "used just now", at most once a minute per workspace however many calls there are. */
  async touchUsed(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE appointment_microsoft_connections SET last_used_at = now()
       WHERE org_id = ${orgId} AND id = ${id}
         AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`);
  }

  /** Records an account-level failure (`code`), or clears it (`code` null) after a success. Returns whether the row changed. */
  async setLastError(tx: Tx, orgId: number, id: number, code: string | null): Promise<boolean> {
    if (code === null) {
      const res = await tx.execute(sql`
        UPDATE appointment_microsoft_connections SET last_error_code = NULL, last_error_at = NULL
         WHERE org_id = ${orgId} AND id = ${id} AND last_error_code IS NOT NULL
         RETURNING id`);
      return (res.rows as Raw[]).length > 0;
    }
    const res = await tx.execute(sql`
      UPDATE appointment_microsoft_connections SET last_error_code = ${code}::text, last_error_at = now()
       WHERE org_id = ${orgId} AND id = ${id} AND last_error_code IS DISTINCT FROM ${code}::text
       RETURNING id`);
    return (res.rows as Raw[]).length > 0;
  }

  async setCalendar(
    tx: Tx,
    orgId: number,
    id: number,
    calendarId: string,
    calendarName: string | null,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE appointment_microsoft_connections SET calendar_id = ${calendarId}, calendar_name = ${calendarName}
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(
      sql`DELETE FROM appointment_microsoft_connections WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }
}
