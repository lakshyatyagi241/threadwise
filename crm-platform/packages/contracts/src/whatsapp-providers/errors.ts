/**
 * Error codes of the WhatsApp provider registry (platform operator API) and the resolver. Spread into ERROR_CODES
 * (common/errors.ts) so the API and the web branch on one registry.
 */
export const WAP_ERROR_CODES = {
  /** The provider a number must send through is archived, unknown or has no credential its mode needs. */
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  /** The provider key is already taken. */
  WAP_PROVIDER_KEY_TAKEN: 'WAP_PROVIDER_KEY_TAKEN',
  /** A provider with numbers or workspaces on it cannot be archived; switch them away first. */
  WAP_PROVIDER_IN_USE: 'WAP_PROVIDER_IN_USE',
  /** The base URL is refused: not https, not a public host name, or it resolves to a private address. */
  WAP_BASE_URL_REFUSED: 'WAP_BASE_URL_REFUSED',
  /** The operation needs an active provider (assignment target, default, switch target). */
  WAP_PROVIDER_DISABLED: 'WAP_PROVIDER_DISABLED',
  /** The provider has no stored credential its mode needs (platform token mode without a token). */
  WAP_CREDENTIALS_MISSING: 'WAP_CREDENTIALS_MISSING',
  /** The default provider cannot be disabled or archived while it is the default: make another one the default first. */
  WAP_PROVIDER_IS_DEFAULT: 'WAP_PROVIDER_IS_DEFAULT',
  /** A built-in provider (`meta`, `interakt`) mirrors the WABA module's own routes: its address, headers and secrets are edited on the console WhatsApp settings page. */
  WAP_PROVIDER_BUILTIN: 'WAP_PROVIDER_BUILTIN',
  /** Nothing to switch: every selected number is already on the target provider. */
  WAP_SWITCH_NOTHING_TO_DO: 'WAP_SWITCH_NOTHING_TO_DO',
  /** The provider takes a partner onboarding flow but lacks something it needs (partner key, solution id or signup configuration). */
  WAP_PARTNER_NOT_CONFIGURED: 'WAP_PARTNER_NOT_CONFIGURED',
  /** The partner (Pinnacle) refused to create the client's account or take its embedded details. `message` is its own reason. */
  WAP_PARTNER_REFUSED: 'WAP_PARTNER_REFUSED',
} as const;
