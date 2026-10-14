import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { contactId, pageOf } from '@/test/contact-notes-fixtures';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { listContactTasksForSummary } from './task-summary-api';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('contact task summary api', () => {
  it('asks the contact tasks route for every status, up to the limit', async () => {
    const http = mockFetch(jsonResponse(200, pageOf([])));
    await listContactTasksForSummary(contactId, 20);
    const call = http.calls[0]!;
    const url = new URL(call.url);
    expect(url.pathname).toBe(`/v2/contacts/${contactId}/tasks`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ status: 'all', limit: '20' });
    expect(call.init.method).toBe('GET');
  });
});
