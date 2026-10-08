import {
  engineBillingModeOf,
  type CredentialState,
  type ProviderSummary,
  type WhatsappProvider,
} from '@crm/contracts';
import type { WabaEnv } from '../../config/domains/whatsapp-cloud-api-waba.env';
import { credentialStates, last4, type ProviderRow } from '../whatsapp-provider-registry';

const state = (secret: string | undefined): CredentialState =>
  secret ? { set: true, last4: last4(secret) } : { set: false, last4: null };

/**
 * A provider row as the operator API returns it. The two built-in providers mirror the WABA module's own routes, so their address,
 * version and secrets are read live from `WABA_ENV` (which the console WhatsApp settings page overrides) and not from the seeded row.
 * Secrets are never part of the answer: only whether each is stored and its last four characters.
 */
export function toProvider(row: ProviderRow, env: WabaEnv, webhookPath: string): WhatsappProvider {
  let baseUrl = row.base_url;
  let apiVersion = row.api_version;
  let credentials = credentialStates(row.credential_hints);
  if (row.builtin === 'meta') {
    baseUrl = env.META_API_ENDPOINT;
    apiVersion = env.META_API_VERSION;
    credentials = {
      providerToken: { set: false, last4: null },
      appSecret: state(env.META_APP_SECRET),
      webhookSecret: { set: false, last4: null },
      verifyToken: state(env.WABA_VERIFY_TOKEN),
    };
  } else if (row.builtin === 'interakt') {
    baseUrl = env.INTERAKT_API_ENDPOINT;
    apiVersion = env.INTERAKT_API_VERSION;
    credentials = {
      providerToken: state(env.INTERAKT_PARTNER_AUTH_KEY),
      appSecret: { set: false, last4: null },
      webhookSecret: { set: false, last4: null },
      verifyToken: state(env.WABA_VERIFY_TOKEN),
    };
  }
  const onboardingAppId = row.builtin ? (env.META_APP_ID ?? null) : row.onboarding_app_id;
  const onboardingConfigId = row.builtin
    ? (env.META_EMBEDDED_CONFIG_ID ?? null)
    : row.onboarding_config_id;
  const last = row.last_test as {
    ok: boolean;
    testedAt: string;
    latencyMs: number;
    httpStatus: number | null;
    errorCode: string | null;
    message: string | null;
  } | null;
  return {
    id: row.uuid,
    key: row.key,
    label: row.label,
    adapterKind: 'meta_graph',
    baseUrl,
    apiVersion,
    authScheme: row.auth_scheme,
    headerTemplates: row.header_templates,
    credentialMode: row.credential_mode,
    webhookMode: row.webhook_mode,
    signatureScheme: row.signature_scheme,
    signatureHeaderName: row.signature_header_name,
    billingMode: row.billing_mode,
    engineBillingMode: engineBillingModeOf(row.billing_mode),
    capabilities: { mediaUpload: row.capabilities?.mediaUpload !== false },
    onboarding: row.onboarding,
    onboardingAppId,
    onboardingConfigId,
    partnerProgram: row.builtin ? null : (row.partner_program ?? null),
    partnerSolutionId: row.builtin ? null : (row.partner_solution_id ?? null),
    status: row.status,
    isDefault: row.is_default,
    builtin: row.builtin,
    notes: row.notes,
    credentials,
    webhookPath,
    lastTest: last ?? null,
    numberCount: row.number_count ?? 0,
    workspaceCount: row.workspace_count ?? 0,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    rowVersion: row.row_version,
  };
}

export const summaryOf = (row: Pick<ProviderRow, 'uuid' | 'key' | 'label'>): ProviderSummary => ({
  id: row.uuid,
  key: row.key,
  label: row.label,
});
