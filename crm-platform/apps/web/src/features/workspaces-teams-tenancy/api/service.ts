import {
  inviteWspMemberResponseSchema,
  wspInvitePreviewSchema,
  wspAvailabilitySchema,
  wspMemberActionResponseSchema,
  wspMemberSchema,
  wspMembersSummarySchema,
  type ChangeWspMemberRoleInput,
  type AddWspTeamMemberInput,
  type CreateWspTeamInput,
  type InviteWspMemberInput,
  type SetWspAvailabilityInput,
  type UpdateWspMemberDetailsInput,
  type UpdateWspTeamInput,
  type UpdateWspTeamMemberInput,
  type WspHandoverInput,
  wspHandoverPreviewSchema,
  wspHandoverResultSchema,
  wspTeamSchema,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

const base = '/workspace';

/** Every call of the members and teams screens. Members and teams are named by uuid; the proxy adds the session. */
export const wspApi = {
  summary: (signal?: AbortSignal) =>
    apiFetch(`${base}/members/summary`, { schema: wspMembersSummarySchema, signal }),
  invite: (input: InviteWspMemberInput) =>
    apiFetch(`${base}/members/invite`, {
      method: 'POST',
      body: input,
      schema: inviteWspMemberResponseSchema,
    }),
  resendInvite: (id: string) =>
    apiFetch(`${base}/members/${id}/resend-invite`, {
      method: 'POST',
      schema: wspMemberActionResponseSchema,
    }),
  changeRole: (id: string, input: ChangeWspMemberRoleInput) =>
    apiFetch(`${base}/members/${id}/role`, { method: 'PATCH', body: input }),
  /** The Change member dialog: phone and chat limit. */
  updateDetails: (id: string, input: UpdateWspMemberDetailsInput) =>
    apiFetch(`${base}/members/${id}/details`, {
      method: 'PATCH',
      body: input,
      schema: wspMemberSchema,
    }),
  /** The caller's own Available / Offline switch (the account menu). */
  myAvailability: (signal?: AbortSignal) =>
    apiFetch(`${base}/members/me/availability`, { schema: wspAvailabilitySchema, signal }),
  setMyAvailability: (input: SetWspAvailabilityInput) =>
    apiFetch(`${base}/members/me/availability`, {
      method: 'PUT',
      body: input,
      schema: wspAvailabilitySchema,
    }),
  removeMember: (id: string) => apiFetch(`${base}/members/${id}`, { method: 'DELETE' }),
  resetPassword: (id: string) =>
    apiFetch(`${base}/members/${id}/reset-password`, {
      method: 'POST',
      schema: wspMemberActionResponseSchema,
    }),

  createTeam: (input: CreateWspTeamInput) =>
    apiFetch(`${base}/teams`, { method: 'POST', body: input, schema: wspTeamSchema }),
  updateTeam: (id: string, input: UpdateWspTeamInput) =>
    apiFetch(`${base}/teams/${id}`, { method: 'PATCH', body: input, schema: wspTeamSchema }),
  deleteTeam: (id: string) => apiFetch(`${base}/teams/${id}`, { method: 'DELETE' }),
  /** Adds a person to a team, or changes their role / primary mark when already on it. */
  addTeamMember: (id: string, input: AddWspTeamMemberInput) =>
    apiFetch(`${base}/teams/${id}/members`, { method: 'POST', body: input, schema: wspTeamSchema }),
  updateTeamMember: (id: string, userId: string, input: UpdateWspTeamMemberInput) =>
    apiFetch(`${base}/teams/${id}/members/${userId}`, {
      method: 'PATCH',
      body: input,
      schema: wspTeamSchema,
    }),
  removeTeamMember: (id: string, userId: string) =>
    apiFetch(`${base}/teams/${id}/members/${userId}`, { method: 'DELETE', schema: wspTeamSchema }),

  /** The deactivate dialog: what a person holds and who could take it over. */
  handoverPreview: (id: string, signal?: AbortSignal) =>
    apiFetch(`${base}/members/${id}/handover`, { schema: wspHandoverPreviewSchema, signal }),
  handover: (id: string, input: WspHandoverInput) =>
    apiFetch(`${base}/members/${id}/handover`, {
      method: 'POST',
      body: input,
      schema: wspHandoverResultSchema,
    }),

  /** The page behind an emailed invite link: public, so it works without a session. */
  invitePreview: (token: string, orgSlug: string, signal?: AbortSignal) =>
    apiFetch(`${base}/invitations/preview`, {
      query: { token, orgSlug },
      schema: wspInvitePreviewSchema,
      signal,
    }),
};
