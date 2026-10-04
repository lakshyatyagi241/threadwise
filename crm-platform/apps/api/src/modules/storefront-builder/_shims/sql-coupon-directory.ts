import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { CouponDirectory, CouponRecord } from './tokens';

interface RawCoupon {
  id: number | string;
  code: string;
  type: string;
  amount: number | string;
  min_subtotal_minor: number | string | null;
  max_discount_minor: number | string | null;
  free_shipping: boolean;
  active: boolean;
  starts_at: Date | string | null;
  expires_at: Date | string | null;
  usage_limit: number | null;
  used_count: number;
}

const num = (v: number | string | null): number | null => (v === null ? null : Number(v));
const date = (v: Date | string | null): Date | null => (v === null ? null : new Date(v));

/** Reads `wa_coupons` directly until checkout-orders-merchant-payments (CHK) exports its coupon service. */
@Injectable()
export class SqlCouponDirectory implements CouponDirectory {
  async resolve(
    tx: Tx,
    orgId: number,
    storefrontId: number,
    code: string,
    opts: { lock?: boolean } = {},
  ): Promise<CouponRecord | null> {
    const trimmed = code.trim();
    if (!trimmed) return null;
    const res = await tx.execute(sql`
      SELECT id, code, type, amount, min_subtotal_minor, max_discount_minor, free_shipping, active, starts_at, expires_at,
             usage_limit, used_count
      FROM wa_coupons
      WHERE org_id = ${orgId} AND lower(code) = lower(${trimmed}) AND active
        AND (storefront_id IS NULL OR storefront_id = ${storefrontId})
      ORDER BY id
      LIMIT 1
      ${opts.lock ? sql`FOR UPDATE` : sql``}`);
    const r = res.rows[0] as unknown as RawCoupon | undefined;
    if (!r) return null;
    return {
      id: Number(r.id),
      code: r.code,
      type: r.type,
      amount: Number(r.amount),
      minSubtotalMinor: num(r.min_subtotal_minor),
      maxDiscountMinor: num(r.max_discount_minor),
      freeShipping: r.free_shipping,
      active: r.active,
      startsAt: date(r.starts_at),
      expiresAt: date(r.expires_at),
      usageLimit: r.usage_limit,
      usedCount: Number(r.used_count),
    };
  }

  async increment(tx: Tx, orgId: number, couponId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE wa_coupons SET used_count = used_count + 1 WHERE org_id = ${orgId} AND id = ${couponId}`,
    );
  }
}
