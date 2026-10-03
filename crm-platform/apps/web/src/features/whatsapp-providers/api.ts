import {
  channelProviderInfoSchema,
  listAssignmentsResponseSchema,
  switchWorkspaceProviderResponseSchema,
  testWhatsappProviderResponseSchema,
  whatsappProviderListSchema,
  whatsappProviderSchema,
  workspaceAssignmentSchema,
  type CreateWhatsappProviderInput,
  type SetAssignmentInput,
  type SwitchWorkspaceProviderInput,
  type TestWhatsappProviderInput,
  type UpdateWhatsappProviderInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';

/**
 * Operator console: through the same-origin operator proxy (`/api/platform/*` becomes `/v2/platform/*`). Secrets are write only:
 * no response carries one, and nothing here keeps what the operator typed after a call.
 */
const ROOT = '/whatsapp-providers';

export const wapKeys = {
  all: ['operator', 'whatsapp-providers'] as const,
  list: ['operator', 'whatsapp-providers', 'list'] as const,
  one: (id: string) => ['operator', 'whatsapp-providers', 'one', id] as const,
  assignments: (search: string, overrideOnly: boolean) =>
    ['operator', 'whatsapp-providers', 'assignments', search, overrideOnly] as const,
  assignmentsAll: ['operator', 'whatsapp-providers', 'assignments'] as const,
  /** The switch screen's workspace search: a plain list, not the assignments screen's paged one, so the two never share a cache shape. */
  workspacePicker: (search: string) =>
    ['operator', 'whatsapp-providers', 'workspace-picker', search] as const,
};

export const fetchProviders = (signal?: AbortSignal) =>
  operatorFetch(ROOT, { schema: whatsappProviderListSchema, signal });

export const fetchProvider = (id: string, signal?: AbortSignal) =>
  operatorFetch(`${ROOT}/${id}`, { schema: whatsappProviderSchema, signal });

export const createProvider = (body: CreateWhatsappProviderInput) =>
  operatorFetch(ROOT, { method: 'POST', body, schema: whatsappProviderSchema });

export const updateProvider = (id: string, body: UpdateWhatsappProviderInput) =>
  operatorFetch(`${ROOT}/${id}`, { method: 'PATCH', body, schema: whatsappProviderSchema });

export type ProviderStatusAction = 'activate' | 'disable' | 'archive' | 'default';

/** Activate, disable, archive and make-default all carry the version the operator read. */
export const runProviderAction = (id: string, action: ProviderStatusAction, rowVersion: number) =>
  operatorFetch(`${ROOT}/${id}/${action}`, {
    method: 'POST',
    body: { rowVersion },
    schema: whatsappProviderSchema,
  });

/** No registry default: new numbers follow the console WhatsApp setting again. Answers the list. */
export const clearDefaultProvider = () =>
  operatorFetch(`${ROOT}/default`, { method: 'DELETE', schema: whatsappProviderListSchema });

export const testProvider = (id: string, body: TestWhatsappProviderInput) =>
  operatorFetch(`${ROOT}/${id}/test`, {
    method: 'POST',
    body,
    schema: testWhatsappProviderResponseSchema,
  });

export const fetchAssignments = (
  q: { search: string; overrideOnly: boolean; cursor?: string },
  signal?: AbortSignal,
) =>
  operatorFetch(`${ROOT}/assignments`, {
    query: {
      search: q.search.trim() || undefined,
      overrideOnly: q.overrideOnly ? 'true' : undefined,
      limit: 50,
      cursor: q.cursor,
    },
    schema: listAssignmentsResponseSchema,
    signal,
  });

export const setAssignment = (workspaceId: string, body: SetAssignmentInput) =>
  operatorFetch(`${ROOT}/workspaces/${workspaceId}/assignment`, {
    method: 'PUT',
    body,
    schema: workspaceAssignmentSchema,
  });

export const clearAssignment = (workspaceId: string) =>
  operatorFetch(`${ROOT}/workspaces/${workspaceId}/assignment`, {
    method: 'DELETE',
    schema: workspaceAssignmentSchema,
  });

export const switchWorkspace = (workspaceId: string, body: SwitchWorkspaceProviderInput) =>
  operatorFetch(`${ROOT}/workspaces/${workspaceId}/switch`, {
    method: 'POST',
    body,
    schema: switchWorkspaceProviderResponseSchema,
  });

/** Workspace side (staff proxy, `/api/v2/*`): which provider new numbers go through and which one each number is on. */
export const PROVIDER_INFO_KEY = ['waba', 'provider-info'] as const;
export const fetchProviderInfo = (signal?: AbortSignal) =>
  apiFetch('/waba/provider-info', { schema: channelProviderInfoSchema, signal });
