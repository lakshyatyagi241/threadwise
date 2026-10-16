/**
 * channel-email: the mailboxes a workspace connected (Gmail, Microsoft 365, IMAP/SMTP), the sharing policy of personal mailboxes, signatures
 * and staged outbound attachments. Mirrors migrations/20261118090000_mail_mailboxes.sql and 20261119090000_mail_phase2_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { chatChannels } from '../chat-conversations/channels';
import { conversations } from '../chat-conversations/tables';
import { contactActivities } from '../contact-detail';
import { citext, createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';

/** One mailbox (Gmail, Microsoft 365 or IMAP/SMTP) connected to the team inbox. Tokens and passwords are sealed with the credentials key. */
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
    /** Sealed JSON (credentials key): IMAP/SMTP settings and password, or an OAuth provider's extras. */
    connectionEnc: text('connection_enc'),
    /** Non-secret summary the hub shows (host, port, security, user name). */
    connectionPublic: jsonb('connection_public').$type<Record<string, unknown>>(),
    /** Provider-defined sync position (Gmail {historyId}, IMAP {uidValidity,lastUid}, Graph {deltaLink}); null until the first sync. */
    syncCursor: jsonb('sync_cursor').$type<Record<string, unknown>>(),
    /** A Gmail watch or Graph subscription ({kind, id, expiresAt, ...}); null = polling only. */
    pushState: jsonb('push_state').$type<Record<string, unknown>>(),
    /** Per-mailbox send cap per hour; null = the platform default. */
    sendLimitPerHour: integer('send_limit_per_hour'),
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
    check('chk_mail_mailboxes_provider', sql`${t.provider} in ('google', 'microsoft', 'imap')`),
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
    check(
      'chk_mail_mailboxes_connection_sealed',
      sql`${t.connectionEnc} is null or ${t.connectionEnc} ~ '^v[0-9]+:'`,
    ),
    check(
      'chk_mail_mailboxes_send_limit',
      sql`${t.sendLimitPerHour} is null or (${t.sendLimitPerHour} between 1 and 10000)`,
    ),
    check(
      'chk_mail_mailboxes_personal_owner',
      sql`${t.scope} = 'shared' or ${t.ownerUserId} is not null`,
    ),
    foreignKey({
      name: 'fk_mail_mailboxes_owner',
      columns: [t.orgId, t.ownerUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
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
    index('idx_mail_mailboxes_personal')
      .on(t.orgId, t.ownerUserId)
      .where(sql`${t.scope} = 'personal'`),
    index('idx_mail_mailboxes_push')
      .on(t.provider)
      .where(sql`${t.pushState} is not null`),
    index('idx_mail_mailboxes_connected')
      .on(t.status)
      .where(sql`${t.status} = 'connected'`),
  ],
);

export type MailMailboxesRow = typeof mailMailboxes.$inferSelect;
export type NewMailMailboxesRow = typeof mailMailboxes.$inferInsert;

/** The workspace's sharing policy for personal mailboxes: one row per workspace, created on the first write (defaults apply until then). */
export const mailWorkspaceSettings = pgTable(
  'mail_workspace_settings',
  {
    orgId: orgIdColumn().primaryKey(),
    personalMailboxesEnabled: boolean('personal_mailboxes_enabled').notNull().default(false),
    /** 'admins' | 'agents': who may connect their own personal mailbox once the workspace allows it. */
    whoMayConnectPersonal: text('who_may_connect_personal').notNull().default('admins'),
    adminsCanReadPersonal: boolean('admins_can_read_personal').notNull().default(false),
    updatedBy: idColumn('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    foreignKey({
      name: 'mail_workspace_settings_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check(
      'chk_mail_workspace_settings_who',
      sql`${t.whoMayConnectPersonal} in ('admins', 'agents')`,
    ),
    foreignKey({
      name: 'fk_mail_workspace_settings_updated_by',
      columns: [t.orgId, t.updatedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
  ],
);

/** An email signature: the shared one of a mailbox (scope 'mailbox') or an agent's own (scope 'user'). */
export const mailSignatures = pgTable(
  'mail_signatures',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    scope: text('scope').notNull(),
    mailboxId: idColumn('mailbox_id'),
    userId: idColumn('user_id'),
    name: text('name').notNull(),
    bodyHtml: text('body_html').notNull().default(''),
    bodyText: text('body_text').notNull().default(''),
    isDefault: boolean('is_default').notNull().default(false),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('mail_signatures_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'mail_signatures_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check('chk_mail_signatures_scope', sql`${t.scope} in ('mailbox', 'user')`),
    check(
      'chk_mail_signatures_owner',
      sql`(${t.scope} = 'mailbox' and ${t.mailboxId} is not null and ${t.userId} is null) or (${t.scope} = 'user' and ${t.userId} is not null and ${t.mailboxId} is null)`,
    ),
    check('chk_mail_signatures_name', sql`btrim(${t.name}) <> '' and char_length(${t.name}) <= 80`),
    check(
      'chk_mail_signatures_size',
      sql`char_length(${t.bodyHtml}) <= 20000 and char_length(${t.bodyText}) <= 5000`,
    ),
    foreignKey({
      name: 'fk_mail_signatures_mailbox',
      columns: [t.orgId, t.mailboxId],
      foreignColumns: [mailMailboxes.orgId, mailMailboxes.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_mail_signatures_user',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_mail_signatures_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_mail_signatures_mailbox')
      .on(t.orgId, t.mailboxId)
      .where(sql`${t.mailboxId} is not null`),
    index('idx_mail_signatures_user')
      .on(t.orgId, t.userId)
      .where(sql`${t.userId} is not null`),
    uniqueIndex('uq_mail_signatures_default_mailbox')
      .on(t.orgId, t.mailboxId)
      .where(sql`${t.isDefault} and ${t.scope} = 'mailbox'`),
    uniqueIndex('uq_mail_signatures_default_user')
      .on(t.orgId, t.userId)
      .where(sql`${t.isDefault} and ${t.scope} = 'user'`),
  ],
);

/** A file uploaded in the composer, staged in the object store until the reply is sent or it expires. */
export const mailOutboundAttachments = pgTable(
  'mail_outbound_attachments',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    uploadedBy: idColumn('uploaded_by'),
    conversationId: idColumn('conversation_id'),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    objectKey: text('object_key').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('mail_outbound_attachments_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'mail_outbound_attachments_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check('chk_mail_outbound_attachments_size', sql`${t.size} > 0`),
    check(
      'chk_mail_outbound_attachments_name',
      sql`btrim(${t.name}) <> '' and char_length(${t.name}) <= 255`,
    ),
    foreignKey({
      name: 'fk_mail_outbound_attachments_uploaded_by',
      columns: [t.orgId, t.uploadedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_mail_outbound_attachments_conversation',
      columns: [t.orgId, t.conversationId],
      foreignColumns: [conversations.orgId, conversations.id],
    }).onDelete('cascade'),
    index('idx_mail_outbound_attachments_uploader').on(t.orgId, t.uploadedBy),
    index('idx_mail_outbound_attachments_conversation')
      .on(t.orgId, t.conversationId)
      .where(sql`${t.conversationId} is not null`),
    index('idx_mail_outbound_attachments_expiry')
      .on(t.expiresAt)
      .where(sql`${t.usedAt} is null`),
  ],
);

/**
 * The Email channel's ledger of the mail it already wrote onto a contact's timeline (E-19): `dedupeKey` is `<mailbox uuid>:in:<provider
 * message id>` or `<mailbox uuid>:out:<Message-ID>`. Mirrors migrations/20261222090000_mail_timeline_entries.sql.
 */
export const mailTimelineEntries = pgTable(
  'mail_timeline_entries',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    dedupeKey: text('dedupe_key').notNull(),
    activityId: idColumn('activity_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('mail_timeline_entries_org_id_dedupe_key_key').on(t.orgId, t.dedupeKey),
    foreignKey({
      name: 'mail_timeline_entries_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check(
      'chk_mail_timeline_entries_key',
      sql`char_length(${t.dedupeKey}) between 1 and 500`,
    ),
    foreignKey({
      name: 'fk_mail_timeline_entries_activity',
      columns: [t.orgId, t.activityId],
      foreignColumns: [contactActivities.orgId, contactActivities.id],
    }).onDelete('cascade'),
    index('idx_mail_timeline_entries_activity').on(t.orgId, t.activityId),
  ],
);

/**
 * A reusable email an agent inserts into the composer of an email conversation: a subject, a rich-text body and `{{variables}}`.
 * Shared (`userId` null: the workspace's) or personal (its owner's alone). Mirrors migrations/20261202090000_mail_email_templates.sql.
 */
export const emailTemplates = pgTable(
  'email_templates',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    name: text('name').notNull(),
    subject: text('subject').notNull().default(''),
    bodyHtml: text('body_html').notNull(),
    bodyText: text('body_text').notNull().default(''),
    category: text('category'),
    purpose: text('purpose').notNull().default('general'),
    status: text('status').notNull().default('active'),
    usedCount: integer('used_count').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('email_templates_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'email_templates_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check('chk_email_templates_name', sql`char_length(btrim(${t.name})) between 1 and 120`),
    check(
      'chk_email_templates_subject',
      sql`char_length(${t.subject}) <= 300 and ${t.subject} !~ '[\\r\\n]'`,
    ),
    check(
      'chk_email_templates_body',
      sql`char_length(btrim(${t.bodyHtml})) >= 1 and char_length(${t.bodyHtml}) <= 100000 and char_length(${t.bodyText}) <= 30000`,
    ),
    check(
      'chk_email_templates_category',
      sql`${t.category} is null or char_length(${t.category}) between 1 and 64`,
    ),
    check('chk_email_templates_purpose', sql`${t.purpose} in ('general', 'marketing')`),
    check('chk_email_templates_status', sql`${t.status} in ('active', 'archived')`),
    check('chk_email_templates_used', sql`${t.usedCount} >= 0`),
    foreignKey({
      name: 'fk_email_templates_user',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_email_templates_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    // uq_email_templates_shared_name and uq_email_templates_user_name (a name is unique per owner, ignoring case) are expression
    // indexes on lower(name): they live in the migration only, which the verifier cannot compare column by column.
    index('idx_email_templates_list').on(t.orgId, t.createdAt.desc(), t.id.desc()),
    index('idx_email_templates_user')
      .on(t.orgId, t.userId)
      .where(sql`${t.userId} is not null`),
  ],
);

export type MailWorkspaceSettingsRow = typeof mailWorkspaceSettings.$inferSelect;
export type NewMailWorkspaceSettingsRow = typeof mailWorkspaceSettings.$inferInsert;
export type MailSignaturesRow = typeof mailSignatures.$inferSelect;
export type NewMailSignaturesRow = typeof mailSignatures.$inferInsert;
export type EmailTemplatesRow = typeof emailTemplates.$inferSelect;
export type NewEmailTemplatesRow = typeof emailTemplates.$inferInsert;
export type MailOutboundAttachmentsRow = typeof mailOutboundAttachments.$inferSelect;
export type NewMailOutboundAttachmentsRow = typeof mailOutboundAttachments.$inferInsert;
