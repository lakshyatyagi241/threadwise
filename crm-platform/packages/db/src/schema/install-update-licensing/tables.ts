import { pgTable, smallint, text, timestamp } from 'drizzle-orm/pg-core';
import { createdAt, idColumn, rowVersion, updatedAt } from '../columns';

/**
 * Mirror of 20261003090000_inst_platform_setup.sql. The SQL is the source of truth; this file exists so queries
 * are typed. Platform-wide singleton (id is always 1): the first-run lock.
 */
export const platformSetup = pgTable('platform_setup', {
  id: smallint('id').primaryKey().default(1),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  completedVersion: text('completed_version'),
  firstOperatorId: idColumn('first_operator_id'),
  firstOrgId: idColumn('first_org_id'),
  appUrl: text('app_url'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  rowVersion: rowVersion(),
});
