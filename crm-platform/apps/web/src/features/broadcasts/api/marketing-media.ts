import { marketingMediaSchema, type MarketingMedia } from '@crm/contracts';
import { toApiError } from '@/lib/api/errors';

/** Uploads one file for a message sent to many people and returns the address the provider will fetch. */
export async function uploadMarketingMedia(
  file: File,
  signal?: AbortSignal,
): Promise<MarketingMedia> {
  const form = new FormData();
  form.set('file', file);
  const res = await fetch('/api/v2/media/marketing', {
    method: 'POST',
    body: form,
    headers: { Accept: 'application/json', 'X-Request-Id': crypto.randomUUID() },
    credentials: 'same-origin',
    signal,
  });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw toApiError(res.status, json, res.headers.get('x-request-id'));
  return marketingMediaSchema.parse(json);
}
