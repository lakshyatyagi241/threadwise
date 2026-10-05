/**
 * wallet-message-billing: tables ported from WaDesk. Mirrors migrations/20261001100300_wallet_wadesk_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  check,
  date,
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
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { platformOperators } from '../auth-registration-security/core';
import { organizations, users } from '../foundation';

export const messageRates = pgTable(
  'message_rates',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    countryCode: text('country_code').notNull().default(''),
    category: text('category').notNull().default(''),
    credits: integer('credits').notNull().default(1),
    metaCostMinor: bigint('meta_cost_minor', { mode: 'number' }),
    metaCostMicros: bigint('meta_cost_micros', { mode: 'number' }),
    currency: text('currency'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    unique('uq_message_rates_country_code_category').on(t.countryCode, t.category),
    check('chk_message_rates_country', sql`${t.countryCode} ~ '^([A-Z]{2})?$'`),
    check(
      'chk_message_rates_category',
      sql`${t.category} in ('', 'marketing', 'utility', 'authentication', 'service')`,
    ),
    check(
      'chk_message_rates_amounts',
      sql`${t.credits} >= 0 and (${t.metaCostMicros} is null or ${t.metaCostMicros} >= 0)`,
    ),
  ],
);

/** Meta's published list price per (currency, market, category). Mirrors migrations/20261025090000_wallet_meta_rate_cards.sql. */
export const metaRateCards = pgTable(
  'meta_rate_cards',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    currency: text('currency').notNull(),
    market: text('market').notNull(),
    category: text('category').notNull(),
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull(),
    effectiveOn: date('effective_on').notNull(),
    sourceLabel: text('source_label').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_meta_rate_cards_key').on(t.currency, t.market, t.category),
    check('chk_meta_rate_cards_currency', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      'chk_meta_rate_cards_category',
      sql`${t.category} in ('marketing', 'utility', 'authentication', 'authentication_international', 'service')`,
    ),
    check('chk_meta_rate_cards_cost', sql`${t.costMicros} >= 0`),
  ],
);

export type MetaRateCardsRow = typeof metaRateCards.$inferSelect;
export type NewMetaRateCardsRow = typeof metaRateCards.$inferInsert;

export type MessageRatesRow = typeof messageRates.$inferSelect;
export type NewMessageRatesRow = typeof messageRates.$inferInsert;

export const walletTransactions = pgTable(
  'wallet_transactions',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    kind: text('kind').notNull(),
    type: text('type').notNull(),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    balanceAfter: numeric('balance_after', { precision: 20, scale: 4 }).notNull(),
    source: text('source'),
    subjectType: text('subject_type'),
    subjectId: idColumn('subject_id'),
    description: text('description'),
    meta: jsonb('meta'),
    idempotencyKey: text('idempotency_key').notNull(),
    /** The currency of the wallet this entry moved (a workspace can hold a wallet per currency). */
    unit: text('unit'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
    direction: text('direction').notNull(),
    note: text('note'),
    actorType: text('actor_type').notNull().default('system'),
    actorLabel: text('actor_label'),
    operatorId: bigint('operator_id', { mode: 'number' }).references(() => platformOperators.id, {
      onDelete: 'set null',
    }),
    requestId: text('request_id'),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wallet_transactions_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wallet_transactions_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_wallet_transactions_idempotency_key').on(t.orgId, t.idempotencyKey),
    foreignKey({
      name: 'fk_wallet_transactions_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_wallet_transactions_kind_source').on(t.orgId, t.kind, t.source),
    index('idx_wallet_transactions_subject_type_subject_id').on(
      t.orgId,
      t.subjectType,
      t.subjectId,
    ),
    index('idx_wallet_transactions_user_id_created_at').on(t.orgId, t.userId, t.createdAt),
    index('idx_wallet_transactions_org_created').on(t.orgId, t.createdAt.desc(), t.id.desc()),
    check('chk_wallet_transactions_kind', sql`${t.kind} = 'credit'`),
    check(
      'chk_wallet_transactions_type',
      sql`${t.type} in ('earn', 'spend', 'refund', 'admin_adjust', 'topup')`,
    ),
    check(
      'chk_wallet_transactions_direction',
      sql`(${t.direction} = 'in' and ${t.amount} > 0) or (${t.direction} = 'out' and ${t.amount} < 0)`,
    ),
    check(
      'chk_wallet_transactions_actor_type',
      sql`${t.actorType} in ('user', 'platform_operator', 'system')`,
    ),
    check(
      'chk_wallet_transactions_adjust_note',
      sql`${t.type} <> 'admin_adjust' or (length(btrim(coalesce(${t.note}, ''))) >= 5 and length(btrim(coalesce(${t.actorLabel}, ''))) > 0 and ${t.actorType} = 'platform_operator')`,
    ),
  ],
);

export type WalletTransactionsRow = typeof walletTransactions.$inferSelect;
export type NewWalletTransactionsRow = typeof walletTransactions.$inferInsert;

export const usageCharges = pgTable(
  'usage_charges',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('usage_charges_id_seq')`),
    orgId: orgIdColumn(),
    userId: idColumn('user_id'),
    provider: text('provider'),
    wamid: text('wamid').notNull(),
    toCountry: text('to_country'),
    category: text('category'),
    source: text('source'),
    credits: integer('credits').notNull().default(0),
    revenueMinor: bigint('revenue_minor', { mode: 'number' }).notNull().default(0),
    costMinor: bigint('cost_minor', { mode: 'number' }),
    status: text('status').notNull().default('charged'),
    walletTxId: idColumn('wallet_tx_id'),
    meta: text('meta'),
    createdAt: createdAt(),
    priceCredits: integer('price_credits').notNull().default(0),
    /** The currency the message was priced and charged in; null = the platform currency (rows from before per-currency billing). */
    currency: text('currency'),
    shortfallCredits: integer('shortfall_credits').notNull().default(0),
    billingMode: text('billing_mode').notNull().default('plan'),
    freeReason: text('free_reason'),
    costMicros: bigint('cost_micros', { mode: 'number' }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    refundTxId: idColumn('refund_tx_id'),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt] }),
    check('chk_usage_charges_status', sql`${t.status} in ('free', 'charged', 'refunded')`),
    index('idx_usage_charges_status').on(t.orgId, t.status),
    index('idx_usage_charges_user_id').on(t.orgId, t.userId),
    index('idx_usage_charges_created_at').on(t.orgId, t.createdAt),
    index('idx_usage_charges_wallet_tx')
      .on(t.orgId, t.walletTxId)
      .where(sql`${t.walletTxId} is not null`),
    check(
      'chk_usage_charges_amounts',
      sql`${t.credits} >= 0 and ${t.priceCredits} >= 0 and ${t.shortfallCredits} >= 0 and ${t.revenueMinor} >= 0`,
    ),
    check('chk_usage_charges_mode', sql`${t.billingMode} in ('plan', 'wallet')`),
    check(
      'chk_usage_charges_free_reason',
      sql`${t.freeReason} is null or ${t.freeReason} in ('rate_is_zero', 'within_plan_free_quota', 'no_wallet_owner', 'wallet_empty')`,
    ),
  ],
);

export type UsageChargesRow = typeof usageCharges.$inferSelect;
export type NewUsageChargesRow = typeof usageCharges.$inferInsert;

export const wallets = pgTable(
  'wallets',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    unit: text('unit').notNull(),
    balance: numeric('balance', { precision: 20, scale: 4 }).notNull().default('0'),
    reserved: numeric('reserved', { precision: 20, scale: 4 }).notNull().default('0'),
    lowBalanceAlertedAt: timestamp('low_balance_alerted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wallets_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wallets_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check(
      'chk_wallet_invariant',
      sql.raw('balance >= 0 AND reserved >= 0 AND reserved <= balance'),
    ),
    unique('uq_wallets_unit').on(t.orgId, t.unit),
  ],
);

export type WalletsRow = typeof wallets.$inferSelect;
export type NewWalletsRow = typeof wallets.$inferInsert;

export const usageChargeKeys = pgTable(
  'usage_charge_keys',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    providerMessageId: text('provider_message_id').notNull(),
    chargeId: idColumn('charge_id'),
    chargeCreatedAt: timestamp('charge_created_at', { withTimezone: true }),
    status: text('status').notNull().default('charged'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_usage_charge_keys_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_usage_charge_keys_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_usage_charge_keys_message').on(t.orgId, t.providerMessageId),
    check('chk_usage_charge_keys_status', sql`${t.status} in ('free', 'charged', 'refunded')`),
    check('chk_usage_charge_keys_message', sql`length(btrim(${t.providerMessageId})) > 0`),
  ],
);

export type UsageChargeKeysRow = typeof usageChargeKeys.$inferSelect;

export const walletUsageMonths = pgTable(
  'wallet_usage_months',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    month: date('month').notNull(),
    messages: integer('messages').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wallet_usage_months_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wallet_usage_months_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_wallet_usage_months_month').on(t.orgId, t.month),
    check(
      'chk_wallet_usage_months_first_day',
      sql`${t.month} = date_trunc('month', ${t.month})::date`,
    ),
    check('chk_wallet_usage_months_messages', sql`${t.messages} >= 0`),
  ],
);

export type WalletUsageMonthsRow = typeof walletUsageMonths.$inferSelect;

export const walletEvents = pgTable(
  'wallet_events',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    event: text('event').notNull(),
    severity: text('severity').notNull().default('info'),
    actorType: text('actor_type').notNull().default('system'),
    actorLabel: text('actor_label'),
    subjectType: text('subject_type'),
    subjectId: idColumn('subject_id'),
    message: text('message').notNull(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    requestId: text('request_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wallet_events_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wallet_events_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    index('idx_wallet_events_org_created').on(t.orgId, t.createdAt.desc(), t.id.desc()),
    index('idx_wallet_events_event').on(t.event, t.createdAt.desc()),
    index('idx_wallet_events_created').on(t.createdAt.desc(), t.id.desc()),
    check('chk_wallet_events_severity', sql`${t.severity} in ('info', 'warning', 'error')`),
    check(
      'chk_wallet_events_actor_type',
      sql`${t.actorType} in ('user', 'platform_operator', 'system')`,
    ),
  ],
);

export type WalletEventsRow = typeof walletEvents.$inferSelect;

export const walletPlatformLog = pgTable(
  'wallet_platform_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    event: text('event').notNull(),
    severity: text('severity').notNull().default('info'),
    actorType: text('actor_type').notNull().default('platform_operator'),
    actorLabel: text('actor_label'),
    operatorId: bigint('operator_id', { mode: 'number' }).references(() => platformOperators.id, {
      onDelete: 'set null',
    }),
    message: text('message').notNull(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    requestId: text('request_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_wallet_platform_log_created').on(t.createdAt.desc(), t.id.desc()),
    index('idx_wallet_platform_log_event').on(t.event, t.createdAt.desc()),
    check('chk_wallet_platform_log_severity', sql`${t.severity} in ('info', 'warning', 'error')`),
  ],
);

export type WalletPlatformLogRow = typeof walletPlatformLog.$inferSelect;

export const planMessageMargins = pgTable(
  'plan_message_margins',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    planSlug: text('plan_slug').notNull().default(''),
    countryCode: text('country_code').notNull().default(''),
    category: text('category').notNull().default(''),
    marginBps: integer('margin_bps').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    unique('uq_plan_message_margins_key').on(t.planSlug, t.countryCode, t.category),
    check('chk_plan_message_margins_country', sql`${t.countryCode} ~ '^([A-Z]{2})?$'`),
    check(
      'chk_plan_message_margins_category',
      sql`${t.category} in ('', 'marketing', 'utility', 'authentication', 'service')`,
    ),
    check('chk_plan_message_margins_bps', sql`${t.marginBps} between -10000 and 100000`),
  ],
);

export type PlanMessageMarginsRow = typeof planMessageMargins.$inferSelect;

export const workspaceMessageMargins = pgTable(
  'workspace_message_margins',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    countryCode: text('country_code').notNull().default(''),
    category: text('category').notNull().default(''),
    marginBps: integer('margin_bps').notNull(),
    note: text('note').notNull(),
    setBy: text('set_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_workspace_message_margins_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_workspace_message_margins_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_workspace_message_margins_key').on(t.orgId, t.countryCode, t.category),
    check('chk_workspace_message_margins_country', sql`${t.countryCode} ~ '^([A-Z]{2})?$'`),
    check(
      'chk_workspace_message_margins_category',
      sql`${t.category} in ('', 'marketing', 'utility', 'authentication', 'service')`,
    ),
    check('chk_workspace_message_margins_bps', sql`${t.marginBps} between -10000 and 100000`),
    check('chk_workspace_message_margins_note', sql`length(btrim(${t.note})) >= 5`),
  ],
);

export type WorkspaceMessageMarginsRow = typeof workspaceMessageMargins.$inferSelect;
