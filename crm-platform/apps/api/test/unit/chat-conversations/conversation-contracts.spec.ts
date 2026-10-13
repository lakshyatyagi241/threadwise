import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  MESSAGE_STATUSES,
  canAdvanceMessageStatus,
  conversationListResponseSchema,
  conversationStatusSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  messageResponseSchema,
  sendMessageSchema,
  type MessageStatus,
} from '@crm/contracts';

const uuid = '6f1c7a52-3d7a-4a53-9b6e-2f0d2c1a9e10';
const now = '2026-10-02T10:00:00.000Z';

describe('receipt rule (canAdvanceMessageStatus)', () => {
  const forward: Array<[MessageStatus, MessageStatus]> = [
    ['queued', 'sent'],
    ['queued', 'delivered'],
    ['queued', 'read'],
    ['sent', 'delivered'],
    ['sent', 'read'],
    ['delivered', 'read'],
    ['queued', 'failed'],
    ['sent', 'failed'],
  ];
  it.each(forward)('%s -> %s advances', (from, to) => {
    expect(canAdvanceMessageStatus(from, to)).toBe(true);
  });

  const refused: Array<[MessageStatus, MessageStatus]> = [
    ['read', 'delivered'],
    ['delivered', 'sent'],
    ['sent', 'queued'],
    ['sent', 'sent'],
    ['read', 'read'],
    ['delivered', 'failed'],
    ['read', 'failed'],
    ['failed', 'sent'],
    ['failed', 'read'],
    ['failed', 'failed'],
    ['received', 'read'],
    ['queued', 'received'],
  ];
  it.each(refused)('%s -> %s is ignored', (from, to) => {
    expect(canAdvanceMessageStatus(from, to)).toBe(false);
  });

  it('out-of-order receipts (read, delivered, sent) settle on read', () => {
    let status: MessageStatus = 'queued';
    for (const receipt of ['read', 'delivered', 'sent'] as const) {
      if (canAdvanceMessageStatus(status, receipt)) status = receipt;
    }
    expect(status).toBe('read');
  });

  it('knows every status the table allows', () => {
    expect([...MESSAGE_STATUSES]).toEqual([
      'received',
      'queued',
      'sent',
      'delivered',
      'read',
      'failed',
    ]);
  });
});

describe('conversation statuses', () => {
  it('is the lifecycle the database allows, closed included', () => {
    expect(conversationStatusSchema.options).toEqual([
      'open',
      'pending',
      'snoozed',
      'resolved',
      'closed',
      'spam',
    ]);
  });
});

describe('sendMessageSchema', () => {
  it('needs a client message id and trims the text', () => {
    const ok = sendMessageSchema.parse({ kind: 'text', clientMessageId: uuid, body: '  hello ' });
    expect(ok).toMatchObject({ kind: 'text', body: 'hello' });
    expect(sendMessageSchema.safeParse({ kind: 'text', body: 'hello' }).success).toBe(false);
  });

  it('refuses an empty or oversized text and unknown kinds', () => {
    expect(
      sendMessageSchema.safeParse({ kind: 'text', clientMessageId: uuid, body: '   ' }).success,
    ).toBe(false);
    expect(
      sendMessageSchema.safeParse({
        kind: 'text',
        clientMessageId: uuid,
        body: 'x'.repeat(100_001),
      }).success,
    ).toBe(false);
    expect(sendMessageSchema.safeParse({ kind: 'sticker', clientMessageId: uuid }).success).toBe(
      false,
    );
  });

  it('media references an upload by id; a template carries its variables', () => {
    expect(
      sendMessageSchema.safeParse({ kind: 'media', clientMessageId: uuid, mediaId: 'not-a-uuid' })
        .success,
    ).toBe(false);
    expect(
      sendMessageSchema.parse({
        kind: 'media',
        clientMessageId: uuid,
        mediaId: uuid,
        caption: 'see',
      }),
    ).toMatchObject({
      kind: 'media',
    });
    expect(
      sendMessageSchema.parse({ kind: 'template', clientMessageId: uuid, templateId: uuid }),
    ).toMatchObject({
      variables: {},
    });
  });
});

describe('list queries', () => {
  it('conversations: cursor pagination with the platform defaults', () => {
    expect(listConversationsQuerySchema.parse({})).toMatchObject({
      limit: 50,
      order: 'desc',
      tab: 'all',
      archived: false,
    });
    expect(listConversationsQuerySchema.safeParse({ tab: 'everyone' }).success).toBe(false);
    expect(listConversationsQuerySchema.parse({ status: 'all', q: ' asha ' })).toMatchObject({
      q: 'asha',
    });
  });

  it('messages: before or afterSeq, never both', () => {
    expect(listMessagesQuerySchema.parse({ before: '10', limit: '20' })).toMatchObject({
      before: 10,
      limit: 20,
    });
    expect(listMessagesQuerySchema.safeParse({ before: 10, afterSeq: 5 }).success).toBe(false);
    expect(listMessagesQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});

describe('response shapes', () => {
  const message = {
    id: uuid,
    conversationId: uuid,
    seq: 1,
    direction: 'in',
    kind: 'text',
    sender: { kind: 'customer', userId: null, name: null },
    body: 'hi',
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
    providerAt: now,
    sentAt: null,
    deliveredAt: null,
    readAt: null,
    createdAt: now,
  };

  it('accepts a stored inbound message and never carries internal ids', () => {
    expect(messageResponseSchema.parse(message)).toEqual(message);
    expect(Object.keys(message)).not.toContain('org_id');
  });

  it('a list response is the platform envelope plus the tab counts', () => {
    const summary = {
      id: uuid,
      channel: { id: uuid, kind: 'webchat', name: 'Site' },
      peerKey: 'v-1',
      peerName: null,
      title: 'Visitor',
      preview: null,
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
      lastMessageAt: null,
      lastInboundAt: null,
      lastOutboundAt: null,
      lastSeq: 0,
      windowExpiresAt: null,
      createdAt: now,
      updatedAt: now,
      rowVersion: 1,
    };
    const res = conversationListResponseSchema.parse({
      data: [summary],
      page: { nextCursor: null, hasMore: false, limit: 50 },
      meta: { counts: { all: 1, mine: 0, unassigned: 1, unread: 0, archived: 0 } },
    });
    expect(res.data[0]?.channel.kind).toBe('webchat');
  });
});

describe('error codes', () => {
  it('registers the conversation codes next to the channel and platform ones', () => {
    expect(ERROR_CODES.CONVERSATION_NOT_FOUND).toBe('CONVERSATION_NOT_FOUND');
    expect(ERROR_CODES.MESSAGE_NOT_RETRYABLE).toBe('MESSAGE_NOT_RETRYABLE');
    expect(ERROR_CODES.CHANNEL_DISCONNECTED).toBe('CHANNEL_DISCONNECTED');
    expect(ERROR_CODES.SERVICE_WINDOW_CLOSED).toBe('SERVICE_WINDOW_CLOSED');
    expect(ERROR_CODES.PLAN_LIMIT_REACHED).toBe('PLAN_LIMIT_REACHED');
  });
});
