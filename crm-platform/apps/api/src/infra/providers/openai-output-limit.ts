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

/**
 * OpenAI's GPT-5 family and its reasoning models (o1, o3, o4) answer HTTP 400 "only the default (1) value is supported" to a request that
 * names a temperature, so a flow, an AI agent or the chatbot set to one of them could never answer. The field is left out for them, on
 * OpenAI's own endpoint only (a gateway or another vendor keeps it); `gpt-5-chat` still takes a temperature.
 */
export function openAiTemperature(
  model: string,
  temperature: number,
  nativeOpenAi: boolean,
): { temperature?: number } {
  const name = model.trim().toLowerCase();
  const fixed = /^(gpt-5|o[1-9])(?![a-z])/.test(name) && !name.startsWith('gpt-5-chat');
  return nativeOpenAi && fixed ? {} : { temperature };
}
