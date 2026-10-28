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

type Charge = Awaited<ReturnType<RefundService['chargesFor']>>[number];

/** A subscription with its organization, app and pack: the columns every read of a target takes. */
const SUB_SELECT = sql`
  SELECT s.org_id, s.id, s.uuid, s.source, s.billing_period, s.current_period_end, a.slug AS app_slug, a.name AS app_name,
         o.uuid AS org_uuid, o.name AS org_name, p.slug AS pack_slug, p.id AS pack_id
  FROM marketplace_subscriptions s
  JOIN marketplace_apps a ON a.id = s.app_id
  JOIN organizations o ON o.id = s.org_id
  JOIN plans p ON p.id = s.pack_id`;

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

/** One subscription of a page, its target read, or the reason its read failed (that one is counted as failed; the rest go on). */
type Built = { ok: true; target: Target } | { ok: false; uuid: string; error: unknown };

const state = (message: string): AppError =>
  new AppError(ERROR_CODES.MKT_SUBSCRIPTION_STATE, message, HttpStatus.CONFLICT);

/** The most subscriptions one bulk run looks at; the answer says when there are more, and the next run continues after the last one. */
const BULK_LIMIT = 200;

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
      const res = await tx.execute(sql`${SUB_SELECT}
        WHERE s.app_id = ${app.id} AND s.source = 'purchase' AND s.id > ${after}
          AND s.current_period_end IS NOT NULL AND s.current_period_end > ${killedAt.toISOString()}::timestamptz
        ORDER BY s.id LIMIT ${BULK_LIMIT + 1}`);
      return res.rows as Raw[];
    });
    const hasMore = rows.length > BULK_LIMIT;
    const batch = hasMore ? rows.slice(0, BULK_LIMIT) : rows;
    // The page is read together: a constant number of reads for the page, not several per subscription.
    const built = await this.targetsFor(batch);

    const totals = new Map<string, bigint>();
    const sample: MarketWithdrawnRefund['sample'] = [];
    let refundable = 0;
    let refunded = 0;
    let failed = 0;
    let skipped = 0;
    for (const b of built) {
      if (!b.ok) {
        failed += 1;
        this.logger.warn(
          { err: b.error, subscription: b.uuid },
          'refunding the unused time of a withdrawn app failed',
        );
        if (sample.length < 25)
          sample.push({ workspace: '', amountMinor: '0', currency: '', outcome: 'failed' });
        continue;
      }
      const t = b.target;
      try {
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
          { err, subscription: t.uuid },
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
    const row = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`${SUB_SELECT} WHERE s.uuid = ${uuid}::uuid`);
      return res.rows[0] as Raw | undefined;
    });
    if (!row)
      throw new AppError(
        ERROR_CODES.MKT_SUBSCRIPTION_NOT_FOUND,
        'Subscription not found',
        HttpStatus.NOT_FOUND,
      );
    const [built] = await this.targetsFor([row]);
    if (!built!.ok) throw built!.error;
    return built!.target;
  }

  /**
   * The targets of a page of subscriptions, read together: the latest payment of each (set-based reads; one provider call per provider
   * subscription, not one per subscription) and what was already returned on each payment (one read for the page).
   */
  private async targetsFor(rows: Raw[]): Promise<Built[]> {
    if (rows.length === 0) return [];
    const payments = await this.lastPayments(rows);
    const pairs = new Map<string, { orgId: number; paymentId: string }>();
    for (const r of rows) {
      const p = payments.get(Number(r.id));
      if (p && !(p instanceof Error))
        pairs.set(`${Number(r.org_id)}:${p.paymentId}`, {
          orgId: Number(r.org_id),
          paymentId: p.paymentId,
        });
    }
    const refunded = await this.alreadyRefunded([...pairs.values()]);
    return rows.map((r): Built => {
      const p = payments.get(Number(r.id)) ?? null;
      if (p instanceof Error) return { ok: false, uuid: String(r.uuid), error: p };
      const orgId = Number(r.org_id);
      return {
        ok: true,
        target: {
          orgId,
          orgUuid: String(r.org_uuid),
          orgName: String(r.org_name),
          id: Number(r.id),
          uuid: String(r.uuid),
          appSlug: String(r.app_slug),
          appName: String(r.app_name),
          periodEnd: r.current_period_end ? new Date(String(r.current_period_end)) : null,
          billingPeriod: r.billing_period === 'yearly' ? 'yearly' : 'monthly',
          source: String(r.source),
          payment: p,
          alreadyMinor: p === null ? 0n : (refunded.get(`${orgId}:${p.paymentId}`) ?? 0n),
        },
      };
    });
  }

  /**
   * The latest payment of each purchased subscription in `rows`: the newest paid charge of its provider subscription when it has one (a
   * renewal has no order), else the newest paid order for the app's add-on. The provider is asked for the charges, so a provider that is
   * down is an error for that subscription, never a guess. Subscriptions that share a provider subscription share one provider call.
   */
  private async lastPayments(rows: Raw[]): Promise<Map<number, Payment | null | Error>> {
    const out = new Map<number, Payment | null | Error>();
    const purchased = rows.filter((r) => r.source === 'purchase').map((r) => Number(r.id));
    if (purchased.length === 0) return out;
    const inList = (ids: number[]) =>
      sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      );

    const providerRows = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT s.id, (
          SELECT sb.uuid FROM subscriptions sb
          JOIN workspace_addons wa ON wa.org_id = sb.org_id AND wa.id = sb.workspace_addon_id
          WHERE sb.org_id = s.org_id AND sb.kind = 'addon' AND sb.gateway_subscription_id IS NOT NULL
            AND wa.package_id = s.pack_id
          ORDER BY sb.id DESC LIMIT 1) AS provider
        FROM marketplace_subscriptions s WHERE s.id IN (${inList(purchased)})`);
      return res.rows as Raw[];
    });
    const providers = new Map<number, string | null>();
    for (const r of providerRows)
      providers.set(Number(r.id), r.provider ? String(r.provider) : null);

    const charges = new Map<string, Charge[] | Error>();
    const pending: number[] = [];
    for (const id of purchased) {
      const provider = providers.get(id) ?? null;
      if (provider === null) {
        pending.push(id);
        continue;
      }
      if (!charges.has(provider)) {
        try {
          charges.set(provider, await this.refunds.chargesFor(provider));
        } catch (err) {
          charges.set(provider, err instanceof Error ? err : new Error(String(err)));
        }
      }
      const got = charges.get(provider)!;
      if (got instanceof Error) {
        out.set(id, got);
        continue;
      }
      const c = got
        .filter(
          (x): x is Charge & { paymentId: string } =>
            x.status === 'paid' && typeof x.paymentId === 'string',
        )
        .sort((a, b) => String(b.paidAt ?? '').localeCompare(String(a.paidAt ?? '')))[0];
      if (c) {
        out.set(id, {
          kind: 'charge',
          providerSubscriptionUuid: provider,
          paymentId: c.paymentId,
          paidMinor: BigInt(c.amountMinor),
          currency: c.currency,
        });
      } else {
        pending.push(id);
      }
    }

    if (pending.length > 0) {
      const orderRows = await this.store.tx(async (tx) => {
        const res = await tx.execute(sql`
          SELECT s.id, o.uuid, o.gateway_payment_id, o.currency, o.total_amount::text AS total_amount
          FROM marketplace_subscriptions s
          JOIN plans p ON p.id = s.pack_id
          LEFT JOIN LATERAL (
            SELECT uuid, gateway_payment_id, currency, total_amount FROM orders
            WHERE org_id = s.org_id AND kind = 'addon' AND plan_slug = p.slug AND status = 'paid'
              AND gateway_payment_id IS NOT NULL AND gateway_payment_id !~ '^sub_'
            ORDER BY paid_at DESC NULLS LAST, id DESC LIMIT 1
          ) o ON true
          WHERE s.id IN (${inList(pending)})`);
        return res.rows as Raw[];
      });
      for (const r of orderRows) {
        const id = Number(r.id);
        out.set(
          id,
          r.gateway_payment_id === null || r.gateway_payment_id === undefined
            ? null
            : {
                kind: 'order',
                orderUuid: String(r.uuid),
                paymentId: String(r.gateway_payment_id),
                paidMinor: toMinor(String(r.total_amount), String(r.currency)),
                currency: String(r.currency),
              },
        );
      }
    }
    return out;
  }

  /** What was already returned on each (organization, payment) pair, in one read. */
  private async alreadyRefunded(
    pairs: Array<{ orgId: number; paymentId: string }>,
  ): Promise<Map<string, bigint>> {
    const out = new Map<string, bigint>();
    if (pairs.length === 0) return out;
    const res = await this.store.tx((tx) =>
      tx.execute(sql`
        SELECT org_id, gateway_payment_id, COALESCE(SUM(amount_minor), 0)::text AS total FROM order_refunds
        WHERE status <> 'failed'
          AND (org_id, gateway_payment_id) IN (${sql.join(
            pairs.map((p) => sql`(${p.orgId}, ${p.paymentId})`),
            sql`, `,
          )})
        GROUP BY org_id, gateway_payment_id`),
    );
    for (const r of res.rows as Raw[])
      out.set(`${Number(r.org_id)}:${String(r.gateway_payment_id)}`, BigInt(String(r.total)));
    return out;
  }
}

/** "499.00" in INR as 49900n, using the currency's own exponent (the contracts' money helper). */
function toMinor(major: string, currency: string): bigint {
  return majorToMinor(major, currency) ?? 0n;
}
