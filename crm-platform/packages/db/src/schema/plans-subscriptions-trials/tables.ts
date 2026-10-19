/**
 * plans-subscriptions-trials: tables ported from Reference. Mirrors migrations/20261001100200_plan_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';

export const planUsage = pgTable(
  'plan_usage',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    metric: text('metric').notNull(),
    period: text('period').notNull(),
    count: integer('count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_plan_usage_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_plan_usage_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_plan_usage_metric_period').on(t.orgId, t.metric, t.period),
  ],
);

export type PlanUsageRow = typeof planUsage.$inferSelect;
export type NewPlanUsageRow = typeof planUsage.$inferInsert;

export const subscriptions = pgTable(
  'subscriptions',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    planId: text('plan_id'),
    /** 'plan' renews the workspace plan; 'addon' renews one add-on purchase (`workspaceAddonId`). */
    kind: text('kind').$type<'plan' | 'addon'>().notNull().default('plan'),
    workspaceAddonId: idColumn('workspace_addon_id'),
    gateway: text('gateway').notNull(),
    gatewaySubscriptionId: text('gateway_subscription_id'),
    gatewayPlanId: text('gateway_plan_id'),
    gatewayCustomerId: text('gateway_customer_id'),
    billingCycle: text('billing_cycle').notNull().default('monthly'),
    status: text('status').notNull().default('pending'),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull().default('0.00'),
    currency: text('currency').notNull().default('USD'),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    renewalsCount: integer('renewals_count').notNull().default(0),
    meta: jsonb('meta'),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_subscriptions_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_subscriptions_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_subscriptions_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_subscriptions_gateway_gateway_subscription_id').on(
      t.orgId,
      t.gateway,
      t.gatewaySubscriptionId,
    ),
    index('idx_subscriptions_gateway_subscription_id').on(t.orgId, t.gatewaySubscriptionId),
    index('idx_subscriptions_user_id').on(t.orgId, t.userId),
    index('idx_subscriptions_status').on(t.orgId, t.status),
    index('idx_subscriptions_org_kind_status').on(t.orgId, t.kind, t.status),
  ],
);

export type SubscriptionsRow = typeof subscriptions.$inferSelect;
export type NewSubscriptionsRow = typeof subscriptions.$inferInsert;
