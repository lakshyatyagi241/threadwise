import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  currencyExponent,
  minorToMajor,
  type BillingSubscription,
  type CancelSubscriptionResponse,
  type SubscriptionCharge,
  type SubscriptionChargesResponse,
  type SubscriptionItem,
  type SubscriptionListResponse,
  type SyncSubscriptionResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { GatewayService, SubscriptionReconcilerService } from '../platform-payment-gateways';

interface SubRow {
  id: string | number;
  gateway: string;
  gateway_subscription_id: string | null;
  gateway_customer_id: string | null;
  gateway_plan_id: string | null;
  status: 'active' | 'past_due';
  current_period_end: string | null;
  created_at?: string | Date | null;
  meta?: { activatedAt?: unknown; previousBillingAt?: unknown } | null;
}

/**
 * Subscriptions of a workspace (TW-PLAN-012): what makes a plan renew, and the way to stop it. Another domain (the payment gateways'
 * recurring checkout) creates the rows; this reads them and cancels. All of it acts on the caller's workspace (RLS on `subscriptions`).
 *
 * Cancel keeps the paid period: `plan_ends_at` is untouched, and the plan lapses to free when it passes. The local row is ALWAYS marked
 * cancelled, even when the gateway call fails, so it is never treated as renewing (Reference's rule). Unlike Reference the outcome of the
 * remote call is recorded on the row (`meta.cancel`) and in the audit trail, so a failed remote cancel is visible to the operator.
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly gateways: GatewayService,
    private readonly outbox: OutboxService,
    private readonly reconciler: SubscriptionReconcilerService,
  ) {}

  // ---- managing subscriptions (the workspace's own: RLS on `subscriptions`) -------------------------------------------

  /** Every subscription of the workspace, newest first: its plan and each add-on, renewing or not. */
  async list(): Promise<SubscriptionListResponse> {
    const ctx = RequestContextStore.require();
    const rows = await this.db.txAs({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      const res = await tx.execute(
        sql`${SELECT_ITEM} WHERE s.org_id = ${ctx.orgId} ORDER BY s.created_at DESC, s.id DESC LIMIT 50`,
      );
      return res.rows as unknown as ItemRow[];
    });
    return { data: rows.map(toItem) };
  }

  /**
   * What the provider charged this subscription, cycle by cycle, with its own receipt page. When the provider cannot be asked (no
   * such call, or it is down) the workspace's own paid orders for the plan are shown instead, and the response says so.
   */
  async charges(uuid: string): Promise<SubscriptionChargesResponse> {
    const ctx = RequestContextStore.require();
    const sub = await this.mine(uuid);
    if (sub.gateway_subscription_id) {
      const live = await this.chargesFromProvider(sub);
      if (live) return { source: 'provider', data: live };
    }
    const orders = await this.db.txAs({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT order_number, total_amount::text AS total, currency, paid_at, created_at FROM orders
        WHERE org_id = ${ctx.orgId} AND status = 'paid' AND plan_slug = ${sub.plan_id}
        ORDER BY paid_at DESC NULLS LAST, id DESC LIMIT 24`);
      return res.rows as Array<Record<string, string | null>>;
    });
    return {
      source: 'orders',
      data: orders.map((o) => ({
        id: String(o.order_number),
        amount: Number(o.total).toFixed(currencyExponent(String(o.currency))),
        currency: String(o.currency),
        status: 'paid' as const,
        issuedAt: iso(o.created_at),
        paidAt: iso(o.paid_at),
        receiptUrl: null,
      })),
    };
  }

  /** "Refresh from the provider": the same poll the worker does, now, for one subscription. */
  async sync(uuid: string): Promise<SyncSubscriptionResponse> {
    const ctx = RequestContextStore.require();
    const sub = await this.mine(uuid);
    const outcome = await this.reconciler.syncNow(ctx.orgId, Number(sub.id));
    const fresh = await this.mine(uuid);
    return { outcome, subscription: toItem(fresh) };
  }

  /** Stop one subscription (plan or add-on) from renewing; the paid period keeps running. */
  async cancelById(uuid: string): Promise<CancelSubscriptionResponse> {
    const sub = await this.mine(uuid);
    if (sub.status !== 'active' && sub.status !== 'past_due') {
      throw new AppError(
        ERROR_CODES.PLAN_NO_SUBSCRIPTION,
        'No active subscription to cancel.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const addonUuid = sub.kind === 'addon' ? await this.addonUuidOf(sub) : null;
    return this.cancelRow(
      {
        id: sub.id,
        gateway: sub.gateway,
        gateway_subscription_id: sub.gateway_subscription_id,
        gateway_customer_id: sub.gateway_customer_id,
        gateway_plan_id: sub.gateway_plan_id,
        status: sub.status,
        current_period_end: sub.current_period_end
          ? new Date(sub.current_period_end).toISOString()
          : null,
      },
      addonUuid,
    );
  }

  private async mine(uuid: string): Promise<ItemRow> {
    const ctx = RequestContextStore.require();
    const row = await this.db.txAs({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      const res = await tx.execute(
        sql`${SELECT_ITEM} WHERE s.org_id = ${ctx.orgId} AND s.uuid = ${uuid}::uuid`,
      );
      return (res.rows[0] as unknown as ItemRow | undefined) ?? null;
    });
    if (!row) throw AppError.notFound('Subscription', uuid);
    return row;
  }

  private async addonUuidOf(sub: ItemRow): Promise<string | null> {
    const ctx = RequestContextStore.require();
    const row = await this.db.txAs({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT a.uuid FROM workspace_addons a
        JOIN subscriptions s ON s.org_id = a.org_id AND s.workspace_addon_id = a.id
        WHERE s.org_id = ${ctx.orgId} AND s.id = ${sub.id}`);
      return res.rows[0] as { uuid: string } | undefined;
    });
    return row?.uuid ?? null;
  }

  private async chargesFromProvider(sub: ItemRow): Promise<SubscriptionCharge[] | null> {
    try {
      const gateway = await this.gateways.bySlug(sub.gateway);
      const driver = gateway ? this.gateways.driverFor(gateway) : null;
      if (!driver?.listSubscriptionCharges || !sub.gateway_subscription_id) return null;
      const list = await driver.listSubscriptionCharges({
        gatewaySubscriptionId: sub.gateway_subscription_id,
        gatewayCustomerId: sub.gateway_customer_id,
        gatewayPlanId: sub.gateway_plan_id,
      });
      if (list === null) return null;
      return list.map((c) => ({
        id: c.id,
        amount: minorToMajor(c.amountMinor, c.currency),
        currency: c.currency,
        status: c.status,
        issuedAt: c.issuedAt,
        paidAt: c.paidAt,
        // Only an https page is ever linked: the address comes from a provider's answer.
        receiptUrl: c.receiptUrl && /^https:\/\//i.test(c.receiptUrl) ? c.receiptUrl : null,
      }));
    } catch (err) {
      this.logger.warn({ err, gateway: sub.gateway }, 'listing the provider charges failed');
      return null;
    }
  }

  /** The latest active or past-due subscription, or null. A `pending` row (first charge unconfirmed) is not renewing yet. */
  async current(orgId: number): Promise<BillingSubscription | null> {
    const row = await this.db.txAs({ orgId, userId: null }, (tx) => this.latest(tx, orgId));
    return row
      ? {
          status: row.status,
          renewsAt: row.current_period_end ? new Date(row.current_period_end).toISOString() : null,
          subscriptionId: row.gateway_subscription_id,
          // The import records the old activation and last billing dates in `meta`; a subscription created here started when it was created.
          activatedAt: validIso(row.meta?.activatedAt) ?? validIso(row.created_at),
          previousBillingAt: validIso(row.meta?.previousBillingAt),
        }
      : null;
  }

  async cancel(): Promise<CancelSubscriptionResponse> {
    const ctx = RequestContextStore.require();
    const row = await this.db.txAs({ orgId: ctx.orgId, userId: ctx.userId }, (tx) =>
      this.latest(tx, ctx.orgId),
    );
    return this.cancelRow(row, null);
  }

  /** Stop one add-on purchase from renewing (`:id` is the workspace add-on's uuid); the paid term keeps running to its `ends_at`. */
  async cancelAddon(addonUuid: string): Promise<CancelSubscriptionResponse> {
    const ctx = RequestContextStore.require();
    const row = await this.db.txAs({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT s.id, s.gateway, s.gateway_subscription_id, s.gateway_customer_id, s.gateway_plan_id, s.status,
               s.current_period_end
        FROM subscriptions s JOIN workspace_addons a ON a.org_id = s.org_id AND a.id = s.workspace_addon_id
        WHERE s.org_id = ${ctx.orgId} AND a.uuid = ${addonUuid}::uuid AND s.kind = 'addon'
          AND s.status IN ('active', 'past_due')
        ORDER BY s.id DESC LIMIT 1`);
      return (res.rows[0] as unknown as SubRow | undefined) ?? null;
    });
    return this.cancelRow(row, addonUuid);
  }

  private async cancelRow(
    row: SubRow | null,
    addonUuid: string | null,
  ): Promise<CancelSubscriptionResponse> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;
    if (!row) {
      throw new AppError(
        ERROR_CODES.PLAN_NO_SUBSCRIPTION,
        'No active subscription to cancel.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // The provider is called with no transaction open: a slow gateway must never hold a database connection.
    const remote = await this.cancelRemote(row);

    return this.db.txAs({ orgId, userId: ctx.userId }, async (tx) => {
      const res = await tx.execute(sql`
        UPDATE subscriptions
        SET status = 'canceled', canceled_at = now(),
            meta = coalesce(meta, '{}'::jsonb) || ${JSON.stringify({ cancel: remote })}::jsonb
        WHERE org_id = ${orgId} AND id = ${row.id} AND status IN ('active', 'past_due')
        RETURNING id`);
      if (res.rows.length === 0) {
        // A webhook or a second click got there first: the subscription is already cancelled, which is what was asked.
        this.logger.debug({ orgId }, 'subscription was already cancelled');
      }
      await tx.execute(sql`
        INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
        VALUES (${orgId}, ${ctx.actorId}, ${ctx.actorType}, 'subscriptions', ${row.id}, 'update',
          ${JSON.stringify({ status: { old: row.status, new: 'canceled' }, remote: { old: null, new: remote.result } })}::jsonb,
          ${ctx.requestId ?? null})`);
      await this.outbox.emit(tx, {
        aggregateModule: 'subscriptions',
        aggregateId: Number(row.id),
        eventType: addonUuid ? 'addon.subscription_canceled' : 'plan.subscription_canceled',
        payload: { gateway: row.gateway, remote: remote.result },
      });
      const state = addonUuid
        ? await tx.execute(
            sql`SELECT ends_at AS plan_ends_at FROM workspace_addons WHERE org_id = ${orgId} AND uuid = ${addonUuid}::uuid`,
          )
        : await tx.execute(sql`SELECT plan_ends_at FROM org_plan_state WHERE org_id = ${orgId}`);
      const end =
        (state.rows[0] as { plan_ends_at: string | null } | undefined)?.plan_ends_at ?? null;
      return {
        status: 'canceled' as const,
        remote: remote.result,
        planEndsAt: end ? new Date(end).toISOString() : null,
      };
    });
  }

  private async latest(tx: Tx, orgId: number): Promise<SubRow | null> {
    const res = await tx.execute(sql`
      SELECT id, gateway, gateway_subscription_id, gateway_customer_id, gateway_plan_id, status, current_period_end,
             created_at, meta
      FROM subscriptions
      WHERE org_id = ${orgId} AND kind = 'plan' AND status IN ('active', 'past_due')
      ORDER BY created_at DESC, id DESC LIMIT 1`);
    return (res.rows[0] as unknown as SubRow | undefined) ?? null;
  }

  private async cancelRemote(
    row: SubRow,
  ): Promise<{ result: 'ok' | 'failed' | 'unsupported'; reason?: string }> {
    if (!row.gateway_subscription_id)
      return { result: 'unsupported', reason: 'no_gateway_subscription_id' };
    try {
      const gateway = await this.gateways.bySlug(row.gateway);
      if (!gateway) return { result: 'unsupported', reason: 'gateway_not_configured' };
      const driver = this.gateways.driverFor(gateway);
      if (!driver.cancelSubscription)
        return { result: 'unsupported', reason: 'driver_has_no_cancel' };
      const out = await driver.cancelSubscription({
        gatewaySubscriptionId: row.gateway_subscription_id,
        gatewayCustomerId: row.gateway_customer_id,
        gatewayPlanId: row.gateway_plan_id,
      });
      return out.ok ? { result: 'ok' } : { result: 'failed', reason: out.reason };
    } catch (err) {
      this.logger.warn({ err, gateway: row.gateway }, 'gateway cancel threw');
      return { result: 'failed', reason: 'exception' };
    }
  }
}

const SELECT_ITEM = sql`
  SELECT s.id, s.uuid, s.kind, s.plan_id, s.status, s.amount::text AS amount, s.currency, s.billing_cycle, s.gateway,
         s.gateway_subscription_id, s.gateway_customer_id, s.gateway_plan_id, s.current_period_end, s.renewals_count,
         s.canceled_at, s.created_at, s.meta, COALESCE(p.name, s.plan_id, '') AS item_name
  FROM subscriptions s LEFT JOIN plans p ON p.slug = s.plan_id`;

interface ItemRow {
  id: string | number;
  uuid: string;
  kind: 'plan' | 'addon';
  plan_id: string | null;
  status: SubscriptionItem['status'] & ('active' | 'past_due' | 'pending' | 'canceled' | 'expired');
  amount: string;
  currency: string;
  billing_cycle: string;
  gateway: string;
  gateway_subscription_id: string | null;
  gateway_customer_id: string | null;
  gateway_plan_id: string | null;
  current_period_end: string | Date | null;
  renewals_count: number | string;
  canceled_at: string | Date | null;
  created_at: string | Date;
  meta: { cancel?: unknown } | null;
  item_name: string;
}

/** An ISO instant from a stored value, or null when it is missing or not a date. */
function validIso(v: unknown): string | null {
  if (typeof v !== 'string' && !(v instanceof Date)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

function toItem(r: ItemRow): SubscriptionItem {
  const renewing = r.status === 'active' || r.status === 'past_due';
  return {
    id: r.uuid,
    kind: r.kind === 'addon' ? 'addon' : 'plan',
    name: r.item_name,
    planSlug: r.plan_id,
    status: r.status,
    amount: Number(r.amount).toFixed(currencyExponent(r.currency)),
    currency: r.currency,
    billingCycle: r.billing_cycle === 'yearly' ? 'yearly' : 'monthly',
    gateway: r.gateway,
    currentPeriodEnd: iso(r.current_period_end),
    renewalsCount: Number(r.renewals_count),
    autoRenew: renewing && !r.meta?.cancel,
    paymentFailed: r.status === 'past_due',
    canceledAt: iso(r.canceled_at),
    createdAt: iso(r.created_at) as string,
  };
}
