/** Error codes of PQL (plain English contact search). Spread into ERROR_CODES (common/errors.ts). */
export const PQL_ERROR_CODES = {
  /** No OpenRouter key resolves (the platform's shared key is not set up). 422. */
  PQL_NO_KEY: 'PQL_NO_KEY',
  /** The AI provider refused the key, timed out, or answered something that is not a rule tree. 502 (422 for a refused key). */
  PQL_PROVIDER_FAILED: 'PQL_PROVIDER_FAILED',
} as const;
