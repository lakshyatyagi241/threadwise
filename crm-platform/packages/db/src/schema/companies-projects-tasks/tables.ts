/**
 * companies-projects-tasks: tables ported from Reference. Mirrors migrations/20261001103900_ctp_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
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

/**
 * The workspace's list of task outcomes (Interested, Left message, ...). Mirrors migrations/20270126090000_task_outcomes.sql; the
 * unique index on (org_id, lower(btrim(name))) is an expression index and lives there.
 */
export const taskOutcomes = pgTable(
  'task_outcomes',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_task_outcomes_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_task_outcomes_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    index('idx_task_outcomes_order').on(t.orgId, t.sortOrder, t.id),
  ],
);

export type TaskOutcomesRow = typeof taskOutcomes.$inferSelect;
export type NewTaskOutcomesRow = typeof taskOutcomes.$inferInsert;

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
    contactId: idColumn('contact_id'),
    dealId: idColumn('deal_id'),
    companyId: idColumn('company_id'),
    /** The outcome the task ended with (task_outcomes); no ON DELETE action: an outcome in use cannot be deleted. */
    outcomeId: idColumn('outcome_id'),
    source: text('source').notNull().default('manual'),
    /** BL-291: `follow_up` is a contact's next follow-up (at most one open per contact); every other task is `task`. */
    kind: text('kind').notNull().default('task'),
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
    foreignKey({
      name: 'fk_tasks_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_tasks_deal_id',
      columns: [t.orgId, t.dealId],
      foreignColumns: [deals.orgId, deals.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_tasks_company_id',
      columns: [t.orgId, t.companyId],
      foreignColumns: [companies.orgId, companies.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_tasks_outcome_id',
      columns: [t.orgId, t.outcomeId],
      foreignColumns: [taskOutcomes.orgId, taskOutcomes.id],
    }),
    index('idx_tasks_org_created').on(t.orgId, t.createdAt, t.id),
    // The open-task, assignee, done, link, created_by and reminder indexes are partial or expression indexes and live in
    // migrations/20261004100000_task_model_reshape.sql; the CHECKs (status, priority, done stamp) live there too.
  ],
);

export type TasksRow = typeof tasks.$inferSelect;
export type NewTasksRow = typeof tasks.$inferInsert;
