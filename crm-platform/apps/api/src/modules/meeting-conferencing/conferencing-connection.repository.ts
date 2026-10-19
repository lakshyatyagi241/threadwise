import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { ConnectedVideoProvider } from '@crm/contracts';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const d = (v: unknown): Date | null =>
  v === null || v === undefined ? null : v instanceof Date ? v : new Date(v as string);

/** A list of values as `$1, $2`: drizzle spreads a JS array into a tuple, which `= ANY(...)` cannot take. */
const inList = (values: string[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

export type ConnectionState = 'active' | 'needs_reconnect';

export interface ConferencingConnectionRow {
  id: number;
  uuid: string;
  userId: number;
  provider: ConnectedVideoProvider;
  accountEmail: string | null;
  accountSub: string | null;
  /** Sealed with the credentials key: only the token service opens these. */
  refreshTokenEnc: string;
  accessTokenEnc: string | null;
  accessTokenExpiresAt: Date | null;
  scopes: string | null;
  status: ConnectionState;
  statusReason: string | null;
  connectedAt: Date;
  lastErrorCode: string | null;
  lastErrorAt: Date | null;
  lastUsedAt: Date | null;
  rowVersion: number;
}

function toRow(r: Raw): ConferencingConnectionRow {
  return {
    id: Number(r.id),
    uuid: r.uuid as string,
    userId: Number(r.user_id),
    provider: r.provider as ConnectedVideoProvider,
    accountEmail: s(r.account_email),
    accountSub: s(r.account_sub),
    refreshTokenEnc: r.refresh_token_enc as string,
    accessTokenEnc: s(r.access_token_enc),
    accessTokenExpiresAt: d(r.access_token_expires_at),
    scopes: s(r.scopes),
    status: r.status as ConnectionState,
    statusReason: s(r.status_reason),
    connectedAt: d(r.connected_at)!,
    lastErrorCode: s(r.last_error_code),
    lastErrorAt: d(r.last_error_at),
    lastUsedAt: d(r.last_used_at),
    rowVersion: Number(r.row_version),
  };
}

export interface ConnectInput {
  userId: number;
  provider: ConnectedVideoProvider;
  accountEmail: string | null;
  accountSub: string | null;
  refreshTokenEnc: string;
  accessTokenEnc: string;
  accessTokenExpiresAt: Date;
  scopes: string;
}

/** One person's grant to one provider (`conferencing_connections`). */
@Injectable()
export class ConferencingConnectionRepository {
  async find(
    tx: Tx,
    orgId: number,
    userId: number,
    provider: ConnectedVideoProvider,
    forUpdate = false,
  ): Promise<ConferencingConnectionRow | undefined> {
    const res = await tx.execute(sql`
      SELECT * FROM conferencing_connections
       WHERE org_id = ${orgId} AND user_id = ${userId} AND provider = ${provider} ${forUpdate ? sql`FOR UPDATE` : sql``}`);
    const row = (res.rows as Raw[])[0];
    return row ? toRow(row) : undefined;
  }

  /** Every provider a person has connected. */
  async listForUser(tx: Tx, orgId: number, userId: number): Promise<ConferencingConnectionRow[]> {
    const res = await tx.execute(sql`
      SELECT * FROM conferencing_connections WHERE org_id = ${orgId} AND user_id = ${userId} ORDER BY provider`);
    return (res.rows as Raw[]).map(toRow);
  }

  /** Stores a fresh consent: connecting again replaces the grant (and clears a `needs_reconnect`). */
  async upsert(tx: Tx, orgId: number, c: ConnectInput): Promise<ConferencingConnectionRow> {
    const res = await tx.execute(sql`
      INSERT INTO conferencing_connections
        (org_id, user_id, provider, account_email, account_sub, refresh_token_enc, access_token_enc, access_token_expires_at, scopes)
      VALUES (${orgId}, ${c.userId}, ${c.provider}, ${c.accountEmail}, ${c.accountSub}, ${c.refreshTokenEnc}, ${c.accessTokenEnc},
              ${c.accessTokenExpiresAt.toISOString()}::timestamptz, ${c.scopes})
      ON CONFLICT (org_id, user_id, provider) DO UPDATE SET
        account_email = EXCLUDED.account_email, account_sub = EXCLUDED.account_sub,
        refresh_token_enc = EXCLUDED.refresh_token_enc, access_token_enc = EXCLUDED.access_token_enc,
        access_token_expires_at = EXCLUDED.access_token_expires_at, scopes = EXCLUDED.scopes,
        status = 'active', status_reason = NULL, status_at = now(), connected_at = now(),
        last_error_code = NULL, last_error_at = NULL
      RETURNING *`);
    return toRow((res.rows as Raw[])[0]!);
  }

  /**
   * Stores a refreshed token pair, but only onto the grant it was minted for: a refresh in flight while the person connected another
   * account must not put the old account's token on the new account's row. Zoom and Microsoft rotate the refresh token, so a new one
   * replaces the old. Returns whether it was stored.
   */
  async saveTokens(
    tx: Tx,
    orgId: number,
    id: number,
    t: { accessTokenEnc: string; expiresAt: Date; refreshTokenEnc: string | null },
    forRefreshTokenEnc: string,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE conferencing_connections
         SET access_token_enc = ${t.accessTokenEnc}, access_token_expires_at = ${t.expiresAt.toISOString()}::timestamptz,
             refresh_token_enc = COALESCE(${t.refreshTokenEnc}, refresh_token_enc)
       WHERE org_id = ${orgId} AND id = ${id} AND refresh_token_enc = ${forRefreshTokenEnc}
       RETURNING id`);
    return (res.rows as Raw[]).length > 0;
  }

  /** Drops the cached access token (the provider refused it): the next call refreshes. */
  async clearAccessToken(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE conferencing_connections SET access_token_enc = NULL, access_token_expires_at = NULL
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** True only for the call that made the change, so the audit row and the event are written once however many callers saw the failure. */
  async markNeedsReconnect(tx: Tx, orgId: number, id: number, reason: string): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE conferencing_connections
         SET status = 'needs_reconnect', status_reason = ${reason.slice(0, 200)}, status_at = now(),
             access_token_enc = NULL, access_token_expires_at = NULL
       WHERE org_id = ${orgId} AND id = ${id} AND status = 'active'
       RETURNING id`);
    return (res.rows as Raw[]).length > 0;
  }

  /** Stamps "used just now", at most once a minute per connection. */
  async touchUsed(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE conferencing_connections SET last_used_at = now()
       WHERE org_id = ${orgId} AND id = ${id}
         AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`);
  }

  /** Records an account-level failure, or clears it (`code` null) after a success. Returns whether the row changed. */
  async setLastError(tx: Tx, orgId: number, id: number, code: string | null): Promise<boolean> {
    if (code === null) {
      const res = await tx.execute(sql`
        UPDATE conferencing_connections SET last_error_code = NULL, last_error_at = NULL
         WHERE org_id = ${orgId} AND id = ${id} AND last_error_code IS NOT NULL
         RETURNING id`);
      return (res.rows as Raw[]).length > 0;
    }
    const res = await tx.execute(sql`
      UPDATE conferencing_connections SET last_error_code = ${code}::text, last_error_at = now()
       WHERE org_id = ${orgId} AND id = ${id} AND last_error_code IS DISTINCT FROM ${code}::text
       RETURNING id`);
    return (res.rows as Raw[]).length > 0;
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(
      sql`DELETE FROM conferencing_connections WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  /** Which of the two apps the workspace has installed and running (the Marketplace listing is the gate for every video option). */
  async installedApps(tx: Tx, orgId: number, slugs: string[]): Promise<Set<string>> {
    const res = await tx.execute(sql`
      SELECT a.slug FROM workspace_app_installations i
        JOIN marketplace_apps a ON a.id = i.app_id
       WHERE i.org_id = ${orgId} AND i.status = 'active' AND a.slug IN (${inList(slugs)})`);
    return new Set((res.rows as Raw[]).map((r) => r.slug as string));
  }

  /** Whether the app listing exists and is published at all (so "install it" is something a person can do). */
  async publishedApps(tx: Tx, slugs: string[]): Promise<Set<string>> {
    const res = await tx.execute(sql`
      SELECT slug FROM marketplace_apps WHERE slug IN (${inList(slugs)}) AND status = 'published'`);
    return new Set((res.rows as Raw[]).map((r) => r.slug as string));
  }
}
