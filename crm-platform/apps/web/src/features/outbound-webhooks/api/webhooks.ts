'use client';

import { useQuery, type QueryClient } from '@tanstack/react-query';
import {
  listWebhookDeliveriesResponseSchema,
  listWebhooksResponseSchema,
  testWebhookResponseSchema,
  webhookResponseSchema,
  type CreateWebhookInput,
  type UpdateWebhookInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

export const KEYS = {
  list: ['outbound-webhooks'] as const,
  deliveries: (id: string) => ['outbound-webhooks', 'deliveries', id] as const,
};

/** Every call of the Webhooks screen. Endpoints are named by uuid; the secret is only ever sent, never read back. */
export const webhooksApi = {
  list: (signal?: AbortSignal) =>
    apiFetch('/webhooks', { schema: listWebhooksResponseSchema, signal }),
  create: (input: CreateWebhookInput) =>
    apiFetch('/webhooks', { method: 'POST', body: input, schema: webhookResponseSchema }),
  update: (id: string, input: UpdateWebhookInput) =>
    apiFetch(`/webhooks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
      schema: webhookResponseSchema,
    }),
  remove: (id: string) => apiFetch(`/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  test: (id: string) =>
    apiFetch(`/webhooks/${encodeURIComponent(id)}/test`, {
      method: 'POST',
      schema: testWebhookResponseSchema,
    }),
  deliveries: (id: string, signal?: AbortSignal) =>
    apiFetch(`/webhooks/${encodeURIComponent(id)}/deliveries`, {
      query: { limit: 30 },
      schema: listWebhookDeliveriesResponseSchema,
      signal,
    }),
};

export const refresh = (qc: QueryClient) => qc.invalidateQueries({ queryKey: KEYS.list });

export function useWebhooks(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.list,
    enabled,
    retry: false,
    queryFn: ({ signal }) => webhooksApi.list(signal),
  });
}

export function useDeliveries(id: string | null) {
  return useQuery({
    queryKey: KEYS.deliveries(id ?? ''),
    enabled: id !== null,
    retry: false,
    queryFn: ({ signal }) => webhooksApi.deliveries(id!, signal),
  });
}
