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

/**
 * Normally every call goes to the real API. While the appointments endpoints are not deployed on a server, a developer can
 * switch the in-memory stand-in on (`NEXT_PUBLIC_APPOINTMENTS_MOCK=1`, or `localStorage['appointments:mock'] = '1'` then
 * reload) to work on the screens; it answers with the same shapes, parsed by the same schemas. It is never on in a build for
 * production: the switch is read only when `NODE_ENV` is `development` or the env flag was set at build time.
 */
export function mockEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_APPOINTMENTS_MOCK === '1') return true;
  if (process.env.NODE_ENV === 'production') return false;
  try {
    return (
      typeof window !== 'undefined' && window.localStorage.getItem('appointments:mock') === '1'
    );
  } catch {
    return false;
  }
}

export function setMock(on: boolean): void {
  try {
    if (on) window.localStorage.setItem('appointments:mock', '1');
    else window.localStorage.removeItem('appointments:mock');
  } catch {
    /* nothing to remember */
  }
}

/** The signed-in person and workspace, for the stand-in (set from the session by `useAppointmentsSetup`). */
export const mockState: {
  me: { id: string; name: string };
  org: { slug: string; name: string; timezone: string; currency: string };
} = {
  me: { id: 'me', name: 'You' },
  org: { slug: 'demo', name: 'Demo Workspace', timezone: 'UTC', currency: 'USD' },
};
export function configureMock(
  me: { id: string; name: string },
  org: { slug: string; name: string; timezone: string; currency: string },
): void {
  mockState.me = me;
  mockState.org = org;
}

/** Every staff call goes through the same-origin proxy (`/api/v2/*`), which attaches the session token. */
export const call = <T = void>(path: string, req: ApiRequest<T> = {}): Promise<T> =>
  apiFetch(path, req as BaseRequest<T>);

/**
 * The visitor's calls. They carry no session: the same-origin route `/api/public/appointments/*` relays them to the API
 * without a token, and the booking page's address (or the manage link's secret) is the only credential. Mutations still send
 * an Idempotency-Key so a retried tap books once.
 */
export async function callPublic<T>(path: string, req: ApiRequest<T> = {}): Promise<T> {
  const method = req.method ?? 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Request-Id': crypto.randomUUID(),
  };
  if (req.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['Idempotency-Key'] = req.idempotencyKey ?? crypto.randomUUID();
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query ?? {}))
    if (v !== undefined && v !== '') query.set(k, String(v));
  const qs = query.toString();
  const res = await fetch(`/api/public/appointments${path}${qs ? `?${qs}` : ''}`, {
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
