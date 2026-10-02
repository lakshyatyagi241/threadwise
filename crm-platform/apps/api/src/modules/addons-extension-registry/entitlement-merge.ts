import { storedFeature, storedLimit, isPlanFeatureKey, isPlanLimitKey } from '@crm/contracts';
import type { AddonGrants } from '@crm/contracts';

/**
 * Add-ons merged onto a workspace's plan (WD-ADD-031). Pure: the caller loads the plan facts and the workspace's
 * active add-ons, these decide the answer. The plan facts are the shape the plan domain's resolver already holds.
 *
 * Resolution order, for a flag or a cap:
 *   1. an organization the platform owns is never limited
 *   2. the organization's own override wins outright (add-ons are irrelevant)
 *   3. no plan row: nothing is locked (same rule as the plan domain)
 *   4. the plan's value, then the add-ons on top
 *
 * Caps use the plan domain's convention: whole numbers, 0 = UNLIMITED. WaDesk summed an add-on's +2 onto a plan
 * cap of 0 ("unlimited") and so LOWERED the cap to 2 (WD-ADD-031 QUIRK 4); here unlimited is absorbing: an
 * unlimited plan stays unlimited, and any add-on granting -1 makes the result unlimited.
 */
export interface PlanFacts {
  platformOwned: boolean;
  planKnown: boolean;
  overrides: { limits?: Record<string, unknown>; features?: Record<string, unknown> };
  planFeatures: Record<string, unknown>;
  planLimits: Record<string, unknown>;
}

export function mergeFeature(
  plan: PlanFacts,
  key: string,
  addons: readonly AddonGrants[],
  opts: { dormant?: boolean } = {},
): boolean {
  if (plan.platformOwned) return true;
  const override = plan.overrides.features?.[key];
  if (typeof override === 'boolean') return override;
  // A flag of a module that is no longer on grants nothing, whatever a plan or an add-on still says (WD-ADD-015).
  if (opts.dormant) return false;
  if (!plan.planKnown) return true;
  const base = isPlanFeatureKey(key)
    ? storedFeature(plan.planFeatures, key)
    : plan.planFeatures[key] === true;
  return base || addons.some((a) => a.features.includes(key));
}

/** `moduleDefault`: what a plan row without this key means for a module-contributed cap (null = unlimited). */
export function mergeLimit(
  plan: PlanFacts,
  key: string,
  addons: readonly AddonGrants[],
  moduleDefault: number | null = null,
): number {
  if (plan.platformOwned) return 0;
  const override = plan.overrides.limits?.[key];
  if (typeof override === 'number' && Number.isInteger(override)) return override > 0 ? override : 0;
  if (!plan.planKnown) return 0;

  const stored = plan.planLimits[key];
  const base = isPlanLimitKey(key)
    ? storedLimit(plan.planLimits, key)
    : typeof stored === 'number' && Number.isInteger(stored) && stored > 0
      ? stored
      : stored === undefined
        ? (moduleDefault ?? 0)
        : 0;
  if (base === 0) return 0; // unlimited absorbs

  const deltas = addons.map((a) => a.limits[key]).filter((v): v is number => v !== undefined);
  if (deltas.includes(-1)) return 0;
  return base + deltas.reduce((sum, d) => sum + d, 0);
}
