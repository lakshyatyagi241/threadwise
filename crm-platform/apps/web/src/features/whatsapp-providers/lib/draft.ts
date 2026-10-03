import {
  createWhatsappProviderSchema,
  isBuiltinWhatsappProviderKey,
  type CreateWhatsappProviderInput,
  type CredentialState,
  type UpdateWhatsappProviderInput,
  type WhatsappAuthScheme,
  type WhatsappBillingMode,
  type WhatsappCredentialKey,
  type WhatsappCredentialMode,
  type WhatsappOnboardingMethod,
  type WhatsappProvider,
  type WhatsappSignatureScheme,
  type WhatsappWebhookMode,
} from '@crm/contracts';
import { checkBaseUrl, isApiVersion, type BaseUrlProblem } from './base-url';
import {
  headerProblems,
  rowsFromTemplates,
  starterRows,
  templatesFromRows,
  type HeaderProblem,
  type HeaderRow,
} from './header-templates';

/**
 * The form's state for adding or changing a provider, and the two pure functions that turn it into a request. Nothing here reads
 * the DOM, so it is tested directly.
 */

/** A secret as the operator edits it: write only. `value` is what they typed, `clear` asks to remove the stored one. */
export interface SecretEdit {
  value: string;
  clear: boolean;
}
export const noSecret = (): SecretEdit => ({ value: '', clear: false });

export const SECRET_KEYS: readonly WhatsappCredentialKey[] = [
  'providerToken',
  'appSecret',
  'webhookSecret',
  'verifyToken',
];

/** The contract's length rules per secret (8 to N printable characters). */
export const SECRET_LIMITS: Readonly<Record<WhatsappCredentialKey, { min: number; max: number }>> =
  {
    providerToken: { min: 8, max: 4096 },
    appSecret: { min: 8, max: 256 },
    webhookSecret: { min: 8, max: 512 },
    verifyToken: { min: 8, max: 256 },
  };

export interface ProviderDraft {
  key: string;
  label: string;
  baseUrl: string;
  apiVersion: string;
  authScheme: WhatsappAuthScheme;
  headers: HeaderRow[];
  credentialMode: WhatsappCredentialMode;
  webhookMode: WhatsappWebhookMode;
  signatureScheme: WhatsappSignatureScheme;
  signatureHeaderName: string;
  billingMode: WhatsappBillingMode;
  mediaUpload: boolean;
  onboarding: WhatsappOnboardingMethod;
  onboardingAppId: string;
  onboardingConfigId: string;
  notes: string;
  secrets: Record<WhatsappCredentialKey, SecretEdit>;
}

const noSecrets = (): Record<WhatsappCredentialKey, SecretEdit> => ({
  providerToken: noSecret(),
  appSecret: noSecret(),
  webhookSecret: noSecret(),
  verifyToken: noSecret(),
});

/** The defaults the API itself applies to a new provider (v25.0, platform token, number-level callback, Meta-style signature). */
export function emptyDraft(): ProviderDraft {
  return {
    key: '',
    label: '',
    baseUrl: '',
    apiVersion: 'v25.0',
    authScheme: 'bearer',
    headers: [],
    credentialMode: 'platform_token',
    webhookMode: 'number_level_override',
    signatureScheme: 'meta_app_secret_sha256',
    signatureHeaderName: '',
    billingMode: 'provider_credit_line',
    mediaUpload: true,
    onboarding: 'manual',
    onboardingAppId: '',
    onboardingConfigId: '',
    notes: '',
    secrets: noSecrets(),
  };
}

export function draftFromProvider(p: WhatsappProvider): ProviderDraft {
  return {
    key: p.key,
    label: p.label,
    baseUrl: p.baseUrl,
    apiVersion: p.apiVersion,
    authScheme: p.authScheme,
    headers: rowsFromTemplates(p.headerTemplates),
    credentialMode: p.credentialMode,
    webhookMode: p.webhookMode,
    signatureScheme: p.signatureScheme,
    signatureHeaderName: p.signatureHeaderName ?? '',
    billingMode: p.billingMode,
    mediaUpload: p.capabilities.mediaUpload,
    onboarding: p.onboarding,
    onboardingAppId: p.onboardingAppId ?? '',
    onboardingConfigId: p.onboardingConfigId ?? '',
    notes: p.notes ?? '',
    secrets: noSecrets(),
  };
}

/** Switching to custom headers gives the operator the one header the API insists on, instead of an empty table. */
export function withAuthScheme(d: ProviderDraft, authScheme: WhatsappAuthScheme): ProviderDraft {
  const needsStarter = authScheme === 'custom_headers' && d.headers.length === 0;
  return { ...d, authScheme, headers: needsStarter ? starterRows(d.credentialMode) : d.headers };
}

// --- validation ------------------------------------------------------------------------------------------------------------

export interface FieldProblem {
  /** Message key under `whatsapp-providers.form.problems`. */
  key: string;
  values?: Record<string, string | number>;
}

export interface DraftValidation {
  fields: Partial<Record<string, FieldProblem>>;
  headers: HeaderProblem[];
  /** True when nothing blocks the request. */
  ok: boolean;
}

const KEY_PATTERN = /^[a-z][a-z0-9_-]{1,39}$/;
const SIGNATURE_HEADER = /^[a-z0-9][a-z0-9-]{0,62}$/;
const DIGITS = /^\d{5,32}$/;
const PRINTABLE = /^[\x21-\x7e]+$/;

const baseUrlKey = (p: BaseUrlProblem): string => `baseUrl.${p}`;

export interface ValidateOptions {
  mode: 'create' | 'edit';
  /** A built-in provider only takes label, notes and billing mode. */
  builtin?: boolean;
}

export function validateDraft(d: ProviderDraft, opts: ValidateOptions): DraftValidation {
  const fields: Record<string, FieldProblem> = {};
  const label = d.label.trim();
  if (label === '') fields.label = { key: 'labelRequired' };
  else if (label.length > 120) fields.label = { key: 'labelLength', values: { max: 120 } };
  if (d.notes.trim().length > 2000) fields.notes = { key: 'notesLength', values: { max: 2000 } };

  if (opts.builtin) return { fields, headers: [], ok: Object.keys(fields).length === 0 };

  if (opts.mode === 'create') {
    const key = d.key.trim().toLowerCase();
    if (key === '') fields.key = { key: 'keyRequired' };
    else if (isBuiltinWhatsappProviderKey(key)) fields.key = { key: 'keyBuiltin' };
    else if (!KEY_PATTERN.test(key)) fields.key = { key: 'keyFormat' };
  }

  const url = checkBaseUrl(d.baseUrl);
  if (!url.ok && url.problem) fields.baseUrl = { key: baseUrlKey(url.problem) };
  if (!isApiVersion(d.apiVersion)) fields.apiVersion = { key: 'apiVersion' };

  let headers: HeaderProblem[] = [];
  if (d.authScheme === 'custom_headers') {
    headers = headerProblems(d.headers, d.credentialMode);
    if (headers.length > 0)
      fields.headerTemplates = { key: 'headers', values: { count: headers.length } };
  }

  if (d.signatureScheme === 'shared_secret_header') {
    const name = d.signatureHeaderName.trim().toLowerCase();
    if (name === '') fields.signatureHeaderName = { key: 'signatureHeaderRequired' };
    else if (!SIGNATURE_HEADER.test(name))
      fields.signatureHeaderName = { key: 'signatureHeaderFormat' };
  }

  if (d.onboardingAppId.trim() !== '' && !DIGITS.test(d.onboardingAppId.trim())) {
    fields.onboardingAppId = { key: 'digits' };
  }
  if (d.onboardingConfigId.trim() !== '' && !DIGITS.test(d.onboardingConfigId.trim())) {
    fields.onboardingConfigId = { key: 'digits' };
  }

  for (const k of SECRET_KEYS) {
    const v = d.secrets[k].value.trim();
    if (v === '') continue;
    const { min, max } = SECRET_LIMITS[k];
    if (!PRINTABLE.test(v)) fields[`credentials.${k}`] = { key: 'secretCharacters' };
    else if (v.length < min || v.length > max) {
      fields[`credentials.${k}`] = { key: 'secretLength', values: { min, max } };
    }
  }

  return { fields, headers, ok: Object.keys(fields).length === 0 };
}

// --- requests --------------------------------------------------------------------------------------------------------------

const orNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

function typedSecrets(d: ProviderDraft): Partial<Record<WhatsappCredentialKey, string>> {
  const out: Partial<Record<WhatsappCredentialKey, string>> = {};
  for (const k of SECRET_KEYS) {
    const v = d.secrets[k].value.trim();
    if (v !== '') out[k] = v;
  }
  return out;
}

/** The create request. The caller validates first; the contract's own schema is the last word. */
export function buildCreateRequest(d: ProviderDraft): CreateWhatsappProviderInput {
  const check = checkBaseUrl(d.baseUrl);
  const credentials = typedSecrets(d);
  const body: CreateWhatsappProviderInput = {
    key: d.key.trim().toLowerCase(),
    label: d.label.trim(),
    baseUrl: check.url ?? d.baseUrl.trim(),
    apiVersion: d.apiVersion.trim(),
    authScheme: d.authScheme,
    credentialMode: d.credentialMode,
    webhookMode: d.webhookMode,
    signatureScheme: d.signatureScheme,
    billingMode: d.billingMode,
    capabilities: { mediaUpload: d.mediaUpload },
    onboarding: d.onboarding,
  };
  if (d.authScheme === 'custom_headers') body.headerTemplates = templatesFromRows(d.headers);
  if (d.signatureScheme === 'shared_secret_header') {
    body.signatureHeaderName = d.signatureHeaderName.trim().toLowerCase();
  }
  const appId = orNull(d.onboardingAppId);
  const configId = orNull(d.onboardingConfigId);
  if (appId) body.onboardingAppId = appId;
  if (configId) body.onboardingConfigId = configId;
  const notes = orNull(d.notes);
  if (notes) body.notes = notes;
  if (Object.keys(credentials).length > 0) body.credentials = credentials;
  return body;
}

/** What the contract says about a built create request (a last check; a clean draft always passes). Empty when it is fine. */
export function contractIssues(
  body: CreateWhatsappProviderInput,
): Array<{ path: string; message: string }> {
  const parsed = createWhatsappProviderSchema.safeParse(body);
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

const sameTemplates = (a: Record<string, string>, b: Record<string, string>): boolean => {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
};

/**
 * The update request: only what changed, plus the `rowVersion` the operator read. Absent secrets keep their value; a cleared one
 * goes in `clearCredentials` (unless a new value was typed over it). A built-in provider only ever sends label, notes and billing
 * mode. Null when nothing changed.
 */
export function buildUpdateRequest(
  p: WhatsappProvider,
  d: ProviderDraft,
): UpdateWhatsappProviderInput | null {
  const body: UpdateWhatsappProviderInput = { rowVersion: p.rowVersion };
  let changed = false;
  const set = <K extends keyof UpdateWhatsappProviderInput>(
    k: K,
    v: UpdateWhatsappProviderInput[K],
  ) => {
    body[k] = v;
    changed = true;
  };

  if (d.label.trim() !== p.label) set('label', d.label.trim());
  if (orNull(d.notes) !== p.notes) set('notes', orNull(d.notes));
  if (d.billingMode !== p.billingMode) set('billingMode', d.billingMode);
  if (p.builtin) return changed ? body : null;

  const url = checkBaseUrl(d.baseUrl);
  const nextUrl = url.url ?? d.baseUrl.trim();
  if (nextUrl !== p.baseUrl) set('baseUrl', nextUrl);
  if (d.apiVersion.trim() !== p.apiVersion) set('apiVersion', d.apiVersion.trim());
  if (d.authScheme !== p.authScheme) set('authScheme', d.authScheme);
  const templates = d.authScheme === 'custom_headers' ? templatesFromRows(d.headers) : {};
  if (
    !sameTemplates(templates, p.headerTemplates) &&
    (d.authScheme === 'custom_headers' || Object.keys(p.headerTemplates).length > 0)
  ) {
    set('headerTemplates', templates);
  }
  if (d.credentialMode !== p.credentialMode) set('credentialMode', d.credentialMode);
  if (d.webhookMode !== p.webhookMode) set('webhookMode', d.webhookMode);
  if (d.signatureScheme !== p.signatureScheme) set('signatureScheme', d.signatureScheme);
  const sigHeader =
    d.signatureScheme === 'shared_secret_header'
      ? d.signatureHeaderName.trim().toLowerCase()
      : null;
  if (sigHeader !== p.signatureHeaderName) set('signatureHeaderName', sigHeader);
  if (d.mediaUpload !== p.capabilities.mediaUpload)
    set('capabilities', { mediaUpload: d.mediaUpload });
  if (d.onboarding !== p.onboarding) set('onboarding', d.onboarding);
  if (orNull(d.onboardingAppId) !== p.onboardingAppId)
    set('onboardingAppId', orNull(d.onboardingAppId));
  if (orNull(d.onboardingConfigId) !== p.onboardingConfigId) {
    set('onboardingConfigId', orNull(d.onboardingConfigId));
  }

  const credentials = typedSecrets(d);
  if (Object.keys(credentials).length > 0) set('credentials', credentials);
  const clear = SECRET_KEYS.filter(
    (k) => d.secrets[k].clear && credentials[k] === undefined && p.credentials[k].set,
  );
  if (clear.length > 0) set('clearCredentials', clear);
  return changed ? body : null;
}

export const isDirty = (p: WhatsappProvider, d: ProviderDraft): boolean =>
  buildUpdateRequest(p, d) !== null;

// --- secrets and readiness -------------------------------------------------------------------------------------------------

/** The last four characters of a stored secret, when the API has them. */
export const secretHint = (state: CredentialState | undefined): string | null =>
  state?.set && state.last4 ? state.last4 : null;

export type SecretStatus = 'willClear' | 'willReplace' | 'setWithHint' | 'set' | 'notSet';

/** What the status line under a secret field says: the stored state, or what saving will do. */
export function secretStatus(state: CredentialState | undefined, edit: SecretEdit): SecretStatus {
  if (edit.clear && state?.set) return 'willClear';
  if (edit.value.trim() !== '') return 'willReplace';
  if (state?.set) return secretHint(state) ? 'setWithHint' : 'set';
  return 'notSet';
}

export type ReadinessItem =
  /** Activating needs the provider's own token (409 `WAP_CREDENTIALS_MISSING` otherwise). */
  | 'providerToken'
  /** Every delivery of this provider is refused until the secret its signature scheme checks is stored. */
  | 'appSecret'
  | 'webhookSecret';

/**
 * What a provider still lacks before it can work, from its mode and what is stored. `providerToken` blocks activation; the other two
 * do not, but the platform refuses every webhook delivery of the provider until they are stored (fail closed).
 */
export function readinessGaps(
  p: Pick<WhatsappProvider, 'credentialMode' | 'signatureScheme' | 'credentials' | 'builtin'>,
): ReadinessItem[] {
  if (p.builtin) return [];
  const gaps: ReadinessItem[] = [];
  if (p.credentialMode === 'platform_token' && !p.credentials.providerToken.set)
    gaps.push('providerToken');
  if (p.signatureScheme === 'meta_app_secret_sha256' && !p.credentials.appSecret.set)
    gaps.push('appSecret');
  if (p.signatureScheme === 'shared_secret_header' && !p.credentials.webhookSecret.set)
    gaps.push('webhookSecret');
  return gaps;
}

/** The same gaps for a draft that has not been saved: a stored-or-typed secret counts as held. */
export function draftReadinessGaps(d: ProviderDraft, stored?: WhatsappProvider): ReadinessItem[] {
  const held = (k: WhatsappCredentialKey) =>
    d.secrets[k].value.trim() !== '' || (!!stored?.credentials[k].set && !d.secrets[k].clear);
  const gaps: ReadinessItem[] = [];
  if (d.credentialMode === 'platform_token' && !held('providerToken')) gaps.push('providerToken');
  if (d.signatureScheme === 'meta_app_secret_sha256' && !held('appSecret')) gaps.push('appSecret');
  if (d.signatureScheme === 'shared_secret_header' && !held('webhookSecret'))
    gaps.push('webhookSecret');
  return gaps;
}

// --- wizard steps ----------------------------------------------------------------------------------------------------------

export const WIZARD_STEPS = [
  'basics',
  'connection',
  'credentials',
  'webhooks',
  'billing',
  'review',
] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** The fields each step owns, so "Next" can check only its own and a server refusal can send the operator back to the right step. */
export const STEP_FIELDS: Readonly<Record<WizardStep, readonly string[]>> = {
  basics: ['key', 'label', 'notes'],
  connection: ['baseUrl', 'apiVersion', 'headerTemplates'],
  credentials: ['credentials.providerToken'],
  webhooks: [
    'signatureHeaderName',
    'credentials.appSecret',
    'credentials.webhookSecret',
    'credentials.verifyToken',
  ],
  billing: ['onboardingAppId', 'onboardingConfigId'],
  review: [],
};

/** The step a field belongs to; the review step for a field no step owns. */
export function stepOfField(field: string): WizardStep {
  return WIZARD_STEPS.find((s) => STEP_FIELDS[s].includes(field)) ?? 'review';
}

/** The first step (in order) with a problem among `fields`, or null. */
export function firstStepWithProblem(fields: Readonly<Record<string, unknown>>): WizardStep | null {
  const bad = Object.keys(fields);
  return WIZARD_STEPS.find((s) => STEP_FIELDS[s].some((f) => bad.includes(f))) ?? null;
}
