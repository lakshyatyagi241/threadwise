import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { callEntry, contactId, pageOf, systemEntry } from '@/test/contact-notes-fixtures';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { createContactActivity, listContactActivities } from './activity-api';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('contact activity api', () => {
  it('lists a page of the timeline with the limit and the cursor', async () => {
    const http = mockFetch(jsonResponse(200, pageOf([callEntry, systemEntry], 'cursor-2')));
    const result = await listContactActivities(contactId, { limit: 20, cursor: 'cursor-1' });
    expect(result.data.map((e) => e.source)).toEqual(['user', 'system']);
    expect(result.page.hasMore).toBe(true);
    const call = http.calls[0]!;
    const url = new URL(call.url);
    expect(url.pathname).toBe(`/v2/contacts/${contactId}/activities`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '20', cursor: 'cursor-1' });
    expect(call.init.method).toBe('GET');
  });

  it('refuses an entry with a source the app does not know', async () => {
    mockFetch(jsonResponse(200, pageOf([{ ...callEntry, source: 'alien' }])));
    await expect(listContactActivities(contactId, { limit: 20 })).rejects.toMatchObject({
      code: 'CLIENT_CONTRACT_MISMATCH',
    });
  });

  it('logs an entry with a POST that carries the idempotency key', async () => {
    const http = mockFetch(jsonResponse(201, callEntry));
    await createContactActivity(
      contactId,
      { activityType: 'call', title: 'Called about the demo', body: 'Booked for Friday.' },
      'key-1',
    );
    const call = http.calls[0]!;
    expect(new URL(call.url).pathname).toBe(`/v2/contacts/${contactId}/activities`);
    expect(call.init.method).toBe('POST');
    expect(call.body).toEqual({
      activityType: 'call',
      title: 'Called about the demo',
      body: 'Booked for Friday.',
    });
    expect(call.headers['Idempotency-Key']).toBe('key-1');
  });
});
