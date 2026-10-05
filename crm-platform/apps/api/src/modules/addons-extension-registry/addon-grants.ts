import type { AddonBullet, AddonGrants } from '@crm/contracts';

/**
 * The pure rules of add-on grants (WD-ADD-028 rules 2 and 3, WD-ADD-031, WD-ADD-033). No database, no clock, no
 * framework: the service decides what to load, these decide what it means.
 */

/** How many grant bullets a card shows. */
export const MAX_BULLETS = 5;

export interface AllowedKeys {
  features: ReadonlySet<string>;
  limits: ReadonlySet<string>;
}

/**
 * What a submitted form is allowed to grant:
 *   - features: only keys the product knows (core flags plus enabled modules'); anything else is dropped silently, so
 *     a forged key cannot smuggle in a bogus feature
 *   - limits: only known keys; blank (null) and 0 are "not granted" and never stored; -1 grants unlimited; any
 *     positive whole number is added on top of the plan's cap
 */
export function normaliseGrants(
  input: { features: readonly string[]; limits: Readonly<Record<string, number | null>> },
  allowed: AllowedKeys,
): AddonGrants {
  const features = [...new Set(input.features)].filter((k) => allowed.features.has(k)).sort();
  const limits: Record<string, number> = {};
  for (const key of Object.keys(input.limits).sort()) {
    const v = input.limits[key];
    if (!allowed.limits.has(key) || v === null || v === undefined || v === 0) continue;
    if (Number.isInteger(v) && v >= -1) limits[key] = v;
  }
  return { features, limits };
}

/** Grants as stored on a plan row (`features` {key: true}, `limits` {key: delta}); anything malformed is "no grant". */
export function readGrants(features: unknown, limits: unknown): AddonGrants {
  const f =
    features && typeof features === 'object'
      ? Object.entries(features as Record<string, unknown>)
          .filter(([, v]) => v === true)
          .map(([k]) => k)
          .sort()
      : [];
  const l: Record<string, number> = {};
  if (limits && typeof limits === 'object') {
    for (const [k, v] of Object.entries(limits as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isInteger(v) && v !== 0 && v >= -1) l[k] = v;
    }
  }
  return { features: f, limits: l };
}

export const featuresColumn = (g: AddonGrants): Record<string, boolean> =>
  Object.fromEntries(g.features.map((k) => [k, true]));

/** A pack with any limit boost can be bought again to stack (WD-ADD-033 rule 2); a feature-only pack cannot. */
export const isStackable = (g: AddonGrants): boolean => Object.keys(g.limits).length > 0;

/** "access_campaigns" -> "Access campaigns": the label of a core flag or cap, which carries no title of its own. */
export const titledKey = (k: string): string =>
  k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** "Unlimited <limit>" for -1, "+N <limit>" for a positive delta, the feature itself otherwise; capped at five. */
export function grantBullets(
  g: AddonGrants,
  labelOf: (key: string) => string = titledKey,
): AddonBullet[] {
  const bullets: AddonBullet[] = [
    ...g.features.map((key): AddonBullet => ({
      kind: 'feature',
      key,
      label: labelOf(key),
      amount: null,
    })),
    ...Object.entries(g.limits).map(([key, v]): AddonBullet =>
      v === -1
        ? { kind: 'limit_unlimited', key, label: labelOf(key), amount: null }
        : { kind: 'limit_add', key, label: labelOf(key), amount: v },
    ),
  ];
  return bullets.slice(0, MAX_BULLETS);
}

/**
 * The card's button (WD-ADD-033): a feature-only pack the workspace already owns reads "active" (no button), a
 * stackable pack it owns offers "buy again", anything else is a plain "buy".
 */
export function cardState(g: AddonGrants, ownedCount: number): 'buy' | 'active' | 'buy_again' {
  if (ownedCount === 0) return 'buy';
  return isStackable(g) ? 'buy_again' : 'active';
}

export type BillingUnit = 'days' | 'weeks' | 'months' | 'years';

/**
 * When a purchase made at `now` ends (WD-ADD-032): never for a free or lifetime pack, otherwise `max(1, duration)`
 * units later. A month or year step that would land past the end of the target month (31 Jan + 1 month) lands on its
 * last day instead of spilling into the next one.
 */
export function addonEndsAt(
  now: Date,
  p: { isFree: boolean; isLifetime: boolean; billingUnit: BillingUnit; billingDuration: number },
): Date | null {
  if (p.isFree || p.isLifetime) return null;
  const n = Math.max(1, p.billingDuration);
  const d = new Date(now.getTime());
  if (p.billingUnit === 'days') d.setUTCDate(d.getUTCDate() + n);
  else if (p.billingUnit === 'weeks') d.setUTCDate(d.getUTCDate() + 7 * n);
  else {
    const months = p.billingUnit === 'years' ? 12 * n : n;
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d;
}

/**
 * SQL for "this purchase still counts" on `workspace_addons a`: active and not past its end, or past its end by less than the
 * grace days while an autopay subscription for that very purchase is still live (the charge is being retried). Evaluated at read
 * time, so a renewal or a final failure shows on the next call. The grace days come from the caller because `platform_settings`
 * is not readable from a tenant transaction.
 */
export const addonLiveSql = (graceDays: number): string => {
  const days = Math.max(0, Math.min(30, Math.trunc(graceDays)));
  return `a.status = 'active' AND (
  a.ends_at IS NULL OR a.ends_at > now()
  OR EXISTS (
    SELECT 1 FROM subscriptions sb
    WHERE sb.org_id = a.org_id AND sb.workspace_addon_id = a.id AND sb.kind = 'addon'
      AND sb.status IN ('active', 'past_due')
      AND a.ends_at > now() - make_interval(days => ${days})))`;
};
