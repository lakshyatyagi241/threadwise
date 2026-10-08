'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  callEligibilitySchema,
  iceServersResponseSchema,
  callingNumberListSchema,
  dialProgressSchema,
  dialResultSchema,
  pendingCallListSchema,
  recordingResultSchema,
  requestPermissionResultSchema,
  toggleCallingResultSchema,
  type RequestPermissionInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';
import { callErrorKey } from '../lib/calls';
import type { CallApi } from '../lib/webrtc-peer';

const BASE = '/calling';

export const KEYS = {
  numbers: ['call', 'numbers'] as const,
  eligibility: (conversationId: string) => ['call', 'eligibility', conversationId] as const,
  pending: ['call', 'pending'] as const,
};

/** How often the incoming-call poll runs while the tab is visible (WD-CALL-012). */
export const PENDING_POLL_MS = 4000;
/** While the realtime socket is connected a push says when a call changed, so the poll only has to catch a missed one. */
export const PENDING_POLL_PUSHED_MS = 30_000;

// --- the peer's view of the API ------------------------------------------------------------------------------------------

/** Multipart upload through the same-origin proxy: the browser sets the boundary, the proxy adds the token. */
async function uploadRecording(callId: string, blob: Blob, filename: string) {
  const body = new FormData();
  body.append('recording', blob, filename);
  const res = await fetch(`/api/v2${BASE}/calls/${callId}/recording`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'X-Request-Id': crypto.randomUUID(),
      'Idempotency-Key': crypto.randomUUID(),
    },
    body,
    credentials: 'same-origin',
  });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw toApiError(res.status, json, res.headers.get('x-request-id'));
  return recordingResultSchema.parse(json);
}

export const callApi: CallApi = {
  dial: (input) =>
    apiFetch(`${BASE}/calls/dial`, { method: 'POST', body: input, schema: dialResultSchema }),
  progress: (callId) =>
    apiFetch(`${BASE}/calls/${callId}/progress`, { schema: dialProgressSchema }),
  accept: (callId, sdpAnswer) =>
    apiFetch(`${BASE}/calls/${callId}/accept`, { method: 'POST', body: { sdpAnswer } }),
  reject: (callId, reason) =>
    apiFetch(`${BASE}/calls/${callId}/reject`, { method: 'POST', body: { reason } }),
  terminate: (callId) => apiFetch(`${BASE}/calls/${callId}/terminate`, { method: 'POST' }),
  uploadRecording,
};

export const requestPermission = (input: RequestPermissionInput) =>
  apiFetch(`${BASE}/permission-request`, {
    method: 'POST',
    body: input,
    schema: requestPermissionResultSchema,
  });

// --- screens -------------------------------------------------------------------------------------------------------------

/** The operator's ICE list (TURN included). Cached for the session: it changes with a deploy, not with a call. */
export function useIceServers(enabled: boolean) {
  return useQuery({
    queryKey: ['call', 'ice-servers'] as const,
    enabled,
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/ice-servers`, { schema: iceServersResponseSchema, signal }),
    retry: false,
    staleTime: 3_600_000,
  });
}

export function useCallingNumbers() {
  return useQuery({
    queryKey: KEYS.numbers,
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/numbers`, { schema: callingNumberListSchema, signal }),
  });
}

/** Meta is asked, so this can take a few seconds; the local flags change only after Meta accepts. */
export function useToggleCalling() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enable }: { id: string; enable: boolean }) =>
      apiFetch(`${BASE}/numbers/${id}/toggle`, {
        method: 'POST',
        body: { enable },
        schema: toggleCallingResultSchema,
      }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['call'] }),
  });
}

/** Whether the Call button shows for a conversation. A refusal (no permission, plan without calling) just hides the button. */
export function useCallEligibility(conversationId: string, enabled = true) {
  return useQuery({
    queryKey: KEYS.eligibility(conversationId),
    enabled,
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/eligibility`, {
        query: { conversationId },
        schema: callEligibilitySchema,
        signal,
      }),
    retry: false,
  });
}

/** A refusal that polling again cannot change: no permission, or a plan without calling. */
const refused = (e: unknown) =>
  callErrorKey(e) === 'FORBIDDEN' || callErrorKey(e) === 'PLAN_FEATURE_LOCKED';

/**
 * Ringing inbound calls (WD-CALL-012). react-query does not run the 4 s timer in a background tab and refetches when the tab
 * comes back; a transient failure is retried on the next tick, a refusal stops the poll.
 */
export function usePendingCalls(enabled: boolean, pushed = false) {
  return useQuery({
    queryKey: KEYS.pending,
    enabled,
    queryFn: ({ signal }) =>
      apiFetch(`${BASE}/calls/pending`, { schema: pendingCallListSchema, signal }),
    retry: false,
    refetchInterval: (q) =>
      refused(q.state.error) ? false : pushed ? PENDING_POLL_PUSHED_MS : PENDING_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}
