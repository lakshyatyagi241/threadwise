import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { couponRejectionMessage, type CouponRejectionReason } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { COUPON_COLUMNS, toCouponFacts, type CouponRow } from './coupon-row';
import { CpnStore } from './cpn-store';
import { normaliseCouponInput, resolveCoupon, type BuyerFacts } from './coupon-rules';

export interface CouponQuoteInput {
  /** What the buyer typed. */
  code: string;
  /** The plan or add-on being bought (its slug). */
  planSlug: string;
  /**
   * The AUTHORITATIVE price before tax, in minor units of `currency`: computed by the caller from the plan, never taken from the
   * browser (WaDesk's preview trusted the amount the page sent).
   */
  subtotalMinor: bigint;
  /** The ORDER currency (the currency lock compares against it). */
  currency: string;
  orgId: number;
  userId: number | null;
  /** Other codes already on the order, for the stacking rule. */
  otherCodes?: readonly string[];
  /** Injectable clock for tests. */
  now?: Date;
}

export type CouponQuote =
  | {
      ok: true;
      message: string;
      /** The canonical (upper-case) code, what to snapshot on the order. */
      code: string;
      /** Internal id, for `orders.coupon_id`. Server-side only: it never goes into a response. */
      couponId: number;
      discountMinor: bigint;
    }
  | { ok: false; reason: CouponRejectionReason; message: string };

/**
 * What the checkout needs from coupons (WD-CPN-006, 007, 008). The payment-gateways domain calls `quote` twice with the same
 * server-computed subtotal (once for the preview, once when the order is placed, where the answer is binding) and
 * `redeemForOrder` when an order turns paid. Both read the coupon through the platform door because the coupon belongs to the
 * platform, not to the buyer's workspace.
 *
 * The preview does not reserve anything; only a paid order counts (WaDesk gap kept: two buyers may both place an order for a
 * coupon's last use, and both paid finalizations then succeed).
 */
@Injectable()
export class CouponCheckoutService {
  constructor(
    private readonly store: CpnStore,
    private readonly outbox: OutboxService,
  ) {}

  async quote(input: CouponQuoteInput): Promise<CouponQuote> {
    const code = normaliseCouponInput(input.code);
    if (code === '')
      return { ok: false, reason: 'empty', message: couponRejectionMessage('empty') };
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`SELECT ${COUPON_COLUMNS} FROM coupons WHERE code = ${code}`);
      const row = res.rows[0] as unknown as CouponRow | undefined;
      const coupon = row ? toCouponFacts(row) : null;
      const buyer =
        coupon && input.userId !== null
          ? await this.buyerFacts(tx, input, coupon.id, coupon)
          : null;
      const r = resolveCoupon(coupon, code, {
        now: input.now ?? new Date(),
        planSlug: input.planSlug,
        subtotalMinor: input.subtotalMinor,
        currency: input.currency,
        otherCodes: input.otherCodes,
        buyer,
      });
      if (!r.ok) return r;
      if (!coupon)
        return {
          ok: false as const,
          reason: 'not_found' as const,
          message: couponRejectionMessage('not_found', { code }),
        };
      return {
        ok: true as const,
        message: r.message,
        code: coupon.code,
        couponId: coupon.id,
        discountMinor: r.discountMinor,
      };
    });
  }

  /**
   * Counts one redemption for a paid order, once. Runs inside the caller's transaction (the paid transition) so the order, the
   * counter and the event commit together; the order's `coupon_id` and `coupon_code` say which coupon. A replay (a second
   * webhook, the outbox consumer after the checkout already counted) inserts nothing and increments nothing.
   *
   * The caller's transaction must be privileged (the platform store gives that): `coupons` accepts writes only under it.
   * Returns the coupon code that was counted, or null when the order has no coupon or was already counted.
   */
  async redeemForOrder(tx: Tx, orgId: number, orderId: number): Promise<string | null> {
    const o = await tx.execute(sql`
      SELECT coupon_id, coupon_code, user_id FROM orders WHERE org_id = ${orgId} AND id = ${orderId}`);
    const order = o.rows[0] as unknown as
      | {
          coupon_id: string | number | null;
          coupon_code: string | null;
          user_id: string | number | null;
        }
      | undefined;
    if (!order || order.coupon_id === null || !order.coupon_code) return null;

    const guard = await tx.execute(sql`
      INSERT INTO coupon_redemptions (org_id, order_id, coupon_id, coupon_code, user_id)
      VALUES (${orgId}, ${orderId}, ${order.coupon_id}, ${order.coupon_code}, ${order.user_id})
      ON CONFLICT (org_id, order_id) DO NOTHING
      RETURNING id`);
    if (guard.rows.length === 0) return null;

    // The coupon may have been deleted since the order was placed: the snapshot row above still records the redemption.
    await tx.execute(
      sql`UPDATE coupons SET uses_count = uses_count + 1 WHERE id = ${order.coupon_id}`,
    );
    await this.outbox.emit(tx, {
      orgId,
      aggregateModule: 'orders',
      aggregateId: orderId,
      eventType: 'coupon.redeemed',
      payload: { couponCode: order.coupon_code },
    });
    return order.coupon_code;
  }

  private async buyerFacts(
    tx: Tx,
    input: CouponQuoteInput,
    couponId: number,
    coupon: { firstPurchaseOnly: boolean; perUserLimit: number | null },
  ): Promise<BuyerFacts | null> {
    // Only ask the orders ledger what the coupon's own rules need.
    let hasPaidOrder = false;
    let paidOrdersWithCoupon = 0;
    if (coupon.firstPurchaseOnly) {
      const r = await tx.execute(sql`
        SELECT EXISTS (SELECT 1 FROM orders WHERE org_id = ${input.orgId} AND user_id = ${input.userId} AND status = 'paid') AS yes`);
      hasPaidOrder = (r.rows[0] as unknown as { yes: boolean }).yes;
    }
    if (coupon.perUserLimit !== null && coupon.perUserLimit > 0) {
      const r = await tx.execute(sql`
        SELECT count(*)::int AS n FROM orders
        WHERE org_id = ${input.orgId} AND user_id = ${input.userId} AND coupon_id = ${couponId} AND status = 'paid'`);
      paidOrdersWithCoupon = (r.rows[0] as unknown as { n: number }).n;
    }
    return { hasPaidOrder, paidOrdersWithCoupon };
  }
}
