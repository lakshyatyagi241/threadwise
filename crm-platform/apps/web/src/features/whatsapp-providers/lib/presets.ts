import type { Capabilities, Preset } from '../api/schemas';

/** Everything on: what Meta's own Cloud API supports. */
export const ALL_CAPABILITIES: Capabilities = {
  templates: true,
  mediaUpload: true,
  businessProfile: true,
  healthStatus: true,
  numberWebhookConfig: true,
  analytics: true,
};

/** A Graph-compatible proxy usually passes the messaging calls through and little else; the operator ticks what the BSP confirms. */
export const PROXY_CAPABILITIES: Capabilities = {
  templates: true,
  mediaUpload: true,
  businessProfile: true,
  healthStatus: true,
  numberWebhookConfig: false,
  analytics: false,
};

/**
 * The three starting points of the wizard. The API serves its own preset list (`GET /presets`); these are used when it is not
 * reachable and as the ids the wizard recognises for a preset-specific hint. Values are starting points: the operator confirms
 * every one against the BSP's own documentation in the next steps.
 */
export const FALLBACK_PRESETS: readonly Preset[] = [
  {
    key: 'interakt',
    label: 'Interakt Partner API',
    description:
      'Interakt as the BSP: a Meta Graph compatible proxy, one platform credential, the customer WABA and number sent in headers.',
    defaults: {
      key: 'interakt',
      label: 'Interakt Partner API',
      adapterKind: 'meta_graph',
      baseUrl: 'https://amped-express.interakt.ai/api',
      apiVersion: 'v24.0',
      authScheme: 'custom_headers',
      headerTemplates: { 'x-access-token': '{{providerToken}}', 'x-waba-id': '{{wabaId}}' },
      credentialMode: 'platform_token',
      webhookMode: 'number_level_override',
      signatureScheme: 'shared_secret_header',
      signatureHeader: 'x-webhook-secret',
      billingMode: 'provider_credit_line',
      capabilities: PROXY_CAPABILITIES,
      onboardingKind: 'manual',
    },
  },
  {
    key: 'meta_direct',
    label: 'Meta Cloud API (direct)',
    description:
      'Talk to Meta directly. Each customer connects their own WhatsApp account and Meta bills them.',
    defaults: {
      key: 'meta_direct',
      label: 'Meta Cloud API (direct)',
      adapterKind: 'meta_graph',
      baseUrl: 'https://graph.facebook.com',
      apiVersion: 'v23.0',
      authScheme: 'bearer',
      headerTemplates: {},
      credentialMode: 'channel_token',
      webhookMode: 'meta_app_level',
      signatureScheme: 'meta_app_secret_sha256',
      signatureHeader: null,
      billingMode: 'customer_direct',
      capabilities: ALL_CAPABILITIES,
      onboardingKind: 'manual',
    },
  },
  {
    key: 'custom',
    label: 'Custom Graph-compatible BSP',
    description:
      'Any other BSP that exposes the Meta Graph API under its own address. You set the address, the headers and the webhook rules.',
    defaults: {
      key: '',
      label: '',
      adapterKind: 'meta_graph',
      baseUrl: '',
      apiVersion: 'v23.0',
      authScheme: 'bearer',
      headerTemplates: {},
      credentialMode: 'platform_token',
      webhookMode: 'meta_app_level',
      signatureScheme: 'meta_app_secret_sha256',
      signatureHeader: null,
      billingMode: 'provider_credit_line',
      capabilities: PROXY_CAPABILITIES,
      onboardingKind: 'manual',
    },
  },
];

/**
 * The presets to show: the API's, with any built-in one the API does not know appended, so the three named starting points
 * are always offered. A preset from the API wins over the built-in with the same key.
 */
export function mergePresets(fromApi: readonly Preset[] | undefined): Preset[] {
  const out = [...(fromApi ?? [])];
  for (const p of FALLBACK_PRESETS) if (!out.some((o) => o.key === p.key)) out.push(p);
  return out;
}
