/**
 * The text-generation call the flow generator makes (TW-FLB-025). A port: the flows module is written against this
 * interface and knows no vendor. `generate` resolves with the model's raw text, or null when the provider answered with
 * nothing usable; it rejects on transport failures (the service turns both into the same user-facing error).
 */
export const FLOW_AI_PORT = Symbol('FLOW_AI_PORT');

export type FlowAiProvider = 'openai' | 'anthropic' | 'gemini';

export interface FlowAiRequest {
  provider: FlowAiProvider;
  model: string;
  apiKey: string;
  system: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
  /** Ask the vendor for a strict JSON object. */
  json: boolean;
}

export interface FlowAiPort {
  generate(req: FlowAiRequest): Promise<string | null>;
}
