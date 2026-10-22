import type { WspTeam } from '@crm/contracts';
import { agent, me } from './members-fixtures';

/** Realistic answers of the teams endpoints, for tests. */

export const sales: WspTeam = {
  id: 'c1111111-1111-4111-8111-111111111111',
  name: 'Sales',
  color: '#13478A',
  description: null,
  assignmentStrategy: 'round_robin',
  isDefault: false,
  sort: 1,
  deviceIds: [],
  parentId: null,
  depth: 1,
  lead: { id: me.id, fullName: me.fullName },
  receivesConversations: true,
  receivesRecords: true,
  isScopeBoundary: false,
  members: [
    {
      id: agent.id,
      fullName: agent.fullName,
      presence: 'online',
      isLead: false,
      role: 'member',
      isPrimary: true,
      capacity: 20,
    },
    {
      id: me.id,
      fullName: me.fullName,
      presence: 'away',
      isLead: true,
      role: 'lead',
      isPrimary: false,
      capacity: 20,
    },
  ],
  memberCount: 2,
  usage: { routingRules: 0, assignmentRules: 0, segmentShares: 0, childTeams: 0, conversations: 0 },
  unusedSettings: { businessHours: null, timezone: null, defaultAssignee: null },
  rowVersion: 4,
  createdAt: '2026-09-03T08:00:00.000Z',
};

export const support: WspTeam = {
  ...sales,
  id: 'c2222222-2222-4222-8222-222222222222',
  name: 'Support',
  color: 'teal',
  assignmentStrategy: 'manual',
  isDefault: true,
  deviceIds: ['d1111111-1111-4111-8111-111111111111', 'd2222222-2222-4222-8222-222222222222'],
  members: [],
  lead: null,
  memberCount: 0,
  rowVersion: 1,
};

export const teamPageOf = (data: WspTeam[]) => ({
  data,
  page: { nextCursor: null, hasMore: false, limit: 50 },
});
