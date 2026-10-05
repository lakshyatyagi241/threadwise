import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  PLAN_UPGRADE_PATH,
  storedFeature,
  storedLimit,
  type PlanFeatureKey,
  type PlanLimitKey,
  type PlansResponse,
  type PlanState,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { PlanCatalogService } from './plan-catalog.service';
import { fallsBackToFree, planStateOf } from './plan-lifecycle';
import { toFacts, PLAN_COLUMNS, type PlanRow } from './plan-row';
import { planKind, trialFor, type DefaultPlanStep, type TrialStamp } from './plan-rules';

export interface InitialPlan extends TrialStamp {
  planSlug: string;
  /** Which step of the 4-step resolution picked it (diagnostic, logged and audited). */
  step: DefaultPlanStep;
}

/** What one organization is entitled to, resolved from its plan, its overrides and its state. */
export interface Entitlements {
  orgId: number;
  planSlug: string;
  /** False when no catalogue row carries `planSlug` (deleted, never created, the literal 'starter'). */
  planKnown: boolean;
  planName: string | null;
  trialEndsAt: Date | null;
  planEndsAt: Date | null;
  billingCycle: 'trial' | 'monthly' | 'yearly';
  platformOwned: boolean;
  /** Raw per-org overrides; limits use -1 for unlimited. */
  overrides: { limits?: Record<string, unknown>; features?: Record<string, unknown> };
  planLimits: Record<string, unknown>;
  planFeatures: Record<string, unknown>;
  /** The lifecycle state (TW-PLAN-016). A lapsed paid plan reports the free plan's limits and flags above. */
  state: PlanState;
  /** Which paid Marketplace apps the plan makes VISIBLE (not usable: using one still needs a purchase). */
  visibleApps: VisibleApps;
}

/**
 * The Marketplace apps (by `marketplace_apps.id`) a workspace's plan lets it see as paid add-ons. `all` is true where nothing narrows the
 * catalogue: a platform-owned workspace, and one on a plan with no catalogue row (nothing is locked, as for every other entitlement).
 * A lapsed paid plan reports the free plan's set, like its flags.
 */
export interface VisibleApps {
  all: boolean;
  appIds: ReadonlySet<number>;
}

interface EntitlementRow {
  plan_slug: string;
  trial_ends_at: string | null;
  plan_ends_at: string | null;
  billing_cycle: 'trial' | 'monthly' | 'yearly' | null;
  overrides: Entitlements['overrides'] | null;
  platform_owned: boolean | null;
  plan_name: string | null;
  plan_limits: Record<string, unknown> | null;
  plan_features: Record<string, unknown> | null;
  plan_found: boolean;
  plan_id: string | null;
  visible_app_ids: string[] | null;
  plan_is_free: boolean | null;
  plan_is_custom_quote: boolean | null;
  plan_amount: string | null;
  /** Plan feature keys granted by the Marketplace apps the workspace has subscribed to (`{ key: true }`). */
  app_grants: Record<string, unknown> | null;
}

/**
 * Entitlements (TW-PLAN-006/007/017): "may this organization use feature X" and
 * "what is its cap on Y", plus what a new organization starts with.
 *
 * Resolution order, for a flag or a cap:
 *   1. organizations the platform owns are never limited
 *   2. the organization's own override
 *   3. its plan's value (a flag the plan row predates takes the registry default)
 *   4. NO PLAN ROW: nothing is locked. An organization whose plan slug has no
 *      catalogue row (a fresh install with no plans, the literal 'starter', a
 *      deleted plan) must not be locked out of the product by a missing
 *      catalogue; Reference behaves the same ("no package resolves to null
 *      entitlements"). The gap is logged once per slug so it is noticed.
 *
 * Caps: whole numbers, 0 = unlimited; an override of -1 (or 0) is unlimited.
 */
@Injectable()
export class PlanEntitlementService {
  private readonly logger = new Logger(PlanEntitlementService.name);
  private readonly warned = new Set<string>();

  constructor(
    private readonly db: DatabaseService,
    private readonly catalog: PlanCatalogService,
  ) {}

  // --- sign-up ---------------------------------------------------------------------------------------------------------------------

  /**
   * The plan and trial a brand-new organization starts with. Runs inside the
   * provisioning transaction; `recordInitialState` then writes it.
   */
  async resolveInitialPlan(
    tx: Tx,
    input: { registrationDefaultSlug: string | null; trialDays: number; now?: Date },
  ): Promise<InitialPlan> {
    const resolved = await this.catalog.resolveDefaultPlan(tx, input.registrationDefaultSlug);
    const stamp = trialFor(resolved.plan, input.trialDays, input.now ?? new Date());
    return { planSlug: resolved.slug, step: resolved.step, ...stamp };
  }

  async recordInitialState(tx: Tx, orgId: number, initial: InitialPlan): Promise<void> {
    await tx.execute(sql`
      INSERT INTO org_plan_state (org_id, trial_ends_at, billing_cycle)
      VALUES (${orgId}, ${initial.trialEndsAt}, ${initial.billingCycle})
      ON CONFLICT (org_id) DO UPDATE
        SET trial_ends_at = EXCLUDED.trial_ends_at, billing_cycle = EXCLUDED.billing_cycle
    `);
  }

  // --- reads -----------------------------------------------------------------------------------------------------------------------

  /** What the organization sees on the plan step and the plan picker: the active catalogue, its own plan marked. */
  async cardsForOrg(orgId: number): Promise<PlansResponse> {
    const e = await this.forOrg(orgId);
    return this.catalog.cardsFor(orgId, e?.planSlug ?? null, e?.trialEndsAt ?? null);
  }

  /** The organization's resolved entitlements, or null when it does not exist. */
  async forOrg(orgId: number): Promise<Entitlements | null> {
    const res = await this.db.txAs({ orgId, userId: null }, (tx) =>
      tx.execute(sql`
        SELECT o.plan AS plan_slug,
               s.trial_ends_at, s.plan_ends_at, s.billing_cycle, s.overrides, s.platform_owned,
               p.name AS plan_name, p.limits AS plan_limits, p.features AS plan_features,
               (p.id IS NOT NULL) AS plan_found, p.id AS plan_id,
               (SELECT array_agg(ap.marketplace_app_id) FROM plan_visible_addons pv
                  JOIN plans ap ON ap.id = pv.addon_plan_id AND ap.marketplace_app_id IS NOT NULL
                 WHERE pv.plan_id = p.id) AS visible_app_ids,
               p.is_free AS plan_is_free, p.is_custom_quote AS plan_is_custom_quote,
               p.amount::text AS plan_amount,
               (SELECT coalesce(jsonb_object_agg(f.key, true), '{}'::jsonb)
                  FROM workspace_addons wa
                  JOIN plans ap ON ap.id = wa.package_id AND ap.marketplace_app_id IS NOT NULL
                  CROSS JOIN LATERAL jsonb_each(ap.features) AS f(key, value)
                 WHERE wa.org_id = o.id AND wa.status = 'active' AND (wa.ends_at IS NULL OR wa.ends_at > now())
                   AND f.value = 'true'::jsonb) AS app_grants
        FROM organizations o
        LEFT JOIN org_plan_state s ON s.org_id = o.id
        LEFT JOIN plans p ON p.slug = o.plan AND p.kind = 'plan'
        WHERE o.id = ${orgId}
      `),
    );
    const row = res.rows[0] as unknown as EntitlementRow | undefined;
    if (!row) return null;
    if (!row.plan_found && !this.warned.has(row.plan_slug)) {
      this.warned.add(row.plan_slug);
      this.logger.warn(
        { planSlug: row.plan_slug },
        'an organization is on a plan with no catalogue row: its entitlements are open (nothing is locked)',
      );
    }
    const trialEndsAt = row.trial_ends_at ? new Date(row.trial_ends_at) : null;
    const planEndsAt = row.plan_ends_at ? new Date(row.plan_ends_at) : null;
    const state = planStateOf({
      plan: row.plan_found
        ? {
            isFree: row.plan_is_free ?? false,
            isCustomQuote: row.plan_is_custom_quote ?? false,
            amount: row.plan_amount ?? '0.00',
          }
        : null,
      trialEndsAt,
      planEndsAt,
      now: new Date(),
    });
    let planLimits = row.plan_limits ?? {};
    let planFeatures = row.plan_features ?? {};
    let visibleIds = (row.visible_app_ids ?? []).map(Number);
    if (fallsBackToFree(state)) {
      // A lapsed paid plan locks to the free plan: paid flags lock and the caps shrink (TW-PLAN-016). With no free plan in
      // the catalogue there is nothing to fall back to, so the stored plan keeps applying rather than locking everything.
      const free = await this.freePlan();
      if (free) {
        planLimits = free.limits;
        planFeatures = free.features;
        visibleIds = await this.visibleAppIds(free.id);
      }
    }
    // A Marketplace app a workspace has subscribed to may grant plan features (a first-party app that owns one, e.g. a paid booking app).
    // They are merged HERE, into the one resolver every gate asks (RequirePlanFeature, the in-context guards, the entitlements the web
    // reads), so a gate needs no change to honour a subscription. The workspace's own override still wins over it (resolveFeature), and
    // it applies after a lapsed plan fell back to the free plan: it is the workspace's own purchase, not part of the plan.
    if (row.app_grants && Object.keys(row.app_grants).length > 0)
      planFeatures = { ...planFeatures, ...row.app_grants };
    return {
      orgId,
      planSlug: row.plan_slug,
      planKnown: row.plan_found,
      planName: row.plan_name,
      trialEndsAt,
      planEndsAt,
      billingCycle: row.billing_cycle ?? 'monthly',
      platformOwned: row.platform_owned ?? false,
      overrides: row.overrides ?? {},
      planLimits,
      planFeatures,
      state,
      visibleApps: {
        all: (row.platform_owned ?? false) || !row.plan_found,
        appIds: new Set(visibleIds),
      },
    };
  }

  /** The Marketplace app ids a plan (by row id) makes visible. */
  private async visibleAppIds(planId: number): Promise<number[]> {
    const res = await this.db.primary.execute(sql`
      SELECT ap.marketplace_app_id::text AS app_id FROM plan_visible_addons pv
      JOIN plans ap ON ap.id = pv.addon_plan_id AND ap.marketplace_app_id IS NOT NULL
      WHERE pv.plan_id = ${planId}
    `);
    return (res.rows as unknown as Array<{ app_id: string }>).map((r) => Number(r.app_id));
  }

  /** The first active free plan by catalogue order (Reference's "free package"), or null when the catalogue has none. */
  private async freePlan(): Promise<{
    id: number;
    limits: Record<string, unknown>;
    features: Record<string, unknown>;
  } | null> {
    const res = await this.db.primary.execute(sql`
      SELECT ${PLAN_COLUMNS} FROM plans
      WHERE kind = 'plan' AND is_active AND NOT is_custom_quote AND (is_free OR amount = 0)
      ORDER BY sort_order, plans.amount, slug LIMIT 1
    `);
    const row = res.rows[0] as unknown as PlanRow | undefined;
    if (!row) return null;
    const facts = toFacts(row);
    return planKind(facts) === 'free'
      ? { id: Number(row.id), limits: row.limits, features: row.features }
      : null;
  }

  /** Whether the organization's plan (or an override) grants the flag. */
  async featureEnabled(orgId: number, key: PlanFeatureKey): Promise<boolean> {
    const e = await this.forOrg(orgId);
    if (!e) return false; // no such organization: nothing is granted
    return resolveFeature(e, key);
  }

  /** The cap on `key`; 0 means unlimited. */
  async limit(orgId: number, key: PlanLimitKey): Promise<number> {
    const e = await this.forOrg(orgId);
    return e ? resolveLimit(e, key) : 0;
  }

  // --- guards (TW-PLAN-017) ----------------------------------------------------------------------------------------------

  /** Throws the plan-locked problem (422 PLAN_FEATURE_LOCKED) when the flag is off. */
  async assertFeature(orgId: number, key: PlanFeatureKey, message?: string): Promise<void> {
    if (await this.featureEnabled(orgId, key)) return;
    throw new AppError(
      ERROR_CODES.PLAN_FEATURE_LOCKED,
      message ?? "This feature isn't available on your current plan. Upgrade to unlock it.",
      HttpStatus.UNPROCESSABLE_ENTITY,
      [
        { path: 'feature', message: key },
        { path: 'reason', message: 'feature_disabled' },
        { path: 'upgradeUrl', message: PLAN_UPGRADE_PATH },
      ],
    );
  }

  /**
   * Throws 422 PLAN_LIMIT_REACHED when creating one more would exceed the cap.
   * `used` is the CURRENT count, before the insert (Reference blocks row N+1).
   */
  async assertWithinLimit(orgId: number, key: PlanLimitKey, used: number): Promise<void> {
    const cap = await this.limit(orgId, key);
    if (cap === 0 || used < cap) return;
    throw new AppError(
      ERROR_CODES.PLAN_LIMIT_REACHED,
      `You've reached your plan's limit of ${cap} ${key.replace(/_/g, ' ')}. Upgrade your plan to add more, or delete an existing one to free up space.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      [
        { path: 'limit', message: key },
        { path: 'reason', message: 'limit_reached' },
        { path: 'used', message: String(used) },
        { path: 'limitValue', message: String(cap) },
        { path: 'upgradeUrl', message: PLAN_UPGRADE_PATH },
      ],
    );
  }
}

// --- pure resolution (exported for unit tests) ----------------------------------------------------------------

export function resolveFeature(e: Entitlements, key: PlanFeatureKey): boolean {
  if (e.platformOwned) return true;
  const override = e.overrides.features?.[key];
  if (typeof override === 'boolean') return override;
  if (!e.planKnown) return true;
  return storedFeature(e.planFeatures, key);
}

export function resolveLimit(e: Entitlements, key: PlanLimitKey): number {
  if (e.platformOwned) return 0;
  const override = e.overrides.limits?.[key];
  if (typeof override === 'number' && Number.isInteger(override))
    return override > 0 ? override : 0;
  if (!e.planKnown) return 0;
  return storedLimit(e.planLimits, key);
}

/** Whether the plan makes the paid Marketplace app visible to the workspace (visible is not usable: the workspace must still buy it). */
export function appVisibleOnPlan(e: Entitlements, appId: number): boolean {
  return e.visibleApps.all || e.visibleApps.appIds.has(appId);
}
