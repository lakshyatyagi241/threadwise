import { describe, expect, it } from 'vitest';
import {
  checkEmail,
  checkTag,
  consentWithText,
  emailsIssue,
  ownerRuleForMode,
  ownerRuleIssue,
  parseBoundedInt,
  parseRetention,
  privacyUrlIssue,
  redirectIssue,
  retentionAfterToggle,
  submitLabelIssue,
} from './settings-model';
import type { FormConsent } from './types';

const A = '5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d11';
const B = '9d1f0b9a-6c52-4a3b-8d5e-2f6a7c1b0e22';
const consent = (over: Partial<FormConsent> = {}): FormConsent => ({
  enabled: true,
  text: 'I agree.',
  required: true,
  marketing: false,
  version: 3,
  ...over,
});

describe('ownerRuleIssue', () => {
  it('follows the contract for each mode', () => {
    expect(ownerRuleIssue({ mode: 'unassigned', userIds: [] })).toBeNull();
    expect(ownerRuleIssue({ mode: 'unassigned', userIds: [A] })).toBe('unassigned_none');
    expect(ownerRuleIssue({ mode: 'fixed', userIds: [] })).toBe('fixed_one');
    expect(ownerRuleIssue({ mode: 'fixed', userIds: [A, B] })).toBe('fixed_one');
    expect(ownerRuleIssue({ mode: 'fixed', userIds: [A] })).toBeNull();
    expect(ownerRuleIssue({ mode: 'round_robin', userIds: [A] })).toBe('round_robin_two');
    expect(ownerRuleIssue({ mode: 'round_robin', userIds: [A, B] })).toBeNull();
  });
  it('keeps what still fits when the mode changes', () => {
    expect(ownerRuleForMode('unassigned', [A, B])).toEqual({ mode: 'unassigned', userIds: [] });
    expect(ownerRuleForMode('fixed', [A, B])).toEqual({ mode: 'fixed', userIds: [A] });
    expect(ownerRuleForMode('round_robin', [A])).toEqual({ mode: 'round_robin', userIds: [A] });
  });
});

describe('emails', () => {
  it('lower-cases, rejects bad, duplicate and the sixth address', () => {
    expect(checkEmail('  Ops@Acme.COM ', [])).toEqual({ ok: true, value: 'ops@acme.com' });
    expect(checkEmail('', [])).toEqual({ ok: false, issue: 'empty' });
    expect(checkEmail('nope', [])).toEqual({ ok: false, issue: 'invalid' });
    expect(checkEmail('ops@acme.com', ['ops@acme.com'])).toEqual({ ok: false, issue: 'duplicate' });
    expect(checkEmail('x@y.co', ['a@a.co', 'b@a.co', 'c@a.co', 'd@a.co', 'e@a.co'])).toEqual({
      ok: false,
      issue: 'max',
    });
  });
  it('flags a stored list the contract would refuse', () => {
    expect(emailsIssue(['a@b.co'])).toBeNull();
    expect(emailsIssue(['bad'])).toBe('invalid');
    expect(emailsIssue(Array.from({ length: 6 }, (_, i) => `u${i}@b.co`))).toBe('max');
  });
});

describe('tags', () => {
  it('trims, collapses spaces, and refuses empty, long, repeated (any case) and the eleventh', () => {
    expect(checkTag('  web   form ', [])).toEqual({ ok: true, value: 'web form' });
    expect(checkTag('   ', [])).toEqual({ ok: false, issue: 'empty' });
    expect(checkTag('x'.repeat(61), [])).toEqual({ ok: false, issue: 'too_long' });
    expect(checkTag('x'.repeat(60), []).ok).toBe(true);
    expect(checkTag('Web', ['web'])).toEqual({ ok: false, issue: 'duplicate' });
    expect(
      checkTag(
        'new',
        Array.from({ length: 10 }, (_, i) => `t${i}`),
      ),
    ).toEqual({
      ok: false,
      issue: 'max',
    });
  });
});

describe('retention and numbers', () => {
  it('accepts 30 to 3650 and nothing else', () => {
    expect(parseRetention('30')).toBe(30);
    expect(parseRetention('3650')).toBe(3650);
    expect(parseRetention('29')).toBeNull();
    expect(parseRetention('3651')).toBeNull();
    expect(parseRetention('')).toBeNull();
    expect(parseRetention('1.5')).toBeNull();
    expect(parseRetention('-40')).toBeNull();
    expect(parseBoundedInt(' 20 ', 1, 600)).toBe(20);
  });
  it('keep-forever stores null and unticking restores the last number or the default', () => {
    expect(retentionAfterToggle(true, 90)).toBeNull();
    expect(retentionAfterToggle(false, 90)).toBe(90);
    expect(retentionAfterToggle(false, null)).toBe(365);
  });
});

describe('consent version', () => {
  const saved = consent();
  it('bumps once after publish when the text differs from the saved copy', () => {
    expect(consentWithText(saved, 'I agree to emails.', saved, true).version).toBe(4);
    expect(consentWithText(saved, 'I agree to emails!', saved, true).version).toBe(4);
  });
  it('returns to the saved version when the text is put back', () => {
    expect(consentWithText(saved, 'I agree.', saved, true).version).toBe(3);
  });
  it('never bumps for a form that was not published', () => {
    expect(consentWithText(saved, 'Other', saved, false).version).toBe(3);
  });
  it('keeps the other consent settings', () => {
    expect(consentWithText(consent({ marketing: true }), 'Other', saved, true).marketing).toBe(
      true,
    );
  });
});

describe('after submit', () => {
  it('requires an https redirect only in redirect mode', () => {
    expect(redirectIssue('message', undefined)).toBeNull();
    expect(redirectIssue('redirect', '')).toBe('required');
    expect(redirectIssue('redirect', 'http://a.co')).toBe('https');
    expect(redirectIssue('redirect', 'javascript:alert(1)')).toBe('https');
    expect(redirectIssue('redirect', 'https://a.co/thanks')).toBeNull();
    expect(redirectIssue('message', 'ftp://a.co')).toBe('https');
  });
  it('checks the privacy link and the button label', () => {
    expect(privacyUrlIssue(undefined)).toBeNull();
    expect(privacyUrlIssue('http://a.co')).toBe('https');
    expect(privacyUrlIssue('https://a.co/privacy')).toBeNull();
    expect(submitLabelIssue('  ')).toBe('empty');
    expect(submitLabelIssue('x'.repeat(61))).toBe('too_long');
    expect(submitLabelIssue('Send')).toBeNull();
  });
});
