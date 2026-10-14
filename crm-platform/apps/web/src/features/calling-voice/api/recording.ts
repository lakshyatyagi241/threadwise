'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  callRecordingGateSchema,
  callRecordingSettingsSchema,
  type RecordCallConsentInput,
  type SetRecordingHoldInput,
  type UpdateCallRecordingSettingsInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { callErrorKey } from '../lib/calls';
import { LOG_KEYS } from './call-logs';

const BASE = '/calling';

export const RECORDING_KEYS = { settings: ['call', 'recording', 'settings'] as const };

const refused = (e: unknown) =>
  callErrorKey(e) === 'FORBIDDEN' || callErrorKey(e) === 'PLAN_FEATURE_LOCKED';

/** The workspace's recording rules. Anyone who takes calls reads them (the panel needs the notice); a refusal just means "off". */
export function useRecordingSettings(enabled = true) {
  return useQuery({
    queryKey: RECORDING_KEYS.settings,
    enabled,
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/recording-settings`, { schema: callRecordingSettingsSchema, signal }),
    retry: (count, e) => !refused(e) && count < 2,
    staleTime: 30_000,
  });
}

export function useSaveRecordingSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCallRecordingSettingsInput) =>
      apiFetch(`${BASE}/recording-settings`, {
        method: 'PUT',
        body: input,
        schema: callRecordingSettingsSchema,
      }),
    onSuccess: (data) => qc.setQueryData(RECORDING_KEYS.settings, data),
  });
}

/** The operator records the person's answer; the reply is the gate's decision for this call. */
export const recordConsent = (callId: string, input: RecordCallConsentInput) =>
  apiFetch(`${BASE}/calls/${callId}/recording-consent`, {
    method: 'POST',
    body: input,
    schema: callRecordingGateSchema,
  });

export function useDeleteRecording(callId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch(`${BASE}/calls/${callId}/recording`, { method: 'DELETE' }),
    onSettled: () => void qc.invalidateQueries({ queryKey: LOG_KEYS.all }),
  });
}

export function useSetRecordingHold(callId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SetRecordingHoldInput) =>
      apiFetch(`${BASE}/call-logs/${callId}/recording-hold`, { method: 'PUT', body: input }),
    onSettled: () => void qc.invalidateQueries({ queryKey: LOG_KEYS.all }),
  });
}
