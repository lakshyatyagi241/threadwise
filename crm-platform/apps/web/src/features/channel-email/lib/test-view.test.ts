import { describe, expect, it } from 'vitest';
import { ERROR_CODES, type MailTestSide } from '@crm/contracts';
import { lagIsHigh, lagView, sideView, testErrorKey } from './test-view';

const side = (o: Partial<MailTestSide>): MailTestSide => ({
  ok: true,
  failedStep: null,
  reason: null,
  message: null,
  inboxMessages: null,
  ...o,
});

describe('sideView', () => {
  it('an ok side keeps the INBOX count, a failed one its reason', () => {
    expect(sideView(side({ inboxMessages: 7 }))).toEqual({ ok: true, inboxMessages: 7 });
    expect(sideView(side({ ok: false, failedStep: 'login', reason: 'auth_failed' }))).toEqual({
      ok: false,
      reason: 'auth_failed',
    });
    expect(sideView(side({ ok: false, failedStep: 'connect', reason: null }))).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });
});

describe('testErrorKey', () => {
  it('the rate limit has its own message, everything else the generic one', () => {
    expect(testErrorKey(ERROR_CODES.MAIL_RATE_LIMITED)).toBe('tooMany');
    expect(testErrorKey(ERROR_CODES.MAIL_MAILBOX_UNAVAILABLE)).toBe('failed');
    expect(testErrorKey('ANYTHING')).toBe('failed');
  });
});

describe('lagView', () => {
  it('words the delay in the unit a person reads', () => {
    expect(lagView(null)).toBeNull();
    expect(lagView(undefined)).toBeNull();
    expect(lagView(0)).toEqual({ key: 'lagUnderMinute' });
    expect(lagView(59)).toEqual({ key: 'lagUnderMinute' });
    expect(lagView(60)).toEqual({ key: 'lagMinutes', count: 1 });
    expect(lagView(3_599)).toEqual({ key: 'lagMinutes', count: 59 });
    expect(lagView(3_600)).toEqual({ key: 'lagHours', count: 1 });
    expect(lagView(90_000)).toEqual({ key: 'lagHours', count: 25 });
  });
  it('is worth a warning past ten minutes', () => {
    expect(lagIsHigh(600)).toBe(false);
    expect(lagIsHigh(601)).toBe(true);
    expect(lagIsHigh(null)).toBe(false);
  });
});
