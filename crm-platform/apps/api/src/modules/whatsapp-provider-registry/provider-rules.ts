import type { WhatsappCredentialKey } from '@crm/contracts';

/**
 * Pure rules of the WhatsApp provider registry: no database, no network. Everything that decides something lives here so a test can pin
 * it; the services only gather facts and apply the verdict.
 */

// --- which provider a new number goes through ---------------------------------------------------------------------------------------

export type RouteSource = 'override' | 'default' | 'platform_setting';

export type NewNumberChoice =
  | { ok: true; source: RouteSource; key: string }
  | { ok: false; source: 'override'; key: string; reason: 'not_active' };

/**
 * Precedence for a number connected NOW: the workspace's override, else the registry default, else the platform's own setting
 * (`WABA_DEFAULT_PROVIDER`, the console WhatsApp page). An override that points at a provider that is no longer active is refused, not
 * skipped: silently sending a workspace through a different BSP than the operator chose is worse than a clear error.
 */
export function chooseNewNumberProvider(input: {
  override: { key: string; status: string } | null;
  registryDefault: { key: string } | null;
  platformSetting: 'meta' | 'interakt';
}): NewNumberChoice {
  if (input.override) {
    return input.override.status === 'active'
      ? { ok: true, source: 'override', key: input.override.key }
      : { ok: false, source: 'override', key: input.override.key, reason: 'not_active' };
  }
  if (input.registryDefault) return { ok: true, source: 'default', key: input.registryDefault.key };
  return { ok: true, source: 'platform_setting', key: input.platformSetting };
}

// --- secrets ---------------------------------------------------------------------------------------------------------------------

export type ProviderSecrets = Partial<Record<WhatsappCredentialKey, string>>;

const KEYS: readonly WhatsappCredentialKey[] = [
  'providerToken',
  'appSecret',
  'webhookSecret',
  'verifyToken',
];

export const last4 = (secret: string): string => secret.slice(-4);

/** What a response says about a secret: whether it is stored and its last four characters, never the value. */
export function credentialStates(
  hints: Readonly<Record<string, string>>,
): Record<WhatsappCredentialKey, { set: boolean; last4: string | null }> {
  const out = {} as Record<WhatsappCredentialKey, { set: boolean; last4: string | null }>;
  for (const k of KEYS)
    out[k] = hints[k] ? { set: true, last4: hints[k]! } : { set: false, last4: null };
  return out;
}

/** Applies an update to the stored secrets: a key that is sent replaces, a key in `clear` goes, every other key is kept. */
export function mergeSecrets(
  current: ProviderSecrets,
  input: ProviderSecrets | undefined,
  clear: readonly WhatsappCredentialKey[] | undefined,
): { secrets: ProviderSecrets; hints: Record<string, string> } {
  const secrets: ProviderSecrets = { ...current };
  for (const k of KEYS) {
    const v = input?.[k];
    if (typeof v === 'string' && v !== '') secrets[k] = v;
  }
  for (const k of clear ?? []) delete secrets[k];
  const hints: Record<string, string> = {};
  for (const k of KEYS) if (secrets[k]) hints[k] = last4(secrets[k]!);
  return { secrets, hints };
}

/** Removes every secret (and its bare form) from a message before it is stored, logged or returned. */
export function redactSecrets(text: string, secrets: ReadonlyArray<string | undefined>): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join('[redacted]');
  }
  return out;
}

// --- the live test ---------------------------------------------------------------------------------------------------------------

/** A test path under `<base>/<version>`: no `..`, no scheme, no query (the contract already restricts the characters). */
export function safeTestPath(path: string): string | null {
  if (!path.startsWith('/') || path.includes('..') || path.includes('//') || path.includes('?'))
    return null;
  return path;
}
