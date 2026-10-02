import { ApiError } from '@/lib/api/errors';

/** Costs travel as millionths of a dollar in a string (a bigint must not round through a JS number). */
export function formatMicros(micros: string): string {
  const n = BigInt(micros);
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, '0').slice(0, 4);
  return `$${whole.toString()}.${frac}`;
}

/** Stable API error code to a key under `errors.`; unknown codes get the generic one. */
const CODE_KEYS: Record<string, string> = {
  ROW_VERSION_CONFLICT: 'conflict',
  I18N_LANGUAGE_IS_DEFAULT: 'languageIsDefault',
  I18N_LANGUAGE_INACTIVE: 'languageInactive',
  I18N_PROVIDER_CREDENTIALS_MISSING: 'credentialsMissing',
  I18N_PROVIDER_INACTIVE: 'providerInactive',
  I18N_LOCKDOWN_NO_OFFICIAL_PROVIDER: 'lockdownNoOfficial',
  PLAN_FEATURE_LOCKED: 'planGate',
};
export function errorKey(err: unknown): string {
  return (err instanceof ApiError && CODE_KEYS[err.code]) || 'unexpected';
}

/** The inclusive YYYY-MM-DD range for the last `n` days ending today (UTC). */
export function lastDays(n: number, now = new Date()): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - (n - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

/** From the first of this month to today (UTC), the range Reference's usage page opens on. */
export function monthToDate(now = new Date()): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  return { from: `${to.slice(0, 8)}01`, to };
}
