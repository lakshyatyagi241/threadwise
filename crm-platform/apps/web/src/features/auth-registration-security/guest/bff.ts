'use client';

import { ApiError, toApiError } from '@/lib/api/errors';
import { redirectOnIdle } from '@/lib/auth/idle-redirect';
import { apiFetch, type ApiRequest } from '@/lib/api/client';
import { networkError } from './errors';

/**
 * Calls a session-issuing BFF route (`/api/auth/*`, same origin). The response body never
 * carries tokens: they are put into httpOnly cookies by the server.
 */
export async function postBff<T>(
  action: string,
  body: Record<string, unknown>,
  schema: { parse(json: unknown): T },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/auth/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Request-Id': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw networkError();
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const error = toApiError(
      res.status,
      json,
      res.headers.get('x-request-id'),
      res.headers.get('retry-after'),
    );
    // A workspace switch is an authenticated call: it can find the session ended for inactivity.
    redirectOnIdle(error);
    throw error;
  }
  return schema.parse(json);
}

/** `apiFetch` that reports a dropped connection as an ApiError the error mapper understands. */
export async function callApi<T = void>(path: string, req: ApiRequest<T> = {}): Promise<T> {
  try {
    return await apiFetch<T>(path, req);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof TypeError) throw networkError();
    // A proxy or crash page instead of JSON: unexpected, not a connection problem.
    if (e instanceof SyntaxError) throw new ApiError(502, 'INTERNAL', 'Unreadable response');
    throw e;
  }
}
