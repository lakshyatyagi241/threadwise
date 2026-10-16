import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  majorToMinor,
  type MarketProration,
  type MarketWithdrawnRefund,
  type ProrateSubscriptionInput,
  type RefundResponse,
  type RefundWithdrawnAppInput,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService } from '../auth';
import { RefundService } from '../platform-payment-gateways';
import { OperatorCatalogueStore } from './operator-catalogue.store';
import { OperatorPricingService } from './operator-pricing.service';
import { MarketSubscriptionLifecycle } from './subscription-lifecycle.service';
import { parseAppRef } from './marketplace-rules';
import { refundableMinor, unusedMinor } from './proration-rules';

type Raw = Record<string, unknown>;

/** Where the money to return was paid: a one-time order, or one charge of the provider's subscription. */
type Payment =
  | { kind: 'order'; orderUuid: string; paymentId: string; paidMinor: bigint; currency: string }
  | {
      kind: 'charge';
      providerSubscriptionUuid: string;
      paymentId: string;
      paidMinor: bigint;
      currency: string;
    };

interface Target {
  orgId: number;
  orgUuid: string;
  orgName: string;
  id: number;
  uuid: string;
  appSlug: string;
  appName: string;
  periodEnd: Date | null;
  billingPeriod: 'monthly' | 'yearly';
  source: string;
  payment: Payment | null;
  alreadyMinor: bigint;
}

/** The most subscriptions one bulk run looks at; the answer says when there are more, and the next run continues after the last one. */
const BULK_LIMIT = 200;

const state = (message: string): AppError =>
  new AppError(ERROR_CODES.MKT_SUBSCRIPTION_STATE, message, HttpStatus.CONFLICT);

/**
 * Returns the unused part of what a workspace paid for an app, through the existing refund service (BL-077). Two doors:
 *   one subscription  the operator ends a subscription early, or fixes a mistake: the share of the last payment that is still ahead, from now
 *   a withdrawn app   the kill switch took the app away mid-period: every subscriber is owed the share from the moment it was withdrawn
 * Nothing here talks to a payment provider itself: `RefundService` claims the amount first (so two clicks cannot refund twice), asks the
 * provider with no transaction open and records the answer. What is owed is `refundableMinor`: the unused share of the LAST payment minus
 * what was already returned on it, so running the tool again returns nothing more. A dry run (the default) changes nothing.
 */
@Injectable()
export class ProrationService {
  private readonly logger = new Logger(ProrationService.name);

  constructor(
    private readonly store: OperatorCatalogueStore,
    private readonly refunds: RefundService,
    private readonly lifecycle: MarketSubscriptionLifecycle,
    private readonly pricing: OperatorPricingService,
    private readonly audit: AuthAuditService,
  ) {}

  // --- one subscription -----------------------------------------------------------------------------------------------------------

  async prorate(
    uuid: string,
    input: ProrateSubscriptionInput,
    operatorId: number,
  ): Promise<MarketProration> {
    const t = await this.target(uuid);
    const out = await this.settle(t, new Date(), input.reason, input.dryRun, operatorId);
    let ended = false;
    // Ending it too is the operator's own cancellation (now, with its audit row), after the money has been returned.
    if (!input.dryRun && input.endNow && out.refund !== null && out.refund.status !== 'failed') {
      await this.pricing.cancel(uuid, { immediate: true, reason: input.reason }, operatorId);
      ended = true;
    }
    return { ...out, ended };
  }

  // --- a withdrawn app ------------------------------------------------------------------------------------------------------------

  async refundWithdrawnApp(
    ref: string,
    input: RefundWithdrawnAppInput,
    operatorId: number,
  ): Promise<MarketWithdrawnRefund> {
    const parsed = parseAppRef(ref);
    const app = await this.store.tx((tx) =>
      parsed ? this.store.app(tx, parsed) : Promise.resolve(null),
    );
    if (!app)
      throw new AppError(ERROR_CODES.MKT_APP_NOT_FOUND, 'App not found', HttpStatus.NOT_FOUND);
    if (app.status !== 'killed' || app.killedAt === null)
      throw state('Only a withdrawn (killed) app can be refunded in bulk.');
    const killedAt = app.killedAt;
    const after = input.after ? Number(input.after) : 0;
    const rows = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT s.uuid, s.id FROM marketplace_subscriptions s
        WHERE s.app_id = ${app.id} AND s.source = 'purchase' AND s.id > ${after}
          AND s.current_period_end IS NOT NULL AND s.current_period_end > ${killedAt.toISOString()}::timestamptz
        ORDER BY s.id LIMIT ${BULK_LIMIT + 1}`);
      return res.rows as Array<{ uuid: string; id: string }>;
    });
    const hasMore = rows.length > BULK_LIMIT;
    const batch = hasMore ? rows.slice(0, BULK_LIMIT) : rows;

    const totals = new Map<string, bigint>();
    const sample: MarketWithdrawnRefund['sample'] = [];
    let refundable = 0;
    let refunded = 0;
    let failed = 0;
    let skipped = 0;
    for (const r of batch) {
      try {
        const t = await this.target(r.uuid);
        const out = await this.settle(t, killedAt, input.reason, input.dryRun, operatorId);
        const owed = BigInt(out.refundableMinor);
        if (owed <= 0n) {
          skipped += 1;
          continue;
        }
        refundable += 1;
        const outcome = input.dryRun
          ? ('would_refund' as const)
          : out.refund !== null && out.refund.status !== 'failed'
            ? ('refunded' as const)
            : ('failed' as const);
        if (outcome === 'refunded') refunded += 1;
        if (outcome === 'failed') failed += 1;
        if (outcome !== 'failed')
          totals.set(out.currency!, (totals.get(out.currency!) ?? 0n) + owed);
        if (sample.length < 25)
          sample.push({
            workspace: t.orgName,
            amountMinor: out.refundableMinor,
            currency: out.currency!,
            outcome,
          });
      } catch (err) {
        failed += 1;
        this.logger.warn(
          { err, subscription: r.uuid },
          'refunding the unused time of a withdrawn app failed',
        );
        if (sample.length < 25)
          sample.push({ workspace: '', amountMinor: '0', currency: '', outcome: 'failed' });
      }
    }
    if (!input.dryRun) {
      await this.store.tx((tx) =>
        this.audit.record(tx, {
          event: 'platform.market.withdrawn_app_refunded',
          status: failed > 0 ? 'warning' : 'success',
          payload: { app: app.slug, operator: operatorId, refunded, failed, reason: input.reason },
        }),
      );
    }
    return {
      dryRun: input.dryRun,
      considered: batch.length,
      refundable,
      refunded,
      failed,
      skipped,
      hasMore,
      next: hasMore ? String(batch[batch.length - 1]!.id) : null,
      totals: [...totals].map(([currency, amount]) => ({
        currency,
        amountMinor: amount.toString(),
      })),
      sample,
    };
  }

  // --- the shared core ------------------------------------------------------------------------------------------------------------

  /** Works out what is owed for one subscription from `from`, and (unless a dry run) returns it. */
  private async settle(
    t: Target,
    from: Date,
    reason: string,
    dryRun: boolean,
    operatorId: number,
  ): Promise<MarketProration> {
    const owed =
      t.payment !== null && t.periodEnd !== null && t.source === 'purchase'
        ? refundableMinor({
            paidMinor: t.payment.paidMinor,
            periodEnd: t.periodEnd,
            billingPeriod: t.billingPeriod,
            from,
            alreadyRefundedMinor: t.alreadyMinor,
          })
        : 0n;
    const view: MarketProration = {
      subscriptionId: t.uuid,
      workspace: { id: t.orgUuid, name: t.orgName },
      app: { slug: t.appSlug, name: t.appName },
      currency: t.payment?.currency ?? null,
      paidMinor: (t.payment?.paidMinor ?? 0n).toString(),
      unusedMinor:
        t.payment && t.periodEnd
          ? unusedMinor({
              paidMinor: t.payment.paidMinor,
              periodEnd: t.periodEnd,
              billingPeriod: t.billingPeriod,
              from,
            }).toString()
          : '0',
      alreadyRefundedMinor: t.alreadyMinor.toString(),
      refundableMinor: owed.toString(),
      periodEnd: t.periodEnd ? t.periodEnd.toISOString() : null,
      billingPeriod: t.billingPeriod,
      source: t.payment ? t.payment.kind : null,
      dryRun,
      refund: null,
      ended: false,
    };
    if (dryRun || owed <= 0n || t.payment === null) return view;

    const req = { amountMinor: owed.toString(), reason };
    const refund: RefundResponse =
      t.payment.kind === 'order'
        ? await this.refunds.refundOrder(t.payment.orderUuid, req, operatorId)
        : await this.refunds.refundSubscriptionCharge(
            t.payment.providerSubscriptionUuid,
            { ...req, paymentId: t.payment.paymentId, endSubscription: false },
            operatorId,
          );
    await this.store.tx(async (tx) => {
      await this.lifecycle.note(
        tx,
        t.orgId,
        t.id,
        t.uuid,
        t.appSlug,
        'refunded',
        { by: 'operator', operatorId },
        {
          amountMinor: owed.toString(),
          currency: t.payment!.currency,
          reason,
          status: refund.status,
        },
      );
      await this.audit.record(tx, {
        event: 'platform.market.subscription_refunded',
        status: refund.status === 'failed' ? 'failure' : 'success',
        orgId: t.orgId,
        payload: {
          app: t.appSlug,
          operator: operatorId,
          amountMinor: owed.toString(),
          currency: t.payment!.currency,
          status: refund.status,
        },
      });
    });
    return { ...view, refund };
  }

  /** The subscription, the payment its current period came from, and what was already returned on that payment. */
  private async target(uuid: string): Promise<Target> {
    const sub = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT s.org_id, s.id, s.uuid, s.source, s.billing_period, s.current_period_end, a.slug AS app_slug, a.name AS app_name,
               o.uuid AS org_uuid, o.name AS org_name, p.slug AS pack_slug, p.id AS pack_id
        FROM marketplace_subscriptions s
        JOIN marketplace_apps a ON a.id = s.app_id
        JOIN organizations o ON o.id = s.org_id
        JOIN plans p ON p.id = s.pack_id
        WHERE s.uuid = ${uuid}::uuid`);
      return res.rows[0] as Raw | undefined;
    });
    if (!sub)
      throw new AppError(
        ERROR_CODES.MKT_SUBSCRIPTION_NOT_FOUND,
        'Subscription not found',
        HttpStatus.NOT_FOUND,
      );
    const orgId = Number(sub.org_id);
    const payment = sub.source === 'purchase' ? await this.lastPayment(orgId, sub) : null;
    const already =
      payment === null
        ? 0n
        : await this.store.tx(async (tx) => {
            const res = await tx.execute(sql`
              SELECT COALESCE(SUM(amount_minor), 0)::text AS total FROM order_refunds
              WHERE org_id = ${orgId} AND gateway_payment_id = ${payment.paymentId} AND status <> 'failed'`);
            return BigInt(String((res.rows[0] as Raw).total));
          });
    return {
      orgId,
      orgUuid: String(sub.org_uuid),
      orgName: String(sub.org_name),
      id: Number(sub.id),
      uuid: String(sub.uuid),
      appSlug: String(sub.app_slug),
      appName: String(sub.app_name),
      periodEnd: sub.current_period_end ? new Date(String(sub.current_period_end)) : null,
      billingPeriod: sub.billing_period === 'yearly' ? 'yearly' : 'monthly',
      source: String(sub.source),
      payment,
      alreadyMinor: already,
    };
  }

  /**
   * The latest payment of the subscription: the newest paid charge of its provider subscription when it has one (a renewal has no order),
   * else the newest paid order for the app's add-on. The provider is asked for the charges, so a provider that is down is an error here,
   * never a guess.
   */
  private async lastPayment(orgId: number, sub: Raw): Promise<Payment | null> {
    const provider = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT sb.uuid FROM subscriptions sb
        JOIN workspace_addons wa ON wa.org_id = sb.org_id AND wa.id = sb.workspace_addon_id
        WHERE sb.org_id = ${orgId} AND sb.kind = 'addon' AND sb.gateway_subscription_id IS NOT NULL
          AND wa.package_id = ${Number(sub.pack_id)}
        ORDER BY sb.id DESC LIMIT 1`);
      return (res.rows[0] as { uuid: string } | undefined)?.uuid ?? null;
    });
    if (provider !== null) {
      const charges = (await this.refunds.chargesFor(provider))
        .filter(
          (c): c is typeof c & { paymentId: string } =>
            c.status === 'paid' && typeof c.paymentId === 'string',
        )
        .sort((a, b) => String(b.paidAt ?? '').localeCompare(String(a.paidAt ?? '')));
      const c = charges[0];
      if (c)
        return {
          kind: 'charge',
          providerSubscriptionUuid: provider,
          paymentId: c.paymentId,
          paidMinor: BigInt(c.amountMinor),
          currency: c.currency,
        };
    }
    const order = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT uuid, gateway_payment_id, currency, total_amount::text AS total_amount FROM orders
        WHERE org_id = ${orgId} AND kind = 'addon' AND plan_slug = ${String(sub.pack_slug)} AND status = 'paid'
          AND gateway_payment_id IS NOT NULL AND gateway_payment_id !~ '^sub_'
        ORDER BY paid_at DESC NULLS LAST, id DESC LIMIT 1`);
      return res.rows[0] as Raw | undefined;
    });
    if (!order) return null;
    return {
      kind: 'order',
      orderUuid: String(order.uuid),
      paymentId: String(order.gateway_payment_id),
      paidMinor: toMinor(String(order.total_amount), String(order.currency)),
      currency: String(order.currency),
    };
  }
}

/** "499.00" in INR as 49900n, using the currency's own exponent (the contracts' money helper). */
function toMinor(major: string, currency: string): bigint {
  return majorToMinor(major, currency) ?? 0n;
}
