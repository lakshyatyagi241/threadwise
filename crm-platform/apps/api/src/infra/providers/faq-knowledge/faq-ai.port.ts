/**
 * The FAQ engine's two outbound calls to an AI vendor (ADR-0021): turn texts into vectors, and write variation suggestions. The
 * services are written against this interface; a vendor is one adapter. The key is the caller's (AiKeyResolver): an adapter never
 * reads one from the environment.
 */
export interface FaqEmbedRequest {
  apiKey: string;
  /** A vendor/model slug, e.g. `openai/text-embedding-3-large`. */
  model: string;
  inputs: string[];
  /** The width the storage expects; an answer of any other width is refused. */
  dimensions: number;
}

export interface FaqEmbedResult {
  /** One vector per input, in input order. */
  vectors: number[][];
  promptTokens: number;
}

export interface FaqSuggestRequest {
  apiKey: string;
  model: string;
  question: string;
  /** Phrasings the FAQ already has: the model is told not to repeat them. */
  existing: string[];
  count: number;
}

export interface FaqSuggestResult {
  /** The model's raw text; the caller parses it (the adapter does not know the prompt's format). */
  text: string;
  promptTokens: number;
  completionTokens: number;
}

export type FaqAiErrorKind =
  'auth' | 'rate_limited' | 'provider' | 'timeout' | 'bad_response' | 'dimension_mismatch';

export class FaqAiError extends Error {
  constructor(
    readonly kind: FaqAiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'FaqAiError';
  }
}

export interface FaqAiPort {
  /** Throws FaqAiError. */
  embed(req: FaqEmbedRequest): Promise<FaqEmbedResult>;
  /** Throws FaqAiError. */
  complete(req: FaqSuggestRequest & { system: string; user: string }): Promise<FaqSuggestResult>;
}

export const FAQ_AI_PORT = Symbol('FAQ_AI_PORT');
