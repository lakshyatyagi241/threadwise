/**
 * The knowledge base's one outbound call to an AI vendor: turn texts into vectors. The services are written against this interface; a
 * vendor is one adapter. The key is the caller's (AiKeyResolver): an adapter never reads one from the environment.
 */
export interface KbEmbedRequest {
  apiKey: string;
  /** A vendor/model slug, e.g. `openai/text-embedding-3-large`. */
  model: string;
  inputs: string[];
  /** The width the storage expects; an answer of any other width is refused. */
  dimensions: number;
}

export interface KbEmbedResult {
  /** One vector per input, in input order. */
  vectors: number[][];
  promptTokens: number;
}

export type KbAiErrorKind =
  'auth' | 'rate_limited' | 'provider' | 'timeout' | 'bad_response' | 'dimension_mismatch';

export class KbAiError extends Error {
  constructor(
    readonly kind: KbAiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'KbAiError';
  }
}

export interface KbAiPort {
  /** Throws KbAiError. */
  embed(req: KbEmbedRequest): Promise<KbEmbedResult>;
}

export const KB_AI_PORT = Symbol('KB_AI_PORT');
