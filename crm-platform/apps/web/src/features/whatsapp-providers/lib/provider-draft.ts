import type {
  AdapterKind,
  AuthScheme,
  BillingMode,
  Capabilities,
  CredentialMode,
  OnboardingKind,
  Preset,
  Provider,
  ProviderInput,
  ProviderUpdateInput,
  SignatureScheme,
  WebhookMode,
} from '../api/schemas';
import {
  missingTokenPlaceholder,
  recordFromRows,
  rowsFromRecord,
  validateHeaderRows,
  type HeaderRow,
} from './header-templates';
import { ALL_CAPABILITIES } from './presets';
import { API_VERSION_RE, PROVIDER_KEY_RE, checkBaseUrl } from './urls';

/** A write-only field. `value` replaces the stored secret; `clear` removes it; neither leaves it as it is. */
export interface SecretEdit {
  value: string;
  clear: boolean;
}
export const noSecret = (): SecretEdit => ({ value: '', clear: false });

export interface ProviderDraft {
  key: string;
  label: string;
  adapterKind: AdapterKind;
  baseUrl: string;
  apiVersion: string;
  authScheme: AuthScheme;
  headers: HeaderRow[];
  credentialMode: CredentialMode;
  providerToken: SecretEdit;
  appSecret: SecretEdit;
  verifyToken: SecretEdit;
  webhookMode: WebhookMode;
  signatureScheme: SignatureScheme;
  signatureHeader: string;
  billingMode: BillingMode;
  capabilities: Capabilities;
  onboardingKind: OnboardingKind;
  onboardingAppId: string;
  onboardingConfigId: string;
}

export function emptyDraft(): ProviderDraft {
  return {
    key: '',
    label: '',
    adapterKind: 'meta_graph',
    baseUrl: '',
    apiVersion: 'v23.0',
    authScheme: 'bearer',
    headers: [],
    credentialMode: 'platform_token',
    providerToken: noSecret(),
    appSecret: noSecret(),
    verifyToken: noSecret(),
    webhookMode: 'meta_app_level',
    signatureScheme: 'meta_app_secret_sha256',
    signatureHeader: '',
    billingMode: 'provider_credit_line',
    capabilities: { ...ALL_CAPABILITIES },
    onboardingKind: 'manual',
    onboardingAppId: '',
    onboardingConfigId: '',
  };
}

/** The wizard's step 1: the preset's values over an empty draft. Secrets are never part of a preset. */
export function draftFromPreset(preset: Preset): ProviderDraft {
  const d = emptyDraft();
  const p = preset.defaults;
  return {
    ...d,
    key: p.key ?? d.key,
    label: p.label ?? d.label,
    adapterKind: p.adapterKind ?? d.adapterKind,
    baseUrl: p.baseUrl ?? d.baseUrl,
    apiVersion: p.apiVersion ?? d.apiVersion,
    authScheme: p.authScheme ?? d.authScheme,
    headers: rowsFromRecord(p.headerTemplates ?? {}),
    credentialMode: p.credentialMode ?? d.credentialMode,
    webhookMode: p.webhookMode ?? d.webhookMode,
    signatureScheme: p.signatureScheme ?? d.signatureScheme,
    signatureHeader: p.signatureHeader ?? d.signatureHeader,
    billingMode: p.billingMode ?? d.billingMode,
    capabilities: { ...(p.capabilities ?? d.capabilities) },
    onboardingKind: p.onboardingKind ?? d.onboardingKind,
  };
}

export function draftFromProvider(p: Provider): ProviderDraft {
  return {
    key: p.key,
    label: p.label,
    adapterKind: p.adapterKind,
    baseUrl: p.baseUrl,
    apiVersion: p.apiVersion,
    authScheme: p.authScheme,
    headers: rowsFromRecord(p.headerTemplates),
    credentialMode: p.credentialMode,
    providerToken: noSecret(),
    appSecret: noSecret(),
    verifyToken: noSecret(),
    webhookMode: p.webhookMode,
    signatureScheme: p.signatureScheme,
    signatureHeader: p.signatureHeader ?? '',
    billingMode: p.billingMode,
    capabilities: { ...p.capabilities },
    onboardingKind: p.onboardingKind,
    onboardingAppId: p.onboardingAppId ?? '',
    onboardingConfigId: p.onboardingConfigId ?? '',
  };
}

// --- validation -------------------------------------------------------------------------------------------------

export const STEPS = ['preset', 'connection', 'credentials', 'billing', 'test'] as const;
export type Step = (typeof STEPS)[number];

export type DraftErrorCode =
  | 'required'
  | 'keyFormat'
  | 'labelTooLong'
  | 'baseUrlInvalid'
  | 'baseUrlNotHttps'
  | 'baseUrlHasQuery'
  | 'baseUrlHasVersion'
  | 'baseUrlTrailingSlash'
  | 'versionFormat'
  | 'headersInvalid'
  | 'headersNeedToken'
  | 'headerNameRequired'
  | 'tokenRequired'
  | 'signatureHeaderRequired'
  | 'signatureHeaderInvalid'
  | 'onboardingAppRequired';

export type DraftErrors = Partial<Record<string, DraftErrorCode>>;

const BASE_URL_CODE = {
  empty: 'required',
  invalid: 'baseUrlInvalid',
  notHttps: 'baseUrlNotHttps',
  hasQuery: 'baseUrlHasQuery',
  hasVersion: 'baseUrlHasVersion',
  trailingSlash: 'baseUrlTrailingSlash',
} as const;

/** Whether the provider-level credential applies: only when the platform holds the token for every customer. */
export const usesProviderToken = (d: Pick<ProviderDraft, 'credentialMode'>): boolean =>
  d.credentialMode === 'platform_token';

/** Whether the header-template editor applies. */
export const usesHeaderTemplates = (d: Pick<ProviderDraft, 'authScheme'>): boolean =>
  d.authScheme === 'custom_headers';

/**
 * The errors of one wizard step (or of the whole form when `step` is omitted), keyed by field. `existing` is the stored provider
 * when editing: a secret that is already set does not have to be typed again.
 */
export function validateDraft(
  d: ProviderDraft,
  step?: Step,
  existing?: Pick<Provider, 'providerToken' | 'appSecret'> | null,
): DraftErrors {
  const e: DraftErrors = {};
  const all = step === undefined;
  if (all || step === 'connection') {
    if (!PROVIDER_KEY_RE.test(d.key.trim())) e.key = d.key.trim() ? 'keyFormat' : 'required';
    if (!d.label.trim()) e.label = 'required';
    else if (d.label.trim().length > 80) e.label = 'labelTooLong';
    const base = checkBaseUrl(d.baseUrl);
    if (base) e.baseUrl = BASE_URL_CODE[base];
    if (!API_VERSION_RE.test(d.apiVersion.trim())) e.apiVersion = 'versionFormat';
    if (usesHeaderTemplates(d)) {
      if (d.headers.filter((r) => r.name.trim() || r.value.trim()).length === 0)
        e.headers = 'headerNameRequired';
      else if (validateHeaderRows(d.headers).length > 0) e.headers = 'headersInvalid';
      else if (missingTokenPlaceholder(d.headers, d.authScheme, d.credentialMode))
        e.headers = 'headersNeedToken';
    }
  }
  if (all || step === 'credentials') {
    const hasToken =
      d.providerToken.value.trim() !== '' ||
      (existing?.providerToken.set && !d.providerToken.clear);
    if (usesProviderToken(d) && !hasToken) e.providerToken = 'tokenRequired';
    if (d.signatureScheme === 'shared_secret_header') {
      const h = d.signatureHeader.trim();
      if (!h) e.signatureHeader = 'signatureHeaderRequired';
      else if (!/^[A-Za-z0-9-]+$/.test(h)) e.signatureHeader = 'signatureHeaderInvalid';
    }
  }
  if (all || step === 'billing') {
    if (d.onboardingKind === 'embedded_signup' && !d.onboardingAppId.trim())
      e.onboardingAppId = 'onboardingAppRequired';
  }
  return e;
}

export const stepIsValid = (d: ProviderDraft, step: Step): boolean =>
  Object.keys(validateDraft(d, step)).length === 0;

// --- dirty check and wire bodies --------------------------------------------------------------------------------

const sameHeaders = (a: Record<string, string>, b: Record<string, string>): boolean => {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
};

const sameCaps = (a: Capabilities, b: Capabilities): boolean =>
  (Object.keys(a) as Array<keyof Capabilities>).every((k) => a[k] === b[k]);

const secretChanged = (s: SecretEdit): boolean => s.value.trim() !== '' || s.clear;

/** Whether the draft differs from the stored provider (a typed or cleared secret counts). */
export function isDirty(p: Provider, d: ProviderDraft): boolean {
  return (
    d.label.trim() !== p.label ||
    d.key.trim() !== p.key ||
    d.baseUrl.trim() !== p.baseUrl ||
    d.apiVersion.trim() !== p.apiVersion ||
    d.authScheme !== p.authScheme ||
    !sameHeaders(recordFromRows(d.headers), p.headerTemplates) ||
    d.credentialMode !== p.credentialMode ||
    d.webhookMode !== p.webhookMode ||
    d.signatureScheme !== p.signatureScheme ||
    (d.signatureHeader.trim() || null) !== p.signatureHeader ||
    d.billingMode !== p.billingMode ||
    !sameCaps(d.capabilities, p.capabilities) ||
    d.onboardingKind !== p.onboardingKind ||
    (d.onboardingAppId.trim() || null) !== p.onboardingAppId ||
    (d.onboardingConfigId.trim() || null) !== p.onboardingConfigId ||
    secretChanged(d.providerToken) ||
    secretChanged(d.appSecret) ||
    secretChanged(d.verifyToken)
  );
}

/** A secret to its wire form: a string replaces, null clears, undefined leaves it. */
function secretValue(s: SecretEdit): string | null | undefined {
  if (s.clear) return null;
  const v = s.value.trim();
  return v === '' ? undefined : v;
}

/** The fields that do not depend on the other ones' applicability. */
function core(
  d: ProviderDraft,
): Omit<ProviderInput, 'providerToken' | 'appSecret' | 'verifyToken'> {
  const custom = usesHeaderTemplates(d);
  const sharedHeader = d.signatureScheme === 'shared_secret_header';
  return {
    key: d.key.trim(),
    label: d.label.trim(),
    adapterKind: d.adapterKind,
    baseUrl: d.baseUrl.trim(),
    apiVersion: d.apiVersion.trim(),
    authScheme: d.authScheme,
    // Bearer sends no templates; stale rows from a switched scheme must not reach the server.
    headerTemplates: custom ? recordFromRows(d.headers) : {},
    credentialMode: d.credentialMode,
    webhookMode: d.webhookMode,
    signatureScheme: d.signatureScheme,
    signatureHeader: sharedHeader ? d.signatureHeader.trim().toLowerCase() : null,
    billingMode: d.billingMode,
    capabilities: d.capabilities,
    onboardingKind: d.onboardingKind,
    onboardingAppId:
      d.onboardingKind === 'embedded_signup' ? d.onboardingAppId.trim() || null : null,
    onboardingConfigId:
      d.onboardingKind === 'embedded_signup' ? d.onboardingConfigId.trim() || null : null,
  };
}

export function toCreateInput(
  d: ProviderDraft,
  status: 'active' | 'disabled' = 'active',
): ProviderInput {
  const out: ProviderInput = { ...core(d), status };
  const token = usesProviderToken(d) ? secretValue(d.providerToken) : undefined;
  const app = secretValue(d.appSecret);
  const verify = secretValue(d.verifyToken);
  if (token !== undefined) out.providerToken = token;
  if (app !== undefined) out.appSecret = app;
  if (verify !== undefined) out.verifyToken = verify;
  return out;
}

/** The update body: every field (the server compares) plus the `rowVersion` that was read; secrets only when touched. */
export function toUpdateInput(p: Provider, d: ProviderDraft): ProviderUpdateInput {
  const out: ProviderUpdateInput = { ...core(d), rowVersion: p.rowVersion };
  const token = usesProviderToken(d) ? secretValue(d.providerToken) : undefined;
  const app = secretValue(d.appSecret);
  const verify = secretValue(d.verifyToken);
  if (token !== undefined) out.providerToken = token;
  if (app !== undefined) out.appSecret = app;
  if (verify !== undefined) out.verifyToken = verify;
  return out;
}

/** The last four characters hint of a stored secret, or null when there is none to show. */
export function secretHint(state: { set: boolean; last4?: string | null }): string | null {
  return state.set && state.last4 ? state.last4 : null;
}
