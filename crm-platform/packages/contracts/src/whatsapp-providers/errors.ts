/**
 * Error codes of the WhatsApp provider registry (platform operator API) and the resolver. Spread into ERROR_CODES
 * (common/errors.ts) so the API and the web branch on one registry.
 */
export const WAP_ERROR_CODES = {
  /**
   * The provider a WhatsApp channel must send through is disabled, in error or missing. Also the `ChannelError` code (never
   * retryable) a send fails with, so a message that cannot go out says why instead of retrying into a wall.
   */
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  /** The provider key is already taken. */
  WAP_PROVIDER_KEY_TAKEN: 'WAP_PROVIDER_KEY_TAKEN',
  /** A provider with channels on it cannot be deleted; switch them away first. */
  WAP_PROVIDER_IN_USE: 'WAP_PROVIDER_IN_USE',
  /** The base URL is refused: not https, not a public host name, or it resolves to a private address. */
  WAP_BASE_URL_REFUSED: 'WAP_BASE_URL_REFUSED',
  /** A header name or template is refused (hop-by-hop header, unknown placeholder, control characters). */
  WAP_HEADER_TEMPLATE_INVALID: 'WAP_HEADER_TEMPLATE_INVALID',
  /** The operation needs an active provider. */
  WAP_PROVIDER_DISABLED: 'WAP_PROVIDER_DISABLED',
  /** The provider has no stored credential its mode needs (platform token mode without a token). */
  WAP_CREDENTIALS_MISSING: 'WAP_CREDENTIALS_MISSING',
  /** The default provider cannot be deleted while it is the default: make another one the default first. */
  WAP_PROVIDER_IS_DEFAULT: 'WAP_PROVIDER_IS_DEFAULT',
  /** Only a WhatsApp Cloud channel has a provider. */
  WAP_CHANNEL_NOT_WHATSAPP: 'WAP_CHANNEL_NOT_WHATSAPP',
  /** The channel is already on the target provider. */
  WAP_SWITCH_NOOP: 'WAP_SWITCH_NOOP',
  /** The channel lacks what the target provider needs (a WABA id, a phone number id, or its own token). */
  WAP_CHANNEL_INCOMPLETE: 'WAP_CHANNEL_INCOMPLETE',
  /** The target provider could not reach the channel's WABA with the channel's ids: nothing was switched. */
  WAP_SWITCH_UNREACHABLE: 'WAP_SWITCH_UNREACHABLE',
  /** Messages are still queued on the channel; wait for them to leave or pass `force`. */
  WAP_SWITCH_QUEUE_BUSY: 'WAP_SWITCH_QUEUE_BUSY',
  /** A built-in provider (`meta`, `interakt`) mirrors the WABA module's own routes: its address, headers and secrets are edited on the console WhatsApp settings page, not here. */
  WAP_PROVIDER_BUILTIN: 'WAP_PROVIDER_BUILTIN',
  /** The preset key does not exist. */
  WAP_PRESET_UNKNOWN: 'WAP_PRESET_UNKNOWN',
} as const;
