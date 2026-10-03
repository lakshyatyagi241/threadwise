import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { evaluateCoupon, type CouponFacts } from './coupon-rules';
import { PaygwStore } from './paygw.store';

export interface CouponResolution {
  ok: boolean;
  message: string;
  couponId: number | null;
  code: string;
  discountMinor: bigint;
}

/**
 * The coupon door of checkout (WD-PAYGW-010). SHIM inside the PAYGW zone: the coupons domain (CPN) owns coupons and will expose a
 * service through its barrel; until it is merged this reads the `coupons` row (an operator-only table, so through the module's
 * privileged store) and applies the ported rules. Swapping to CPN's service means replacing `resolve`'s body only; checkout
 * calls nothing else. The buyer's own history comes from the orders ledger, as in WaDesk.
 */
@Injectable()
export class CouponService {
  constructor(private readonly store: PaygwStore) {}

  async resolve(input: {
    code: string;
    planSlug: string | null;
    subtotalMinor: bigint;
    currency: string;
    orgId: number;
    userId: number | null;
  }): Promise<CouponResolution> {
    const code = input.code.trim().toUpperCase();
    const none = (message: string): CouponResolution => ({
      ok: false,
      message,
      couponId: null,
      code,
      discountMinor: 0n,
    });
    if (code === '') return none('Enter a coupon code.');

    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT id, code, type, amount::text AS amount, currency_code, max_discount_amount::text AS max_discount_amount,
               min_order_amount::text AS min_order_amount, max_uses, per_user_limit, uses_count, applicable_package_ids,
               starts_at, expires_at, is_active, first_purchase_only
        FROM coupons WHERE upper(code) = ${code}`);
      const r = res.rows[0] as Record<string, unknown> | undefined;
      if (!r) return none(`Coupon "${code}" not recognised.`);
      const facts: CouponFacts = {
        id: Number(r.id),
        code: String(r.code),
        type: String(r.type),
        amount: String(r.amount),
        currencyCode: (r.currency_code as string | null) ?? null,
        maxDiscountAmount: (r.max_discount_amount as string | null) ?? null,
        minOrderAmount: (r.min_order_amount as string | null) ?? null,
        maxUses: r.max_uses === null ? null : Number(r.max_uses),
        perUserLimit: r.per_user_limit === null ? null : Number(r.per_user_limit),
        usesCount: Number(r.uses_count),
        applicable: r.applicable_package_ids,
        startsAt: r.starts_at ? new Date(String(r.starts_at)) : null,
        expiresAt: r.expires_at ? new Date(String(r.expires_at)) : null,
        isActive: r.is_active === true,
        firstPurchaseOnly: r.first_purchase_only === true,
      };
      let buyer: { paidOrders: number; usedThisCoupon: number } | null = null;
      if (input.userId !== null && (facts.firstPurchaseOnly || facts.perUserLimit !== null)) {
        const c = await tx.execute(sql`
          SELECT count(*)::int AS paid, count(*) FILTER (WHERE coupon_id = ${facts.id})::int AS used
          FROM orders WHERE org_id = ${input.orgId} AND user_id = ${input.userId} AND status = 'paid'`);
        const row = c.rows[0] as { paid: number; used: number };
        buyer = { paidOrders: row.paid, usedThisCoupon: row.used };
      }
      const verdict = evaluateCoupon(facts, {
        planSlug: input.planSlug,
        subtotalMinor: input.subtotalMinor,
        currency: input.currency,
        now: new Date(),
        buyer,
      });
      if (!verdict.ok) return { ...none(verdict.message), couponId: facts.id, code: facts.code };
      return {
        ok: true,
        message: verdict.message,
        couponId: facts.id,
        code: facts.code,
        discountMinor: verdict.discountMinor,
      };
    });
  }
}
