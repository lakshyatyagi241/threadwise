/**
 * The output-length field of an OpenAI chat-completions body, shared by every adapter that speaks that dialect. OpenAI's current models
 * reject `max_tokens` and take `max_completion_tokens`; the other vendors, and gateways, still take `max_tokens`.
 */
export function openAiOutputLimit(
  maxTokens: number,
  nativeOpenAi: boolean,
): { max_tokens: number } | { max_completion_tokens: number } {
  return nativeOpenAi ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
}
