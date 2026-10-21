'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { planFeaturesOfLine, type PlanProductLine } from '@crm/contracts';

/**
 * The plan features the workspace has right now (its plan, its overrides and the Marketplace apps it has installed), read once by the
 * workspace layout from `GET /v2/billing/entitlements` and handed to every client component. Screens that sit inside another screen (the
 * score on a contact, the growth card in the inbox) use it to leave out what the workspace does not have, instead of asking the API and
 * being refused. The server stays the authority: every route checks the feature on its own.
 *
 * Unknown (`null`: the entitlement call failed, or no provider is mounted) removes nothing, like the menu: nothing is hidden on a guess.
 */
const PlanFeaturesContext = createContext<ReadonlySet<string> | null>(null);

export function PlanFeaturesProvider({
  features,
  children,
}: {
  features: readonly string[] | null;
  children: ReactNode;
}) {
  const value = useMemo(() => (features ? new Set(features) : null), [features]);
  return <PlanFeaturesContext.Provider value={value}>{children}</PlanFeaturesContext.Provider>;
}

/** True when the workspace has the plan feature, or when that is not known yet. */
export function usePlanFeature(key: string): boolean {
  const features = useContext(PlanFeaturesContext);
  return features === null || features.has(key);
}

/**
 * True when the workspace has at least one plan feature of the product line (`chat`, `crm`, `platform`; each key's line is declared once in
 * the contracts' feature registry), or when that is not known yet. A "Chat" edition is a plan with the `crm` keys off, so a screen asks this
 * instead of a plan name. Hiding what an edition does not use is the persona's job; this only reports what the plan gives.
 */
export function usePlanProductLine(line: PlanProductLine): boolean {
  const features = useContext(PlanFeaturesContext);
  return features === null || planFeaturesOfLine(line).some((k) => features.has(k));
}

/**
 * The two Teams packaging features (BL-383). Teams v2 asks `hierarchy` before it draws a parent team, a lead or manager picker or the
 * "my team and sub-teams" scope; the Roles screens ask `customRoles`. Unknown plan: both true, like `usePlanFeature`.
 */
export function useTeamsPackaging(): { hierarchy: boolean; customRoles: boolean } {
  return { hierarchy: usePlanFeature('team_hierarchy'), customRoles: usePlanFeature('custom_roles') };
}
