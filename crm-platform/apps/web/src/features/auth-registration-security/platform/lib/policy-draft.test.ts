import { describe, expect, it } from 'vitest';
import { KEYWORD_LIST_MAX_CHARS, securityPolicySchema } from '@crm/contracts';
import {
  BOOLEAN_KEYS,
  FIELD_TAB,
  NUMERIC_FIELDS,
  NUMERIC_KEYS,
  buildPolicyPatch,
  numberProblem,
  policyToDraft,
} from './policy-draft';

const base = securityPolicySchema.parse({});

describe('policyToDraft', () => {
  it('turns numbers into text and lists into one entry per line', () => {
    const d = policyToDraft({
      ...base,
      lockoutAfterFailures: 3,
      abuseBlockKeywordList: ['forex', 'loan'],
    });
    expect(d.lockoutAfterFailures).toBe('3');
    expect(d.abuseBlockKeywordList).toBe('forex\nloan');
    expect(d.requireMfaForAdmins).toBe(false);
  });

  it('covers every control of the contract exactly once', () => {
    const covered = new Set<string>([
      ...BOOLEAN_KEYS,
      ...NUMERIC_KEYS,
      'allowedMfaMethods',
      'waGuardrailsMode',
      'alertChannel',
      'abuseBlockKeywordList',
      'ipAllowlistCidrs',
    ]);
    expect([...covered].sort()).toEqual(Object.keys(base).sort());
    expect(Object.keys(FIELD_TAB).sort()).toEqual(Object.keys(base).sort());
  });
});

describe('buildPolicyPatch', () => {
  it('sends nothing when nothing changed', () => {
    expect(buildPolicyPatch(base, policyToDraft(base))).toEqual({ patch: {}, problems: {} });
  });

  it('sends only the changed fields', () => {
    const d = { ...policyToDraft(base), lockoutAfterFailures: '3', requireMfaForAdmins: true };
    expect(buildPolicyPatch(base, d).patch).toEqual({
      lockoutAfterFailures: 3,
      requireMfaForAdmins: true,
    });
  });

  it('turns an unticked toggle into an explicit false', () => {
    const d = { ...policyToDraft(base), rememberMeEnabled: false };
    expect(buildPolicyPatch(base, d).patch).toEqual({ rememberMeEnabled: false });
  });

  it('keeps the stored value when a numeric field is blank', () => {
    const d = { ...policyToDraft(base), lockoutAfterFailures: '  ', sessionTimeoutMinutes: '' };
    expect(buildPolicyPatch(base, d)).toEqual({ patch: {}, problems: {} });
  });

  it('reports out-of-range and non-integer numbers instead of sending them', () => {
    const d = {
      ...policyToDraft(base),
      sessionTimeoutMinutes: '2',
      lockoutWindowMinutes: '1.5',
      passwordMinLength: 'abc',
    };
    const { patch, problems } = buildPolicyPatch(base, d);
    expect(patch).toEqual({});
    expect(problems.sessionTimeoutMinutes).toMatchObject({
      code: 'range',
      min: 5,
      max: 1440,
      allowZero: false,
    });
    expect(problems.lockoutWindowMinutes).toMatchObject({ code: 'range' });
    expect(problems.passwordMinLength).toMatchObject({ code: 'range', min: 6, max: 128 });
  });

  it('refuses 0 for the timeout, session cap and lockout, which the form cannot save', () => {
    const d = {
      ...policyToDraft(base),
      sessionTimeoutMinutes: '0',
      maxConcurrentSessions: '0',
      lockoutAfterFailures: '0',
    };
    const { patch, problems } = buildPolicyPatch(base, d);
    expect(patch).toEqual({});
    expect(problems.sessionTimeoutMinutes).toMatchObject({ code: 'range', allowZero: false });
    expect(problems.maxConcurrentSessions).toMatchObject({ code: 'range', allowZero: false });
    expect(problems.lockoutAfterFailures).toMatchObject({ code: 'range', allowZero: false });
  });

  it('accepts 0 where the range itself starts at 0', () => {
    const stored = {
      ...base,
      passwordMaxAgeDays: 90,
      waMaxSendsPerMinute: 10,
      auditLogRetentionDays: 30,
    };
    const d = {
      ...policyToDraft(stored),
      passwordMaxAgeDays: '0',
      waMaxSendsPerMinute: '0',
      auditLogRetentionDays: '0',
    };
    expect(buildPolicyPatch(stored, d).patch).toEqual({
      passwordMaxAgeDays: 0,
      waMaxSendsPerMinute: 0,
      auditLogRetentionDays: 0,
    });
  });

  it('splits the keyword list on newlines and commas', () => {
    const d = { ...policyToDraft(base), abuseBlockKeywordList: 'forex, quick money\nloan' };
    expect(buildPolicyPatch(base, d).patch).toEqual({
      abuseBlockKeywordList: ['forex', 'quick money', 'loan'],
    });
  });

  it('clears a list when its textarea is emptied', () => {
    const withList = { ...base, ipAllowlistCidrs: ['10.0.0.0/8'] };
    const d = { ...policyToDraft(withList), ipAllowlistCidrs: '' };
    expect(buildPolicyPatch(withList, d).patch).toEqual({ ipAllowlistCidrs: [] });
  });

  it('flags an invalid allowlist entry on the client', () => {
    const d = { ...policyToDraft(base), ipAllowlistCidrs: '10.0.0.0/8\n10.0.0/8' };
    const { patch, problems } = buildPolicyPatch(base, d);
    expect(problems.ipAllowlistCidrs).toEqual({ code: 'invalidEntry', entry: '10.0.0/8' });
    expect(patch.ipAllowlistCidrs).toBeUndefined();
  });

  it('flags an allowlist with too many or too long entries', () => {
    const long = { ...policyToDraft(base), ipAllowlistCidrs: '1'.repeat(65) };
    expect(buildPolicyPatch(base, long).problems.ipAllowlistCidrs).toEqual({
      code: 'tooLong',
      max: 64,
    });
    const many = {
      ...policyToDraft(base),
      ipAllowlistCidrs: Array.from(
        { length: 201 },
        (_, i) => `10.0.${Math.floor(i / 200)}.${i}`,
      ).join('\n'),
    };
    expect(buildPolicyPatch(base, many).problems.ipAllowlistCidrs).toEqual({
      code: 'tooMany',
      max: 200,
    });
  });

  it('caps the keyword list on its total length, not per keyword or by count', () => {
    const longWord = { ...policyToDraft(base), abuseBlockKeywordList: 'x'.repeat(300) };
    expect(buildPolicyPatch(base, longWord).problems.abuseBlockKeywordList).toBeUndefined();
    const manyWords = {
      ...policyToDraft(base),
      abuseBlockKeywordList: Array.from({ length: 500 }, (_, i) => `k${i}`).join('\n'),
    };
    expect(buildPolicyPatch(base, manyWords).problems.abuseBlockKeywordList).toBeUndefined();
    const tooMuch = { ...policyToDraft(base), abuseBlockKeywordList: 'x'.repeat(5001) };
    expect(buildPolicyPatch(base, tooMuch).problems.abuseBlockKeywordList).toEqual({
      code: 'totalTooLong',
      max: KEYWORD_LIST_MAX_CHARS,
    });
  });

  it('counts the keyword list in characters, so an emoji costs one', () => {
    const justFits = { ...policyToDraft(base), abuseBlockKeywordList: '😀'.repeat(5000) };
    expect(buildPolicyPatch(base, justFits).problems.abuseBlockKeywordList).toBeUndefined();
    const over = { ...policyToDraft(base), abuseBlockKeywordList: '😀'.repeat(5001) };
    expect(buildPolicyPatch(base, over).problems.abuseBlockKeywordList).toMatchObject({
      code: 'totalTooLong',
    });
  });

  it('never empties the MFA method list', () => {
    const d = { ...policyToDraft(base), allowedMfaMethods: [] };
    expect(buildPolicyPatch(base, d).patch).toEqual({});
  });

  it('sends the MFA methods in canonical order when they change', () => {
    const d = { ...policyToDraft(base), allowedMfaMethods: ['telegram' as const, 'totp' as const] };
    expect(buildPolicyPatch(base, d).patch).toEqual({ allowedMfaMethods: ['totp', 'telegram'] });
  });

  it('sends enum controls only when they changed', () => {
    const d = {
      ...policyToDraft(base),
      waGuardrailsMode: 'monitor' as const,
      alertChannel: 'email' as const,
    };
    expect(buildPolicyPatch(base, d).patch).toEqual({ waGuardrailsMode: 'monitor' });
  });
});

describe('numberProblem', () => {
  it('returns null for blank, the number for valid input and a problem otherwise', () => {
    expect(numberProblem('', { min: 1, max: 5 })).toBeNull();
    expect(numberProblem(' 3 ', { min: 1, max: 5 })).toBe(3);
    expect(numberProblem('6', { min: 1, max: 5 })).toMatchObject({ code: 'range' });
    expect(numberProblem('0', { min: 1, max: 5 })).toMatchObject({ code: 'range' });
    expect(numberProblem('0', { min: 5, max: 9, allowZero: true })).toBe(0);
  });
});

describe('numeric ranges follow the contract', () => {
  const fieldSchema = (key: (typeof NUMERIC_KEYS)[number]) => securityPolicySchema.shape[key];

  it.each(NUMERIC_KEYS)('%s: the form range is exactly what the API accepts', (key) => {
    const { min, max, allowZero } = NUMERIC_FIELDS[key];
    const schema = fieldSchema(key);
    expect(schema.safeParse(min).success).toBe(true);
    expect(schema.safeParse(max).success).toBe(true);
    expect(schema.safeParse(max + 1).success).toBe(false);
    if (min > 0) {
      expect(schema.safeParse(0).success).toBe(allowZero === true);
      if (min > 1) expect(schema.safeParse(min - 1).success).toBe(false);
    } else {
      expect(schema.safeParse(-1).success).toBe(false);
    }
  });
});

describe('numeric ranges match the reference form', () => {
  // The limits Reference's Security page states on its number inputs (facts about the form, not its text).
  const REFERENCE = {
    lockoutAfterFailures: [1, 50],
    lockoutWindowMinutes: [1, 1440],
    passwordMaxAgeDays: [0, 3650],
    sessionTimeoutMinutes: [5, 1440],
    passwordMinLength: [6, 128],
    waMaxSendsPerMinute: [0, 10_000],
    waMaxSendsPerDay: [0, 1_000_000],
    waHoldOnLinksCount: [0, 50],
    apiRateLimitPerMinute: [1, 100_000],
    webhookReplayWindowSec: [10, 3600],
    deviceLogoutOnInactiveDays: [0, 3650],
    maxConcurrentSessions: [1, 50],
  } as const;

  it.each(Object.entries(REFERENCE))('%s', (key, [min, max]) => {
    const spec = NUMERIC_FIELDS[key as keyof typeof NUMERIC_FIELDS];
    expect([spec.min, spec.max]).toEqual([min, max]);
  });

  it('adds only the retention control, which the reference form leaves out', () => {
    expect(NUMERIC_KEYS.filter((k) => !(k in REFERENCE))).toEqual(['auditLogRetentionDays']);
  });

  it('refuses 0 for the three controls whose reference inputs start above it', () => {
    for (const key of [
      'sessionTimeoutMinutes',
      'maxConcurrentSessions',
      'lockoutAfterFailures',
    ] as const)
      expect(NUMERIC_FIELDS[key].allowZero).toBe(false);
  });
});
