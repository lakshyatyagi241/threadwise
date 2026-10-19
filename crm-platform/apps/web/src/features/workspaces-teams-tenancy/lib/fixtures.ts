import type { WspMember, WspMembersSummary, WspRoleTier, WspTeam } from '@crm/contracts';

/** Fixtures for the unit and component tests of this domain. */
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const ROLE_IDS: Record<WspRoleTier, string> = {
  owner: uuid(901),
  admin: uuid(902),
  manager: uuid(903),
  agent: uuid(904),
  viewer: uuid(905),
  custom: uuid(906),
};

export function member(n: number, tier: WspRoleTier, over: Partial<WspMember> = {}): WspMember {
  return {
    id: uuid(n),
    fullName: `Person ${n}`,
    email: `person${n}@example.test`,
    avatarUrl: null,
    phone: null,
    chatLimit: null,
    tier,
    roles: [{ id: ROLE_IDS[tier], name: tier, tier }],
    isOwner: tier === 'owner',
    status: 'active',
    presence: 'offline',
    lastSeenAt: null,
    lastLoginAt: null,
    invitedAt: '2026-10-01T10:00:00.000Z',
    joinedAt: '2026-10-01T10:00:00.000Z',
    teamIds: [],
    rowVersion: 1,
    ...over,
  };
}

export function summary(
  meTier: WspRoleTier,
  over: Partial<WspMembersSummary> = {},
): WspMembersSummary {
  // RBAC's ladder (WorkspaceRoleRulesService): an Owner hands out every role, an Admin everything below Admin, nobody else anything.
  const rank = ['viewer', 'agent', 'manager', 'admin', 'owner'];
  const canGrant = (tier: WspRoleTier) =>
    meTier === 'owner'
      ? true
      : meTier === 'admin' && tier !== 'owner' && tier !== 'admin' && rank.indexOf(tier) >= 0;
  const privileged = meTier === 'owner' || meTier === 'admin';
  return {
    counts: { all: 5, owner: 1, admin: 1, manager: 1, agent: 1, viewer: 1, custom: 0, pending: 0 },
    roles: (['owner', 'admin', 'manager', 'agent', 'viewer'] as const).map((tier) => ({
      id: ROLE_IDS[tier],
      name: tier,
      tier,
      grantable: canGrant(tier),
    })),
    seats: { used: 5, limit: null },
    me: {
      id: uuid(1),
      tier: meTier,
      canInvite: privileged,
      canAssignRoles: privileged,
      canManageTeams: privileged,
    },
    ...over,
  };
}

export function team(n: number, over: Partial<WspTeam> = {}): WspTeam {
  return {
    id: uuid(500 + n),
    name: `Team ${n}`,
    color: '#075E54',
    description: null,
    assignmentStrategy: 'manual',
    isDefault: false,
    sort: n,
    deviceIds: [],
    parentId: null,
    depth: 1,
    lead: null,
    receivesConversations: true,
    receivesRecords: true,
    isScopeBoundary: true,
    members: [],
    memberCount: 0,
    usage: { routingRules: 0, assignmentRules: 0, segmentShares: 0, childTeams: 0, conversations: 0 },
    unusedSettings: { businessHours: null, timezone: null, defaultAssignee: null },
    rowVersion: 1,
    createdAt: '2026-10-01T10:00:00.000Z',
    ...over,
  };
}
