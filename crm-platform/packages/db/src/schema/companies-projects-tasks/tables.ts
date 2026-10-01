/**
 * companies-projects-tasks: tables ported from Reference. Mirrors migrations/20261001103900_ctp_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  date,
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
import { companies, contacts } from '../crm';
import { deals } from '../deals-pipelines/tables';
import { organizations, users } from '../foundation';

export const projects = pgTable(
  'projects',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull().default('in_progress'),
    progress: smallint('progress').notNull().default(0),
    contactId: idColumn('contact_id'),
    companyId: idColumn('company_id'),
    dealId: idColumn('deal_id'),
    ownerId: idColumn('owner_id'),
    createdBy: idColumn('created_by'),
    startDate: date('start_date'),
    dueDate: date('due_date'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_projects_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_projects_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_projects_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_projects_company_id',
      columns: [t.orgId, t.companyId],
      foreignColumns: [companies.orgId, companies.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_projects_deal_id',
      columns: [t.orgId, t.dealId],
      foreignColumns: [deals.orgId, deals.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_projects_owner_id',
      columns: [t.orgId, t.ownerId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_projects_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_projects_company_id').on(t.orgId, t.companyId),
    index('idx_projects_contact_id').on(t.orgId, t.contactId),
    index('idx_projects_deal_id').on(t.orgId, t.dealId),
    index('idx_projects_due_date').on(t.orgId, t.dueDate),
    index('idx_projects_status_due_date').on(t.orgId, t.status, t.dueDate),
  ],
);

export type ProjectsRow = typeof projects.$inferSelect;
export type NewProjectsRow = typeof projects.$inferInsert;

export const tasks = pgTable(
  'tasks',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    createdBy: idColumn('created_by'),
    assigneeId: idColumn('assignee_id'),
    title: text('title').notNull(),
    notes: text('notes'),
    priority: text('priority').notNull().default('medium'),
    status: text('status').notNull().default('open'),
    relatedType: text('related_type'),
    relatedId: idColumn('related_id'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    doneAt: timestamp('done_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_tasks_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_tasks_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_tasks_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_tasks_assignee_id',
      columns: [t.orgId, t.assigneeId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_tasks_assignee_id').on(t.orgId, t.assigneeId),
    index('idx_tasks_due_at').on(t.orgId, t.dueAt),
    index('idx_tasks_related_type_related_id').on(t.orgId, t.relatedType, t.relatedId),
    index('idx_tasks_status_due_at').on(t.orgId, t.status, t.dueAt),
  ],
);

export type TasksRow = typeof tasks.$inferSelect;
export type NewTasksRow = typeof tasks.$inferInsert;
