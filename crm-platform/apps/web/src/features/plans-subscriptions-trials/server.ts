import 'server-only';
import { cookies } from 'next/headers';
import { entitlementsResponseSchema, type FeatureAddon } from '@crm/contracts';
import { ACCESS_COOKIE } from '@/lib/auth/cookies';
import { apiBase } from '@/lib/auth/server';

export interface WorkspaceEntitlements {
  features: ReadonlySet<string>;
  /** The add-on that sells each feature an add-on may grant, with what this workspace's plan offers and its price. */
  featureAddons: readonly FeatureAddon[];
}

/**
 * What this workspace has, for the shell to lock the menu (TW-PLAN-021), to draw the paywall (TW-PLAN-020) and to name the add-on on a
 * locked screen. Null when it cannot be read: unknown must never lock anything (a slow plan lookup must not make the whole menu look locked).
 */
export async function fetchEntitlements(): Promise<WorkspaceEntitlements | null> {
  try {
    const at = (await cookies()).get(ACCESS_COOKIE)?.value;
    if (!at) return null;
    const res = await fetch(`${apiBase()}/v2/billing/entitlements`, {
      headers: { Authorization: `Bearer ${at}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const parsed = entitlementsResponseSchema.safeParse(await res.json());
    return parsed.success
      ? { features: new Set(parsed.data.features), featureAddons: parsed.data.featureAddons }
      : null;
  } catch {
    return null;
  }
}

/** The plan feature keys alone (see `fetchEntitlements`); null when they cannot be read. */
export async function fetchEnabledFeatures(): Promise<ReadonlySet<string> | null> {
  return (await fetchEntitlements())?.features ?? null;
}
