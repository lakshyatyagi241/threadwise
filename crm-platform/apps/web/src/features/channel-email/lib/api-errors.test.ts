import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { mailErrorKey } from './api-errors';

describe('mail error codes', () => {
  it('words the mail codes itself, by code', () => {
    expect(mailErrorKey(ERROR_CODES.MAIL_NOT_CONFIGURED)).toBe('notConfigured');
    expect(mailErrorKey(ERROR_CODES.MAIL_MAILBOX_LIMIT)).toBe('limit');
    expect(mailErrorKey(ERROR_CODES.PLAN_LIMIT_REACHED)).toBe('limit');
    expect(mailErrorKey(ERROR_CODES.MAIL_MAILBOX_UNAVAILABLE)).toBe('unavailable');
    expect(mailErrorKey(ERROR_CODES.MAIL_SEND_REFUSED)).toBe('sendRefused');
    expect(mailErrorKey(ERROR_CODES.MAIL_WRONG_ACCOUNT)).toBe('wrongAccount');
    expect(mailErrorKey(ERROR_CODES.MAIL_PERSONAL_DISABLED)).toBe('personalDisabled');
    expect(mailErrorKey(ERROR_CODES.MAIL_PERSONAL_NOT_ALLOWED)).toBe('personalNotAllowed');
    expect(mailErrorKey(ERROR_CODES.MAIL_PROVIDER_UNSUPPORTED)).toBe('providerUnsupported');
    expect(mailErrorKey('ROW_VERSION_CONFLICT')).toBe('changed');
  });

  it('leaves any other code to the server sentence', () => {
    expect(mailErrorKey('SOMETHING_ELSE')).toBeNull();
  });
});
