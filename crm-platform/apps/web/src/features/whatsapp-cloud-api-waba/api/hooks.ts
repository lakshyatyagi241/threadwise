'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { wabaApi } from './service';

export const KEYS = {
  all: ['waba'] as const,
  readiness: ['waba', 'readiness'] as const,
  list: ['waba', 'numbers'] as const,
  health: (id: string) => ['waba', 'health', id] as const,
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

/** Every page load re-reads Meta (WD-WABA-021), so the result is never reused from cache. */
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
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.all }),
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
export const useDisconnect = () => useAction((id: string) => wabaApi.disconnect(id));
export const useRemove = () => useAction((id: string) => wabaApi.remove(id));
export const useSetToken = () =>
  useAction((v: { id: string; accessToken: string }) => wabaApi.setToken(v.id, v.accessToken));
export const useRenewToken = () => useAction((id: string) => wabaApi.renewToken(id));

/** The pre-save check changes nothing, so it does not refresh the list. */
export const useVerifyToken = () => useMutation({ mutationFn: wabaApi.verifyToken });
