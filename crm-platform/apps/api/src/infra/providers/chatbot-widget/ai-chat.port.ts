/**
 * The one outbound edge of the website chatbot widget's AI reply (TW-WGT-016): a single-shot text completion against the
 * vendor the assistant is configured for. Everything above this interface is written against it, so the model vendor is
 * one adapter, never a change in the widget's own code.
 */
export interface AiChatRequest {
  /** The assistant's `ai_provider` (openai, anthropic, gemini, mistral, ...). */
  provider: string;
  model: string;
  orgId: number;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature: number;
}

export interface AiChatPort {
  /**
   * The model's text, or null when there is nothing to say: no key configured for the provider, an unknown provider, an
   * empty completion. A vendor error or timeout throws, and the caller falls back to the assistant's fallback message.
   */
  complete(req: AiChatRequest): Promise<string | null>;
}

export const AI_CHAT_PORT = Symbol('WGT_AI_CHAT_PORT');
