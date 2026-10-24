import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpCampaignAiAdapter } from '../../../src/infra/providers/campaigns/http-campaign-ai.adapter';

describe('HttpCampaignAiAdapter: OpenAI output-length field', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends max_completion_tokens and no max_tokens (OpenAI rejects max_tokens on its current models)', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await new HttpCampaignAiAdapter().complete({
      provider: 'openai',
      model: 'gpt-5.4-mini',
      apiKey: 'sk-test',
      systemPrompt: 's',
      userPrompt: 'u',
      maxTokens: 900,
      temperature: 0.5,
    } as never);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ max_completion_tokens: 900 });
    expect(body).not.toHaveProperty('max_tokens');
  });
});
