'use client';

import { useQuery } from '@tanstack/react-query';
import {
  automationsViewSchema,
  broadcastResultSchema,
  shopifyConnectStartSchema,
  shopifyOverviewSchema,
  storeDashboardSchema,
  syncResultSchema,
  woocommerceOverviewSchema,
  woocommerceStoreSchema,
  woocommerceTestResultSchema,
  type ConnectWoocommerceInput,
  type SaveAutomationsInput,
  type SendOfferInput,
  type SendWinbackInput,
  type ShopifyStore,
  type WoocommerceStore,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import type { Kind } from '../lib/model';

export const KEYS = {
  all: ['ecom'] as const,
  overview: (kind: Kind) => ['ecom', kind, 'overview'] as const,
  dashboard: (kind: Kind, id: string) => ['ecom', kind, id, 'dashboard'] as const,
  automations: (kind: Kind, id: string) => ['ecom', kind, id, 'automations'] as const,
};

/** What both store pages need first: whether the app is on, the scopes it asks for (Shopify), and the workspace's store. */
export interface StoreOverview {
  appEnabled: boolean;
  scopes: string;
  eventTopics: string[];
  store: ShopifyStore | WoocommerceStore | null;
}

/** The store page's first read (never a credential). */
export const useOverview = (kind: Kind) =>
  useQuery<StoreOverview>({
    queryKey: KEYS.overview(kind),
    queryFn: async ({ signal }) => {
      if (kind === 'shopify')
        return apiFetch('/shopify', { schema: shopifyOverviewSchema, signal });
      const o = await apiFetch('/woocommerce', { schema: woocommerceOverviewSchema, signal });
      return { ...o, scopes: '' };
    },
  });

/** Everything the tabs show, in one read. A WooCommerce store answers live, so it is not refetched in the background. */
export const useDashboard = (kind: Kind, id: string) =>
  useQuery({
    queryKey: KEYS.dashboard(kind, id),
    queryFn: ({ signal }) =>
      apiFetch(`/${kind}/stores/${id}/dashboard`, { schema: storeDashboardSchema, signal }),
    refetchOnWindowFocus: false,
  });

export const useAutomations = (kind: Kind, id: string, enabled: boolean) =>
  useQuery({
    queryKey: KEYS.automations(kind, id),
    queryFn: ({ signal }) =>
      apiFetch(`/${kind}/stores/${id}/automations`, { schema: automationsViewSchema, signal }),
    enabled,
  });

export const startShopify = (shop: string) =>
  apiFetch('/shopify/connect/start', {
    method: 'POST',
    body: { shop },
    schema: shopifyConnectStartSchema,
  });

export const testWoo = (body: ConnectWoocommerceInput) =>
  apiFetch('/woocommerce/test', { method: 'POST', body, schema: woocommerceTestResultSchema });

export const connectWoo = (body: ConnectWoocommerceInput) =>
  apiFetch('/woocommerce/connect', { method: 'POST', body, schema: woocommerceStoreSchema });

export const syncStore = (kind: Kind, id: string) =>
  apiFetch(`/${kind}/stores/${id}/sync`, { method: 'POST', schema: syncResultSchema });

export const disconnectStore = (kind: Kind, id: string) =>
  apiFetch(`/${kind}/stores/${id}`, { method: 'DELETE' });

export const saveAutomations = (kind: Kind, id: string, body: SaveAutomationsInput) =>
  apiFetch(`/${kind}/stores/${id}/automations`, {
    method: 'PUT',
    body,
    schema: automationsViewSchema,
  });

export const sendOffer = (kind: Kind, id: string, body: SendOfferInput) =>
  apiFetch(`/${kind}/stores/${id}/offer`, { method: 'POST', body, schema: broadcastResultSchema });

export const sendWinback = (kind: Kind, id: string, body: SendWinbackInput) =>
  apiFetch(`/${kind}/stores/${id}/winback`, {
    method: 'POST',
    body,
    schema: broadcastResultSchema,
  });
