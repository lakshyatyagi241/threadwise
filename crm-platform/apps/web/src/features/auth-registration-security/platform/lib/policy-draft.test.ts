import { describe, expect, it } from 'vitest';
import { securityPolicySchema } from '@crm/contracts';
import {
  BOOLEAN_KEYS,
  FIELD_TAB,
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
      allowZero: true,
    });
    expect(problems.lockoutWindowMinutes).toMatchObject({ code: 'range' });
    expect(problems.passwordMinLength).toMatchObject({ code: 'range', min: 6, max: 128 });
  });

  it('accepts 0 where the API means off or unlimited', () => {
    const d = { ...policyToDraft(base), sessionTimeoutMinutes: '0', maxConcurrentSessions: '0' };
    expect(buildPolicyPatch(base, d).patch).toEqual({
      sessionTimeoutMinutes: 0,
      maxConcurrentSessions: 0,
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

  it('flags over-long and over-many list entries', () => {
    const long = { ...policyToDraft(base), abuseBlockKeywordList: 'x'.repeat(101) };
    expect(buildPolicyPatch(base, long).problems.abuseBlockKeywordList).toEqual({
      code: 'tooLong',
      max: 100,
    });
    const many = {
      ...policyToDraft(base),
      abuseBlockKeywordList: Array.from({ length: 201 }, (_, i) => `k${i}`).join('\n'),
    };
    expect(buildPolicyPatch(base, many).problems.abuseBlockKeywordList).toEqual({
      code: 'tooMany',
      max: 200,
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
