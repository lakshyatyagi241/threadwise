/**
 * bsp-billing-engine: tables ported from WaDesk. Mirrors migrations/20261001100800_bsp_wadesk_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations } from '../foundation';

export const bspCreditAllocations = pgTable(
  'bsp_credit_allocations',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    wabaId: text('waba_id').notNull(),
    allocationConfigId: text('allocation_config_id'),
    creditSource: text('credit_source'),
    currency: text('currency').notNull().default('USD'),
    status: text('status').notNull().default('attached'),
    lastError: text('last_error'),
    attachedAt: timestamp('attached_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_bsp_credit_allocations_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_bsp_credit_allocations_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    index('idx_bsp_credit_allocations_waba_id').on(t.orgId, t.wabaId),
  ],
);

export type BspCreditAllocationsRow = typeof bspCreditAllocations.$inferSelect;
export type NewBspCreditAllocationsRow = typeof bspCreditAllocations.$inferInsert;
