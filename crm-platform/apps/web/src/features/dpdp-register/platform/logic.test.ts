import { describe, expect, it } from 'vitest';
import {
  DPDP_ATTESTABLE_CHECKS,
  DPDP_CODE_CHECKS,
  DPDP_LIVE_CHECKS,
  ERROR_CODES,
  dpdpAttestInputSchema,
  type DpdpCheckKey,
  type DpdpItemStatus,
  type DpdpItemView,
  type DpdpRegisterResponse,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import {
  ALL_CHECK_KEYS,
  ATTEST_LIMITS,
  CHECK_DETAILS,
  GENERIC_DETAILS,
  STATUS_FILTERS,
  barShares,
  buildAttestInput,
  canAttest,
  canViewHistory,
  checkMessageKey,
  detailMessage,
  errorKind,
  filterGroups,
  isLapsed,
  safeHttpsUrl,
  statusCounts,
  statusTone,
} from './logic';
import { historySchema, registerSchema } from './queries';

function item(id: string, group: DpdpItemView['group'], status: DpdpItemStatus): DpdpItemView {
  return {
    id,
    group,
    citation: 's4',
    owner: 'both',
    penaltyTier: '50',
    planItems: ['DP-32'],
    status,
    conditional: false,
    checks: [],
  };
}

const groups: DpdpRegisterResponse['groups'] = [
  { id: 'A', items: [item('r01', 'A', 'not_following'), item('r02', 'A', 'following')] },
  { id: 'B', items: [item('r13', 'B', 'following')] },
  { id: 'C', items: [item('r23', 'C', 'partial'), item('r24', 'C', 'not_applicable')] },
];

describe('filterGroups', () => {
  it('keeps only the items of the status and drops the groups left empty', () => {
    const out = filterGroups(groups, 'not_following');
    expect(out.map((g) => g.id)).toEqual(['A']);
    expect(out[0]!.items.map((i) => i.id)).toEqual(['r01']);
  });

  it('returns every group and item for all, in the order it was given', () => {
    const out = filterGroups(groups, 'all');
    expect(out).toEqual(groups);
    expect(out.flatMap((g) => g.items.map((i) => i.id))).toEqual([
      'r01',
      'r02',
      'r13',
      'r23',
      'r24',
    ]);
  });

  it('keeps the order of the items inside a group', () => {
    const out = filterGroups(groups, 'following');
    expect(out.map((g) => [g.id, g.items.map((i) => i.id)])).toEqual([
      ['A', ['r02']],
      ['B', ['r13']],
    ]);
  });

  it('returns no groups when nothing matches', () => {
    expect(filterGroups(groups, 'unverified')).toEqual([]);
  });

  it('does not change the groups it was given', () => {
    const before = JSON.stringify(groups);
    filterGroups(groups, 'partial');
    expect(JSON.stringify(groups)).toBe(before);
  });
});

describe('statusTone', () => {
  it.each([
    ['following', 'good'],
    ['partial', 'warn'],
    ['not_following', 'bad'],
    ['unverified', 'neutral'],
    ['not_applicable', 'neutral'],
  ] as const)('%s reads as %s', (status, tone) => {
    expect(statusTone(status)).toBe(tone);
  });
});

describe('statusCounts and barShares', () => {
  const tierZero = { notFollowing: 0, partial: 0, unverified: 0 };
  const summary: DpdpRegisterResponse['summary'] = {
    total: 4,
    following: 1,
    partial: 1,
    notFollowing: 2,
    unverified: 0,
    byTier: { '250': tierZero, '200': tierZero, '150': tierZero, '50': tierZero, none: tierZero },
  };

  it('lists the five statuses worst first, taking not applicable from the items because the summary leaves it out', () => {
    expect(statusCounts({ summary, groups })).toEqual([
      { status: 'not_following', count: 2 },
      { status: 'partial', count: 1 },
      { status: 'unverified', count: 0 },
      { status: 'following', count: 1 },
      { status: 'not_applicable', count: 1 },
    ]);
  });

  it('sizes the bar by each counted status over the total, and leaves not applicable out', () => {
    expect(barShares(summary)).toEqual([
      { status: 'not_following', percent: 50 },
      { status: 'partial', percent: 25 },
      { status: 'unverified', percent: 0 },
      { status: 'following', percent: 25 },
    ]);
  });

  it('draws an empty bar, not NaN, when nothing is counted', () => {
    const empty = { ...summary, total: 0, following: 0, partial: 0, notFollowing: 0 };
    expect(barShares(empty).map((s) => s.percent)).toEqual([0, 0, 0, 0]);
  });
});

describe('STATUS_FILTERS', () => {
  it('offers All, Not following, Partial, Unverified, Following in that order', () => {
    expect(STATUS_FILTERS).toEqual(['all', 'not_following', 'partial', 'unverified', 'following']);
  });
});

describe('check keys and their message keys', () => {
  it('lists every live, attestable and code check once', () => {
    expect(ALL_CHECK_KEYS).toHaveLength(
      DPDP_LIVE_CHECKS.length + DPDP_ATTESTABLE_CHECKS.length + DPDP_CODE_CHECKS.length,
    );
    expect(new Set(ALL_CHECK_KEYS).size).toBe(ALL_CHECK_KEYS.length);
  });

  it('turns the dot of a check key into an underscore, because next-intl reads a dot as nesting', () => {
    expect(checkMessageKey('mfa.operators')).toBe('mfa_operators');
    expect(checkMessageKey('crypto.rotation_complete')).toBe('crypto_rotation_complete');
    expect(checkMessageKey('consent.default_opt_in')).toBe('consent_default_opt_in');
  });

  it('gives every check key its own dot-free message key', () => {
    const flat = ALL_CHECK_KEYS.map(checkMessageKey);
    expect(flat.filter((k) => k.includes('.'))).toEqual([]);
    expect(new Set(flat).size).toBe(flat.length);
  });

  it('has a closed list of detail keys for every check key, and none for attested and code checks', () => {
    expect(Object.keys(CHECK_DETAILS).sort()).toEqual([...ALL_CHECK_KEYS].sort());
    for (const key of [...DPDP_ATTESTABLE_CHECKS, ...DPDP_CODE_CHECKS]) {
      expect(CHECK_DETAILS[key], key).toEqual([]);
    }
    for (const key of DPDP_LIVE_CHECKS) expect(CHECK_DETAILS[key].length, key).toBeGreaterThan(0);
  });

  it('keeps the shared details apart from the ones a single check owns', () => {
    for (const key of ALL_CHECK_KEYS) {
      for (const detail of CHECK_DETAILS[key]) expect(GENERIC_DETAILS).not.toContain(detail);
    }
  });
});

describe('detailMessage', () => {
  const check = (
    key: DpdpCheckKey,
    detail: string,
    params?: Record<string, string | number | boolean>,
  ) => ({ key, detail, ...(params ? { params } : {}) });

  it('uses the text of the check itself for a detail only that check can return', () => {
    expect(detailMessage(check('mfa.operators', 'mfa_on'))).toEqual({
      key: 'checks.mfa_operators.details.mfa_on',
      values: {},
    });
    expect(detailMessage(check('logs.audit_retention', 'retention_ok', { days: 400 }))).toEqual({
      key: 'checks.logs_audit_retention.details.retention_ok',
      values: { days: 400 },
    });
  });

  it('uses the shared text for the details every check can return', () => {
    for (const detail of GENERIC_DETAILS) {
      expect(detailMessage(check('redis.auth', detail)).key).toBe(`details.${detail}`);
    }
    expect(detailMessage(check('redis.auth', 'env_missing', { key: 'REDIS_URL' }))).toEqual({
      key: 'details.env_missing',
      values: { key: 'REDIS_URL' },
    });
    expect(detailMessage(check('legal.vendor_dpas', 'attestation_expired')).key).toBe(
      'details.attestation_expired',
    );
    expect(detailMessage(check('pii.column_encryption', 'code_declared')).key).toBe(
      'details.code_declared',
    );
  });

  it('picks the text that names the host or the counts only when the server sent them', () => {
    expect(
      detailMessage(
        check('errors.vendor_region', 'region_unrecognised', { host: 'sentry.acme.io' }),
      ),
    ).toEqual({
      key: 'checks.errors_vendor_region.details.region_unrecognised_host',
      values: { host: 'sentry.acme.io' },
    });
    expect(detailMessage(check('errors.vendor_region', 'region_unrecognised')).key).toBe(
      'checks.errors_vendor_region.details.region_unrecognised',
    );
    expect(
      detailMessage(check('consent.default_opt_in', 'default_opt_out', { on: 3, total: 10 })).key,
    ).toBe('checks.consent_default_opt_in.details.default_opt_out_counts');
    expect(
      detailMessage(check('consent.default_opt_in', 'default_opt_in', { on: 10, total: 10 })).key,
    ).toBe('checks.consent_default_opt_in.details.default_opt_in_counts');
    expect(detailMessage(check('consent.default_opt_in', 'default_opt_in')).key).toBe(
      'checks.consent_default_opt_in.details.default_opt_in',
    );
  });

  it('shows a region as upper-case letters and a provider list with spaces, without changing the input', () => {
    const region = { region: 'us' };
    expect(
      detailMessage(check('errors.vendor_region', 'region_outside_india', region)).values,
    ).toEqual({ region: 'US' });
    expect(region).toEqual({ region: 'us' });
    expect(
      detailMessage(
        check('ai.platform_key_off', 'platform_key_set', { providers: 'openai,gemini' }),
      ).values,
    ).toEqual({ providers: 'openai, gemini' });
  });

  it('sends the lifecycle switches as the words true and false, because next-intl takes no booleans', () => {
    const params = { enabled: true, dryRun: true, deleteEnabled: false };
    expect(detailMessage(check('lifecycle.enabled', 'lifecycle_off', params))).toEqual({
      key: 'checks.lifecycle_enabled.details.lifecycle_off',
      values: { enabled: 'true', dryRun: 'true', deleteEnabled: 'false' },
    });
  });

  it('falls back to a text that shows the code when this build does not know the detail', () => {
    expect(detailMessage(check('redis.auth', 'something_new'))).toEqual({
      key: 'details.unrecognised',
      values: { detail: 'something_new' },
    });
    // a detail of another check is not a detail of this one
    expect(detailMessage(check('redis.auth', 'mfa_on')).key).toBe('details.unrecognised');
  });
});

describe('isLapsed', () => {
  const attestation = {
    result: 'pass' as const,
    note: 'Counsel engaged, letter on file',
    evidenceUrl: null,
    byName: 'Priya Shah',
    at: '2026-06-01T10:00:00.000Z',
    expiresAt: '2026-09-01T10:00:00.000Z',
  };

  it('reads a lapse from the detail alone', () => {
    expect(isLapsed({ detail: 'attestation_expired', attestation })).toBe(true);
    expect(isLapsed({ detail: 'attestation_expired' })).toBe(true);
  });

  it('never infers a lapse from the presence of an attestation', () => {
    expect(isLapsed({ detail: 'attested_pass', attestation })).toBe(false);
    expect(isLapsed({ detail: 'attested_fail', attestation })).toBe(false);
    expect(isLapsed({ detail: 'attestation_missing' })).toBe(false);
  });
});

describe('who sees which action', () => {
  it('lets only a super admin attest, and only a check whose source is attested', () => {
    expect(canAttest('super_admin', 'attested')).toBe(true);
    expect(canAttest('support', 'attested')).toBe(false);
    expect(canAttest('auditor', 'attested')).toBe(false);
    expect(canAttest('super_admin', 'live')).toBe(false);
    expect(canAttest('super_admin', 'code')).toBe(false);
  });

  it('offers history on attested checks only, to every role (the others have no attestations)', () => {
    expect(canViewHistory('attested')).toBe(true);
    expect(canViewHistory('live')).toBe(false);
    expect(canViewHistory('code')).toBe(false);
  });
});

describe('safeHttpsUrl', () => {
  it('returns an https link and nothing else', () => {
    expect(safeHttpsUrl('https://example.com/dpa.pdf')).toBe('https://example.com/dpa.pdf');
    expect(safeHttpsUrl('http://example.com')).toBeNull();
    expect(safeHttpsUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpsUrl('not a link')).toBeNull();
    expect(safeHttpsUrl(null)).toBeNull();
  });
});

describe('errorKind', () => {
  it.each([
    [new Error('boom'), 'network'],
    [new ApiError(403, 'FORBIDDEN', 'x'), 'forbidden'],
    [new ApiError(404, 'NOT_FOUND', 'x'), 'notFound'],
    [new ApiError(422, 'UNPROCESSABLE', 'x'), 'validation'],
    [new ApiError(400, ERROR_CODES.VALIDATION_FAILED, 'x'), 'validation'],
    [new ApiError(400, 'UNKNOWN', 'x'), 'request'],
    [new ApiError(500, 'INTERNAL', 'x'), 'unexpected'],
  ])('%#: reads as %s', (error, kind) => {
    expect(errorKind(error)).toBe(kind);
  });
});

describe('buildAttestInput', () => {
  const draft = {
    result: 'pass' as const,
    note: 'Counsel engaged, letter on file',
    evidenceUrl: '',
    expiresInDays: '90',
  };

  it('leaves the evidence link out of the body when the box is blank', () => {
    const r = buildAttestInput(draft);
    expect(r).toEqual({
      ok: true,
      body: { result: 'pass', note: 'Counsel engaged, letter on file', expiresInDays: 90 },
    });
    expect(r.ok && 'evidenceUrl' in r.body).toBe(false);
    const spaces = buildAttestInput({ ...draft, evidenceUrl: '   ' });
    expect(spaces.ok && 'evidenceUrl' in spaces.body).toBe(false);
  });

  it('sends a trimmed note and a trimmed https link', () => {
    const r = buildAttestInput({
      ...draft,
      result: 'fail',
      note: '  Letter not signed yet  ',
      evidenceUrl: ' https://example.com/ticket/7 ',
    });
    expect(r).toEqual({
      ok: true,
      body: {
        result: 'fail',
        note: 'Letter not signed yet',
        evidenceUrl: 'https://example.com/ticket/7',
        expiresInDays: 90,
      },
    });
  });

  it('blocks a note under 10 characters, counting the trimmed text', () => {
    expect(buildAttestInput({ ...draft, note: '123456789' })).toEqual({
      ok: false,
      errors: { note: 'short' },
    });
    expect(buildAttestInput({ ...draft, note: '   123456789   ' })).toEqual({
      ok: false,
      errors: { note: 'short' },
    });
    expect(buildAttestInput({ ...draft, note: '' }).ok).toBe(false);
    expect(buildAttestInput({ ...draft, note: '1234567890' }).ok).toBe(true);
  });

  it('refuses a link that is not https', () => {
    for (const evidenceUrl of ['http://example.com', 'example.com', 'javascript:alert(1)']) {
      expect(buildAttestInput({ ...draft, evidenceUrl }), evidenceUrl).toEqual({
        ok: false,
        errors: { evidenceUrl: 'link' },
      });
    }
  });

  it('takes an expiry of 1 to 365 whole days', () => {
    for (const days of ['1', '90', '365']) {
      const r = buildAttestInput({ ...draft, expiresInDays: days });
      expect(r.ok && r.body.expiresInDays, days).toBe(Number(days));
    }
    for (const days of ['', 'abc', '0', '366', '9.5', '-3']) {
      expect(buildAttestInput({ ...draft, expiresInDays: days }), days).toEqual({
        ok: false,
        errors: { expiresInDays: 'range' },
      });
    }
  });

  it('reports every field that is wrong at once', () => {
    expect(
      buildAttestInput({
        result: 'pass',
        note: 'short',
        evidenceUrl: 'http://x.io',
        expiresInDays: '0',
      }),
    ).toEqual({
      ok: false,
      errors: { note: 'short', evidenceUrl: 'link', expiresInDays: 'range' },
    });
  });

  it('uses limits that agree with the contract schema', () => {
    const base = { result: 'pass', note: 'x'.repeat(ATTEST_LIMITS.noteMin) } as const;
    expect(
      dpdpAttestInputSchema.safeParse({ ...base, expiresInDays: ATTEST_LIMITS.daysMin }).success,
    ).toBe(true);
    expect(
      dpdpAttestInputSchema.safeParse({ ...base, expiresInDays: ATTEST_LIMITS.daysMax }).success,
    ).toBe(true);
    expect(
      dpdpAttestInputSchema.safeParse({ ...base, expiresInDays: ATTEST_LIMITS.daysMin - 1 })
        .success,
    ).toBe(false);
    expect(
      dpdpAttestInputSchema.safeParse({ ...base, expiresInDays: ATTEST_LIMITS.daysMax + 1 })
        .success,
    ).toBe(false);
    expect(
      dpdpAttestInputSchema.safeParse({ ...base, note: 'x'.repeat(ATTEST_LIMITS.noteMin - 1) })
        .success,
    ).toBe(false);
    expect(ATTEST_LIMITS.daysDefault).toBe(90);
    expect(dpdpAttestInputSchema.parse(base).expiresInDays).toBe(ATTEST_LIMITS.daysDefault);
  });
});

describe('registerSchema and historySchema', () => {
  const tier = { notFollowing: 0, partial: 0, unverified: 0 };
  const payload: DpdpRegisterResponse = {
    generatedAt: '2026-10-17T09:00:00.000Z',
    milestones: [
      { id: 'consent_managers', date: '2026-11-14', daysLeft: 28, passed: false },
      { id: 'main_duties', date: '2027-05-14', daysLeft: 209, passed: false },
    ],
    summary: {
      total: 2,
      following: 0,
      partial: 1,
      notFollowing: 1,
      unverified: 0,
      byTier: {
        '250': { ...tier, partial: 1 },
        '200': tier,
        '150': tier,
        '50': { ...tier, notFollowing: 1 },
        none: tier,
      },
    },
    groups: [
      {
        id: 'D',
        items: [
          {
            ...item('r28', 'D', 'partial'),
            penaltyTier: '250',
            checks: [
              { key: 'mfa.operators', source: 'live', result: 'pass', detail: 'mfa_on' },
              {
                key: 'logs.audit_retention',
                source: 'live',
                result: 'fail',
                detail: 'retention_below_floor',
                params: { days: 90 },
              },
              {
                key: 'legal.counsel_engaged',
                source: 'attested',
                result: 'unknown',
                detail: 'attestation_expired',
                attestation: {
                  result: 'pass',
                  note: 'Counsel engaged, letter on file',
                  evidenceUrl: null,
                  byName: 'Priya Shah',
                  at: '2026-06-01T10:00:00.000Z',
                  expiresAt: '2026-09-01T10:00:00.000Z',
                },
              },
            ],
          },
        ],
      },
    ],
  };

  it('accepts what the API sends, params and attestation included', () => {
    expect(registerSchema.parse(payload)).toEqual(payload);
  });

  it('refuses a status, a check key or a source this build does not know', () => {
    const bad = (mutate: (p: DpdpRegisterResponse) => void) => {
      const copy = structuredClone(payload);
      mutate(copy);
      return registerSchema.safeParse(copy).success;
    };
    expect(bad((p) => ((p.groups[0]!.items[0] as { status: string }).status = 'compliant'))).toBe(
      false,
    );
    expect(
      bad((p) => ((p.groups[0]!.items[0]!.checks[0] as { key: string }).key = 'mfa.nobody')),
    ).toBe(false);
    expect(
      bad((p) => ((p.groups[0]!.items[0]!.checks[0] as { source: string }).source = 'guess')),
    ).toBe(false);
    expect(bad((p) => ((p.groups[0] as { id: string }).id = 'Z'))).toBe(false);
    expect(bad(() => undefined)).toBe(true);
  });

  it('refuses a payload without the summary', () => {
    const { summary: _summary, ...rest } = payload;
    expect(registerSchema.safeParse(rest).success).toBe(false);
  });

  it('parses the history of one check', () => {
    const body = {
      data: [
        {
          result: 'fail' as const,
          note: 'Letter not signed yet',
          evidenceUrl: 'https://example.com/t/1',
          byName: 'Priya Shah',
          at: '2026-06-01T10:00:00.000Z',
          expiresAt: '2026-09-01T10:00:00.000Z',
        },
      ],
    };
    expect(historySchema.parse(body)).toEqual(body);
    expect(historySchema.safeParse({ data: [{ result: 'unknown' }] }).success).toBe(false);
  });
});
