import { Inject, Injectable } from '@nestjs/common';
import type { HelpAgentEnv } from '../../../config/domains/help-agent.env';
import {
  HelpAgentLlmError,
  type HelpAgentLlmPort,
  type HelpAgentLlmRequest,
  type HelpAgentLlmResult,
} from './help-agent-llm.port';

export const HELP_AGENT_ENV = Symbol('HELP_AGENT_ENV');

/** Vendors that speak the OpenAI chat-completions dialect with tool calls. */
const BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  mistral: 'https://api.mistral.ai/v1',
  deepseek: 'https://api.deepseek.com/v1',
  groq: 'https://api.groq.com/openai/v1',
};

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Calls the model vendor over HTTPS with a hard timeout. The key is the caller's: this class never reads one from the environment, and
 * it never logs a request or a response (they carry the page's text). A vendor error becomes a `HelpAgentLlmError` whose message is only
 * the status, never the vendor's body.
 */
@Injectable()
export class HttpHelpAgentLlmAdapter implements HelpAgentLlmPort {
  constructor(@Inject(HELP_AGENT_ENV) private readonly env: HelpAgentEnv) {}

  async complete(req: HelpAgentLlmRequest): Promise<HelpAgentLlmResult> {
    const base = (this.env.HELP_AGENT_BASE_URL ?? BASE_URLS[req.provider]) as string | undefined;
    if (!base) throw new HelpAgentLlmError(0, `no adapter for the AI provider ${req.provider}`);

    // OpenAI's current models reject `max_tokens` and ask for `max_completion_tokens`; the other vendors only know `max_tokens`.
    const limit =
      req.provider === 'openai'
        ? { max_completion_tokens: req.maxTokens }
        : { max_tokens: req.maxTokens };

    let res: Response;
    try {
      res = await fetch(`${base.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${req.apiKey}` },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          tools: req.tools,
          tool_choice: req.toolChoice,
          parallel_tool_calls: false,
          ...limit,
        }),
        signal: AbortSignal.timeout(this.env.HELP_AGENT_TIMEOUT_MS),
      });
    } catch {
      throw new HelpAgentLlmError(0, 'the AI provider did not answer');
    }
    if (!res.ok) throw new HelpAgentLlmError(res.status, `the AI provider answered ${res.status}`);

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new HelpAgentLlmError(502, 'the AI provider answered with something that is not JSON');
    }
    const body = json as {
      id?: unknown;
      created?: unknown;
      model?: unknown;
      choices?: Array<{
        index?: unknown;
        finish_reason?: unknown;
        message?: { role?: unknown; content?: unknown; tool_calls?: unknown };
      }>;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    const choice = body.choices?.[0];
    if (!choice?.message) {
      throw new HelpAgentLlmError(502, 'the AI provider answered without a completion');
    }
    return {
      completion: {
        id: typeof body.id === 'string' ? body.id : 'help-agent',
        object: 'chat.completion',
        created: typeof body.created === 'number' ? body.created : Math.trunc(Date.now() / 1000),
        model: typeof body.model === 'string' ? body.model : req.model,
        choices: [
          {
            index: 0,
            finish_reason: typeof choice.finish_reason === 'string' ? choice.finish_reason : 'stop',
            message: {
              role: 'assistant',
              content: typeof choice.message.content === 'string' ? choice.message.content : null,
              ...(Array.isArray(choice.message.tool_calls)
                ? { tool_calls: choice.message.tool_calls }
                : {}),
            },
          },
        ],
        usage: {
          prompt_tokens: num(body.usage?.prompt_tokens),
          completion_tokens: num(body.usage?.completion_tokens),
          total_tokens: num(body.usage?.prompt_tokens) + num(body.usage?.completion_tokens),
        },
      },
      promptTokens: num(body.usage?.prompt_tokens),
      completionTokens: num(body.usage?.completion_tokens),
    };
  }
}
