import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { MailboxStatus } from '@crm/contracts';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const d = (v: unknown): Date | null =>
  v === null || v === undefined ? null : v instanceof Date ? v : new Date(v as string);

export interface MailboxRow {
  id: number;
  uuid: string;
  provider: 'google';
  address: string;
  accountSub: string | null;
  displayName: string;
  status: MailboxStatus;
  scope: 'shared' | 'personal';
  ownerUserId: number | null;
  /** Sealed with the credentials key: only the token service opens these. */
  refreshTokenEnc: string | null;
  accessTokenEnc: string | null;
  accessTokenExpiresAt: Date | null;
  scopes: string | null;
  historyId: string | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  connectedBy: number | null;
  connectedAt: Date | null;
  channelUuid: string | null;
  rowVersion: number;
}

function toRow(r: Raw): MailboxRow {
  return {
    id: Number(r.id),
    uuid: r.uuid as string,
    provider: r.provider as 'google',
    address: r.address as string,
    accountSub: s(r.account_sub),
    displayName: r.display_name as string,
    status: r.status as MailboxStatus,
    scope: r.scope as 'shared' | 'personal',
    ownerUserId: r.owner_user_id === null ? null : Number(r.owner_user_id),
    refreshTokenEnc: s(r.refresh_token_enc),
    accessTokenEnc: s(r.access_token_enc),
    accessTokenExpiresAt: d(r.access_token_expires_at),
    scopes: s(r.scopes),
    historyId: s(r.history_id),
    lastSyncedAt: d(r.last_synced_at),
    lastError: s(r.last_error),
    connectedBy: r.connected_by === null ? null : Number(r.connected_by),
    connectedAt: d(r.connected_at),
    channelUuid: s(r.channel_uuid),
    rowVersion: Number(r.row_version),
  };
}

export interface ConnectInput {
  address: string;
  accountSub: string | null;
  displayName: string;
  refreshTokenEnc: string;
  accessTokenEnc: string;
  accessTokenExpiresAt: Date;
  scopes: string;
  connectedBy: number | null;
}

const rows = (res: { rows: unknown[] }) => res.rows as Raw[];

/** The workspace's connected Gmail mailboxes (`mail_mailboxes`). Every method takes the transaction the caller already opened for the tenant. */
@Injectable()
export class MailboxesRepository {
  async list(tx: Tx, orgId: number): Promise<Array<MailboxRow & { conversationCount: number }>> {
    const res = await tx.execute(sql`
      SELECT m.*,
             (SELECT count(*) FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
               WHERE ch.org_id = m.org_id AND ch.uuid = m.channel_uuid)::int AS conversation_count
        FROM mail_mailboxes m
       WHERE m.org_id = ${orgId}
       ORDER BY m.created_at, m.id`);
    return rows(res).map((r) => ({ ...toRow(r), conversationCount: Number(r.conversation_count) }));
  }

  async byUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<MailboxRow | undefined> {
    const res = await tx.execute(sql`
      SELECT * FROM mail_mailboxes WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid ${forUpdate ? sql`FOR UPDATE` : sql``}`);
    const row = rows(res)[0];
    return row ? toRow(row) : undefined;
  }

  async byAddress(
    tx: Tx,
    orgId: number,
    address: string,
    forUpdate = false,
  ): Promise<MailboxRow | undefined> {
    const res = await tx.execute(sql`
      SELECT * FROM mail_mailboxes WHERE org_id = ${orgId} AND address = ${address}::citext ${forUpdate ? sql`FOR UPDATE` : sql``}`);
    const row = rows(res)[0];
    return row ? toRow(row) : undefined;
  }

  /** The mailbox an inbox channel belongs to (its channel's external id is the mailbox uuid). */
  async byChannelExternalId(
    tx: Tx,
    orgId: number,
    externalId: string,
  ): Promise<MailboxRow | undefined> {
    return this.byUuid(tx, orgId, externalId);
  }

  /** Mailboxes that count against the plan: everything but a disconnected one. */
  async countActive(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n FROM mail_mailboxes WHERE org_id = ${orgId} AND status <> 'disconnected'`);
    return Number(rows(res)[0]?.n ?? 0);
  }

  async insert(tx: Tx, orgId: number, c: ConnectInput): Promise<MailboxRow> {
    const res = await tx.execute(sql`
      INSERT INTO mail_mailboxes
        (org_id, address, account_sub, display_name, status, refresh_token_enc, access_token_enc, access_token_expires_at,
         scopes, connected_by, connected_at)
      VALUES (${orgId}, ${c.address}::citext, ${c.accountSub}, ${c.displayName}, 'connected', ${c.refreshTokenEnc}, ${c.accessTokenEnc},
              ${c.accessTokenExpiresAt.toISOString()}::timestamptz, ${c.scopes}, ${c.connectedBy}, now())
      RETURNING *`);
    return toRow(rows(res)[0]!);
  }

  /** A fresh consent for a mailbox that exists: new tokens, healthy again. The name and the sync cursor are kept. */
  async reconnect(tx: Tx, orgId: number, id: number, c: ConnectInput): Promise<MailboxRow> {
    const res = await tx.execute(sql`
      UPDATE mail_mailboxes
         SET account_sub = ${c.accountSub}, status = 'connected', last_error = NULL,
             refresh_token_enc = ${c.refreshTokenEnc}, access_token_enc = ${c.accessTokenEnc},
             access_token_expires_at = ${c.accessTokenExpiresAt.toISOString()}::timestamptz,
             scopes = ${c.scopes}, connected_by = ${c.connectedBy}, connected_at = now()
       WHERE org_id = ${orgId} AND id = ${id}
       RETURNING *`);
    return toRow(rows(res)[0]!);
  }

  /** Renames under the optimistic lock; undefined when the version moved. */
  async rename(
    tx: Tx,
    orgId: number,
    id: number,
    rowVersion: number,
    displayName: string,
  ): Promise<MailboxRow | undefined> {
    const res = await tx.execute(sql`
      UPDATE mail_mailboxes SET display_name = ${displayName}
       WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${rowVersion}
       RETURNING *`);
    const row = rows(res)[0];
    return row ? toRow(row) : undefined;
  }

  async setChannel(tx: Tx, orgId: number, id: number, channelUuid: string): Promise<void> {
    await tx.execute(sql`
      UPDATE mail_mailboxes SET channel_uuid = ${channelUuid}::uuid
       WHERE org_id = ${orgId} AND id = ${id} AND channel_uuid IS DISTINCT FROM ${channelUuid}::uuid`);
  }

  async saveAccessToken(
    tx: Tx,
    orgId: number,
    id: number,
    accessTokenEnc: string,
    expiresAt: Date,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE mail_mailboxes
         SET access_token_enc = ${accessTokenEnc}, access_token_expires_at = ${expiresAt.toISOString()}::timestamptz
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** True only for the call that made the change, so the audit row and the event are written once however many callers saw it. */
  async markNeedsReauth(tx: Tx, orgId: number, id: number, reason: string): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE mail_mailboxes
         SET status = 'needs_reauth', last_error = ${reason.slice(0, 300)}, access_token_enc = NULL, access_token_expires_at = NULL
       WHERE org_id = ${orgId} AND id = ${id} AND status IN ('connected', 'error')
       RETURNING id`);
    return rows(res).length > 0;
  }

  /** A sync finished: the new cursor and time, and the reason it failed (or null). A mailbox that was `error` and now works is `connected`. */
  async saveSync(
    tx: Tx,
    orgId: number,
    id: number,
    input: {
      historyId: string | null;
      syncedAt: Date | null;
      error: string | null;
      status?: 'connected' | 'error';
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE mail_mailboxes
         SET history_id = coalesce(${input.historyId}, history_id),
             last_synced_at = coalesce(${input.syncedAt ? input.syncedAt.toISOString() : null}::timestamptz, last_synced_at),
             last_error = ${input.error ? input.error.slice(0, 300) : null},
             status = CASE WHEN status IN ('connected', 'error') THEN ${input.status ?? 'connected'} ELSE status END
       WHERE org_id = ${orgId} AND id = ${id} AND status <> 'disconnected'`);
  }

  /** The mailbox is no longer connected: tokens are wiped, the row and its conversations stay so a reconnect reattaches. */
  async disconnect(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE mail_mailboxes
         SET status = 'disconnected', last_error = NULL, refresh_token_enc = NULL, access_token_enc = NULL, access_token_expires_at = NULL
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /**
   * Every mailbox worth syncing, in every workspace, for the sweeper (run privileged): the connected ones, and a failing one again only
   * after `errorBackoffMinutes` (its row is touched when the failure is recorded).
   */
  async dueEverywhere(
    tx: Tx,
    errorBackoffMinutes: number,
  ): Promise<Array<{ orgId: number; uuid: string }>> {
    const res = await tx.execute(sql`
      SELECT org_id, uuid FROM mail_mailboxes
       WHERE status = 'connected'
          OR (status = 'error' AND updated_at < now() - make_interval(mins => ${errorBackoffMinutes}))
       ORDER BY org_id, id`);
    return rows(res).map((r) => ({ orgId: Number(r.org_id), uuid: r.uuid as string }));
  }

  /** Whether this provider message id is already stored on the mailbox's channel (a redelivery: nothing to download again). */
  async messageStored(
    tx: Tx,
    orgId: number,
    channelUuid: string,
    providerMessageId: string,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM message_ledger l JOIN channels ch ON ch.org_id = l.org_id AND ch.id = l.channel_id
       WHERE l.org_id = ${orgId} AND ch.uuid = ${channelUuid}::uuid AND l.kind = 'provider_id' AND l.key = ${providerMessageId}
       LIMIT 1`);
    return rows(res).length > 0;
  }
}
