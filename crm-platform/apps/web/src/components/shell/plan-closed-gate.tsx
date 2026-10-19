'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { gateFor, type PaywallGate } from '@/features/plans-subscriptions-trials/components/plan-paywall';

/** Whether the path belongs to a screen whose plan feature is known to be off. `enabled` null (plan unknown) closes nothing. */
export function closedPlanGate(
  pathname: string,
  gates: readonly PaywallGate[],
  enabled: readonly string[] | null,
): PaywallGate | null {
  if (!enabled) return null;
  const gate = gateFor(pathname, gates);
  return gate && !enabled.includes(gate.feature) ? gate : null;
}

/**
 * Does not mount a screen the plan lacks (`gates.closeWhenLocked`). The upgrade sheet (`PlanPaywall`) is drawn over the empty page, and
 * none of the screen's requests fire, so a workspace without the feature gets no wall of `PLAN_FEATURE_LOCKED` errors. The API stays
 * the authority: it refuses the routes on its own.
 */
export function PlanClosedGate({
  gates,
  enabled,
  children,
}: {
  gates: readonly PaywallGate[];
  enabled: readonly string[] | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  if (closedPlanGate(pathname, gates, enabled)) return null;
  return <>{children}</>;
}
