'use client';

import { useQuery } from '@tanstack/react-query';
import type { FlbBuilderContext, FlbCommerceProductsQuery } from '@crm/contracts';
import { flowsApi } from './flows';

export const EMPTY_CONTEXT: FlbBuilderContext = {
  channels: ['chat'],
  senders: {
    chat: [],
    instagram: [],
    facebook: [],
    tiktok: [],
    telegram: [],
    line: [],
    wechat: [],
    viber: [],
    email: [],
  },
  tags: [],
  groups: [],
  segments: [],
  keywordRules: [],
  teams: [],
  agents: [],
  stages: [],
  templates: [],
  flows: [],
  aiModels: [],
  assistants: [],
  callAssistants: [],
  bookingTypes: [],
  forms: [],
  stores: { whatsapp_shop: [], woocommerce: [], shopify: [] },
};

export const FLB_KEYS = {
  all: ['flb'] as const,
  list: ['flb', 'list'] as const,
  overview: ['flb', 'overview'] as const,
  context: ['flb', 'context'] as const,
  flow: (id: string) => ['flb', 'flow', id] as const,
  admin: ['flb', 'admin'] as const,
};

/**
 * The builder's reference data in one call (WaDesk fetched nine endpoints on mount and swallowed failures; a failure here
 * leaves the lists empty and the dropdowns on "Loading ..." the same way).
 */
export function useBuilderContext() {
  const q = useQuery({
    queryKey: FLB_KEYS.context,
    queryFn: ({ signal }) => flowsApi.builderContext(signal),
    staleTime: 0,
    gcTime: 60_000,
  });
  return { ctx: q.data ?? EMPTY_CONTEXT, loading: q.isPending, refresh: () => void q.refetch() };
}

/** Products a commerce node can offer, for the product picker modal. */
export function useCommerceProducts(query: FlbCommerceProductsQuery | null) {
  return useQuery({
    queryKey: ['flb', 'products', query],
    queryFn: ({ signal }) => flowsApi.commerceProducts(query!, signal),
    enabled: query !== null,
  });
}

/**
 * Files the connected Google account can offer (Sheets, Docs, Forms). Fails with `FLB_INTEGRATION_DISABLED` / a 503 while
 * the Google integration is not connected; forms then fall back to typing the id.
 */
export function useGoogleFiles(kind: 'sheets' | 'docs' | 'forms') {
  return useQuery({
    queryKey: ['flb', 'google', kind],
    queryFn: ({ signal }) => flowsApi.googleFiles(kind, signal),
    retry: false,
  });
}
