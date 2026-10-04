import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  exportCountsResponseSchema,
  notificationPrefsResponseSchema,
  preferencesResponseSchema,
  workspaceBrandingResponseSchema,
  workspaceSettingsResponseSchema,
  type DeleteWorkspaceRequest,
  type SaveNotificationPrefsRequest,
  type UpdateWorkspaceSettingsRequest,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';

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

const BRANDING = ['shell', 'workspace', 'branding'] as const;

export const useBranding = () =>
  useQuery({
    queryKey: BRANDING,
    queryFn: ({ signal }) =>
      apiFetch('/shell/workspace/branding', { schema: workspaceBrandingResponseSchema, signal }),
  });

/** `apiFetch` only speaks JSON, so the multipart save follows its conventions by hand (as the avatar upload does). */
export function useSaveBranding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      fields: Partial<Record<'primary' | 'accent' | 'background', string>>;
      files: { logo?: File; favicon?: File };
    }) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(input.fields)) form.append(k, v);
      if (input.files.logo) form.append('logo', input.files.logo);
      if (input.files.favicon) form.append('favicon', input.files.favicon);
      const res = await fetch('/api/v2/shell/workspace/branding', {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'X-Request-Id': crypto.randomUUID(),
          'Idempotency-Key': crypto.randomUUID(),
        },
      });
      const text = await res.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      if (!res.ok) {
        throw toApiError(
          res.status,
          json,
          res.headers.get('x-request-id'),
          res.headers.get('retry-after'),
        );
      }
      return workspaceBrandingResponseSchema.parse(json);
    },
    onSuccess: (data) => {
      qc.setQueryData(BRANDING, data);
      // The shell reads the brand from the server on each navigation; reload so the header and colours show at once.
      if (typeof window !== 'undefined') window.location.reload();
    },
  });
}
