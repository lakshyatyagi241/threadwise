'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  helpAgentSettingsSchema,
  helpAgentStatusSchema,
  helpAgentTaskFinishedSchema,
  helpAgentTaskStartedSchema,
  type FinishHelpAgentTaskInput,
  type StartHelpAgentTaskInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

export const KEYS = {
  status: ['help-agent', 'status'] as const,
  settings: ['help-agent', 'settings'] as const,
};

/**
 * Whether the assistant is on for this person. Only asked when the plan and the role already allow it (the caller passes `enabled`), so
 * a workspace that does not have the feature never makes the call. A failure reads as "not available": the launcher stays hidden.
 */
export function useHelpAgentStatus(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.status,
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) =>
      apiFetch('/help-agent/status', { schema: helpAgentStatusSchema, signal }),
  });
}

export function useHelpAgentSettings(enabled = true) {
  return useQuery({
    queryKey: KEYS.settings,
    enabled,
    queryFn: ({ signal }) =>
      apiFetch('/help-agent/settings', { schema: helpAgentSettingsSchema, signal }),
  });
}

export function useSaveHelpAgentSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch('/help-agent/settings', {
        method: 'PUT',
        body: { enabled },
        schema: helpAgentSettingsSchema,
      }),
    onSuccess: (saved) => {
      qc.setQueryData(KEYS.settings, saved);
      void qc.invalidateQueries({ queryKey: KEYS.status });
    },
  });
}

export const startTask = (body: StartHelpAgentTaskInput) =>
  apiFetch('/help-agent/tasks', { method: 'POST', body, schema: helpAgentTaskStartedSchema });

export const finishTask = (taskId: string, body: FinishHelpAgentTaskInput) =>
  apiFetch(`/help-agent/tasks/${taskId}/finish`, {
    method: 'POST',
    body,
    schema: helpAgentTaskFinishedSchema,
  });
