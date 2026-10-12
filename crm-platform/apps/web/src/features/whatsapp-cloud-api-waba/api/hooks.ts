'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateSenderLists } from '@/lib/sender-lists';
import { wabaApi } from './service';

export const KEYS = {
  all: ['waba'] as const,
  readiness: ['waba', 'readiness'] as const,
  list: ['waba', 'numbers'] as const,
  health: (id: string) => ['waba', 'health', id] as const,
  profile: (id: string) => ['waba', 'profile', id] as const,
  username: (id: string) => ['waba', 'username', id] as const,
  qr: (id: string) => ['waba', 'qr', id] as const,
};

export function useReadiness() {
  return useQuery({
    queryKey: KEYS.readiness,
    queryFn: ({ signal }) => wabaApi.readiness(signal),
    staleTime: 60_000,
    retry: false,
  });
}

export function useNumbers() {
  return useQuery({
    queryKey: KEYS.list,
    queryFn: ({ signal }) => wabaApi.list(signal),
    retry: false,
  });
}

/** Every page load re-reads Meta (TW-WABA-021), so the result is never reused from cache. */
export function useHealth(id: string) {
  return useQuery({
    queryKey: KEYS.health(id),
    queryFn: ({ signal }) => wabaApi.health(id, signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/** Runs a mutation, then refreshes the list (and the open health page) so cards never show stale state. */
function useAction<TVars, TOut>(fn: (vars: TVars) => Promise<TOut>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      // The campaign screens' "Send from" lists follow the numbers.
      void invalidateSenderLists(qc);
      return qc.invalidateQueries({ queryKey: KEYS.all });
    },
  });
}

export const useConnectEmbedded = () =>
  useAction((v: Parameters<typeof wabaApi.connectEmbedded>[0]) => wabaApi.connectEmbedded(v));
export const useConnectManual = () =>
  useAction((v: Parameters<typeof wabaApi.connectManual>[0]) => wabaApi.connectManual(v));
export const useSetPrimary = () => useAction((id: string) => wabaApi.setPrimary(id));
export const useResubscribe = () => useAction((id: string) => wabaApi.resubscribe(id));
export const useRegister = () =>
  useAction((v: { id: string; pin?: string }) => wabaApi.register(v.id, v.pin));
export const useRequestCode = () =>
  useAction((v: { id: string; method: 'SMS' | 'VOICE' }) => wabaApi.requestCode(v.id, v.method));
export const useVerifyCode = () =>
  useAction((v: { id: string; code: string }) => wabaApi.verifyCode(v.id, v.code));
export const useDisconnect = () => useAction((id: string) => wabaApi.disconnect(id));
export const useRemove = () => useAction((id: string) => wabaApi.remove(id));
export const useSetToken = () =>
  useAction((v: { id: string; accessToken: string }) => wabaApi.setToken(v.id, v.accessToken));
export const useRenewToken = () => useAction((id: string) => wabaApi.renewToken(id));

/** The pre-save check changes nothing, so it does not refresh the list. */
export const useVerifyToken = () => useMutation({ mutationFn: wabaApi.verifyToken });

export function useProfile(id: string) {
  return useQuery({
    queryKey: KEYS.profile(id),
    queryFn: ({ signal }) => wabaApi.profile(id, signal),
    retry: false,
  });
}

export function useUpdateProfile(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Parameters<typeof wabaApi.updateProfile>[1]) =>
      wabaApi.updateProfile(id, patch),
    onSuccess: (data) => qc.setQueryData(KEYS.profile(id), data),
  });
}

export function useUsername(id: string) {
  return useQuery({
    queryKey: KEYS.username(id),
    queryFn: ({ signal }) => wabaApi.username(id, signal),
    retry: false,
  });
}

export function useClaimUsername(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (username: string) => wabaApi.claimUsername(id, username),
    onSuccess: (data) => qc.setQueryData(KEYS.username(id), data),
  });
}

export function useReleaseUsername(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => wabaApi.releaseUsername(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.username(id) }),
  });
}

export function useQrCodes(id: string) {
  return useQuery({
    queryKey: KEYS.qr(id),
    queryFn: ({ signal }) => wabaApi.qrCodes(id, signal),
    retry: false,
  });
}

export function useCreateQrCode(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefilledMessage: string) => wabaApi.createQrCode(id, prefilledMessage),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.qr(id) }),
  });
}

export function useDeleteQrCode(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => wabaApi.deleteQrCode(id, code),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.qr(id) }),
  });
}

export const useSyncHistory = () => useAction((id: string) => wabaApi.syncHistory(id));

/** A live read of Meta: never cached, and it changes nothing here. */
export const useInboundCheck = () =>
  useMutation({ mutationFn: (id: string) => wabaApi.inboundCheck(id) });

export function useWebhookConfig(enabled: boolean) {
  return useQuery({
    queryKey: ['waba', 'webhook-config'] as const,
    queryFn: ({ signal }) => wabaApi.webhookConfig(signal),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}
