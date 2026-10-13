/**
 * Error codes of AI lead scoring (LSC). Spread into ERROR_CODES (common/errors.ts) so the API and the web branch on one registry.
 */
export const LSC_ERROR_CODES = {
  /** The platform operator switched AI lead scoring off for every workspace. 422. */
  LSC_PLATFORM_DISABLED: 'LSC_PLATFORM_DISABLED',
  /** The workspace has not switched AI lead scoring on (it is opt-in: contact data goes to an AI vendor). 422. */
  LSC_NOT_ENABLED: 'LSC_NOT_ENABLED',
  /** No OpenRouter key resolves for the workspace (its own, or the platform's shared one). 422. */
  LSC_NO_KEY: 'LSC_NO_KEY',
  /** The AI provider refused the key, timed out, or answered something that is not a score. 502 (422 for a refused key). */
  LSC_PROVIDER_FAILED: 'LSC_PROVIDER_FAILED',
  /** The contact has a score a person typed, so the scorer never overwrites it. 409. */
  LSC_MANUAL_SCORE: 'LSC_MANUAL_SCORE',
  /** Reading conversations is not available to this workspace (a pilot feature) or it has not switched it on. 422. */
  LSC_CHAT_DIGEST_UNAVAILABLE: 'LSC_CHAT_DIGEST_UNAVAILABLE',
  /** The contact has not said enough for the chat to be read yet (no messages, or only greetings and button taps). 422. */
  LSC_NOT_ENOUGH_CHAT: 'LSC_NOT_ENOUGH_CHAT',
  /** The stage suggestion was already decided, replaced or has expired. 409. */
  LSC_SUGGESTION_GONE: 'LSC_SUGGESTION_GONE',
} as const;
