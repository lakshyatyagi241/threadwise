import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  PLAN_FEATURE_KEYS,
  type BillingPlan,
  type BillingPlansResponse,
  type BillingStatus,
  type BillingUsageResponse,
  type ChangePlanResponse,
  type EntitlementsResponse,
  type PlanFeatureKey,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { PlatformSettingsService } from '../auth';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { PlanCatalogService } from './plan-catalog.service';
import {
  PlanEntitlementService,
  resolveFeature,
  type Entitlements,
} from './plan-entitlement.service';
import { changeDirection, validityForState } from './plan-lifecycle';
import { PLAN_COLUMNS, fullFeatures, fullLimits, toFacts, type PlanRow } from './plan-row';
import {
  buildPlanCard,
  byCatalogueOrder,
  planKind,
  yearlyOffer,
  type PlanFacts,
} from './plan-rules';
import { PlanStore } from './plan-store';
import { PlanUsageService } from './plan-usage.service';
import { SubscriptionService } from './subscription.service';

/**
 * What a workspace sees and does about its own plan (TW-PLAN-011..016). Every method acts on the CALLER's organization
 * (from the request context): a plan is attached to a workspace, never to a user or an account.
 *
 * Writes go through the privileged store because `organizations.plan` and `org_plan_state` are the platform's to write (a
 * workspace must not be able to extend its own trial); the guard in front of the controller (`plan.subscription.manage`) is what
 * decides WHO may ask.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly store: PlanStore,
    private readonly catalog: PlanCatalogService,
    private readonly entitlements: PlanEntitlementService,
    private readonly usage: PlanUsageService,
    private readonly outbox: OutboxService,
    private readonly settings: PlatformSettingsService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  // --- reads --------------------------------------------------------------------------------------------------------------------

  /**
   * The plan picker's view model (TW-PLAN-011): the active plans with the caller's plan marked, what choosing each one does, and
   * the validity banner. A lapsed paid plan or an expired trial reads as the FREE plan being current (the badge follows the
   * entitlements, TW-PLAN-011 criterion 2), so every paid card becomes an upgrade and the recovery path is one click.
   */
  /** The feature keys the workspace's plan includes: the web app draws locks, crowns and paywalls from this (TW-PLAN-020, 021). */
  async entitlementKeys(): Promise<EntitlementsResponse> {
    const e = await this.mustResolve(RequestContextStore.require().orgId);
    return { features: PLAN_FEATURE_KEYS.filter((k) => resolveFeature(e, k)) };
  }

  async plans(canManage: boolean, unlocks?: PlanFeatureKey): Promise<BillingPlansResponse> {
    const orgId = RequestContextStore.require().orgId;
    const e = await this.mustResolve(orgId);
    const rows = await this.db.txAs({ orgId, userId: null }, (tx) => this.catalog.listPlans(tx));
    const facts = rows.map((r) => ({ row: r, facts: toFacts(r) }));
    const active = facts
      .filter((p) => p.facts.isActive)
      .sort((a, b) => byCatalogueOrder(a.facts, b.facts));

    const stored = facts.find((p) => p.facts.slug === e.planSlug)?.facts ?? null;
    const effective =
      e.state === 'paid_lapsed'
        ? (active.find((p) => planKind(p.facts) === 'free')?.facts ?? stored)
        : stored;
    const effectiveSlug = effective?.slug ?? null;

    const [toggle, pctSetting] = await Promise.all([
      this.settings.get<unknown>('pricing.yearly_toggle_enabled'),
      this.settings.get<unknown>('pricing.yearly_discount_pct'),
    ]);
    const pct =
      Number.isInteger(pctSetting) && (pctSetting as number) >= 0 && (pctSetting as number) <= 100
        ? (pctSetting as number)
        : 20;

    // The paywall sheet lists only the plans that include the locked feature (TW-PLAN-020).
    const offered = unlocks ? active.filter((p) => fullFeatures(p.row.features)[unlocks]) : active;
    const data: BillingPlan[] = offered.map(({ row, facts: f }) => {
      const card = buildPlanCard(f, effectiveSlug, effective, true);
      return {
        ...card,
        limits: fullLimits(row.limits),
        features: fullFeatures(row.features),
        via: viaFor(card.action, f, effective),
        yearly: yearlyOffer(f, pct),
      };
    });

    return {
      data,
      current: effective
        ? { slug: effective.slug, name: effective.name, kind: planKind(effective) }
        : { slug: e.planSlug, name: null, kind: null },
      validity: validityForState(e.state, {
        trialEndsAt: e.trialEndsAt,
        planEndsAt: e.planEndsAt,
        now: new Date(),
      }),
      canManage,
      subscription: await this.subscriptions.current(orgId),
      yearlyToggle: {
        enabled: toggle !== false && data.some((p) => p.yearly !== null),
        discountPct: pct,
      },
    };
  }

  /** The trial and renewal bars (TW-PLAN-013): one small payload for the whole app shell. */
  async status(): Promise<BillingStatus> {
    const e = await this.mustResolve(RequestContextStore.require().orgId);
    return {
      ...validityForState(e.state, {
        trialEndsAt: e.trialEndsAt,
        planEndsAt: e.planEndsAt,
        now: new Date(),
      }),
      planSlug: e.planSlug,
      planName: e.planName,
      subscription: await this.subscriptions.current(e.orgId),
    };
  }

  /** The plan and usage panel (TW-PLAN-014). */
  async usagePanel(): Promise<BillingUsageResponse> {
    const res = await this.usage.usage(RequestContextStore.require().orgId);
    if (!res) throw AppError.notFound('Workspace');
    return res;
  }

  // --- change --------------------------------------------------------------------------------------------------------------------

  /**
   * Move the workspace to `planSlug` without a payment: any free plan, or a paid plan that is cheaper or equal. A dearer paid plan
   * is a purchase and is refused here with PLAN_CHECKOUT_REQUIRED (the response names the checkout path); a custom quote goes
   * through sales.
   *
   * What changes (TW-PLAN-016 rules 2 and 8, widened so an admin can downgrade):
   *   - `organizations.plan` becomes the new slug, the one plan reference there is
   *   - to a paid plan: the trial is cleared and a running paid period is kept (the customer keeps the time they paid for)
   *   - to a free plan from a paid one: the period is cleared and no trial restarts
   *   - from one free plan to another: the trial dates are untouched, so a trial can be neither extended nor skipped by switching
   * Nothing the workspace already holds is deleted. Caps the new plan sets below current use are returned as `overLimit`; they
   * only block adding more (TW-PLAN-017 rule 1), exactly as an override or a plan edit would.
   */
  async change(planSlug: string): Promise<ChangePlanResponse> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;
    const before = await this.mustResolve(orgId);

    const outcome = await this.store.tx(async (tx) => {
      const target = await this.lockPlan(tx, planSlug);
      if (!target) throw AppError.notFound('Plan');
      const facts = toFacts(target);
      if (!facts.isActive) {
        throw refused('This plan is not available.', [{ path: 'planSlug', message: planSlug }]);
      }
      const kind = planKind(facts);
      if (kind === 'custom_quote') {
        throw refused('This plan is arranged with sales. Contact us to move to it.', [
          { path: 'planSlug', message: planSlug },
          { path: 'via', message: 'sales' },
        ]);
      }

      // Direction is judged against what the workspace is entitled to NOW (a lapsed paid plan counts as the free plan).
      const rows = await this.catalog.listPlans(tx);
      const storedRow = rows.find((r) => r.slug === before.planSlug) ?? null;
      const free =
        rows
          .filter((r) => r.is_active)
          .map(toFacts)
          .sort(byCatalogueOrder)
          .find((p) => planKind(p) === 'free') ?? null;
      const effective: PlanFacts | null =
        before.state === 'paid_lapsed'
          ? (free ?? (storedRow ? toFacts(storedRow) : null))
          : storedRow
            ? toFacts(storedRow)
            : null;

      if (effective && effective.slug === facts.slug) {
        throw refused('The workspace is already on this plan.', [
          { path: 'planSlug', message: planSlug },
        ]);
      }
      const direction = changeDirection(effective, facts);
      if (kind === 'paid' && direction === 'upgrade') {
        throw new AppError(
          ERROR_CODES.PLAN_CHECKOUT_REQUIRED,
          'Upgrading to this plan is a purchase. Continue to checkout.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [
            { path: 'planSlug', message: planSlug },
            { path: 'checkoutUrl', message: `/billing/checkout/${planSlug}` },
          ],
        );
      }

      const state = await tx.execute(
        sql`SELECT trial_ends_at, plan_ends_at, billing_cycle FROM org_plan_state WHERE org_id = ${orgId} FOR UPDATE`,
      );
      const st = state.rows[0] as
        | { trial_ends_at: string | null; plan_ends_at: string | null; billing_cycle: string }
        | undefined;
      const currentlyFree = effective !== null && planKind(effective) === 'free';

      let trialEndsAt: string | null;
      let planEndsAt: string | null;
      if (kind === 'free') {
        trialEndsAt = currentlyFree ? (st?.trial_ends_at ?? null) : null;
        planEndsAt = null;
      } else {
        trialEndsAt = null;
        planEndsAt = before.state === 'paid_lapsed' ? null : (st?.plan_ends_at ?? null);
      }
      const cycle =
        st?.billing_cycle === 'yearly' && kind === 'paid'
          ? 'yearly'
          : kind === 'free' && trialEndsAt
            ? 'trial'
            : 'monthly';

      await tx.execute(sql`UPDATE organizations SET plan = ${facts.slug} WHERE id = ${orgId}`);
      await tx.execute(sql`
        INSERT INTO org_plan_state (org_id, trial_ends_at, plan_ends_at, billing_cycle)
        VALUES (${orgId}, ${trialEndsAt}, ${planEndsAt}, ${cycle})
        ON CONFLICT (org_id) DO UPDATE
          SET trial_ends_at = EXCLUDED.trial_ends_at, plan_ends_at = EXCLUDED.plan_ends_at, billing_cycle = EXCLUDED.billing_cycle
      `);

      const changed = { from: before.planSlug, to: facts.slug, direction };
      await tx.execute(sql`
        INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
        VALUES (${orgId}, ${ctx.actorId}, ${ctx.actorType}, 'plans', ${orgId}, 'update',
          ${JSON.stringify({ plan: { old: before.planSlug, new: facts.slug }, direction: { old: null, new: direction } })}::jsonb,
          ${ctx.requestId ?? null})
      `);
      await this.outbox.emit(tx, {
        aggregateModule: 'plans',
        aggregateId: orgId,
        eventType: 'plan.changed',
        payload: changed,
      });
      return {
        row: target,
        direction,
        trialEndsAt: trialEndsAt ? new Date(trialEndsAt) : null,
        planEndsAt: planEndsAt ? new Date(planEndsAt) : null,
      };
    });

    const after = await this.mustResolve(orgId);
    const meters = await this.usage.meters(after);
    return {
      planSlug: outcome.row.slug,
      planName: outcome.row.name,
      direction: outcome.direction,
      validity: validityForState(after.state, {
        trialEndsAt: after.trialEndsAt,
        planEndsAt: after.planEndsAt,
        now: new Date(),
      }),
      overLimit: meters
        .filter((m) => m.limit > 0 && m.used > m.limit)
        .map((m) => ({ key: m.key, used: m.used, limit: m.limit })),
    };
  }

  // --- internals ----------------------------------------------------------------------------------------------------------------

  private async mustResolve(orgId: number): Promise<Entitlements> {
    const e = await this.entitlements.forOrg(orgId);
    if (!e) throw AppError.notFound('Workspace');
    return e;
  }

  private async lockPlan(tx: Tx, slug: string): Promise<PlanRow | null> {
    const res = await tx.execute(
      sql`SELECT ${PLAN_COLUMNS} FROM plans WHERE kind = 'plan' AND slug = ${slug} FOR SHARE`,
    );
    return (res.rows[0] as unknown as PlanRow | undefined) ?? null;
  }
}

const refused = (message: string, errors: Array<{ path: string; message: string }>) =>
  new AppError(
    ERROR_CODES.PLAN_CHANGE_NOT_ALLOWED,
    message,
    HttpStatus.UNPROCESSABLE_ENTITY,
    errors,
  );

/** How choosing a card is carried out (see `billingPlanSchema.via`). */
export function viaFor(
  action: BillingPlan['action'],
  target: PlanFacts,
  effective: PlanFacts | null,
): BillingPlan['via'] {
  if (action === 'current') return 'none';
  const kind = planKind(target);
  if (kind === 'custom_quote') return 'sales';
  if (kind === 'paid' && changeDirection(effective, target) === 'upgrade') return 'checkout';
  return 'change';
}
