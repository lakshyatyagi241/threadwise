import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { listContactViews } from './views-api';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('listContactViews', () => {
  it('asks for the saved views in one page and reads them', async () => {
    const view = {
      id: '77777777-7777-4777-8777-777777777777',
      name: 'Pune leads',
      filter: { op: 'and' },
      position: 0,
      isShared: false,
      shareMode: 'me',
      accessType: 'can_edit',
      sharedWith: [],
      canEdit: true,
      canManage: true,
      createdBy: null,
      isFavorite: true,
      rowVersion: 1,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
    const http = mockFetch(
      jsonResponse(200, { data: [view], page: { nextCursor: null, hasMore: false, limit: 200 } }),
    );
    const result = await listContactViews();
    expect(result.data[0]?.name).toBe('Pune leads');
    const url = new URL(http.calls[0]!.url);
    expect(url.pathname).toBe('/v2/contact-views');
    expect(url.searchParams.get('limit')).toBe('200');
  });

  it('refuses an answer that is not a page of views', async () => {
    mockFetch(jsonResponse(200, { data: [{ nope: true }], page: {} }));
    await expect(listContactViews()).rejects.toMatchObject({ code: 'CLIENT_CONTRACT_MISMATCH' });
  });
});
