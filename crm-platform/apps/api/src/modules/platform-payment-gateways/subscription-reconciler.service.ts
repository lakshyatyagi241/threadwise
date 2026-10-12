import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { GatewayService } from './gateway.service';
import { PaygwStore } from './paygw.store';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { toSub, type SubRow } from './subscription-row';

/** TW-PAYGW-030 constants: one provider poll per subscription per window, and plans this close to their end are worth polling. */
export const RECONCILE_THROTTLE_HOURS = 6;
export const RECONCILE_LOOKAHEAD_DAYS = 3;
const BATCH = 50;

export type ReconcileOutcome =
  | 'no_gateway_sub'
  | 'skip_no_driver'
  | 'skip_poll_failed'
  | 'gateway_canceled'
  | 'gateway_expired'
  | 'renewed'
  | 'up_to_date';

type Raw = Record<string, unknown>;

/**
 * The safety net for a missing renewal notification (TW-PAYGW-030). Reference piggy-backed on the buyer's web traffic; here a
 * worker sweep does it, so a workspace nobody is browsing is reconciled too. A subscription is worth a provider call only when it
 * is pending or past due, has no end date, or its plan ends within three days; a healthy mid-cycle plan costs nothing. The poll
 * is claimed with one atomic UPDATE of `meta.last_polled_at`, so two workers (or two sweeps) poll a subscription once per window.
 * Reference could poll only Razorpay; a driver without `fetchSubscription` just consumes its window.
 */
@Injectable()
export class SubscriptionReconcilerService {
  private readonly logger = new Logger(SubscriptionReconcilerService.name);

  constructor(
    private readonly store: PaygwStore,
    private readonly gateways: GatewayService,
    private readonly lifecycle: SubscriptionLifecycleService,
  ) {}

  /** Claims up to a batch of due subscriptions and reconciles each. One failure never stops the rest. */
  async sweep(): Promise<Record<string, number>> {
    const claimed = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        WITH due AS (
          SELECT s.org_id, s.id FROM subscriptions s
          LEFT JOIN org_plan_state p ON p.org_id = s.org_id
          LEFT JOIN workspace_addons wa ON wa.org_id = s.org_id AND wa.id = s.workspace_addon_id
          WHERE s.status IN ('pending', 'active', 'past_due')
            AND (s.status <> 'active'
                 OR (CASE WHEN s.kind = 'addon' THEN wa.ends_at ELSE p.plan_ends_at END) IS NULL
                 OR (CASE WHEN s.kind = 'addon' THEN wa.ends_at ELSE p.plan_ends_at END)
                      <= now() + make_interval(days => ${RECONCILE_LOOKAHEAD_DAYS}))
            AND COALESCE((s.meta ->> 'last_polled_at')::timestamptz, 'epoch'::timestamptz)
                < now() - make_interval(hours => ${RECONCILE_THROTTLE_HOURS})
          ORDER BY s.id
          LIMIT ${BATCH}
          FOR UPDATE OF s SKIP LOCKED
        )
        UPDATE subscriptions s
        SET meta = COALESCE(s.meta, '{}'::jsonb) || jsonb_build_object('last_polled_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
        FROM due
        WHERE s.org_id = due.org_id AND s.id = due.id
        RETURNING s.org_id, s.id, s.user_id, s.gateway, s.gateway_subscription_id, s.gateway_plan_id, s.gateway_customer_id,
                  s.plan_id, s.kind, s.workspace_addon_id, s.billing_cycle, s.status, s.current_period_end, s.renewals_count, s.meta`);
      return (res.rows as Raw[]).map(toSub);
    });
    const tally: Record<string, number> = {};
    for (const sub of claimed) {
      try {
        const outcome = await this.reconcileOne(sub);
        tally[outcome] = (tally[outcome] ?? 0) + 1;
      } catch (err) {
        this.logger.warn({ err, subscription: sub.id }, '[PAYGW] reconcile failed');
        tally.error = (tally.error ?? 0) + 1;
      }
    }
    return tally;
  }

  /**
   * "Refresh from the provider" for one subscription a person asked about: the same poll the sweep does, now, without the throttle.
   * The workspace is named explicitly (the caller has checked the subscription is theirs). `unknown` = no such subscription.
   */
  async syncNow(orgId: number, subscriptionId: number): Promise<ReconcileOutcome | 'unknown'> {
    const sub = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT s.org_id, s.id, s.user_id, s.gateway, s.gateway_subscription_id, s.gateway_plan_id, s.gateway_customer_id,
               s.plan_id, s.kind, s.workspace_addon_id, s.billing_cycle, s.status, s.current_period_end, s.renewals_count, s.meta
        FROM subscriptions s WHERE s.org_id = ${orgId} AND s.id = ${subscriptionId}`);
      const r = (res.rows as Raw[])[0];
      return r ? toSub(r) : null;
    });
    if (!sub) return 'unknown';
    return this.reconcileOne(sub);
  }

  /** One claimed subscription: ask the provider, then apply what it says (TW-PAYGW-030 rule 2 and 3). */
  async reconcileOne(sub: SubRow): Promise<ReconcileOutcome> {
    if (!sub.gatewaySubscriptionId) return 'no_gateway_sub'; // a one-time purchase: nothing can renew it
    const gateway = await this.gateways.bySlug(sub.gateway);
    if (!gateway) return 'skip_no_driver';
    const driver = this.gateways.driverFor(gateway);
    if (!driver.fetchSubscription) return 'skip_poll_failed';
    const state = await driver.fetchSubscription({
      gatewaySubscriptionId: sub.gatewaySubscriptionId,
      gatewayCustomerId: sub.gatewayCustomerId,
      gatewayPlanId: sub.gatewayPlanId,
    });
    if (!state) return 'skip_poll_failed';
    // The provider says the mandate is dead: reflect it and let the already-paid window lapse (never shortened here).
    if (state.status === 'canceled' || state.status === 'expired') {
      await this.lifecycle.markEnded(sub, state.status);
      return state.status === 'expired' ? 'gateway_expired' : 'gateway_canceled';
    }
    return (await this.lifecycle.applyPolled(sub, state.periodEnd)) ? 'renewed' : 'up_to_date';
  }
}
