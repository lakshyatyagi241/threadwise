import { z } from 'zod';

/**
 * The WhatsApp provider registry (platform level): which Business Solution Provider the SaaS sends WhatsApp through, set by the
 * platform operator, not by a workspace. Every value below is a closed list on purpose: a new kind of provider that needs its own
 * adapter class is a code change plus one more value here; a new Graph-compatible BSP is only a row.
 */

/** Which adapter class speaks to the provider. `meta_graph`: Meta's Graph API shape (paths and payloads), directly or behind a BSP proxy. */
export const WHATSAPP_ADAPTER_KINDS = ['meta_graph'] as const;
export const whatsappAdapterKindSchema = z.enum(WHATSAPP_ADAPTER_KINDS);
export type WhatsappAdapterKind = z.infer<typeof whatsappAdapterKindSchema>;

/** `bearer`: `Authorization: Bearer <token>`. `custom_headers`: the provider's own headers, rendered from `headerTemplates`. */
export const WHATSAPP_AUTH_SCHEMES = ['bearer', 'custom_headers'] as const;
export const whatsappAuthSchemeSchema = z.enum(WHATSAPP_AUTH_SCHEMES);
export type WhatsappAuthScheme = z.infer<typeof whatsappAuthSchemeSchema>;

/**
 * Whose credential does the work. `platform_token`: one credential of the platform (a BSP partner token), customers hold none.
 * `channel_token`: each channel holds its own access token (Meta directly, a customer's own Meta app).
 */
export const WHATSAPP_CREDENTIAL_MODES = ['platform_token', 'channel_token'] as const;
export const whatsappCredentialModeSchema = z.enum(WHATSAPP_CREDENTIAL_MODES);
export type WhatsappCredentialMode = z.infer<typeof whatsappCredentialModeSchema>;

/**
 * Where webhooks of this provider arrive. `meta_app_level`: one callback configured on the Meta app. `number_level_override`: the
 * platform sets a callback per number through the provider (`webhook_configuration`). `per_channel`: each channel has its own URL
 * and secret.
 */
export const WHATSAPP_WEBHOOK_MODES = ['meta_app_level', 'number_level_override', 'per_channel'] as const;
export const whatsappWebhookModeSchema = z.enum(WHATSAPP_WEBHOOK_MODES);
export type WhatsappWebhookMode = z.infer<typeof whatsappWebhookModeSchema>;

/** `meta_app_secret_sha256`: `X-Hub-Signature-256` over the raw body. `shared_secret_header`: a header carries the secret itself. */
export const WHATSAPP_SIGNATURE_SCHEMES = ['meta_app_secret_sha256', 'shared_secret_header'] as const;
export const whatsappSignatureSchemeSchema = z.enum(WHATSAPP_SIGNATURE_SCHEMES);
export type WhatsappSignatureScheme = z.infer<typeof whatsappSignatureSchemeSchema>;

/**
 * Who pays for the messages. This is a LABEL that points at the reseller billing engine (`bsp-billing-engine`), which owns the
 * money: `customer_direct` = the customer's own payment method is on Meta (engine mode `meta_direct`); `meta_reseller` = the
 * platform's Meta credit line is shared onto the customer's WABA (engine mode `reseller`); `provider_credit_line` = the BSP bills
 * the platform from its own credit line (no Meta credit allocation by us; the wallet engine charges the customer when the
 * workspace is pay-per-message).
 */
export const WHATSAPP_BILLING_MODES = ['provider_credit_line', 'customer_direct', 'meta_reseller'] as const;
export const whatsappBillingModeSchema = z.enum(WHATSAPP_BILLING_MODES);
export type WhatsappBillingMode = z.infer<typeof whatsappBillingModeSchema>;

/** The reseller billing engine's own mode name for a provider billing mode (`null`: the engine has no Meta credit line to manage). */
export function engineBillingModeOf(mode: WhatsappBillingMode): 'meta_direct' | 'reseller' | null {
  if (mode === 'customer_direct') return 'meta_direct';
  if (mode === 'meta_reseller') return 'reseller';
  return null;
}

export const WHATSAPP_ONBOARDING_METHODS = ['manual', 'embedded_signup'] as const;
export const whatsappOnboardingMethodSchema = z.enum(WHATSAPP_ONBOARDING_METHODS);
export type WhatsappOnboardingMethod = z.infer<typeof whatsappOnboardingMethodSchema>;

export const WHATSAPP_PROVIDER_STATUSES = ['active', 'disabled', 'error'] as const;
export const whatsappProviderStatusSchema = z.enum(WHATSAPP_PROVIDER_STATUSES);
export type WhatsappProviderStatus = z.infer<typeof whatsappProviderStatusSchema>;

/** What the provider can do. The adapter only makes the calls whose capability is true. */
export const whatsappProviderCapabilitiesSchema = z.object({
  templates: z.boolean(),
  mediaUpload: z.boolean(),
  businessProfile: z.boolean(),
  /** `?fields=health_status` is answered. */
  healthStatus: z.boolean(),
  /** `POST /{phone-number-id}` with `webhook_configuration` sets this number's callback. */
  numberWebhookConfig: z.boolean(),
  analytics: z.boolean(),
  /** Customers can be onboarded through an embedded signup flow of the platform's Meta app. */
  embeddedSignup: z.boolean(),
});
export type WhatsappProviderCapabilities = z.infer<typeof whatsappProviderCapabilitiesSchema>;

/** The credential names a provider can hold. Write only: nothing here is ever returned except a last-four hint. */
export const WHATSAPP_CREDENTIAL_KEYS = ['providerToken', 'appSecret', 'webhookSecret', 'verifyToken'] as const;
export const whatsappCredentialKeySchema = z.enum(WHATSAPP_CREDENTIAL_KEYS);
export type WhatsappCredentialKey = z.infer<typeof whatsappCredentialKeySchema>;
