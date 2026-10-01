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
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { PlanCatalogService } from './plan-catalog.service';
import { trialFor, type DefaultPlanStep, type TrialStamp } from './plan-rules';

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
}

/**
 * Entitlements (WD-PLAN-006/007/017): "may this organization use feature X" and
 * "what is its cap on Y", plus what a new organization starts with.
 *
 * Resolution order, for a flag or a cap:
 *   1. organizations the platform owns are never limited
 *   2. the organization's own override
 *   3. its plan's value (a flag the plan row predates takes the registry default)
 *   4. NO PLAN ROW: nothing is locked. An organization whose plan slug has no
 *      catalogue row (a fresh install with no plans, the literal 'starter', a
 *      deleted plan) must not be locked out of the product by a missing
 *      catalogue; WaDesk behaves the same ("no package resolves to null
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
               (p.id IS NOT NULL) AS plan_found
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
    return {
      orgId,
      planSlug: row.plan_slug,
      planKnown: row.plan_found,
      planName: row.plan_name,
      trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at) : null,
      planEndsAt: row.plan_ends_at ? new Date(row.plan_ends_at) : null,
      billingCycle: row.billing_cycle ?? 'monthly',
      platformOwned: row.platform_owned ?? false,
      overrides: row.overrides ?? {},
      planLimits: row.plan_limits ?? {},
      planFeatures: row.plan_features ?? {},
    };
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

  // --- guards (WD-PLAN-017) ----------------------------------------------------------------------------------------------

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
   * `used` is the CURRENT count, before the insert (WaDesk blocks row N+1).
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
  if (typeof override === 'number' && Number.isInteger(override)) return override > 0 ? override : 0;
  if (!e.planKnown) return 0;
  return storedLimit(e.planLimits, key);
}
