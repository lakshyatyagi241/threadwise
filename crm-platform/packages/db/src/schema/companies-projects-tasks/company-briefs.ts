/**
 * company_briefs: the AI "Generate brief" of a company, one per company and person (BL-194). Mirrors
 * migrations/20261222090100_company_briefs.sql; the SQL migration is the source of truth.
 */
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { companies } from '../crm';
import { organizations, users } from '../foundation';

export const companyBriefs = pgTable(
  'company_briefs',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    companyId: idColumn('company_id').notNull(),
    userId: idColumn('user_id').notNull(),
    inputHash: text('input_hash').notNull(),
    content: jsonb('content').notNull().$type<Record<string, unknown>>(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('company_briefs_org_id_uuid_key').on(t.orgId, t.uuid),
    unique('uq_company_briefs_company_user').on(t.orgId, t.companyId, t.userId),
    foreignKey({
      name: 'company_briefs_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_company_briefs_company',
      columns: [t.orgId, t.companyId],
      foreignColumns: [companies.orgId, companies.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_company_briefs_user',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
    index('idx_company_briefs_user').on(t.orgId, t.userId),
  ],
);

export type CompanyBriefsRow = typeof companyBriefs.$inferSelect;
export type NewCompanyBriefsRow = typeof companyBriefs.$inferInsert;
