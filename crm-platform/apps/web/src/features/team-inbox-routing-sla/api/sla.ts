'use client';

import { useQuery } from '@tanstack/react-query';
import {
  inboxSlaPolicyListSchema,
  inboxSlaPolicySchema,
  type CreateInboxSlaPolicyInput,
  type UpdateInboxSlaPolicyInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { transientRetry, transientRetryDelay } from '@/lib/api/retry';

export const SLA_KEYS = { policies: ['sla-policies'] as const };

/** Every call of the Response targets screen. Policies are named by uuid. */
export const slaApi = {
  list: (signal?: AbortSignal) =>
    apiFetch('/inbox/sla/policies', { schema: inboxSlaPolicyListSchema, signal }),
  create: (input: CreateInboxSlaPolicyInput) =>
    apiFetch('/inbox/sla/policies', {
      method: 'POST',
      body: input,
      schema: inboxSlaPolicySchema,
    }),
  update: (id: string, input: UpdateInboxSlaPolicyInput) =>
    apiFetch(`/inbox/sla/policies/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
      schema: inboxSlaPolicySchema,
    }),
  remove: (id: string) =>
    apiFetch(`/inbox/sla/policies/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export function useSlaPolicies() {
  return useQuery({
    queryKey: SLA_KEYS.policies,
    queryFn: ({ signal }) => slaApi.list(signal),
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
}
