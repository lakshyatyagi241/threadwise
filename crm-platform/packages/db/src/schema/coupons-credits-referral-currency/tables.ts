/**
 * coupons-credits-referral-currency: tables ported from Reference. Mirrors migrations/20261001100500_cpn_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, rowVersion, updatedAt } from '../columns';
import { organizations } from '../foundation';

export const coupons = pgTable(
  'coupons',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    code: text('code').notNull(),
    description: text('description'),
    adminNote: text('admin_note'),
    type: text('type').notNull().default('percent'),
    amount: numeric('amount', { precision: 12, scale: 4 }).notNull().default('0.0000'),
    currencyCode: text('currency_code'),
    maxDiscountAmount: numeric('max_discount_amount', { precision: 14, scale: 4 }),
    minOrderAmount: numeric('min_order_amount', { precision: 12, scale: 4 }),
    maxUses: integer('max_uses'),
    perUserLimit: integer('per_user_limit'),
    usesCount: integer('uses_count').notNull().default(0),
    applicablePlanSlugs: text('applicable_plan_slugs').array().notNull().default([]),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    firstPurchaseOnly: boolean('first_purchase_only').notNull().default(false),
    stackableWithOther: boolean('stackable_with_other').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    unique('uq_coupons_code').on(t.code),
    index('idx_coupons_is_active_expires_at').on(t.isActive, t.expiresAt),
  ],
);

export type CouponsRow = typeof coupons.$inferSelect;
export type NewCouponsRow = typeof coupons.$inferInsert;

export const creditPackages = pgTable(
  'credit_packages',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    priceMinor: bigint('price_minor', { mode: 'number' }).notNull(),
    currencyCode: text('currency_code').notNull().default('INR'),
    credits: bigint('credits', { mode: 'number' }).notNull(),
    badge: text('badge'),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    isFeatured: boolean('is_featured').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    unique('uq_credit_packages_slug').on(t.slug),
    index('idx_credit_packages_is_active_sort_order').on(t.isActive, t.sortOrder),
  ],
);

export type CreditPackagesRow = typeof creditPackages.$inferSelect;
export type NewCreditPackagesRow = typeof creditPackages.$inferInsert;

export const currencies = pgTable(
  'currencies',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    symbol: text('symbol'),
    precision: smallint('precision').notNull().default(2),
    exchangeRate: numeric('exchange_rate', { precision: 16, scale: 6 })
      .notNull()
      .default('1.000000'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    unique('uq_currencies_code').on(t.code),
    index('idx_currencies_is_active_code').on(t.isActive, t.code),
  ],
);

export type CurrenciesRow = typeof currencies.$inferSelect;
export type NewCurrenciesRow = typeof currencies.$inferInsert;

export const referrals = pgTable(
  'referrals',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    referrerUserId: idColumn('referrer_user_id').notNull(),
    referredUserId: idColumn('referred_user_id').notNull(),
    codeUsed: text('code_used').notNull(),
    referrerOrgId: idColumn('referrer_org_id').notNull(),
    referredOrgId: idColumn('referred_org_id').notNull(),
    creditsAwarded: bigint('credits_awarded', { mode: 'number' }).notNull().default(0),
    awardTransactionId: idColumn('award_transaction_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    unique('uq_referrals_referred').on(t.referredOrgId, t.referredUserId),
    index('idx_referrals_code_used').on(t.codeUsed),
    index('idx_referrals_referrer').on(t.referrerOrgId, t.referrerUserId, t.createdAt),
  ],
);

export type ReferralsRow = typeof referrals.$inferSelect;
export type NewReferralsRow = typeof referrals.$inferInsert;

export const referralCodes = pgTable(
  'referral_codes',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    ownerOrgId: idColumn('owner_org_id').notNull(),
    userId: idColumn('user_id').notNull(),
    code: text('code').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    unique('uq_referral_codes_code').on(t.code),
    unique('uq_referral_codes_user').on(t.ownerOrgId, t.userId),
    foreignKey({
      name: 'fk_referral_codes_owner_org_id',
      columns: [t.ownerOrgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
  ],
);

export type ReferralCodesRow = typeof referralCodes.$inferSelect;
export type NewReferralCodesRow = typeof referralCodes.$inferInsert;
