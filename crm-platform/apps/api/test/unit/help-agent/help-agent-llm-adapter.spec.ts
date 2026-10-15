import { afterEach, describe, expect, it, vi } from 'vitest';
import { readHelpAgentEnv } from '../../../src/config/domains/help-agent.env';
import { HelpAgentLlmError } from '../../../src/infra/providers/help-agent/help-agent-llm.port';
import { HttpHelpAgentLlmAdapter } from '../../../src/infra/providers/help-agent/http-help-agent-llm.adapter';

const request = {
  provider: 'openai' as const,
  model: 'm',
  apiKey: 'k',
  messages: [{ role: 'user' as const, content: 'hi' }],
  tools: [],
  toolChoice: 'auto' as const,
  maxTokens: 100,
};

const reply = (finish_reason: string) =>
  new Response(
    JSON.stringify({
      choices: [{ finish_reason, message: { role: 'assistant', content: 'x' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
  );

describe('HttpHelpAgentLlmAdapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refuses a reply the vendor cut off at the output cap', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('length')));
    const adapter = new HttpHelpAgentLlmAdapter(readHelpAgentEnv({}));
    await expect(adapter.complete(request)).rejects.toBeInstanceOf(HelpAgentLlmError);
  });

  it('passes a complete reply through', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('stop')));
    const adapter = new HttpHelpAgentLlmAdapter(readHelpAgentEnv({}));
    const out = await adapter.complete(request);
    const choices = out.completion.choices as { finish_reason?: string }[];
    expect(choices[0]?.finish_reason).toBe('stop');
  });
});
