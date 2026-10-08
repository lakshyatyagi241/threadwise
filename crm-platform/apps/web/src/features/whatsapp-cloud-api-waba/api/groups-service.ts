import {
  wabaGroupJoinRequestsResultSchema,
  wabaGroupListSchema,
  wabaNumberGroupCountSchema,
  wabaGroupMembersSchema,
  wabaGroupParticipantsRemovedSchema,
  wabaGroupSchema,
  wabaGroupsStateSchema,
  wabaGroupUpdateAcceptedSchema,
  type CreateWabaGroupInput,
  type HandleWabaGroupJoinRequestsInput,
  type RemoveWabaGroupParticipantsInput,
  type UpdateWabaGroupInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

const base = (number: string) => `/waba/numbers/${number}/groups`;

/** How many group records removing a number deletes (D6 warning). Not plan-gated: a lapsed plan keeps the rows. */
export const wabaGroupCountApi = (number: string, signal?: AbortSignal) =>
  apiFetch(`/waba/numbers/${number}/group-count`, { schema: wabaNumberGroupCountSchema, signal });

/** Every Groups call: a group belongs to one connected number (both named by uuid; the proxy adds the session token). */
export const wabaGroupsApi = {
  state: (number: string, fresh = false, signal?: AbortSignal) =>
    apiFetch(`${base(number)}/state`, {
      schema: wabaGroupsStateSchema,
      query: fresh ? { fresh: 1 } : undefined,
      signal,
    }),
  list: (number: string, cursor?: string, signal?: AbortSignal) =>
    apiFetch(base(number), { schema: wabaGroupListSchema, query: { cursor }, signal }),
  create: (number: string, input: CreateWabaGroupInput, idempotencyKey?: string) =>
    apiFetch(base(number), {
      method: 'POST',
      body: input,
      schema: wabaGroupSchema,
      idempotencyKey,
    }),
  refresh: (number: string, group: string) =>
    apiFetch(`${base(number)}/${group}/refresh`, { method: 'POST', schema: wabaGroupSchema }),
  resetLink: (number: string, group: string) =>
    apiFetch(`${base(number)}/${group}/invite-link/reset`, {
      method: 'POST',
      schema: wabaGroupSchema,
    }),
  update: (number: string, group: string, input: UpdateWabaGroupInput) =>
    apiFetch(`${base(number)}/${group}`, {
      method: 'PATCH',
      body: input,
      schema: wabaGroupUpdateAcceptedSchema,
    }),
  joinRequests: (number: string, group: string, input: HandleWabaGroupJoinRequestsInput) =>
    apiFetch(`${base(number)}/${group}/join-requests`, {
      method: 'POST',
      body: input,
      schema: wabaGroupJoinRequestsResultSchema,
    }),
  members: (number: string, group: string, signal?: AbortSignal) =>
    apiFetch(`${base(number)}/${group}/participants`, { schema: wabaGroupMembersSchema, signal }),
  removeParticipants: (number: string, group: string, input: RemoveWabaGroupParticipantsInput) =>
    apiFetch(`${base(number)}/${group}/participants`, {
      method: 'DELETE',
      body: input,
      schema: wabaGroupParticipantsRemovedSchema,
    }),
  remove: (number: string, group: string) =>
    apiFetch(`${base(number)}/${group}`, { method: 'DELETE' }),
};
