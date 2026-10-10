import { describe, expect, it, vi } from 'vitest';
import {
  KEYWORD_LIST_MAX_CHARS,
  changePasswordRequestSchema,
  securityPolicyPatchSchema,
  securityPolicySchema,
} from '@crm/contracts';
import {
  isStrictAllowlistEntry,
  neutraliseAllowlist,
} from '../../../src/modules/auth/platform/ip-allowlist';
import {
  SecurityPolicyService,
  salvagePolicy,
} from '../../../src/modules/auth/platform/security-policy.service';
import { ipAllowed } from '../../../src/modules/auth/support/ip';

describe('settings matrix against the reference (WD-AUTH-037)', () => {
  it('defaults the allowed second-factor methods to authenticator app and email, like the reference', () => {
    expect(securityPolicySchema.parse({}).allowedMfaMethods).toEqual(['totp', 'email']);
    expect(securityPolicySchema.safeParse({ allowedMfaMethods: [] }).success).toBe(false);
  });

  it.each(['sessionTimeoutMinutes', 'maxConcurrentSessions', 'lockoutAfterFailures'])(
    'cannot save 0 for %s (the reference form refuses it)',
    (key) => {
      expect(securityPolicyPatchSchema.safeParse({ [key]: 0 }).success).toBe(false);
    },
  );

  it('keeps the reference ranges for those three', () => {
    const ok = (o: Record<string, number>) => securityPolicyPatchSchema.safeParse(o).success;
    expect(ok({ sessionTimeoutMinutes: 5 })).toBe(true);
    expect(ok({ sessionTimeoutMinutes: 4 })).toBe(false);
    expect(ok({ sessionTimeoutMinutes: 1441 })).toBe(false);
    expect(ok({ maxConcurrentSessions: 1 })).toBe(true);
    expect(ok({ maxConcurrentSessions: 51 })).toBe(false);
    expect(ok({ lockoutAfterFailures: 50 })).toBe(true);
    expect(ok({ lockoutAfterFailures: 51 })).toBe(false);
  });

  it('limits the keyword list like the reference text box: one 5000-character block, no per-word cap', () => {
    const long = 'x'.repeat(2000);
    expect(
      securityPolicyPatchSchema.safeParse({ abuseBlockKeywordList: [long, long] }).success,
    ).toBe(true);
    expect(
      securityPolicyPatchSchema.safeParse({ abuseBlockKeywordList: [long, long, long] }).success,
    ).toBe(false);
    // 500 short words is fine too (the old 200-item cap is gone).
    const many = Array.from({ length: 500 }, (_, i) => `w${i}`);
    expect(securityPolicyPatchSchema.safeParse({ abuseBlockKeywordList: many }).success).toBe(true);
    // Characters, not UTF-16 units: 5000 emoji joined by nothing are 5000, not 10000.
    expect(
      securityPolicyPatchSchema.safeParse({
        abuseBlockKeywordList: ['😀'.repeat(KEYWORD_LIST_MAX_CHARS)],
      }).success,
    ).toBe(true);
    expect(
      securityPolicyPatchSchema.safeParse({
        abuseBlockKeywordList: ['😀'.repeat(KEYWORD_LIST_MAX_CHARS + 1)],
      }).success,
    ).toBe(false);
  });

  it('lets the password floor in the contract sit at the policy minimum of 8', () => {
    expect(securityPolicyPatchSchema.safeParse({ passwordMinLength: 8 }).success).toBe(true);
    expect(securityPolicyPatchSchema.safeParse({ passwordMinLength: 7 }).success).toBe(false);
    expect(
      changePasswordRequestSchema.safeParse({ currentPassword: 'x', newPassword: 'Ab1de6xy' })
        .success,
    ).toBe(true);
    expect(
      changePasswordRequestSchema.safeParse({ currentPassword: 'x', newPassword: 'Ab1d' }).success,
    ).toBe(false);
  });

  it('defaults to a strong password policy: 12 characters, blocklist and breach check on', () => {
    const p = salvagePolicy({}).policy;
    expect(p.passwordMinLength).toBe(12);
    expect(p.passwordBlocklistEnabled).toBe(true);
    expect(p.passwordBreachCheck).toBe(true);
  });

  it('reads a stored minimum below the new floor back as the default, key by key', () => {
    const { policy, rejected } = salvagePolicy({ passwordMinLength: 6, requireMfaForAll: true });
    expect(rejected).toEqual(['passwordMinLength']);
    expect(policy.passwordMinLength).toBe(12);
    expect(policy.requireMfaForAll).toBe(true);
  });
});

describe('a stored policy with a bad value (WD-AUTH-037)', () => {
  it('keeps every valid key and defaults only the bad one', () => {
    const { policy, rejected } = salvagePolicy({
      requireMfaForAll: true,
      ipAllowlistEnabled: true,
      ipAllowlistCidrs: ['203.0.113.0/24'],
      waGuardrailsMode: 'enforce',
      lockoutAfterFailures: 0, // out of range now
      sessionTimeoutMinutes: 'soon', // wrong type
      abuseBlockKeywordList: ['lottery'],
    });
    expect(rejected.sort()).toEqual(['lockoutAfterFailures', 'sessionTimeoutMinutes']);
    expect(policy).toMatchObject({
      requireMfaForAll: true,
      ipAllowlistEnabled: true,
      ipAllowlistCidrs: ['203.0.113.0/24'],
      waGuardrailsMode: 'enforce',
      abuseBlockKeywordList: ['lottery'],
      // defaulted, individually
      lockoutAfterFailures: 5,
      sessionTimeoutMinutes: 60,
    });
  });

  it('returns the whole document untouched when it is valid, and tolerates a non-object', () => {
    expect(salvagePolicy({ requireMfaForAdmins: true }).rejected).toEqual([]);
    for (const junk of [null, undefined, 'x', 7, ['a']]) {
      expect(salvagePolicy(junk).policy).toEqual(securityPolicySchema.parse({}));
    }
  });

  it('does not let one bad key switch the allowlist or the guardrails off when read through the service', async () => {
    const stored = {
      ipAllowlistEnabled: true,
      ipAllowlistCidrs: ['198.51.100.7'],
      waGuardrailsMode: 'enforce',
      passwordMinLength: 3,
    };
    const svc = new SecurityPolicyService(
      { get: vi.fn().mockResolvedValue(stored) } as never,
      {} as never,
    );
    const p = await svc.policy();
    expect(p.ipAllowlistEnabled).toBe(true);
    expect(p.ipAllowlistCidrs).toEqual(['198.51.100.7']);
    expect(p.waGuardrailsMode).toBe('enforce');
    expect(p.passwordMinLength).toBe(12);
  });
});

describe('IP allowlist entries (WD-AUTH-038)', () => {
  it.each([
    '203.0.113.9',
    '203.0.113.0/24',
    '0.0.0.0/0',
    '10.0.0.5/32',
    '2001:db8::1',
    '2001:db8::/32',
    '::1/128',
    '::ffff:10.0.0.1',
  ])('accepts %s', (entry) => {
    expect(isStrictAllowlistEntry(entry)).toBe(true);
  });

  it.each([
    'x/',
    'x/8',
    '10.0.0.5/',
    '/8',
    '//8',
    '10.0.0.5//8',
    '10.0.0.5/8/9',
    '10.0.0.5/0x8',
    '10.0.0.5/1e1',
    '10.0.0.5/ 8',
    '10.0.0.5/-1',
    '10.0.0.5/33',
    '2001:db8::/129',
    '10.0.0.5/08x',
    '::ffff:10.0.0.1/104',
    'not-an-ip',
    '10.0.0.256',
    '',
  ])('rejects %s', (entry) => {
    expect(isStrictAllowlistEntry(entry)).toBe(false);
  });

  it('turns a stored malformed entry into one that matches nothing, never everything', () => {
    // The lenient reader this guards against: "10.0.0.5/" reads as /0.
    expect(ipAllowed('198.51.100.1', ['10.0.0.5/'])).toBe(false);
    const { entries, rejected } = neutraliseAllowlist(['10.0.0.5/', 'x/', '203.0.113.0/24']);
    expect(rejected).toEqual(['10.0.0.5/', 'x/']);
    expect(entries).toHaveLength(3);
    expect(ipAllowed('198.51.100.1', entries)).toBe(false);
    expect(ipAllowed('203.0.113.77', entries)).toBe(true);
  });

  it('keeps a list of only bad entries non-empty, so "empty list = everyone" cannot happen by accident', () => {
    const { entries } = neutraliseAllowlist(['10.0.0.5/']);
    expect(entries.length).toBe(1);
    expect(ipAllowed('198.51.100.1', entries)).toBe(false);
  });
});
