import type { TranslationProviderSlug } from '@crm/contracts';

/** What a driver returns from a detect-and-translate call. Either half may be missing (a partial result). */
export interface DetectedTranslation {
  language: string | null;
  text: string | null;
}

/**
 * One translation backend. Drivers never throw: a transport error, a bad status, an empty body or an exhausted quota
 * all come back as a null result so the router can move on to the next provider (TW-I18N-019).
 */
export interface TranslationDriver {
  readonly slug: TranslationProviderSlug;
  translate(text: string, from: string, to: string): Promise<string | null>;
  /** Source language is detected by the provider; `target` is where the text should end up. */
  detectAndTranslate(text: string, target: string): Promise<DetectedTranslation>;
}

/** The form field a driver needs from the operator (TW-I18N-014). */
export interface CredentialSpec {
  key: string;
  label: string;
  type: 'text' | 'password';
  required: boolean;
  hint: string | null;
  placeholder: string | null;
}

/** A shared flag with a time-to-live: the quota circuit breaker must hold across processes (Redis in production). */
export interface BreakerStore {
  isOpen(key: string): Promise<boolean>;
  open(key: string, ttlSeconds: number): Promise<void>;
}

export interface DriverDeps {
  fetch: typeof fetch;
  breaker: BreakerStore;
  /** Per-call budget. Reference used 4 seconds; a driver that is slower than this has effectively failed. */
  timeoutMs: number;
}

export type Credentials = Record<string, string>;

export const NO_DETECTION: DetectedTranslation = { language: null, text: null };
