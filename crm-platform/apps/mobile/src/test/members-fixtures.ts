import type { WspMember, WspMembersSummary, WspRoleRef } from '@crm/contracts';
import { session as baseSession } from './dashboard-fixtures';

/** Realistic answers of the team-members endpoints, for tests. Fake names only. */

const role = (tier: WspRoleRef['tier'], name: string, n: number): WspRoleRef => ({
  id: `0${n}000000-0000-4000-8000-000000000000`,
  name,
  tier,
});

export const OWNER_ROLE = role('owner', 'Owner', 1);
export const ADMIN_ROLE = role('admin', 'Admin', 2);
export const MANAGER_ROLE = role('manager', 'Manager', 3);
export const AGENT_ROLE = role('agent', 'Agent', 4);
export const VIEWER_ROLE = role('viewer', 'Viewer', 5);

const base: Omit<WspMember, 'id' | 'fullName' | 'email' | 'tier' | 'roles' | 'isOwner' | 'status'> =
  {
    avatarUrl: null,
    presence: 'online',
    lastSeenAt: null,
    invitedAt: '2026-09-01T08:00:00.000Z',
    joinedAt: '2026-09-02T08:00:00.000Z',
    teamIds: [],
    rowVersion: 3,
  };

export const ME_ID = 'b1111111-1111-4111-8111-111111111111';

/** The signed-in admin (the person using the app). */
export const me: WspMember = {
  ...base,
  id: ME_ID,
  fullName: 'Asha Verma',
  email: 'asha@example.test',
  tier: 'admin',
  roles: [ADMIN_ROLE],
  isOwner: false,
  status: 'active',
};

export const owner: WspMember = {
  ...base,
  id: 'b2222222-2222-4222-8222-222222222222',
  fullName: 'Olivia Owner',
  email: 'olivia@example.test',
  tier: 'owner',
  roles: [OWNER_ROLE],
  isOwner: true,
  status: 'active',
};

export const agent: WspMember = {
  ...base,
  id: 'b3333333-3333-4333-8333-333333333333',
  fullName: 'Meera Nair',
  email: 'meera@example.test',
  tier: 'agent',
  roles: [AGENT_ROLE],
  isOwner: false,
  status: 'active',
  presence: 'away',
};

export const pendingAgent: WspMember = {
  ...agent,
  id: 'b4444444-4444-4444-8444-444444444444',
  fullName: 'Rohan Mehta',
  email: 'rohan@example.test',
  status: 'pending',
  joinedAt: null,
  rowVersion: 1,
};

export const summary: WspMembersSummary = {
  counts: { all: 4, owner: 1, admin: 1, manager: 0, agent: 2, viewer: 0, custom: 0, pending: 1 },
  roles: [
    { ...ADMIN_ROLE, grantable: true },
    { ...MANAGER_ROLE, grantable: true },
    { ...AGENT_ROLE, grantable: true },
    { ...VIEWER_ROLE, grantable: true },
    { ...OWNER_ROLE, grantable: false },
  ],
  seats: { used: 4, limit: 10 },
  me: { id: ME_ID, tier: 'admin', canInvite: true, canAssignRoles: true, canManageTeams: true },
};

/** An agent: may look at the list and nothing else. */
export const readOnlySummary: WspMembersSummary = {
  ...summary,
  me: {
    id: agent.id,
    tier: 'agent',
    canInvite: false,
    canAssignRoles: false,
    canManageTeams: false,
  },
};

export const pageOf = (data: WspMember[]) => ({
  data,
  page: { nextCursor: null, hasMore: false, limit: 30 },
});

export const sessionAsAdmin = baseSession;
