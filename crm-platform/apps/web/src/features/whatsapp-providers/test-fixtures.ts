import type { SwitchWorkspaceProviderResponse, WhatsappProvider } from '@crm/contracts';

/** Shared fixtures of this feature's tests: one provider and one switch answer, with overrides. Never imported by app code. */

export const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function provider(over: Partial<WhatsappProvider> = {}): WhatsappProvider {
  return {
    id: ID(1),
    key: 'pinnacle',
    label: 'Pinnacle BSP',
    adapterKind: 'meta_graph',
    baseUrl: 'https://api.pinnacle.example-bsp.com/wa',
    apiVersion: 'v25.0',
    authScheme: 'custom_headers',
    headerTemplates: { 'x-api-key': '{{providerToken}}' },
    credentialMode: 'platform_token',
    webhookMode: 'number_level_override',
    signatureScheme: 'shared_secret_header',
    signatureHeaderName: 'x-bsp-secret',
    billingMode: 'provider_credit_line',
    engineBillingMode: null,
    capabilities: { mediaUpload: false },
    onboarding: 'manual',
    onboardingAppId: null,
    onboardingConfigId: null,
    status: 'disabled',
    isDefault: false,
    builtin: null,
    notes: null,
    credentials: {
      providerToken: { set: true, last4: '9f2a' },
      appSecret: { set: false, last4: null },
      webhookSecret: { set: true, last4: 'c0de' },
      verifyToken: { set: false, last4: null },
    },
    webhookPath: '/v2/public/webhooks/whatsapp',
    lastTest: null,
    numberCount: 0,
    workspaceCount: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    rowVersion: 3,
    ...over,
  };
}

export function switchResponse(
  over: Partial<SwitchWorkspaceProviderResponse> = {},
): SwitchWorkspaceProviderResponse {
  const from = { id: ID(10), key: 'meta', label: 'Meta' };
  const out = (
    n: number,
    state: SwitchWorkspaceProviderResponse['numbers'][number]['state'],
    extra = {},
  ) => ({
    numberId: ID(100 + n),
    label: `Number ${n}`,
    phoneNumber: `+1555000${n}`,
    from,
    state,
    requirements: [] as SwitchWorkspaceProviderResponse['numbers'][number]['requirements'],
    resubscribe: true,
    inboundWired: null,
    message: null,
    ...extra,
  });
  return {
    dryRun: true,
    workspaceId: ID(7),
    to: { id: ID(20), key: 'pinnacle', label: 'Pinnacle BSP' },
    overrideSet: false,
    numbers: [
      out(1, 'ready'),
      out(2, 'ready', { requirements: ['reconnect_needed'], resubscribe: false }),
      out(3, 'blocked', { requirements: ['number_token_needed'] }),
    ],
    ...over,
  };
}
