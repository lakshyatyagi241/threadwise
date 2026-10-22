import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { AddonFulfilmentHooks } from '../addons-extension-registry';
import { announceAddonTerm } from './addon-term';
import { GatewayService } from './gateway.service';
import { PaygwStore } from './paygw.store';
import { toSub, type SubRow } from './subscription-row';

/** Why a subscription is being ended by us (the provider ending it is `SubscriptionLifecycleService`'s business). */
export type EndReason = 'user' | 'superseded' | 'downgrade' | 'operator' | 'plan_includes';

export interface RemoteOutcome {
  result: 'ok' | 'failed' | 'unsupported';
  reason?: string;
}

type Raw = Record<string, unknown>;

/**
 * Ends subscriptions on the provider AND locally, in the right order: the provider call runs with no transaction open (a slow gateway
 * must never hold a connection), then ONE transaction marks the row cancelled with the outcome, writes the audit row and announces it.
 * The local row is cancelled even when the provider call failed (Reference's rule: a row we meant to end is never treated as renewing),
 * with the failure recorded in `meta.cancel` so an operator can finish it in the provider's dashboard.
 *
 * Two callers matter for money: buying a plan while another plan subscription is renewing (the old one must stop NOW, or the workspace
 * pays both) and moving to a free or cheaper plan (the old price must not renew and put the old plan back).
 */
@Injectable()
export class SubscriptionCancelService {
  private readonly logger = new Logger(SubscriptionCancelService.name);

  constructor(
    private readonly store: PaygwStore,
    private readonly gateways: GatewayService,
    private readonly outbox: OutboxService,
    private readonly hooks: AddonFulfilmentHooks,
  ) {}

  /**
   * Ends every renewing PLAN subscription of the workspace except the one that belongs to `exceptOrderNumber` (the purchase that is
   * replacing them). Add-on subscriptions are never touched: they are their own purchases. Returns how many were ended.
   */
  async endPlanSubscriptions(
    orgId: number,
    opts: { atCycleEnd: boolean; reason: EndReason; exceptOrderNumber?: string },
  ): Promise<number> {
    const rows = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT ${COLS} FROM subscriptions s
        WHERE s.org_id = ${orgId} AND s.kind = 'plan' AND s.status IN ('active', 'past_due')
          AND (${opts.exceptOrderNumber ?? null}::text IS NULL OR COALESCE(s.meta ->> 'order_number', '') <> ${opts.exceptOrderNumber ?? ''})
        ORDER BY s.id`);
      return (res.rows as Raw[]).map(toSub);
    });
    let ended = 0;
    for (const sub of rows) {
      if (await this.end(sub, opts)) ended += 1;
    }
    return ended;
  }

  /**
   * Ends the other card renewals of the same Marketplace app in a workspace, now, except the one that belongs to `exceptOrderNumber` (the
   * purchase that is replacing them). An app is ONE subscription: a workspace that subscribes again (to restart after a failed payment, or
   * to pay early) must not be charged by two provider subscriptions every cycle. Only Marketplace add-ons: a plain add-on pack is a
   * boost that stacks on purpose. Returns how many were ended.
   */
  async endSupersededAppSubscriptions(
    orgId: number,
    packSlug: string,
    exceptOrderNumber: string,
  ): Promise<number> {
    const rows = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT ${COLS} FROM subscriptions s
        JOIN plans p ON p.slug = s.plan_id AND p.marketplace_app_id IS NOT NULL
        WHERE s.org_id = ${orgId} AND s.kind = 'addon' AND s.plan_id = ${packSlug} AND s.status IN ('active', 'past_due')
          AND COALESCE(s.meta ->> 'order_number', '') <> ${exceptOrderNumber}
        ORDER BY s.id`);
      return (res.rows as Raw[]).map(toSub);
    });
    let ended = 0;
    for (const sub of rows) {
      if (await this.end(sub, { atCycleEnd: false, reason: 'superseded' })) ended += 1;
    }
    return ended;
  }

  /** Ends one subscription (an operator or the workspace chose to). `null` when it was not renewing any more. */
  async endOne(
    orgId: number,
    subscriptionId: number,
    opts: {
      atCycleEnd: boolean;
      reason: EndReason;
      actor?: { id: number | null; type: string };
      /** See `EndOptions.strict`. */
      strict?: boolean;
    },
  ): Promise<RemoteOutcome | null> {
    const sub = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT ${COLS} FROM subscriptions s
        WHERE s.org_id = ${orgId} AND s.id = ${subscriptionId} AND s.status IN ('active', 'past_due')`);
      const r = (res.rows as Raw[])[0];
      return r ? toSub(r) : null;
    });
    if (!sub) return null;
    return this.end(sub, opts, true);
  }

  /** `end` returns whether this call ended it; `withOutcome` returns the provider outcome instead (null if someone else got there first). */
  private async end(sub: SubRow, opts: EndOptions): Promise<boolean>;
  private async end(
    sub: SubRow,
    opts: EndOptions,
    withOutcome: true,
  ): Promise<RemoteOutcome | null>;
  private async end(
    sub: SubRow,
    opts: EndOptions,
    withOutcome?: true,
  ): Promise<boolean | RemoteOutcome | null> {
    // The provider is called with no transaction open.
    const remote = await this.remote(sub, opts.atCycleEnd);
    if (opts.strict && !stopped(remote)) {
      // The provider is still going to charge: the row stays as it was, so nothing says the renewal ended when it did not.
      this.logger.warn(
        { gateway: sub.gateway, subscription: sub.id, remote },
        'the provider subscription could not be stopped; the local row was left unchanged',
      );
      return withOutcome ? remote : false;
    }
    const changed = await this.store.tx(async (tx) => {
      const meta = {
        cancel: { ...remote, reason_code: opts.reason, at_cycle_end: opts.atCycleEnd },
      };
      const res = await tx.execute(sql`
        UPDATE subscriptions
        SET status = 'canceled', canceled_at = COALESCE(canceled_at, now()),
            meta = COALESCE(meta, '{}'::jsonb) || ${JSON.stringify(meta)}::jsonb
        WHERE org_id = ${sub.orgId} AND id = ${sub.id} AND status IN ('active', 'past_due')
        RETURNING id`);
      if (res.rows.length === 0) return false; // a webhook or a second click got there first
      await tx.execute(sql`
        INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta)
        VALUES (${sub.orgId}, ${opts.actor?.id ?? null}, ${opts.actor?.type ?? 'system'}, 'subscriptions', ${sub.id}, 'update',
          ${JSON.stringify({ status: { old: sub.status, new: 'canceled' }, reason: { old: null, new: opts.reason }, remote: { old: null, new: remote.result } })}::jsonb)`);
      await this.outbox.emit(tx, {
        aggregateModule: 'subscriptions',
        aggregateId: sub.id,
        eventType: 'paygw.subscription.ended',
        orgId: sub.orgId,
        payload: {
          gateway: sub.gateway,
          plan: sub.planSlug,
          kind: sub.kind,
          reason: opts.reason,
          remote: remote.result,
        },
      });
      // The Marketplace's ledger of an add-on that sells an app learns that its card renewal is over.
      await announceAddonTerm(tx, this.hooks, sub, 'ended', {
        reason: opts.reason === 'plan_includes' ? 'superseded' : opts.reason,
      });
      return true;
    });
    if (withOutcome) return changed ? remote : null;
    return changed;
  }

  private async remote(sub: SubRow, atCycleEnd: boolean): Promise<RemoteOutcome> {
    if (!sub.gatewaySubscriptionId)
      return { result: 'unsupported', reason: 'no_gateway_subscription_id' };
    try {
      const gateway = await this.gateways.bySlug(sub.gateway);
      if (!gateway) return { result: 'unsupported', reason: 'gateway_not_configured' };
      const driver = this.gateways.driverFor(gateway);
      if (!driver.cancelSubscription)
        return { result: 'unsupported', reason: 'driver_has_no_cancel' };
      const out = await driver.cancelSubscription(
        {
          gatewaySubscriptionId: sub.gatewaySubscriptionId,
          gatewayCustomerId: sub.gatewayCustomerId,
          gatewayPlanId: sub.gatewayPlanId,
        },
        { atCycleEnd },
      );
      return out.ok ? { result: 'ok' } : { result: 'failed', reason: out.reason };
    } catch (err) {
      this.logger.warn({ err, gateway: sub.gateway }, 'gateway cancel threw');
      return { result: 'failed', reason: 'exception' };
    }
  }
}

interface EndOptions {
  atCycleEnd: boolean;
  reason: EndReason;
  actor?: { id: number | null; type: string };
  /**
   * The caller promises the person that the charging stops, so the local row is only marked cancelled when the provider confirmed (or there
   * is no provider subscription to stop). Without it the row is always marked, even when the provider call failed, so a row we meant to end
   * is never treated as renewing; the failure is then recorded in `meta.cancel` for an operator to finish.
   */
  strict?: boolean;
}

/** The provider no longer charges: it said ok, or there was nothing to stop (a row with no provider subscription id). */
const stopped = (r: RemoteOutcome): boolean =>
  r.result === 'ok' || (r.result === 'unsupported' && r.reason === 'no_gateway_subscription_id');

const COLS =
  sql.raw(`s.org_id, s.id, s.user_id, s.gateway, s.gateway_subscription_id, s.gateway_plan_id, s.gateway_customer_id,
  s.plan_id, s.kind, s.workspace_addon_id, s.billing_cycle, s.status, s.current_period_end, s.renewals_count, s.meta`);
