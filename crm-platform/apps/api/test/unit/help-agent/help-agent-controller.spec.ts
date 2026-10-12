import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REQUIRED_PERMISSION_KEY, ACTOR_KINDS_KEY } from '../../../src/common/decorators';
import { readHelpAgentEnv } from '../../../src/config/domains/help-agent.env';
import { HelpAgentLlmError } from '../../../src/infra/providers/help-agent/help-agent-llm.port';
import { HttpHelpAgentLlmAdapter } from '../../../src/infra/providers/help-agent/http-help-agent-llm.adapter';
import { HelpAgentController } from '../../../src/modules/help-agent/help-agent.controller';
import { REQUIRE_PLAN_FEATURE_KEY } from '../../../src/modules/plans-subscriptions-trials';
import { THROTTLE_KEY } from '../../../src/modules/platform-infrastructure/rate-limit/throttle.decorators';
import { bodyLimitFor } from '../../../src/modules/platform-infrastructure/body-limits/body-limits';
import { readInfraEnv } from '../../../src/config/domains/platform-infrastructure.env';
import { HELP_AGENT_MAX_BODY_BYTES } from '@crm/contracts';

const proto = HelpAgentController.prototype as unknown as Record<string, object>;
const handlers = ['status', 'settings', 'saveSettings', 'start', 'finish', 'completions'] as const;

describe('help agent: who may reach each route', () => {
  it('is a plan feature for the whole controller, user actors only', () => {
    expect(Reflect.getMetadata(REQUIRE_PLAN_FEATURE_KEY, HelpAgentController)).toEqual([
      'help_agent',
    ]);
    expect(Reflect.getMetadata(ACTOR_KINDS_KEY, HelpAgentController)).toEqual(['user']);
  });

  it('needs a permission on every route: use for the assistant, manage for the switch', () => {
    const perm = (h: string) => Reflect.getMetadata(REQUIRED_PERMISSION_KEY, proto[h]!) as string[];
    for (const h of handlers) expect(perm(h), h).toHaveLength(1);
    expect(perm('settings')).toEqual(['help.agent.manage']);
    expect(perm('saveSettings')).toEqual(['help.agent.manage']);
    for (const h of ['status', 'start', 'finish', 'completions'])
      expect(perm(h)).toEqual(['help.agent.use']);
  });

  it('throttles the model door and the task start per actor', () => {
    const spec = (h: string) =>
      Reflect.getMetadata(THROTTLE_KEY, proto[h]!) as { limit: number; by: string };
    expect(spec('completions')).toMatchObject({ by: 'actor' });
    expect(spec('completions').limit).toBeLessThanOrEqual(60);
    expect(spec('start')).toMatchObject({ by: 'actor' });
    expect(spec('start').limit).toBeLessThanOrEqual(20);
  });

  it('has a body limit class that fits a page of text and no more', () => {
    const cls = bodyLimitFor('/v2/help-agent/chat/completions', readInfraEnv({}));
    expect(cls?.bytes).toBe(HELP_AGENT_MAX_BODY_BYTES);
    expect(bodyLimitFor('/v2/help-agent/status', readInfraEnv({}))).toBeUndefined();
  });
});

describe('help agent: the vendor adapter', () => {
  afterEach(() => vi.restoreAllMocks());

  const req = {
    provider: 'openai',
    model: 'm1',
    apiKey: 'sk-test-key',
    messages: [{ role: 'user' as const, content: 'hi' }],
    tools: [],
    toolChoice: 'required',
    maxTokens: 300,
  };
  const vendorJson = {
    id: 'x',
    model: 'm1',
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 't', type: 'function', function: { name: 'AgentOutput', arguments: '{}' } },
          ],
          refusal: 'drop-me',
        },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
    system_fingerprint: 'drop-me',
  };

  it('posts the OpenAI shape with the key in the header, and returns only the fields the library reads', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(vendorJson), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const adapter = new HttpHelpAgentLlmAdapter(
      readHelpAgentEnv({ HELP_AGENT_BASE_URL: 'http://127.0.0.1:9/v1/' }),
    );
    const out = await adapter.complete(req);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:9/v1/chat/completions');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer sk-test-key');
    const sent = JSON.parse(String(init!.body)) as Record<string, unknown>;
    expect(sent).toMatchObject({
      model: 'm1',
      parallel_tool_calls: false,
      max_completion_tokens: 300,
    });
    expect(sent).not.toHaveProperty('max_tokens');
    expect(out.promptTokens).toBe(100);
    expect(out.completionTokens).toBe(20);
    expect(JSON.stringify(out.completion)).not.toContain('drop-me');
    expect(out.completion).toMatchObject({
      object: 'chat.completion',
      usage: { total_tokens: 120 },
    });
  });

  it('uses max_tokens for the other vendors', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(vendorJson)));
    const adapter = new HttpHelpAgentLlmAdapter(
      readHelpAgentEnv({ HELP_AGENT_BASE_URL: 'http://127.0.0.1:9/v1' }),
    );
    await adapter.complete({ ...req, provider: 'groq' });
    const sent = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as Record<string, unknown>;
    expect(sent).toMatchObject({ max_tokens: 300 });
    expect(sent).not.toHaveProperty('max_completion_tokens');
  });

  it('reports a vendor error by status only, never by its body (which can echo the key or the page)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: 'bad key sk-test-key and your page text' } }),
        { status: 401 },
      ),
    );
    const adapter = new HttpHelpAgentLlmAdapter(
      readHelpAgentEnv({ HELP_AGENT_BASE_URL: 'http://127.0.0.1:9/v1' }),
    );
    const err = await adapter.complete(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HelpAgentLlmError);
    expect((err as HelpAgentLlmError).status).toBe(401);
    expect((err as Error).message).not.toContain('sk-test-key');
    expect((err as Error).message).not.toContain('page text');
  });

  it('turns a network failure and an answer with no completion into errors', async () => {
    const adapter = new HttpHelpAgentLlmAdapter(
      readHelpAgentEnv({ HELP_AGENT_BASE_URL: 'http://127.0.0.1:9/v1' }),
    );
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(
      ((await adapter.complete(req).catch((e: unknown) => e)) as HelpAgentLlmError).status,
    ).toBe(0);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [] })),
    );
    expect(
      ((await adapter.complete(req).catch((e: unknown) => e)) as HelpAgentLlmError).status,
    ).toBe(502);
  });
});

describe('help agent: configuration', () => {
  it('has safe defaults', () => {
    const env = readHelpAgentEnv({});
    expect(env).toMatchObject({
      HELP_AGENT_PROVIDER: 'openai',
      HELP_AGENT_MAX_STEPS: 25,
      HELP_AGENT_TASK_MINUTES: 15,
      HELP_AGENT_TASKS_PER_USER_DAY: 40,
    });
  });
  it('refuses a vendor that does not speak the OpenAI dialect, so the boot fails loudly', () => {
    expect(() => readHelpAgentEnv({ HELP_AGENT_PROVIDER: 'anthropic' })).toThrow(/Help assistant/);
  });
});
