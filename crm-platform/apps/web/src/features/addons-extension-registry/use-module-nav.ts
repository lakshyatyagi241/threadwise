'use client';

import { useQuery } from '@tanstack/react-query';
import { navContributionsResponseSchema } from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';

/** What active modules add to the operator rail. A failure is not an error worth showing: the rail just has no extras. */
export function useModuleNav(enabled: boolean) {
  return useQuery({
    queryKey: ['operator', 'extension-nav'],
    queryFn: ({ signal }) =>
      operatorFetch('/extensions/nav', { schema: navContributionsResponseSchema, signal }),
    enabled,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  }).data?.admin;
}
