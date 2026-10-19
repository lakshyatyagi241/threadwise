import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { listOf, myNote, thanks } from '@/test/quick-replies-fixtures';
import {
  createQuickReply,
  deleteQuickReply,
  duplicateQuickReply,
  fetchQuickReplies,
  fetchQuickReply,
  updateQuickReply,
} from './quick-replies-api';

const url = (call: { url: string } | undefined) => new URL(call?.url ?? 'http://x');

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('the saved replies API', () => {
  it('asks for a page with only the filters that are set', async () => {
    const http = mockFetch(
      jsonResponse(200, listOf([thanks])),
      jsonResponse(200, listOf([myNote])),
    );
    await expect(fetchQuickReplies({ scope: 'all', q: '  ' }, undefined)).resolves.toMatchObject({
      total: 1,
    });
    await fetchQuickReplies({ scope: 'mine', q: ' call ' }, 'cursor-1');
    expect(url(http.calls[0]).pathname).toBe('/v2/inbox/saved-replies');
    expect([...url(http.calls[0]).searchParams.keys()]).toEqual(['limit']);
    expect(Object.fromEntries(url(http.calls[1]).searchParams)).toEqual({
      scope: 'mine',
      q: 'call',
      limit: '30',
      cursor: 'cursor-1',
    });
  });

  it('reads one reply by id', async () => {
    const http = mockFetch(jsonResponse(200, thanks));
    await expect(fetchQuickReply(thanks.id)).resolves.toMatchObject({ shortcut: 'thanks' });
    expect(url(http.calls[0]).pathname).toBe(`/v2/inbox/saved-replies/${thanks.id}`);
  });

  it('creates, updates, duplicates and deletes with the right method, route and body', async () => {
    const http = mockFetch(
      jsonResponse(201, thanks),
      jsonResponse(200, thanks),
      jsonResponse(201, myNote),
      new Response(null, { status: 204 }),
    );
    await createQuickReply({
      shortcut: 'thanks',
      title: 'Thanks',
      body: 'Hi',
      category: null,
      language: null,
      channelKinds: [],
      scope: 'shared',
    });
    await updateQuickReply(thanks.id, { rowVersion: 3, title: 'Changed' });
    await duplicateQuickReply(thanks.id);
    await deleteQuickReply(thanks.id);
    expect(http.calls.map((c) => [c.init.method, url(c).pathname])).toEqual([
      ['POST', '/v2/inbox/saved-replies'],
      ['PATCH', `/v2/inbox/saved-replies/${thanks.id}`],
      ['POST', `/v2/inbox/saved-replies/${thanks.id}/duplicate`],
      ['DELETE', `/v2/inbox/saved-replies/${thanks.id}`],
    ]);
    expect(http.calls[1]?.body).toEqual({ rowVersion: 3, title: 'Changed' });
  });

  it('refuses an answer in a shape this build does not understand', async () => {
    mockFetch(jsonResponse(200, { data: 'nope' }));
    await expect(fetchQuickReplies({ scope: 'all', q: '' }, undefined)).rejects.toMatchObject({
      code: 'CLIENT_CONTRACT_MISMATCH',
    });
  });
});
