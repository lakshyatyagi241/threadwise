'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { SaveShopInput, UpdateStorefrontInput } from '@crm/contracts';
import { storeApi } from './service';

export const KEYS = {
  all: ['store'] as const,
  overview: (shopId: string | undefined) => ['store', 'overview', shopId ?? ''] as const,
  wizard: ['store', 'wizard'] as const,
};

/** The dashboard data. It also feeds the sidebar and the settings page (the shop, the switcher list, the product count). */
export function useOverview(shopId: string | undefined) {
  return useQuery({
    queryKey: KEYS.overview(shopId),
    queryFn: ({ signal }) => storeApi.overview(shopId, signal),
    retry: false,
    staleTime: 15_000,
  });
}

export function useWizard() {
  return useQuery({
    queryKey: KEYS.wizard,
    queryFn: ({ signal }) => storeApi.wizard(signal),
    retry: false,
  });
}

/** After any shop write: every cached store view (overview, switcher, wizard list) is stale. */
export function invalidateStore(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: KEYS.all });
}

export function useSaveShop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveShopInput) => storeApi.saveShop(input),
    onSuccess: () => invalidateStore(qc),
  });
}

export function useDeleteShop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shopId: string) => storeApi.deleteShop(shopId),
    onSuccess: () => invalidateStore(qc),
  });
}

export function useResetAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => storeApi.resetAll(),
    onSuccess: () => invalidateStore(qc),
  });
}

export function useUpdateSettings(shopId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateStorefrontInput) => storeApi.updateSettings(shopId, input),
    onSuccess: () => invalidateStore(qc),
  });
}

export function useVerifyDomain(shopId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => storeApi.verifyDomain(shopId),
    onSuccess: () => invalidateStore(qc),
  });
}
