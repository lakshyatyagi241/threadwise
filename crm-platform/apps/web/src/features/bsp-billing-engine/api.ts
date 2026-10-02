import {
  attachAllResultSchema,
  bspAllocationListSchema,
  bspAllocationSchema,
  bspBillingModeResponseSchema,
  bspDashboardSchema,
  bspSettingsResponseSchema,
  bspWabaCandidateListSchema,
  revokeResultSchema,
  setBillingModeResponseSchema,
  type AttachCreditInput,
  type BspBillingMode,
  type UpdateBspSettingsInput,
} from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { apiFetch } from '@/lib/api/client';

export const KEYS = {
  settings: ['bsp', 'settings'] as const,
  candidates: ['bsp', 'candidates'] as const,
  allocations: ['bsp', 'allocations'] as const,
  dashboard: (month: string | undefined) => ['bsp', 'dashboard', month ?? 'current'] as const,
  billingMode: ['bsp', 'billing-mode'] as const,
};

/** The operator console's calls (`/api/platform/*` becomes `/v2/platform/*`; the browser never sees a token). */
export const operatorApi = {
  settings: (signal?: AbortSignal) =>
    operatorFetch('/bsp/settings', { schema: bspSettingsResponseSchema, signal }),
  saveSettings: (body: UpdateBspSettingsInput) =>
    operatorFetch('/bsp/settings', { method: 'PUT', body, schema: bspSettingsResponseSchema }),
  candidates: (signal?: AbortSignal) =>
    operatorFetch('/bsp/waba-candidates', { schema: bspWabaCandidateListSchema, signal }),
  allocations: (cursor: string | undefined, signal?: AbortSignal) =>
    operatorFetch('/bsp/allocations', {
      query: { limit: 50, cursor },
      schema: bspAllocationListSchema,
      signal,
    }),
  attach: (body: AttachCreditInput) =>
    operatorFetch('/bsp/allocations', { method: 'POST', body, schema: bspAllocationSchema }),
  attachAll: () =>
    operatorFetch('/bsp/allocations/attach-all', { method: 'POST', schema: attachAllResultSchema }),
  revoke: (id: string, rowVersion: number) =>
    operatorFetch(`/bsp/allocations/${id}/revoke`, {
      method: 'POST',
      body: { rowVersion },
      schema: revokeResultSchema,
    }),
  dashboard: (month: string | undefined, signal?: AbortSignal) =>
    operatorFetch('/bsp/dashboard', { query: { month }, schema: bspDashboardSchema, signal }),
};

/** The workspace's own calls (`/api/v2/*`). */
export const customerApi = {
  billingMode: (signal?: AbortSignal) =>
    apiFetch('/bsp/billing-mode', { schema: bspBillingModeResponseSchema, signal }),
  setBillingMode: (mode: BspBillingMode) =>
    apiFetch('/bsp/billing-mode', {
      method: 'PUT',
      body: { mode },
      schema: setBillingModeResponseSchema,
    }),
};
