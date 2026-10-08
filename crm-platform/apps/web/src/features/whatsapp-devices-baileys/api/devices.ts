'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  deleteDeviceResultSchema,
  devicePairingSchema,
  disconnectResultSchema,
  listDevicesResponseSchema,
  personalDeviceDetailSchema,
  personalDeviceSchema,
  riskNoticeStatusSchema,
  type AcknowledgementInput,
  type CreateDeviceInput,
  type StartPairingInput,
  type UpdateDeviceInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

export const KEYS = {
  all: ['wadev'] as const,
  list: ['wadev', 'list'] as const,
  detail: (id: string) => ['wadev', 'detail', id] as const,
  notice: ['wadev', 'notice'] as const,
  /** Never persisted: the pairing answer carries the QR string and the pairing code. */
  pairing: (id: string) => ['wadev', 'pairing', id] as const,
};

/** The list is small (the pilot cap is a handful of numbers) and the screen needs the whole of it for the tabs and the meter. */
const LIST_LIMIT = 100;
/** The list refreshes by itself while the page is open (phase 1: no realtime push, spec 19). */
export const LIST_REFRESH_MS = 10_000;

/** Every personal-number call. Devices are named by uuid; the proxy adds the session token. */
export const deviceApi = {
  list: (signal?: AbortSignal) =>
    apiFetch('/devices', {
      query: { limit: LIST_LIMIT },
      schema: listDevicesResponseSchema,
      signal,
    }),
  detail: (id: string, signal?: AbortSignal) =>
    apiFetch(`/devices/${id}`, { schema: personalDeviceDetailSchema, signal }),
  notice: (signal?: AbortSignal) =>
    apiFetch('/devices/risk-notice', { schema: riskNoticeStatusSchema, signal }),
  acknowledge: (input: AcknowledgementInput) =>
    apiFetch('/devices/risk-notice', {
      method: 'POST',
      body: input,
      schema: riskNoticeStatusSchema,
    }),
  create: (input: CreateDeviceInput, idempotencyKey?: string) =>
    apiFetch('/devices', {
      method: 'POST',
      body: input,
      schema: personalDeviceSchema,
      idempotencyKey,
    }),
  update: (id: string, input: UpdateDeviceInput) =>
    apiFetch(`/devices/${id}`, { method: 'PATCH', body: input, schema: personalDeviceSchema }),
  startPairing: (id: string, method: 'qr' | 'code', input: StartPairingInput) =>
    apiFetch(`/devices/${id}/pairing/${method}`, {
      method: 'POST',
      body: input,
      schema: devicePairingSchema,
    }),
  /** The 2 second read. Not cached, not idempotent: the answer carries a secret for a few seconds. */
  pairing: (id: string, signal?: AbortSignal) =>
    apiFetch(`/devices/${id}/pairing`, { schema: devicePairingSchema, signal }),
  endPairing: (id: string) => apiFetch(`/devices/${id}/pairing`, { method: 'DELETE' }),
  disconnect: (id: string) =>
    apiFetch(`/devices/${id}/disconnect`, { method: 'POST', schema: disconnectResultSchema }),
  remove: (id: string) =>
    apiFetch(`/devices/${id}`, { method: 'DELETE', schema: deleteDeviceResultSchema }),
};

export function refresh(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: KEYS.all });
}

/** The numbers of the workspace, with the meter (`meta`). Refreshes every 10 s while visible; a hidden tab does not poll. */
export function useDevices() {
  return useQuery({
    queryKey: KEYS.list,
    queryFn: ({ signal }) => deviceApi.list(signal),
    refetchInterval: LIST_REFRESH_MS,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useDevice(id: string) {
  return useQuery({
    queryKey: KEYS.detail(id),
    queryFn: ({ signal }) => deviceApi.detail(id, signal),
    refetchInterval: LIST_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

export function useRiskNotice(enabled = true) {
  return useQuery({
    queryKey: KEYS.notice,
    queryFn: ({ signal }) => deviceApi.notice(signal),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function useAcknowledgeRisk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AcknowledgementInput) => deviceApi.acknowledge(input),
    onSuccess: () => refresh(qc),
  });
}

export function useCreateDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDeviceInput) => deviceApi.create(input),
    onSuccess: () => refresh(qc),
  });
}

export function useUpdateDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; input: UpdateDeviceInput }) => deviceApi.update(v.id, v.input),
    onSuccess: () => refresh(qc),
  });
}

export function useStartPairing(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { method: 'qr' | 'code'; input: StartPairingInput }) =>
      deviceApi.startPairing(id, v.method, v.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.list }),
  });
}

export function useEndPairing() {
  return useMutation({ mutationFn: (id: string) => deviceApi.endPairing(id) });
}

export function useDisconnectDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deviceApi.disconnect(id),
    onSuccess: () => refresh(qc),
  });
}

export function useDeleteDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deviceApi.remove(id),
    onSuccess: () => refresh(qc),
  });
}
