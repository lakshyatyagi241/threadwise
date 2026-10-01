/**
 * team-chat: tables ported from Reference. Mirrors migrations/20261001101600_tchat_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';

export const teamChatChannels = pgTable(
  'team_chat_channels',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    type: text('type').notNull().default('public'),
    createdByUserId: idColumn('created_by_user_id'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_team_chat_channels_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_team_chat_channels_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check('chk_team_chat_channels_type', sql`${t.type} in ('public', 'private', 'dm')`),
    unique('uq_team_chat_channels_slug').on(t.orgId, t.slug),
    foreignKey({
      name: 'fk_team_chat_channels_created_by_user_id',
      columns: [t.orgId, t.createdByUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_team_chat_channels_created_by_user_id').on(t.orgId, t.createdByUserId),
    index('idx_team_chat_channels_type').on(t.orgId, t.type),
  ],
);

export type TeamChatChannelsRow = typeof teamChatChannels.$inferSelect;
export type NewTeamChatChannelsRow = typeof teamChatChannels.$inferInsert;

export const teamChatInvitations = pgTable(
  'team_chat_invitations',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    channelId: idColumn('channel_id'),
    requesterUserId: idColumn('requester_user_id'),
    inviteeUserId: idColumn('invitee_user_id'),
    inviteeEmail: text('invitee_email'),
    inviteeName: text('invitee_name'),
    status: text('status').notNull().default('pending'),
    note: text('note'),
    decidedByUserId: idColumn('decided_by_user_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_team_chat_invitations_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_team_chat_invitations_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check(
      'chk_team_chat_invitations_status',
      sql`${t.status} in ('pending', 'approved', 'declined', 'expired')`,
    ),
    foreignKey({
      name: 'fk_team_chat_invitations_channel_id',
      columns: [t.orgId, t.channelId],
      foreignColumns: [teamChatChannels.orgId, teamChatChannels.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_team_chat_invitations_requester_user_id',
      columns: [t.orgId, t.requesterUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_team_chat_invitations_invitee_user_id',
      columns: [t.orgId, t.inviteeUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_team_chat_invitations_decided_by_user_id',
      columns: [t.orgId, t.decidedByUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_team_chat_invitations_channel_id').on(t.orgId, t.channelId),
    index('idx_team_chat_invitations_decided_by_user_id').on(t.orgId, t.decidedByUserId),
    index('idx_team_chat_invitations_invitee_user_id').on(t.orgId, t.inviteeUserId),
    index('idx_team_chat_invitations_requester_user_id').on(t.orgId, t.requesterUserId),
    index('idx_team_chat_invitations_status').on(t.orgId, t.status),
  ],
);

export type TeamChatInvitationsRow = typeof teamChatInvitations.$inferSelect;
export type NewTeamChatInvitationsRow = typeof teamChatInvitations.$inferInsert;

export const teamChatMessages = pgTable(
  'team_chat_messages',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    channelId: idColumn('channel_id'),
    userId: idColumn('user_id'),
    body: text('body'),
    mentions: jsonb('mentions'),
    replyToId: idColumn('reply_to_id'),
    attachmentPath: text('attachment_path'),
    attachmentMime: text('attachment_mime'),
    attachmentName: text('attachment_name'),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    pinnedByUserId: idColumn('pinned_by_user_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_team_chat_messages_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_team_chat_messages_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_team_chat_messages_channel_id',
      columns: [t.orgId, t.channelId],
      foreignColumns: [teamChatChannels.orgId, teamChatChannels.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_team_chat_messages_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_team_chat_messages_reply_to_id',
      columns: [t.orgId, t.replyToId],
      foreignColumns: [t.orgId, t.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_team_chat_messages_pinned_by_user_id',
      columns: [t.orgId, t.pinnedByUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_team_chat_messages_reply_to_id').on(t.orgId, t.replyToId),
    index('idx_team_chat_messages_user_id').on(t.orgId, t.userId),
    index('idx_team_chat_messages_created_at').on(t.orgId, t.createdAt),
  ],
);

export type TeamChatMessagesRow = typeof teamChatMessages.$inferSelect;
export type NewTeamChatMessagesRow = typeof teamChatMessages.$inferInsert;

export const teamChatReactions = pgTable(
  'team_chat_reactions',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    messageId: idColumn('message_id').notNull(),
    userId: idColumn('user_id'),
    emoji: text('emoji').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_team_chat_reactions_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_team_chat_reactions_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_team_chat_reactions_message_id_user_id_emoji').on(
      t.orgId,
      t.messageId,
      t.userId,
      t.emoji,
    ),
    foreignKey({
      name: 'fk_team_chat_reactions_message_id',
      columns: [t.orgId, t.messageId],
      foreignColumns: [teamChatMessages.orgId, teamChatMessages.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_team_chat_reactions_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
    index('idx_team_chat_reactions_user_id').on(t.orgId, t.userId),
  ],
);

export type TeamChatReactionsRow = typeof teamChatReactions.$inferSelect;
export type NewTeamChatReactionsRow = typeof teamChatReactions.$inferInsert;

export const teamChatReads = pgTable(
  'team_chat_reads',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    lastReadMessageId: idColumn('last_read_message_id').notNull().default(0),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_team_chat_reads_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_team_chat_reads_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_team_chat_reads_user_id').on(t.orgId, t.userId),
    foreignKey({
      name: 'fk_team_chat_reads_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_team_chat_reads_last_read_message_id',
      columns: [t.orgId, t.lastReadMessageId],
      foreignColumns: [teamChatMessages.orgId, teamChatMessages.id],
    }).onDelete('cascade'),
  ],
);

export type TeamChatReadsRow = typeof teamChatReads.$inferSelect;
export type NewTeamChatReadsRow = typeof teamChatReads.$inferInsert;

export const teamChatChannelMembers = pgTable(
  'team_chat_channel_members',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    channelId: idColumn('channel_id').notNull(),
    userId: idColumn('user_id'),
    role: text('role').notNull().default('member'),
    lastReadMessageId: idColumn('last_read_message_id').notNull().default(0),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_team_chat_channel_members_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_team_chat_channel_members_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check('chk_team_chat_channel_members_role', sql`${t.role} in ('admin', 'member')`),
    unique('uq_team_chat_channel_members_channel_id_user_id').on(t.orgId, t.channelId, t.userId),
    foreignKey({
      name: 'fk_team_chat_channel_members_channel_id',
      columns: [t.orgId, t.channelId],
      foreignColumns: [teamChatChannels.orgId, teamChatChannels.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_team_chat_channel_members_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_team_chat_channel_members_last_read_message_id',
      columns: [t.orgId, t.lastReadMessageId],
      foreignColumns: [teamChatMessages.orgId, teamChatMessages.id],
    }).onDelete('cascade'),
    index('idx_team_chat_channel_members_user_id').on(t.orgId, t.userId),
  ],
);

export type TeamChatChannelMembersRow = typeof teamChatChannelMembers.$inferSelect;
export type NewTeamChatChannelMembersRow = typeof teamChatChannelMembers.$inferInsert;
