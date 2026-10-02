import {
  connectResultSchema,
  verifyTokenResultSchema,
  wabaConnectionListSchema,
  wabaConnectionSchema,
  wabaBusinessProfileSchema,
  wabaHealthSchema,
  wabaReadinessSchema,
  type ConnectEmbeddedInput,
  type ConnectManualInput,
  type UpdateBusinessProfileInput,
  type VerifyTokenInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

const base = '/waba';

/** Every WABA call. Connections are named by uuid; the proxy adds the session token. */
export const wabaApi = {
  readiness: (signal?: AbortSignal) =>
    apiFetch(`${base}/readiness`, { schema: wabaReadinessSchema, signal }),
  list: (signal?: AbortSignal) =>
    apiFetch(`${base}/numbers`, { schema: wabaConnectionListSchema, signal }),
  health: (id: string, signal?: AbortSignal) =>
    apiFetch(`${base}/numbers/${id}/health`, { schema: wabaHealthSchema, signal }),
  connectEmbedded: (input: ConnectEmbeddedInput, idempotencyKey?: string) =>
    apiFetch(`${base}/numbers/connect/embedded`, {
      method: 'POST',
      body: input,
      schema: connectResultSchema,
      idempotencyKey,
    }),
  connectManual: (input: ConnectManualInput, idempotencyKey?: string) =>
    apiFetch(`${base}/numbers/connect/manual`, {
      method: 'POST',
      body: input,
      schema: connectResultSchema,
      idempotencyKey,
    }),
  verifyToken: (input: VerifyTokenInput) =>
    apiFetch(`${base}/numbers/verify-token`, {
      method: 'POST',
      body: input,
      schema: verifyTokenResultSchema,
    }),
  setPrimary: (id: string) =>
    apiFetch(`${base}/numbers/${id}/primary`, { method: 'POST', schema: wabaConnectionSchema }),
  resubscribe: (id: string) =>
    apiFetch(`${base}/numbers/${id}/resubscribe`, { method: 'POST', schema: connectResultSchema }),
  register: (id: string, pin?: string) =>
    apiFetch(`${base}/numbers/${id}/register`, {
      method: 'POST',
      body: pin ? { pin } : {},
      schema: wabaConnectionSchema,
    }),
  disconnect: (id: string) =>
    apiFetch(`${base}/numbers/${id}/disconnect`, { method: 'POST', schema: wabaConnectionSchema }),
  profile: (id: string, signal?: AbortSignal) =>
    apiFetch(`${base}/numbers/${id}/profile`, { schema: wabaBusinessProfileSchema, signal }),
  updateProfile: (id: string, patch: UpdateBusinessProfileInput) =>
    apiFetch(`${base}/numbers/${id}/profile`, {
      method: 'PUT',
      body: patch,
      schema: wabaBusinessProfileSchema,
    }),
  remove: (id: string) => apiFetch(`${base}/numbers/${id}`, { method: 'DELETE' }),
  setToken: (id: string, accessToken: string) =>
    apiFetch(`${base}/numbers/${id}/token`, {
      method: 'PUT',
      body: { accessToken },
      schema: wabaConnectionSchema,
    }),
  renewToken: (id: string) =>
    apiFetch(`${base}/numbers/${id}/token/renew`, {
      method: 'POST',
      schema: wabaConnectionSchema,
    }),
};
