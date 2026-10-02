import type { z } from 'zod';
import { apiFetch, type ApiRequest as BaseRequest } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';

/**
 * Like the shared request, but the schema may TRANSFORM what it parses (a contract that upper-cases a currency, say): the shared
 * type demands the same type on both sides. The cast below is the one place that difference is bridged.
 */
export type ApiRequest<T> = Omit<BaseRequest<T>, 'schema'> & {
  schema?: z.ZodType<T, z.ZodTypeDef, unknown>;
};

/** Every invoicing call goes through the same-origin proxy (`/api/v2/*`), which attaches the session token. */
export const call = <T = void>(path: string, req: ApiRequest<T> = {}): Promise<T> =>
  apiFetch(path, req as BaseRequest<T>);

/** The link is wrong (404) or the invoice was withdrawn (410). */
export class PublicInvoiceGone extends Error {
  constructor(readonly status: number) {
    super(`public invoice ${status}`);
  }
}

/**
 * The buyer's calls. The page has no session: the same-origin route `/api/public/invoices/<token>` relays to the API WITHOUT
 * the session cookie (a staff member opening the link must not act as staff), and the unguessable token is the only credential.
 */
export async function callPublic<T>(
  token: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  req: { method?: 'GET' | 'POST'; action?: 'pay'; body?: unknown } = {},
): Promise<T> {
  const method = req.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Request-Id': crypto.randomUUID() };
  if (req.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['Idempotency-Key'] = crypto.randomUUID();
  const res = await fetch(`/api/public/invoices/${encodeURIComponent(token)}${req.action ? `/${req.action}` : ''}`, {
    method,
    headers,
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
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
  if (res.status === 404 || res.status === 410) throw new PublicInvoiceGone(res.status);
  if (!res.ok) throw toApiError(res.status, json, res.headers.get('x-request-id'));
  return schema.parse(json);
}
