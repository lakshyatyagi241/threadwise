import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { aarav } from '@/test/contacts-fixtures';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { recordConsent } from './consent-api';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('consent api', () => {
  it('records a grant on a channel as a manual event, with the note and an idempotency key', async () => {
    const http = mockFetch(jsonResponse(201, { contactId: aarav.id, optedOut: false, states: [] }));
    const result = await recordConsent(
      aarav.id,
      { channel: 'whatsapp', action: 'granted', note: 'Said yes on a call' },
      'key-1',
    );
    expect(result.contactId).toBe(aarav.id);
    expect(new URL(http.calls[0]!.url).pathname).toBe(
      `/v2/contact-consent/contacts/${aarav.id}/events`,
    );
    expect(http.calls[0]?.init.method).toBe('POST');
    expect(http.calls[0]?.body).toEqual({
      channel: 'whatsapp',
      action: 'granted',
      note: 'Said yes on a call',
      source: 'manual',
    });
    expect(http.calls[0]?.headers['Idempotency-Key']).toBe('key-1');
  });

  it('records a withdrawal without a note', async () => {
    const http = mockFetch(jsonResponse(201, { contactId: aarav.id, optedOut: true }));
    await recordConsent(aarav.id, { channel: 'email', action: 'withdrawn' });
    expect(http.calls[0]?.body).toEqual({
      channel: 'email',
      action: 'withdrawn',
      source: 'manual',
    });
    expect(http.calls[0]?.headers['Idempotency-Key']).toEqual(expect.any(String));
  });
});
