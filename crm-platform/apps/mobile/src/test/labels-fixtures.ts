import type { InboxTag, InboxTagList, SessionResponse } from '@crm/contracts';
import { session as baseSession } from './dashboard-fixtures';

/** Realistic answers of the labels endpoints, for tests. Fake names only. */

export const vip: InboxTag = {
  id: '81111111-1111-4111-8111-111111111111',
  name: 'VIP',
  color: '#2563EB',
  description: 'Customers with a premium plan',
  conversationCount: 4,
  rowVersion: 2,
};

export const billing: InboxTag = {
  id: '82222222-2222-4222-8222-222222222222',
  name: 'Billing',
  color: null,
  description: null,
  conversationCount: 1,
  rowVersion: 1,
};

export const unused: InboxTag = {
  id: '83333333-3333-4333-8333-333333333333',
  name: 'Spare',
  color: 'tomato',
  description: null,
  conversationCount: 0,
  rowVersion: 1,
};

export const libraryOf = (data: InboxTag[]): InboxTagList => ({ data });

/** A session that may manage labels. */
export const sessionManagesLabels: SessionResponse = {
  ...baseSession,
  permissions: { ...baseSession.permissions, 'inbox.tag.manage': 'all' },
};
