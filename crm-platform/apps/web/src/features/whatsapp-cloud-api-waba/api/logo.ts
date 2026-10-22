import {
  wabaBusinessProfileSchema,
  WABA_LOGO_MAX_BYTES,
  WABA_LOGO_TYPES,
  type WabaBusinessProfile,
} from '@crm/contracts';
import { toApiError } from '@/lib/api/errors';
import { redirectOnIdle } from '@/lib/auth/idle-redirect';

/** Whether the browser-side check lets a picture through: the same JPG or PNG up to 5 MB the API takes. */
export function isLogoFile(file: File): boolean {
  return (
    (WABA_LOGO_TYPES as readonly string[]).includes(file.type) && file.size <= WABA_LOGO_MAX_BYTES
  );
}

/**
 * Sets the profile picture (`POST /v2/waba/numbers/:id/profile/logo`, multipart). `apiFetch` only speaks JSON, so this does the same
 * request by hand through the same-origin proxy, as the template header upload does.
 */
export async function uploadProfileLogo(
  id: string,
  file: File,
  signal?: AbortSignal,
): Promise<WabaBusinessProfile> {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(`/api/v2/waba/numbers/${id}/profile/logo`, {
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
  // A proxy's own error page (a 413, say) is not JSON: it gets the status text, not a parse error.
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const error = toApiError(res.status, json, res.headers.get('x-request-id'));
    // As apiFetch does: an idle-expired session goes to sign-in with the reason.
    redirectOnIdle(error);
    throw error;
  }
  return wabaBusinessProfileSchema.parse(json);
}
