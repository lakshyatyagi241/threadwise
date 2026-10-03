import 'server-only';
import { cookies } from 'next/headers';
import { entitlementsResponseSchema } from '@crm/contracts';
import { ACCESS_COOKIE } from '@/lib/auth/cookies';
import { apiBase } from '@/lib/auth/server';

/**
 * The plan features this workspace has, for the shell to lock the menu (TW-PLAN-021) and to draw the paywall (TW-PLAN-020). A set of keys, or
 * null when it cannot be read: unknown must never lock anything (a slow plan lookup must not make the whole menu look locked).
 */
export async function fetchEnabledFeatures(): Promise<ReadonlySet<string> | null> {
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
    return parsed.success ? new Set(parsed.data.features) : null;
  } catch {
    return null;
  }
}
