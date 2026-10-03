import { describe, expect, it } from 'vitest';
import type {
  FlowAiPort,
  FlowAiRequest,
  FlowAiResult,
} from '../../../src/infra/providers/flow-runtime-engine/flow-ai.port';
import { AiCallService } from '../../../src/modules/flow-runtime-engine/runtime/nodes/ai/ai-call.service';

interface Setup {
  key?: string | null;
  source?: 'workspace' | 'admin' | 'none';
  guardFails?: boolean;
  vendor?: FlowAiResult | Error;
  sources?: Array<Record<string, unknown>>;
  assistantExists?: boolean;
}

function build(s: Setup = {}) {
  const sent: FlowAiRequest[] = [];
  const recorded: unknown[] = [];
  const port: FlowAiPort = {
    complete: async (req) => {
      sent.push(req);
      const v = s.vendor ?? { text: 'hello', promptTokens: 10, completionTokens: 5 };
      if (v instanceof Error) throw v;
      return v;
    },
  };
  const keys = {
    resolve: async () => ({
      key: s.key === undefined ? 'sk-test' : s.key,
      source: s.source ?? 'admin',
      model: null,
    }),
    capMaxTokens: async (_p: string, n: number) => Math.min(n, 1000),
  };
  const meter = {
    guard: async () => {
      if (s.guardFails) throw new Error('limit');
    },
    record: async (_org: number, usage: unknown) => {
      recorded.push(usage);
    },
  };
  const db = {
    txAs: async (_ctx: unknown, fn: (tx: unknown) => unknown) =>
      fn({
        execute: async (q: { queryChunks?: unknown[] }) => {
          const text = JSON.stringify(q.queryChunks ?? []);
          if (text.includes('ai_chat_assistants'))
            return { rows: s.assistantExists === false ? [] : [{ x: 1 }] };
          return { rows: s.sources ?? [] };
        },
      }),
  };
  const svc = new AiCallService(db as never, keys as never, meter as never, port);
  return { svc, sent, recorded };
}

const base = {
  orgId: 1,
  model: 'gpt-4o-mini',
  systemPrompt: 'Sys',
  userPrompt: 'Hi',
  maxTokens: 350,
  temperature: 0.7,
};

describe('AI call service (the ai-call endpoint semantics, TW-FLR-030)', () => {
  it('calls the vendor with the resolved key, caps the tokens and writes the ledger', async () => {
    const { svc, sent, recorded } = build();
    const out = await svc.call({ ...base, maxTokens: 9000 });
    expect(out).toEqual({ ok: true, reply: 'hello', provider: 'openai' });
    expect(sent[0]).toMatchObject({
      provider: 'openai',
      apiKey: 'sk-test',
      maxTokens: 1000,
      json: false,
      systemPrompt: 'Sys',
    });
    expect(recorded).toEqual([
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        promptTokens: 10,
        completionTokens: 5,
        billedAgainst: 'admin',
      },
    ]);
  });

  it('clamps the temperature to 0..2 and tokens to 1..4000 like the endpoint validated', async () => {
    const { svc, sent } = build();
    await svc.call({ ...base, temperature: 9, maxTokens: 99999 });
    expect(sent[0]).toMatchObject({ temperature: 2, maxTokens: 1000 });
    await svc.call({ ...base, temperature: -1, maxTokens: 0 });
    expect(sent[1]).toMatchObject({ temperature: 0, maxTokens: 350 });
  });

  it('forces JSON in extraction mode and lists the fields in the system prompt', async () => {
    const { svc, sent } = build();
    await svc.call({ ...base, json: true, fields: ['NAME', 'PHONE'] });
    expect(sent[0]!.json).toBe(true);
    expect(sent[0]!.systemPrompt).toContain('exactly these keys: NAME, PHONE');
    expect(sent[0]!.systemPrompt).toContain('"rows"');
  });

  it('JSON-only mode leaves the caller prompt alone', async () => {
    const { svc, sent } = build();
    await svc.call({ ...base, vendorJsonOnly: true });
    expect(sent[0]!.json).toBe(true);
    expect(sent[0]!.systemPrompt).toBe('Sys');
  });

  it('picks the vendor from the model name', async () => {
    const { svc, sent } = build();
    await svc.call({ ...base, model: 'claude-3-haiku' });
    expect(sent[0]!.provider).toBe('anthropic');
  });

  it('answers no_key when neither side has a key, without calling the vendor', async () => {
    const { svc, sent } = build({ key: null, source: 'none' });
    const out = await svc.call(base);
    expect(out).toMatchObject({ ok: false, error: 'no_key' });
    expect(sent).toHaveLength(0);
  });

  it('answers limit_reached past the monthly allowance on the platform key', async () => {
    const { svc, sent } = build({ guardFails: true });
    expect(await svc.call(base)).toMatchObject({ ok: false, error: 'limit_reached' });
    expect(sent).toHaveLength(0);
  });

  it('does not ask the allowance for a workspace key', async () => {
    const { svc, recorded } = build({ guardFails: true, source: 'workspace' });
    expect((await svc.call(base)).ok).toBe(true);
    expect(recorded[0]).toMatchObject({ billedAgainst: 'workspace' });
  });

  it('turns a vendor error into provider_failed, never a throw', async () => {
    const { svc } = build({ vendor: new Error('AI provider answered 500') });
    expect(await svc.call(base)).toMatchObject({ ok: false, error: 'provider_failed' });
  });

  it('treats an empty completion as provider_failed but still records the tokens spent', async () => {
    const { svc, recorded } = build({
      vendor: { text: '  ', promptTokens: 3, completionTokens: 0 },
    });
    expect(await svc.call(base)).toMatchObject({ ok: false, error: 'provider_failed' });
    expect(recorded).toHaveLength(1);
  });

  it('stitches the attached assistant knowledge base into the system prompt', async () => {
    const { svc, sent } = build({
      sources: [
        { label: 'Hours', kind: 'text', content: 'Open 9 to 5', question: null, answer: null },
        { label: 'FAQ', kind: 'qa', content: null, question: 'Refunds?', answer: 'Within 7 days' },
      ],
    });
    await svc.call({ ...base, assistantId: 4 });
    expect(sent[0]!.systemPrompt).toContain('--- Knowledge base ---');
    expect(sent[0]!.systemPrompt).toContain('[Hours]\nOpen 9 to 5');
    expect(sent[0]!.systemPrompt).toContain('Q: Refunds?\nA: Within 7 days');
  });

  it('adds no knowledge for an assistant of another workspace', async () => {
    const { svc, sent } = build({
      assistantExists: false,
      sources: [{ label: 'x', kind: 'text', content: 'leak' }],
    });
    await svc.call({ ...base, assistantId: 4 });
    expect(sent[0]!.systemPrompt).toBe('Sys');
  });
});
