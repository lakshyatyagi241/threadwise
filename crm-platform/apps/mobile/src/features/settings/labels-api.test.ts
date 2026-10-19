import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { billing, libraryOf, vip } from '@/test/labels-fixtures';
import { createLabel, deleteLabel, fetchLabelList, updateLabel } from './labels-api';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('the labels API', () => {
  it('reads the whole library', async () => {
    const http = mockFetch(jsonResponse(200, libraryOf([vip, billing])));
    await expect(fetchLabelList()).resolves.toMatchObject({
      data: [{ name: 'VIP' }, { name: 'Billing' }],
    });
    expect(http.calls[0]?.url).toBe('http://api.test/v2/inbox/labels');
  });

  it('creates, updates and deletes with the right method, route and body', async () => {
    const http = mockFetch(
      jsonResponse(201, vip),
      jsonResponse(200, vip),
      new Response(null, { status: 204 }),
    );
    await createLabel({ name: 'VIP', color: '#2563EB' });
    await updateLabel(vip.id, { rowVersion: 2, name: 'Very important' });
    await deleteLabel(vip.id);
    expect(http.calls.map((c) => [c.init.method, new URL(c.url).pathname])).toEqual([
      ['POST', '/v2/inbox/labels'],
      ['PATCH', `/v2/inbox/labels/${vip.id}`],
      ['DELETE', `/v2/inbox/labels/${vip.id}`],
    ]);
    expect(http.calls[0]?.body).toEqual({ name: 'VIP', color: '#2563EB' });
    expect(http.calls[1]?.body).toEqual({ rowVersion: 2, name: 'Very important' });
  });

  it('refuses an answer in a shape this build does not understand', async () => {
    mockFetch(jsonResponse(200, { data: [{ id: 1 }] }));
    await expect(fetchLabelList()).rejects.toMatchObject({ code: 'CLIENT_CONTRACT_MISMATCH' });
  });
});
