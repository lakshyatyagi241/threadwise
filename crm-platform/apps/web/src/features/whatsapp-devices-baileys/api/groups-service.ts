import {
  createWaDeviceGroupResultSchema,
  waDeviceGroupInviteLinkSchema,
  waDeviceGroupJoinPreviewSchema,
  waDeviceGroupJoinRequestsSchema,
  waDeviceGroupJoinResultSchema,
  waDeviceGroupListSchema,
  waDeviceGroupMembersSchema,
  waDeviceGroupSchema,
  waDeviceGroupsStateSchema,
  waDeviceGroupsSyncResultSchema,
  waGroupParticipantResultsSchema,
  type CreateWaDeviceGroupBody,
  type HandleWaDeviceGroupJoinRequestsInput,
  type UpdateWaDeviceGroupInput,
  type WaGroupParticipantAction,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';

/** `/v2/devices/:id/groups/...`: a group is addressed by its number (`devices.uuid`) and its own uuid (`wa_device_groups.uuid`). */
const base = (device: string) => `/devices/${device}/groups`;

/** The filters of the list: part of its query key. */
export interface GroupListParams {
  q?: string;
  status?: 'all' | 'active' | 'left';
}

export const waGroupsApi = {
  state: (device: string, signal?: AbortSignal) =>
    apiFetch(`${base(device)}/state`, { schema: waDeviceGroupsStateSchema, signal }),
  list: (device: string, params: GroupListParams, cursor?: string, signal?: AbortSignal) =>
    apiFetch(base(device), {
      query: { cursor, q: params.q, status: params.status },
      schema: waDeviceGroupListSchema,
      signal,
    }),
  /** Reads the whole list from WhatsApp now (counted, at most once a minute per number: `throttled` says nothing was asked). */
  sync: (device: string) =>
    apiFetch(`${base(device)}/sync`, { method: 'POST', schema: waDeviceGroupsSyncResultSchema }),
  create: (device: string, input: CreateWaDeviceGroupBody, idempotencyKey?: string) =>
    apiFetch(base(device), {
      method: 'POST',
      body: input,
      schema: createWaDeviceGroupResultSchema,
      idempotencyKey,
    }),
  update: (device: string, group: string, input: UpdateWaDeviceGroupInput) =>
    apiFetch(`${base(device)}/${group}`, {
      method: 'PATCH',
      body: input,
      schema: waDeviceGroupSchema,
    }),
  /** Multipart (field `file`): `apiFetch` only speaks JSON, so this one builds its own request and reads problem+json the same way. */
  setPicture: async (device: string, group: string, file: File) => {
    const form = new FormData();
    form.set('file', file);
    const res = await fetch(`/api/v2${base(device)}/${group}/picture`, {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
        'X-Request-Id': crypto.randomUUID(),
      },
      body: form,
      credentials: 'same-origin',
    });
    const text = await res.text();
    const json: unknown = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw toApiError(res.status, json, res.headers.get('x-request-id'));
    return waDeviceGroupSchema.parse(json);
  },
  removePicture: (device: string, group: string) =>
    apiFetch(`${base(device)}/${group}/picture`, { method: 'DELETE', schema: waDeviceGroupSchema }),
  members: (device: string, group: string, q?: string, cursor?: string, signal?: AbortSignal) =>
    apiFetch(`${base(device)}/${group}/participants`, {
      query: { limit: 50, q, cursor },
      schema: waDeviceGroupMembersSchema,
      signal,
    }),
  /** Add, promote and demote are one POST; removing is a DELETE with the numbers in the body (the API's own shape). */
  participants: (
    device: string,
    group: string,
    action: WaGroupParticipantAction,
    numbers: string[],
  ) =>
    action === 'remove'
      ? apiFetch(`${base(device)}/${group}/participants`, {
          method: 'DELETE',
          body: { numbers },
          schema: waGroupParticipantResultsSchema,
        })
      : apiFetch(`${base(device)}/${group}/participants`, {
          method: 'POST',
          body: { action, numbers },
          schema: waGroupParticipantResultsSchema,
        }),
  joinRequests: (device: string, group: string, signal?: AbortSignal) =>
    apiFetch(`${base(device)}/${group}/join-requests`, {
      schema: waDeviceGroupJoinRequestsSchema,
      signal,
    }),
  handleJoinRequests: (
    device: string,
    group: string,
    input: HandleWaDeviceGroupJoinRequestsInput,
  ) =>
    apiFetch(`${base(device)}/${group}/join-requests`, {
      method: 'POST',
      body: input,
      schema: waGroupParticipantResultsSchema,
    }),
  inviteLink: (device: string, group: string, signal?: AbortSignal) =>
    apiFetch(`${base(device)}/${group}/invite-link`, {
      schema: waDeviceGroupInviteLinkSchema,
      signal,
    }),
  resetInviteLink: (device: string, group: string) =>
    apiFetch(`${base(device)}/${group}/invite-link/reset`, {
      method: 'POST',
      schema: waDeviceGroupInviteLinkSchema,
    }),
  joinPreview: (device: string, invite: string) =>
    apiFetch(`${base(device)}/join-by-link/preview`, {
      method: 'POST',
      body: { invite },
      schema: waDeviceGroupJoinPreviewSchema,
    }),
  join: (device: string, invite: string) =>
    apiFetch(`${base(device)}/join-by-link`, {
      method: 'POST',
      body: { invite, acknowledgeRisk: true },
      schema: waDeviceGroupJoinResultSchema,
    }),
  leave: (device: string, group: string) =>
    apiFetch(`${base(device)}/${group}/leave`, { method: 'POST', body: { confirm: true } }),
};
