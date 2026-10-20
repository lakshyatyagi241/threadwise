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
  /** The search found passages for the message (true) or fell back to the whole base (false/absent). */
  grounded?: boolean;
  /** The AI agent's row as the profile query returns it; null = no such agent. */
  agent?: Record<string, unknown> | null;
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
          if (text.includes('system_prompt')) return { rows: s.agent ? [s.agent] : [] };
          if (text.includes('ai_chat_assistants'))
            return { rows: s.assistantExists === false ? [] : [{ id: 1 }] };
          return { rows: s.sources ?? [] };
        },
      }),
  };
  const retrieval = {
    retrieve: async () => ({
      grounded: s.grounded === true,
      passages: (s.sources ?? []).map((r) => ({
        label: String(r.label),
        text:
          r.kind === 'qa'
            ? `Q: ${String(r.question)}\nA: ${String(r.answer)}`
            : String(r.content ?? ''),
      })),
    }),
  };
  const svc = new AiCallService(
    db as never,
    keys as never,
    meter as never,
    port,
    retrieval as never,
  );
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

  describe('running as an AI agent (Settings, AI Training)', () => {
    const agent = {
      system_prompt: 'You are Shivaa, the farm desk.',
      tone: 'friendly',
      language: 'hi',
      ai_provider: 'anthropic',
      ai_model: 'claude-sonnet-5-5',
      reply_max_tokens: 250,
      temperature: '0.30',
    };

    it("answers with the agent's own model, instructions, tone, length and temperature", async () => {
      const { svc, sent, recorded } = build({ agent });
      const out = await svc.call({ ...base, assistantId: 4, agentUse: 'full' });
      expect(out).toEqual({ ok: true, reply: 'hello', provider: 'anthropic' });
      expect(sent[0]).toMatchObject({
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        maxTokens: 250,
        temperature: 0.3,
      });
      expect(sent[0]!.systemPrompt).toContain('You are Shivaa, the farm desk.');
      expect(sent[0]!.systemPrompt).toContain('Speak in a friendly tone. Default language: hi.');
      expect(sent[0]!.systemPrompt).not.toContain('Sys');
      expect(recorded[0]).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
    });

    it("still adds the agent's knowledge, and keeps the node's big budget for a JSON extraction", async () => {
      const { svc, sent } = build({
        agent,
        sources: [{ label: 'Hours', kind: 'text', content: 'Open 9 to 5' }],
      });
      await svc.call({
        ...base,
        assistantId: 4,
        agentUse: 'full',
        json: true,
        fields: ['NAME'],
        maxTokens: 4000,
      });
      expect(sent[0]).toMatchObject({ maxTokens: 1000, json: true });
      expect(sent[0]!.systemPrompt).toContain('exactly these keys: NAME');
      expect(sent[0]!.systemPrompt).toContain('[Hours]\nOpen 9 to 5');
      expect(sent[0]!.systemPrompt).not.toContain('Keep replies short');
    });

    it("an agent with no instructions falls back to the step's prompt", async () => {
      const { svc, sent } = build({ agent: { ...agent, system_prompt: '  ' } });
      await svc.call({ ...base, assistantId: 4, agentUse: 'full' });
      expect(sent[0]!.systemPrompt.startsWith('Sys\n')).toBe(true);
    });

    it("a hidden pass borrows only the agent's model: its own prompt, no knowledge", async () => {
      const { svc, sent } = build({
        agent,
        sources: [{ label: 'Hours', kind: 'text', content: 'Open 9 to 5' }],
      });
      await svc.call({ ...base, assistantId: 4, agentUse: 'model', temperature: 0 });
      expect(sent[0]).toMatchObject({
        model: 'claude-sonnet-5-5',
        provider: 'anthropic',
        temperature: 0,
      });
      expect(sent[0]!.systemPrompt).toBe('Sys');
    });

    it("an agent that no longer exists gives agentMissing and the step's own settings", async () => {
      const { svc, sent } = build({ agent: null });
      const out = await svc.call({ ...base, assistantId: 4, agentUse: 'full' });
      expect(out).toMatchObject({ ok: true, agentMissing: true });
      expect(sent[0]).toMatchObject({
        model: 'gpt-4o-mini',
        provider: 'openai',
        systemPrompt: 'Sys',
      });
    });

    it('without agentUse the agent only lends its knowledge (a custom setup)', async () => {
      const { svc, sent } = build({ agent });
      const out = await svc.call({ ...base, assistantId: 4 });
      expect(out).toEqual({ ok: true, reply: 'hello', provider: 'openai' });
      expect(sent[0]).toMatchObject({ model: 'gpt-4o-mini', systemPrompt: 'Sys' });
    });
  });
});
