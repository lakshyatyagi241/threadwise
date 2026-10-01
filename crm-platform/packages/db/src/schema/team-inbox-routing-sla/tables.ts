/**
 * team-inbox-routing-sla: tables ported from WaDesk. Mirrors migrations/20261001102700_tib2_wadesk_schema.sql.
 * The SQL migration is the source of truth (ADR-0004); `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';

export const agentStatuses = pgTable(
  'agent_statuses',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    status: text('status').notNull().default('online'),
    statusMessage: text('status_message'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    currentLoad: integer('current_load').notNull().default(0),
    todayReplies: integer('today_replies').notNull().default(0),
    todayResolutions: integer('today_resolutions').notNull().default(0),
    countersDate: date('counters_date'),
    preferences: jsonb('preferences'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_agent_statuses_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_agent_statuses_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_agent_statuses_user_id').on(t.orgId, t.userId),
    foreignKey({
      name: 'fk_agent_statuses_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_agent_statuses_last_seen_at').on(t.orgId, t.lastSeenAt),
  ],
);

export type AgentStatusesRow = typeof agentStatuses.$inferSelect;
export type NewAgentStatusesRow = typeof agentStatuses.$inferInsert;

export const routingRules = pgTable(
  'routing_rules',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    name: text('name').notNull(),
    conditions: jsonb('conditions').notNull(),
    actions: jsonb('actions').notNull(),
    stopOnMatch: boolean('stop_on_match').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    isFallback: boolean('is_fallback').notNull().default(false),
    sort: integer('sort').notNull().default(0),
    firedCount: bigint('fired_count', { mode: 'number' }).notNull().default(0),
    lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_routing_rules_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_routing_rules_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    index('idx_routing_rules_is_fallback').on(t.orgId, t.isFallback),
    index('idx_routing_rules_is_active_sort').on(t.orgId, t.isActive, t.sort),
  ],
);

export type RoutingRulesRow = typeof routingRules.$inferSelect;
export type NewRoutingRulesRow = typeof routingRules.$inferInsert;

export const slaPolicies = pgTable(
  'sla_policies',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    name: text('name').notNull(),
    firstResponseMinutes: integer('first_response_minutes'),
    resolutionMinutes: integer('resolution_minutes'),
    pauseWhenWaitingOnCustomer: boolean('pause_when_waiting_on_customer').notNull().default(true),
    respectBusinessHours: boolean('respect_business_hours').notNull().default(true),
    deviceIds: jsonb('device_ids'),
    priorityOverrides: jsonb('priority_overrides'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_sla_policies_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_sla_policies_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    index('idx_sla_policies_is_default').on(t.orgId, t.isDefault),
  ],
);

export type SlaPoliciesRow = typeof slaPolicies.$inferSelect;
export type NewSlaPoliciesRow = typeof slaPolicies.$inferInsert;

export const slaBreaches = pgTable(
  'sla_breaches',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    ticketId: idColumn('ticket_id').notNull(),
    slaPolicyId: idColumn('sla_policy_id'),
    breachType: text('breach_type').notNull(),
    breachedAt: timestamp('breached_at', { withTimezone: true }).notNull().defaultNow(),
    severity: text('severity').notNull().default('warn'),
    overByMinutes: integer('over_by_minutes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_sla_breaches_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_sla_breaches_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_sla_breaches_sla_policy_id',
      columns: [t.orgId, t.slaPolicyId],
      foreignColumns: [slaPolicies.orgId, slaPolicies.id],
    }).onDelete('cascade'),
    index('idx_sla_breaches_sla_policy_id').on(t.orgId, t.slaPolicyId),
    index('idx_sla_breaches_ticket_id_breach_type').on(t.orgId, t.ticketId, t.breachType),
  ],
);

export type SlaBreachesRow = typeof slaBreaches.$inferSelect;
export type NewSlaBreachesRow = typeof slaBreaches.$inferInsert;
