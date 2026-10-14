import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { contactId, meetingA, meetingB, pageOf } from '@/test/contact-notes-fixtures';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { listContactMeetings } from './meetings-api';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('contact meetings api', () => {
  it('lists a page of meetings with the limit and the cursor', async () => {
    const http = mockFetch(jsonResponse(200, pageOf([meetingA, meetingB], 'cursor-2')));
    const result = await listContactMeetings(contactId, { limit: 20, cursor: 'cursor-1' });
    expect(result.data.map((m) => m.id)).toEqual([meetingA.id, meetingB.id]);
    expect(result.page).toEqual({ nextCursor: 'cursor-2', hasMore: true, limit: 20 });
    const call = http.calls[0]!;
    const url = new URL(call.url);
    expect(url.pathname).toBe(`/v2/contacts/${contactId}/meetings`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '20', cursor: 'cursor-1' });
    expect(call.init.method).toBe('GET');
    expect(call.headers.Authorization).toBe('Bearer access-1');
  });

  it('leaves the cursor out of the first page', async () => {
    const http = mockFetch(jsonResponse(200, pageOf([])));
    await listContactMeetings(contactId, { limit: 20 });
    expect(Object.fromEntries(new URL(http.calls[0]!.url).searchParams)).toEqual({ limit: '20' });
  });

  it('refuses an answer that is not a page of meetings', async () => {
    mockFetch(jsonResponse(200, { data: [{ id: 'not-a-meeting' }], page: {} }));
    await expect(listContactMeetings(contactId, { limit: 20 })).rejects.toMatchObject({
      code: 'CLIENT_CONTRACT_MISMATCH',
    });
  });

  it('keeps a contact id from leaving its place in the path', async () => {
    const http = mockFetch(jsonResponse(200, pageOf([])));
    await listContactMeetings('x/../../tasks', { limit: 20 });
    expect(new URL(http.calls[0]!.url).pathname).toBe('/v2/contacts/x%2F..%2F..%2Ftasks/meetings');
  });

  it('fails with the offline code when there is no connection', async () => {
    mockFetch(new TypeError('Network request failed'));
    await expect(listContactMeetings(contactId, { limit: 20 })).rejects.toMatchObject({
      code: 'CLIENT_NETWORK',
    });
  });
});
