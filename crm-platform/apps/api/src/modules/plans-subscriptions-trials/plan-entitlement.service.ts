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
import { PlanStore } from './plan-store';
import { fallsBackToFree, planStateOf } from './plan-lifecycle';
import { toFacts, PLAN_COLUMNS, type PlanRow } from './plan-row';
import { planKind, trialFor, type DefaultPlanStep, type TrialStamp } from './plan-rules';
import { splitAppPacks, type AppPack, type WithheldAppFeature } from './app-grants';

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
  /** A live autopay subscription for the stored plan, and the grace days that then apply (TW-PLAN-016, `paid_grace`). */
  autopay?: boolean;
  graceDays?: number;
  /** Which paid Marketplace apps the plan makes VISIBLE (not usable: using one still needs a purchase). */
  visibleApps: VisibleApps;
  /**
   * Plan features that a subscribed Marketplace app would grant but does not, because the app is not installed and running in this
   * workspace (see app-grants.ts). Not part of `planFeatures`: this only explains why a gate is closed (install the app, not upgrade).
   */
  appWithheld: Record<string, WithheldAppFeature>;
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
  autopay: boolean | null;
  /** The live app add-ons the workspace owns, each with the state of its installation (see app-grants.ts). */
  app_packs: Array<{ slug: string; features: unknown; install: AppPack['install'] }> | null;
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
    private readonly store: PlanStore,
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
               EXISTS (SELECT 1 FROM subscriptions sb
                       WHERE sb.org_id = o.id AND sb.kind = 'plan' AND sb.plan_id = o.plan
                         AND sb.status IN ('active', 'past_due')) AS autopay,
               (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', ma.slug, 'features', ap.features, 'install', wi.status)), '[]'::jsonb)
                  FROM workspace_addons wa
                  JOIN plans ap ON ap.id = wa.package_id AND ap.marketplace_app_id IS NOT NULL
                  JOIN marketplace_apps ma ON ma.id = ap.marketplace_app_id
                  LEFT JOIN workspace_app_installations wi ON wi.org_id = wa.org_id AND wi.app_id = ap.marketplace_app_id
                 WHERE wa.org_id = o.id AND wa.status = 'active' AND (wa.ends_at IS NULL OR wa.ends_at > now())) AS app_packs
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
    const graceDays = row.autopay ? await this.graceDays() : 0;
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
      autopay: row.autopay ?? false,
      graceDays,
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
    // Subscribing is not enough: the app must also be INSTALLED and running, or its plan features stay off (app-grants.ts). A feature the
    // plan itself carries is not touched by this.
    const packs = (row.app_packs ?? []).map((p) => ({
      slug: p.slug,
      features: p.features,
      install: p.install ?? null,
    }));
    const { granted, withheld } = splitAppPacks(packs);
    if (Object.keys(granted).length > 0) planFeatures = { ...planFeatures, ...granted };
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
      autopay: row.autopay ?? false,
      graceDays,
      visibleApps: {
        all: (row.platform_owned ?? false) || !row.plan_found,
        appIds: new Set(visibleIds),
      },
      appWithheld: withheld,
    };
  }

  /** `billing.grace_days`: how many days autopay keeps a lapsed paid plan active while it retries. */
  graceDays(): Promise<number> {
    return this.store.graceDays();
  }

  /** Drops the 30-second cache of the grace days (a test that writes the setting directly). */
  forgetGrace(): void {
    this.store.forgetGrace();
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
    throw featureLocked(await this.forOrg(orgId), key, message);
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

/**
 * The 422 PLAN_FEATURE_LOCKED problem for a closed feature. When the workspace subscribed to the app that grants it but has not installed
 * it (or it is paused), the reason is `app_not_installed` / `app_paused` and the problem names the app and where to install it, so the
 * person is not sent to upgrade a plan for something they already paid for. The code stays the same for every client.
 */
export function featureLocked(
  e: Entitlements | null,
  key: PlanFeatureKey,
  message?: string,
): AppError {
  const held = e?.appWithheld[key];
  if (held) {
    return new AppError(
      ERROR_CODES.PLAN_FEATURE_LOCKED,
      held.installed
        ? 'This app is paused in your workspace. Resume it from the Marketplace to use it.'
        : 'Install this app from the Marketplace to use it. Your subscription is active.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      [
        { path: 'feature', message: key },
        { path: 'reason', message: held.installed ? 'app_paused' : 'app_not_installed' },
        { path: 'app', message: held.slug },
        { path: 'installUrl', message: `/marketplace/app/${held.slug}` },
      ],
    );
  }
  return new AppError(
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
