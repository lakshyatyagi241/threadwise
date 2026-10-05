import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { AuthAuditService } from '../auth';
import { AddonFulfilmentService } from '../addons-extension-registry';
import { WalletLedgerService, WalletSettingsService } from '../wallet-message-billing';
import { nextPlanEnd, type BillingUnit } from './fulfilment-rules';
import { recordOrderEvent } from './order-events';
import { OrdersRepository, type OrderRow } from './orders.repository';
import { PaygwStore } from './paygw.store';

export interface PaidFacts {
  gatewayPaymentId?: string;
  payload?: Record<string, unknown>;
  /** An operator settled the order by hand (approve, mark paid): who, and the security event to write in the same transaction. */
  operator?: { id: number; event: string };
}

/**
 * Turns a confirmed payment into value (TW-PAYGW-028). One conditional UPDATE decides who owns the transition; only that caller
 * applies the plan or credits the wallet, so a browser return and a webhook arriving together, a provider's retry, or an admin
 * "mark paid" on top of both, can never apply it twice. Everything (order, plan window, wallet, audit, outbox) is one
 * transaction: a failure in any part rolls the whole payment back to its previous state and the next delivery tries again.
 *
 * Runs through PaygwStore because the receivers have no tenant: the transaction is privileged and every statement names the
 * order's org explicitly.
 */
@Injectable()
export class FulfilmentService {
  private readonly logger = new Logger(FulfilmentService.name);

  constructor(
    private readonly store: PaygwStore,
    private readonly orders: OrdersRepository,
    private readonly outbox: OutboxService,
    private readonly addons: AddonFulfilmentService,
    private readonly wallet: WalletLedgerService,
    private readonly walletSettings: WalletSettingsService,
    private readonly audit: AuthAuditService,
  ) {}

  /** `applied` is false when the order was already paid (a replay), in which case nothing was changed. */
  async fulfil(order: OrderRow, facts: PaidFacts): Promise<{ applied: boolean }> {
    return this.store.tx(async (tx) => {
      const paid = await this.orders.markPaid(
        tx,
        order.orgId,
        order.id,
        facts.gatewayPaymentId ?? null,
        facts.payload,
      );
      if (!paid) return { applied: false };
      const effect = await this.apply(tx, paid);
      // The coupon is counted once, in the same transaction as the payment: only the call that owns the paid transition gets here.
      if (paid.couponId !== null) {
        await tx.execute(
          sql`UPDATE coupons SET uses_count = uses_count + 1 WHERE id = ${paid.couponId}`,
        );
      }
      if (facts.operator) {
        await tx.execute(
          sql`UPDATE orders SET reviewed_at = now() WHERE org_id = ${paid.orgId} AND id = ${paid.id}`,
        );
        await this.audit.record(tx, {
          event: facts.operator.event,
          status: 'success',
          actorType: 'platform_operator',
          actorId: facts.operator.id,
          payload: {
            order: paid.orderNumber,
            amount: paid.totalAmount,
            currency: paid.currency,
            applied: effect,
          },
        });
      }
      await recordOrderEvent(tx, this.outbox, paid, 'paid', { applied: effect });
      return { applied: true };
    });
  }

  private async apply(tx: Tx, order: OrderRow): Promise<string> {
    if (order.kind === 'wallet_topup') {
      const minor = order.walletTopupMinor ?? 0;
      if (minor <= 0) return 'nothing';
      // The ledger's own idempotency key makes a replay a no-op: the order uuid is the payment's identity.
      await this.wallet.post(tx, {
        orgId: order.orgId,
        // The wallet the order was placed for; an order from before per-currency wallets credits the platform currency's.
        unit: order.walletUnit ?? (await this.walletSettings.currency()),
        type: 'topup',
        direction: 'in',
        amountMinor: minor,
        idempotencyKey: `order:${order.uuid}`,
        source: 'topup.conversion',
        description: 'Wallet top-up',
        subject: { type: 'order', id: order.id },
        userId: order.userId,
        meta: { order: order.orderNumber },
      });
      return 'wallet_credited';
    }
    if (order.kind === 'addon' && order.planSlug) {
      // The add-on sits on top of the plan: the plan, the trial and the plan's end date are untouched (TW-ADD-032).
      const res = await this.addons.fulfil(tx, {
        orgId: order.orgId,
        pack: order.planSlug,
        orderId: order.id,
      });
      return res.created ? 'addon_granted' : 'nothing';
    }
    if (order.kind !== 'plan' || !order.planSlug) return 'nothing';

    const planRes = await tx.execute(sql`
      SELECT billing_unit, billing_duration, is_free, is_lifetime, is_custom_quote
      FROM plans WHERE slug = ${order.planSlug}`);
    const plan = planRes.rows[0] as
      | {
          billing_unit: BillingUnit;
          billing_duration: number;
          is_free: boolean;
          is_lifetime: boolean;
          is_custom_quote: boolean;
        }
      | undefined;
    if (!plan) {
      // Reference drops this silently. The order stays paid (the money is real) but the audit row says nothing was applied.
      this.logger.error(
        { order: order.orderNumber, plan: order.planSlug },
        'paid order names a plan that no longer exists',
      );
      return 'plan_missing';
    }
    const st = await tx.execute(
      sql`SELECT plan_ends_at FROM org_plan_state WHERE org_id = ${order.orgId} FOR UPDATE`,
    );
    const current =
      (st.rows[0] as { plan_ends_at: string | null } | undefined)?.plan_ends_at ?? null;
    const end = nextPlanEnd(
      new Date(),
      current ? new Date(current) : null,
      {
        billingUnit: plan.billing_unit,
        billingDuration: plan.billing_duration,
        isFree: plan.is_free,
        isLifetime: plan.is_lifetime,
        isCustomQuote: plan.is_custom_quote,
      },
      order.billingPeriod,
    );
    // Paying lifts the trial bar: trial_ends_at is cleared and the plan window is the new end (null = never expires).
    await tx.execute(sql`
      INSERT INTO org_plan_state (org_id, plan_ends_at, trial_ends_at, billing_cycle)
      VALUES (${order.orgId}, ${end ? end.toISOString() : null}, NULL, ${order.billingPeriod})
      ON CONFLICT (org_id) DO UPDATE
        SET plan_ends_at = EXCLUDED.plan_ends_at, trial_ends_at = NULL, billing_cycle = EXCLUDED.billing_cycle`);
    await tx.execute(
      sql`UPDATE organizations SET plan = ${order.planSlug} WHERE id = ${order.orgId}`,
    );
    return 'plan_applied';
  }
}
