'use client';

import { useQuery } from '@tanstack/react-query';
import { contactDealsResponseSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

export const DEALS_KEY = (contactId: string) => ['cat', 'contact-deals', contactId] as const;

/**
 * One contact's deals (open first, then newest, at most 50, no cursor) with the open and won rollup per currency.
 * The route needs `record.deals.read` and the sales-pipeline plan; the caller passes `enabled` = the permission, and a
 * 403 or a 422 `PLAN_FEATURE_LOCKED` is shown as "not available" by the section (see `isNotAvailableToYou`), so no retry.
 */
export function useContactDeals(contactId: string, enabled: boolean) {
  return useQuery({
    queryKey: DEALS_KEY(contactId),
    enabled,
    retry: false,
    // A refusal (403, plan lock) does not change by asking again on every remount; the section offers "Try again" for real failures.
    retryOnMount: false,
    queryFn: ({ signal }) =>
      apiFetch(`/contacts/${contactId}/deals`, { schema: contactDealsResponseSchema, signal }),
  });
}
