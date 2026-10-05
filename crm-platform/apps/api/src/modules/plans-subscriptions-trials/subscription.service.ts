import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type BillingSubscription,
  type CancelSubscriptionResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { GatewayService } from '../platform-payment-gateways';

interface SubRow {
  id: string | number;
  gateway: string;
  gateway_subscription_id: string | null;
  gateway_customer_id: string | null;
  gateway_plan_id: string | null;
  status: 'active' | 'past_due';
  current_period_end: string | null;
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
  ) {}

  /** The latest active or past-due subscription, or null. A `pending` row (first charge unconfirmed) is not renewing yet. */
  async current(orgId: number): Promise<BillingSubscription | null> {
    const row = await this.db.txAs({ orgId, userId: null }, (tx) => this.latest(tx, orgId));
    return row
      ? {
          status: row.status,
          renewsAt: row.current_period_end ? new Date(row.current_period_end).toISOString() : null,
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
      SELECT id, gateway, gateway_subscription_id, gateway_customer_id, gateway_plan_id, status, current_period_end
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
