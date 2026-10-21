import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { contactId } from '@/test/contact-notes-fixtures';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { getContactMessageStats } from './message-stats-api';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

const stats = { sent: 12, delivered: 10, seen: 7, received: 5, failed: 1, replied: 4 };

describe('contact message stats api', () => {
  it("reads the contact's WhatsApp summary from the stats route", async () => {
    const http = mockFetch(jsonResponse(200, stats));
    await expect(getContactMessageStats(contactId)).resolves.toEqual(stats);
    const call = http.calls[0]!;
    expect(new URL(call.url).pathname).toBe(`/v2/contacts/${contactId}/message-stats/whatsapp`);
    expect(call.init.method).toBe('GET');
  });

  it('refuses an answer that is not the summary', async () => {
    mockFetch(jsonResponse(200, { sent: 'many' }));
    await expect(getContactMessageStats(contactId)).rejects.toMatchObject({
      code: 'CLIENT_CONTRACT_MISMATCH',
    });
  });
});
