import { platformMyPermissionsSchema } from '@crm/contracts';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import {
  assignmentListSchema,
  assignmentPreviewSchema,
  deletedSchema,
  presetListSchema,
  providerChannelListSchema,
  providerEventListSchema,
  providerListSchema,
  providerSchema,
  switchResultSchema,
  testResultSchema,
  type AssignmentChange,
  type ProviderInput,
  type ProviderUpdateInput,
  type SwitchInput,
  type TestInput,
} from './schemas';

/** Everything here goes through the same-origin operator proxy: `/api/platform/*` becomes `/v2/platform/*`. */
const ROOT = '/whatsapp-providers';

export const KEYS = {
  all: ['operator', 'whatsapp-providers'] as const,
  list: ['operator', 'whatsapp-providers', 'list'] as const,
  one: (id: string) => ['operator', 'whatsapp-providers', 'one', id] as const,
  presets: ['operator', 'whatsapp-providers', 'presets'] as const,
  events: (id: string) => ['operator', 'whatsapp-providers', 'events', id] as const,
  channels: (id: string) => ['operator', 'whatsapp-providers', 'channels', id] as const,
  assignments: (search: string) =>
    ['operator', 'whatsapp-providers', 'assignments', search] as const,
  me: ['operator', 'whatsapp-providers', 'me'] as const,
};

export const providersApi = {
  me: (signal?: AbortSignal) =>
    operatorFetch('/me/permissions', { schema: platformMyPermissionsSchema, signal }),
  list: (signal?: AbortSignal) => operatorFetch(ROOT, { schema: providerListSchema, signal }),
  presets: (signal?: AbortSignal) =>
    operatorFetch(`${ROOT}/presets`, { schema: presetListSchema, signal }),
  get: (id: string, signal?: AbortSignal) =>
    operatorFetch(`${ROOT}/${id}`, { schema: providerSchema, signal }),
  create: (body: ProviderInput) =>
    operatorFetch(ROOT, { method: 'POST', body, schema: providerSchema }),
  update: (id: string, body: ProviderUpdateInput) =>
    operatorFetch(`${ROOT}/${id}`, { method: 'PATCH', body, schema: providerSchema }),
  remove: (id: string) =>
    operatorFetch(`${ROOT}/${id}`, { method: 'DELETE', schema: deletedSchema }),
  test: (id: string, body: TestInput) =>
    operatorFetch(`${ROOT}/${id}/test`, { method: 'POST', body, schema: testResultSchema }),
  /**
   * The wizard tests the connection before the provider exists, with the credentials still in the form: the API takes the draft
   * body and the secrets once, uses them for this one call and stores nothing.
   */
  testDraft: (body: ProviderInput & TestInput) =>
    operatorFetch(`${ROOT}/test`, { method: 'POST', body, schema: testResultSchema }),
  makeDefault: (id: string, rowVersion: number) =>
    operatorFetch(`${ROOT}/${id}/make-default`, {
      method: 'POST',
      body: { rowVersion },
      schema: providerSchema,
    }),
  setEnabled: (id: string, enabled: boolean, rowVersion: number) =>
    operatorFetch(`${ROOT}/${id}/${enabled ? 'enable' : 'disable'}`, {
      method: 'POST',
      body: { rowVersion },
      schema: providerSchema,
    }),
  events: (id: string, signal?: AbortSignal) =>
    operatorFetch(`${ROOT}/${id}/events`, { schema: providerEventListSchema, signal }),
  channels: (id: string, cursor: string | undefined, signal?: AbortSignal) =>
    operatorFetch(`${ROOT}/${id}/channels`, {
      query: { limit: 50, cursor },
      schema: providerChannelListSchema,
      signal,
    }),
  assignments: (search: string, cursor: string | undefined, signal?: AbortSignal) =>
    operatorFetch(`${ROOT}/assignments`, {
      query: { limit: 50, cursor, search: search.trim() || undefined },
      schema: assignmentListSchema,
      signal,
    }),
  changeAssignments: (body: AssignmentChange) =>
    operatorFetch(`${ROOT}/assignments`, {
      method: 'POST',
      body,
      schema: assignmentPreviewSchema,
    }),
  switchProvider: (body: SwitchInput) =>
    operatorFetch(`${ROOT}/switch-provider`, { method: 'POST', body, schema: switchResultSchema }),
};
