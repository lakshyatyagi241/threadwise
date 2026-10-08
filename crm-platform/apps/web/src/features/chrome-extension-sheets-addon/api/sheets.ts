'use client';

import { useQuery } from '@tanstack/react-query';
import {
  extSheetsKeyIssuedSchema,
  extSheetsKeyStatusSchema,
  extSheetsOverviewSchema,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { ApiError, toApiError } from '@/lib/api/errors';

export const KEYS = { overview: ['ext-sheets', 'overview'] as const };

/**
 * Every call of the setup page. Generate and revoke are plain calls, not react-query mutations: a mutation keeps its result in the
 * cache, and the generate answer carries the secret, which must live only in the screen's own state.
 */
export const sheetsApi = {
  overview: (signal?: AbortSignal) =>
    apiFetch('/extension/sheets/overview', { schema: extSheetsOverviewSchema, signal }),
  keyStatus: (signal?: AbortSignal) =>
    apiFetch('/extension/sheets/key', { schema: extSheetsKeyStatusSchema, signal }),
  generate: () =>
    apiFetch('/extension/sheets/key', { method: 'POST', schema: extSheetsKeyIssuedSchema }),
  revoke: () =>
    apiFetch('/extension/sheets/key', { method: 'DELETE', schema: extSheetsKeyStatusSchema }),
};

export const SHEETS_RETRY_DELAY_MS = 400;
/** A transient failure (5xx, network) is retried once, quickly; a 4xx is final. */
export const sheetsRetry = (failures: number, error: unknown) =>
  !(error instanceof ApiError && error.status < 500) && failures < 1;

export function useOverview(enabled: boolean) {
  return useQuery({
    queryKey: KEYS.overview,
    queryFn: ({ signal }) => sheetsApi.overview(signal),
    enabled,
    refetchOnWindowFocus: true,
    retry: sheetsRetry,
    retryDelay: SHEETS_RETRY_DELAY_MS,
  });
}

/** Fetches one add-on file through the same-origin proxy (the answer is text, not JSON). */
export async function downloadAddonFile(
  name: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`/api/v2/extension/sheets/files/${encodeURIComponent(name)}`, {
    headers: { Accept: '*/*', 'X-Request-Id': crypto.randomUUID() },
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    throw toApiError(res.status, json, res.headers.get('x-request-id'));
  }
  const match = /filename="?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '');
  return { blob: await res.blob(), filename: match?.[1] ?? name };
}
