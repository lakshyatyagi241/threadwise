import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { CONVERSATION_ID } from '@/test/inbox-fixtures';
import { fetchSavedReplies, fillSavedReply } from './saved-replies-api';

const REPLY_ID = 'dddddddd-0000-4000-8000-000000000001';
const reply = {
  id: REPLY_ID,
  shortcut: 'thanks',
  title: 'Thanks',
  body: 'Thank you {{first_name}}!',
  category: null,
  language: null,
  channelKinds: [],
  scope: 'shared',
  usedCount: 0,
  lastUsedAt: null,
  createdByName: null,
  canEdit: false,
  rowVersion: 1,
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
};

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('saved replies api', () => {
  it('asks for a page of replies, narrowed by the words and the channel kind, and leaves empty ones out', async () => {
    const http = mockFetch(
      jsonResponse(200, {
        data: [reply],
        page: { nextCursor: null, hasMore: false, limit: 20 },
        counts: { all: 1, shared: 1, mine: 0 },
        categories: [],
        total: 1,
        limit: null,
      }),
      jsonResponse(200, {
        data: [],
        page: { nextCursor: null, hasMore: false, limit: 20 },
        counts: { all: 0, shared: 0, mine: 0 },
        categories: [],
        total: 0,
        limit: null,
      }),
    );
    await expect(fetchSavedReplies(' thanks ', 'whatsapp_cloud')).resolves.toMatchObject({
      data: [{ shortcut: 'thanks' }],
    });
    await fetchSavedReplies('', undefined);
    const first = http.calls[0]?.url ?? '';
    expect(first).toContain('/v2/inbox/saved-replies?');
    expect(first).toContain('q=thanks');
    expect(first).toContain('channelKind=whatsapp_cloud');
    expect(first).toContain('limit=20');
    const second = http.calls[1]?.url ?? '';
    expect(second).not.toContain('q=');
    expect(second).not.toContain('channelKind=');
  });

  it('fills a reply in for the conversation, which sends nothing', async () => {
    const http = mockFetch(
      jsonResponse(200, { id: REPLY_ID, text: 'Thank you Rohan!', issues: [], usedCount: 1 }),
    );
    await expect(fillSavedReply(REPLY_ID, CONVERSATION_ID)).resolves.toMatchObject({
      text: 'Thank you Rohan!',
    });
    expect(http.calls[0]?.init.method).toBe('POST');
    expect(http.calls[0]?.url).toContain(`/v2/inbox/saved-replies/${REPLY_ID}/use`);
    expect(http.calls[0]?.body).toEqual({ conversationId: CONVERSATION_ID });
  });
});
