import { describe, expect, it } from 'vitest';
import { securityPolicySchema } from '@crm/contracts';
import { evaluateContent } from '../../../src/modules/auth/security/send-policy.service';

const policy = (over: Record<string, unknown>) => securityPolicySchema.parse(over);

describe('send guardrail content checks', () => {
  it('passes everything when no filter is on', () => {
    expect(evaluateContent('You have won a prize! http://bit.ly/x', policy({}))).toBeNull();
  });

  it('flags a message with more links than the limit', () => {
    const body = 'see https://a.test https://b.test https://c.test';
    expect(evaluateContent(body, policy({ waHoldOnLinksCount: 2 }))).toBe('link_count');
    expect(evaluateContent(body, policy({ waHoldOnLinksCount: 3 }))).toBeNull();
  });

  it('flags scam phrasing, finance spam, shorteners and custom keywords independently', () => {
    expect(
      evaluateContent(
        'Congratulations, you have won a free phone',
        policy({ waHoldOnScamPattern: true }),
      ),
    ).toBe('scam_pattern');
    expect(
      evaluateContent(
        'Guaranteed returns on binary options',
        policy({ abuseBlockFinanceTerms: true }),
      ),
    ).toBe('finance_terms');
    expect(
      evaluateContent('details at https://bit.ly/abc', policy({ abuseBlockShortLinks: true })),
    ).toBe('short_link');
    expect(
      evaluateContent(
        'details at https://www.example.test/abc',
        policy({ abuseBlockShortLinks: true }),
      ),
    ).toBeNull();
    expect(
      evaluateContent('Quick MONEY inside', policy({ abuseBlockKeywordList: ['quick money'] })),
    ).toBe('keyword');
  });

  it('ignores blank bodies', () => {
    expect(
      evaluateContent('   ', policy({ waHoldOnScamPattern: true, abuseBlockKeywordList: ['x'] })),
    ).toBeNull();
  });
});
