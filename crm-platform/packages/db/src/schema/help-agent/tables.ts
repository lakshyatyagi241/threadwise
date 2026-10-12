/**
 * help-agent: the in-app assistant (docs/specs/help-agent-assistant.md). Mirrors migrations/20261119090000_help_agent.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
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

export const helpAgentSettings = pgTable(
  'help_agent_settings',
  {
    orgId: orgIdColumn(),
    enabled: boolean('enabled').notNull().default(false),
    updatedBy: idColumn('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId] }),
    foreignKey({
      name: 'help_agent_settings_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_help_agent_settings_updated_by',
      columns: [t.orgId, t.updatedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
  ],
);

export type HelpAgentSettingsRow = typeof helpAgentSettings.$inferSelect;

export const helpAgentTasks = pgTable(
  'help_agent_tasks',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    status: text('status').notNull().default('running'),
    locale: text('locale').notNull(),
    taskLength: integer('task_length').notNull(),
    route: text('route').notNull(),
    steps: integer('steps').notNull().default(0),
    confirmedActions: integer('confirmed_actions').notNull().default(0),
    deniedActions: integer('denied_actions').notNull().default(0),
    promptTokens: bigint('prompt_tokens', { mode: 'number' }).notNull().default(0),
    completionTokens: bigint('completion_tokens', { mode: 'number' }).notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    lastStepAt: timestamp('last_step_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('help_agent_tasks_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'help_agent_tasks_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_help_agent_tasks_user',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    check(
      'ck_help_agent_tasks_status',
      sql`${t.status} in ('running', 'completed', 'failed', 'stopped', 'error', 'abandoned')`,
    ),
    check(
      'ck_help_agent_tasks_counts',
      sql`${t.steps} >= 0 and ${t.confirmedActions} >= 0 and ${t.deniedActions} >= 0 and ${t.promptTokens} >= 0 and ${t.completionTokens} >= 0 and ${t.taskLength} > 0`,
    ),
    index('idx_help_agent_tasks_user_started').on(t.orgId, t.userId, t.startedAt.desc()),
    index('idx_help_agent_tasks_org_started').on(t.orgId, t.startedAt.desc()),
  ],
);

export type HelpAgentTasksRow = typeof helpAgentTasks.$inferSelect;
