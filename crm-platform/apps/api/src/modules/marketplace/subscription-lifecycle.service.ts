import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import type { AddonFulfilmentListener, FulfilledAddon } from '../addons-extension-registry';
import { readAppPricing, APP_PRICING_COLUMNS } from './pricing-model';
import { PricingAccess } from './pricing-access.service';

type Raw = Record<string, unknown>;

export type SubscriptionEvent =
  'started' | 'renewed' | 'resubscribed' | 'comped' | 'canceled' | 'resumed' | 'lapsed';

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

    const created = await tx.execute(sql`
      INSERT INTO marketplace_subscriptions (org_id, app_id, pack_id, status, source, amount, currency, started_at, current_period_end)
      VALUES (${p.orgId}, ${p.marketplaceAppId}, ${p.packId}, 'active', 'purchase', ${pack.amount}::numeric, ${pack.currency},
              ${p.startsAt.toISOString()}::timestamptz, ${end}::timestamptz)
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
          current_period_end = GREATEST(current_period_end, ${end}::timestamptz)
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
      },
    );
    await this.resume(tx, p.orgId, p.marketplaceAppId, slug, 'subscription_paid');
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
    const due = await this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT s.org_id, s.id, s.app_id, a.uuid AS app_uuid, a.slug, ${APP_PRICING_COLUMNS}
        FROM marketplace_subscriptions s JOIN marketplace_apps a ON a.id = s.app_id
        WHERE s.status = 'active' AND ${NO_ENTITLEMENT}
        ORDER BY s.current_period_end NULLS LAST, s.id
        LIMIT ${limit}`);
      return res.rows as Raw[];
    });
    let lapsed = 0;
    let paused = 0;
    for (const r of due) {
      try {
        const out = await this.lapseOne(r);
        if (out.lapsed) lapsed += 1;
        if (out.paused) paused += 1;
      } catch (err) {
        this.logger.error({ err, subscription: r.id }, 'marketplace subscription sweep failed');
      }
    }
    return { lapsed, paused };
  }

  private async lapseOne(r: Raw): Promise<{ lapsed: boolean; paused: boolean }> {
    const orgId = Number(r.org_id);
    const pricing = readAppPricing(r);
    // Decided before the transaction: a free app, a plan that includes the app, or an override that lets the workspace use it all mean the
    // end of the subscription is not the end of the workspace's right to run the app. The subscription still lapses; the installation stays on.
    const ev = await (
      await this.access.evaluator(orgId)
    )({
      slug: r.slug as string,
      uuid: r.app_uuid as string,
      pricing,
      sub: { status: 'active' },
    });
    const keepOn = pricing.pricingModel === 'free' || ev.access === 'included' || ev.entitled;
    return this.db.privileged(async (tx) => {
      const lock = await tx.execute(sql`
        SELECT s.id, s.uuid, s.app_id FROM marketplace_subscriptions s
        WHERE s.org_id = ${orgId} AND s.id = ${Number(r.id)} AND s.status = 'active' AND ${NO_ENTITLEMENT}
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

/** True when the workspace has no active, unexpired purchase row of the subscription's add-on. The entitlement itself, read in SQL. */
const NO_ENTITLEMENT = sql`NOT EXISTS (
  SELECT 1 FROM workspace_addons w
   WHERE w.org_id = s.org_id AND w.package_id = s.pack_id AND w.status = 'active'
     AND (w.ends_at IS NULL OR w.ends_at > now()))`;
