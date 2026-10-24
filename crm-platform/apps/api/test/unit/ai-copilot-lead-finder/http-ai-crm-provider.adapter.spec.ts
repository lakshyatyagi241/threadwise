import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpAiCrmProviderAdapter } from '../../../src/infra/providers/ai-copilot-lead-finder/http-ai-crm-provider.adapter';

describe('HttpAiCrmProviderAdapter: OpenAI output-length field', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends max_completion_tokens and no max_tokens (OpenAI rejects max_tokens on its current models)', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'hi' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await new HttpAiCrmProviderAdapter().runTurn('openai', {
      apiKey: 'sk-test',
      model: 'gpt-5.4-mini',
      systemPrompt: 's',
      history: [],
      message: 'hello',
      tools: [],
      isWriteTool: () => false,
      executeReadTool: async () => ({}) as never,
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ max_completion_tokens: 800 });
    expect(body).not.toHaveProperty('max_tokens');
  });
});
