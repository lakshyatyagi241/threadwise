import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  exportCountsResponseSchema,
  notificationPrefsResponseSchema,
  preferencesResponseSchema,
  workspaceSettingsResponseSchema,
  type DeleteWorkspaceRequest,
  type SaveNotificationPrefsRequest,
  type UpdateWorkspaceSettingsRequest,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

const GENERAL = ['shell', 'workspace'] as const;
const NOTIFS = ['shell', 'workspace', 'notifications'] as const;
const PREFS = ['shell', 'preferences'] as const;
const EXPORT = ['shell', 'workspace', 'export'] as const;

export const useWorkspaceSettings = () =>
  useQuery({
    queryKey: GENERAL,
    queryFn: ({ signal }) =>
      apiFetch('/shell/workspace', { schema: workspaceSettingsResponseSchema, signal }),
  });

export function useSaveWorkspaceSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateWorkspaceSettingsRequest) =>
      apiFetch('/shell/workspace', {
        method: 'PATCH',
        body,
        schema: workspaceSettingsResponseSchema,
      }),
    onSuccess: (data) => qc.setQueryData(GENERAL, data),
  });
}

export const useNotificationPrefs = () =>
  useQuery({
    queryKey: NOTIFS,
    queryFn: ({ signal }) =>
      apiFetch('/shell/workspace/notifications', {
        schema: notificationPrefsResponseSchema,
        signal,
      }),
  });

export function useSaveNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveNotificationPrefsRequest) =>
      apiFetch('/shell/workspace/notifications', {
        method: 'PUT',
        body,
        schema: notificationPrefsResponseSchema,
      }),
    onSuccess: (data) => qc.setQueryData(NOTIFS, data),
  });
}

export const usePreferences = () =>
  useQuery({
    queryKey: PREFS,
    queryFn: ({ signal }) =>
      apiFetch('/shell/preferences', { schema: preferencesResponseSchema, signal }),
  });

export function useSavePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (autoAiSummarize: boolean) =>
      apiFetch('/shell/preferences', {
        method: 'PUT',
        body: { autoAiSummarize },
        schema: preferencesResponseSchema,
      }),
    onSuccess: (data) => qc.setQueryData(PREFS, data),
  });
}

export const useExportCounts = () =>
  useQuery({
    queryKey: EXPORT,
    queryFn: ({ signal }) =>
      apiFetch('/shell/workspace/export', { schema: exportCountsResponseSchema, signal }),
  });

export const useDeleteWorkspace = () =>
  useMutation({
    mutationFn: (body: DeleteWorkspaceRequest) =>
      apiFetch('/shell/workspace', { method: 'DELETE', body }),
  });
