'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  companyBriefResultSchema,
  companyBriefStateSchema,
  type CompanyBriefResult,
  type CompanyBriefState,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

export const briefKey = (id: string) => ['companies', 'brief', id] as const;

/**
 * The AI brief of a company (BL-194): whether one can be written and the caller's latest. Asking calls no model. `enabled` is false for
 * someone who may not read companies.
 */
export function useCompanyBrief(id: string, enabled = true) {
  const qc = useQueryClient();
  const state = useQuery({
    queryKey: briefKey(id),
    enabled,
    retry: false,
    staleTime: 30_000,
    queryFn: ({ signal }) =>
      apiFetch(`/companies/${id}/brief`, { schema: companyBriefStateSchema, signal }),
  });
  const generate = useMutation({
    mutationFn: (regenerate: boolean): Promise<CompanyBriefResult> =>
      apiFetch(`/companies/${id}/brief`, {
        method: 'POST',
        body: { regenerate },
        schema: companyBriefResultSchema,
      }),
    onSuccess: (result) => {
      // The written brief is the new state: no second round trip to show it.
      qc.setQueryData<CompanyBriefState>(briefKey(id), (old) => ({
        available: true,
        sources: result.brief.sources,
        ...(old ?? {}),
        brief: result.brief,
      }));
    },
  });
  return { state, generate };
}
