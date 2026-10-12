'use client';

import { useQuery } from '@tanstack/react-query';
import { entitlementsResponseSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { unofficialEnabledIn, type UnofficialState } from './unofficial-whatsapp';

export const ENTITLEMENTS_KEY = ['billing', 'entitlements'] as const;

function useEntitlements() {
  return useQuery({
    queryKey: ENTITLEMENTS_KEY,
    queryFn: ({ signal }) =>
      apiFetch('/billing/entitlements', { schema: entitlementsResponseSchema, signal }),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: true,
  });
}

/**
 * Whether the platform has switched the unofficial WhatsApp engine on. False while loading and when the call fails, so nothing
 * unofficial flashes up before the answer is known. Workspace pages only (the call needs a workspace session).
 */
export function useUnofficialWhatsapp(): boolean {
  return unofficialEnabledIn(useEntitlements().data?.features);
}

/**
 * The same answer with its loading and failed states told apart (see `UnofficialState`), for the campaign screens, which wait for it
 * rather than show a list that is empty only because the answer has not come yet.
 */
export function useUnofficialWhatsappState(): UnofficialState {
  const q = useEntitlements();
  if (q.data) return unofficialEnabledIn(q.data.features) ? 'on' : 'off';
  return q.isPending ? 'pending' : 'unknown';
}
