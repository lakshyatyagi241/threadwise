import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { prefItem, prefsOf } from '@/test/preferences-fixtures';
import { fetchPreferences, fetchPushDeployment, savePreferences } from './preferences-api';

const url = (call: { url: string } | undefined) => new URL(call?.url ?? 'http://x');

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('the notification preferences API', () => {
  it('reads the preferences', async () => {
    const http = mockFetch(jsonResponse(200, prefsOf(prefItem('new_chat'))));
    await expect(fetchPreferences()).resolves.toMatchObject({ items: [{ type: 'new_chat' }] });
    expect(url(http.calls[0]).pathname).toBe('/v2/notifications/preferences');
  });

  it('saves a partial update with PUT and gets the full list back', async () => {
    const http = mockFetch(jsonResponse(200, prefsOf(prefItem('new_chat'))));
    await savePreferences({ items: [{ type: 'new_chat', toast: null }] });
    expect(http.calls[0]?.init.method).toBe('PUT');
    expect(http.calls[0]?.body).toEqual({ items: [{ type: 'new_chat', toast: null }] });
  });

  it('asks whether the deployment sends browser notifications', async () => {
    const http = mockFetch(jsonResponse(200, { enabled: true, publicKey: 'abc' }));
    await expect(fetchPushDeployment()).resolves.toEqual({ enabled: true, publicKey: 'abc' });
    expect(url(http.calls[0]).pathname).toBe('/v2/notifications/push/public-key');
  });

  it('refuses an answer in a shape this build does not understand', async () => {
    mockFetch(jsonResponse(200, { items: [{ type: 'new_chat' }] }));
    await expect(fetchPreferences()).rejects.toMatchObject({ code: 'CLIENT_CONTRACT_MISMATCH' });
  });
});
