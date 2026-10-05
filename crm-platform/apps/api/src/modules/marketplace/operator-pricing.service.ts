import { HttpStatus, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  ERROR_CODES,
  PLAN_FEATURE_DEFS,
  coreFeatureDefault,
  marketEntitlementKey,
  marketPackSlug,
  normaliseMarketMoney,
  type CancelOperatorSubscriptionInput,
  type CompSubscriptionInput,
  type GrandfatherSubscriptionsInput,
  type MarketGrandfatherResult,
  type MarketOperatorApp,
  type MarketOperatorSubscription,
  type MarketOperatorSubscriptionList,
  type MarketOperatorSubscriptionListQuery,
  type MarketSubscriptionStatus,
  type MarketSubscriptionSummary,
  type SetMarketPricingInput,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService } from '../auth';
import { ModuleRegistryService } from '../addons-extension-registry';
import {
  PlanEntitlementService,
  resolveFeature,
  type Entitlements,
} from '../plans-subscriptions-trials';
import { toApp } from './operator-catalogue.service';
import { OperatorCatalogueStore } from './operator-catalogue.store';
import { decodeKeyset, encodeKeyset, likePattern, parseAppRef } from './marketplace-rules';
import { MarketSubscriptionLifecycle } from './subscription-lifecycle.service';
import { iso } from './sql-helpers';

type Raw = Record<string, unknown>;

/**
 * Per plan feature: the workspaces that already use it, found by what they have created. Lets the grandfather action reach the workspaces of a
 * feature whose registry default was switched off. Appointments: any booking type or appointment.
 */
const USAGE_PROBES: Record<string, SQL> = {
  appointment_booking: sql`SELECT DISTINCT org_id FROM booking_types UNION SELECT DISTINCT org_id FROM appointments`,
};

/** The subscription status a person sees, in SQL: ended, canceling, trialing or comped, active (the same precedence as `deriveSubscriptionStatus`). */
const DERIVED_STATUS = sql.raw(`
  CASE WHEN s.status = 'lapsed' OR (s.current_period_end IS NOT NULL AND s.current_period_end <= now()) THEN 'ended'
       WHEN s.cancel_at_period_end THEN 'canceling'
       WHEN s.source = 'trial' THEN 'trialing'
       WHEN s.source = 'comp' THEN 'comped'
       ELSE 'active' END`);

const toSubscription = (r: Raw): MarketOperatorSubscription => ({
  id: r.uuid as string,
  app: { id: r.app_uuid as string, slug: r.app_slug as string, name: r.app_name as string },
  workspace: { id: r.org_uuid as string, name: r.org_name as string },
  status: r.dstatus as MarketSubscriptionStatus,
  source: r.source as MarketOperatorSubscription['source'],
  amount: (r.amount as string | null) ?? null,
  currency: (r.currency as string | null) ?? null,
  startedAt: iso(r.started_at)!,
  currentPeriodEnd: iso(r.current_period_end),
  trialEndsAt: iso(r.trial_ends_at),
  canceledAt: iso(r.canceled_at),
  lapsedAt: iso(r.lapsed_at),
  renewals: Number(r.renewals_count),
  cancelAtPeriodEnd: r.cancel_at_period_end as boolean,
  compNote: (r.comp_note as string | null) ?? null,
  compBy: (r.comp_by as string | null) ?? null,
});

const SUBSCRIPTION_SELECT = sql.raw(`
  s.id, s.uuid, s.org_id, s.source, s.amount::text AS amount, s.currency, s.started_at, s.current_period_end, s.trial_ends_at,
  s.canceled_at, s.lapsed_at, s.renewals_count, s.cancel_at_period_end, s.comp_note, s.started_at::text AS k0,
  a.uuid AS app_uuid, a.slug AS app_slug, a.name AS app_name, o.uuid AS org_uuid, o.name AS org_name, op.full_name AS comp_by`);
const SUBSCRIPTION_FROM = sql`
  FROM marketplace_subscriptions s
  JOIN marketplace_apps a ON a.id = s.app_id
  JOIN organizations o ON o.id = s.org_id
  LEFT JOIN platform_operators op ON op.id = s.comped_by_operator_id`;

/**
 * The operator's money decisions (`platform.market.pricing`): what an app costs and who gets it free, comping a workspace, cancelling a
 * subscription, and the subscriptions view. All on the platform store; every change writes its audit event in the same transaction.
 *
 * There is no second billing system. Setting a price creates or updates the billing add-on that sells the app (a `plans` row of kind
 * `addon`: one month, the app's price, granting the one feature key that entitles a workspace), so checkout, the gateways, orders, coupons
 * and tax are the existing ones, and `AddonEntitlementService` decides access from the workspace's purchase rows.
 *
 * Price changes: the listing's price is read at the moment of every order, so a change applies to NEW subscriptions and to the NEXT payment
 * of an existing one, exactly as editing an ordinary add-on does. A period already paid for is never touched, refunded or re-priced. The
 * subscription remembers what the last payment was, so the workspace's page can say "the next payment will be ...".
 */
@Injectable()
export class OperatorPricingService {
  constructor(
    private readonly store: OperatorCatalogueStore,
    private readonly audit: AuthAuditService,
    private readonly lifecycle: MarketSubscriptionLifecycle,
    private readonly registry: ModuleRegistryService,
    private readonly plans: PlanEntitlementService,
  ) {}

  // --- pricing -----------------------------------------------------------------------------------------------------------------------

  async setPricing(
    ref: string,
    input: SetMarketPricingInput,
    operatorId: number,
  ): Promise<MarketOperatorApp> {
    const parsed = parseAppRef(ref);
    const known = await this.knownFeatureKeys();
    const slug = await this.store.tx(async (tx) => {
      const app = parsed ? await this.store.app(tx, parsed, true) : null;
      if (!app)
        throw new AppError(ERROR_CODES.MKT_APP_NOT_FOUND, 'App not found', HttpStatus.NOT_FOUND);
      if (app.rowVersion !== input.rowVersion) throw AppError.rowVersionConflict('App');

      const paid = input.model === 'paid_monthly';
      const amount = paid && input.amount ? normaliseMarketMoney(input.amount) : null;
      const annual = paid && input.annualAmount ? normaliseMarketMoney(input.annualAmount) : null;
      const currency = paid ? (input.currency ?? null) : null;
      const issues: Array<{ path: string; message: string }> = [];
      if (paid && currency && !(await this.store.currencyActive(tx, currency)))
        issues.push({ path: 'currency', message: 'This currency is not enabled on the platform.' });
      if (
        paid &&
        input.includedMinPlan &&
        !(await this.store.planExists(tx, input.includedMinPlan))
      )
        issues.push({ path: 'includedMinPlan', message: 'There is no such plan.' });
      if (paid && input.includedPlanFeature && !known.has(input.includedPlanFeature))
        issues.push({ path: 'includedPlanFeature', message: 'This is not a plan feature.' });
      const grants = paid ? input.grantsPlanFeatures : [];
      if (grants.length > 0 && !app.firstParty)
        issues.push({
          path: 'grantsPlanFeatures',
          message: 'Only a first-party app can grant plan features.',
        });
      for (const key of grants) {
        if (!known.has(key))
          issues.push({ path: 'grantsPlanFeatures', message: `${key} is not a plan feature.` });
        // A core feature that is ON by default is granted by every plan row that predates it: an app granting it would sell what everyone
        // already has. Its registry default must be switched off in the change that makes the feature an app. A listing that is still being
        // prepared (draft or in review) may name it, so the grandfather action can run while the feature is still on for everyone; publishing
        // refuses it until the default is off, and a live listing cannot take it on.
        else if (
          coreFeatureDefault(key) === true &&
          app.status !== 'draft' &&
          app.status !== 'in_review'
        )
          issues.push({
            path: 'grantsPlanFeatures',
            message: `${key} is on by default for every plan (its registry default). Switch the default off before an app owns it.`,
          });
      }
      if (issues.length > 0) throw AppError.validation('The pricing is not valid.', issues);

      const before = app.pricing;
      const priceChanged =
        paid && (before.priceAmount !== amount || before.priceCurrency !== currency);
      const ok = await this.store.setPricing(
        tx,
        app.id,
        {
          model: input.model,
          amount,
          currency,
          annualAmount: annual,
          trialDays: paid ? input.trialDays : 0,
          purchasable: input.purchasable,
          includedPlanFeature: paid ? (input.includedPlanFeature ?? null) : null,
          includedMinPlan: paid ? (input.includedMinPlan ?? null) : null,
          grantsPlanFeatures: paid ? input.grantsPlanFeatures : [],
          grandfatherExisting: paid ? input.grandfatherExisting : false,
          priceChanged,
        },
        input.rowVersion,
      );
      if (!ok) throw AppError.rowVersionConflict('App');
      if (paid) {
        await this.store.upsertPack(tx, {
          appId: app.id,
          slug: marketPackSlug(app.uuid),
          name: `${app.name} (Marketplace)`.slice(0, 120),
          amount: amount!,
          currency: currency!,
          features: [marketEntitlementKey(app.slug), ...input.grantsPlanFeatures],
        });
      } else if (app.packExists) {
        await this.store.deactivatePack(tx, app.id);
      }
      await this.audit.record(tx, {
        event: 'platform.market.pricing_set',
        status: 'success',
        payload: {
          app: app.slug,
          operator: operatorId,
          from: this.summary(before),
          to: {
            model: input.model,
            amount,
            currency,
            annualAmount: annual,
            trialDays: paid ? input.trialDays : 0,
            purchasable: input.purchasable,
            includedPlanFeature: paid ? (input.includedPlanFeature ?? null) : null,
            includedMinPlan: paid ? (input.includedMinPlan ?? null) : null,
            grantsPlanFeatures: paid ? input.grantsPlanFeatures : [],
            grandfatherExisting: paid ? input.grandfatherExisting : false,
          },
        },
      });
      return app.slug;
    });
    const app = await this.store.tx((tx) => this.store.app(tx, { by: 'slug', value: slug }));
    return toApp(app!);
  }

  private summary(p: {
    pricingModel: string;
    priceAmount: string | null;
    priceCurrency: string | null;
    trialDays: number;
    purchasable: boolean;
    grantsPlanFeatures: string[];
  }): Record<string, unknown> {
    return {
      grantsPlanFeatures: p.grantsPlanFeatures,
      model: p.pricingModel,
      amount: p.priceAmount,
      currency: p.priceCurrency,
      trialDays: p.trialDays,
      purchasable: p.purchasable,
    };
  }

  /** Core plan features and the ones installed modules contribute: what "included in a plan" can name. */
  private async knownFeatureKeys(): Promise<Set<string>> {
    const modules = await this.registry.planFeatures();
    return new Set([
      ...PLAN_FEATURE_DEFS.map((d) => d.key as string),
      ...modules.map((f) => f.key),
    ]);
  }

  // --- the subscriptions view ----------------------------------------------------------------------------------------------------------

  async listSubscriptions(
    q: MarketOperatorSubscriptionListQuery,
  ): Promise<MarketOperatorSubscriptionList> {
    const where: SQL[] = [sql`true`];
    if (q.app) {
      const r = parseAppRef(q.app);
      where.push(
        r?.by === 'uuid' ? sql`a.uuid = ${r.value}::uuid` : sql`a.slug = ${r?.value ?? ''}`,
      );
    }
    if (q.status) where.push(sql`${DERIVED_STATUS} = ${q.status}`);
    if (q.source) where.push(sql`s.source = ${q.source}`);
    if (q.q) where.push(sql`o.name ILIKE ${likePattern(q.q)}`);
    if (q.cursor) {
      const k = decodeKeyset(q.cursor, 1);
      if (!k)
        throw AppError.validation('Invalid pagination cursor', [
          { path: 'cursor', message: 'malformed' },
        ]);
      where.push(sql`(s.started_at, s.id) < (${k.keys[0]!}::timestamptz, ${k.id}::bigint)`);
    }
    const rows = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT ${SUBSCRIPTION_SELECT}, ${DERIVED_STATUS} AS dstatus ${SUBSCRIPTION_FROM}
        WHERE ${sql.join(where, sql` AND `)}
        ORDER BY s.started_at DESC, s.id DESC LIMIT ${q.limit + 1}`);
      return res.rows as Raw[];
    });
    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    const last = items[items.length - 1];
    return {
      data: items.map(toSubscription),
      page: {
        nextCursor: hasMore && last ? encodeKeyset([String(last.k0)], Number(last.id)) : null,
        hasMore,
        limit: q.limit,
      },
    };
  }

  /** Per app: subscriptions by state, and the MRR (list price of the active paid subscriptions, per currency, never converted). */
  async summaryReport(): Promise<MarketSubscriptionSummary> {
    const { apps, mrr, totals } = await this.store.tx(async (tx) => {
      const appsRes = await tx.execute(sql`
        SELECT a.uuid, a.slug, a.name, a.pricing_model, a.price_amount::text AS price_amount, a.price_currency,
               count(s.id) FILTER (WHERE ${DERIVED_STATUS} = 'active')::int AS active,
               count(s.id) FILTER (WHERE ${DERIVED_STATUS} = 'trialing')::int AS trialing,
               count(s.id) FILTER (WHERE ${DERIVED_STATUS} = 'comped')::int AS comped,
               count(s.id) FILTER (WHERE ${DERIVED_STATUS} = 'canceling')::int AS canceling,
               count(s.id) FILTER (WHERE ${DERIVED_STATUS} = 'ended')::int AS ended,
               count(s.id)::int AS total
        FROM marketplace_apps a LEFT JOIN marketplace_subscriptions s ON s.app_id = a.id
        WHERE a.pricing_model <> 'free' OR EXISTS (SELECT 1 FROM marketplace_subscriptions x WHERE x.app_id = a.id)
        GROUP BY a.id ORDER BY a.name`);
      const mrrRes = await tx.execute(sql`
        SELECT a.uuid, s.currency, sum(s.amount)::text AS amount
        FROM marketplace_subscriptions s JOIN marketplace_apps a ON a.id = s.app_id
        WHERE ${DERIVED_STATUS} = 'active' AND s.source = 'purchase' AND s.amount IS NOT NULL AND s.currency IS NOT NULL
        GROUP BY a.uuid, s.currency ORDER BY s.currency`);
      const totalRes = await tx.execute(sql`
        SELECT s.currency, sum(s.amount)::text AS amount
        FROM marketplace_subscriptions s
        WHERE ${DERIVED_STATUS} = 'active' AND s.source = 'purchase' AND s.amount IS NOT NULL AND s.currency IS NOT NULL
        GROUP BY s.currency ORDER BY s.currency`);
      return {
        apps: appsRes.rows as Raw[],
        mrr: mrrRes.rows as Raw[],
        totals: totalRes.rows as Raw[],
      };
    });
    return {
      data: apps.map((a) => ({
        appId: a.uuid as string,
        slug: a.slug as string,
        name: a.name as string,
        pricing: {
          model: a.pricing_model as 'free' | 'paid_monthly',
          amount: (a.price_amount as string | null) ?? null,
          currency: (a.price_currency as string | null) ?? null,
        },
        counts: {
          active: Number(a.active),
          trialing: Number(a.trialing),
          comped: Number(a.comped),
          canceling: Number(a.canceling),
          ended: Number(a.ended),
          total: Number(a.total),
        },
        mrr: mrr
          .filter((m) => m.uuid === a.uuid)
          .map((m) => ({ currency: m.currency as string, amount: m.amount as string })),
      })),
      totals: totals.map((t) => ({ currency: t.currency as string, amount: t.amount as string })),
    };
  }

  // --- comp and cancel -----------------------------------------------------------------------------------------------------------------

  /** Gives a workspace the app free, for some months or until the operator ends it. */
  async comp(
    ref: string,
    input: CompSubscriptionInput,
    operatorId: number,
  ): Promise<MarketOperatorSubscription> {
    const parsed = parseAppRef(ref);
    const uuid = await this.store.tx(async (tx) => {
      const app = parsed ? await this.store.app(tx, parsed, true) : null;
      if (!app)
        throw new AppError(ERROR_CODES.MKT_APP_NOT_FOUND, 'App not found', HttpStatus.NOT_FOUND);
      if (app.pricing.pricingModel !== 'paid_monthly' || !app.packExists)
        throw new AppError(
          ERROR_CODES.MKT_SUBSCRIPTION_STATE,
          'Only a paid app can be comped: this one is free.',
          HttpStatus.CONFLICT,
        );
      const orgRes = await tx.execute(
        sql`SELECT id FROM organizations WHERE uuid = ${input.workspaceId}::uuid`,
      );
      const orgId = (orgRes.rows[0] as { id: string } | undefined)?.id;
      if (!orgId) throw AppError.notFound('Workspace', input.workspaceId);
      const packRes = await tx.execute(
        sql`SELECT id FROM plans WHERE marketplace_app_id = ${app.id}`,
      );
      const packId = Number((packRes.rows[0] as { id: string }).id);
      const out = await this.lifecycle.comp(tx, {
        orgId: Number(orgId),
        app: { id: app.id, slug: app.slug },
        packId,
        months: input.months,
        note: input.note,
        operatorId,
      });
      await this.audit.record(tx, {
        event: 'platform.market.subscription_comped',
        status: 'success',
        orgId: Number(orgId),
        payload: { app: app.slug, months: input.months, operator: operatorId },
      });
      return out.subscriptionUuid;
    });
    return this.oneSubscription(uuid);
  }

  /**
   * Comps every workspace that already has a plan feature this app grants (through its plan or its overrides) and has no subscription to
   * the app yet, so a feature that becomes a paid app is not taken from the people who already have it. An explicit, audited operator action
   * on a listing marked `grandfatherExisting`; `dryRun` (the default) counts and lists without writing. A workspace the platform owns and one
   * whose plan the catalogue does not know are skipped (they have everything, so having the feature says nothing). Run it BEFORE the
   * feature's registry default is switched off or its plan rows are changed: it reads what the workspace has at this moment.
   */
  async grandfather(
    ref: string,
    input: GrandfatherSubscriptionsInput,
    operatorId: number,
  ): Promise<MarketGrandfatherResult> {
    const parsed = parseAppRef(ref);
    const app = await this.store.tx(async (tx) => {
      const a = parsed ? await this.store.app(tx, parsed) : null;
      if (!a)
        throw new AppError(ERROR_CODES.MKT_APP_NOT_FOUND, 'App not found', HttpStatus.NOT_FOUND);
      const packRes = await tx.execute(
        sql`SELECT id FROM plans WHERE marketplace_app_id = ${a.id}`,
      );
      const refusal =
        a.pricing.pricingModel !== 'paid_monthly' || !packRes.rows[0]
          ? 'Only a paid app can comp its existing users.'
          : a.pricing.grantsPlanFeatures.length === 0
            ? 'This app grants no plan features, so there is no "existing user" to find.'
            : !a.pricing.grandfatherExisting
              ? 'Mark the listing "comp existing users" in its pricing first.'
              : null;
      if (refusal)
        throw new AppError(ERROR_CODES.MKT_SUBSCRIPTION_STATE, refusal, HttpStatus.CONFLICT);
      return { row: a, packId: Number((packRes.rows[0] as { id: string }).id) };
    });
    const grants = app.row.pricing.grantsPlanFeatures;
    const holds = (e: Entitlements): boolean =>
      !e.platformOwned &&
      e.planKnown &&
      grants.some((k) =>
        coreFeatureDefault(k) !== null
          ? resolveFeature(e, k as never)
          : e.overrides.features?.[k] === true ||
            (e.overrides.features?.[k] === undefined && e.planFeatures[k] === true),
      );

    // Workspaces already USING a granted feature count even when their plan no longer grants it (the registry default was switched off
    // for the app, e.g. booking): detected by what they have created.
    const usingIt = await this.store.tx(async (tx) => {
      const ids = new Set<number>();
      for (const k of grants) {
        const probe = USAGE_PROBES[k];
        if (!probe) continue;
        for (const r of (await tx.execute(probe)).rows as unknown as Array<{ org_id: string }>)
          ids.add(Number(r.org_id));
      }
      return ids;
    });

    const matched: Array<{ id: number; uuid: string; name: string }> = [];
    let after = 0;
    for (;;) {
      const batch = await this.store.tx(async (tx) => {
        const res = await tx.execute(sql`
          SELECT o.id, o.uuid, o.name FROM organizations o
          WHERE o.id > ${after}
            AND NOT EXISTS (SELECT 1 FROM marketplace_subscriptions s WHERE s.org_id = o.id AND s.app_id = ${app.row.id})
          ORDER BY o.id LIMIT 200`);
        return res.rows as unknown as Array<{ id: string; uuid: string; name: string }>;
      });
      if (batch.length === 0) break;
      for (const o of batch) {
        after = Number(o.id);
        const e = await this.plans.forOrg(Number(o.id));
        if (e && !e.platformOwned && (holds(e) || usingIt.has(Number(o.id))))
          matched.push({ id: Number(o.id), uuid: o.uuid, name: o.name });
      }
    }

    let comped = 0;
    if (!input.dryRun) {
      for (const o of matched) {
        const done = await this.store.tx(async (tx) => {
          // The subscription may have appeared since the scan (the workspace paid): then there is nothing to comp.
          const exists = await tx.execute(
            sql`SELECT 1 FROM marketplace_subscriptions WHERE org_id = ${o.id} AND app_id = ${app.row.id}`,
          );
          if (exists.rows.length > 0) return false;
          await this.lifecycle.comp(tx, {
            orgId: o.id,
            app: { id: app.row.id, slug: app.row.slug },
            packId: app.packId,
            months: input.months,
            note: input.note,
            operatorId,
          });
          return true;
        });
        if (done) comped += 1;
      }
      await this.store.tx((tx) =>
        this.audit.record(tx, {
          event: 'platform.market.subscriptions_grandfathered',
          status: 'success',
          payload: {
            app: app.row.slug,
            features: grants,
            matched: matched.length,
            comped,
            months: input.months,
            operator: operatorId,
          },
        }),
      );
    }
    return {
      dryRun: input.dryRun,
      matched: matched.length,
      comped,
      sample: matched.slice(0, 25).map((o) => ({ id: o.uuid, name: o.name })),
    };
  }

  /** Cancels a workspace's subscription: at the end of what it has paid for, or now (the installation is paused and its data kept). */
  async cancel(
    uuid: string,
    input: CancelOperatorSubscriptionInput,
    operatorId: number,
  ): Promise<MarketOperatorSubscription> {
    const out = await this.store.tx(async (tx) => {
      const r = await this.lifecycle.cancelByOperator(tx, {
        uuid,
        immediate: input.immediate,
        reason: input.reason,
        operatorId,
      });
      await this.audit.record(tx, {
        event: 'platform.market.subscription_canceled',
        status: 'warning',
        orgId: r.orgId,
        payload: {
          app: r.appSlug,
          immediate: input.immediate,
          reason: input.reason,
          operator: operatorId,
        },
      });
      return r;
    });
    // After the commit: pausing consults the entitlement service (a plan that includes the app, an override), which reads in its own
    // transaction. Re-running a cancel "now" on an ended subscription repeats this step.
    if (out.pause) await this.lifecycle.pauseIfNotEntitled(out.orgId, out.appId);
    return this.oneSubscription(out.subscriptionUuid);
  }

  private async oneSubscription(uuid: string): Promise<MarketOperatorSubscription> {
    const row = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT ${SUBSCRIPTION_SELECT}, ${DERIVED_STATUS} AS dstatus ${SUBSCRIPTION_FROM} WHERE s.uuid = ${uuid}::uuid`);
      return res.rows[0] as Raw | undefined;
    });
    if (!row)
      throw new AppError(
        ERROR_CODES.MKT_SUBSCRIPTION_NOT_FOUND,
        'Subscription not found',
        HttpStatus.NOT_FOUND,
      );
    return toSubscription(row);
  }
}
