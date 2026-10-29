import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowAiRequest } from '../../../src/infra/providers/flow-runtime-engine/flow-ai.port';
import { HttpFlowAiAdapter } from '../../../src/infra/providers/flow-runtime-engine/http-flow-ai.adapter';

const answer = (text: string) =>
  vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: text } }],
          usage: { prompt_tokens: 11, completion_tokens: 7 },
        }),
        { status: 200 },
      ),
  );

const base: FlowAiRequest = {
  provider: 'openai',
  model: 'gpt-5.4-mini',
  apiKey: 'sk-test',
  systemPrompt: 'be brief',
  userPrompt: 'hi',
  maxTokens: 350,
  temperature: 0.7,
  json: false,
};

const BASE_URL_ENV = [
  'FLR_AI_OPENAI_BASE_URL',
  'FLR_AI_MISTRAL_BASE_URL',
  'FLR_AI_DEEPSEEK_BASE_URL',
  'FLR_AI_GROQ_BASE_URL',
] as const;

describe('flow runtime AI adapter: output-length field per vendor', () => {
  const savedEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of BASE_URL_ENV) {
      savedEnv.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of BASE_URL_ENV) {
      const value = savedEnv.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    vi.unstubAllGlobals();
  });

  it('keeps max_tokens when FLR_AI_OPENAI_BASE_URL points at a gateway', async () => {
    process.env.FLR_AI_OPENAI_BASE_URL = 'http://gateway.test/v1/';
    const fetchMock = answer('ok');
    vi.stubGlobal('fetch', fetchMock);
    await new HttpFlowAiAdapter().complete(base);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(url).toBe('http://gateway.test/v1/chat/completions');
    expect(body).toMatchObject({ max_tokens: 350 });
    expect(body).not.toHaveProperty('max_completion_tokens');
  });

  it('sends OpenAI max_completion_tokens and no max_tokens (OpenAI rejects max_tokens on its current models)', async () => {
    const fetchMock = answer('ok');
    vi.stubGlobal('fetch', fetchMock);
    const out = await new HttpFlowAiAdapter().complete(base);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(body).toMatchObject({
      model: 'gpt-5.4-mini',
      max_completion_tokens: 350,
    });
    // OpenAI's GPT-5 family answers 400 to a temperature other than its default, so it is not sent.
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('max_tokens');
    expect(out).toEqual({ text: 'ok', promptTokens: 11, completionTokens: 7 });
  });

  it('sends the temperature to the OpenAI models that take one, and to gateways and other vendors whatever the model', async () => {
    const fetchMock = answer('ok');
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new HttpFlowAiAdapter();
    await adapter.complete({ ...base, model: 'gpt-4o-mini' });
    await adapter.complete({ ...base, model: 'gpt-5-chat-latest' });
    await adapter.complete({ ...base, provider: 'groq', model: 'gpt-5-oss' });
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse(
        (call as unknown as [string, RequestInit])[1].body as string,
      ) as Record<string, unknown>;
      expect(body).toMatchObject({ temperature: 0.7 });
    }
  });

  it('leaves the temperature out for the reasoning models too (o1, o3, o4-mini)', async () => {
    const fetchMock = answer('ok');
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new HttpFlowAiAdapter();
    for (const model of ['o1', 'o3-mini', 'o4-mini', 'gpt-5', 'gpt-5-mini', 'gpt-5.6-pro'])
      await adapter.complete({ ...base, model });
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse(
        (call as unknown as [string, RequestInit])[1].body as string,
      ) as Record<string, unknown>;
      expect(body, String(body.model)).not.toHaveProperty('temperature');
    }
  });

  it('keeps max_tokens for the other OpenAI-compatible vendors', async () => {
    const fetchMock = answer('ok');
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new HttpFlowAiAdapter();
    await adapter.complete({ ...base, provider: 'mistral', model: 'mistral-small' });
    await adapter.complete({ ...base, provider: 'deepseek', model: 'deepseek-chat' });
    await adapter.complete({ ...base, provider: 'groq', model: 'llama-3.1-8b' });
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse(
        (call as unknown as [string, RequestInit])[1].body as string,
      ) as Record<string, unknown>;
      expect(body).toMatchObject({ max_tokens: 350 });
      expect(body).not.toHaveProperty('max_completion_tokens');
    }
  });

  it('sends the JSON response format to OpenAI with max_completion_tokens', async () => {
    const fetchMock = answer('{"a":1}');
    vi.stubGlobal('fetch', fetchMock);
    await new HttpFlowAiAdapter().complete({ ...base, json: true, maxTokens: 4000 });
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      max_completion_tokens: 4000,
      response_format: { type: 'json_object' },
    });
  });
});
