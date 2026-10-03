import type { HeaderTemplates } from './header-templates';
import type {
  WhatsappAdapterKind,
  WhatsappAuthScheme,
  WhatsappBillingMode,
  WhatsappCredentialKey,
  WhatsappCredentialMode,
  WhatsappOnboardingMethod,
  WhatsappProviderCapabilities,
  WhatsappSignatureScheme,
  WhatsappWebhookMode,
} from './enums';

/**
 * Provider PRESETS: templates an operator instantiates (`POST /v2/platform/whatsapp-providers` with `presetKey`), so adding a
 * well-known provider is a form with the secrets left to fill, not a blank page of technical fields. A preset is data in the
 * repository and carries no secret and no live row: nothing is sent anywhere until the operator saves credentials and tests it.
 * Secrets are always typed into the admin panel; they are never in the repository or the environment.
 */
export interface WhatsappProviderPreset {
  presetKey: string;
  label: string;
  description: string;
  /** The suggested provider key (the operator may change it). */
  suggestedKey: string;
  adapterKind: WhatsappAdapterKind;
  baseUrl: string;
  apiVersion: string;
  authScheme: WhatsappAuthScheme;
  headerTemplates: HeaderTemplates;
  credentialMode: WhatsappCredentialMode;
  webhookMode: WhatsappWebhookMode;
  signatureScheme: WhatsappSignatureScheme;
  signatureHeaderName: string | null;
  billingMode: WhatsappBillingMode;
  capabilities: WhatsappProviderCapabilities;
  onboarding: WhatsappOnboardingMethod;
  /** The credential keys the operator must supply before the provider can be activated. */
  credentialsNeeded: readonly WhatsappCredentialKey[];
  notes: string;
}

export const WHATSAPP_PROVIDER_PRESETS: readonly WhatsappProviderPreset[] = [
  {
    presetKey: 'meta_cloud_direct',
    label: 'Meta Cloud API (direct)',
    description:
      "Meta's own WhatsApp Cloud API. Each channel holds its own access token and the customer's Meta app signs the webhooks. Use it for customers who bring their own Meta account, or as the fallback provider.",
    suggestedKey: 'meta_direct',
    adapterKind: 'meta_graph',
    baseUrl: 'https://graph.facebook.com',
    apiVersion: 'v23.0',
    authScheme: 'bearer',
    headerTemplates: {},
    credentialMode: 'channel_token',
    webhookMode: 'per_channel',
    signatureScheme: 'meta_app_secret_sha256',
    signatureHeaderName: null,
    billingMode: 'customer_direct',
    capabilities: {
      templates: true,
      mediaUpload: true,
      businessProfile: true,
      healthStatus: true,
      numberWebhookConfig: true,
      analytics: true,
      embeddedSignup: false,
    },
    onboarding: 'manual',
    credentialsNeeded: [],
    notes: 'No platform credential. Customers paste their own access token and app secret when they connect a number.',
  },
  {
    presetKey: 'interakt_partner',
    label: 'Interakt Partner API',
    description:
      "Interakt's Partner API: a Graph-compatible proxy with the same paths and payloads as Meta's WhatsApp Cloud API, one platform partner token, and the customer's WABA and number ids in headers. Customers are onboarded through the platform's Meta app (embedded signup) with the BSP added as solution provider, so they hold no token.",
    suggestedKey: 'interakt',
    adapterKind: 'meta_graph',
    baseUrl: 'https://amped-express.interakt.ai/api',
    apiVersion: 'v24.0',
    authScheme: 'custom_headers',
    headerTemplates: {
      'x-access-token': '{{providerToken}}',
      'x-waba-id': '{{wabaId}}',
      'x-phone-number-id': '{{phoneNumberId}}',
    },
    credentialMode: 'platform_token',
    webhookMode: 'number_level_override',
    signatureScheme: 'meta_app_secret_sha256',
    signatureHeaderName: null,
    billingMode: 'provider_credit_line',
    capabilities: {
      templates: true,
      mediaUpload: true,
      businessProfile: true,
      healthStatus: true,
      numberWebhookConfig: true,
      analytics: true,
      embeddedSignup: true,
    },
    onboarding: 'embedded_signup',
    credentialsNeeded: ['providerToken'],
    notes:
      "A second Interakt account, or another Graph-compatible BSP with the same shape. The built-in `interakt` provider already covers the platform's own partner account (its values live on the console WhatsApp settings page). Interakt documents no webhook body signature, so without an app secret on this provider its deliveries are refused (fail closed). Not verified against a live account.",
  },
];

export function findWhatsappProviderPreset(presetKey: string): WhatsappProviderPreset | undefined {
  return WHATSAPP_PROVIDER_PRESETS.find((p) => p.presetKey === presetKey);
}
