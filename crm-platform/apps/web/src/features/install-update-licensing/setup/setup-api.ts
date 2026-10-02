import type { z } from 'zod';
import {
  setupBootstrapResponseSchema,
  setupStatusResponseSchema,
  verifySetupTokenResponseSchema,
  type SetupBootstrapRequest,
} from '@crm/contracts';
import { toApiError } from '@/lib/api/errors';

/**
 * The setup calls are public (no account exists yet), so they go through the same-origin `/api/v2/*` proxy without
 * a session. The setup token travels in the request body: the proxy forwards bodies, not custom headers.
 */
async function call<T>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  init?: { method: 'POST'; body: unknown },
): Promise<T> {
  const res = await fetch(`/api/v2/setup/${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      'X-Request-Id': crypto.randomUUID(),
      ...(init ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) throw toApiError(res.status, json, res.headers.get('x-request-id'));
  return schema.parse(json);
}

export const fetchSetupStatus = () => call('status', setupStatusResponseSchema);

export const verifySetupToken = (setupToken: string) =>
  call('verify-token', verifySetupTokenResponseSchema, { method: 'POST', body: { setupToken } });

export const bootstrapPlatform = (body: SetupBootstrapRequest) =>
  call('bootstrap', setupBootstrapResponseSchema, { method: 'POST', body });
