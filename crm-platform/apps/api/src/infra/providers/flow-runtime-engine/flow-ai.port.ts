/**
 * The one outbound edge of the flow AI node (TW-FLR-030): a single completion against the vendor, with the key the AI keys domain
 * resolved for this workspace. The node and the call service are written against this interface, so a vendor is one adapter.
 */
export interface FlowAiRequest {
  /** openai, anthropic, gemini or mistral (and the other OpenAI-compatible vendors). */
  provider: string;
  model: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature: number;
  /** Structured-extraction mode: the vendor is asked for one JSON object. */
  json: boolean;
}

export interface FlowAiResult {
  /** The model's text; an empty string when the vendor returned nothing. */
  text: string;
  promptTokens: number;
  completionTokens: number;
}

export interface FlowAiPort {
  /** Throws on a vendor error, a timeout or an unknown provider; the call service turns that into a `provider_failed` outcome. */
  complete(req: FlowAiRequest): Promise<FlowAiResult>;
}

export const FLOW_AI_PORT = Symbol('FLR_AI_PORT');
