/**
 * chat-conversations: tables ported from WaDesk. Mirrors migrations/20261001103600_chat_wadesk_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { aiAgents } from '../ai-agents-training/tables';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { contactGroups } from '../contacts-attributes-tags/tables';
import { contacts } from '../crm';
import { organizations, teams, users } from '../foundation';
import { slaPolicies } from '../team-inbox-routing-sla/tables';

export const conversations = pgTable(
  'conversations',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    deviceId: idColumn('device_id'),
    contactGroupId: idColumn('contact_group_id'),
    rawJid: text('raw_jid'),
    altJid: text('alt_jid'),
    contactDigits: text('contact_digits'),
    contactId: idColumn('contact_id'),
    title: text('title').notNull(),
    preview: text('preview'),
    status: text('status').notNull().default('pending'),
    platform: text('platform').notNull().default('W'),
    provider: text('provider').notNull().default('baileys'),
    customerLanguage: text('customer_language'),
    origin: text('origin').notNull().default('chat'),
    archived: boolean('archived').notNull().default(false),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    mutedAt: timestamp('muted_at', { withTimezone: true }),
    recipientsCount: integer('recipients_count').notNull().default(0),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    scheduledTimezone: text('scheduled_timezone'),
    inboxStatus: text('inbox_status').notNull().default('open'),
    priority: text('priority').notNull().default('normal'),
    interestedSku: text('interested_sku'),
    interestedProductId: idColumn('interested_product_id'),
    interestedSeenAt: timestamp('interested_seen_at', { withTimezone: true }),
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
    channel: text('channel').notNull().default('whatsapp'),
    isSpam: boolean('is_spam').notNull().default(false),
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
    foreignKey({
      name: 'fk_conversations_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_conversations_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_conversations_contact_group_id',
      columns: [t.orgId, t.contactGroupId],
      foreignColumns: [contactGroups.orgId, contactGroups.id],
    }).onDelete('set null'),
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
    index('idx_conversations_alt_jid').on(t.orgId, t.altJid),
    index('idx_conversations_assignee_agent_id').on(t.orgId, t.assigneeAgentId),
    index('idx_conversations_channel').on(t.orgId, t.channel),
    index('idx_conversations_contact_group_id').on(t.orgId, t.contactGroupId),
    index('idx_conversations_contact_id').on(t.orgId, t.contactId),
    index('idx_conversations_device_id').on(t.orgId, t.deviceId),
    index('idx_conversations_escalation_due_at').on(t.orgId, t.escalationDueAt),
    index('idx_conversations_is_spam').on(t.orgId, t.isSpam),
    index('idx_conversations_last_inbound_at').on(t.orgId, t.lastInboundAt),
    index('idx_conversations_last_message_at').on(t.orgId, t.lastMessageAt),
    index('idx_conversations_last_outbound_at').on(t.orgId, t.lastOutboundAt),
    index('idx_conversations_origin').on(t.orgId, t.origin),
    index('idx_conversations_pinned_at').on(t.orgId, t.pinnedAt),
    index('idx_conversations_priority').on(t.orgId, t.priority),
    index('idx_conversations_sla_breached').on(t.orgId, t.slaBreached),
    index('idx_conversations_sla_first_response_due').on(t.orgId, t.slaFirstResponseDue),
    index('idx_conversations_sla_resolution_due').on(t.orgId, t.slaResolutionDue),
    index('idx_conversations_snoozed_until').on(t.orgId, t.snoozedUntil),
    index('idx_conversations_user_id_archived_status').on(t.orgId, t.userId, t.archived, t.status),
    index('idx_conversations_assignee_team_id_inbox_status').on(
      t.orgId,
      t.assigneeTeamId,
      t.inboxStatus,
    ),
    index('idx_conversations_assignee_user_id_inbox_status').on(
      t.orgId,
      t.assigneeUserId,
      t.inboxStatus,
    ),
    index('idx_conversations_inbox_status_priority').on(t.orgId, t.inboxStatus, t.priority),
    index('idx_conversations_interested_sku').on(t.orgId, t.interestedSku),
    index('idx_conversations_provider').on(t.orgId, t.provider),
    index('idx_conversations_archived_inbox_status_last_message_at').on(
      t.orgId,
      t.archived,
      t.inboxStatus,
      t.lastMessageAt,
    ),
    index('idx_conversations_contact_digits').on(t.orgId, t.contactDigits),
    index('idx_conversations_unread_count').on(t.orgId, t.unreadCount),
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
    mentions: jsonb('mentions'),
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

export const messages = pgTable(
  'messages',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('messages_id_seq')`),
    orgId: orgIdColumn(),
    conversationId: idColumn('conversation_id'),
    userId: idColumn('user_id'),
    agentId: idColumn('agent_id'),
    contactId: idColumn('contact_id'),
    templateId: idColumn('template_id'),
    direction: text('direction').notNull().default('out'),
    toNumber: text('to_number'),
    fromNumber: text('from_number'),
    body: text('body'),
    mediaPath: text('media_path'),
    mediaType: text('media_type'),
    latitude: numeric('latitude', { precision: 10, scale: 7 }),
    longitude: numeric('longitude', { precision: 10, scale: 7 }),
    status: text('status').notNull().default('pending'),
    pinned: boolean('pinned').notNull().default(false),
    starred: boolean('starred').notNull().default(false),
    reaction: text('reaction'),
    qualityScore: smallint('quality_score'),
    qualityNote: text('quality_note'),
    meta: jsonb('meta'),
    failureReason: text('failure_reason'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    provider: text('provider'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt] }),
    index('idx_messages_agent_id').on(t.orgId, t.agentId),
    index('idx_messages_contact_id').on(t.orgId, t.contactId),
    index('idx_messages_conversation_id').on(t.orgId, t.conversationId),
    index('idx_messages_provider').on(t.orgId, t.provider),
    index('idx_messages_scheduled_at').on(t.orgId, t.scheduledAt),
    index('idx_messages_status').on(t.orgId, t.status),
    index('idx_messages_template_id').on(t.orgId, t.templateId),
    index('idx_messages_user_id').on(t.orgId, t.userId),
  ],
);

export type MessagesRow = typeof messages.$inferSelect;
export type NewMessagesRow = typeof messages.$inferInsert;
