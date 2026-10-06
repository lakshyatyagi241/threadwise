import { z } from 'zod';

/**
 * The WhatsApp provider registry (platform level): which Business Solution Provider (BSP) the SaaS sends WhatsApp through, set by the
 * platform operator, not by a workspace. Every value below is a closed list on purpose: a provider that needs its own adapter class is a
 * code change plus one more value here; a Graph-compatible BSP is only a row.
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
 * `channel_token`: each number holds its own access token (Meta directly, a customer's own Meta app).
 */
export const WHATSAPP_CREDENTIAL_MODES = ['platform_token', 'channel_token'] as const;
export const whatsappCredentialModeSchema = z.enum(WHATSAPP_CREDENTIAL_MODES);
export type WhatsappCredentialMode = z.infer<typeof whatsappCredentialModeSchema>;

/**
 * How the platform's webhook is wired at the provider. `meta_app_level`: one callback configured on the Meta app, the platform only
 * subscribes the WABA. `number_level_override`: the platform also sets the callback per WABA / number through the provider.
 */
export const WHATSAPP_WEBHOOK_MODES = ['meta_app_level', 'number_level_override'] as const;
export const whatsappWebhookModeSchema = z.enum(WHATSAPP_WEBHOOK_MODES);
export type WhatsappWebhookMode = z.infer<typeof whatsappWebhookModeSchema>;

/**
 * How a delivery of this provider proves where it came from. `meta_app_secret_sha256`: `X-Hub-Signature-256` (HMAC-SHA256 of the raw
 * body) with the provider's app secret. `shared_secret_header`: a named header carries the provider's webhook secret itself. `none`:
 * the provider signs nothing; only the secret in the callback URL we registered (`?k=`) authenticates the call. Unsigned deliveries are
 * refused for every scheme but `none`.
 */
export const WHATSAPP_SIGNATURE_SCHEMES = [
  'meta_app_secret_sha256',
  'shared_secret_header',
  'none',
] as const;
export const whatsappSignatureSchemeSchema = z.enum(WHATSAPP_SIGNATURE_SCHEMES);
export type WhatsappSignatureScheme = z.infer<typeof whatsappSignatureSchemeSchema>;

/**
 * Who pays Meta for the messages. A LABEL that points at the reseller billing engine (`bsp-billing-engine`), which owns the money; it
 * changes no billing behaviour. `customer_direct` = the customer's own payment method is on Meta (engine mode `meta_direct`);
 * `meta_reseller` = the platform's Meta credit line is shared onto the customer's WABA (engine mode `reseller`);
 * `provider_credit_line` = the BSP bills the platform from its own credit line (no Meta credit allocation by us).
 */
export const WHATSAPP_BILLING_MODES = [
  'provider_credit_line',
  'customer_direct',
  'meta_reseller',
] as const;
export const whatsappBillingModeSchema = z.enum(WHATSAPP_BILLING_MODES);
export type WhatsappBillingMode = z.infer<typeof whatsappBillingModeSchema>;

/** The reseller billing engine's own mode name for a provider billing mode (`null`: the engine has no Meta credit line to manage). */
export function engineBillingModeOf(mode: WhatsappBillingMode): 'meta_direct' | 'reseller' | null {
  if (mode === 'customer_direct') return 'meta_direct';
  if (mode === 'meta_reseller') return 'reseller';
  return null;
}

/**
 * A partner onboarding flow a provider takes after Embedded Signup. `pinnacle`: create the client's Pinnacle account (its apikey is the
 * number's channel token), send the embedded details, then share the Meta credit line. `null`: none (the number connects as it always did).
 */
export const WHATSAPP_PARTNER_PROGRAMS = ['pinnacle'] as const;
export const whatsappPartnerProgramSchema = z.enum(WHATSAPP_PARTNER_PROGRAMS);
export type WhatsappPartnerProgram = z.infer<typeof whatsappPartnerProgramSchema>;

export const WHATSAPP_ONBOARDING_METHODS = ['manual', 'embedded_signup'] as const;
export const whatsappOnboardingMethodSchema = z.enum(WHATSAPP_ONBOARDING_METHODS);
export type WhatsappOnboardingMethod = z.infer<typeof whatsappOnboardingMethodSchema>;

/**
 * `active`: selectable and in use. `disabled`: not selectable for new numbers or assignments; numbers already on it keep sending (so
 * disabling is never an outage, switch them away at leisure). `archived`: retired; refused while a number or workspace still uses it.
 */
export const WHATSAPP_PROVIDER_STATUSES = ['active', 'disabled', 'archived'] as const;
export const whatsappProviderStatusSchema = z.enum(WHATSAPP_PROVIDER_STATUSES);
export type WhatsappProviderStatus = z.infer<typeof whatsappProviderStatusSchema>;

/** What the provider can do. Only the calls whose capability is true are made through it. */
export const whatsappProviderCapabilitiesSchema = z.object({
  /** A file can be uploaded to the provider's media storage (`POST /{phone-number-id}/media`); false: files go by public link. */
  mediaUpload: z.boolean(),
});
export type WhatsappProviderCapabilities = z.infer<typeof whatsappProviderCapabilitiesSchema>;

/** The credential names a provider can hold. Write only: nothing here is ever returned except a last-four hint. */
export const WHATSAPP_CREDENTIAL_KEYS = [
  'providerToken',
  'appSecret',
  'webhookSecret',
  'verifyToken',
] as const;
export const whatsappCredentialKeySchema = z.enum(WHATSAPP_CREDENTIAL_KEYS);
export type WhatsappCredentialKey = z.infer<typeof whatsappCredentialKeySchema>;

/** The two providers the WABA module has built in; their rows mirror its own routes and are seeded by migration. */
export const WHATSAPP_BUILTIN_PROVIDER_KEYS = ['meta', 'interakt'] as const;
export type WhatsappBuiltinProviderKey = (typeof WHATSAPP_BUILTIN_PROVIDER_KEYS)[number];
export const isBuiltinWhatsappProviderKey = (key: string): key is WhatsappBuiltinProviderKey =>
  (WHATSAPP_BUILTIN_PROVIDER_KEYS as readonly string[]).includes(key);
