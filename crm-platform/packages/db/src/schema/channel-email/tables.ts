/**
 * channel-email: the Gmail mailboxes a workspace connected. Mirrors migrations/20261118090000_mail_mailboxes.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { chatChannels } from '../chat-conversations/channels';
import { citext, createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';

/** One Google (Gmail / Workspace) account connected to the team inbox. Tokens are sealed with the credentials key. */
export const mailMailboxes = pgTable(
  'mail_mailboxes',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    provider: text('provider').notNull().default('google'),
    address: citext('address').notNull(),
    accountSub: text('account_sub'),
    displayName: text('display_name').notNull(),
    status: text('status').notNull().default('connected'),
    scope: text('scope').notNull().default('shared'),
    ownerUserId: idColumn('owner_user_id'),
    /** AES-GCM ciphertext (credentials key); null after a disconnect. */
    refreshTokenEnc: text('refresh_token_enc'),
    accessTokenEnc: text('access_token_enc'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    scopes: text('scopes'),
    /** Gmail's mailbox history cursor; null until the first sync. */
    historyId: text('history_id'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastError: text('last_error'),
    connectedBy: idColumn('connected_by'),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    channelUuid: uuid('channel_uuid'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('mail_mailboxes_org_id_uuid_key').on(t.orgId, t.uuid),
    unique('uq_mail_mailboxes_address').on(t.orgId, t.address),
    foreignKey({
      name: 'mail_mailboxes_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check('chk_mail_mailboxes_provider', sql`${t.provider} in ('google')`),
    check(
      'chk_mail_mailboxes_status',
      sql`${t.status} in ('connected', 'needs_reauth', 'error', 'disconnected')`,
    ),
    check('chk_mail_mailboxes_scope', sql`${t.scope} in ('shared', 'personal')`),
    check(
      'chk_mail_mailboxes_name',
      sql`btrim(${t.displayName}) <> '' and char_length(${t.displayName}) <= 80`,
    ),
    check(
      'chk_mail_mailboxes_tokens_sealed',
      sql`${t.refreshTokenEnc} is null or ${t.refreshTokenEnc} ~ '^v[0-9]+:'`,
    ),
    foreignKey({
      name: 'fk_mail_mailboxes_owner',
      columns: [t.orgId, t.ownerUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_mail_mailboxes_connected_by',
      columns: [t.orgId, t.connectedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_mail_mailboxes_channel',
      columns: [t.orgId, t.channelUuid],
      foreignColumns: [chatChannels.orgId, chatChannels.uuid],
    }).onDelete('set null'),
    index('idx_mail_mailboxes_owner').on(t.orgId, t.ownerUserId),
    index('idx_mail_mailboxes_connected_by').on(t.orgId, t.connectedBy),
    index('idx_mail_mailboxes_channel').on(t.orgId, t.channelUuid),
    index('idx_mail_mailboxes_connected')
      .on(t.status)
      .where(sql`${t.status} = 'connected'`),
  ],
);

export type MailMailboxesRow = typeof mailMailboxes.$inferSelect;
export type NewMailMailboxesRow = typeof mailMailboxes.$inferInsert;
