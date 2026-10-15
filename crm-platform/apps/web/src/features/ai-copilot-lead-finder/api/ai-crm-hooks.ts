'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiCrmMessageInput, AiCrmSettingsInput } from '@crm/contracts';
import { aiCrmApi } from './ai-crm-service';

export const AI_CRM_KEYS = {
  index: () => ['ai-crm', 'index'] as const,
};

export function useAiCrmIndex() {
  return useQuery({
    queryKey: AI_CRM_KEYS.index(),
    queryFn: ({ signal }) => aiCrmApi.index(signal),
  });
}

export function useSendAiCrmMessage() {
  return useMutation({
    mutationFn: (input: AiCrmMessageInput) => aiCrmApi.message(input),
  });
}

export function useResetAiCrm() {
  return useMutation({
    mutationFn: () => aiCrmApi.reset(),
  });
}

export function useSetAiCrmSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AiCrmSettingsInput) => aiCrmApi.settings(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: AI_CRM_KEYS.index() }),
  });
}
