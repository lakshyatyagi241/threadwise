import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { CONVERSATION_ID, summary } from '@/test/inbox-fixtures';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { applyLabel, fetchLabelLibrary, withdrawLabel } from './labels-api';

const VIP = { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'VIP', color: '#7B5A14' };

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('inbox labels api', () => {
  it("reads the workspace's labels from the inbox, not from the contact tags", async () => {
    const http = mockFetch(
      jsonResponse(200, {
        data: [{ ...VIP, description: null, conversationCount: 3, rowVersion: 2 }],
      }),
    );
    await expect(fetchLabelLibrary()).resolves.toMatchObject([
      { name: 'VIP', conversationCount: 3 },
    ]);
    expect(http.calls[0]?.url).toContain('/v2/inbox/labels');
    expect(http.calls[0]?.url).not.toContain('/v2/tags');
  });

  it('puts a label on the conversation by id or by name, and gets the conversation back', async () => {
    const http = mockFetch(
      jsonResponse(200, summary({ labels: [VIP], rowVersion: 5 })),
      jsonResponse(200, summary({ labels: [VIP], rowVersion: 6 })),
    );
    await expect(applyLabel(CONVERSATION_ID, { tagId: VIP.id }, 'key-1')).resolves.toMatchObject({
      labels: [{ name: 'VIP' }],
      rowVersion: 5,
    });
    await applyLabel(CONVERSATION_ID, { name: 'Hot' });
    expect(http.calls.map((c) => [c.init.method, c.url.split('/v2')[1], c.body])).toEqual([
      ['POST', `/inbox/conversations/${CONVERSATION_ID}/labels`, { tagId: VIP.id }],
      ['POST', `/inbox/conversations/${CONVERSATION_ID}/labels`, { name: 'Hot' }],
    ]);
  });

  it('takes a label off the conversation', async () => {
    const http = mockFetch(jsonResponse(200, summary({ labels: [], rowVersion: 7 })));
    await expect(withdrawLabel(CONVERSATION_ID, VIP.id)).resolves.toMatchObject({ labels: [] });
    expect(http.calls[0]?.init.method).toBe('DELETE');
    expect(http.calls[0]?.url).toContain(
      `/v2/inbox/conversations/${CONVERSATION_ID}/labels/${VIP.id}`,
    );
  });
});
