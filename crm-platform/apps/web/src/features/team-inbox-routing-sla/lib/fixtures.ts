import type { RoutingRule } from '@crm/contracts';

export const U1 = '0b2f7c1e-6d1a-4f6e-9a55-3e2f0d7a1b11';
export const U2 = '1b2f7c1e-6d1a-4f6e-9a55-3e2f0d7a1b12';

/** A rule as the API returns it (keyword rule, round robin over two agents), with any field overridable. */
export function rule(over: Partial<RoutingRule> = {}): RoutingRule {
  return {
    id: '9b2f7c1e-6d1a-4f6e-9a55-3e2f0d7a1b99',
    name: 'Refund requests',
    description: 'Billing agents take refunds',
    conditions: {
      contactKind: 'any',
      contact: null,
      channelKinds: ['whatsapp_cloud'],
      keywords: { mode: 'any', words: ['refund', 'invoice'] },
      languages: [],
      businessHours: 'any',
    },
    assign: { strategy: 'round_robin', userIds: [U1, U2], teamIds: [], everyone: false },
    markSpam: false,
    priority: null,
    addTags: [],
    escalation: null,
    autoReply: null,
    triggerFlow: null,
    stopOnMatch: true,
    isActive: true,
    isFallback: false,
    appliesToAll: false,
    position: 1,
    firedCount: 12,
    lastFiredAt: '2026-10-05T09:30:00.000Z',
    unavailableTargets: 0,
    rowVersion: 3,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-05T09:30:00.000Z',
    ...over,
  };
}
