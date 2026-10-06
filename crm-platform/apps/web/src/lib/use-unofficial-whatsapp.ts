'use client';

import { useQuery } from '@tanstack/react-query';
import { entitlementsResponseSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { unofficialEnabledIn } from './unofficial-whatsapp';

export const ENTITLEMENTS_KEY = ['billing', 'entitlements'] as const;

/**
 * Whether the platform has switched the unofficial WhatsApp engine on. False while loading and when the call fails, so nothing
 * unofficial flashes up before the answer is known. Workspace pages only (the call needs a workspace session).
 */
export function useUnofficialWhatsapp(): boolean {
  const q = useQuery({
    queryKey: ENTITLEMENTS_KEY,
    queryFn: ({ signal }) =>
      apiFetch('/billing/entitlements', { schema: entitlementsResponseSchema, signal }),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: true,
  });
  return unofficialEnabledIn(q.data?.features);
}
