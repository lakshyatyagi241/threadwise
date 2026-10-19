import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { workweek } from '@/test/business-hours-fixtures';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { fetchBusinessHours, saveBusinessHours } from './business-hours-api';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('the business hours API', () => {
  it('reads the saved schedule', async () => {
    const http = mockFetch(jsonResponse(200, workweek));
    await expect(fetchBusinessHours()).resolves.toMatchObject({
      timezone: 'Asia/Kolkata',
      canEditTimezone: false,
    });
    expect(http.calls[0]?.url).toBe('http://api.test/v2/inbox/routing/business-hours');
  });

  it('saves with PUT and reads the saved schedule back', async () => {
    const http = mockFetch(jsonResponse(200, workweek));
    const body = { days: workweek.days };
    await expect(saveBusinessHours(body)).resolves.toMatchObject({ timezone: 'Asia/Kolkata' });
    expect(http.calls[0]?.init.method).toBe('PUT');
    expect(http.calls[0]?.body).toEqual(body);
  });

  it('refuses an answer in a shape this build does not understand', async () => {
    mockFetch(jsonResponse(200, { timezone: 5 }));
    await expect(fetchBusinessHours()).rejects.toMatchObject({ code: 'CLIENT_CONTRACT_MISMATCH' });
  });
});
