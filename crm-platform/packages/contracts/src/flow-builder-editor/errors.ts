/**
 * Error codes of the flow builder and its editor (FLB). Spread into ERROR_CODES (common/errors.ts) so the API and the web branch
 * on one registry.
 */
export const FLB_ERROR_CODES = {
  /** The import file or pasted JSON is not a flow (no `flowNodes` array). */
  FLB_IMPORT_INVALID: 'FLB_IMPORT_INVALID',
  /** A template needs a graph: upload, paste, or the id of a flow to clone. */
  FLB_TEMPLATE_GRAPH_REQUIRED: 'FLB_TEMPLATE_GRAPH_REQUIRED',
  FLB_TRIGGER_KEYWORDS_TOO_LONG: 'FLB_TRIGGER_KEYWORDS_TOO_LONG',
  /** A step starts a bot of another channel, the bot itself, or (on publish) a bot that no longer exists. */
  FLB_FLOW_LINK_INVALID: 'FLB_FLOW_LINK_INVALID',
  /** The AI generator has no key for the chosen provider (workspace or admin). */
  FLB_AI_NO_KEY: 'FLB_AI_NO_KEY',
  FLB_AI_PROVIDER_FAILED: 'FLB_AI_PROVIDER_FAILED',
  FLB_AI_BAD_JSON: 'FLB_AI_BAD_JSON',
  FLB_UPLOAD_REJECTED: 'FLB_UPLOAD_REJECTED',
  /** Media storage is not configured on this deployment. */
  FLB_STORAGE_UNAVAILABLE: 'FLB_STORAGE_UNAVAILABLE',
  /** Google Sheets / Docs / Forms pickers: the Google integration is not connected on this deployment. */
  FLB_INTEGRATION_DISABLED: 'FLB_INTEGRATION_DISABLED',
  /** Geta publishing: the workspace has no complete credentials (base URL, authorization, geta-host, chatbot record). */
  FLB_GETA_NOT_CONFIGURED: 'FLB_GETA_NOT_CONFIGURED',
  /** Geta publishing: the pasted chatbot record, or the base URL, is not acceptable. */
  FLB_GETA_SETTINGS_INVALID: 'FLB_GETA_SETTINGS_INVALID',
  /** Retry asked for a flow that is a draft or whose push is already running or live. */
  FLB_GETA_NOT_RETRYABLE: 'FLB_GETA_NOT_RETRYABLE',
} as const;
