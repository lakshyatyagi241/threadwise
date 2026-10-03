import { sql, type SQL } from 'drizzle-orm';
import type { CouponItem } from '@crm/contracts';
import type { CouponFacts } from './coupon-rules';

/** A `coupons` row as `tx.execute` returns it (snake_case; numeric as text; timestamps as Date or string). */
export interface CouponRow {
  id: string | number;
  uuid: string;
  code: string;
  description: string | null;
  admin_note: string | null;
  type: 'percent' | 'fixed';
  amount: string;
  currency_code: string | null;
  max_discount_amount: string | null;
  min_order_amount: string | null;
  max_uses: number | null;
  per_user_limit: number | null;
  uses_count: number;
  applicable_package_ids: unknown;
  starts_at: string | Date | null;
  expires_at: string | Date | null;
  is_active: boolean;
  first_purchase_only: boolean;
  stackable_with_other: boolean;
  is_expired: boolean;
  created_at: string | Date;
  updated_at: string | Date;
  row_version: number;
}

/** Every column the screens read, once. `is_expired` is the database clock, so every viewer and every replica agree. */
export const COUPON_COLUMNS: SQL = sql.raw(
  `id, uuid, code, description, admin_note, type, amount::text AS amount, currency_code,
   max_discount_amount::text AS max_discount_amount, min_order_amount::text AS min_order_amount,
   max_uses, per_user_limit, uses_count, applicable_package_ids, starts_at, expires_at, is_active,
   first_purchase_only, stackable_with_other, (expires_at IS NOT NULL AND expires_at < now()) AS is_expired,
   created_at, updated_at, row_version`,
);

const iso = (v: string | Date): string => new Date(v).toISOString();

/** "10.0000" -> "10", "12.5000" -> "12.5": WaDesk showed a percent as a trimmed number. */
export function trimDecimal(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') || '0' : value;
}

export function planSlugs(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : [];
}

export function toCouponItem(row: CouponRow): CouponItem {
  return {
    id: row.uuid,
    code: row.code,
    description: row.description,
    adminNote: row.admin_note,
    type: row.type,
    amount: trimDecimal(row.amount),
    maxDiscountAmount:
      row.max_discount_amount === null ? null : trimDecimal(row.max_discount_amount),
    currencyCode: row.currency_code,
    minOrderAmount: row.min_order_amount === null ? null : trimDecimal(row.min_order_amount),
    maxUses: row.max_uses,
    perUserLimit: row.per_user_limit,
    usesCount: row.uses_count,
    applicablePlans: planSlugs(row.applicable_package_ids),
    startsAt: row.starts_at === null ? null : iso(row.starts_at),
    expiresAt: row.expires_at === null ? null : iso(row.expires_at),
    isActive: row.is_active,
    firstPurchaseOnly: row.first_purchase_only,
    stackableWithOther: row.stackable_with_other,
    isExpired: row.is_expired,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    rowVersion: row.row_version,
  };
}

export function toCouponFacts(row: CouponRow): CouponFacts {
  return {
    id: Number(row.id),
    code: row.code,
    type: row.type,
    amount: row.amount,
    maxDiscountAmount: row.max_discount_amount,
    currencyCode: row.currency_code,
    minOrderAmount: row.min_order_amount,
    maxUses: row.max_uses,
    perUserLimit: row.per_user_limit,
    usesCount: row.uses_count,
    applicablePlans: planSlugs(row.applicable_package_ids),
    startsAt: row.starts_at === null ? null : new Date(row.starts_at),
    expiresAt: row.expires_at === null ? null : new Date(row.expires_at),
    isActive: row.is_active,
    firstPurchaseOnly: row.first_purchase_only,
    stackableWithOther: row.stackable_with_other,
  };
}
