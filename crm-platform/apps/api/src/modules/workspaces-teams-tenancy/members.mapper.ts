import type { WspMember, WspMemberStatus, WspPresence, WspRoleRef } from '@crm/contracts';
import type { MemberRoleRow, MemberRow, RoleRow } from './members.repository';
import { tierOfRole } from './member-rules';

const PRESENCE = new Set<WspPresence>(['online', 'away', 'busy', 'offline']);

/** What the inbox stored, as one of the four labels the screen knows; anything else (or nothing) reads offline. */
export const toPresence = (stored: string | null): WspPresence =>
  stored && PRESENCE.has(stored as WspPresence) ? (stored as WspPresence) : 'offline';

export const toMemberStatus = (
  row: Pick<MemberRow, 'status' | 'invitedAt' | 'joinedAt'>,
): WspMemberStatus => {
  if (row.status === 'inactive') return 'inactive';
  return row.joinedAt === null && row.invitedAt !== null ? 'pending' : 'active';
};

export const toRoleRef = (r: Pick<RoleRow, 'uuid' | 'name' | 'systemKey'>): WspRoleRef => ({
  id: r.uuid,
  name: r.name,
  tier: tierOfRole(r),
});

/** The only place a member row becomes a response: uuids out, internal ids never. */
export function toMemberResponse(
  row: MemberRow,
  roles: MemberRoleRow[],
  teamIds: string[],
): WspMember {
  return {
    id: row.uuid,
    fullName: row.fullName,
    email: row.email,
    // Teammates' avatars are not exposed yet: the account domain serves only the caller's own picture.
    avatarUrl: null,
    tier: row.tier,
    roles: roles.map((r) =>
      toRoleRef({ uuid: r.roleUuid, name: r.roleName, systemKey: r.systemKey }),
    ),
    isOwner: row.tier === 'owner',
    status: toMemberStatus(row),
    presence: toPresence(row.presence),
    lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    invitedAt: row.invitedAt ? row.invitedAt.toISOString() : null,
    joinedAt: row.joinedAt ? row.joinedAt.toISOString() : null,
    teamIds,
    rowVersion: row.rowVersion,
  };
}
