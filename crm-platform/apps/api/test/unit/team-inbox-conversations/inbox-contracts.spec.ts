import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  assignConversationSchema,
  conversationEventSchema,
  createConversationNoteSchema,
  inboxMediaUploadSchema,
  listConversationsQuerySchema,
  sendMessageSchema,
} from '@crm/contracts';

const uuid = '6f1c7a52-3d7a-4a53-9b6e-2f0d2c1a9e10';
const other = '0a5c1d92-1f64-4f9b-8a0e-0e8b6f5a77f1';

describe('assign body', () => {
  it('needs a user, a team, or an explicit null for one of them', () => {
    expect(assignConversationSchema.safeParse({ rowVersion: 1 }).success).toBe(false);
    expect(assignConversationSchema.safeParse({ rowVersion: 1, userId: uuid }).success).toBe(true);
    expect(assignConversationSchema.safeParse({ rowVersion: 1, userId: null }).success).toBe(true);
    expect(assignConversationSchema.safeParse({ rowVersion: 1, teamId: other }).success).toBe(true);
    expect(assignConversationSchema.safeParse({ rowVersion: 1, teamId: null }).success).toBe(true);
  });

  it('defaults the strategy to manual and refuses one that does not exist yet', () => {
    const ok = assignConversationSchema.parse({ rowVersion: 2, userId: uuid });
    expect(ok.strategy).toBe('manual');
    expect(
      assignConversationSchema.safeParse({ rowVersion: 2, userId: uuid, strategy: 'round_robin' })
        .success,
    ).toBe(false);
  });

  it('keeps an omitted field omitted (leave alone) and a null field null (clear)', () => {
    const teamOnly = assignConversationSchema.parse({ rowVersion: 1, teamId: other });
    expect(teamOnly.userId).toBeUndefined();
    const clear = assignConversationSchema.parse({ rowVersion: 1, userId: null });
    expect(clear.userId).toBeNull();
    expect(clear.teamId).toBeUndefined();
  });

  it('rejects ids that are not uuids and a missing version', () => {
    expect(assignConversationSchema.safeParse({ rowVersion: 1, userId: '12' }).success).toBe(false);
    expect(assignConversationSchema.safeParse({ userId: uuid }).success).toBe(false);
  });
});

describe('list query', () => {
  it('reads archived from a query string: "false" means false', () => {
    expect(listConversationsQuerySchema.parse({}).archived).toBe(false);
    expect(listConversationsQuerySchema.parse({ archived: 'false' }).archived).toBe(false);
    expect(listConversationsQuerySchema.parse({ archived: '0' }).archived).toBe(false);
    expect(listConversationsQuerySchema.parse({ archived: 'true' }).archived).toBe(true);
    expect(listConversationsQuerySchema.parse({ archived: '1' }).archived).toBe(true);
    expect(listConversationsQuerySchema.safeParse({ archived: 'maybe' }).success).toBe(false);
  });

  it('defaults the tab to all, trims the search, and refuses an unknown tab or an empty search', () => {
    expect(listConversationsQuerySchema.parse({}).tab).toBe('all');
    expect(listConversationsQuerySchema.parse({ q: '  acme ' }).q).toBe('acme');
    expect(listConversationsQuerySchema.safeParse({ tab: 'mentions' }).success).toBe(false);
    expect(listConversationsQuerySchema.safeParse({ q: '   ' }).success).toBe(false);
  });
});

describe('notes, events, uploads and the error codes', () => {
  it('a note needs text and at most 20 mentions that are uuids', () => {
    expect(createConversationNoteSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(createConversationNoteSchema.parse({ body: ' hello ' })).toEqual({
      body: 'hello',
      mentions: [],
    });
    expect(createConversationNoteSchema.safeParse({ body: 'x', mentions: ['sara'] }).success).toBe(
      false,
    );
    expect(
      createConversationNoteSchema.safeParse({ body: 'x', mentions: Array(21).fill(uuid) }).success,
    ).toBe(false);
  });

  it('the timeline actor is one of five kinds, the id a uuid', () => {
    const base = {
      id: uuid,
      conversationId: other,
      type: 'assigned',
      payload: {},
      createdAt: '2026-10-02T10:00:00.000Z',
    };
    expect(
      conversationEventSchema.safeParse({
        ...base,
        actor: { kind: 'user', userId: uuid, name: 'A' },
      }).success,
    ).toBe(true);
    expect(
      conversationEventSchema.safeParse({
        ...base,
        actor: { kind: 'human', userId: null, name: null },
      }).success,
    ).toBe(false);
  });

  it('an upload answer names a media kind the send accepts, and a media send names it by uuid', () => {
    const up = {
      id: uuid,
      kind: 'image',
      mime: 'image/png',
      name: 'a.png',
      sizeBytes: 3,
      previewUrl: '/api/v2/media/x',
      expiresAt: '2026-10-03T10:00:00.000Z',
    };
    expect(inboxMediaUploadSchema.safeParse(up).success).toBe(true);
    expect(inboxMediaUploadSchema.safeParse({ ...up, kind: 'sticker' }).success).toBe(false);
    expect(
      sendMessageSchema.safeParse({ kind: 'media', clientMessageId: uuid, mediaId: 'abc' }).success,
    ).toBe(false);
    expect(
      sendMessageSchema.safeParse({
        kind: 'media',
        clientMessageId: uuid,
        mediaId: other,
        caption: 'hi',
      }).success,
    ).toBe(true);
  });

  it('registers the codes the inbox answers with', () => {
    const codes = [
      'CONVERSATION_NOTE_NOT_FOUND',
      'INBOX_TEMPLATES_UNAVAILABLE',
      'INBOX_NOTE_NOT_DELETABLE',
      'CONVERSATION_NOT_FOUND',
      'CONVERSATION_STATUS_INVALID',
      'CONVERSATION_ASSIGNEE_INVALID',
      'SERVICE_WINDOW_CLOSED',
      'PLAN_LIMIT_REACHED',
      'CHANNEL_DISCONNECTED',
    ];
    for (const code of codes)
      expect(ERROR_CODES[code as keyof typeof ERROR_CODES], code).toBe(code);
  });
});
