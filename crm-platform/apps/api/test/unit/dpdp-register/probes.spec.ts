import { describe, expect, it } from 'vitest';
import {
  CONSENT_SETTINGS_DEFAULTS,
  DPDP_LIVE_CHECKS,
  securityPolicySchema,
  type DpdpLiveCheck,
  type SecurityPolicy,
} from '@crm/contracts';
import type { ProbeOutcome } from '../../../src/modules/dpdp-register/rules';
import {
  redisUrlHasAuth,
  runProbes,
  sentryDsnRegion,
  type ProbeDeps,
} from '../../../src/modules/dpdp-register/probes';

const US_DSN = 'https://abc123@o4507446172188672.ingest.us.sentry.io/4507446172188673';
const DE_DSN = 'https://abc123@o4507446172188672.ingest.de.sentry.io/4507446172188673';
const IN_DSN = 'https://abc123@o4507446172188672.ingest.in.sentry.io/4507446172188673';
const OTHER_DSN = 'https://abc123@sentry.example.com/12';

const PROBE_ERROR: ProbeOutcome = { result: 'unknown', detail: 'probe_error' };

/** A deployment where nothing is configured: every dependency answers, the defaults of the product apply. */
function makeDeps(overrides: {
  policy?: Partial<SecurityPolicy>;
  env?: Record<string, string>;
  providers?: string[];
  adoption?: { on: number; total: number };
  sentryEnabled?: boolean;
  sessionRetentionDays?: number;
}): ProbeDeps {
  const env = overrides.env ?? {};
  return {
    policy: async () => securityPolicySchema.parse(overrides.policy ?? {}),
    env: (key) => env[key],
    platformKeyProviders: async () => overrides.providers ?? [],
    consentAdoption: async () => overrides.adoption ?? { on: 0, total: 0 },
    sentryEnabled: () => overrides.sentryEnabled ?? false,
    sessionRetentionDays: overrides.sessionRetentionDays ?? 90,
  };
}

async function probe(
  key: DpdpLiveCheck,
  overrides: Parameters<typeof makeDeps>[0],
): Promise<ProbeOutcome> {
  const outcomes = await runProbes(makeDeps(overrides));
  return outcomes[key];
}

describe('redisUrlHasAuth', () => {
  it('is false for a plain redis URL', () => {
    expect(redisUrlHasAuth('redis://redis:6379')).toBe(false);
  });

  it('is true for a URL that carries a password', () => {
    expect(redisUrlHasAuth('redis://:s3cret@redis:6379')).toBe(true);
    expect(redisUrlHasAuth('redis://default:s3cret@redis:6379/2')).toBe(true);
  });

  it('is true for the TLS scheme', () => {
    expect(redisUrlHasAuth('rediss://redis:6379')).toBe(true);
  });

  it('is false for a user name without a password', () => {
    expect(redisUrlHasAuth('redis://default@redis:6379')).toBe(false);
  });

  it('throws on a URL that cannot be parsed, as the app does at boot', () => {
    expect(() => redisUrlHasAuth('not a url')).toThrow();
  });
});

describe('sentryDsnRegion', () => {
  it('reads the region segment of a Sentry ingest host', () => {
    expect(sentryDsnRegion(US_DSN)).toBe('us');
    expect(sentryDsnRegion(DE_DSN)).toBe('de');
    expect(sentryDsnRegion(IN_DSN)).toBe('in');
  });

  it('is other for a host that is not a regional Sentry ingest host', () => {
    expect(sentryDsnRegion(OTHER_DSN)).toBe('other');
    expect(sentryDsnRegion('https://abc123@o1.ingest.sentry.io/1')).toBe('other');
    expect(sentryDsnRegion('https://abc123@o1.ingest.in.example.com/1')).toBe('other');
  });

  it('is other for a value that is not a URL', () => {
    expect(sentryDsnRegion('not a dsn')).toBe('other');
  });
});

describe('runProbes', () => {
  it('returns one outcome for every live check and nothing else', async () => {
    const outcomes = await runProbes(makeDeps({}));
    expect(Object.keys(outcomes).sort()).toEqual([...DPDP_LIVE_CHECKS].sort());
  });

  describe('mfa.operators', () => {
    it('passes only when super admins are required to use MFA', async () => {
      expect(await probe('mfa.operators', { policy: { requireMfaForSuperAdmins: true } })).toEqual({
        result: 'pass',
        detail: 'mfa_on',
      });
      expect(await probe('mfa.operators', { policy: { requireMfaForSuperAdmins: false } })).toEqual(
        { result: 'fail', detail: 'mfa_off' },
      );
    });

    it('ignores the admin switch', async () => {
      const outcome = await probe('mfa.operators', { policy: { requireMfaForAdmins: true } });
      expect(outcome.result).toBe('fail');
    });
  });

  describe('mfa.workspace_admins', () => {
    it('passes only when workspace admins are required to use MFA', async () => {
      expect(
        await probe('mfa.workspace_admins', { policy: { requireMfaForAdmins: true } }),
      ).toEqual({ result: 'pass', detail: 'mfa_on' });
      expect(
        await probe('mfa.workspace_admins', { policy: { requireMfaForAdmins: false } }),
      ).toEqual({ result: 'fail', detail: 'mfa_off' });
    });

    it('ignores the super admin switch', async () => {
      const outcome = await probe('mfa.workspace_admins', {
        policy: { requireMfaForSuperAdmins: true },
      });
      expect(outcome.result).toBe('fail');
    });
  });

  describe('logs.audit_retention', () => {
    it('passes when nothing is pruned (0)', async () => {
      expect(await probe('logs.audit_retention', { policy: { auditLogRetentionDays: 0 } })).toEqual(
        { result: 'pass', detail: 'retention_unlimited', params: { days: 0 } },
      );
    });

    it('passes at 365 days and above', async () => {
      expect(
        await probe('logs.audit_retention', { policy: { auditLogRetentionDays: 365 } }),
      ).toEqual({ result: 'pass', detail: 'retention_ok', params: { days: 365 } });
      expect(
        await probe('logs.audit_retention', { policy: { auditLogRetentionDays: 3650 } }),
      ).toEqual({ result: 'pass', detail: 'retention_ok', params: { days: 3650 } });
    });

    it('fails below 365 days, down to 1', async () => {
      expect(
        await probe('logs.audit_retention', { policy: { auditLogRetentionDays: 364 } }),
      ).toEqual({ result: 'fail', detail: 'retention_below_floor', params: { days: 364 } });
      expect(await probe('logs.audit_retention', { policy: { auditLogRetentionDays: 1 } })).toEqual(
        { result: 'fail', detail: 'retention_below_floor', params: { days: 1 } },
      );
    });
  });

  describe('logs.session_retention', () => {
    it('fails at the current 90 days', async () => {
      expect(await probe('logs.session_retention', { sessionRetentionDays: 90 })).toEqual({
        result: 'fail',
        detail: 'retention_below_floor',
        params: { days: 90 },
      });
    });

    it('passes at 365 days', async () => {
      expect(await probe('logs.session_retention', { sessionRetentionDays: 365 })).toEqual({
        result: 'pass',
        detail: 'retention_ok',
        params: { days: 365 },
      });
    });

    it('fails one day short of the floor', async () => {
      const outcome = await probe('logs.session_retention', { sessionRetentionDays: 364 });
      expect(outcome.result).toBe('fail');
    });
  });

  describe('redis.auth', () => {
    it('passes when the URL carries a password or uses TLS', async () => {
      expect(
        await probe('redis.auth', { env: { REDIS_URL: 'redis://:s3cret@redis:6379' } }),
      ).toEqual({ result: 'pass', detail: 'redis_auth_on' });
      expect(await probe('redis.auth', { env: { REDIS_URL: 'rediss://redis:6379' } })).toEqual({
        result: 'pass',
        detail: 'redis_auth_on',
      });
    });

    it('fails for a URL with neither', async () => {
      expect(await probe('redis.auth', { env: { REDIS_URL: 'redis://redis:6379' } })).toEqual({
        result: 'fail',
        detail: 'redis_auth_off',
      });
    });

    it('never puts the URL or the password in the outcome', async () => {
      const outcome = await probe('redis.auth', {
        env: { REDIS_URL: 'redis://:s3cret@redis:6379' },
      });
      expect(JSON.stringify(outcome)).not.toContain('s3cret');
    });

    it('is unknown when REDIS_URL is not set', async () => {
      expect(await probe('redis.auth', {})).toEqual({
        result: 'unknown',
        detail: 'env_missing',
        params: { key: 'REDIS_URL' },
      });
      expect(await probe('redis.auth', { env: { REDIS_URL: '  ' } })).toEqual({
        result: 'unknown',
        detail: 'env_missing',
        params: { key: 'REDIS_URL' },
      });
    });

    it('is unknown when the URL cannot be parsed', async () => {
      expect(await probe('redis.auth', { env: { REDIS_URL: 'not a url' } })).toEqual(PROBE_ERROR);
    });
  });

  describe('crypto.rotation_complete', () => {
    it('passes when CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS is unset or blank', async () => {
      const pass = { result: 'pass', detail: 'rotation_complete' };
      expect(await probe('crypto.rotation_complete', {})).toEqual(pass);
      expect(
        await probe('crypto.rotation_complete', {
          env: { CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS: '' },
        }),
      ).toEqual(pass);
      expect(
        await probe('crypto.rotation_complete', {
          env: { CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS: '   ' },
        }),
      ).toEqual(pass);
    });

    it('passes for a list of nothing but separators, as the crypto service reads it', async () => {
      expect(
        await probe('crypto.rotation_complete', {
          env: { CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS: ' , ,' },
        }),
      ).toEqual({ result: 'pass', detail: 'rotation_complete' });
    });

    it('fails when a retired key is still listed, without echoing the key', async () => {
      const outcome = await probe('crypto.rotation_complete', {
        env: { CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS: 'b2xkLWtleS1vbmx5LWZvci10ZXN0cw==' },
      });
      expect(outcome).toEqual({ result: 'fail', detail: 'previous_keys_present' });
    });
  });

  describe('lifecycle.enabled', () => {
    const live = {
      ORG_LIFECYCLE_ENABLED: 'true',
      ORG_LIFECYCLE_DRY_RUN: 'false',
      ORG_LIFECYCLE_DELETE_ENABLED: 'true',
    };

    it('passes only when enabled, not a dry run, and erasure is enabled', async () => {
      expect(await probe('lifecycle.enabled', { env: live })).toEqual({
        result: 'pass',
        detail: 'lifecycle_on',
        params: { enabled: true, dryRun: false, deleteEnabled: true },
      });
    });

    it('accepts 1 and 0 as the config schema does', async () => {
      const outcome = await probe('lifecycle.enabled', {
        env: {
          ORG_LIFECYCLE_ENABLED: '1',
          ORG_LIFECYCLE_DRY_RUN: '0',
          ORG_LIFECYCLE_DELETE_ENABLED: '1',
        },
      });
      expect(outcome.result).toBe('pass');
    });

    it('fails when the sweep is off', async () => {
      expect(
        await probe('lifecycle.enabled', { env: { ...live, ORG_LIFECYCLE_ENABLED: 'false' } }),
      ).toEqual({
        result: 'fail',
        detail: 'lifecycle_off',
        params: { enabled: false, dryRun: false, deleteEnabled: true },
      });
    });

    it('fails when it is a dry run', async () => {
      expect(
        await probe('lifecycle.enabled', { env: { ...live, ORG_LIFECYCLE_DRY_RUN: 'true' } }),
      ).toEqual({
        result: 'fail',
        detail: 'lifecycle_off',
        params: { enabled: true, dryRun: true, deleteEnabled: true },
      });
    });

    it('fails when erasure is off', async () => {
      expect(
        await probe('lifecycle.enabled', {
          env: { ...live, ORG_LIFECYCLE_DELETE_ENABLED: 'false' },
        }),
      ).toEqual({
        result: 'fail',
        detail: 'lifecycle_off',
        params: { enabled: true, dryRun: false, deleteEnabled: false },
      });
    });

    it('reads the config defaults when nothing is set: off, dry run, no erasure', async () => {
      expect(await probe('lifecycle.enabled', {})).toEqual({
        result: 'fail',
        detail: 'lifecycle_off',
        params: { enabled: false, dryRun: true, deleteEnabled: false },
      });
    });

    it('is unknown for a value the config schema would refuse', async () => {
      expect(
        await probe('lifecycle.enabled', { env: { ...live, ORG_LIFECYCLE_DRY_RUN: 'maybe' } }),
      ).toEqual(PROBE_ERROR);
    });
  });

  describe('errors.vendor_region', () => {
    it('passes when error reporting is off, without reading the DSN', async () => {
      const deps = makeDeps({ sentryEnabled: false });
      deps.env = () => {
        throw new Error('the DSN must not be read when Sentry is off');
      };
      expect((await runProbes(deps))['errors.vendor_region']).toEqual({
        result: 'pass',
        detail: 'sentry_off',
      });
    });

    it('fails when the DSN points at a US or EU region', async () => {
      expect(
        await probe('errors.vendor_region', { sentryEnabled: true, env: { SENTRY_DSN: US_DSN } }),
      ).toEqual({ result: 'fail', detail: 'region_outside_india', params: { region: 'us' } });
      expect(
        await probe('errors.vendor_region', { sentryEnabled: true, env: { SENTRY_DSN: DE_DSN } }),
      ).toEqual({ result: 'fail', detail: 'region_outside_india', params: { region: 'de' } });
    });

    it('passes when the DSN points at the India region', async () => {
      expect(
        await probe('errors.vendor_region', { sentryEnabled: true, env: { SENTRY_DSN: IN_DSN } }),
      ).toEqual({ result: 'pass', detail: 'region_india', params: { region: 'in' } });
    });

    it('is unknown for a host whose region cannot be read, naming the host', async () => {
      expect(
        await probe('errors.vendor_region', {
          sentryEnabled: true,
          env: { SENTRY_DSN: OTHER_DSN },
        }),
      ).toEqual({
        result: 'unknown',
        detail: 'region_unrecognised',
        params: { host: 'sentry.example.com' },
      });
    });

    it('never puts the DSN key in the outcome', async () => {
      const outcome = await probe('errors.vendor_region', {
        sentryEnabled: true,
        env: { SENTRY_DSN: US_DSN },
      });
      expect(JSON.stringify(outcome)).not.toContain('abc123');
    });

    it('is unknown when Sentry is on but the DSN is not readable', async () => {
      expect(await probe('errors.vendor_region', { sentryEnabled: true })).toEqual({
        result: 'unknown',
        detail: 'env_missing',
        params: { key: 'SENTRY_DSN' },
      });
    });
  });

  describe('ai.platform_key_off', () => {
    it('passes when no platform key is configured', async () => {
      expect(await probe('ai.platform_key_off', { providers: [] })).toEqual({
        result: 'pass',
        detail: 'no_platform_key',
      });
    });

    it('fails with the providers that have one', async () => {
      expect(await probe('ai.platform_key_off', { providers: ['openrouter'] })).toEqual({
        result: 'fail',
        detail: 'platform_key_set',
        params: { providers: 'openrouter' },
      });
      expect(await probe('ai.platform_key_off', { providers: ['openrouter', 'openai'] })).toEqual({
        result: 'fail',
        detail: 'platform_key_set',
        params: { providers: 'openrouter,openai' },
      });
    });
  });

  describe('consent.default_opt_in', () => {
    it('starts from a contract default that is opt-out', () => {
      expect(CONSENT_SETTINGS_DEFAULTS.requireConsentForMarketing).toBe(false);
    });

    it('fails on that default and reports how many workspaces have turned consent on', async () => {
      expect(await probe('consent.default_opt_in', { adoption: { on: 3, total: 10 } })).toEqual({
        result: 'fail',
        detail: 'default_opt_out',
        params: { on: 3, total: 10 },
      });
    });

    it('still fails, without counts, when the adoption read fails', async () => {
      const deps = makeDeps({});
      deps.consentAdoption = async () => {
        throw new Error('database down');
      };
      expect((await runProbes(deps))['consent.default_opt_in']).toEqual({
        result: 'fail',
        detail: 'default_opt_out',
      });
    });
  });

  describe('a throwing dependency', () => {
    const healthy = makeDeps({
      policy: {
        requireMfaForSuperAdmins: true,
        requireMfaForAdmins: true,
        auditLogRetentionDays: 400,
      },
      env: {
        REDIS_URL: 'rediss://redis:6379',
        ORG_LIFECYCLE_ENABLED: 'true',
        ORG_LIFECYCLE_DRY_RUN: 'false',
        ORG_LIFECYCLE_DELETE_ENABLED: 'true',
        SENTRY_DSN: IN_DSN,
      },
      providers: ['openai'],
      adoption: { on: 1, total: 4 },
      sentryEnabled: true,
      sessionRetentionDays: 365,
    });

    /** Every key whose outcome must equal the healthy run's, because the broken dependency is not one of its inputs. */
    function expectOthersUnchanged(
      outcomes: Record<DpdpLiveCheck, ProbeOutcome>,
      baseline: Record<DpdpLiveCheck, ProbeOutcome>,
      broken: readonly DpdpLiveCheck[],
    ) {
      for (const key of DPDP_LIVE_CHECKS) {
        if (broken.includes(key)) expect(outcomes[key]).toEqual(PROBE_ERROR);
        else expect(outcomes[key]).toEqual(baseline[key]);
      }
    }

    it('turns a rejecting policy into probe_error for the three policy probes only', async () => {
      const baseline = await runProbes(healthy);
      const outcomes = await runProbes({
        ...healthy,
        policy: async () => {
          throw new Error('platform_settings unreachable');
        },
      });
      expectOthersUnchanged(outcomes, baseline, [
        'mfa.operators',
        'mfa.workspace_admins',
        'logs.audit_retention',
      ]);
    });

    it('turns a policy that throws before returning a promise into probe_error as well', async () => {
      const baseline = await runProbes(healthy);
      const outcomes = await runProbes({
        ...healthy,
        policy: () => {
          throw new Error('not even a promise');
        },
      });
      expectOthersUnchanged(outcomes, baseline, [
        'mfa.operators',
        'mfa.workspace_admins',
        'logs.audit_retention',
      ]);
    });

    it('turns a rejecting key lookup into probe_error for ai.platform_key_off only', async () => {
      const baseline = await runProbes(healthy);
      const outcomes = await runProbes({
        ...healthy,
        platformKeyProviders: async () => {
          throw new Error('key store unreachable');
        },
      });
      expectOthersUnchanged(outcomes, baseline, ['ai.platform_key_off']);
    });

    it('turns a throwing env read into probe_error for every probe that reads the environment', async () => {
      const baseline = await runProbes(healthy);
      const outcomes = await runProbes({
        ...healthy,
        env: () => {
          throw new Error('config unavailable');
        },
      });
      expectOthersUnchanged(outcomes, baseline, [
        'redis.auth',
        'crypto.rotation_complete',
        'lifecycle.enabled',
        'errors.vendor_region',
      ]);
    });

    it('turns a throwing sentryEnabled into probe_error for errors.vendor_region only', async () => {
      const baseline = await runProbes(healthy);
      const outcomes = await runProbes({
        ...healthy,
        sentryEnabled: () => {
          throw new Error('sentry state unavailable');
        },
      });
      expectOthersUnchanged(outcomes, baseline, ['errors.vendor_region']);
    });

    it('keeps the contract-derived result when only the adoption read rejects', async () => {
      const baseline = await runProbes(healthy);
      const outcomes = await runProbes({
        ...healthy,
        consentAdoption: async () => {
          throw new Error('aggregate failed');
        },
      });
      expect(outcomes['consent.default_opt_in']).toEqual({
        result: 'fail',
        detail: 'default_opt_out',
      });
      for (const key of DPDP_LIVE_CHECKS) {
        if (key !== 'consent.default_opt_in') expect(outcomes[key]).toEqual(baseline[key]);
      }
    });

    it('resolves every probe to probe_error or a real outcome when all dependencies fail at once', async () => {
      const boom = () => {
        throw new Error('everything is down');
      };
      const outcomes = await runProbes({
        policy: async () => boom(),
        env: boom,
        platformKeyProviders: async () => boom(),
        consentAdoption: async () => boom(),
        sentryEnabled: boom,
        sessionRetentionDays: 90,
      });
      expect(Object.keys(outcomes).sort()).toEqual([...DPDP_LIVE_CHECKS].sort());
      expect(outcomes['mfa.operators']).toEqual(PROBE_ERROR);
      expect(outcomes['ai.platform_key_off']).toEqual(PROBE_ERROR);
      expect(outcomes['errors.vendor_region']).toEqual(PROBE_ERROR);
      expect(outcomes['logs.session_retention'].result).toBe('fail');
      expect(outcomes['consent.default_opt_in'].result).toBe('fail');
    });
  });
});
