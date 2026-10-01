import type { SocialCaptchaSettingsPatch, SocialCaptchaSettingsResponse } from '@crm/contracts';

export type Provider = 'google' | 'facebook';
/** Where a saved secret can live: the two sign-in providers and reCAPTCHA. */
export type SecretTarget = Provider | 'recaptcha';

export const SOCIAL_FIELD_MAX = 255;
export const DEFAULT_V3_THRESHOLD = 0.5;

export interface ProviderDraft {
  enabled: boolean;
  clientId: string;
  /** Write-only: blank means "keep the saved one". Never filled from the server. */
  clientSecret: string;
}
export interface SocialDraft {
  google: ProviderDraft;
  facebook: ProviderDraft;
  recaptcha: {
    enabled: boolean;
    version: 'v2' | 'v3';
    siteKey: string;
    secret: string;
    v3Threshold: string;
  };
}

export function socialToDraft(s: SocialCaptchaSettingsResponse): SocialDraft {
  return {
    google: { enabled: s.google.enabled, clientId: s.google.clientId, clientSecret: '' },
    facebook: { enabled: s.facebook.enabled, clientId: s.facebook.clientId, clientSecret: '' },
    recaptcha: {
      enabled: s.recaptcha.enabled,
      version: s.recaptcha.version,
      siteKey: s.recaptcha.siteKey,
      secret: '',
      v3Threshold: String(s.recaptcha.v3Threshold),
    },
  };
}

export type SocialProblem = { code: 'tooLong'; max: number } | { code: 'threshold' };
/** Keyed by the API field path: `google.clientId`, `recaptcha.v3Threshold`, ... */
export type SocialProblems = Record<string, SocialProblem>;

/** Parses the score threshold; blank is WaDesk's "0.5". Null when it is not a number from 0 to 1. */
export function parseThreshold(text: string): number | null {
  const v = text.trim();
  if (v === '') return DEFAULT_V3_THRESHOLD;
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(v)) return null;
  const n = Number(v);
  return n >= 0 && n <= 1 ? n : null;
}

/**
 * Draft + stored settings -> the PATCH body. A secret is sent only when something was typed, so a
 * save can never wipe a working credential. Ids and keys are sent when they changed (blank clears).
 */
export function buildSocialPatch(
  base: SocialCaptchaSettingsResponse,
  draft: SocialDraft,
): { patch: SocialCaptchaSettingsPatch; problems: SocialProblems; secretsTyped: number } {
  const patch: SocialCaptchaSettingsPatch = {};
  const problems: SocialProblems = {};
  let secretsTyped = 0;

  for (const name of ['google', 'facebook'] as const) {
    const d = draft[name];
    const b = base[name];
    const p: NonNullable<SocialCaptchaSettingsPatch['google']> = {};
    if (d.enabled !== b.enabled) p.enabled = d.enabled;
    const id = d.clientId.trim();
    if (id.length > SOCIAL_FIELD_MAX)
      problems[`${name}.clientId`] = { code: 'tooLong', max: SOCIAL_FIELD_MAX };
    else if (id !== b.clientId) p.clientId = id;
    const secret = d.clientSecret.trim();
    if (secret.length > SOCIAL_FIELD_MAX)
      problems[`${name}.clientSecret`] = { code: 'tooLong', max: SOCIAL_FIELD_MAX };
    else if (secret) {
      p.clientSecret = secret;
      secretsTyped += 1;
    }
    if (Object.keys(p).length > 0) patch[name] = p;
  }

  const d = draft.recaptcha;
  const b = base.recaptcha;
  const r: NonNullable<SocialCaptchaSettingsPatch['recaptcha']> = {};
  if (d.enabled !== b.enabled) r.enabled = d.enabled;
  if (d.version !== b.version) r.version = d.version;
  const siteKey = d.siteKey.trim();
  if (siteKey.length > SOCIAL_FIELD_MAX)
    problems['recaptcha.siteKey'] = { code: 'tooLong', max: SOCIAL_FIELD_MAX };
  else if (siteKey !== b.siteKey) r.siteKey = siteKey;
  const secret = d.secret.trim();
  if (secret.length > SOCIAL_FIELD_MAX)
    problems['recaptcha.secret'] = { code: 'tooLong', max: SOCIAL_FIELD_MAX };
  else if (secret) {
    r.secret = secret;
    secretsTyped += 1;
  }
  const threshold = parseThreshold(d.v3Threshold);
  if (threshold === null) problems['recaptcha.v3Threshold'] = { code: 'threshold' };
  else if (threshold !== b.v3Threshold) r.v3Threshold = threshold;
  if (Object.keys(r).length > 0) patch.recaptcha = r;

  return { patch, problems, secretsTyped };
}

/** Number of settings a patch changes, for "N settings saved". */
export function socialPatchSize(patch: SocialCaptchaSettingsPatch): number {
  return (['google', 'facebook', 'recaptcha'] as const).reduce(
    (n, k) => n + Object.keys(patch[k] ?? {}).length,
    0,
  );
}

/** The redirect URI to register with the provider: this site's own callback page. */
export const redirectUri = (origin: string, provider: Provider): string =>
  `${origin.replace(/\/+$/, '')}/auth/social/${provider}/callback`;

/** The PATCH body that deletes one saved secret and touches nothing else. */
export function clearSecretPatch(target: SecretTarget): SocialCaptchaSettingsPatch {
  return { [target]: { clearSecret: true } };
}
