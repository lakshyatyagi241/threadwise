import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { PlatformStore } from '../auth';
import {
  COUPON_MESSAGES,
  normalizeCouponCode,
  resolveCoupon,
  type BuyerFacts,
  type CouponFacts,
} from './coupon-rules';

export interface CouponRequest {
  code: string;
  orgId: number;
  /** The buyer: first-purchase and per-user rules need them (null = skip those rules, as Reference's 3-argument callers). */
  userId: number | null;
  planSlug: string;
  /** The price the coupon applies to, in the order currency, before tax. */
  subtotalMinor: bigint;
  currency: string;
  otherCoupons?: readonly string[];
}

export type CouponDecision =
  | {
      ok: true;
      message: string;
      couponId: number;
      /** The canonical (upper-case) code, snapshotted on the order. */
      code: string;
      discountMinor: bigint;
    }
  | { ok: false; message: string };

interface CouponRow {
  id: string;
  code: string;
  type: 'percent' | 'fixed';
  amount: string;
  max_discount_amount: string | null;
  min_order_amount: string | null;
  currency_code: string | null;
  max_uses: number | null;
  uses_count: number;
  per_user_limit: number | null;
  applicable_plan_slugs: string[];
  starts_at: string | Date | null;
  expires_at: string | Date | null;
  is_active: boolean;
  first_purchase_only: boolean;
  stackable_with_other: boolean;
}

const toFacts = (r: CouponRow): CouponFacts => ({
  id: Number(r.id),
  code: r.code,
  type: r.type,
  amount: r.amount,
  maxDiscountAmount: r.max_discount_amount,
  minOrderAmount: r.min_order_amount,
  currencyCode: r.currency_code,
  maxUses: r.max_uses,
  usesCount: Number(r.uses_count),
  perUserLimit: r.per_user_limit,
  applicablePlanSlugs: r.applicable_plan_slugs ?? [],
  startsAt: r.starts_at === null ? null : new Date(r.starts_at),
  expiresAt: r.expires_at === null ? null : new Date(r.expires_at),
  isActive: r.is_active,
  firstPurchaseOnly: r.first_purchase_only,
  stackableWithOther: r.stackable_with_other,
});

/**
 * The checkout's door to the coupon engine (TW-CPN-006): loads the coupon and the buyer's order history, then runs the pure
 * rules. Coupons are platform-global and the buyer's orders live in the buyer's own tenant, so this reads on the privileged
 * connection and names the org and user in every statement (the same pattern as the payment receivers).
 *
 * Nothing is reserved or written here: the preview and the binding check both call `resolve`, and the redemption is counted
 * only when the order is paid (`recordRedemption`, inside the fulfilment transaction).
 */
@Injectable()
export class CouponResolverService {
  constructor(private readonly store: PlatformStore) {}

  async resolve(req: CouponRequest, now = new Date()): Promise<CouponDecision> {
    const code = normalizeCouponCode(req.code);
    if (code === '') return { ok: false, message: COUPON_MESSAGES.empty };
    const { coupon, buyer } = await this.store.tx(async (tx) => {
      const found = await tx.execute(sql`
        SELECT id, code, type, amount::text AS amount, max_discount_amount::text AS max_discount_amount,
               min_order_amount::text AS min_order_amount, currency_code, max_uses, uses_count, per_user_limit,
               applicable_plan_slugs, starts_at, expires_at, is_active, first_purchase_only, stackable_with_other
        FROM coupons WHERE code = ${code}`);
      const row = found.rows[0] as unknown as CouponRow | undefined;
      if (!row || req.userId === null) return { coupon: row ? toFacts(row) : null, buyer: null };
      return {
        coupon: toFacts(row),
        buyer: await this.buyerFacts(tx, req.orgId, req.userId, code),
      };
    });
    const res = resolveCoupon(code, coupon, buyer, {
      planSlug: req.planSlug,
      subtotalMinor: req.subtotalMinor,
      currency: req.currency,
      now,
      otherCoupons: req.otherCoupons,
    });
    if (!res.ok) return res;
    return {
      ok: true,
      message: res.message,
      couponId: coupon!.id,
      code: coupon!.code,
      discountMinor: res.discountMinor,
    };
  }

  /** What the orders ledger says about this buyer (TW-CPN-006 rules 6 and 7): paid orders only, any kind. */
  private async buyerFacts(
    tx: Tx,
    orgId: number,
    userId: number,
    code: string,
  ): Promise<BuyerFacts> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS paid, count(*) FILTER (WHERE coupon_code = ${code})::int AS redeemed
      FROM orders WHERE org_id = ${orgId} AND user_id = ${userId} AND status = 'paid'`);
    const r = res.rows[0] as { paid: number; redeemed: number };
    return { paidOrders: r.paid, redemptions: r.redeemed };
  }

  /**
   * Counts one redemption. Called inside the transaction that marks the order paid, so a replayed webhook (which never gets
   * past the conditional "mark paid") cannot count twice (TW-CPN-008 rule 3). The coupon is not re-validated here: money has
   * already changed hands at the discounted price. A coupon deleted since the order was placed has nothing left to count.
   */
  async recordRedemption(tx: Tx, couponId: number | null): Promise<void> {
    if (couponId === null) return;
    await tx.execute(sql`UPDATE coupons SET uses_count = uses_count + 1 WHERE id = ${couponId}`);
  }
}
