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

/** What the vendor answered: the text and what it said the call used. */
export interface AiChatReply {
  /** The model's text; null for an empty completion. */
  text: string | null;
  /** The vendor's own token counts; null when its answer carries none (the caller then estimates from the text). */
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface AiChatPort {
  /**
   * The vendor's answer, or null when no call was made at all: no key configured for the provider, an unknown provider. A call that was
   * made returns a reply even when its text is empty (the vendor billed it). A vendor error or timeout throws, and the caller falls
   * back to the assistant's fallback message.
   */
  complete(req: AiChatRequest): Promise<AiChatReply | null>;
}

export const AI_CHAT_PORT = Symbol('WGT_AI_CHAT_PORT');
