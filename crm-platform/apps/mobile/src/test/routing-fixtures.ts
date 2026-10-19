import type {
  InboxAssigneesResponse,
  RoutingRule,
  RoutingRuleListResponse,
  SessionResponse,
} from '@crm/contracts';
import { session as baseSession } from './dashboard-fixtures';

/** Realistic answers of the auto-assignment endpoints, for tests. Fake names only. */

export const ASHA = '91111111-1111-4111-8111-111111111111';
export const MEERA = '92222222-2222-4222-8222-222222222222';
export const SALES_TEAM = '93333333-3333-4333-8333-333333333333';

const base = {
  description: '',
  conditions: {
    contact: null,
    channelKinds: [],
    keywords: null,
    languages: [],
    businessHours: 'any' as const,
  },
  assign: null,
  markSpam: false,
  priority: null,
  addTags: [],
  escalation: null,
  autoReply: null,
  triggerFlow: null,
  stopOnMatch: true,
  isActive: true,
  isFallback: false,
  firedCount: 0,
  lastFiredAt: null,
  unavailableTargets: 0,
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-10-10T08:00:00.000Z',
};

/** Conditions on channel, words and business hours; round robin between two agents; an escalation, an auto reply and a tag. */
export const pricing: RoutingRule = {
  ...base,
  id: 'a1111111-1111-4111-8111-111111111111',
  name: 'Pricing questions',
  description: 'Send pricing chats to sales',
  conditions: {
    contact: null,
    channelKinds: ['whatsapp_cloud'],
    keywords: { mode: 'any', words: ['price', 'cost'] },
    languages: ['en'],
    businessHours: 'inside',
  },
  assign: { strategy: 'round_robin', userIds: [ASHA, MEERA], teamIds: [] },
  addTags: [{ name: 'Sales', color: null }],
  escalation: { minutes: 30, reassign: true, priority: 'high' },
  autoReply: { body: 'Thanks, we will reply soon.' },
  firedCount: 12,
  lastFiredAt: '2026-10-14T09:00:00.000Z',
  unavailableTargets: 1,
  position: 1,
  rowVersion: 3,
};

/** The fallback: no conditions, to a team, switched off. */
export const fallback: RoutingRule = {
  ...base,
  id: 'a2222222-2222-4222-8222-222222222222',
  name: 'Everyone else',
  assign: { strategy: 'least_busy', userIds: [], teamIds: [SALES_TEAM] },
  priority: 'normal',
  isActive: false,
  isFallback: true,
  position: 2,
  rowVersion: 1,
};

/** Marks spam and starts a flow that is switched off; keeps checking the rules after it. */
export const spamRule: RoutingRule = {
  ...base,
  id: 'a3333333-3333-4333-8333-333333333333',
  name: 'Obvious spam',
  conditions: { ...base.conditions, keywords: { mode: 'all', words: ['win', 'prize'] } },
  markSpam: true,
  triggerFlow: { id: 'b1111111-1111-4111-8111-111111111111', name: 'Welcome', isActive: false },
  stopOnMatch: false,
  firedCount: 1,
  position: 3,
  rowVersion: 2,
};

export const rulesOf = (
  data: RoutingRule[],
  over: Partial<RoutingRuleListResponse> = {},
): RoutingRuleListResponse => ({
  data,
  page: { nextCursor: null, hasMore: false, limit: 50 },
  total: data.length,
  limit: null,
  ...over,
});

export const assignees: InboxAssigneesResponse = {
  users: [
    {
      id: ASHA,
      name: 'Asha Verma',
      email: 'asha@example.test',
      availability: 'online',
      openConversations: 2,
      isMe: true,
      onLeave: null,
    },
    {
      id: MEERA,
      name: null,
      email: 'meera@example.test',
      availability: 'offline',
      openConversations: 0,
      isMe: false,
      onLeave: null,
    },
  ],
  teams: [
    {
      id: SALES_TEAM,
      name: 'Sales',
      color: null,
      memberCount: 3,
      assignmentStrategy: 'round_robin',
    },
  ],
};

const permissions = (...keys: string[]) => ({
  ...baseSession.permissions,
  ...Object.fromEntries(keys.map((k) => [k, 'all' as const])),
});

export const sessionManagesRouting: SessionResponse = {
  ...baseSession,
  permissions: permissions(
    'inbox.settings.read',
    'inbox.routing.manage',
    'inbox.conversation.read',
  ),
};

export const sessionReadsRouting: SessionResponse = {
  ...baseSession,
  permissions: permissions('inbox.settings.read', 'inbox.conversation.read'),
};
