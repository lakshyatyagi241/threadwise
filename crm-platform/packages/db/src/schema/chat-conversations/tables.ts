/**
 * chat-conversations: tables ported from Reference and reshaped for the inbox. Mirrors migrations/20261001103600_chat_threadwise_schema.sql
 * plus the reshape migrations 20261014100000 (conversations), 20261014100100 (messages fold), 20261014100200 (ledger, events) and
 * 20261014100500 (channel foreign keys). The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the
 * database disagree.
 */
import {
  bigint,
  boolean,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { aiAgents } from '../ai-agents-training/tables';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { contacts } from '../crm';
import { organizations, teams, users } from '../foundation';
import { slaPolicies } from '../team-inbox-routing-sla/tables';
import { chatChannels } from './channels';

/** `conversations.status`: one lifecycle. `closed` is Reference's separate "closed" state, kept so no reachable state is lost. */
export const CONVERSATION_STATUSES = [
  'open',
  'pending',
  'snoozed',
  'resolved',
  'closed',
  'spam',
] as const;

export const conversations = pgTable(
  'conversations',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    channelId: idColumn('channel_id').notNull(),
    /** The peer on that channel (normalised digits, or the channel's own thread id). One thread per (channel, peer). */
    peerKey: text('peer_key').notNull(),
    peerName: text('peer_name'),
    contactId: idColumn('contact_id'),
    title: text('title').notNull(),
    preview: text('preview'),
    status: text('status')
      .$type<(typeof CONVERSATION_STATUSES)[number]>()
      .notNull()
      .default('open'),
    customerLanguage: text('customer_language'),
    archived: boolean('archived').notNull().default(false),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    mutedAt: timestamp('muted_at', { withTimezone: true }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    /** Highest `messages.seq` handed out; allocated under the conversation row lock. */
    msgSeq: idColumn('msg_seq').notNull().default(0),
    lastMessageId: idColumn('last_message_id'),
    /** Free-form replies are allowed until this instant; NULL when the channel has no window rule. */
    windowExpiresAt: timestamp('window_expires_at', { withTimezone: true }),
    /** Start of the current wait for a human answer (SLA anchor). */
    waitingSince: timestamp('waiting_since', { withTimezone: true }),
    needsContact: boolean('needs_contact').notNull().default(false),
    /** Set once when an imported history message created the thread (20261204090100); the inbox shows an "Imported" marker. */
    importedAt: timestamp('imported_at', { withTimezone: true }),
    priority: text('priority').notNull().default('normal'),
    assigneeUserId: idColumn('assignee_user_id'),
    assigneeTeamId: idColumn('assignee_team_id'),
    assigneeAgentId: idColumn('assignee_agent_id'),
    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: idColumn('resolved_by'),
    resolvedByAgentId: idColumn('resolved_by_agent_id'),
    slaPolicyId: idColumn('sla_policy_id'),
    slaFirstResponseDue: timestamp('sla_first_response_due', { withTimezone: true }),
    slaResolutionDue: timestamp('sla_resolution_due', { withTimezone: true }),
    slaBreached: boolean('sla_breached').notNull().default(false),
    routingMeta: jsonb('routing_meta'),
    escalationDueAt: timestamp('escalation_due_at', { withTimezone: true }),
    escalationAction: jsonb('escalation_action'),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    lastOutboundAt: timestamp('last_outbound_at', { withTimezone: true }),
    unreadCount: integer('unread_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_conversations_org_id_uuid').on(t.orgId, t.uuid),
    unique('uq_conversations_channel_peer').on(t.orgId, t.channelId, t.peerKey),
    foreignKey({
      name: 'fk_conversations_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_conversations_channel_id',
      columns: [t.orgId, t.channelId],
      foreignColumns: [chatChannels.orgId, chatChannels.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'fk_conversations_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_conversations_assignee_user_id',
      columns: [t.orgId, t.assigneeUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_conversations_assignee_team_id',
      columns: [t.orgId, t.assigneeTeamId],
      foreignColumns: [teams.orgId, teams.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_conversations_assignee_agent_id',
      columns: [t.orgId, t.assigneeAgentId],
      foreignColumns: [aiAgents.orgId, aiAgents.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_conversations_resolved_by',
      columns: [t.orgId, t.resolvedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_conversations_resolved_by_agent_id',
      columns: [t.orgId, t.resolvedByAgentId],
      foreignColumns: [aiAgents.orgId, aiAgents.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_conversations_sla_policy_id',
      columns: [t.orgId, t.slaPolicyId],
      foreignColumns: [slaPolicies.orgId, slaPolicies.id],
    }).onDelete('set null'),
    index('idx_conversations_title_trgm').using('gin', sql`${t.title} gin_trgm_ops`),
    index('idx_conversations_peer_name_trgm').using('gin', sql`${t.peerName} gin_trgm_ops`),
    index('idx_conversations_peer_key_trgm').using('gin', sql`${t.peerKey} gin_trgm_ops`),
    index('idx_conversations_preview_trgm').using('gin', sql`${t.preview} gin_trgm_ops`),
    index('idx_conversations_assignee_agent_id').on(t.orgId, t.assigneeAgentId),
    index('idx_conversations_contact_id').on(t.orgId, t.contactId),
    index('idx_conversations_queue').on(
      t.orgId,
      t.status,
      t.archived,
      t.pinnedAt.desc().nullsLast(),
      t.lastMessageAt.desc(),
      t.id.desc(),
    ),
    index('idx_conversations_assignee_user').on(t.orgId, t.assigneeUserId, t.status),
    index('idx_conversations_assignee_team').on(t.orgId, t.assigneeTeamId, t.status),
    index('idx_conversations_unread')
      .on(t.orgId, t.lastMessageAt.desc())
      .where(sql`unread_count > 0`),
    // The "waiting for a reply" sweep (BL-098, migration 20261110090000): open, unassigned chats with an unanswered, unread customer message.
    index('idx_conversations_waiting_nudge')
      .on(t.lastInboundAt.desc())
      .where(
        sql`status = 'open' AND NOT archived AND muted_at IS NULL AND assignee_user_id IS NULL AND assignee_team_id IS NULL AND assignee_agent_id IS NULL AND waiting_since IS NOT NULL AND unread_count > 0`,
      ),
    index('idx_conversations_snooze_due')
      .on(t.snoozedUntil)
      .where(sql`status = 'snoozed' AND snoozed_until IS NOT NULL`),
    index('idx_conversations_escalation_due')
      .on(t.escalationDueAt)
      .where(sql`escalation_due_at IS NOT NULL`),
    index('idx_conversations_sla_first_due')
      .on(t.slaFirstResponseDue)
      .where(sql`sla_first_response_due IS NOT NULL AND NOT sla_breached`),
    index('idx_conversations_sla_resolution_due')
      .on(t.slaResolutionDue)
      .where(sql`sla_resolution_due IS NOT NULL AND NOT sla_breached`),
  ],
);

export type ConversationsRow = typeof conversations.$inferSelect;
export type NewConversationsRow = typeof conversations.$inferInsert;

export const conversationEvents = pgTable(
  'conversation_events',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('conversation_events_id_seq')`),
    /** The id on the wire (tib1 migration 20261015090000). */
    uuid: uuid('uuid').notNull().defaultRandom(),
    orgId: orgIdColumn(),
    conversationId: idColumn('conversation_id').notNull(),
    actorUserId: idColumn('actor_user_id'),
    actorType: text('actor_type').notNull().default('user'),
    type: text('type').notNull(),
    payload: jsonb('payload'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt] }),
    index('idx_conversation_events_conversation_id').on(t.orgId, t.conversationId),
    index('idx_conversation_events_created_at').on(t.orgId, t.createdAt),
    index('idx_conversation_events_type').on(t.orgId, t.type),
    index('idx_conversation_events_timeline').on(
      t.orgId,
      t.conversationId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
  ],
);

export type ConversationEventsRow = typeof conversationEvents.$inferSelect;
export type NewConversationEventsRow = typeof conversationEvents.$inferInsert;

export const conversationNotes = pgTable(
  'conversation_notes',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    conversationId: idColumn('conversation_id').notNull(),
    userId: idColumn('user_id'),
    body: text('body').notNull(),
    /** Users mentioned, as uuid strings (tib1 migration 20261015090100: NOT NULL, always an array). */
    mentions: jsonb('mentions')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    isPinned: boolean('is_pinned').notNull().default(false),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_conversation_notes_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_conversation_notes_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_conversation_notes_conversation_id',
      columns: [t.orgId, t.conversationId],
      foreignColumns: [conversations.orgId, conversations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_conversation_notes_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_conversation_notes_conversation_id_created_at').on(
      t.orgId,
      t.conversationId,
      t.createdAt,
    ),
  ],
);

export type ConversationNotesRow = typeof conversationNotes.$inferSelect;
export type NewConversationNotesRow = typeof conversationNotes.$inferInsert;

export const conversationParticipants = pgTable(
  'conversation_participants',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    conversationId: idColumn('conversation_id').notNull(),
    userId: idColumn('user_id'),
    role: text('role').notNull().default('watcher'),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    unreadMessages: integer('unread_messages').notNull().default(0),
    unreadMentions: integer('unread_mentions').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_conversation_participants_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_conversation_participants_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_conversation_participants_conversation_id_user_id').on(
      t.orgId,
      t.conversationId,
      t.userId,
    ),
    foreignKey({
      name: 'fk_conversation_participants_conversation_id',
      columns: [t.orgId, t.conversationId],
      foreignColumns: [conversations.orgId, conversations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_conversation_participants_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_conversation_participants_user_id').on(t.orgId, t.userId),
  ],
);

export type ConversationParticipantsRow = typeof conversationParticipants.$inferSelect;
export type NewConversationParticipantsRow = typeof conversationParticipants.$inferInsert;

export const MESSAGE_DIRECTIONS = ['in', 'out'] as const;
export const MESSAGE_KINDS = [
  'text',
  'image',
  'video',
  'audio',
  'voice',
  'document',
  'sticker',
  'location',
  'contact',
  'template',
  'reaction',
  'interactive',
  'system',
] as const;
export const MESSAGE_SENDER_KINDS = ['customer', 'agent', 'bot', 'system', 'broadcast'] as const;
export const MESSAGE_STATUSES = [
  'received',
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
] as const;

/**
 * The one message stream (Reference's `messages` and `inbox_messages` folded). Monthly partitions on `created_at`; the id on the wire is
 * `uuid`, ordering inside a thread is `seq`. Uniqueness of a channel message is enforced by `message_ledger`, not here. A stream has no
 * foreign keys; a trigger on `conversations` deletes a thread's messages with it.
 */
export const messages = pgTable(
  'messages',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('messages_id_seq')`),
    orgId: orgIdColumn(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    conversationId: idColumn('conversation_id').notNull(),
    seq: idColumn('seq').notNull(),
    direction: text('direction').$type<(typeof MESSAGE_DIRECTIONS)[number]>().notNull(),
    kind: text('kind').$type<(typeof MESSAGE_KINDS)[number]>().notNull().default('text'),
    senderKind: text('sender_kind').$type<(typeof MESSAGE_SENDER_KINDS)[number]>().notNull(),
    senderUserId: idColumn('sender_user_id'),
    senderAgentId: idColumn('sender_agent_id'),
    body: text('body'),
    mediaKey: text('media_key'),
    mediaMime: text('media_mime'),
    mediaSize: idColumn('media_size'),
    mediaName: text('media_name'),
    mediaSha256: text('media_sha256'),
    latitude: numeric('latitude', { precision: 10, scale: 7 }),
    longitude: numeric('longitude', { precision: 10, scale: 7 }),
    status: text('status').$type<(typeof MESSAGE_STATUSES)[number]>().notNull(),
    failureCode: text('failure_code'),
    failureReason: text('failure_reason'),
    clientMessageId: uuid('client_message_id'),
    providerMessageId: text('provider_message_id'),
    replyToMessageUuid: uuid('reply_to_message_uuid'),
    reaction: text('reaction'),
    starred: boolean('starred').notNull().default(false),
    pinned: boolean('pinned').notNull().default(false),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    isTranslated: boolean('is_translated').notNull().default(false),
    translatedBody: text('translated_body'),
    detectedLanguage: text('detected_language'),
    templateId: idColumn('template_id'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    providerTs: timestamp('provider_ts', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt] }),
    index('idx_messages_thread').on(t.orgId, t.conversationId, t.seq),
    index('idx_messages_uuid').on(t.orgId, t.uuid),
    index('idx_messages_wgt_conversation').on(t.orgId, t.conversationId, t.id),
    index('idx_messages_org_created').on(t.orgId, t.createdAt),
    index('idx_messages_queued')
      .on(t.createdAt)
      .where(sql`status = 'queued'`),
    index('idx_messages_sender_user_id')
      .on(t.orgId, t.senderUserId)
      .where(sql`sender_user_id IS NOT NULL`),
    index('idx_messages_template_id')
      .on(t.orgId, t.templateId)
      .where(sql`template_id IS NOT NULL`),
    index('idx_messages_body_trgm').using('gin', sql`${t.body} gin_trgm_ops`),
    index('idx_messages_media_key')
      .on(t.orgId, t.mediaKey)
      .where(sql`media_key IS NOT NULL`),
  ],
);

export type MessagesRow = typeof messages.$inferSelect;
export type NewMessagesRow = typeof messages.$inferInsert;

export const MESSAGE_LEDGER_KINDS = ['provider_id', 'client_id'] as const;

/**
 * Idempotency authority and receipt router for `messages` (a partitioned table cannot hold a unique key without its partition column).
 * The message id and timestamp are allocated before the message is inserted, in the same transaction.
 */
export const messageLedger = pgTable(
  'message_ledger',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    channelId: idColumn('channel_id').notNull(),
    kind: text('kind').$type<(typeof MESSAGE_LEDGER_KINDS)[number]>().notNull(),
    key: text('key').notNull(),
    messageId: idColumn('message_id').notNull(),
    messageCreatedAt: timestamp('message_created_at', { withTimezone: true }).notNull(),
    conversationId: idColumn('conversation_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_message_ledger_key').on(t.orgId, t.channelId, t.kind, t.key),
    foreignKey({
      name: 'message_ledger_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_message_ledger_conversation_id',
      columns: [t.orgId, t.conversationId],
      foreignColumns: [conversations.orgId, conversations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_message_ledger_channel_id',
      columns: [t.orgId, t.channelId],
      foreignColumns: [chatChannels.orgId, chatChannels.id],
    }).onDelete('cascade'),
    index('idx_message_ledger_message').on(t.orgId, t.messageId),
    index('idx_message_ledger_conversation').on(t.orgId, t.conversationId),
    index('idx_message_ledger_created').on(t.createdAt),
  ],
);

export type MessageLedgerRow = typeof messageLedger.$inferSelect;
export type NewMessageLedgerRow = typeof messageLedger.$inferInsert;

export const MESSAGE_EVENT_TYPES = [
  'queued',
  'attempt',
  'retry',
  'sent',
  'delivered',
  'read',
  'failed',
] as const;

/** Every state change and receipt of a message, including receipts the summary columns ignore. Monthly partitions, no foreign keys. */
export const messageEvents = pgTable(
  'message_events',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('message_events_id_seq')`),
    orgId: orgIdColumn(),
    messageId: idColumn('message_id').notNull(),
    messageCreatedAt: timestamp('message_created_at', { withTimezone: true }).notNull(),
    event: text('event').$type<(typeof MESSAGE_EVENT_TYPES)[number]>().notNull(),
    detail: jsonb('detail'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt] }),
    index('idx_message_events_message').on(t.orgId, t.messageId, t.messageCreatedAt),
    index('idx_message_events_created').on(t.createdAt),
  ],
);

export type MessageEventsRow = typeof messageEvents.$inferSelect;
export type NewMessageEventsRow = typeof messageEvents.$inferInsert;

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/** One gzip NDJSON object per workspace and UTC day: the message events older than the live window (20261116100000). */
export const messageEventArchives = pgTable(
  'message_event_archives',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    day: date('day').notNull(),
    eventCount: integer('event_count').notNull(),
    payloadGz: bytea('payload_gz').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_message_event_archives_day').on(t.orgId, t.day),
    index('idx_message_event_archives_day').on(t.day),
  ],
);

export const MESSAGE_LOG_EXPORT_STATUSES = [
  'queued',
  'running',
  'ready',
  'failed',
  'expired',
] as const;

/** One requested export of the message log; the file lives in `fileGz` for a week (20261116100000). */
export const messageLogExports = pgTable(
  'message_log_exports',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    requestedBy: idColumn('requested_by').notNull(),
    emailedTo: text('emailed_to'),
    rangeFrom: date('range_from').notNull(),
    rangeTo: date('range_to').notNull(),
    messageStatus: text('message_status'),
    /** 'events': the delivery log; 'messages': the Message History feed with `filters` (20261126090000). */
    kind: text('kind').notNull().default('events'),
    filters: jsonb('filters').$type<Record<string, unknown>>(),
    status: text('status')
      .$type<(typeof MESSAGE_LOG_EXPORT_STATUSES)[number]>()
      .notNull()
      .default('queued'),
    rowCount: integer('row_count'),
    fileName: text('file_name'),
    fileBytes: integer('file_bytes'),
    fileGz: bytea('file_gz'),
    error: text('error'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('message_log_exports_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      columns: [t.orgId, t.requestedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
    index('idx_message_log_exports_org').on(t.orgId, t.requestedAt),
    index('idx_message_log_exports_expiry')
      .on(t.expiresAt)
      .where(sql`status = 'ready'`),
  ],
);
