import type { NotificationListResponse, NotificationResponse } from '@crm/contracts';

/** Realistic answers of the notifications endpoints, for tests. Fake names only. */

export const CONVERSATION_ID = '71111111-1111-4111-8111-111111111111';
export const TASK_ID = '72222222-2222-4222-8222-222222222222';
export const CONTACT_ID = '73333333-3333-4333-8333-333333333333';

const base = {
  link: null,
  body: null,
  data: null,
  readAt: null,
} satisfies Partial<NotificationResponse>;

/** Three new messages on a chat: unread, opens the thread. */
export const newMessage: NotificationResponse = {
  ...base,
  id: '81111111-1111-4111-8111-111111111111',
  type: 'new_message',
  title: '3 new messages from Aarav Sharma',
  data: {
    conversationId: CONVERSATION_ID,
    contactName: 'Aarav Sharma',
    preview: 'Is the demo on Friday?',
    count: 3,
  },
  count: 3,
  subject: { kind: 'conversation', id: CONVERSATION_ID },
  createdAt: '2026-10-16T09:00:00.000Z',
};

/** A task assigned to the person: already read, opens the task. */
export const taskAssigned: NotificationResponse = {
  ...base,
  id: '82222222-2222-4222-8222-222222222222',
  type: 'task_assigned',
  title: 'Task assigned to you',
  link: `/tasks?task=${TASK_ID}`,
  data: { taskId: TASK_ID, taskTitle: 'Send the contract', actorName: 'Meera Nair', dueAt: null },
  readAt: '2026-10-16T09:30:00.000Z',
  createdAt: '2026-10-15T08:00:00.000Z',
};

/** A lead: opens the contact. */
export const newLead: NotificationResponse = {
  ...base,
  id: '83333333-3333-4333-8333-333333333333',
  type: 'new_lead',
  title: 'New lead',
  data: {
    contactId: CONTACT_ID,
    contactName: 'Riya Kapoor',
    platform: 'Facebook',
    returning: false,
  },
  createdAt: '2026-10-10T08:00:00.000Z',
};

/** A device that dropped: the app has no device screen, so the row opens nothing. */
export const deviceDown: NotificationResponse = {
  ...base,
  id: '84444444-4444-4444-8444-444444444444',
  type: 'device_disconnected',
  title: 'Sales line disconnected',
  data: { deviceName: 'Sales line' },
  createdAt: '2026-10-01T08:00:00.000Z',
};

/** A type from a newer server that this build has no words for: the server's English shows. */
export const futureType: NotificationResponse = {
  ...base,
  id: '85555555-5555-4555-8555-555555555555',
  type: 'quote_expired',
  title: 'Quote expired',
  body: 'The quote for Acme expired today.',
  createdAt: '2026-10-16T07:00:00.000Z',
};

export const feed = [newMessage, futureType, taskAssigned, newLead, deviceDown];

export function notificationPage(
  rows: NotificationResponse[],
  options: { nextCursor?: string; unread?: number } = {},
): NotificationListResponse {
  return {
    data: rows,
    page: {
      nextCursor: options.nextCursor ?? null,
      hasMore: options.nextCursor !== undefined,
      limit: 30,
    },
    meta: { unread: options.unread ?? rows.filter((r) => r.readAt === null).length },
  };
}
