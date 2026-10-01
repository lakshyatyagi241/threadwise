import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';

/**
 * Mirror of 20261002090000_plan_core.sql. The SQL is the source of truth; this
 * file exists so queries are typed. Money columns are `numeric`, which drizzle
 * returns as a string: keep it a string end to end.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true });

export type PlanBillingUnit = 'days' | 'weeks' | 'months' | 'years';

/** Platform catalogue (no org_id). Readable by every transaction, writable only when privileged. */
export const plans = pgTable(
  'plans',
  {
    id: idColumn('id').primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom().unique(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    subtitle: text('subtitle'),
    detail: text('detail'),
    kind: text('kind').$type<'plan' | 'addon'>().notNull().default('plan'),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull().default('0'),
    offerAmount: numeric('offer_amount', { precision: 12, scale: 2 }),
    currency: text('currency').notNull().default('USD'),
    billingUnit: text('billing_unit').$type<PlanBillingUnit>().notNull().default('months'),
    billingDuration: integer('billing_duration').notNull().default(1),
    isFree: boolean('is_free').notNull().default(false),
    isLifetime: boolean('is_lifetime').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    isHighlighted: boolean('is_highlighted').notNull().default(false),
    isCustomQuote: boolean('is_custom_quote').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    ctaLabel: text('cta_label').notNull().default('Get started'),
    /** Numeric caps; 0 = unlimited. */
    limits: jsonb('limits').$type<Record<string, number>>().notNull().default({}),
    /** Boolean capability flags. */
    features: jsonb('features').$type<Record<string, boolean>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    index('idx_plans_listing').on(t.kind, t.isActive, t.sortOrder, t.amount),
    uniqueIndex('uq_plans_single_default')
      .on(sql`(true)`)
      .where(sql`${t.isDefault}`),
  ],
);

/** Per-organization plan state; `organizations.plan` stays the authoritative slug. */
export const orgPlanState = pgTable('org_plan_state', {
  orgId: orgIdColumn().primaryKey(),
  trialEndsAt: ts('trial_ends_at'),
  planEndsAt: ts('plan_ends_at'),
  billingCycle: text('billing_cycle')
    .$type<'trial' | 'monthly' | 'yearly'>()
    .notNull()
    .default('monthly'),
  overrides: jsonb('overrides')
    .$type<{ limits?: Record<string, number>; features?: Record<string, boolean> }>()
    .notNull()
    .default({}),
  platformOwned: boolean('platform_owned').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  rowVersion: rowVersion(),
});
