import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { list, summary } from '@/test/inbox-fixtures';
import { findConversationId } from './chat-api';

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '99999999-9999-4999-8999-999999999999';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('findConversationId', () => {
  it('searches the inbox by the digits of the number, in every status', async () => {
    const http = mockFetch(jsonResponse(200, list([])));
    await findConversationId({ id: CONTACT_ID, phone: '+91 98123-45678' });
    const url = new URL(http.calls[0]!.url);
    expect(url.pathname).toBe('/v2/inbox/conversations');
    expect(url.searchParams.get('q')).toBe('919812345678');
    expect(url.searchParams.get('status')).toBe('all');
  });

  it('returns the thread that belongs to this contact, not a look-alike', async () => {
    mockFetch(
      jsonResponse(
        200,
        list([
          summary({
            id: '33333333-3333-4333-8333-333333333333',
            contact: { id: OTHER_ID, name: 'Someone else' },
          }),
          summary({
            id: '44444444-4444-4444-8444-444444444444',
            contact: { id: CONTACT_ID, name: 'Aarav' },
          }),
        ]),
      ),
    );
    await expect(findConversationId({ id: CONTACT_ID, phone: '+919812345678' })).resolves.toBe(
      '44444444-4444-4444-8444-444444444444',
    );
  });

  it('returns null when the contact has no thread yet', async () => {
    mockFetch(jsonResponse(200, list([summary({ contact: { id: OTHER_ID, name: 'Someone' } })])));
    await expect(
      findConversationId({ id: CONTACT_ID, phone: '+919812345678' }),
    ).resolves.toBeNull();
  });

  it('does not ask the server when the number is missing or too short to search', async () => {
    const http = mockFetch(jsonResponse(200, list([])));
    await expect(findConversationId({ id: CONTACT_ID, phone: null })).resolves.toBeNull();
    await expect(findConversationId({ id: CONTACT_ID, phone: '12' })).resolves.toBeNull();
    expect(http.calls).toHaveLength(0);
  });
});
