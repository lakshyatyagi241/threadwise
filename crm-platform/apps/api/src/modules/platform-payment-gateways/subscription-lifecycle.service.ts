import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { SubscriptionEvent } from '../../infra/providers/platform-payment-gateways';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import type { BillingUnit } from './fulfilment-rules';
import { FulfilmentService } from './fulfilment.service';
import { OrdersRepository, type OrderRow } from './orders.repository';
import { PaygwStore } from './paygw.store';
import { toDate, windowAfterEvent } from './subscription-rules';

export type SubStatus = 'pending' | 'active' | 'past_due' | 'canceled' | 'expired';

/** One `subscriptions` row as this module reads it. Internal ids stay inside the API. */
export interface SubRow {
  orgId: number;
  id: number;
  userId: number | null;
  gateway: string;
  gatewaySubscriptionId: string | null;
  gatewayPlanId: string | null;
  gatewayCustomerId: string | null;
  planSlug: string | null;
  /** 'plan' renews the workspace plan; 'addon' renews one add-on purchase and never touches the plan window. */
  kind: 'plan' | 'addon';
  workspaceAddonId: number | null;
  billingCycle: 'monthly' | 'yearly';
  status: SubStatus;
  currentPeriodEnd: Date | null;
  renewalsCount: number;
  meta: Record<string, unknown>;
}

const COLS =
  sql.raw(`s.org_id, s.id, s.user_id, s.gateway, s.gateway_subscription_id, s.gateway_plan_id, s.gateway_customer_id,
  s.plan_id, s.kind, s.workspace_addon_id, s.billing_cycle, s.status, s.current_period_end, s.renewals_count, s.meta`);

type Raw = Record<string, unknown>;
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function toSub(r: Raw): SubRow {
  return {
    orgId: Number(r.org_id),
    id: Number(r.id),
    userId: r.user_id === null || r.user_id === undefined ? null : Number(r.user_id),
    gateway: r.gateway as string,
    gatewaySubscriptionId: text(r.gateway_subscription_id),
    gatewayPlanId: text(r.gateway_plan_id),
    gatewayCustomerId: text(r.gateway_customer_id),
    planSlug: text(r.plan_id),
    kind: r.kind === 'addon' ? 'addon' : 'plan',
    workspaceAddonId:
      r.workspace_addon_id === null || r.workspace_addon_id === undefined
        ? null
        : Number(r.workspace_addon_id),
    billingCycle: r.billing_cycle === 'yearly' ? 'yearly' : 'monthly',
    status: r.status as SubStatus,
    currentPeriodEnd: r.current_period_end ? new Date(r.current_period_end as string) : null,
    renewalsCount: Number(r.renewals_count),
    meta: (r.meta as Record<string, unknown> | null) ?? {},
  };
}

export type SubEvent = 'activated' | 'renewed' | 'canceled' | 'past_due' | 'expired';

/** Provider payment ids already applied to a subscription, kept so a redelivered "renewed" event cannot count twice. */
const KEEP_PAYMENT_IDS = 24;

export type EventOutcome =
  'no_match' | 'activated' | 'renewed' | 'canceled' | 'past_due' | 'duplicate' | 'ignored';

/**
 * Keeps local `subscriptions` in step with the provider (TW-PAYGW-029). The provider is the clock: a notification (or the
 * reconciler's poll) moves the row and, for activation and renewal, the workspace's plan window. Every transition is one
 * transaction with its audit row and outbox event. Runs through PaygwStore: a provider notification has no tenant, so each
 * statement names the subscription's org.
 */
@Injectable()
export class SubscriptionLifecycleService {
  private readonly logger = new Logger(SubscriptionLifecycleService.name);

  constructor(
    private readonly store: PaygwStore,
    private readonly orders: OrdersRepository,
    private readonly fulfilment: FulfilmentService,
    private readonly outbox: OutboxService,
  ) {}

  // ---- creating ------------------------------------------------------------------------------------------------------

  /**
   * A pending row for a recurring checkout (TW-PAYGW-012 rule 3). A retried checkout reuses the row for the same order and
   * gateway (the unique index makes that atomic). Failure to record never fails the payment: the caller logs and goes on.
   */
  async recordPending(
    order: OrderRow,
    gateway: string,
    attrs: {
      gatewaySubscriptionId?: string | null;
      gatewayPlanId?: string | null;
      gatewayCustomerId?: string | null;
    },
  ): Promise<void> {
    await this.store.tx(async (tx) => {
      await tx.execute(sql`
        INSERT INTO subscriptions (org_id, user_id, plan_id, kind, gateway, gateway_subscription_id, gateway_plan_id,
          gateway_customer_id, billing_cycle, status, amount, currency, meta)
        VALUES (${order.orgId}, ${order.userId}, ${order.planSlug}, ${order.kind === 'addon' ? 'addon' : 'plan'}, ${gateway}, ${attrs.gatewaySubscriptionId ?? null},
          ${attrs.gatewayPlanId ?? null}, ${attrs.gatewayCustomerId ?? null}, ${order.billingPeriod}, 'pending',
          ${order.totalAmount}, ${order.currency}, ${JSON.stringify({ order_number: order.orderNumber })}::jsonb)
        ON CONFLICT (org_id, gateway, (meta ->> 'order_number'))
          WHERE status = 'pending' AND meta ->> 'order_number' IS NOT NULL
        DO UPDATE SET
          gateway_subscription_id = COALESCE(EXCLUDED.gateway_subscription_id, subscriptions.gateway_subscription_id),
          gateway_plan_id = COALESCE(EXCLUDED.gateway_plan_id, subscriptions.gateway_plan_id),
          gateway_customer_id = COALESCE(EXCLUDED.gateway_customer_id, subscriptions.gateway_customer_id)`);
    });
  }

  // ---- reading -------------------------------------------------------------------------------------------------------

  private async match(tx: Tx, gateway: string, evt: SubscriptionEvent): Promise<SubRow | null> {
    const one = async (cond: ReturnType<typeof sql>): Promise<SubRow | null> => {
      const res = await tx.execute(
        sql`SELECT ${COLS} FROM subscriptions s WHERE s.gateway = ${gateway} AND ${cond} ORDER BY s.id DESC LIMIT 1`,
      );
      const r = (res.rows as Raw[])[0];
      return r ? toSub(r) : null;
    };
    let sub: SubRow | null = null;
    if (evt.subscriptionId) sub = await one(sql`s.gateway_subscription_id = ${evt.subscriptionId}`);
    if (!sub && evt.orderNumber)
      sub = await one(sql`s.meta ->> 'order_number' = ${evt.orderNumber}`);
    // A plan id alone is shared: gateway_plan_cache makes one plan per account, price and cadence and every workspace on it uses that
    // id, so 'newest subscription on this plan' would apply the event to some other workspace (TI-009). Only an unambiguous match counts.
    if (!sub && evt.gatewayPlanId) {
      const res = await tx.execute(
        sql`SELECT ${COLS} FROM subscriptions s WHERE s.gateway = ${gateway} AND s.gateway_plan_id = ${evt.gatewayPlanId} ORDER BY s.id DESC LIMIT 2`,
      );
      const rows = res.rows as Raw[];
      if (rows.length === 1) sub = toSub(rows[0]!);
    }
    if (sub && !sub.gatewaySubscriptionId && evt.subscriptionId) {
      await tx.execute(
        sql`UPDATE subscriptions SET gateway_subscription_id = ${evt.subscriptionId} WHERE org_id = ${sub.orgId} AND id = ${sub.id}`,
      );
      sub.gatewaySubscriptionId = evt.subscriptionId;
    }
    return sub;
  }

  /** The subscription a paid return belongs to: pending or active, found by OUR order number. */
  async pendingForOrder(order: OrderRow, gateway: string): Promise<SubRow | null> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT ${COLS} FROM subscriptions s
        WHERE s.org_id = ${order.orgId} AND s.gateway = ${gateway} AND s.meta ->> 'order_number' = ${order.orderNumber}
          AND s.status IN ('pending', 'active')
        ORDER BY s.id DESC LIMIT 1`);
      const r = (res.rows as Raw[])[0];
      return r ? toSub(r) : null;
    });
  }

  // ---- events --------------------------------------------------------------------------------------------------------

  /** TW-PAYGW-029 rule 1..3: match the event, then act. Never throws for a replay; a replay is `duplicate` or a no-op. */
  async apply(gateway: string, evt: SubscriptionEvent): Promise<EventOutcome> {
    const sub = await this.store.tx((tx) => this.match(tx, gateway, evt));
    if (!sub) {
      this.logger.log(
        { gateway, type: evt.type },
        'subscription notification matched no local row',
      );
      return 'no_match';
    }
    switch (evt.type) {
      case 'created':
        return this.firstCharge(sub, evt);
      case 'renewed':
        // Still pending: this is the first charge, handled like `created` (TW-PAYGW-029 rule 3).
        if (sub.status === 'pending') return this.firstCharge(sub, evt);
        return this.renew(sub, evt);
      case 'canceled':
        return this.setStatus(sub, 'canceled', 'canceled', evt);
      case 'payment_failed':
        return this.setStatus(sub, 'past_due', 'past_due', evt);
      default:
        return 'ignored';
    }
  }

  /**
   * Finalise the pending ORDER first (plan window = now + one cycle), THEN activate. The other way round, activation sets the
   * window to the provider's period and the order then stacks a second cycle on top (Reference's documented "51/58 days" bug).
   */
  private async firstCharge(sub: SubRow, evt: SubscriptionEvent): Promise<EventOutcome> {
    await this.finalizePendingOrder(sub);
    return this.activate(sub, {
      gatewaySubscriptionId: evt.subscriptionId,
      periodEnd: evt.periodEnd,
    });
  }

  /** `paid` with the gateway subscription id as the payment id, exactly as Reference did for a subscription's first charge. */
  async finalizePendingOrder(sub: SubRow): Promise<void> {
    const number = text(sub.meta.order_number);
    if (!number) return;
    const row = await this.store.tx((tx) =>
      this.orders.byReference(tx, sub.gateway, { orderNumber: number }),
    );
    if (row && row.status !== 'paid') {
      await this.fulfilment.fulfil(row, {
        gatewayPaymentId: sub.gatewaySubscriptionId ?? undefined,
      });
    }
  }

  /** After a paid return of a subscription checkout (Reference `activateSubscriptionForOrder`). */
  async activateForOrder(
    order: OrderRow,
    gateway: string,
    payload: Record<string, unknown> | undefined,
  ): Promise<void> {
    const sub = await this.pendingForOrder(order, gateway);
    if (!sub) return; // not a subscription checkout
    const p = payload ?? {};
    await this.activate(sub, {
      gatewaySubscriptionId:
        text(p.gateway_subscription_id) ?? text(p.subscription) ?? sub.gatewaySubscriptionId,
      gatewayCustomerId: text(p.gateway_customer_id) ?? text(p.customer),
      periodEnd: (p.current_period_end as string | number | undefined) ?? null,
    });
  }

  async activate(
    sub: SubRow,
    a: {
      gatewaySubscriptionId?: string | null;
      gatewayCustomerId?: string | null;
      periodEnd?: string | number | null;
    },
  ): Promise<EventOutcome> {
    return this.store.tx(async (tx) => {
      const end = toDate(a.periodEnd);
      const prev = await tx.execute(
        sql`SELECT status FROM subscriptions WHERE org_id = ${sub.orgId} AND id = ${sub.id} FOR UPDATE`,
      );
      const was = (prev.rows[0] as { status: SubStatus } | undefined)?.status;
      // A cancelled or expired row stays that way: a late or replayed notification must not revive it.
      if (!was || was === 'canceled' || was === 'expired') return 'ignored' as const;
      await tx.execute(sql`
        UPDATE subscriptions SET status = 'active',
          gateway_subscription_id = COALESCE(${a.gatewaySubscriptionId ?? null}, gateway_subscription_id),
          gateway_customer_id = COALESCE(${a.gatewayCustomerId ?? null}, gateway_customer_id),
          current_period_end = COALESCE(${end ? end.toISOString() : null}::timestamptz, current_period_end)
        WHERE org_id = ${sub.orgId} AND id = ${sub.id}`);
      // Already active: a replay (the return after the webhook, or the provider redelivering) records nothing twice.
      if (was === 'active') return 'duplicate' as const;
      await this.syncWindow(tx, sub, end, false);
      await this.record(tx, sub, 'activated', {});
      return 'activated' as const;
    });
  }

  private async renew(sub: SubRow, evt: SubscriptionEvent): Promise<EventOutcome> {
    return this.store.tx(async (tx) => {
      // One provider payment is one renewal, however many times the notification is delivered.
      const seen = Array.isArray(sub.meta.payment_ids) ? (sub.meta.payment_ids as string[]) : [];
      if (evt.paymentId && seen.includes(evt.paymentId)) return 'duplicate' as const;
      const ids = evt.paymentId ? [...seen, evt.paymentId].slice(-KEEP_PAYMENT_IDS) : seen;
      const end = toDate(evt.periodEnd);
      const res = await tx.execute(sql`
        UPDATE subscriptions SET status = 'active', renewals_count = renewals_count + 1,
          current_period_end = COALESCE(${end ? end.toISOString() : null}::timestamptz, current_period_end),
          meta = COALESCE(meta, '{}'::jsonb) || ${JSON.stringify({ payment_ids: ids })}::jsonb
        WHERE org_id = ${sub.orgId} AND id = ${sub.id} AND status IN ('active', 'past_due')
        RETURNING id`);
      // A cancelled or expired subscription is not revived by a late renewal notice; a new purchase makes a new row.
      if (res.rows.length === 0) return 'ignored' as const;
      await this.syncWindow(tx, sub, end, true);
      await this.record(tx, sub, 'renewed', { payment: evt.paymentId ?? null });
      return 'renewed' as const;
    });
  }

  private async setStatus(
    sub: SubRow,
    status: 'canceled' | 'past_due',
    event: SubEvent,
    evt: SubscriptionEvent,
  ): Promise<EventOutcome> {
    return this.store.tx(async (tx) => {
      // The paid window is never shortened here: access continues to `plan_ends_at` whatever the provider says.
      await tx.execute(sql`
        UPDATE subscriptions SET status = ${status},
          canceled_at = CASE WHEN ${status} = 'canceled' THEN COALESCE(canceled_at, now()) ELSE canceled_at END
        WHERE org_id = ${sub.orgId} AND id = ${sub.id}`);
      await this.record(tx, sub, event, { payment: evt.paymentId ?? null });
      return status;
    });
  }

  /** The reconciler: the provider says the mandate is over (`canceled`/`expired`). The paid window is untouched. */
  async markEnded(sub: SubRow, status: 'canceled' | 'expired'): Promise<void> {
    if (sub.status === status) return;
    await this.store.tx(async (tx) => {
      await tx.execute(sql`
        UPDATE subscriptions SET status = ${status},
          canceled_at = CASE WHEN ${status} = 'canceled' THEN COALESCE(canceled_at, now()) ELSE canceled_at END
        WHERE org_id = ${sub.orgId} AND id = ${sub.id}`);
      await this.record(tx, sub, status === 'canceled' ? 'canceled' : 'expired', {
        via: 'reconciler',
      });
    });
  }

  /** Reconciler renewal: only when the provider is strictly ahead of the workspace's window. */
  async applyPolled(sub: SubRow, periodEnd: string | number | null | undefined): Promise<boolean> {
    const end = toDate(periodEnd);
    if (!end) return false;
    const ahead = await this.store.tx(async (tx) => {
      const cur = await this.currentEnd(tx, sub);
      return !cur || end.getTime() > cur.getTime();
    });
    if (!ahead) return false;
    if (sub.status === 'pending') {
      await this.finalizePendingOrder(sub);
      await this.activate(sub, { periodEnd: end.toISOString() });
    } else {
      await this.renew(sub, {
        type: 'renewed',
        subscriptionId: sub.gatewaySubscriptionId,
        periodEnd: end.toISOString(),
      });
    }
    return true;
  }

  // ---- the workspace window --------------------------------------------------------------------------------------------

  /** The end of what this subscription pays for: the workspace plan's window, or the add-on purchase's. */
  private async currentEnd(tx: Tx, sub: SubRow): Promise<Date | null> {
    if (sub.kind === 'addon') {
      const id = await this.linkAddon(tx, sub);
      if (id === null) return null;
      const r = await tx.execute(
        sql`SELECT ends_at FROM workspace_addons WHERE org_id = ${sub.orgId} AND id = ${id}`,
      );
      const v = (r.rows[0] as { ends_at: string | null } | undefined)?.ends_at ?? null;
      return v ? new Date(v) : null;
    }
    const st = await tx.execute(
      sql`SELECT plan_ends_at FROM org_plan_state WHERE org_id = ${sub.orgId}`,
    );
    const cur = (st.rows[0] as { plan_ends_at: string | null } | undefined)?.plan_ends_at ?? null;
    return cur ? new Date(cur) : null;
  }

  /** The add-on purchase this subscription renews: remembered on the row, or found through the order that created it. */
  private async linkAddon(tx: Tx, sub: SubRow): Promise<number | null> {
    if (sub.workspaceAddonId !== null) return sub.workspaceAddonId;
    const number = text(sub.meta.order_number);
    if (!number) return null;
    const r = await tx.execute(sql`
      SELECT a.id FROM workspace_addons a JOIN orders o ON o.org_id = a.org_id AND o.id = a.order_id
      WHERE a.org_id = ${sub.orgId} AND o.order_number = ${number} LIMIT 1`);
    const id = (r.rows[0] as { id: number | string } | undefined)?.id;
    if (id === undefined) return null;
    sub.workspaceAddonId = Number(id);
    await tx.execute(
      sql`UPDATE subscriptions SET workspace_addon_id = ${sub.workspaceAddonId} WHERE org_id = ${sub.orgId} AND id = ${sub.id}`,
    );
    return sub.workspaceAddonId;
  }

  /** The add-on twin of `syncWindow`: the purchase's own `ends_at` follows the provider; the workspace plan is never touched. */
  private async syncAddonWindow(
    tx: Tx,
    sub: SubRow,
    end: Date | null,
    extend: boolean,
  ): Promise<void> {
    const id = await this.linkAddon(tx, sub);
    if (id === null || !sub.planSlug) return;
    const cur = await this.currentEnd(tx, sub);
    const planRes = await tx.execute(
      sql`SELECT billing_unit, billing_duration FROM plans WHERE slug = ${sub.planSlug}`,
    );
    const plan = planRes.rows[0] as
      { billing_unit: BillingUnit; billing_duration: number } | undefined;
    if (!plan) return;
    const next = windowAfterEvent(new Date(), cur, end, extend, {
      unit: plan.billing_unit,
      duration: plan.billing_duration,
    });
    if (!next) return;
    await tx.execute(sql`
      UPDATE workspace_addons SET ends_at = ${next.toISOString()}::timestamptz, status = 'active'
      WHERE org_id = ${sub.orgId} AND id = ${id} AND status <> 'cancelled'`);
  }

  /** Reference `syncWorkspaceWindow`: align `plan_ends_at` with the provider's date, or add one cycle on a renewal with none. */
  private async syncWindow(tx: Tx, sub: SubRow, end: Date | null, extend: boolean): Promise<void> {
    if (sub.kind === 'addon') return this.syncAddonWindow(tx, sub, end, extend);
    if (!sub.planSlug) return;
    const st = await tx.execute(
      sql`SELECT plan_ends_at FROM org_plan_state WHERE org_id = ${sub.orgId} FOR UPDATE`,
    );
    const cur = (st.rows[0] as { plan_ends_at: string | null } | undefined)?.plan_ends_at ?? null;
    const planRes = await tx.execute(
      sql`SELECT billing_unit, billing_duration FROM plans WHERE slug = ${sub.planSlug}`,
    );
    const plan = planRes.rows[0] as
      { billing_unit: BillingUnit; billing_duration: number } | undefined;
    if (!plan) return;
    const next = windowAfterEvent(new Date(), cur ? new Date(cur) : null, end, extend, {
      unit: plan.billing_unit,
      duration: plan.billing_duration,
    });
    if (!next) return; // activation with no date: the order's fulfilment already set the window
    await tx.execute(sql`
      INSERT INTO org_plan_state (org_id, plan_ends_at, trial_ends_at, billing_cycle)
      VALUES (${sub.orgId}, ${next.toISOString()}, NULL, ${sub.billingCycle})
      ON CONFLICT (org_id) DO UPDATE SET plan_ends_at = EXCLUDED.plan_ends_at, trial_ends_at = NULL`);
    await tx.execute(sql`UPDATE organizations SET plan = ${sub.planSlug} WHERE id = ${sub.orgId}`);
  }

  private async record(
    tx: Tx,
    sub: SubRow,
    event: SubEvent,
    extra: Record<string, unknown>,
  ): Promise<void> {
    const delta = {
      event: { old: null, new: event },
      gateway: { old: null, new: sub.gateway },
      ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, { old: null, new: v }])),
    };
    await tx.execute(sql`
      INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta)
      VALUES (${sub.orgId}, NULL, 'system', 'subscriptions', ${sub.id}, 'update', ${JSON.stringify(delta)}::jsonb)`);
    await this.outbox.emit(tx, {
      aggregateModule: 'subscriptions',
      aggregateId: sub.id,
      eventType: `paygw.subscription.${event}`,
      orgId: sub.orgId,
      payload: { gateway: sub.gateway, plan: sub.planSlug, ...extra },
    });
  }
}
