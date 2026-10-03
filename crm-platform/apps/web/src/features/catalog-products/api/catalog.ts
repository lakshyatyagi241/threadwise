'use client';

import { useQuery } from '@tanstack/react-query';
import {
  catalogActivityResponseSchema,
  catalogOverviewSchema,
  catalogSendOptionsSchema,
  importFromMetaResponseSchema,
  pollBatchesResponseSchema,
  productPickerResponseSchema,
  sendCatalogResponseSchema,
  syncProductsResponseSchema,
  type CommerceSettingsInput,
  type ConnectCatalogInput,
  type SaveAutomationInput,
  type SendCatalogInput,
  type SyncProductsInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

export const KEYS = {
  all: ['cat'] as const,
  overview: ['cat', 'overview'] as const,
  sendOptions: ['cat', 'send-options'] as const,
  activity: ['cat', 'activity'] as const,
  collections: ['cat', 'collections'] as const,
  picker: ['cat', 'picker'] as const,
  products: ['cat', 'products'] as const,
  product: (id: string) => ['cat', 'product', id] as const,
  reviews: ['cat', 'reviews'] as const,
};

/** The Setup tab in one read, also used by the header pill and the Send and Collections tabs. */
export function useOverview() {
  return useQuery({
    queryKey: KEYS.overview,
    queryFn: ({ signal }) =>
      apiFetch('/catalog/overview', { schema: catalogOverviewSchema, signal }),
    retry: false,
  });
}

export function useSendOptions() {
  return useQuery({
    queryKey: KEYS.sendOptions,
    queryFn: ({ signal }) =>
      apiFetch('/catalog/send-options', { schema: catalogSendOptionsSchema, signal }),
    retry: false,
  });
}

/** The newest catalog sends (Reference shows 50). */
export const ACTIVITY_LIMIT = 50;
export function useActivity() {
  return useQuery({
    queryKey: KEYS.activity,
    queryFn: ({ signal }) =>
      apiFetch('/catalog/activity', {
        query: { limit: ACTIVITY_LIMIT },
        schema: catalogActivityResponseSchema,
        signal,
      }),
    retry: false,
  });
}

/** Active, in-stock products for the Send tab; the shop filters them and the box searches by name or SKU on the server. */
export function useProductPicker(params: { shopId: string; q: string; enabled: boolean }) {
  return useQuery({
    queryKey: [...KEYS.picker, params.shopId, params.q],
    enabled: params.enabled,
    queryFn: ({ signal }) =>
      apiFetch('/catalog/products/picker', {
        query: { shopId: params.shopId || undefined, q: params.q || undefined },
        schema: productPickerResponseSchema,
        signal,
      }),
    retry: false,
  });
}

export const connectCatalog = (body: ConnectCatalogInput) =>
  apiFetch('/catalog/connect', { method: 'POST', body });
export const autodetectCatalog = () =>
  apiFetch('/catalog/autodetect', { method: 'POST', body: {} });
export const disconnectCatalog = () =>
  apiFetch('/catalog/disconnect', { method: 'POST', body: {} });
export const saveCommerce = (body: CommerceSettingsInput) =>
  apiFetch('/catalog/commerce', { method: 'POST', body });
export const saveAutomation = (body: SaveAutomationInput) =>
  apiFetch('/catalog/automation', { method: 'POST', body });
export const syncProducts = (body: SyncProductsInput) =>
  apiFetch('/catalog/sync', { method: 'POST', body, schema: syncProductsResponseSchema });
export const pollBatches = () =>
  apiFetch('/catalog/poll', { method: 'POST', body: {}, schema: pollBatchesResponseSchema });
export const importFromMeta = () =>
  apiFetch('/catalog/import', { method: 'POST', body: {}, schema: importFromMetaResponseSchema });
export const sendCatalog = (body: SendCatalogInput) =>
  apiFetch('/catalog/send', { method: 'POST', body, schema: sendCatalogResponseSchema });
