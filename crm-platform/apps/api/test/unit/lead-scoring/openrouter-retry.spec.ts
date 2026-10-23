import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterLeadScoringAiAdapter } from '../../../src/infra/providers/lead-scoring/openrouter-lead-scoring-ai.adapter';

const req = { apiKey: 'k', model: 'm', system: 's', user: 'u', maxTokens: 100 };
const ok = () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: '{"rules":null}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 2 },
    }),
    { status: 200 },
  );

afterEach(() => vi.unstubAllGlobals());

describe('OpenRouterLeadScoringAiAdapter', () => {
  it('asks again with the plain request when the provider answers 400 to the JSON/reasoning options', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 400 }))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetchMock);
    const out = await new OpenRouterLeadScoringAiAdapter().complete(req);
    expect(out.text).toBe('{"rules":null}');
    const first = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    const second = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
    expect(first.response_format).toBeDefined();
    expect(second.response_format).toBeUndefined();
    expect(second.reasoning).toBeUndefined();
  });

  it('does not retry a refused key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new OpenRouterLeadScoringAiAdapter().complete(req)).rejects.toThrow(/refused/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
