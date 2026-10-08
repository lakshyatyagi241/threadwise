'use client';

import { useQuery, type QueryClient } from '@tanstack/react-query';
import {
  createApiKeyResponseSchema,
  listApiKeysResponseSchema,
  type CreateApiKeyInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { LIST_LIMIT } from '../lib/keys-model';

export const KEYS = { list: ['developer-api-keys'] as const };

/**
 * Every Developers-console call. Keys are named by uuid; the proxy adds the session token. Create and revoke are plain calls, not
 * react-query mutations: a mutation keeps its result in the cache, and the create answer carries the raw key, which must live only
 * in the screen's own state.
 */
export const keysApi = {
  list: (signal?: AbortSignal) =>
    apiFetch('/developer/keys', {
      query: { limit: LIST_LIMIT },
      schema: listApiKeysResponseSchema,
      signal,
    }),
  create: (input: CreateApiKeyInput) =>
    apiFetch('/developer/keys', {
      method: 'POST',
      body: input,
      schema: createApiKeyResponseSchema,
    }),
  revoke: (id: string) =>
    apiFetch(`/developer/keys/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export const KEYS_RETRY_DELAY_MS = 400;
export const keysRetry = (failures: number, error: unknown) =>
  !(error instanceof ApiError && error.status < 500) && failures < 1;

export function useKeys(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.list,
    queryFn: ({ signal }) => keysApi.list(signal),
    enabled,
    // The raw key is never in this data, and "last used" moves on its own: refresh on focus, not on a timer.
    refetchOnWindowFocus: true,
    // A transient failure (5xx, network) is retried once, quickly, so the error notice with Retry shows within about a second
    // instead of after the app default's backoff; a 4xx is final and is not retried.
    retry: keysRetry,
    retryDelay: KEYS_RETRY_DELAY_MS,
  });
}

export const refresh = (qc: QueryClient) => qc.invalidateQueries({ queryKey: KEYS.list });
