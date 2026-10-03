import { describe, expect, it } from 'vitest';
import { securityPolicySchema } from '@crm/contracts';
import { evaluateContent } from '../../../src/modules/auth/security/send-policy.service';

const policy = (over: Record<string, unknown>) => securityPolicySchema.parse(over);
const shortLinks = policy({ abuseBlockShortLinks: true });

describe('short-link filter (TW-AUTH-041)', () => {
  it.each([
    'visit bit.ly/abc today',
    'https://bit.ly/abc',
    'go.bit.ly/abc',
    'WWW.TINYURL.COM/x',
    'see t.co/abc',
    'shop at soo.gd/z',
    'link: t2m.io/q',
    'Order here -> rb.gy/k9',
  ])('flags %s', (text) => {
    expect(evaluateContent(text, shortLinks)).toBe('short_link');
  });

  it.each([
    'visit https://www.example.test/page',
    'habit.ly is not a shortener',
    'robit.lyric.test',
    'sort.co.uk and tinyurl.community',
    'a normal sentence about bits',
  ])('does not flag %s', (text) => {
    expect(evaluateContent(text, shortLinks)).toBeNull();
  });
});

describe('link count (TW-AUTH-041)', () => {
  it('counts every http(s):// marker, including links with no space between them', () => {
    const p = policy({ waHoldOnLinksCount: 1 });
    expect(evaluateContent('http://a.test,http://b.test', p)).toBe('link_count');
    expect(evaluateContent('one http://a.test only', p)).toBeNull();
    expect(evaluateContent('HTTPS://A.TEST and https://b.test', p)).toBe('link_count');
  });
});

describe('scam and finance phrasing (TW-AUTH-041)', () => {
  const scam = policy({ waHoldOnScamPattern: true });
  const finance = policy({ abuseBlockFinanceTerms: true });

  it.each([
    'Congratulations! You are today the winner of a phone',
    'Congratulations, you have been selected',
    'you won a car',
    "You've won!",
    'Your account has been deactivated',
    'your account is locked',
    'account was suspended',
    'Click here to reactivate',
    'click to claim',
    'click to unlock',
    'URGENT: your attention, action required now',
    'KYC pending, share your details',
    'kyc update needed',
    'Complete your KYC today',
    'double your money in a week',
    'risk-free profit',
    'claim your prize',
    'verify your account',
  ])('flags scam wording: %s', (text) => {
    expect(evaluateContent(text, scam)).toBe('scam_pattern');
  });

  it.each([
    'Your order has been shipped',
    'Please update your address',
    'We won the award last year',
    'I want to claim a refund for a damaged parcel',
  ])('leaves ordinary messages alone: %s', (text) => {
    expect(evaluateContent(text, scam)).toBeNull();
  });

  it.each([
    'guaranteed income for life',
    'forex trading tips',
    'forex signals daily',
    'crypto investment plan',
    'cryptocurrency doubling offer',
    'crypto signals',
    'Instant personal loan, no checks',
    'instant loan today',
    'interest-free loan',
    'Earn 500 per day from home',
    'earn big daily',
    'Binary options course',
    'investment opportunity',
    'get rich quick',
  ])('flags finance wording: %s', (text) => {
    expect(evaluateContent(text, finance)).toBe('finance_terms');
  });

  it.each(['Our loan officer will call you', 'Save 10 per month with our plan'])(
    'does not flag %s',
    (text) => {
      expect(evaluateContent(text, finance)).toBeNull();
    },
  );
});
