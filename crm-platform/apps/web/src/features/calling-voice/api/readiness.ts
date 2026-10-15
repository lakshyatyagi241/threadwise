'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  callingReadinessListSchema,
  callingReadinessSchema,
  callingSettingsSchema,
  type CallingNumberList,
  type CheckReadinessInput,
  type UpdateCallingSettingsInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { callErrorKey } from '../lib/calls';
import { KEYS } from './calling';

const BASE = '/calling';

export const READINESS_KEYS = {
  list: ['call', 'readiness'] as const,
  settings: ['call', 'readiness', 'settings'] as const,
};

const refused = (e: unknown) => callErrorKey(e) === 'FORBIDDEN';

/** Every number's checklist as of its last check; cheap (no call to Meta), so it can load with the page. */
export function useCallingReadiness() {
  return useQuery({
    queryKey: READINESS_KEYS.list,
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/readiness`, { schema: callingReadinessListSchema, signal }),
    retry: (count, e) => !refused(e) && count < 2,
    staleTime: 30_000,
  });
}

/** Looks at the number now (Meta is asked, so it takes a few seconds) and replaces the stored checklist. */
export function useCheckReadiness() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Partial<CheckReadinessInput>) =>
      apiFetch(`${BASE}/numbers/${id}/readiness/check`, {
        method: 'POST',
        body: input,
        schema: callingReadinessSchema,
      }),
    onSuccess: (data) => {
      // Only what a check changes: the checklists, and the numbers list when the local switch moved (the check follows Meta's own).
      void qc.invalidateQueries({ queryKey: READINESS_KEYS.list, exact: true });
      const shown = qc
        .getQueryData<CallingNumberList>(KEYS.numbers)
        ?.rows.find((r) => r.id === data.numberId);
      if (shown && shown.callingEnabled !== data.callingEnabled) {
        void qc.invalidateQueries({ queryKey: KEYS.numbers });
      }
    },
  });
}

/** Whether calling is switched on by itself after a number is connected. */
export function useCallingSettings() {
  return useQuery({
    queryKey: READINESS_KEYS.settings,
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/settings`, { schema: callingSettingsSchema, signal }),
    retry: (count, e) => !refused(e) && count < 2,
    staleTime: 30_000,
  });
}

export function useSaveCallingSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCallingSettingsInput) =>
      apiFetch(`${BASE}/settings`, { method: 'PUT', body: input, schema: callingSettingsSchema }),
    onSuccess: (data) => qc.setQueryData(READINESS_KEYS.settings, data),
  });
}
