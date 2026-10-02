import type { z } from 'zod';
import { apiFetch, type ApiRequest as BaseRequest } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';

/**
 * Like the shared request, but the schema may TRANSFORM what it parses (wire shape in, view model out): the shared type
 * demands the same type on both sides. The cast below is the one place that difference is bridged.
 */
export type ApiRequest<T> = Omit<BaseRequest<T>, 'schema'> & {
  schema?: z.ZodType<T, z.ZodTypeDef, unknown>;
};

/** Every sales-docs call goes through the same-origin proxy (`/api/v2/*`), which attaches the session token. */
export const call = <T = void>(path: string, req: ApiRequest<T> = {}): Promise<T> =>
  apiFetch(path, req as BaseRequest<T>);

/**
 * The buyer's calls. They carry no session: the same-origin route `/api/public/*` relays them to the API without a token, and
 * the link's token is the only credential. Mutations still send an Idempotency-Key so a retried tap decides once.
 */
export async function callPublic<T>(path: string, req: ApiRequest<T> = {}): Promise<T> {
  const method = req.method ?? 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Request-Id': crypto.randomUUID(),
  };
  if (req.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['Idempotency-Key'] = req.idempotencyKey ?? crypto.randomUUID();
  const res = await fetch(`/api/public${path}`, {
    method,
    headers,
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
    signal: req.signal,
    cache: 'no-store',
    credentials: 'omit',
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) throw toApiError(res.status, json, res.headers.get('x-request-id'));
  return (req.schema ? req.schema.parse(json) : (undefined as T)) as T;
}
