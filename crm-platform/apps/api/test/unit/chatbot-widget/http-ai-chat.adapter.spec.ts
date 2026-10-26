import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpAiChatAdapter } from '../../../src/infra/providers/chatbot-widget/http-ai-chat.adapter';

const req = (provider: string) => ({
  provider,
  model: 'm',
  orgId: 1,
  systemPrompt: 'sys',
  userPrompt: 'hi',
  maxTokens: 50,
  temperature: 0.5,
});

const adapter = (keys: Record<string, string>) =>
  new HttpAiChatAdapter({ get: (k: string) => keys[k] } as never);

const json = (body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

afterEach(() => vi.unstubAllGlobals());

describe('HttpAiChatAdapter (the vendor answer and what it used)', () => {
  it('reads the text and the token counts of an OpenAI-compatible answer', async () => {
    vi.stubGlobal(
      'fetch',
      json({
        choices: [{ message: { content: 'Hello' } }],
        usage: { prompt_tokens: 12, completion_tokens: 3 },
      }),
    );
    expect(await adapter({ WGT_AI_OPENAI_API_KEY: 'k' }).complete(req('openai'))).toEqual({
      text: 'Hello',
      promptTokens: 12,
      completionTokens: 3,
    });
  });

  it("reads Anthropic's and Gemini's counts under their own names", async () => {
    vi.stubGlobal(
      'fetch',
      json({
        content: [{ type: 'text', text: 'Hi' }],
        usage: { input_tokens: 20, output_tokens: 4 },
      }),
    );
    expect(await adapter({ WGT_AI_ANTHROPIC_API_KEY: 'k' }).complete(req('anthropic'))).toEqual({
      text: 'Hi',
      promptTokens: 20,
      completionTokens: 4,
    });
    vi.stubGlobal(
      'fetch',
      json({
        candidates: [{ content: { parts: [{ text: 'Yo' }] } }],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2 },
      }),
    );
    expect(await adapter({ WGT_AI_GEMINI_API_KEY: 'k' }).complete(req('gemini'))).toEqual({
      text: 'Yo',
      promptTokens: 8,
      completionTokens: 2,
    });
  });

  it('says null counts, not zero, when the vendor reports none (the caller then estimates)', async () => {
    vi.stubGlobal('fetch', json({ choices: [{ message: { content: 'Hello' } }] }));
    expect(await adapter({ WGT_AI_OPENAI_API_KEY: 'k' }).complete(req('openai'))).toEqual({
      text: 'Hello',
      promptTokens: null,
      completionTokens: null,
    });
  });

  it('still returns a reply when the completion is empty, because the vendor billed it', async () => {
    vi.stubGlobal(
      'fetch',
      json({
        choices: [{ message: { content: '' } }],
        usage: { prompt_tokens: 5, completion_tokens: 0 },
      }),
    );
    const out = await adapter({ WGT_AI_OPENAI_API_KEY: 'k' }).complete(req('openai'));
    expect(out).toMatchObject({ promptTokens: 5, completionTokens: 0 });
  });

  it('makes no call and returns null without a key or for an unknown provider', async () => {
    const f = json({});
    vi.stubGlobal('fetch', f);
    expect(await adapter({}).complete(req('openai'))).toBeNull();
    expect(await adapter({ WGT_AI_OPENAI_API_KEY: 'k' }).complete(req('nope'))).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('sends OpenAI max_completion_tokens (not max_tokens); the other OpenAI-compatible vendors keep max_tokens', async () => {
    const f = json({ choices: [{ message: { content: 'Hello' } }] });
    vi.stubGlobal('fetch', f);
    const a = adapter({ WGT_AI_OPENAI_API_KEY: 'k', WGT_AI_GROQ_API_KEY: 'k' });
    await a.complete(req('openai'));
    await a.complete(req('groq'));
    const [openaiCall, groqCall] = f.mock.calls as unknown as Array<[string, RequestInit]>;
    const openaiBody = JSON.parse(openaiCall![1].body as string) as Record<string, unknown>;
    const groqBody = JSON.parse(groqCall![1].body as string) as Record<string, unknown>;
    expect(openaiBody).toMatchObject({ model: 'm', max_completion_tokens: 50 });
    expect(openaiBody).not.toHaveProperty('max_tokens');
    expect(groqBody).toMatchObject({ model: 'm', max_tokens: 50 });
    expect(groqBody).not.toHaveProperty('max_completion_tokens');
  });

  it('keeps max_tokens when WGT_AI_OPENAI_BASE_URL points at a gateway', async () => {
    const f = json({ choices: [{ message: { content: 'Hello' } }] });
    vi.stubGlobal('fetch', f);
    await adapter({
      WGT_AI_OPENAI_API_KEY: 'k',
      WGT_AI_OPENAI_BASE_URL: 'http://gateway.test/v1/',
    }).complete(req('openai'));
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(url).toBe('http://gateway.test/v1/chat/completions');
    expect(body).toMatchObject({ max_tokens: 50 });
    expect(body).not.toHaveProperty('max_completion_tokens');
  });
});
