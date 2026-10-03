import { uploadTemplateMediaResultSchema, type UploadTemplateMediaResult } from '@crm/contracts';
import { toApiError } from '@/lib/api/errors';

/**
 * Uploads a header sample (`POST /v2/templates/media`, multipart). `apiFetch` only speaks JSON, so this does the same
 * request by hand through the same-origin proxy: the browser sets the multipart boundary, the proxy adds the token.
 */
export async function uploadTemplateMedia(
  file: File,
  signal?: AbortSignal,
): Promise<UploadTemplateMediaResult> {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch('/api/v2/templates/media', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'X-Request-Id': crypto.randomUUID(),
      'Idempotency-Key': crypto.randomUUID(),
    },
    body,
    signal,
    credentials: 'same-origin',
  });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw toApiError(res.status, json, res.headers.get('x-request-id'));
  return uploadTemplateMediaResultSchema.parse(json);
}
