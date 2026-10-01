/**
 * contacts-attributes-tags: tables ported from Reference. Mirrors migrations/20261001103500_con_threadwise_schema.sql.
 * The SQL migration is the source of truth (ADR-0004); `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  boolean,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { contacts } from '../crm';
import { organizations, users } from '../foundation';

export const contactGroups = pgTable(
  'contact_groups',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    userGroup: text('user_group'),
    note: text('note'),
    status: boolean('status').notNull().default(true),
    color: text('color'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_contact_groups_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_contact_groups_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_contact_groups_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_contact_groups_user_id').on(t.orgId, t.userId),
  ],
);

export type ContactGroupsRow = typeof contactGroups.$inferSelect;
export type NewContactGroupsRow = typeof contactGroups.$inferInsert;

export const csatResponses = pgTable(
  'csat_responses',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    conversationId: idColumn('conversation_id').notNull(),
    agentUserId: idColumn('agent_user_id'),
    rating: smallint('rating'),
    comment: text('comment'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_csat_responses_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_csat_responses_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_csat_responses_agent_user_id',
      columns: [t.orgId, t.agentUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_csat_responses_agent_user_id').on(t.orgId, t.agentUserId),
    index('idx_csat_responses_conversation_id').on(t.orgId, t.conversationId),
  ],
);

export type CsatResponsesRow = typeof csatResponses.$inferSelect;
export type NewCsatResponsesRow = typeof csatResponses.$inferInsert;

export const contactGroupMembers = pgTable(
  'contact_group_members',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    contactId: idColumn('contact_id').notNull(),
    groupId: idColumn('group_id').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_contact_group_members_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_contact_group_members_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_contact_group_members_contact_id_group_id').on(t.orgId, t.contactId, t.groupId),
    foreignKey({
      name: 'fk_contact_group_members_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_contact_group_members_group_id',
      columns: [t.orgId, t.groupId],
      foreignColumns: [contactGroups.orgId, contactGroups.id],
    }).onDelete('cascade'),
    index('idx_contact_group_members_group_id').on(t.orgId, t.groupId),
  ],
);

export type ContactGroupMembersRow = typeof contactGroupMembers.$inferSelect;
export type NewContactGroupMembersRow = typeof contactGroupMembers.$inferInsert;
