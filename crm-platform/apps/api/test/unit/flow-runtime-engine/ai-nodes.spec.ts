import { describe, expect, it } from 'vitest';
import type { AiAgentHandoffPort } from '../../../src/infra/providers/flow-runtime-engine/ai-agent-handoff.port';
import type {
  AiCallInput,
  AiCallOutcome,
  AiCallService,
} from '../../../src/modules/flow-runtime-engine/runtime/nodes/ai/ai-call.service';
import {
  AI_FALLBACK_REPLY,
  AiNodes,
} from '../../../src/modules/flow-runtime-engine/runtime/nodes/ai/ai-nodes';
import type {
  NodeContext,
  OutboundMessage,
  RunState,
  SendOutcome,
  WaitSpec,
} from '../../../src/modules/flow-runtime-engine/runtime/types';

class FakeAi {
  calls: AiCallInput[] = [];
  constructor(private readonly answers: AiCallOutcome[]) {}
  async call(input: AiCallInput): Promise<AiCallOutcome> {
    this.calls.push(input);
    return (
      this.answers.shift() ?? {
        ok: false,
        error: 'provider_failed',
        provider: 'openai',
        message: 'none',
      }
    );
  }
}
const ok = (reply: string): AiCallOutcome => ({ ok: true, reply, provider: 'openai' });

function ctx(
  type: string,
  data: Record<string, unknown>,
  vars: Record<string, unknown> = {},
  sendOutcome: SendOutcome = { ok: true },
  wait: WaitSpec | null = null,
) {
  const sent: OutboundMessage[] = [];
  const notes: string[] = [];
  const run = {
    orgId: 7,
    channelId: 3,
    peerKey: '911',
    conversationId: 9,
    vars,
    wait,
  } as unknown as RunState;
  const c: NodeContext = {
    run,
    stepKey: 'k',
    node: { id: 'n1', type, props: { data } },
    send: async (m) => {
      sent.push(m);
      return sendOutcome;
    },
    render: (t) => String(t),
    note: (t) => notes.push(t),
    now: () => new Date(0),
  };
  return { c, sent, notes, run };
}

const agents = (r: Awaited<ReturnType<AiAgentHandoffPort['handOff']>> | Error) => {
  const calls: unknown[] = [];
  const port: AiAgentHandoffPort = {
    handOff: async (req) => {
      calls.push(req);
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return { port, calls };
};

const nodes = (ai: FakeAi, port = agents({ ok: false, error: 'unavailable' }).port) =>
  new AiNodes(ai as unknown as AiCallService, port);

describe('AI node (TW-FLR-030)', () => {
  it('answers the last customer message, sends it, stores it and moves on', async () => {
    const ai = new FakeAi([ok('Hi Asha')]);
    const { c, sent, run } = ctx(
      'ChatGPT',
      { model: 'gpt-4o', prompt: 'Be kind', variable: '{{answer}}' },
      { user_message: 'hello' },
    );
    const r = await nodes(ai).execute(c);
    expect(r).toEqual({ kind: 'advance', port: 1 });
    expect(sent).toEqual([{ kind: 'text', body: 'Hi Asha' }]);
    expect(run.vars.answer).toBe('Hi Asha');
    expect(ai.calls[0]).toMatchObject({
      orgId: 7,
      model: 'gpt-4o',
      systemPrompt: 'Be kind',
      userPrompt: 'hello',
      maxTokens: 350,
      temperature: 0.7,
      json: false,
    });
  });

  it('uses the defaults the builder leaves out', async () => {
    const ai = new FakeAi([ok('x')]);
    await nodes(ai).execute(ctx('ChatGPT', {}, {}).c);
    expect(ai.calls[0]).toMatchObject({
      model: 'gpt-4o-mini',
      systemPrompt: 'You are a helpful assistant.',
    });
  });

  it('extraction mode asks for JSON with a 4000 token budget and flattens the fields', async () => {
    const ai = new FakeAi([ok('{"NAME":"Asha","PHONE":"123"}')]);
    const { c, run } = ctx(
      'ChatGPT',
      { extract: true, fields: ['NAME', 'PHONE'], silent: true },
      { user_message: 'I am Asha 123' },
    );
    const r = await nodes(ai).execute(c);
    expect(r).toEqual({ kind: 'advance', port: 1 });
    expect(ai.calls[0]).toMatchObject({ json: true, maxTokens: 4000, fields: ['NAME', 'PHONE'] });
    expect(run.vars['reply.NAME']).toBe('Asha');
    expect(run.vars['reply.PHONE']).toBe('123');
  });

  it('silent sends nothing to the customer', async () => {
    const ai = new FakeAi([ok('secret')]);
    const { c, sent, run } = ctx('ChatGPT', { silent: true }, { user_message: 'x' });
    await nodes(ai).execute(c);
    expect(sent).toEqual([]);
    expect(run.vars.reply).toBe('secret');
  });

  it('a provider failure never fails the step: the customer gets the apology and the flow goes on', async () => {
    const ai = new FakeAi([
      { ok: false, error: 'no_key', provider: 'openai', message: 'No active AI key' },
    ]);
    const { c, sent, notes, run } = ctx('ChatGPT', {}, { user_message: 'hi' });
    const r = await nodes(ai).execute(c);
    expect(r).toEqual({ kind: 'advance', port: 1 });
    expect(sent).toEqual([{ kind: 'text', body: AI_FALLBACK_REPLY }]);
    expect(run.vars.reply).toBe(AI_FALLBACK_REPLY);
    expect(notes.join(' ')).toContain('no_key');
  });

  it('a halted send halts the step and sets no variables', async () => {
    const ai = new FakeAi([ok('x')]);
    const { c, run } = ctx(
      'ChatGPT',
      {},
      { user_message: 'hi' },
      { ok: false, error: 'down', code: 'X', halt: true },
    );
    const r = await nodes(ai).execute(c);
    expect(r).toEqual({ kind: 'halt', reason: 'down' });
    expect(run.vars.reply).toBeUndefined();
  });

  it('conversation mode parks on the node with the transcript', async () => {
    const ai = new FakeAi([ok('Hello!')]);
    const { c } = ctx(
      'ChatGPT',
      { conversational: true, exit_keyword: 'done' },
      { user_message: 'hi' },
    );
    const r = await nodes(ai).execute(c);
    expect(r.kind).toBe('wait');
    if (r.kind !== 'wait') return;
    expect(r.wait).toMatchObject({ nodeId: 'n1', kind: 'Custom', handler: 'ChatGPT' });
    expect(r.wait.data).toEqual({
      history: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'Hello!' },
      ],
    });
  });

  it('a conversation with extraction on answers in plain language each turn (JSON only on exit)', async () => {
    const ai = new FakeAi([ok('Hello!')]);
    const { c } = ctx(
      'ChatGPT',
      { conversational: true, extract: true, fields: ['NAME'] },
      { user_message: 'hi' },
    );
    await nodes(ai).execute(c);
    expect(ai.calls[0]).toMatchObject({ json: false, maxTokens: 350 });
  });

  it('a later message gets another turn with the context and the wait keeps growing', async () => {
    const ai = new FakeAi([ok('Sure')]);
    const wait: WaitSpec = {
      nodeId: 'n1',
      variable: 'user_message',
      kind: 'Custom',
      handler: 'ChatGPT',
      data: {
        history: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'Hello!' },
        ],
      },
    };
    const { c, sent } = ctx(
      'ChatGPT',
      { conversational: true, exit_keyword: 'done' },
      {},
      { ok: true },
      wait,
    );
    const d = await nodes(ai).onReply(c, { kind: 'text', id: '', text: 'what is your price?' });
    expect(d.action).toBe('stay');
    if (d.action !== 'stay') return;
    expect(sent).toEqual([{ kind: 'text', body: 'Sure' }]);
    expect(ai.calls[0]!.userPrompt).toContain('Customer: hi');
    expect(ai.calls[0]!.userPrompt).toContain('Customer: what is your price?');
    expect(d.setVars).toMatchObject({ user_message: 'what is your price?', reply: 'Sure' });
    expect((d.data as { history: unknown[] }).history).toHaveLength(4);
  });

  it('the exit keyword (any case) leaves by the exit without another model turn', async () => {
    const ai = new FakeAi([]);
    const { c, sent } = ctx(
      'ChatGPT',
      { conversational: true, exit_keyword: 'Done' },
      {},
      { ok: true },
      {
        nodeId: 'n1',
        variable: 'user_message',
        kind: 'Custom',
        handler: 'ChatGPT',
        data: { history: [] },
      },
    );
    const d = await nodes(ai).onReply(c, { kind: 'text', id: '', text: ' done ' });
    expect(d).toEqual({ action: 'route', port: 1, setVars: {} });
    expect(ai.calls).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('conversation plus extraction runs one hidden pass over the transcript on exit', async () => {
    const ai = new FakeAi([ok('{"NAME":"Asha","PHONE":"555"}')]);
    const history = [
      { role: 'user', content: 'I am Asha' },
      { role: 'assistant', content: 'Your number?' },
      { role: 'user', content: '555' },
    ];
    const { c } = ctx(
      'ChatGPT',
      { conversational: true, extract: true, fields: ['NAME', 'PHONE'], exit_keyword: 'done' },
      {},
      { ok: true },
      {
        nodeId: 'n1',
        variable: 'user_message',
        kind: 'Custom',
        handler: 'ChatGPT',
        data: { history },
      },
    );
    const d = await nodes(ai).onReply(c, { kind: 'text', id: '', text: 'done' });
    expect(d.action).toBe('route');
    if (d.action !== 'route') return;
    expect(ai.calls[0]).toMatchObject({ json: true, temperature: 0, maxTokens: 4000 });
    expect(ai.calls[0]!.userPrompt).toContain('Customer: I am Asha');
    expect(d.setVars).toMatchObject({ 'reply.NAME': 'Asha', 'reply.PHONE': '555' });
  });

  it('a failed exit extraction still lets the customer leave', async () => {
    const ai = new FakeAi([
      { ok: false, error: 'provider_failed', provider: 'openai', message: 'x' },
    ]);
    const { c } = ctx(
      'ChatGPT',
      { conversational: true, extract: true, fields: ['A'], exit_keyword: 'done' },
      {},
      { ok: true },
      {
        nodeId: 'n1',
        variable: 'user_message',
        kind: 'Custom',
        handler: 'ChatGPT',
        data: { history: [{ role: 'user', content: 'x' }] },
      },
    );
    const d = await nodes(ai).onReply(c, { kind: 'text', id: '', text: 'done' });
    expect(d).toEqual({ action: 'route', port: 1, setVars: {} });
  });

  it('an outside event is not an answer to a conversation', async () => {
    const d = await nodes(new FakeAi([])).onReply(ctx('ChatGPT', { conversational: true }).c, {
      kind: 'external',
      id: '',
      text: '',
      data: {},
    });
    expect(d.action).toBe('ignore');
  });
});

describe('Chatbot node (TW-FLR-031)', () => {
  it('hands the conversation to the agent and ends the run as a takeover', async () => {
    const a = agents({ ok: true, agentName: 'Sia', replied: true });
    const { c } = ctx('Chatbot', { agentId: '12' });
    const r = await nodes(new FakeAi([]), a.port).execute(c);
    expect(r).toEqual({ kind: 'end', reason: 'takeover' });
    expect(a.calls[0]).toMatchObject({
      orgId: 7,
      agentId: '12',
      peerKey: '911',
      channelId: 3,
      conversationId: 9,
    });
  });

  it('reads the agent from botId too, and ends even when the agent is refused (as Reference does)', async () => {
    const a = agents({ ok: false, error: 'agent_not_found' });
    const r = await nodes(new FakeAi([]), a.port).execute(ctx('Chatbot', { botId: 5 }).c);
    expect(r).toEqual({ kind: 'end', reason: 'takeover' });
  });

  it('a thrown hand-off still ends the run, never crashes the step', async () => {
    const a = agents(new Error('boom'));
    const r = await nodes(new FakeAi([]), a.port).execute(ctx('Chatbot', { agentId: '5' }).c);
    expect(r).toEqual({ kind: 'end', reason: 'takeover' });
  });

  it('with no AI agent engine installed the node is passed, not ended', async () => {
    const r = await nodes(new FakeAi([])).execute(ctx('Chatbot', { agentId: '5' }).c);
    expect(r).toEqual({ kind: 'advance', port: 1 });
  });

  it('without an agent it is the legacy sub-flow node', async () => {
    expect(await nodes(new FakeAi([])).execute(ctx('Chatbot', { selectedFlowId: 44 }).c)).toEqual({
      kind: 'subflow',
      flowId: 44,
    });
    expect(
      await nodes(new FakeAi([])).execute(ctx('Chatbot', { agentId: '0', flowId: '8' }).c),
    ).toEqual({ kind: 'subflow', flowId: 8 });
    expect(await nodes(new FakeAi([])).execute(ctx('Chatbot', {}).c)).toEqual({
      kind: 'advance',
      port: 1,
    });
  });
});

describe('Sub-flow node (TW-FLR-031)', () => {
  it('asks the engine to swap in the flow (number or uuid)', async () => {
    expect(await nodes(new FakeAi([])).execute(ctx('SubFlow', { flowId: 12 }).c)).toEqual({
      kind: 'subflow',
      flowId: 12,
    });
    const u = '3f0c1f9e-5b1a-4c58-9d0e-0c1c3b6b1a11';
    expect(await nodes(new FakeAi([])).execute(ctx('SubFlow', { flowId: u }).c)).toEqual({
      kind: 'subflow',
      flowId: u,
    });
  });

  it('passes the node when no flow is chosen', async () => {
    const { c, notes } = ctx('SubFlow', { flowId: '' });
    expect(await nodes(new FakeAi([])).execute(c)).toEqual({ kind: 'advance', port: 1 });
    expect(notes[0]).toContain('no sub-flow');
  });
});
