/**
 * wallet-message-billing: tables ported from Reference. Mirrors migrations/20261001100300_wallet_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
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
    currency: text('currency'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [unique('uq_message_rates_country_code_category').on(t.countryCode, t.category)],
);

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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
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
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt] }),
    check('chk_usage_charges_status', sql`${t.status} in ('free', 'charged', 'refunded')`),
    index('idx_usage_charges_status').on(t.orgId, t.status),
    index('idx_usage_charges_user_id').on(t.orgId, t.userId),
    index('idx_usage_charges_created_at').on(t.orgId, t.createdAt),
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
