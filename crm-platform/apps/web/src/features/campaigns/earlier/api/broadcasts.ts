'use client';

import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';

/** The key of every earlier-broadcast read (the composer's audience lists share it). */
export const KEYS = {
  all: ['bcast'] as const,
};

export async function deleteBroadcast(id: string): Promise<void> {
  await apiFetch(`/broadcasts/${id}`, { method: 'DELETE' });
}

/** The recipients as a CSV, for a download; the server names the file. */
export async function exportBroadcast(id: string): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`/api/v2/broadcasts/${id}/export`, {
    headers: { Accept: 'text/csv, application/json', 'X-Request-Id': crypto.randomUUID() },
    credentials: 'same-origin',
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
  const named = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '')?.[1];
  return { blob: await res.blob(), filename: named ?? `broadcast-${id}.csv` };
}
