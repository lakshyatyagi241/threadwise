/**
 * AI lead scoring's one outbound call to an AI vendor: a chat completion that answers JSON. The service is written against this
 * interface; a vendor is one adapter. The key is the caller's (AiKeyResolver): an adapter never reads one from the environment.
 */
export interface LeadScoreRequest {
  apiKey: string;
  /** A vendor/model slug, e.g. `openai/gpt-6-luna-pro`. */
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}

export interface LeadScoreCompletion {
  /** The model's raw text; the caller parses it (the adapter does not know the prompt's format). */
  text: string;
  promptTokens: number;
  completionTokens: number;
  /** What the vendor says the call cost, in USD; null when it did not report one. */
  costUsd: number | null;
}

export type LeadScoringAiErrorKind =
  'auth' | 'rate_limited' | 'provider' | 'timeout' | 'bad_response';

export class LeadScoringAiError extends Error {
  constructor(
    readonly kind: LeadScoringAiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'LeadScoringAiError';
  }

  /** A failure that a later attempt may not repeat (the key being refused will repeat; a busy vendor may not). */
  get retryable(): boolean {
    return this.kind === 'rate_limited' || this.kind === 'timeout' || this.kind === 'provider';
  }
}

export interface LeadScoringAiPort {
  /** Throws LeadScoringAiError. */
  complete(req: LeadScoreRequest): Promise<LeadScoreCompletion>;
}

export const LEAD_SCORING_AI_PORT = Symbol('LEAD_SCORING_AI_PORT');

/** How a plain English contact search (PQL) system prompt starts; the offline fixture recognises it by this. */
export const PQL_SYSTEM_PREFIX =
  'You turn a plain English contact search into a JSON filter for a CRM.';
