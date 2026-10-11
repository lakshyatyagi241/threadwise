import { afterEach, describe, expect, it, vi } from 'vitest';
import { FaqAiError } from '../../../src/infra/providers/faq-knowledge/faq-ai.port';
import { FixtureFaqAiAdapter } from '../../../src/infra/providers/faq-knowledge/fixture-faq-ai.adapter';
import { OpenRouterFaqAiAdapter } from '../../../src/infra/providers/faq-knowledge/openrouter-faq-ai.adapter';

const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);

describe('fixture adapter (the offline stand-in)', () => {
  const ai = new FixtureFaqAiAdapter();
  const embed = async (...inputs: string[]) =>
    (await ai.embed({ apiKey: 'k', model: 'm', inputs, dimensions: 3072 })).vectors;

  it('returns one unit vector of the asked width per input', async () => {
    const v = await embed('track my order', 'hello');
    expect(v).toHaveLength(2);
    expect(v[0]).toHaveLength(3072);
    expect(Math.sqrt(v[0]!.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 5);
  });

  it('is deterministic', async () => {
    expect(await embed('order status')).toEqual(await embed('order status'));
  });

  it('texts that share words score higher than texts that share none', async () => {
    const [a, b, c] = await embed('where is my order', 'order status please', 'capital of france');
    expect(cos(a!, b!)).toBeGreaterThan(0.3);
    expect(cos(a!, c!)).toBeLessThan(0.1);
    expect(cos(a!, b!)).toBeGreaterThan(cos(a!, c!));
  });

  it('light stemming puts refund and refunds together', async () => {
    const [a, b] = await embed('refund', 'refunds');
    expect(cos(a!, b!)).toBeCloseTo(1, 5);
  });

  it('a text with nothing to embed still yields a valid vector', async () => {
    const [v] = await embed('the is a');
    expect(v).toHaveLength(3072);
    expect(Math.sqrt(v!.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 5);
  });

  it('[[fail]] simulates a provider failure', async () => {
    await expect(embed('boom [[fail]]')).rejects.toBeInstanceOf(FaqAiError);
  });

  it('writes suggestions as the JSON the parser expects', async () => {
    const out = await ai.complete({
      apiKey: 'k',
      model: 'm',
      question: 'Where is my order?',
      existing: [],
      count: 4,
      system: 's',
      user: 'u',
    });
    expect(JSON.parse(out.text).variations).toHaveLength(4);
  });
});

describe('OpenRouter adapter', () => {
  const ai = new OpenRouterFaqAiAdapter();
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FAQ_OPENROUTER_BASE_URL;
  });

  const answer = (status: number, body: unknown) =>
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    );

  const vec = (n: number, x = 0.5) => new Array<number>(n).fill(x);

  it('posts the model, the inputs and the key to /embeddings and reads vectors back in input order', async () => {
    const fetchMock = answer(200, {
      data: [
        { index: 1, embedding: vec(4, 2) },
        { index: 0, embedding: vec(4, 1) },
      ],
      usage: { prompt_tokens: 9 },
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await ai.embed({
      apiKey: 'sk-test',
      model: 'openai/text-embedding-3-large',
      inputs: ['a', 'b'],
      dimensions: 4,
    });
    expect(out.vectors).toEqual([vec(4, 1), vec(4, 2)]);
    expect(out.promptTokens).toBe(9);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/embeddings');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'openai/text-embedding-3-large',
      input: ['a', 'b'],
    });
  });

  it('honours a base URL override (tests, gateways)', async () => {
    process.env.FAQ_OPENROUTER_BASE_URL = 'http://gateway.test/v1/';
    const fetchMock = answer(200, {
      data: [{ index: 0, embedding: vec(2) }],
      usage: { total_tokens: 3 },
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await ai.embed({ apiKey: 'k', model: 'm', inputs: ['a'], dimensions: 2 });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'http://gateway.test/v1/embeddings',
    );
    expect(out.promptTokens).toBe(3);
  });

  it('splits a big batch into requests of 64 and joins the answers', async () => {
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      const n = (JSON.parse(init.body as string).input as string[]).length;
      return new Response(
        JSON.stringify({
          data: Array.from({ length: n }, (_, i) => ({ index: i, embedding: vec(2) })),
          usage: { prompt_tokens: n },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await ai.embed({
      apiKey: 'k',
      model: 'm',
      inputs: Array.from({ length: 130 }, (_, i) => `t${i}`),
      dimensions: 2,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(out.vectors).toHaveLength(130);
    expect(out.promptTokens).toBe(130);
  });

  it('refuses a vector of the wrong width instead of storing it', async () => {
    vi.stubGlobal('fetch', answer(200, { data: [{ index: 0, embedding: vec(5) }] }));
    await expect(
      ai.embed({ apiKey: 'k', model: 'm', inputs: ['a'], dimensions: 4 }),
    ).rejects.toMatchObject({
      kind: 'dimension_mismatch',
    });
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limited'],
    [500, 'provider'],
    [503, 'provider'],
  ])('maps HTTP %s to kind %s', async (status, kind) => {
    vi.stubGlobal('fetch', answer(status, { error: { message: 'secret detail sk-leak' } }));
    const err = await ai
      .embed({ apiKey: 'k', model: 'm', inputs: ['a'], dimensions: 2 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(FaqAiError);
    expect(err.kind).toBe(kind);
    // The vendor's body can echo the request: it never reaches a message.
    expect(err.message).not.toContain('sk-leak');
  });

  it('a network failure and a timeout are provider and timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    expect(
      await ai
        .embed({ apiKey: 'k', model: 'm', inputs: ['a'], dimensions: 2 })
        .catch((e) => e.kind),
    ).toBe('provider');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const e = new Error('t');
        e.name = 'TimeoutError';
        throw e;
      }),
    );
    expect(
      await ai
        .embed({ apiKey: 'k', model: 'm', inputs: ['a'], dimensions: 2 })
        .catch((e) => e.kind),
    ).toBe('timeout');
  });

  it('a malformed answer is bad_response', async () => {
    vi.stubGlobal('fetch', answer(200, { data: [] }));
    expect(
      await ai
        .embed({ apiKey: 'k', model: 'm', inputs: ['a'], dimensions: 2 })
        .catch((e) => e.kind),
    ).toBe('bad_response');
    vi.stubGlobal('fetch', answer(200, { data: [{ index: 0, embedding: ['x'] }] }));
    expect(
      await ai
        .embed({ apiKey: 'k', model: 'm', inputs: ['a'], dimensions: 2 })
        .catch((e) => e.kind),
    ).toBe('bad_response');
  });

  it('complete asks for JSON and returns the text and token counts', async () => {
    const fetchMock = answer(200, {
      choices: [{ message: { content: '{"variations":["x"]}' } }],
      usage: { prompt_tokens: 11, completion_tokens: 5 },
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await ai.complete({
      apiKey: 'k',
      model: 'openai/gpt-4o-mini',
      question: 'q',
      existing: [],
      count: 3,
      system: 'sys',
      user: 'usr',
    });
    expect(out).toEqual({ text: '{"variations":["x"]}', promptTokens: 11, completionTokens: 5 });
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ]);
  });
});
