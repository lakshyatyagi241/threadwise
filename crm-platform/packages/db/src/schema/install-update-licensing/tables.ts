import { pgTable, smallint, text, timestamp } from 'drizzle-orm/pg-core';
import { createdAt, idColumn, rowVersion, updatedAt } from '../columns';

/**
 * Mirror of 20261003090000_inst_platform_setup.sql and 20261006090000_inst_setup_run_progress.sql. The SQL is the source of truth; this file exists so queries
 * are typed. Platform-wide singleton (id is always 1): the first-run lock.
 */
export const platformSetup = pgTable('platform_setup', {
  id: smallint('id').primaryKey().default(1),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  completedVersion: text('completed_version'),
  firstOperatorId: idColumn('first_operator_id'),
  firstOrgId: idColumn('first_org_id'),
  appUrl: text('app_url'),
  /** Highest install-run step that succeeded (0 to 6); 20261006090000_inst_setup_run_progress.sql. */
  runStep: smallint('run_step').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  rowVersion: rowVersion(),
});
