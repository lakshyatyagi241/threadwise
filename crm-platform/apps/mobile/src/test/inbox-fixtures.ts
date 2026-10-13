import type {
  ChannelResponse,
  ConversationSummary,
  InboxConversationDetail,
  ConversationListResponse,
  MessageListResponse,
  MessageResponse,
  SessionResponse,
} from '@crm/contracts';
import { session as baseSession } from '@/test/dashboard-fixtures';

/** Realistic answers of the inbox endpoints, for tests. Fake names and numbers only. */

export const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';

/** A person who can read, reply to and resolve conversations. */
export const inboxSession: SessionResponse = {
  ...baseSession,
  permissions: {
    ...baseSession.permissions,
    'inbox.conversation.read': 'all',
    'inbox.conversation.reply': 'all',
    'inbox.conversation.resolve': 'all',
  },
};

export const withPermissions = (keys: string[]): SessionResponse => ({
  ...baseSession,
  permissions: Object.fromEntries(keys.map((key) => [key, 'all' as const])),
});

export const summary = (over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: CONVERSATION_ID,
  channel: { id: CHANNEL_ID, kind: 'whatsapp_cloud', name: 'Support line' },
  peerKey: '919800000001',
  peerName: 'Rohan Mehta',
  title: 'Rohan Mehta',
  preview: 'Is my order on its way?',
  status: 'open',
  priority: 'normal',
  archived: false,
  pinned: false,
  muted: false,
  unreadCount: 0,
  needsContact: false,
  contact: null,
  assignment: { user: null, team: null, aiAgent: null },
  snoozedUntil: null,
  labels: [],
  lastMessageAt: '2026-10-11T09:30:00.000Z',
  lastInboundAt: '2026-10-11T09:30:00.000Z',
  lastOutboundAt: null,
  lastSeq: 3,
  windowExpiresAt: null,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-11T09:30:00.000Z',
  rowVersion: 4,
  ...over,
});

export const detail = (over: Partial<InboxConversationDetail> = {}): InboxConversationDetail => ({
  ...summary(),
  capabilities: {
    windowHours: 24,
    templates: true,
    media: ['image', 'document'],
    reactions: false,
    editDelete: false,
    receipts: ['sent', 'delivered', 'read'],
    typing: false,
  },
  window: { open: true, expiresAt: null },
  customerLanguage: null,
  waitingSince: null,
  firstResponseAt: null,
  resolvedAt: null,
  sla: { firstResponseDueAt: null, resolutionDueAt: null, breached: false },
  contactSummary: null,
  pastConversations: [],
  ...over,
});

export const message = (seq: number, over: Partial<MessageResponse> = {}): MessageResponse => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(seq).padStart(12, '0')}`,
  conversationId: CONVERSATION_ID,
  seq,
  direction: 'in',
  kind: 'text',
  sender: { kind: 'customer', userId: null, name: 'Rohan Mehta' },
  body: `Message number ${seq}`,
  media: null,
  location: null,
  template: null,
  status: 'received',
  failure: null,
  clientMessageId: null,
  replyToMessageId: null,
  reaction: null,
  isTranslated: false,
  translatedBody: null,
  detectedLanguage: null,
  starred: false,
  pinned: false,
  editedAt: null,
  deletedAt: null,
  providerAt: null,
  sentAt: null,
  deliveredAt: null,
  readAt: null,
  createdAt: '2026-10-11T09:30:00.000Z',
  ...over,
});

export const outgoing = (seq: number, over: Partial<MessageResponse> = {}): MessageResponse =>
  message(seq, {
    direction: 'out',
    sender: { kind: 'agent', userId: baseSession.user.id, name: 'Asha Verma' },
    status: 'sent',
    ...over,
  });

export const counts = { all: 5, mine: 2, unassigned: 3, unread: 1, archived: 0 };

export const list = (
  rows: ConversationSummary[],
  page: { hasMore?: boolean; nextCursor?: string | null } = {},
): ConversationListResponse => ({
  data: rows,
  page: {
    hasMore: page.hasMore ?? false,
    nextCursor: page.nextCursor ?? null,
    limit: 20,
  },
  meta: { counts },
});

export const thread = (rows: MessageResponse[], hasMoreBefore = false): MessageListResponse => ({
  data: rows,
  page: { hasMoreBefore, hasMoreAfter: false, limit: 30 },
});

/** A connected WhatsApp number, as `GET /channels` lists it. */
export const channelRow = (over: Partial<ChannelResponse> = {}): ChannelResponse => ({
  id: CHANNEL_ID,
  kind: 'whatsapp_cloud',
  name: 'Support line',
  status: 'connected',
  externalId: null,
  displayAddress: '+91 98000 00001',
  capabilities: {
    windowHours: 24,
    templates: true,
    media: ['image', 'document'],
    reactions: false,
    editDelete: false,
    receipts: ['sent', 'delivered', 'read'],
    typing: false,
  },
  settings: { metered: true },
  hasCredentials: true,
  credentialHints: {},
  webhookUrl: null,
  lastEventAt: null,
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
  rowVersion: 1,
  ...over,
});
