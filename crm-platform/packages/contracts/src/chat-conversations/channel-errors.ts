/**
 * Error codes of the channel registry and the send guard. Spread into ERROR_CODES (common/errors.ts) so the API and the web branch
 * on one registry. Codes the guard shares with other domains (SERVICE_WINDOW_CLOSED, PLAN_LIMIT_REACHED, AUTH_SEND_HALTED) keep
 * their existing names.
 */
export const CHANNEL_ERROR_CODES = {
  /** The channel is not `connected`: nothing may be sent through it. */
  CHANNEL_DISCONNECTED: 'CHANNEL_DISCONNECTED',
  /** The kind has no adapter in this deployment, or its adapter cannot be switched on yet. */
  CHANNEL_KIND_UNAVAILABLE: 'CHANNEL_KIND_UNAVAILABLE',
  /** The channel still has conversations: remove them, or disconnect the channel instead. */
  CHANNEL_IN_USE: 'CHANNEL_IN_USE',
  /** The same provider account is already connected in this workspace. */
  CHANNEL_ALREADY_CONNECTED: 'CHANNEL_ALREADY_CONNECTED',
  /** The dev simulator is switched off (flag) or forbidden (production). */
  CHANNEL_SIMULATOR_DISABLED: 'CHANNEL_SIMULATOR_DISABLED',
  /** The message needs something the channel cannot do (a template, a media kind). */
  CHANNEL_CAPABILITY_UNSUPPORTED: 'CHANNEL_CAPABILITY_UNSUPPORTED',
} as const;
