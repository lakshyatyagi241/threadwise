import {
  CONSENT_SETTINGS_DEFAULTS,
  DPDP_LIVE_CHECKS,
  type DpdpLiveCheck,
  type SecurityPolicy,
} from '@crm/contracts';
import { envSchema } from '../../config/env.schema';
import type { ProbeOutcome } from './rules';

/**
 * The live probes of the DPDP register (spec section 4.1): one read per check in `DPDP_LIVE_CHECKS`, each turned into a `pass`, a
 * `fail` or an `unknown`. Everything a probe reads comes in through `ProbeDeps`, so this file holds no Nest provider, no database
 * handle and no `process.env`: the service builds the deps, the unit tests pass fakes.
 *
 * A probe never throws and never guesses. A dependency that rejects, or a value that cannot be read, is `unknown`, not `pass`.
 *
 * The `detail` of an outcome is a key from this closed set, which the web maps to a text; numbers and names go in `params`:
 * `probe_error` (the read failed), `env_missing` (`{ key }`), `mfa_on`, `mfa_off`, `retention_ok` (`{ days }`),
 * `retention_unlimited` (`{ days: 0 }`), `retention_below_floor` (`{ days }`), `redis_auth_on`, `redis_auth_off`,
 * `rotation_complete`, `previous_keys_present`, `lifecycle_on` and `lifecycle_off` (`{ enabled, dryRun, deleteEnabled }`),
 * `sentry_off`, `region_india` and `region_outside_india` (`{ region }`), `region_unrecognised` (`{ host }` when the DSN has one),
 * `no_platform_key`, `platform_key_set` (`{ providers }`, comma-joined), `default_opt_in` and `default_opt_out` (`{ on, total }`
 * when the adoption read worked). No outcome carries a secret: not the Redis URL, not the Sentry DSN, not an encryption key.
 */

/** What the service gives the probes. Each member is one read; `policy` and `platformKeyProviders` may reject. */
export interface ProbeDeps {
  /** The platform security policy (`SecurityPolicyService.policy()`). */
  policy(): Promise<SecurityPolicy>;
  /** One variable of the process environment, `undefined` when it is not set. */
  env(key: string): string | undefined;
  /** The AI providers that have a platform-level key configured; empty when none has. */
  platformKeyProviders(): Promise<string[]>;
  /** How many workspaces require recorded consent for marketing (`on`) out of all workspaces with settings (`total`). */
  consentAdoption(): Promise<{ on: number; total: number }>;
  /** Whether error reporting to Sentry is running in this process. */
  sentryEnabled(): boolean;
  /** How many days an ended session is kept before the daily purge deletes it. */
  sessionRetentionDays: number;
}

/** Logs and sessions are kept at least this long (spec section 4.1; the Rules ask for one year). */
const RETENTION_FLOOR_DAYS = 365;

type Probe = () => ProbeOutcome | Promise<ProbeOutcome>;

/** A fresh object each time, so no caller can change what another one received. */
function probeError(): ProbeOutcome {
  return { result: 'unknown', detail: 'probe_error' };
}

/** Runs one probe and turns a throw, a rejection or a synchronous failure into `probe_error`. */
async function settle(probe: Probe): Promise<ProbeOutcome> {
  try {
    return await probe();
  } catch {
    return probeError();
  }
}

function envMissing(key: string): ProbeOutcome {
  return { result: 'unknown', detail: 'env_missing', params: { key } };
}

function mfaOutcome(required: boolean): ProbeOutcome {
  return required ? { result: 'pass', detail: 'mfa_on' } : { result: 'fail', detail: 'mfa_off' };
}

function retentionOutcome(days: number): ProbeOutcome {
  return days >= RETENTION_FLOOR_DAYS
    ? { result: 'pass', detail: 'retention_ok', params: { days } }
    : { result: 'fail', detail: 'retention_below_floor', params: { days } };
}

/**
 * True when a Redis URL carries a password or uses TLS (`rediss:`). Reads the URL the way the queue module does (`new URL`), so a
 * URL that cannot be parsed throws here as it would at boot; the probe reports that as unknown.
 */
export function redisUrlHasAuth(url: string): boolean {
  const parsed = new URL(url);
  return parsed.protocol === 'rediss:' || parsed.password !== '';
}

/** The host of a DSN, or `undefined` when the value is not a URL. */
function dsnHost(dsn: string): string | undefined {
  try {
    return new URL(dsn).hostname;
  } catch {
    return undefined;
  }
}

/** Only Sentry's own regional ingest hosts name a region; a self-hosted or older-style host cannot be placed. */
const SENTRY_REGION_HOST = /\.ingest\.(us|de|in)\.sentry\.io$/;

/** The region of a Sentry DSN: `us`, `de` or `in` for `*.ingest.<region>.sentry.io`, `other` for any other host or a value that is not a URL. */
export function sentryDsnRegion(dsn: string): 'us' | 'de' | 'in' | 'other' {
  const host = dsnHost(dsn);
  const match = host === undefined ? null : SENTRY_REGION_HOST.exec(host);
  return match ? (match[1] as 'us' | 'de' | 'in') : 'other';
}

/**
 * Reads one of the lifecycle switches with the schema the app boots with, so the unset default and the accepted spellings
 * (`true`, `false`, `1`, `0`) are the app's own. A value the schema refuses throws, which the probe reports as unknown.
 */
function lifecycleFlag(
  deps: ProbeDeps,
  key: 'ORG_LIFECYCLE_ENABLED' | 'ORG_LIFECYCLE_DRY_RUN' | 'ORG_LIFECYCLE_DELETE_ENABLED',
): boolean {
  return envSchema.shape[key].parse(deps.env(key));
}

/** The value of a variable, trimmed; `undefined` when it is unset or blank. */
function readEnv(deps: ProbeDeps, key: string): string | undefined {
  const value = deps.env(key)?.trim();
  return value ? value : undefined;
}

/** The adoption counts, or `undefined` when they cannot be read: the contract default stands on its own. */
async function readAdoption(deps: ProbeDeps): Promise<{ on: number; total: number } | undefined> {
  try {
    const { on, total } = await deps.consentAdoption();
    return { on, total };
  } catch {
    return undefined;
  }
}

/**
 * Runs every live probe at once and returns one outcome per check in `DPDP_LIVE_CHECKS`. One probe failing leaves the others
 * unaffected. The security policy is read once and shared by the three probes that use it.
 */
export async function runProbes(deps: ProbeDeps): Promise<Record<DpdpLiveCheck, ProbeOutcome>> {
  let policyRead: Promise<SecurityPolicy> | undefined;
  const policy = (): Promise<SecurityPolicy> =>
    (policyRead ??= Promise.resolve().then(() => deps.policy()));

  const probes: Record<DpdpLiveCheck, Probe> = {
    'mfa.operators': async () => mfaOutcome((await policy()).requireMfaForSuperAdmins),

    'mfa.workspace_admins': async () => mfaOutcome((await policy()).requireMfaForAdmins),

    'logs.audit_retention': async () => {
      const { auditLogRetentionDays: days } = await policy();
      // 0 means the audit log is never pruned.
      if (days === 0) return { result: 'pass', detail: 'retention_unlimited', params: { days } };
      return retentionOutcome(days);
    },

    'logs.session_retention': () => retentionOutcome(deps.sessionRetentionDays),

    'redis.auth': () => {
      const url = readEnv(deps, 'REDIS_URL');
      if (url === undefined) return envMissing('REDIS_URL');
      return redisUrlHasAuth(url)
        ? { result: 'pass', detail: 'redis_auth_on' }
        : { result: 'fail', detail: 'redis_auth_off' };
    },

    'crypto.rotation_complete': () => {
      // The crypto service splits on commas and ignores blanks, so a list of nothing but commas is no previous key either.
      const listed = (deps.env('CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS') ?? '')
        .split(',')
        .some((key) => key.trim() !== '');
      return listed
        ? { result: 'fail', detail: 'previous_keys_present' }
        : { result: 'pass', detail: 'rotation_complete' };
    },

    'lifecycle.enabled': () => {
      const enabled = lifecycleFlag(deps, 'ORG_LIFECYCLE_ENABLED');
      const dryRun = lifecycleFlag(deps, 'ORG_LIFECYCLE_DRY_RUN');
      const deleteEnabled = lifecycleFlag(deps, 'ORG_LIFECYCLE_DELETE_ENABLED');
      const params = { enabled, dryRun, deleteEnabled };
      return enabled && !dryRun && deleteEnabled
        ? { result: 'pass', detail: 'lifecycle_on', params }
        : { result: 'fail', detail: 'lifecycle_off', params };
    },

    'errors.vendor_region': () => {
      if (!deps.sentryEnabled()) return { result: 'pass', detail: 'sentry_off' };
      const dsn = readEnv(deps, 'SENTRY_DSN');
      if (dsn === undefined) return envMissing('SENTRY_DSN');
      const region = sentryDsnRegion(dsn);
      if (region === 'in') return { result: 'pass', detail: 'region_india', params: { region } };
      if (region === 'other') {
        const host = dsnHost(dsn);
        return host === undefined
          ? { result: 'unknown', detail: 'region_unrecognised' }
          : { result: 'unknown', detail: 'region_unrecognised', params: { host } };
      }
      return { result: 'fail', detail: 'region_outside_india', params: { region } };
    },

    'ai.platform_key_off': async () => {
      const providers = await deps.platformKeyProviders();
      return providers.length === 0
        ? { result: 'pass', detail: 'no_platform_key' }
        : {
            result: 'fail',
            detail: 'platform_key_set',
            params: { providers: providers.join(',') },
          };
    },

    'consent.default_opt_in': async () => {
      // The default every new workspace starts with, from the contract. The adoption counts only add context to it.
      const optIn = CONSENT_SETTINGS_DEFAULTS.requireConsentForMarketing;
      const adoption = await readAdoption(deps);
      const outcome: ProbeOutcome = optIn
        ? { result: 'pass', detail: 'default_opt_in' }
        : { result: 'fail', detail: 'default_opt_out' };
      if (adoption) outcome.params = adoption;
      return outcome;
    },
  };

  const settled = await Promise.all(
    DPDP_LIVE_CHECKS.map(async (key) => [key, await settle(probes[key])] as const),
  );
  return Object.fromEntries(settled) as Record<DpdpLiveCheck, ProbeOutcome>;
}
