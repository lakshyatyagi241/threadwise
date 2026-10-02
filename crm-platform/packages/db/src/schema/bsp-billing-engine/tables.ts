/**
 * bsp-billing-engine: tables ported from Reference. Mirrors migrations/20261001100800_bsp_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
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
    /** The platform operator who attached it; null when the sweep did, or the operator was deleted. */
    createdByOperatorId: bigint('created_by_operator_id', { mode: 'number' }),
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
    unique('uq_bsp_credit_allocations_org_waba').on(t.orgId, t.wabaId),
    check(
      'chk_bsp_credit_allocations_status',
      sql`${t.status} in ('attached', 'revoked', 'failed')`,
    ),
    check(
      'chk_bsp_credit_allocations_source',
      sql`${t.creditSource} is null or ${t.creditSource} in ('meta', 'aggregator')`,
    ),
    check(
      'chk_bsp_credit_allocations_currency',
      sql`${t.currency} = upper(${t.currency}) and length(${t.currency}) between 1 and 8`,
    ),
    index('idx_bsp_credit_allocations_listing').on(t.createdAt.desc(), t.id.desc()),
  ],
);

export type BspCreditAllocationsRow = typeof bspCreditAllocations.$inferSelect;
export type NewBspCreditAllocationsRow = typeof bspCreditAllocations.$inferInsert;
