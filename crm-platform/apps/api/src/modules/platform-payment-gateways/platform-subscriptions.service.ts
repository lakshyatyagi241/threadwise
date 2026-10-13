import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  currencyExponent,
  type AdminCancelSubscriptionRequest,
  type AdminCancelSubscriptionResponse,
  type AdminSubscriptionRow,
  type AdminSubscriptionsQuery,
  type AdminSubscriptionsResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService } from '../auth';
import { likeOf } from './admin-billing.repository';
import { PaygwStore } from './paygw.store';
import { SubscriptionCancelService } from './subscription-cancel.service';
import { SubscriptionReconcilerService } from './subscription-reconciler.service';

const PAGE_SIZE = 25;
type Raw = Record<string, unknown>;

/**
 * The operator's view of every workspace's subscriptions (the Razorpay mandates behind plans and add-ons), and the two things an
 * operator does to one: end it (at the provider, now or at the end of the paid cycle) and refresh it from the provider.
 */
@Injectable()
export class PlatformSubscriptionsService {
  constructor(
    private readonly store: PaygwStore,
    private readonly cancel: SubscriptionCancelService,
    private readonly reconciler: SubscriptionReconcilerService,
    private readonly audit: AuthAuditService,
  ) {}

  private operatorId(): number {
    const ctx = RequestContextStore.require();
    if (ctx.actorId === null || ctx.actorId === undefined) throw AppError.unauthenticated();
    return ctx.actorId;
  }

  async list(q: AdminSubscriptionsQuery): Promise<AdminSubscriptionsResponse> {
    const where: SQL[] = [];
    if (q.status !== 'all') where.push(sql`s.status = ${q.status}`);
    if (q.kind !== 'all') where.push(sql`s.kind = ${q.kind}`);
    if (q.gateway) where.push(sql`s.gateway = ${q.gateway}`);
    if (q.q) {
      const like = likeOf(q.q);
      where.push(
        sql`(org.name ILIKE ${like} OR org.slug ILIKE ${like} OR s.gateway_subscription_id ILIKE ${like})`,
      );
    }
    const filter = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;
    return this.store.tx(async (tx) => {
      const page = await tx.execute(sql`
        SELECT s.uuid, s.kind, s.status, s.gateway, s.gateway_subscription_id, s.currency, s.amount::text AS amount,
               s.billing_cycle, s.current_period_end, s.renewals_count, s.canceled_at, s.created_at, s.meta,
               COALESCE(p.name, s.plan_id, '') AS item_name,
               org.uuid AS ws_uuid, org.name AS ws_name, org.slug AS ws_slug,
               count(*) OVER () AS total_rows
        FROM subscriptions s
        JOIN organizations org ON org.id = s.org_id
        LEFT JOIN plans p ON p.slug = s.plan_id
        ${filter}
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT ${PAGE_SIZE} OFFSET ${(q.page - 1) * PAGE_SIZE}`);
      const kpi = await tx.execute(sql`
        SELECT count(*) FILTER (WHERE status = 'active')::int AS active,
               count(*) FILTER (WHERE status = 'past_due')::int AS past_due,
               count(*) FILTER (WHERE status = 'canceled')::int AS canceled
        FROM subscriptions`);
      const k = (kpi.rows as Raw[])[0]!;
      const rows = page.rows as Raw[];
      return {
        data: rows.map(toRow),
        total: rows[0] ? Number(rows[0].total_rows) : 0,
        page: q.page,
        pageSize: PAGE_SIZE,
        kpis: {
          active: Number(k.active),
          pastDue: Number(k.past_due),
          canceled: Number(k.canceled),
        },
      };
    });
  }

  async end(
    uuid: string,
    body: AdminCancelSubscriptionRequest,
  ): Promise<AdminCancelSubscriptionResponse> {
    const operatorId = this.operatorId();
    const target = await this.find(uuid);
    const out = await this.cancel.endOne(target.orgId, target.id, {
      atCycleEnd: body.atCycleEnd,
      reason: 'operator',
      actor: { id: operatorId, type: 'platform_operator' },
    });
    await this.store.tx((tx) =>
      this.audit.record(tx, {
        event: 'platform.subscription.canceled',
        status: out ? 'success' : 'failure',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: {
          subscription: uuid,
          atCycleEnd: body.atCycleEnd,
          remote: out?.result ?? 'already_ended',
        },
      }),
    );
    return { remote: out?.result ?? 'ok', alreadyEnded: out === null };
  }

  async sync(uuid: string): Promise<{ outcome: string }> {
    const target = await this.find(uuid);
    return { outcome: await this.reconciler.syncNow(target.orgId, target.id) };
  }

  private async find(uuid: string): Promise<{ orgId: number; id: number }> {
    const row = await this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT org_id, id FROM subscriptions WHERE uuid = ${uuid}::uuid`,
      );
      return (res.rows as Raw[])[0];
    });
    if (!row) throw AppError.notFound('Subscription', uuid);
    return { orgId: Number(row.org_id), id: Number(row.id) };
  }
}

function toRow(r: Raw): AdminSubscriptionRow {
  const meta = (r.meta as { cancel?: { result?: string } } | null) ?? {};
  const currency = String(r.currency);
  return {
    id: String(r.uuid),
    workspace: { id: String(r.ws_uuid), name: String(r.ws_name), slug: String(r.ws_slug) },
    kind: r.kind === 'addon' ? 'addon' : 'plan',
    name: String(r.item_name),
    status: r.status as AdminSubscriptionRow['status'],
    gateway: String(r.gateway),
    gatewaySubscriptionId:
      typeof r.gateway_subscription_id === 'string' ? r.gateway_subscription_id : null,
    currency,
    amount: Number(r.amount).toFixed(currencyExponent(currency)),
    billingCycle: r.billing_cycle === 'yearly' ? 'yearly' : 'monthly',
    currentPeriodEnd: r.current_period_end
      ? new Date(String(r.current_period_end)).toISOString()
      : null,
    renewalsCount: Number(r.renewals_count),
    canceledAt: r.canceled_at ? new Date(String(r.canceled_at)).toISOString() : null,
    cancelFailed: meta.cancel?.result === 'failed' || meta.cancel?.result === 'unsupported',
    createdAt: new Date(String(r.created_at)).toISOString(),
  };
}
