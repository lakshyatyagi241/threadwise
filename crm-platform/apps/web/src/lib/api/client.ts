import type { z } from 'zod';
import { toApiError } from './errors';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const MUTATING: ReadonlySet<Method> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface ApiRequest<T> {
  method?: Method;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Parsed at the boundary: the server can be older than this build. Omit for 204 responses. */
  schema?: z.ZodType<T>;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

function qs(query: ApiRequest<unknown>['query']): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Calls the API through the same-origin proxy (`/api/v2/*`), which attaches the session token. */
export async function apiFetch<T = void>(path: string, req: ApiRequest<T> = {}): Promise<T> {
  const method = req.method ?? 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Request-Id': crypto.randomUUID(),
  };
  if (req.body !== undefined) headers['Content-Type'] = 'application/json';
  if (MUTATING.has(method)) headers['Idempotency-Key'] = req.idempotencyKey ?? crypto.randomUUID();

  const res = await fetch(`/api/v2${path}${qs(req.query)}`, {
    method,
    headers,
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
    signal: req.signal,
    credentials: 'same-origin',
  });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw toApiError(res.status, json, res.headers.get('x-request-id'));
  return (req.schema ? req.schema.parse(json) : (undefined as T)) as T;
}
