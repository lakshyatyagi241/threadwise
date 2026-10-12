/**
 * The one outbound edge of the Help assistant: a single OpenAI-style chat completion with tool calls against the vendor the platform
 * configured (docs/specs/help-agent-assistant.md section 4). Everything above this interface is written against it, so the vendor is
 * one adapter, never a change in the proxy service.
 */
export interface HelpAgentChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
}

export interface HelpAgentLlmRequest {
  /** `openai`, `mistral`, `deepseek` or `groq`: a vendor that speaks the OpenAI dialect. */
  provider: string;
  model: string;
  /** The vendor key. Never logged, never returned. */
  apiKey: string;
  messages: HelpAgentChatMessage[];
  tools: unknown[];
  toolChoice: unknown;
  maxTokens: number;
}

export interface HelpAgentLlmResult {
  /** The completion in the OpenAI shape, trimmed to the fields the client library reads. */
  completion: Record<string, unknown>;
  promptTokens: number;
  completionTokens: number;
}

/** A vendor refusal or failure. `status` is the vendor's HTTP status, 0 for a network error or a timeout. */
export class HelpAgentLlmError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HelpAgentLlmError';
  }
}

export interface HelpAgentLlmPort {
  /** Throws `HelpAgentLlmError` on a vendor error, a timeout or an answer that is not a completion. */
  complete(req: HelpAgentLlmRequest): Promise<HelpAgentLlmResult>;
}

export const HELP_AGENT_LLM_PORT = Symbol('HELP_AGENT_LLM_PORT');
