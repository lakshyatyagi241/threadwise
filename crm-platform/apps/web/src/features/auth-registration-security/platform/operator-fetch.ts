import type { z } from 'zod';
import { ERROR_CODES } from '@crm/contracts';
import { ApiError, toApiError } from '@/lib/api/errors';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const MUTATING: ReadonlySet<Method> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const OPERATOR_LOGIN_PATH = '/admin/login';
export const OPERATOR_ENROLMENT_PATH = '/admin/account/security';

export interface OperatorRequest<T> {
  method?: Method;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Parsed at the boundary: the server can be older than this build. Omit for 204 responses. */
  schema?: z.ZodType<T, z.ZodTypeDef, unknown>;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

function qs(query: OperatorRequest<unknown>['query']): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * Where the console must send the person when the API refuses a call for an
 * authentication reason, or null when the error is an ordinary one. The proxy
 * has already tried one refresh by the time a 401 reaches here.
 */
export function operatorAuthRedirect(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === ERROR_CODES.AUTH_MFA_ENROLMENT_REQUIRED) return OPERATOR_ENROLMENT_PATH;
  if (error.status === 401 && error.code === ERROR_CODES.UNAUTHENTICATED) {
    return `${OPERATOR_LOGIN_PATH}?expired=1`;
  }
  return null;
}

/**
 * Calls the platform API through the same-origin operator proxy (`/api/platform/*`
 * becomes `/v2/platform/*`), which attaches the operator session token. The
 * browser never sees a token.
 */
export async function operatorFetch<T = void>(
  path: string,
  req: OperatorRequest<T> = {},
): Promise<T> {
  const method = req.method ?? 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Request-Id': crypto.randomUUID(),
  };
  if (req.body !== undefined) headers['Content-Type'] = 'application/json';
  if (MUTATING.has(method)) headers['Idempotency-Key'] = req.idempotencyKey ?? crypto.randomUUID();

  const res = await fetch(`/api/platform${path}${qs(req.query)}`, {
    method,
    headers,
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
    signal: req.signal,
    credentials: 'same-origin',
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const error = toApiError(res.status, json, res.headers.get('x-request-id'));
    const to = operatorAuthRedirect(error);
    if (to && typeof window !== 'undefined' && window.location.pathname !== to.split('?')[0]) {
      window.location.assign(to);
    }
    throw error;
  }
  return (req.schema ? req.schema.parse(json) : (undefined as T)) as T;
}
