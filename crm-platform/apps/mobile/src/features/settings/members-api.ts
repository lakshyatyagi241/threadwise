import {
  inviteWspMemberResponseSchema,
  pageResponseSchema,
  wspMemberActionResponseSchema,
  wspMemberSchema,
  wspMembersSummarySchema,
  type ChangeWspMemberRoleInput,
  type InviteWspMemberInput,
  type WspRoleTier,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/**
 * The calls behind Settings, Team members (TW-WSP-015 to 019). Every member may read the list and the summary; the actions follow what the
 * summary says the caller may do (`me.canInvite`, `me.canAssignRoles`), and the server stays the authority (`org.member.invite`,
 * `org.member.role_assign`, and the role ladder: nobody acts on themselves or on a higher tier).
 */

export const MEMBERS_PAGE_SIZE = 30;

const memberListSchema = pageResponseSchema(wspMemberSchema);

/** One page of members, highest role first then by name; removed members are not listed. */
export const fetchMembers = (
  filters: { q: string; tier: WspRoleTier | undefined },
  cursor: string | undefined,
  signal?: AbortSignal,
) =>
  apiFetch('/v2/workspace/members', {
    query: {
      q: filters.q.trim() || undefined,
      tier: filters.tier,
      limit: MEMBERS_PAGE_SIZE,
      cursor,
    },
    schema: memberListSchema,
    signal,
  });

/** Counts per role, the roles the caller may grant, the seats used and what the caller may do. */
export const fetchMembersSummary = (signal?: AbortSignal) =>
  apiFetch('/v2/workspace/members/summary', { schema: wspMembersSummarySchema, signal });

/** Invites a person by email: they get a single-use link. When mail cannot be sent, the answer carries the link to share by hand. */
export const inviteMember = (body: InviteWspMemberInput) =>
  apiFetch('/v2/workspace/members/invite', {
    method: 'POST',
    body,
    schema: inviteWspMemberResponseSchema,
  });

/** Sends a pending member a fresh link; the old one stops working. */
export const resendInvite = (id: string) =>
  apiFetch(`/v2/workspace/members/${encodeURIComponent(id)}/resend-invite`, {
    method: 'POST',
    schema: wspMemberActionResponseSchema,
  });

/** Emails the member a link to set a new password (no password is shown to anyone). */
export const resetMemberPassword = (id: string) =>
  apiFetch(`/v2/workspace/members/${encodeURIComponent(id)}/reset-password`, {
    method: 'POST',
    schema: wspMemberActionResponseSchema,
  });

/** Changes a member's role with the version that was read; a stale one is 409 ROW_VERSION_CONFLICT. */
export const changeMemberRole = (id: string, body: ChangeWspMemberRoleInput) =>
  apiFetch(`/v2/workspace/members/${encodeURIComponent(id)}/role`, {
    method: 'PATCH',
    body,
    schema: wspMemberSchema,
  });

/** Removes a member: access, roles and team places end now; the account is kept. */
export const removeMember = (id: string) =>
  apiFetch(`/v2/workspace/members/${encodeURIComponent(id)}`, { method: 'DELETE' });
