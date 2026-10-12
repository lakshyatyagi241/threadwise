import { afterEach, describe, expect, it, vi } from 'vitest';
import { LSC_MODELS } from '@crm/contracts';
import { FixtureLeadScoringAiAdapter } from '../../../src/infra/providers/lead-scoring/fixture-lead-scoring-ai.adapter';
import { LeadScoringAiError } from '../../../src/infra/providers/lead-scoring/lead-scoring-ai.port';
import { OpenRouterLeadScoringAiAdapter } from '../../../src/infra/providers/lead-scoring/openrouter-lead-scoring-ai.adapter';
import {
  customFacts,
  decodeRunCursor,
  emailKind,
  encodeRunCursor,
  estimateCostUsd,
  parseScore,
  resolveCost,
  scorerMayWrite,
  scoringPrompt,
  usdString,
  type ScoringFacts,
} from '../../../src/modules/lead-scoring/lead-scoring.rules';

const facts: ScoringFacts = {
  stage: 'new',
  status: null,
  source: 'import',
  channel: null,
  title: 'CTO',
  language: 'en',
  country: 'IN',
  hasEmail: true,
  hasPhone: true,
  emailKind: 'business',
  emailConfirmed: true,
  unsubscribed: false,
  company: 'Acme',
  tags: ['vip'],
  properties: {},
  daysSinceCreated: 3,
  daysSinceActivity: 1,
  dealsOpen: 1,
  dealsWon: 0,
  dealsLost: 0,
  openDealValue: 5000,
};

describe('parseScore', () => {
  it('reads a plain answer', () => {
    expect(parseScore('{"score": 72, "reasons": ["Open deal", "Business email"]}')).toEqual({
      score: 72,
      reasons: ['Open deal', 'Business email'],
    });
  });
  it('reads a fenced answer, a string score and a decimal, rounding and clamping', () => {
    expect(parseScore('```json\n{"score": "87.6"}\n```')?.score).toBe(88);
    expect(parseScore('{"score": 140}')?.score).toBe(100);
    expect(parseScore('{"score": -5}')?.score).toBe(0);
  });
  it('finds the object inside chatter', () => {
    expect(parseScore('Sure! {"score": 40, "reasons": []} Hope that helps')?.score).toBe(40);
  });
  it('refuses an answer that is not a score', () => {
    for (const bad of [
      '',
      'no idea',
      '{"score": "high"}',
      '{"reasons": ["x"]}',
      '[1,2]',
      '{"score": null}',
    ]) {
      expect(parseScore(bad)).toBeNull();
    }
  });
  it('keeps at most four short non-empty string reasons', () => {
    const r = parseScore(
      JSON.stringify({ score: 10, reasons: ['a', '', 7, 'b', 'c', 'd', 'e', 'x'.repeat(500)] }),
    )!;
    expect(r.reasons).toEqual(['a', 'b', 'c', 'd']);
    const long = parseScore(JSON.stringify({ score: 10, reasons: ['x'.repeat(500)] }))!;
    expect(long.reasons[0]).toHaveLength(160);
  });
});

describe('cost', () => {
  it('estimates from the price list', () => {
    const m = LSC_MODELS[0]!;
    expect(estimateCostUsd(m.id, 1_000_000, 1_000_000)).toBeCloseTo(
      m.inputPerMillion + m.outputPerMillion,
      8,
    );
    expect(estimateCostUsd('some/unknown-model', 100, 100)).toBeNull();
  });
  it('prefers the figure the vendor reported', () => {
    expect(resolveCost(0.0004, LSC_MODELS[0]!.id, 1000, 100)).toEqual({
      costUsd: 0.0004,
      source: 'vendor',
    });
    expect(resolveCost(null, LSC_MODELS[0]!.id, 1000, 100).source).toBe('estimate');
    expect(resolveCost(null, 'some/unknown-model', 1000, 100)).toEqual({
      costUsd: 0,
      source: 'none',
    });
  });
  it('formats with eight decimals and never negative or NaN', () => {
    expect(usdString(0.00012345678)).toBe('0.00012346');
    expect(usdString(-1)).toBe('0.00000000');
    expect(usdString(Number.NaN)).toBe('0.00000000');
  });
});

describe('what is sent to the vendor', () => {
  it('holds no direct identifier', () => {
    const p = scoringPrompt(facts);
    const all = `${p.system}\n${p.user}`;
    expect(all).not.toMatch(/@/);
    expect(p.user).toContain('"dealsOpen":1');
    expect(Object.keys(facts)).not.toEqual(expect.arrayContaining(['name', 'email', 'phone']));
  });
  it('classifies the email without sending it', () => {
    expect(emailKind('a@gmail.com')).toBe('free');
    expect(emailKind('a@acme.io')).toBe('business');
    expect(emailKind(null)).toBeNull();
    expect(emailKind('nope')).toBeNull();
  });
  it('caps custom properties to a few short scalars', () => {
    const data: Record<string, unknown> = { nested: { a: 1 }, list: [1], empty: '  ' };
    for (let i = 0; i < 40; i++) data[`k${i}`] = 'v'.repeat(300);
    const out = customFacts(data);
    expect(Object.keys(out)).toHaveLength(15);
    expect(String(Object.values(out)[0]).length).toBe(80);
    expect(out).not.toHaveProperty('nested');
    expect(customFacts(null)).toEqual({});
  });
});

describe('scorerMayWrite', () => {
  it('fills an empty score or refreshes its own, never a person’s', () => {
    expect(scorerMayWrite({ leadScore: null, leadScoreSource: null })).toBe(true);
    expect(scorerMayWrite({ leadScore: 50, leadScoreSource: 'ai' })).toBe(true);
    expect(scorerMayWrite({ leadScore: 50, leadScoreSource: 'manual' })).toBe(false);
    expect(scorerMayWrite({ leadScore: 50, leadScoreSource: null })).toBe(false);
  });
});

describe('run cursor', () => {
  it('round trips and refuses garbage', () => {
    const at = new Date('2026-10-12T10:00:00.000Z');
    expect(decodeRunCursor(encodeRunCursor(at, 42))).toEqual({ at, id: 42 });
    expect(decodeRunCursor('!!')).toBeNull();
  });
});

describe('fixture adapter', () => {
  it('is deterministic, in range, parseable and reports a cost', async () => {
    const ai = new FixtureLeadScoringAiAdapter();
    const req = {
      apiKey: 'k',
      model: 'm',
      system: 's',
      user: scoringPrompt(facts).user,
      maxTokens: 100,
    };
    const a = await ai.complete(req);
    expect(await ai.complete(req)).toEqual(a);
    const parsed = parseScore(a.text)!;
    expect(parsed.score).toBeGreaterThanOrEqual(0);
    expect(parsed.score).toBeLessThanOrEqual(100);
    expect(a.costUsd).toBeGreaterThan(0);
  });
  it('scores a contact with a won deal higher', async () => {
    const ai = new FixtureLeadScoringAiAdapter();
    const score = async (f: ScoringFacts) =>
      parseScore(
        (
          await ai.complete({
            apiKey: 'k',
            model: 'm',
            system: 's',
            user: scoringPrompt(f).user,
            maxTokens: 1,
          })
        ).text,
      )!.score;
    expect(await score({ ...facts, dealsWon: 2 })).toBeGreaterThan(
      (await score({ ...facts, dealsWon: 0 })) - 1,
    );
  });
});

describe('OpenRouter adapter', () => {
  afterEach(() => vi.unstubAllGlobals());
  const req = {
    apiKey: 'sk-test',
    model: 'openai/gpt-6-luna-pro',
    system: 's',
    user: 'u',
    maxTokens: 200,
  };
  const reply = (status: number, body: unknown) =>
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it('asks for JSON, reasoning kept low and the vendor cost, and reads tokens and cost', async () => {
    const fetchMock = reply(200, {
      choices: [{ message: { content: '{"score": 61}' } }],
      usage: { prompt_tokens: 300, completion_tokens: 40, cost: 0.00005 },
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await new OpenRouterLeadScoringAiAdapter().complete(req);
    expect(out).toEqual({
      text: '{"score": 61}',
      promptTokens: 300,
      completionTokens: 40,
      costUsd: 0.00005,
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: req.model,
      response_format: { type: 'json_object' },
      usage: { include: true },
      reasoning: { effort: 'low' },
      temperature: 0,
    });
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
  });

  it('reports no cost when the vendor sends none', async () => {
    vi.stubGlobal(
      'fetch',
      reply(200, {
        choices: [{ message: { content: '{}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    );
    expect((await new OpenRouterLeadScoringAiAdapter().complete(req)).costUsd).toBeNull();
  });

  it.each([
    [401, 'auth', false],
    [403, 'auth', false],
    [429, 'rate_limited', true],
    [500, 'provider', true],
  ])(
    'maps HTTP %i to %s (retryable: %s) without echoing the body',
    async (status, kind, retryable) => {
      vi.stubGlobal('fetch', reply(status, { error: { message: 'echo of the contact data' } }));
      const err = await new OpenRouterLeadScoringAiAdapter().complete(req).catch((e) => e);
      expect(err).toBeInstanceOf(LeadScoringAiError);
      expect(err.kind).toBe(kind);
      expect(err.retryable).toBe(retryable);
      expect(err.message).not.toContain('echo');
    },
  );

  it('maps a network failure to provider and a timeout to timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(
      (
        (await new OpenRouterLeadScoringAiAdapter()
          .complete(req)
          .catch((e) => e)) as LeadScoringAiError
      ).kind,
    ).toBe('provider');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' })),
    );
    expect(
      (
        (await new OpenRouterLeadScoringAiAdapter()
          .complete(req)
          .catch((e) => e)) as LeadScoringAiError
      ).kind,
    ).toBe('timeout');
  });
});
