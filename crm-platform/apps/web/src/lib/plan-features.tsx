'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { planFeaturesOfLine, type FeatureAddon, type PlanProductLine } from '@crm/contracts';

/**
 * The plan features the workspace has right now (its plan, its overrides and the Marketplace apps it has installed), read once by the
 * workspace layout from `GET /v2/billing/entitlements` and handed to every client component. Screens that sit inside another screen (the
 * score on a contact, the growth card in the inbox) use it to leave out what the workspace does not have, instead of asking the API and
 * being refused. The server stays the authority: every route checks the feature on its own.
 *
 * The same call names the add-on that sells each feature an add-on may grant (`featureAddons`: name, price and what this workspace's plan
 * offers: `buy`, `included`, `owned`, `unavailable` or `hidden`), so a locked screen names the add-on from data, never from code.
 *
 * Unknown (`null`: the entitlement call failed, or no provider is mounted) removes nothing, like the menu: nothing is hidden on a guess.
 */
interface PlanFeaturesValue {
  features: ReadonlySet<string> | null;
  featureAddons: ReadonlyMap<string, FeatureAddon> | null;
}

const PlanFeaturesContext = createContext<PlanFeaturesValue>({
  features: null,
  featureAddons: null,
});

export function PlanFeaturesProvider({
  features,
  featureAddons = null,
  children,
}: {
  features: readonly string[] | null;
  /** The add-on of each feature an add-on may grant; null when unknown (no add-on is named, nothing is hidden). */
  featureAddons?: readonly FeatureAddon[] | null;
  children: ReactNode;
}) {
  const value = useMemo<PlanFeaturesValue>(
    () => ({
      features: features ? new Set(features) : null,
      featureAddons: featureAddons ? new Map(featureAddons.map((a) => [a.feature, a])) : null,
    }),
    [features, featureAddons],
  );
  return <PlanFeaturesContext.Provider value={value}>{children}</PlanFeaturesContext.Provider>;
}

/** True when the workspace has the plan feature, or when that is not known yet. */
export function usePlanFeature(key: string): boolean {
  const { features } = useContext(PlanFeaturesContext);
  return features === null || features.has(key);
}

/**
 * The add-on that sells this plan feature, with what the workspace's plan offers for it and its price; null when no add-on sells it or
 * when that is not known (no provider, the entitlement call failed). A caller never hides anything on null.
 */
export function useFeatureAddon(key: string): FeatureAddon | null {
  const { featureAddons } = useContext(PlanFeaturesContext);
  return featureAddons?.get(key) ?? null;
}

/** The same, for several keys at once (in the order given; unknown keys are left out). */
export function useFeatureAddons(keys: readonly string[]): FeatureAddon[] {
  const { featureAddons } = useContext(PlanFeaturesContext);
  if (!featureAddons) return [];
  return keys.flatMap((k) => {
    const a = featureAddons.get(k);
    return a ? [a] : [];
  });
}

/** For each key: true when the workspace has it or when that is not known yet (like `usePlanFeature`). */
export function usePlanFeatureList(keys: readonly string[]): boolean[] {
  const { features } = useContext(PlanFeaturesContext);
  return keys.map((k) => features === null || features.has(k));
}

/**
 * True when the workspace has at least one plan feature of the product line (`chat`, `crm`, `platform`; each key's line is declared once in
 * the contracts' feature registry), or when that is not known yet. A "Chat" edition is a plan with the `crm` keys off, so a screen asks this
 * instead of a plan name. Hiding what an edition does not use is the persona's job; this only reports what the plan gives.
 */
export function usePlanProductLine(line: PlanProductLine): boolean {
  const { features } = useContext(PlanFeaturesContext);
  return features === null || planFeaturesOfLine(line).some((k) => features.has(k));
}

/**
 * The two Teams packaging features (BL-383). Teams v2 asks `hierarchy` before it draws a parent team, a lead or manager picker or the
 * "my team and sub-teams" scope; the Roles screens ask `customRoles`. Unknown plan: both true, like `usePlanFeature`.
 */
export function useTeamsPackaging(): { hierarchy: boolean; customRoles: boolean } {
  return {
    hierarchy: usePlanFeature('team_hierarchy'),
    customRoles: usePlanFeature('custom_roles'),
  };
}
