import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { contactDeals, contactId } from '@/test/contact-notes-fixtures';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { listContactDeals } from './deals-api';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('contact deals api', () => {
  it('reads the contact deals route', async () => {
    const http = mockFetch(jsonResponse(200, contactDeals));
    const result = await listContactDeals(contactId);
    expect(result.deals).toHaveLength(1);
    expect(result.rollup.wonCount).toBe(2);
    expect(new URL(http.calls[0]!.url).pathname).toBe(`/v2/contacts/${contactId}/deals`);
  });

  it('refuses an answer that is not the deals shape', async () => {
    mockFetch(jsonResponse(200, { deals: [{ id: 'x' }] }));
    await expect(listContactDeals(contactId)).rejects.toMatchObject({
      code: 'CLIENT_CONTRACT_MISMATCH',
    });
  });

  it('keeps a contact id from leaving its place in the path', async () => {
    const http = mockFetch(jsonResponse(200, contactDeals));
    await listContactDeals('x/../../tasks');
    expect(new URL(http.calls[0]!.url).pathname).toBe('/v2/contacts/x%2F..%2F..%2Ftasks/deals');
  });
});
