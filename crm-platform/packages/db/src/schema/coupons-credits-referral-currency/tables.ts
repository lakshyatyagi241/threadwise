/**
 * coupons-credits-referral-currency: tables ported from WaDesk. Mirrors migrations/20261001100500_cpn_wadesk_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import { sql } from 'drizzle-orm';
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
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
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
    applicablePackageIds: jsonb('applicable_package_ids'),
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
    referrerOrgId: idColumn('referrer_org_id').notNull(),
    referredOrgId: idColumn('referred_org_id').notNull(),
    codeUsed: text('code_used').notNull(),
    creditsAwarded: integer('credits_awarded').notNull().default(0),
    awardTransactionId: idColumn('award_transaction_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    unique('uq_referrals_referred_user_id').on(t.referredUserId),
    index('idx_referrals_code_used').on(t.codeUsed),
    index('idx_referrals_referrer_user_id').on(t.referrerUserId),
    foreignKey({
      name: 'fk_referrals_referrer_org_id',
      columns: [t.referrerOrgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_referrals_referred_org_id',
      columns: [t.referredOrgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check('chk_referrals_not_self', sql`${t.referrerUserId} <> ${t.referredUserId}`),
    check('chk_referrals_credits_nonneg', sql`${t.creditsAwarded} >= 0`),
    index('idx_referrals_referrer_history').on(
      t.referrerOrgId,
      t.referrerUserId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index('idx_referrals_referred_org_unpaid')
      .on(t.referredOrgId)
      .where(sql`${t.awardTransactionId} IS NULL`),
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
    unique('uq_referral_codes_owner_user').on(t.ownerOrgId, t.userId),
    foreignKey({
      name: 'fk_referral_codes_owner_org_id',
      columns: [t.ownerOrgId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),
  ],
);

export type ReferralCodesRow = typeof referralCodes.$inferSelect;
export type NewReferralCodesRow = typeof referralCodes.$inferInsert;

/**
 * One row per redeemed order: the guard that makes counting a redemption idempotent (migration 20261017090100). The composite
 * foreign key to `orders` lives in the SQL only: the paygw schema already imports this file (orders.coupon_id), so mirroring it
 * here would be a circular import.
 */
export const couponRedemptions = pgTable(
  'coupon_redemptions',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    orderId: idColumn('order_id').notNull(),
    couponId: idColumn('coupon_id'),
    couponCode: text('coupon_code').notNull(),
    userId: idColumn('user_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('coupon_redemptions_org_id_uuid_key').on(t.orgId, t.uuid),
    unique('uq_coupon_redemptions_order').on(t.orgId, t.orderId),
    index('idx_coupon_redemptions_coupon').on(t.couponId),
    foreignKey({
      name: 'coupon_redemptions_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'coupon_redemptions_coupon_id_fkey',
      columns: [t.couponId],
      foreignColumns: [coupons.id],
    }).onDelete('set null'),
  ],
);

export type CouponRedemptionsRow = typeof couponRedemptions.$inferSelect;
export type NewCouponRedemptionsRow = typeof couponRedemptions.$inferInsert;
