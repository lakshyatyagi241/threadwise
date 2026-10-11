import type {
  InboxConversationDetail,
  ConversationNote,
  ConversationSummary,
  MessageResponse,
} from '@crm/contracts';

/** Builders for the tests: a conversation, a message and a note with every required field, overridable one by one. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const id = uuid;

export function summary(over: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: uuid(1),
    channel: { id: uuid(900), kind: 'simulator', name: 'Simulator' },
    peerKey: '919876543210',
    peerName: 'Asha Verma',
    title: 'Asha Verma',
    preview: 'Hello there',
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
    lastMessageAt: '2026-10-02T10:00:00.000Z',
    lastInboundAt: '2026-10-02T10:00:00.000Z',
    lastOutboundAt: null,
    lastSeq: 1,
    windowExpiresAt: '2026-10-03T10:00:00.000Z',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    rowVersion: 1,
    ...over,
  };
}

export function detail(over: Partial<InboxConversationDetail> = {}): InboxConversationDetail {
  return {
    ...summary(),
    capabilities: {
      windowHours: 24,
      templates: true,
      media: ['image', 'document', 'audio', 'location'],
      reactions: true,
      editDelete: false,
      receipts: ['sent', 'delivered', 'read'],
      typing: true,
    },
    window: { open: true, expiresAt: '2026-10-03T10:00:00.000Z' },
    customerLanguage: null,
    waitingSince: null,
    firstResponseAt: null,
    resolvedAt: null,
    sla: { firstResponseDueAt: null, resolutionDueAt: null, breached: false },
    contactSummary: null,
    pastConversations: [],
    ...over,
  };
}

export function message(seq: number, over: Partial<MessageResponse> = {}): MessageResponse {
  return {
    id: uuid(1000 + seq),
    conversationId: uuid(1),
    seq,
    direction: 'in',
    kind: 'text',
    sender: { kind: 'customer', userId: null, name: null },
    body: `message ${seq}`,
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
    createdAt: `2026-10-02T10:${String(seq).padStart(2, '0')}:00.000Z`,
    ...over,
  };
}

export function outbound(seq: number, over: Partial<MessageResponse> = {}): MessageResponse {
  return message(seq, {
    direction: 'out',
    status: 'queued',
    sender: { kind: 'agent', userId: uuid(7), name: 'Nikhil' },
    clientMessageId: uuid(2000 + seq),
    ...over,
  });
}

export function note(
  n: number,
  createdAt: string,
  over: Partial<ConversationNote> = {},
): ConversationNote {
  return {
    id: uuid(3000 + n),
    conversationId: uuid(1),
    author: { userId: uuid(7), name: 'Nikhil' },
    body: `note ${n}`,
    mentions: [],
    isPinned: false,
    editedAt: null,
    createdAt,
    rowVersion: 1,
    ...over,
  };
}
