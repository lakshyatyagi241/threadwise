import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { MailProvider, MailScope, MailWorkspaceSettings, MailboxStatus } from '@crm/contracts';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const d = (v: unknown): Date | null =>
  v === null || v === undefined ? null : v instanceof Date ? v : new Date(v as string);

export interface MailboxRow {
  id: number;
  uuid: string;
  provider: MailProvider;
  address: string;
  accountSub: string | null;
  displayName: string;
  status: MailboxStatus;
  scope: MailScope;
  ownerUserId: number | null;
  /** Sealed with the credentials key: only the token service opens these. */
  refreshTokenEnc: string | null;
  accessTokenEnc: string | null;
  accessTokenExpiresAt: Date | null;
  scopes: string | null;
  /** Sealed JSON (credentials key): IMAP/SMTP settings and password, or an OAuth provider's extras. Only the token service opens it. */
  connectionEnc: string | null;
  /** The non-secret summary of the connection (host, port, security, user name). */
  connectionPublic: Record<string, unknown> | null;
  /** Provider-defined sync position; null until the first sync. */
  syncCursor: Record<string, unknown> | null;
  /** A Gmail watch / Graph subscription; null = polling only. */
  pushState: Record<string, unknown> | null;
  sendLimitPerHour: number | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  connectedBy: number | null;
  connectedAt: Date | null;
  channelUuid: string | null;
  rowVersion: number;
}

const j = (v: unknown): Record<string, unknown> | null =>
  v === null || v === undefined
    ? null
    : typeof v === 'string'
      ? (JSON.parse(v) as Record<string, unknown>)
      : (v as Record<string, unknown>);

/** A mailbox row as the hub lists it: the row, who owns it (a personal one), whether it has a signature, and how many conversations it fed. */
export interface MailboxListRow extends MailboxRow {
  ownerUuid: string | null;
  ownerName: string | null;
  hasSignature: boolean;
  conversationCount: number;
}

function toRow(r: Raw): MailboxRow {
  return {
    id: Number(r.id),
    uuid: r.uuid as string,
    provider: r.provider as MailProvider,
    address: r.address as string,
    accountSub: s(r.account_sub),
    displayName: r.display_name as string,
    status: r.status as MailboxStatus,
    scope: r.scope as MailScope,
    ownerUserId: r.owner_user_id === null ? null : Number(r.owner_user_id),
    refreshTokenEnc: s(r.refresh_token_enc),
    accessTokenEnc: s(r.access_token_enc),
    accessTokenExpiresAt: d(r.access_token_expires_at),
    scopes: s(r.scopes),
    connectionEnc: s(r.connection_enc),
    connectionPublic: j(r.connection_public),
    syncCursor: j(r.sync_cursor),
    pushState: j(r.push_state),
    sendLimitPerHour: r.send_limit_per_hour === null ? null : Number(r.send_limit_per_hour),
    lastSyncedAt: d(r.last_synced_at),
    lastError: s(r.last_error),
    connectedBy: r.connected_by === null ? null : Number(r.connected_by),
    connectedAt: d(r.connected_at),
    channelUuid: s(r.channel_uuid),
    rowVersion: Number(r.row_version),
  };
}

export interface ConnectInput {
  provider: MailProvider;
  scope: MailScope;
  /** The owner of a personal mailbox; null on a shared one. */
  ownerUserId: number | null;
  address: string;
  accountSub: string | null;
  displayName: string;
  /** OAuth providers: the sealed refresh token and cached access token. Null for a password provider. */
  refreshTokenEnc: string | null;
  accessTokenEnc: string | null;
  accessTokenExpiresAt: Date | null;
  scopes: string | null;
  /** The sealed connection (IMAP/SMTP settings and password; or OAuth extras) and its public summary. */
  connectionEnc: string | null;
  connectionPublic: Record<string, unknown> | null;
  connectedBy: number | null;
}

const rows = (res: { rows: unknown[] }) => res.rows as Raw[];

/** The workspace's connected Gmail mailboxes (`mail_mailboxes`). Every method takes the transaction the caller already opened for the tenant. */
@Injectable()
export class MailboxesRepository {
  async list(tx: Tx, orgId: number): Promise<MailboxListRow[]> {
    const res = await tx.execute(sql`
      SELECT m.*, u.uuid AS owner_uuid, u.full_name AS owner_name,
             EXISTS (SELECT 1 FROM mail_signatures sg WHERE sg.org_id = m.org_id AND sg.mailbox_id = m.id) AS has_signature,
             (SELECT count(*) FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
               WHERE ch.org_id = m.org_id AND ch.uuid = m.channel_uuid)::int AS conversation_count
        FROM mail_mailboxes m
        LEFT JOIN users u ON u.org_id = m.org_id AND u.id = m.owner_user_id
       WHERE m.org_id = ${orgId}
       ORDER BY m.created_at, m.id`);
    return rows(res).map((r) => ({
      ...toRow(r),
      ownerUuid: s(r.owner_uuid),
      ownerName: s(r.owner_name),
      hasSignature: r.has_signature === true,
      conversationCount: Number(r.conversation_count),
    }));
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

  /** The workspace's personal-mailbox policy, or undefined while it never saved one (the contract's defaults apply). */
  async workspaceSettings(tx: Tx, orgId: number): Promise<MailWorkspaceSettings | undefined> {
    const res = await tx.execute(sql`
      SELECT personal_mailboxes_enabled, who_may_connect_personal, admins_can_read_personal, row_version
        FROM mail_workspace_settings WHERE org_id = ${orgId}`);
    const r = rows(res)[0];
    if (!r) return undefined;
    return {
      personalMailboxesEnabled: r.personal_mailboxes_enabled === true,
      whoMayConnectPersonal:
        r.who_may_connect_personal as MailWorkspaceSettings['whoMayConnectPersonal'],
      adminsCanReadPersonal: r.admins_can_read_personal === true,
      rowVersion: Number(r.row_version),
    };
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
        (org_id, provider, scope, owner_user_id, address, account_sub, display_name, status, refresh_token_enc, access_token_enc,
         access_token_expires_at, scopes, connection_enc, connection_public, connected_by, connected_at)
      VALUES (${orgId}, ${c.provider}, ${c.scope}, ${c.ownerUserId}, ${c.address}::citext, ${c.accountSub}, ${c.displayName}, 'connected',
              ${c.refreshTokenEnc}, ${c.accessTokenEnc}, ${c.accessTokenExpiresAt ? c.accessTokenExpiresAt.toISOString() : null}::timestamptz,
              ${c.scopes}, ${c.connectionEnc}, ${c.connectionPublic ? JSON.stringify(c.connectionPublic) : null}::jsonb, ${c.connectedBy}, now())
      RETURNING *`);
    return toRow(rows(res)[0]!);
  }

  /** A fresh consent for a mailbox that exists: new tokens, healthy again. The name and the sync cursor are kept. */
  async reconnect(tx: Tx, orgId: number, id: number, c: ConnectInput): Promise<MailboxRow> {
    const res = await tx.execute(sql`
      UPDATE mail_mailboxes
         SET provider = ${c.provider}, scope = ${c.scope}, owner_user_id = ${c.ownerUserId},
             sync_cursor = CASE WHEN provider = ${c.provider} THEN sync_cursor ELSE NULL END,
             account_sub = ${c.accountSub}, status = 'connected', last_error = NULL,
             refresh_token_enc = ${c.refreshTokenEnc}, access_token_enc = ${c.accessTokenEnc},
             access_token_expires_at = ${c.accessTokenExpiresAt ? c.accessTokenExpiresAt.toISOString() : null}::timestamptz,
             scopes = ${c.scopes}, connection_enc = ${c.connectionEnc},
             connection_public = ${c.connectionPublic ? JSON.stringify(c.connectionPublic) : null}::jsonb,
             connected_by = ${c.connectedBy}, connected_at = now()
       WHERE org_id = ${orgId} AND id = ${id}
       RETURNING *`);
    return toRow(rows(res)[0]!);
  }

  /** Renames (and, when `sendLimit` is given, sets the hourly cap, null = platform default) under the optimistic lock; undefined when the version moved. */
  async rename(
    tx: Tx,
    orgId: number,
    id: number,
    rowVersion: number,
    displayName: string,
    sendLimit?: number | null,
  ): Promise<MailboxRow | undefined> {
    const res = await tx.execute(sql`
      UPDATE mail_mailboxes SET display_name = ${displayName}
             ${sendLimit === undefined ? sql`` : sql`, send_limit_per_hour = ${sendLimit}`}
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
    /** A rotated refresh token (Microsoft) replaces the stored one; null keeps it. */
    refreshTokenEnc: string | null = null,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE mail_mailboxes
         SET access_token_enc = ${accessTokenEnc}, access_token_expires_at = ${expiresAt.toISOString()}::timestamptz,
             refresh_token_enc = COALESCE(${refreshTokenEnc}, refresh_token_enc)
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
      /** The new sync position; null leaves the stored one alone. */
      cursor: Record<string, unknown> | null;
      syncedAt: Date | null;
      error: string | null;
      status?: 'connected' | 'error';
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE mail_mailboxes
         SET sync_cursor = coalesce(${input.cursor ? JSON.stringify(input.cursor) : null}::jsonb, sync_cursor),
             last_synced_at = coalesce(${input.syncedAt ? input.syncedAt.toISOString() : null}::timestamptz, last_synced_at),
             last_error = ${input.error ? input.error.slice(0, 300) : null},
             status = CASE WHEN status IN ('connected', 'error') THEN ${input.status ?? 'connected'} ELSE status END
       WHERE org_id = ${orgId} AND id = ${id} AND status <> 'disconnected'`);
  }

  /** Writes (or, with null, clears) the push registration of a mailbox (a Gmail watch, a Graph subscription). */
  async savePushState(
    tx: Tx,
    orgId: number,
    id: number,
    state: Record<string, unknown> | null,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE mail_mailboxes SET push_state = ${state ? JSON.stringify(state) : null}::jsonb
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** The mailbox is no longer connected: tokens, credentials and push are wiped, the row and its conversations stay so a reconnect reattaches. */
  async disconnect(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE mail_mailboxes
         SET status = 'disconnected', last_error = NULL, refresh_token_enc = NULL, access_token_enc = NULL, access_token_expires_at = NULL,
             connection_enc = NULL, push_state = NULL
       WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /**
   * Every mailbox worth syncing, in every workspace, for the sweeper (run privileged): the connected ones, and a failing one again only
   * after `errorBackoffMinutes` (its row is touched when the failure is recorded).
   */
  async dueEverywhere(
    tx: Tx,
    errorBackoffMinutes: number,
  ): Promise<Array<{ orgId: number; uuid: string; provider: MailProvider }>> {
    const res = await tx.execute(sql`
      SELECT org_id, uuid, provider FROM mail_mailboxes
       WHERE status = 'connected'
          OR (status = 'error' AND updated_at < now() - make_interval(mins => ${errorBackoffMinutes}))
       ORDER BY org_id, id`);
    return rows(res).map((r) => ({
      orgId: Number(r.org_id),
      uuid: r.uuid as string,
      provider: r.provider as MailProvider,
    }));
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

  /**
   * The thread key already stored for each of these RFC 5322 Message-IDs (without brackets, any case) on the mailbox's channel, looking
   * back 90 days. Only for header-based thread resolution when a reply names its parent but no `References`: a rare path, so it is a plain
   * query with no index of its own. At most 50 ids.
   */
  async threadKeysOf(
    tx: Tx,
    orgId: number,
    channelUuid: string,
    messageIds: string[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(messageIds.map((i) => i.replace(/^<|>$/g, '').toLowerCase()))].slice(
      0,
      50,
    );
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    const res = await tx.execute(sql`
      SELECT DISTINCT lower(m.meta->'email'->>'messageId') AS message_id, m.meta->'email'->>'threadId' AS thread_id
        FROM messages m
        JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
        JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
       WHERE m.org_id = ${orgId} AND ch.uuid = ${channelUuid}::uuid
         AND m.created_at > now() - interval '90 days'
         AND lower(m.meta->'email'->>'messageId') IN (${sql.join(
           ids.map((i) => sql`${i}`),
           sql`, `,
         )})`);
    for (const r of rows(res)) {
      if (r.message_id && r.thread_id) out.set(r.message_id as string, r.thread_id as string);
    }
    return out;
  }
}
