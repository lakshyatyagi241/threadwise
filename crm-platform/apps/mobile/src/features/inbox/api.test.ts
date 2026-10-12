import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import {
  CONVERSATION_ID,
  detail,
  list,
  message,
  outgoing,
  summary,
  thread,
} from '@/test/inbox-fixtures';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import {
  fetchConversation,
  fetchConversations,
  fetchMessages,
  markConversationRead,
  retryMessage,
  sendTextMessage,
  setConversationStatus,
} from './api';
import { DEFAULT_FILTERS } from './filters';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('inbox api', () => {
  it('asks for the list with the tab and leaves the default status and empty search out', async () => {
    const http = mockFetch(jsonResponse(200, list([summary()])));
    await expect(
      fetchConversations({ ...DEFAULT_FILTERS, tab: 'mine' }, undefined),
    ).resolves.toMatchObject({ data: [{ title: 'Rohan Mehta' }] });
    const url = http.calls[0]?.url ?? '';
    expect(url).toContain('/v2/inbox/conversations?');
    expect(url).toContain('tab=mine');
    expect(url).toContain('limit=20');
    expect(url).not.toContain('status=');
    expect(url).not.toContain('q=');
    expect(url).not.toContain('cursor=');
  });

  it('sends the status, the search words and the cursor when they are set', async () => {
    const http = mockFetch(jsonResponse(200, list([])));
    await fetchConversations({ tab: 'unread', status: 'resolved', q: ' rohan ' }, 'c2');
    const url = http.calls[0]?.url ?? '';
    expect(url).toContain('status=resolved');
    expect(url).toContain('q=rohan');
    expect(url).toContain('cursor=c2');
    expect(url).toContain('tab=unread');
  });

  it('reads one conversation and a page of its messages, before a given seq', async () => {
    const http = mockFetch(
      jsonResponse(200, detail()),
      jsonResponse(200, thread([message(1)], false)),
      jsonResponse(200, thread([message(1)], false)),
    );
    await expect(fetchConversation(CONVERSATION_ID)).resolves.toMatchObject({ rowVersion: 4 });
    await fetchMessages(CONVERSATION_ID, undefined);
    await fetchMessages(CONVERSATION_ID, 31);
    expect(http.calls[0]?.url).toContain(`/v2/inbox/conversations/${CONVERSATION_ID}`);
    expect(http.calls[1]?.url).toContain(`/messages?limit=30`);
    expect(http.calls[1]?.url).not.toContain('before=');
    expect(http.calls[2]?.url).toContain('before=31');
  });

  it('sends a text message with the client id as body field and idempotency key', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const http = mockFetch(
      jsonResponse(202, outgoing(4, { clientMessageId: id, status: 'queued' })),
    );
    await expect(sendTextMessage(CONVERSATION_ID, id, 'Hello')).resolves.toMatchObject({ seq: 4 });
    const call = http.calls[0];
    expect(call?.init.method).toBe('POST');
    expect(call?.url).toContain(`/v2/inbox/conversations/${CONVERSATION_ID}/messages`);
    expect(call?.body).toEqual({ kind: 'text', clientMessageId: id, body: 'Hello' });
    expect(call?.headers['Idempotency-Key']).toBe(id);
  });

  it('marks read, sets the status and retries a message', async () => {
    const http = mockFetch(
      jsonResponse(200, { conversationId: CONVERSATION_ID, unreadCount: 0 }),
      jsonResponse(200, summary({ status: 'resolved', rowVersion: 5 })),
      jsonResponse(202, outgoing(4, { status: 'queued' })),
    );
    await markConversationRead(CONVERSATION_ID, 3);
    await setConversationStatus(CONVERSATION_ID, { rowVersion: 4, status: 'resolved' });
    await retryMessage('aaaaaaaa-aaaa-4aaa-8aaa-000000000004');
    expect(http.calls.map((c) => [c.init.method, c.url.split('/v2')[1], c.body])).toEqual([
      ['POST', `/inbox/conversations/${CONVERSATION_ID}/read`, { upToSeq: 3 }],
      [
        'POST',
        `/inbox/conversations/${CONVERSATION_ID}/status`,
        { rowVersion: 4, status: 'resolved' },
      ],
      ['POST', '/inbox/messages/aaaaaaaa-aaaa-4aaa-8aaa-000000000004/retry', undefined],
    ]);
  });
});
