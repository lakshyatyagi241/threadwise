import { isMarketEntitlementKey } from '@crm/contracts';

/**
 * Plan features that a paid Marketplace app grants (`marketplace_apps.grants_plan_features`, carried by the add-on that sells the app).
 *
 * THE rule, in one place (owner decision 2026-10-08): a subscribed app's plan features are on only while the app is INSTALLED and running
 * in the workspace. A subscription alone grants nothing but the app's own entitlement key (`mkt_<slug>`, which is what lets the workspace
 * install it at all). Both resolvers that merge a workspace's purchases onto its plan use this function: the plan domain's
 * `PlanEntitlementService.forOrg` (menu, `@RequirePlanFeature`, the entitlements the web reads) and the add-ons domain's
 * `AddonEntitlementService` (the Roles editor, Marketplace access), so they cannot disagree.
 *
 * A feature the workspace's PLAN carries (or an override sets) is not touched: this only decides what the app adds on top.
 */

/** The state of the workspace's installation of the app: no row at all, or the row's status. */
export type InstallStatus = 'active' | 'disabled' | 'killed' | null;

/** One live app add-on the workspace owns, with the state of its installation of the app. */
export interface AppPack {
  slug: string;
  /** The add-on plan row's `features` object (`{ mkt_forms: true, form_builder: true }`). */
  features: unknown;
  install: InstallStatus;
}

/** A plan feature a subscribed app would grant but does not, because the app is not running in the workspace. */
export interface WithheldAppFeature {
  slug: string;
  /** True when the workspace has the app installed but paused (or switched off by the platform): its admins may still manage access. */
  installed: boolean;
}

const trueKeys = (features: unknown): string[] =>
  features && typeof features === 'object'
    ? Object.entries(features as Record<string, unknown>)
        .filter(([, v]) => v === true)
        .map(([k]) => k)
    : [];

/** The feature keys of one app add-on that count for the workspace: its own key always, its plan features only when installed and active. */
export function grantedByPack(pack: AppPack): string[] {
  const keys = trueKeys(pack.features);
  return pack.install === 'active' ? keys : keys.filter(isMarketEntitlementKey);
}

/** What the workspace's app add-ons grant, and what they would grant if the app were installed and running. */
export function splitAppPacks(packs: readonly AppPack[]): {
  granted: Record<string, true>;
  withheld: Record<string, WithheldAppFeature>;
} {
  const granted: Record<string, true> = {};
  const withheld: Record<string, WithheldAppFeature> = {};
  for (const pack of packs) {
    for (const key of grantedByPack(pack)) granted[key] = true;
    if (pack.install === 'active') continue;
    for (const key of trueKeys(pack.features)) {
      if (isMarketEntitlementKey(key)) continue;
      withheld[key] = { slug: pack.slug, installed: pack.install !== null };
    }
  }
  // A feature another running app (or the plan) grants is not withheld.
  for (const key of Object.keys(granted)) delete withheld[key];
  return { granted, withheld };
}
