'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  flowGetaSyncSchema,
  getaPublishSettingsSchema,
  type UpdateGetaPublishSettingsRequest,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

/** Typed calls for Geta console publishing, through the same-origin proxy. Responses are parsed with their contract schema. */
export const getaApi = {
  status: (flowId: string, signal?: AbortSignal) =>
    apiFetch(`/flows/${flowId}/publish-sync`, { schema: flowGetaSyncSchema, signal }),
  retry: (flowId: string) =>
    apiFetch(`/flows/${flowId}/publish-sync/retry`, { method: 'POST', schema: flowGetaSyncSchema }),
  settings: (signal?: AbortSignal) =>
    apiFetch('/flows/geta-publish/settings', { schema: getaPublishSettingsSchema, signal }),
  save: (body: UpdateGetaPublishSettingsRequest) =>
    apiFetch('/flows/geta-publish/settings', {
      method: 'PUT',
      body,
      schema: getaPublishSettingsSchema,
    }),
  clear: () =>
    apiFetch('/flows/geta-publish/settings', {
      method: 'DELETE',
      schema: getaPublishSettingsSchema,
    }),
};

export const GETA_KEYS = { settings: ['flb', 'geta', 'settings'] as const };

export function useGetaSettings() {
  return useQuery({
    queryKey: GETA_KEYS.settings,
    queryFn: ({ signal }) => getaApi.settings(signal),
    staleTime: 0,
  });
}

export function useSaveGetaSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateGetaPublishSettingsRequest) => getaApi.save(body),
    onSuccess: (data) => qc.setQueryData(GETA_KEYS.settings, data),
  });
}

export function useClearGetaSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => getaApi.clear(),
    onSuccess: (data) => qc.setQueryData(GETA_KEYS.settings, data),
  });
}
