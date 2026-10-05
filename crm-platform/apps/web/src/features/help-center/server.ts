import 'server-only';
import { cache } from 'react';
import { getLocale } from 'next-intl/server';
import { CAPABILITIES_UNKNOWN } from '@/features/_registry/resolve';
import { fetchEnabledFeatures } from '@/features/plans-subscriptions-trials/server';
import { getSession } from '@/lib/auth/server';
import type { VisibleHelp } from './resolve';
import { helpFor } from './view';

/**
 * What the signed-in person may see in Help, for the `/help` pages and the tip action: the same capabilities the app layout builds
 * (their permissions, their plan's features, unknown when the plan lookup fails) run through `helpFor`. Null when signed out. Cached per request, so a page and its metadata share one lookup.
 */
export const getVisibleHelp = cache(async (): Promise<VisibleHelp | null> => {
  const { session } = await getSession();
  if (!session) return null;
  const caps = {
    ...CAPABILITIES_UNKNOWN,
    permissions: new Set(Object.keys(session.permissions)),
    planFeatures: await fetchEnabledFeatures(),
  };
  return helpFor(caps, await getLocale());
});
