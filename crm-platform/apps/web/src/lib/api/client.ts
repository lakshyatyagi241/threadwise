import type { z } from 'zod';
import { redirectOnIdle } from '@/lib/auth/idle-redirect';
import { toApiError } from './errors';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const MUTATING: ReadonlySet<Method> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface ApiRequest<T> {
  method?: Method;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Parsed at the boundary: the server can be older than this build. Omit for 204 responses. */
  schema?: z.ZodType<T, z.ZodTypeDef, unknown>;
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

/** How long a browser call to the API may take before it is given up. */
export const API_CALL_TIMEOUT_MS = 60_000;

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
    // A caller's own signal wins; otherwise a stalled API cannot leave the screen waiting for ever (the proxy answers 504 after 30 s).
    signal: req.signal ?? AbortSignal.timeout(API_CALL_TIMEOUT_MS),
    credentials: 'same-origin',
  });
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const error = toApiError(
      res.status,
      json,
      res.headers.get('x-request-id'),
      res.headers.get('retry-after'),
    );
    // The session ended for inactivity while the page was open: go to sign-in with the reason, as a page load does.
    redirectOnIdle(error);
    throw error;
  }
  return (req.schema ? req.schema.parse(json) : (undefined as T)) as T;
}
