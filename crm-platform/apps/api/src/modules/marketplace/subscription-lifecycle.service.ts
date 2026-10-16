import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { ERROR_CODES } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  addonLiveSql,
  type AddonFulfilmentListener,
  type AddonTermEvent,
  type FulfilledAddon,
} from '../addons-extension-registry';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { SubscriptionCancelService, type EndReason } from '../platform-payment-gateways';
import { readAppPricing, APP_PRICING_COLUMNS } from './pricing-model';
import { PricingAccess } from './pricing-access.service';

type Raw = Record<string, unknown>;

export type SubscriptionEvent =
  | 'started'
  | 'renewed'
  | 'resubscribed'
  | 'comped'
  | 'canceled'
  | 'resumed'
  | 'lapsed'
  /** The provider reported a failed renewal charge; the app keeps working for the grace days. */
  | 'payment_failed';

/** Who or what did it, for the audit trail. */
export type Cause =
  | { by: 'system' }
  | { by: 'workspace'; userId: number | null }
  | { by: 'operator'; operatorId: number };

/**
 * The privileged side of a subscription's life: everything that writes `marketplace_subscriptions` (which a workspace cannot) or
 * `workspace_addons` (the entitlement). Each method says which door it is behind:
 *
 *   onFulfilled    checkout's order finalisation, in the purchase's own transaction (registered with the add-ons domain)
 *   comp, cancel   the operator API, in the operator's privileged transaction
 *   sweep          the worker, once a minute: a subscription whose entitlement has run out is lapsed and its installation paused
 *
 * One rule runs through all of them: the subscription row FOLLOWS the entitlement. Access is decided by the add-ons domain's entitlement
 * service from the workspace's `workspace_addons` rows; this ledger records what that means to the Marketplace (renewed, ending, lapsed,
 * comped by whom), writes an audit row and an outbox event for every change, and pauses or resumes the installation. Pausing keeps the
 * app's data and settings, and resuming undoes only a pause the subscription caused, never an admin's own.
 */
@Injectable()
export class MarketSubscriptionLifecycle implements AddonFulfilmentListener {
  readonly name = 'marketplace-subscriptions';
  private readonly logger = new Logger(MarketSubscriptionLifecycle.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
    private readonly access: PricingAccess,
    private readonly plans: PlanEntitlementService,
    private readonly cancel: SubscriptionCancelService,
  ) {}

  // --- a payment arrives --------------------------------------------------------------------------------------------------------------

  /**
   * A paid order for the add-on of an app just created its purchase row. Creates the subscription, or renews, converts (from a trial or a
   * comp) or revives it, and switches a subscription-paused installation back on. Runs inside checkout's transaction, so the order, the
   * entitlement and this ledger commit together.
   */
  async onFulfilled(tx: Tx, p: FulfilledAddon): Promise<void> {
    if (p.marketplaceAppId === null) return;
    const appRes = await tx.execute(
      sql`SELECT a.slug FROM marketplace_apps a WHERE a.id = ${p.marketplaceAppId}`,
    );
    const slug = (appRes.rows[0] as Raw | undefined)?.slug as string | undefined;
    if (!slug) return;
    const packRes = await tx.execute(
      sql`SELECT amount::text AS amount, currency FROM plans WHERE id = ${p.packId}`,
    );
    const pack = packRes.rows[0] as { amount: string; currency: string };
    const end = p.endsAt ? p.endsAt.toISOString() : null;
    // The card renews it when the order that paid for it started a provider subscription (the buyer cannot opt out of one for a recurring
    // pack, and a one-time order never does): the page then says "renews on" instead of "paid until".
    const ord = p.orderId
      ? await tx.execute(
          sql`SELECT auto_renew FROM orders WHERE org_id = ${p.orgId} AND id = ${p.orderId}`,
        )
      : null;
    const autorenew = (ord?.rows[0] as { auto_renew: boolean } | undefined)?.auto_renew === true;

    const created = await tx.execute(sql`
      INSERT INTO marketplace_subscriptions
        (org_id, app_id, pack_id, status, source, amount, currency, started_at, current_period_end, autorenew)
      VALUES (${p.orgId}, ${p.marketplaceAppId}, ${p.packId}, 'active', 'purchase', ${pack.amount}::numeric, ${pack.currency},
              ${p.startsAt.toISOString()}::timestamptz, ${end}::timestamptz, ${autorenew})
      ON CONFLICT (org_id, app_id) DO NOTHING
      RETURNING id, uuid`);
    let sub = created.rows[0] as { id: string; uuid: string } | undefined;
    let event: SubscriptionEvent = 'started';
    let from: string | null = null;
    if (!sub) {
      const prevRes = await tx.execute(sql`
        SELECT id, uuid, status, source FROM marketplace_subscriptions
        WHERE org_id = ${p.orgId} AND app_id = ${p.marketplaceAppId} FOR UPDATE`);
      const prev = prevRes.rows[0] as { id: string; uuid: string; status: string; source: string };
      sub = prev;
      from = prev.status === 'lapsed' ? 'lapsed' : prev.source;
      event =
        prev.status === 'lapsed'
          ? 'resubscribed'
          : prev.source === 'purchase'
            ? 'renewed'
            : 'started';
      // Paying again is a decision to keep the app: a cancellation made earlier is taken back. A renewal never shortens the period.
      const renewed = event === 'renewed';
      await tx.execute(sql`
        UPDATE marketplace_subscriptions SET
          status = 'active', source = 'purchase', cancel_at_period_end = false, canceled_at = NULL, lapsed_at = NULL,
          amount = ${pack.amount}::numeric, currency = ${pack.currency}, pack_id = ${p.packId},
          comped_by_operator_id = NULL, comp_note = NULL,
          started_at = ${renewed ? sql`started_at` : sql`${p.startsAt.toISOString()}::timestamptz`},
          renewals_count = renewals_count + ${renewed ? 1 : 0},
          current_period_end = GREATEST(current_period_end, ${end}::timestamptz),
          -- any payment ends a failed-renewal state; an order that started a provider subscription (re)starts the card renewal
          payment_failed_at = NULL, grace_ends_at = NULL,
          autorenew = ${autorenew ? sql`true` : sql`(autorenew AND ${renewed})`},
          autorenew_stopped_at = ${autorenew ? sql`NULL` : sql`autorenew_stopped_at`}
        WHERE org_id = ${p.orgId} AND id = ${sub.id}`);
    }
    await this.note(
      tx,
      p.orgId,
      Number(sub.id),
      sub.uuid,
      slug,
      event,
      { by: 'system' },
      {
        source: 'purchase',
        from,
        orderId: p.orderId,
        periodEnd: end,
        ...(autorenew ? { autorenew: true } : {}),
      },
    );
    await this.resume(tx, p.orgId, p.marketplaceAppId, slug, 'subscription_paid');
  }

  // --- the provider acts on the card renewal -----------------------------------------------------------------------------------------

  /**
   * The payment provider's autopay subscription behind the app's add-on changed: the first charge went through, a renewal arrived, a renewal
   * failed, or the subscription ended. Runs in the payments domain's transaction (a webhook, the reconciler or a cancel), so the ledger
   * moves with the entitlement. The ledger follows what the add-on says: `current_period_end` is the purchase's own end after the event.
   */
  async onTermEvent(tx: Tx, e: AddonTermEvent): Promise<void> {
    if (e.marketplaceAppId === null) return;
    const res = await tx.execute(sql`
      SELECT s.id, s.uuid, s.status, s.source, s.cancel_at_period_end, s.payment_failed_at, a.slug
      FROM marketplace_subscriptions s JOIN marketplace_apps a ON a.id = s.app_id
      WHERE s.org_id = ${e.orgId} AND s.app_id = ${e.marketplaceAppId} FOR UPDATE OF s`);
    const s = res.rows[0] as
      | {
          id: string;
          uuid: string;
          status: string;
          source: string;
          cancel_at_period_end: boolean;
          payment_failed_at: string | null;
          slug: string;
        }
      | undefined;
    // No ledger row yet (the add-on was bought before the Marketplace sold it, or never recorded): nothing to follow.
    if (!s) return;
    const end = e.endsAt ? e.endsAt.toISOString() : null;
    const id = Number(s.id);
    const by: Cause = { by: 'system' };

    switch (e.kind) {
      case 'activated': {
        await tx.execute(sql`
          UPDATE marketplace_subscriptions SET
            autorenew = (source = 'purchase'), autorenew_stopped_at = NULL,
            current_period_end = GREATEST(current_period_end, ${end}::timestamptz)
          WHERE org_id = ${e.orgId} AND id = ${id}`);
        return;
      }
      case 'renewed': {
        const revived = s.status === 'lapsed';
        await tx.execute(sql`
          UPDATE marketplace_subscriptions SET
            status = 'active', lapsed_at = NULL, autorenew = (source = 'purchase'), autorenew_stopped_at = NULL,
            current_period_end = GREATEST(current_period_end, ${end}::timestamptz),
            renewals_count = renewals_count + 1, last_renewed_at = now(),
            payment_failed_at = NULL, grace_ends_at = NULL
          WHERE org_id = ${e.orgId} AND id = ${id}`);
        await this.note(tx, e.orgId, id, s.uuid, s.slug, revived ? 'resubscribed' : 'renewed', by, {
          source: 'provider',
          payment: e.paymentId,
          periodEnd: end,
          recovered: s.payment_failed_at !== null,
        });
        await this.resume(tx, e.orgId, e.marketplaceAppId, s.slug, 'subscription_paid');
        return;
      }
      case 'payment_failed': {
        // The provider retries and tells us each time: only the first failure of a run starts the clock and tells anyone.
        if (s.payment_failed_at !== null || s.status === 'lapsed') return;
        const days = await this.plans.graceDays();
        await tx.execute(sql`
          UPDATE marketplace_subscriptions SET
            payment_failed_at = now(),
            grace_ends_at = ${days > 0 ? sql`current_period_end + make_interval(days => ${days})` : sql`NULL`}
          WHERE org_id = ${e.orgId} AND id = ${id}`);
        await this.note(tx, e.orgId, id, s.uuid, s.slug, 'payment_failed', by, {
          source: 'provider',
          payment: e.paymentId,
          graceDays: days,
        });
        return;
      }
      case 'ended': {
        // A newer subscription replaced this one and now owns the ledger: its charge already set autorenew, and this end must not undo it.
        if (e.reason === 'superseded') return;
        await tx.execute(sql`
          UPDATE marketplace_subscriptions SET autorenew = false, autorenew_stopped_at = coalesce(autorenew_stopped_at, now())
          WHERE org_id = ${e.orgId} AND id = ${id}`);
        // A person or an operator who asked for this writes the cancellation (with who) itself. When the provider or the mandate's
        // expiry ended it, nobody did: the app simply will not renew, which is a cancellation at the end of the period paid for.
        const byProvider = e.reason === 'provider' || e.reason === 'expired';
        if (byProvider && s.status === 'active' && !s.cancel_at_period_end) {
          await tx.execute(sql`
            UPDATE marketplace_subscriptions SET cancel_at_period_end = true, canceled_at = coalesce(canceled_at, now())
            WHERE org_id = ${e.orgId} AND id = ${id}`);
          await this.note(tx, e.orgId, id, s.uuid, s.slug, 'canceled', by, {
            reason: e.reason,
            periodEnd: end,
          });
        }
        return;
      }
    }
  }

  /**
   * Ends the card renewal of a workspace's subscription at the payment provider BEFORE the ledger says it will not renew, so a workspace
   * that cancelled is never charged again. `atCycleEnd`: the provider stops at the end of the period already paid for (the workspace keeps
   * what it paid for); false stops it now. The provider is asked with no transaction open and must confirm: when it cannot (down, or the
   * gateway has no cancel), nothing is changed and the caller is told, because saying "cancelled" while the card is still charged is the one
   * thing this must never do. Returns whether a provider subscription was ended (false: the workspace had none).
   */
  async stopCardRenewal(
    orgId: number,
    packId: number,
    opts: {
      atCycleEnd: boolean;
      reason: EndReason;
      actor: { id: number | null; type: string };
    },
  ): Promise<boolean> {
    const ids = await this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT s.id FROM subscriptions s
        JOIN workspace_addons a ON a.org_id = s.org_id AND a.id = s.workspace_addon_id
        WHERE s.org_id = ${orgId} AND s.kind = 'addon' AND s.status IN ('active', 'past_due') AND a.package_id = ${packId}
        ORDER BY s.id`);
      return (res.rows as Array<{ id: string }>).map((r) => Number(r.id));
    });
    let ended = false;
    for (const id of ids) {
      const out = await this.cancel.endOne(orgId, id, {
        atCycleEnd: opts.atCycleEnd,
        reason: opts.reason,
        actor: opts.actor,
        strict: true,
      });
      // null: someone else got there first (a webhook, a second click): it is over, which is what was asked.
      if (out !== null && !providerStopped(out)) {
        throw new AppError(
          ERROR_CODES.MKT_RENEWAL_NOT_STOPPED,
          'The automatic renewal could not be stopped at the payment provider, so nothing was changed. Try again in a moment.',
          HttpStatus.BAD_GATEWAY,
        );
      }
      ended = true;
    }
    return ended;
  }

  /**
   * The app was withdrawn: every card renewal of its subscribers stops at the end of the period they paid for. Returns how many provider
   * subscriptions could NOT be stopped (the operator must finish them at the provider; they are logged). Never throws for one
   * subscription: the rest are still stopped.
   */
  async stopAllCardRenewals(
    appId: number,
    reason: EndReason,
  ): Promise<{ stopped: number; failed: number }> {
    const rows = await this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT s.org_id, s.id FROM subscriptions s
        JOIN workspace_addons a ON a.org_id = s.org_id AND a.id = s.workspace_addon_id
        JOIN plans p ON p.id = a.package_id
        WHERE p.marketplace_app_id = ${appId} AND s.kind = 'addon' AND s.status IN ('active', 'past_due')
        ORDER BY s.org_id, s.id`);
      return res.rows as Array<{ org_id: string; id: string }>;
    });
    let stopped = 0;
    let failed = 0;
    for (const r of rows) {
      try {
        const out = await this.cancel.endOne(Number(r.org_id), Number(r.id), {
          atCycleEnd: true,
          reason,
          actor: { id: null, type: 'system' },
          strict: true,
        });
        if (out === null || providerStopped(out)) stopped += 1;
        else failed += 1;
      } catch (err) {
        failed += 1;
        this.logger.error({ err, subscription: r.id }, 'stopping a card renewal failed');
      }
    }
    if (failed > 0)
      this.logger.error(
        { appId, failed },
        'some card renewals of a withdrawn app were not stopped at the provider',
      );
    return { stopped, failed };
  }

  // --- the operator -------------------------------------------------------------------------------------------------------------------

  /**
   * Gives a workspace the app free: an add-on purchase row with no order (for `months`, or with no end), and a subscription of source
   * `comp`. Refused for a workspace that pays and whose paid period is still running (comp would hide a real subscription).
   */
  async comp(
    tx: Tx,
    p: {
      orgId: number;
      app: { id: number; slug: string };
      packId: number;
      months: number | null;
      note: string;
      operatorId: number;
    },
  ): Promise<{ subscriptionUuid: string }> {
    const prevRes = await tx.execute(sql`
      SELECT id, uuid, status, source, current_period_end FROM marketplace_subscriptions
      WHERE org_id = ${p.orgId} AND app_id = ${p.app.id} FOR UPDATE`);
    const prev = prevRes.rows[0] as
      | {
          id: string;
          uuid: string;
          status: string;
          source: string;
          current_period_end: string | null;
        }
      | undefined;
    if (
      prev &&
      prev.status === 'active' &&
      prev.source === 'purchase' &&
      (prev.current_period_end === null || new Date(prev.current_period_end) > new Date())
    ) {
      throw new AppError(
        ERROR_CODES.MKT_SUBSCRIPTION_STATE,
        'This workspace already pays for the app. Cancel its subscription first if you want to comp it instead.',
        HttpStatus.CONFLICT,
      );
    }
    const endRes = await tx.execute(
      p.months === null
        ? sql`SELECT NULL::timestamptz AS e`
        : sql`SELECT now() + make_interval(months => ${p.months}) AS e`,
    );
    const end = (endRes.rows[0] as { e: string | null }).e;
    await tx.execute(sql`
      INSERT INTO workspace_addons (org_id, package_id, order_id, status, starts_at, ends_at)
      VALUES (${p.orgId}, ${p.packId}, NULL, 'active', now(), ${end}::timestamptz)`);
    let sub: { id: string; uuid: string };
    if (prev) {
      sub = prev;
      await tx.execute(sql`
        UPDATE marketplace_subscriptions SET
          status = 'active', source = 'comp', cancel_at_period_end = false, canceled_at = NULL, lapsed_at = NULL,
          amount = NULL, currency = NULL, pack_id = ${p.packId},
          autorenew = false, autorenew_stopped_at = NULL, payment_failed_at = NULL, grace_ends_at = NULL,
          started_at = CASE WHEN status = 'lapsed' THEN now() ELSE started_at END,
          current_period_end = ${end}::timestamptz, comped_by_operator_id = ${p.operatorId}, comp_note = ${p.note}
        WHERE org_id = ${p.orgId} AND id = ${prev.id}`);
    } else {
      const ins = await tx.execute(sql`
        INSERT INTO marketplace_subscriptions
          (org_id, app_id, pack_id, status, source, started_at, current_period_end, comped_by_operator_id, comp_note)
        VALUES (${p.orgId}, ${p.app.id}, ${p.packId}, 'active', 'comp', now(), ${end}::timestamptz, ${p.operatorId}, ${p.note})
        RETURNING id, uuid`);
      sub = ins.rows[0] as { id: string; uuid: string };
    }
    await this.note(
      tx,
      p.orgId,
      Number(sub.id),
      sub.uuid,
      p.app.slug,
      'comped',
      { by: 'operator', operatorId: p.operatorId },
      { source: 'comp', months: p.months, note: p.note, periodEnd: end },
    );
    await this.resume(tx, p.orgId, p.app.id, p.app.slug, 'subscription_comped');
    return { subscriptionUuid: sub.uuid };
  }

  /**
   * Cancels a workspace's subscription for the operator: at the end of the period it has paid for, or now. A subscription with no end
   * (a comp until revoked) has no period to wait for, so it ends now. Returns what the caller must do after the commit: `pause` means the
   * subscription has ended and its installation must be paused unless the workspace is entitled by other means (`pauseIfNotEntitled`).
   */
  async cancelByOperator(
    tx: Tx,
    p: { uuid: string; immediate: boolean; reason: string; operatorId: number },
  ): Promise<{
    orgId: number;
    appId: number;
    appSlug: string;
    subscriptionUuid: string;
    pause: boolean;
  }> {
    const res = await tx.execute(sql`
      SELECT s.org_id, s.id, s.uuid, s.app_id, s.pack_id, s.status, s.current_period_end, s.cancel_at_period_end, a.slug
      FROM marketplace_subscriptions s JOIN marketplace_apps a ON a.id = s.app_id
      WHERE s.uuid = ${p.uuid}::uuid FOR UPDATE OF s`);
    const s = res.rows[0] as
      | {
          org_id: string;
          id: string;
          uuid: string;
          app_id: string;
          pack_id: string;
          status: string;
          current_period_end: string | null;
          cancel_at_period_end: boolean;
          slug: string;
        }
      | undefined;
    if (!s)
      throw new AppError(
        ERROR_CODES.MKT_SUBSCRIPTION_NOT_FOUND,
        'Subscription not found',
        HttpStatus.NOT_FOUND,
      );
    const orgId = Number(s.org_id);
    const appId = Number(s.app_id);
    const out = { orgId, appId, appSlug: s.slug, subscriptionUuid: s.uuid };
    const cause: Cause = { by: 'operator', operatorId: p.operatorId };

    if (s.status === 'lapsed') {
      // Already over: asking for "now" again re-runs the pause (a step that failed after the commit), asking to wait is a mistake.
      if (p.immediate) return { ...out, pause: true };
      throw new AppError(
        ERROR_CODES.MKT_SUBSCRIPTION_STATE,
        'This subscription has already ended.',
        HttpStatus.CONFLICT,
      );
    }
    if (!p.immediate && s.current_period_end !== null) {
      await tx.execute(sql`
        UPDATE marketplace_subscriptions
           SET cancel_at_period_end = true, canceled_at = coalesce(canceled_at, now())
         WHERE org_id = ${orgId} AND id = ${s.id}`);
      await this.note(tx, orgId, Number(s.id), s.uuid, s.slug, 'canceled', cause, {
        reason: p.reason,
        immediate: false,
        periodEnd: s.current_period_end,
      });
      return { ...out, pause: false };
    }
    await tx.execute(sql`
      UPDATE workspace_addons SET status = 'cancelled'
       WHERE org_id = ${orgId} AND package_id = ${s.pack_id} AND status = 'active'`);
    await tx.execute(sql`
      UPDATE marketplace_subscriptions
         SET status = 'lapsed', lapsed_at = now(), cancel_at_period_end = true, canceled_at = coalesce(canceled_at, now()),
             current_period_end = least(current_period_end, now())
       WHERE org_id = ${orgId} AND id = ${s.id}`);
    await this.note(tx, orgId, Number(s.id), s.uuid, s.slug, 'canceled', cause, {
      reason: p.reason,
      immediate: true,
    });
    await this.note(tx, orgId, Number(s.id), s.uuid, s.slug, 'lapsed', cause, { reason: p.reason });
    return { ...out, pause: true };
  }

  /**
   * The app was withdrawn (the kill switch): every subscription to it stops renewing. What was paid for runs to its end, and the
   * operator can comp or refund by hand; the installations are already off.
   */
  async cancelAllForApp(tx: Tx, appId: number, appSlug: string, reason: string): Promise<number> {
    const res = await tx.execute(sql`
      WITH k AS (
        UPDATE marketplace_subscriptions SET cancel_at_period_end = true, canceled_at = coalesce(canceled_at, now())
         WHERE app_id = ${appId} AND status = 'active' AND NOT cancel_at_period_end
        RETURNING org_id, id, uuid
      ), au AS (
        INSERT INTO audit_log (org_id, actor_type, module, record_id, action, delta)
        SELECT org_id, 'system', 'marketplace_subscriptions', id, 'update',
               jsonb_build_object('event', jsonb_build_object('old', NULL, 'new', 'canceled'),
                                  'reason', jsonb_build_object('old', NULL, 'new', ${reason}::text))
          FROM k
        RETURNING 1
      ), ob AS (
        INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
        SELECT org_id, 'marketplace_subscriptions', id, 'marketplace.subscription.canceled',
               jsonb_build_object('subscription', uuid, 'app', ${appSlug}::text, 'by', 'system', 'reason', ${reason}::text)
          FROM k
        RETURNING 1
      )
      SELECT (SELECT count(*) FROM k)::int AS n`);
    return Number((res.rows[0] as { n: number }).n);
  }

  // --- the clock ----------------------------------------------------------------------------------------------------------------------

  /**
   * Lapses every active subscription whose entitlement has run out, and pauses its installation. Idempotent and safe to run in several
   * workers at once: each subscription is locked and re-checked in its own transaction, so a payment that lands meanwhile wins (its row
   * is no longer lapsed-eligible) and a second sweep finds nothing left to do.
   */
  async sweep(limit = 200): Promise<{ lapsed: number; paused: number }> {
    const noEntitlement = noEntitlementSql(await this.plans.graceDays());
    const due = await this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT s.org_id, s.id, s.app_id, a.uuid AS app_uuid, a.slug, ${APP_PRICING_COLUMNS}
        FROM marketplace_subscriptions s JOIN marketplace_apps a ON a.id = s.app_id
        WHERE s.status = 'active' AND ${noEntitlement}
        ORDER BY s.current_period_end NULLS LAST, s.id
        LIMIT ${limit}`);
      return res.rows as Raw[];
    });
    let lapsed = 0;
    let paused = 0;
    for (const r of due) {
      try {
        const out = await this.lapseOne(r, noEntitlement);
        if (out.lapsed) lapsed += 1;
        if (out.paused) paused += 1;
      } catch (err) {
        this.logger.error({ err, subscription: r.id }, 'marketplace subscription sweep failed');
      }
    }
    return { lapsed, paused };
  }

  private async lapseOne(
    r: Raw,
    noEntitlement: SQL,
  ): Promise<{ lapsed: boolean; paused: boolean }> {
    const orgId = Number(r.org_id);
    const pricing = readAppPricing(r);
    // Decided before the transaction: a free app, a plan that includes the app, or an override that lets the workspace use it all mean the
    // end of the subscription is not the end of the workspace's right to run the app. The subscription still lapses; the installation stays on.
    const ev = await (
      await this.access.evaluator(orgId)
    )({
      appId: Number(r.app_id),
      slug: r.slug as string,
      uuid: r.app_uuid as string,
      pricing,
      sub: { status: 'active' },
    });
    const keepOn = pricing.pricingModel === 'free' || ev.access === 'included' || ev.entitled;
    return this.db.privileged(async (tx) => {
      const lock = await tx.execute(sql`
        SELECT s.id, s.uuid, s.app_id FROM marketplace_subscriptions s
        WHERE s.org_id = ${orgId} AND s.id = ${Number(r.id)} AND s.status = 'active' AND ${noEntitlement}
        FOR UPDATE OF s SKIP LOCKED`);
      const s = lock.rows[0] as { id: string; uuid: string; app_id: string } | undefined;
      if (!s) return { lapsed: false, paused: false };
      await tx.execute(sql`
        UPDATE marketplace_subscriptions SET status = 'lapsed', lapsed_at = now() WHERE org_id = ${orgId} AND id = ${s.id}`);
      await this.note(
        tx,
        orgId,
        Number(s.id),
        s.uuid,
        r.slug as string,
        'lapsed',
        { by: 'system' },
        {},
      );
      const n = keepOn ? 0 : await this.pause(tx, orgId, Number(s.app_id), r.slug as string);
      return { lapsed: true, paused: n > 0 };
    });
  }

  /**
   * After an operator ended a subscription now: pauses the installation unless the workspace still has the app another way. Idempotent.
   */
  async pauseIfNotEntitled(orgId: number, appId: number): Promise<number> {
    const appRes = await this.db.privileged((tx) =>
      tx.execute(sql`
        SELECT a.uuid AS app_uuid, a.slug, ${APP_PRICING_COLUMNS} FROM marketplace_apps a WHERE a.id = ${appId}`),
    );
    const a = appRes.rows[0] as Raw | undefined;
    if (!a) return 0;
    const pricing = readAppPricing(a);
    const ev = await (
      await this.access.evaluator(orgId)
    )({
      appId,
      slug: a.slug as string,
      uuid: a.app_uuid as string,
      pricing,
      sub: null,
    });
    if (pricing.pricingModel === 'free' || ev.access === 'included' || ev.entitled) return 0;
    return this.db.privileged((tx) => this.pause(tx, orgId, appId, a.slug as string));
  }

  // --- pausing and resuming an installation -----------------------------------------------------------------------------------------

  /** Pauses the workspace's active installation of the app because its subscription ended. Data and settings stay. Returns how many. */
  async pause(tx: Tx, orgId: number, appId: number, appSlug: string): Promise<number> {
    const res = await tx.execute(sql`
      WITH i AS (
        UPDATE workspace_app_installations
           SET status = 'disabled', disabled_at = now(), paused_by_subscription = true
         WHERE org_id = ${orgId} AND app_id = ${appId} AND status = 'active'
        RETURNING id, uuid
      ), cn AS (
        UPDATE marketplace_connections n SET status = 'paused'
          FROM i WHERE n.org_id = ${orgId} AND n.installation_id = i.id AND n.status = 'active'
        RETURNING 1
      ), au AS (
        INSERT INTO audit_log (org_id, actor_type, module, record_id, action, delta)
        SELECT ${orgId}, 'system', 'marketplace', id, 'update',
               jsonb_build_object('status', jsonb_build_object('old', 'active', 'new', 'disabled'),
                                  'reason', jsonb_build_object('old', NULL, 'new', 'subscription_ended'))
          FROM i
        RETURNING 1
      ), ob AS (
        INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
        SELECT ${orgId}, 'marketplace', id, 'marketplace.app.disabled',
               jsonb_build_object('installation', uuid, 'app', ${appSlug}::text, 'reason', 'subscription_ended')
          FROM i
        RETURNING 1
      )
      SELECT (SELECT count(*) FROM i)::int AS n`);
    return Number((res.rows[0] as { n: number }).n);
  }

  /** Switches back on an installation that a subscription ended paused. An admin's own pause is left alone. */
  async resume(
    tx: Tx,
    orgId: number,
    appId: number,
    appSlug: string,
    reason: string,
  ): Promise<number> {
    const res = await tx.execute(sql`
      WITH i AS (
        UPDATE workspace_app_installations
           SET status = 'active', disabled_at = NULL, paused_by_subscription = false
         WHERE org_id = ${orgId} AND app_id = ${appId} AND paused_by_subscription
        RETURNING id, uuid
      ), cn AS (
        UPDATE marketplace_connections n SET status = 'active'
          FROM i WHERE n.org_id = ${orgId} AND n.installation_id = i.id AND n.status = 'paused'
        RETURNING 1
      ), au AS (
        INSERT INTO audit_log (org_id, actor_type, module, record_id, action, delta)
        SELECT ${orgId}, 'system', 'marketplace', id, 'update',
               jsonb_build_object('status', jsonb_build_object('old', 'disabled', 'new', 'active'),
                                  'reason', jsonb_build_object('old', NULL, 'new', ${reason}::text))
          FROM i
        RETURNING 1
      ), ob AS (
        INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
        SELECT ${orgId}, 'marketplace', id, 'marketplace.app.enabled',
               jsonb_build_object('installation', uuid, 'app', ${appSlug}::text, 'reason', ${reason}::text)
          FROM i
        RETURNING 1
      )
      SELECT (SELECT count(*) FROM i)::int AS n`);
    return Number((res.rows[0] as { n: number }).n);
  }

  // --- the trail ----------------------------------------------------------------------------------------------------------------------

  /** The audit row and the outbox event of one change, in the transaction that made it. Names what changed, never a payment detail. */
  async note(
    tx: Tx,
    orgId: number,
    subscriptionId: number,
    subscriptionUuid: string,
    appSlug: string,
    event: SubscriptionEvent,
    cause: Cause,
    extra: Record<string, unknown>,
  ): Promise<void> {
    const by =
      cause.by === 'operator'
        ? `operator:${cause.operatorId}`
        : cause.by === 'workspace'
          ? `user:${cause.userId ?? 0}`
          : 'system';
    const delta: Record<string, { old: unknown; new: unknown }> = {
      event: { old: null, new: event },
      by: { old: null, new: by },
      ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, { old: null, new: v }])),
    };
    await tx.execute(sql`
      INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta)
      VALUES (${orgId}, ${cause.by === 'workspace' ? cause.userId : null}, ${cause.by === 'workspace' ? 'user' : 'system'},
              'marketplace_subscriptions', ${subscriptionId}, 'update', ${JSON.stringify(delta)}::jsonb)`);
    await this.outbox.emit(tx, {
      orgId,
      aggregateModule: 'marketplace_subscriptions',
      aggregateId: subscriptionId,
      eventType: `marketplace.subscription.${event}`,
      payload: { subscription: subscriptionUuid, app: appSlug, by, ...extra },
    });
  }
}

/**
 * True when the workspace has no purchase row of the subscription's add-on that still counts: active and unexpired, or (while the card
 * renewal is being retried) past its end by less than the grace days. The entitlement itself, read in SQL with the add-ons domain's own
 * rule (`addonLiveSql`), so the ledger lapses exactly when access does.
 */
const noEntitlementSql = (graceDays: number): SQL => sql`NOT EXISTS (
  SELECT 1 FROM workspace_addons a
   WHERE a.org_id = s.org_id AND a.package_id = s.pack_id AND ${sql.raw(addonLiveSql(graceDays))})`;

/** The provider no longer charges: it said ok, or there was no provider subscription to stop. */
const providerStopped = (r: { result: 'ok' | 'failed' | 'unsupported'; reason?: string }): boolean =>
  r.result === 'ok' || (r.result === 'unsupported' && r.reason === 'no_gateway_subscription_id');
