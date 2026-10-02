import {
  inviteWspMemberResponseSchema,
  wspInvitePreviewSchema,
  wspMemberActionResponseSchema,
  wspMembersSummarySchema,
  type ChangeWspMemberRoleInput,
  type CreateWspTeamInput,
  type InviteWspMemberInput,
  type UpdateWspTeamInput,
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
  removeMember: (id: string) => apiFetch(`${base}/members/${id}`, { method: 'DELETE' }),
  resetPassword: (id: string) =>
    apiFetch(`${base}/members/${id}/reset-password`, {
      method: 'POST',
      schema: wspMemberActionResponseSchema,
    }),

  createTeam: (input: CreateWspTeamInput) =>
    apiFetch(`${base}/teams`, { method: 'POST', body: input }),
  updateTeam: (id: string, input: UpdateWspTeamInput) =>
    apiFetch(`${base}/teams/${id}`, { method: 'PATCH', body: input }),
  deleteTeam: (id: string) => apiFetch(`${base}/teams/${id}`, { method: 'DELETE' }),

  /** The page behind an emailed invite link: public, so it works without a session. */
  invitePreview: (token: string, orgSlug: string, signal?: AbortSignal) =>
    apiFetch(`${base}/invitations/preview`, {
      query: { token, orgSlug },
      schema: wspInvitePreviewSchema,
      signal,
    }),
};
