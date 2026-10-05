import {
  PLAN_FEATURE_LABELS,
  type PermissionDefResponse,
  type PlanFeatureKey,
} from '@crm/contracts';

/** Why a permission key cannot be used yet: its plan feature is off for the workspace, or its Marketplace app is not installed. */
export type PermissionBadge = { kind: 'plan_feature'; key: string } | { kind: 'app'; slug: string };

/** The badge a permission row carries, or null for a core key and for an add-on key the workspace already has. */
export function permissionBadge(def: Pick<PermissionDefResponse, 'lock'>): PermissionBadge | null {
  return def.lock ?? null;
}

export const isLocked = (def: Pick<PermissionDefResponse, 'lock'>): boolean =>
  permissionBadge(def) !== null;

/** English fallback for a plan feature whose message is missing (the feature catalogue is the source of the words). */
export function planFeatureFallback(key: string): string {
  return (PLAN_FEATURE_LABELS as Record<string, string | undefined>)[key as PlanFeatureKey] ?? key;
}

/** Keys a role can be granted right now: locked ones are shown but not selectable, and are left out of "select all". */
export const selectableKeys = (defs: readonly PermissionDefResponse[]): string[] =>
  defs.filter((d) => !isLocked(d)).map((d) => d.key);
