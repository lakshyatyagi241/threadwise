/**
 * platform-support-desk: tables ported from Reference. Mirrors migrations/20261001102800_supp_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { platformOperators } from '../auth-registration-security/core';
import { organizations, users } from '../foundation';
import { slaPolicies } from '../team-inbox-routing-sla/tables';

export const platformNotes = pgTable(
  'platform_notes',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    conversationId: idColumn('conversation_id'),
    adminUserId: idColumn('admin_user_id'),
    body: text('body').notNull(),
    severity: text('severity').notNull().default('info'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_platform_notes_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_platform_notes_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_platform_notes_admin_user_id',
      columns: [t.orgId, t.adminUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_platform_notes_conversation_id').on(t.orgId, t.conversationId),
  ],
);

export type PlatformNotesRow = typeof platformNotes.$inferSelect;
export type NewPlatformNotesRow = typeof platformNotes.$inferInsert;

export const playbooks = pgTable(
  'playbooks',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    triggerType: text('trigger_type').notNull().default('manual'),
    triggerValue: text('trigger_value'),
    steps: jsonb('steps'),
    isActive: boolean('is_active').notNull().default(true),
    useCount: integer('use_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_playbooks_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_playbooks_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_playbooks_slug').on(t.orgId, t.slug),
  ],
);

export type PlaybooksRow = typeof playbooks.$inferSelect;
export type NewPlaybooksRow = typeof playbooks.$inferInsert;

export const supportAgents = pgTable(
  'support_agents',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    isActive: boolean('is_active').notNull().default(true),
    specialty: text('specialty'),
    currentLoad: integer('current_load').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_support_agents_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_support_agents_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_support_agents_user_id').on(t.orgId, t.userId),
    foreignKey({
      name: 'fk_support_agents_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
  ],
);

export type SupportAgentsRow = typeof supportAgents.$inferSelect;
export type NewSupportAgentsRow = typeof supportAgents.$inferInsert;

export const supportTickets = pgTable(
  'support_tickets',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    ticketNumber: text('ticket_number').notNull(),
    reason: text('reason').notNull().default('other'),
    name: text('name').notNull(),
    email: text('email').notNull(),
    subject: text('subject').notNull(),
    message: text('message').notNull(),
    status: text('status').notNull().default('open'),
    priority: text('priority').notNull().default('normal'),
    assignedAgentId: idColumn('assigned_agent_id'),
    slaPolicyId: idColumn('sla_policy_id'),
    lastReplyAt: timestamp('last_reply_at', { withTimezone: true }),
    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
    tags: jsonb('tags'),
    meta: jsonb('meta'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_support_tickets_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_support_tickets_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_support_tickets_ticket_number').on(t.ticketNumber),
    foreignKey({
      name: 'fk_support_tickets_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_support_tickets_assigned_operator',
      columns: [t.assignedAgentId],
      foreignColumns: [platformOperators.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_support_tickets_sla_policy_id',
      columns: [t.orgId, t.slaPolicyId],
      foreignColumns: [slaPolicies.orgId, slaPolicies.id],
    }).onDelete('set null'),
    index('idx_support_tickets_created_at').on(t.createdAt.desc(), t.id.desc()),
    index('idx_support_tickets_assigned_agent_id').on(t.orgId, t.assignedAgentId),
    index('idx_support_tickets_sla_policy_id').on(t.orgId, t.slaPolicyId),
    index('idx_support_tickets_status_priority').on(t.orgId, t.status, t.priority),
    index('idx_support_tickets_user_id_status').on(t.orgId, t.userId, t.status),
  ],
);

export type SupportTicketsRow = typeof supportTickets.$inferSelect;
export type NewSupportTicketsRow = typeof supportTickets.$inferInsert;

export const supportAssignments = pgTable(
  'support_assignments',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    ticketId: idColumn('ticket_id').notNull(),
    agentUserId: idColumn('agent_user_id'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    outcome: text('outcome'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_support_assignments_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_support_assignments_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_support_assignments_ticket_id',
      columns: [t.orgId, t.ticketId],
      foreignColumns: [supportTickets.orgId, supportTickets.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_support_assignments_agent_user_id',
      columns: [t.orgId, t.agentUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
    index('idx_support_assignments_agent_user_id').on(t.orgId, t.agentUserId),
    index('idx_support_assignments_ticket_id_released_at').on(t.orgId, t.ticketId, t.releasedAt),
  ],
);

export type SupportAssignmentsRow = typeof supportAssignments.$inferSelect;
export type NewSupportAssignmentsRow = typeof supportAssignments.$inferInsert;

export const supportMessages = pgTable(
  'support_messages',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    ticketId: idColumn('ticket_id').notNull(),
    authorUserId: idColumn('author_user_id'),
    authorRole: text('author_role').notNull().default('admin'),
    body: text('body').notNull(),
    attachments: jsonb('attachments'),
    isInternalNote: boolean('is_internal_note').notNull().default(false),
    emailStatus: text('email_status'),
    authorOperatorId: idColumn('author_operator_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_support_messages_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_support_messages_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_support_messages_ticket_id',
      columns: [t.orgId, t.ticketId],
      foreignColumns: [supportTickets.orgId, supportTickets.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_support_messages_author_user_id',
      columns: [t.orgId, t.authorUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'support_messages_author_operator_id_fkey',
      columns: [t.authorOperatorId],
      foreignColumns: [platformOperators.id],
    }).onDelete('set null'),
    index('idx_support_messages_author_operator_id').on(t.authorOperatorId),
    index('idx_support_messages_author_user_id').on(t.orgId, t.authorUserId),
    index('idx_support_messages_ticket_id_created_at').on(t.orgId, t.ticketId, t.createdAt),
  ],
);

export type SupportMessagesRow = typeof supportMessages.$inferSelect;
export type NewSupportMessagesRow = typeof supportMessages.$inferInsert;
