import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { runBulkAction } from './bulk-api';

const A = '11111111-1111-4111-8111-111111111111';
const B = '44444444-4444-4444-8444-444444444444';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('bulk api', () => {
  it('names the conversations and the action in one request, with an idempotency key, and reads the answer for each', async () => {
    const http = mockFetch(
      jsonResponse(200, {
        requested: 2,
        done: 1,
        unchanged: 0,
        failed: 1,
        results: [
          { id: A, outcome: 'done' },
          { id: B, outcome: 'failed', code: 'CONVERSATION_STATUS_INVALID' },
        ],
      }),
    );
    await expect(
      runBulkAction([A, B], { type: 'status', status: 'resolved' }, 'key-1'),
    ).resolves.toMatchObject({
      done: 1,
      failed: 1,
      results: [{ outcome: 'done' }, { code: 'CONVERSATION_STATUS_INVALID' }],
    });
    const call = http.calls[0];
    expect(call?.init.method).toBe('POST');
    expect(call?.url).toContain('/v2/inbox/conversations/bulk');
    expect(call?.body).toEqual({ ids: [A, B], action: { type: 'status', status: 'resolved' } });
    expect(call?.headers['Idempotency-Key']).toBe('key-1');
  });
});
