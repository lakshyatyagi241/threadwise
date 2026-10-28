import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { fetchAiModels, rewriteText } from './ai-rewrite-api';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('ai rewrite api', () => {
  it('reads the models the workspace may use', async () => {
    const http = mockFetch(
      jsonResponse(200, {
        data: [{ value: 'gpt-x', provider: 'openai', providerName: 'OpenAI', source: 'platform' }],
      }),
    );
    const out = await fetchAiModels();
    expect(out.data[0]?.value).toBe('gpt-x');
    expect(http.calls[0]?.url).toContain('/v2/ai/models');
  });

  it('posts the draft with the action, and one Idempotency-Key for the call', async () => {
    const http = mockFetch(jsonResponse(200, { text: 'Hello there.', model: 'gpt-x' }));
    const out = await rewriteText({
      provider: 'openai',
      model: 'gpt-x',
      action: 'translate',
      text: 'Hello',
      language: 'French',
    });
    expect(out).toEqual({ text: 'Hello there.', model: 'gpt-x' });
    const call = http.calls[0];
    expect(call?.url).toContain('/v2/inbox/ai/rewrite');
    expect(call?.init.method).toBe('POST');
    expect(call?.body).toEqual({
      provider: 'openai',
      model: 'gpt-x',
      action: 'translate',
      text: 'Hello',
      language: 'French',
    });
    expect(call?.headers['Idempotency-Key']).toBeTruthy();
  });
});
