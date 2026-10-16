'use client';

import { useQuery } from '@tanstack/react-query';
import type { FlbBuilderContext, FlbCommerceProductsQuery } from '@crm/contracts';
import { faqForFlowApi } from './faq';
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
 * The builder's reference data in one call (Reference fetched nine endpoints on mount and swallowed failures; a failure here
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

/**
 * Whether the workspace's Google account is usable, and which permissions it covers (no account details): the Google steps warn from
 * it. Fails quietly for a role that cannot read it, so the steps show no notice rather than an error.
 */
export function useGoogleSummary() {
  return useQuery({
    queryKey: ['flb', 'google', 'status'],
    queryFn: ({ signal }) => flowsApi.googleStatus(signal),
    retry: false,
    staleTime: 30_000,
  });
}

/**
 * The FAQ categories of THIS flow and how many FAQs it has, for the "Answer from FAQ" node: the node answers from the FAQs of the
 * flow it sits in. Read through the flow's FAQ list (`limit=1`) whose `stats` carry both. Needs `faq.entries.read`: without it the
 * query fails and the form keeps what the node already holds. A flow that has not been saved yet (`null`) has no FAQs and nothing
 * to ask: the query stays off and `isPending` is false.
 */
export function useFaqSummary(flowId: string | null) {
  const q = useQuery({
    queryKey: ['flb', 'faq-summary', flowId],
    enabled: flowId !== null,
    queryFn: ({ signal }) => faqForFlowApi.summary(flowId!, signal),
    retry: false,
    staleTime: 30_000,
    select: (r) => ({ categories: r.stats.categories, total: r.stats.total }),
  });
  // A disabled query reports `isPending`; an unsaved flow is not loading anything.
  return flowId === null ? { ...q, isPending: false } : q;
}
