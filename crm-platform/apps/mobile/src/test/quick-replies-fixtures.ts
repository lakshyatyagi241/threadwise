import type { SavedReply, SavedReplyListResponse, SessionResponse } from '@crm/contracts';
import { session as baseSession } from './dashboard-fixtures';

/** Realistic answers of the saved-replies endpoints, for tests. Fake names only. */

export const thanks: SavedReply = {
  id: '71111111-1111-4111-8111-111111111111',
  shortcut: 'thanks',
  title: 'Thanks for getting in touch',
  body: 'Hi {{first_name}}, thanks for reaching out. How can we help?',
  category: 'Greetings',
  language: 'en',
  channelKinds: ['whatsapp_cloud'],
  scope: 'shared',
  usedCount: 12,
  lastUsedAt: '2026-10-14T09:00:00.000Z',
  createdByName: 'Asha Verma',
  canEdit: true,
  rowVersion: 3,
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-10-10T08:00:00.000Z',
};

/** Personal and never used. */
export const myNote: SavedReply = {
  ...thanks,
  id: '72222222-2222-4222-8222-222222222222',
  shortcut: 'call_back',
  title: 'I will call you back',
  body: 'I will call you back today.',
  category: null,
  language: null,
  channelKinds: [],
  scope: 'mine',
  usedCount: 0,
  lastUsedAt: null,
  rowVersion: 1,
};

/** A shared reply the person may look at but not change. */
export const lockedReply: SavedReply = {
  ...thanks,
  id: '73333333-3333-4333-8333-333333333333',
  shortcut: 'refund_policy',
  title: 'Refund policy',
  body: 'Refunds take 5 working days.',
  usedCount: 1,
  canEdit: false,
};

export const listOf = (
  data: SavedReply[],
  over: Partial<SavedReplyListResponse> = {},
): SavedReplyListResponse => ({
  data,
  page: { nextCursor: null, hasMore: false, limit: 30 },
  counts: {
    all: data.length,
    shared: data.filter((r) => r.scope === 'shared').length,
    mine: data.filter((r) => r.scope === 'mine').length,
  },
  categories: ['Greetings'],
  total: data.length,
  limit: null,
  ...over,
});

/** A session that may manage saved replies. */
export const sessionManagesReplies: SessionResponse = {
  ...baseSession,
  permissions: { ...baseSession.permissions, 'inbox.savedreply.manage': 'all' },
};
