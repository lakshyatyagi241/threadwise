import { describe, expect, it } from 'vitest';
import {
  BAD_RECIPIENT,
  NO_CREDENTIALS,
  credentialsProblem,
  describeLine,
  explainMsg91,
  explainTwilio,
  isAlphanumericFrom,
  msg91Recipient,
  scrub,
  twilioFrom,
  twilioRecipient,
} from '../../../src/infra/providers/channel-sms/sms-rules';
import type { SmsCredentials } from '../../../src/infra/providers/channel-sms/sms.port';

const twilio: SmsCredentials = {
  provider: 'twilio',
  from: '+17372508034',
  accountSid: 'AC123',
  authToken: 'tok',
  senderId: '',
  dltTemplateId: '',
};

describe('TW-SMS-010: sendable check and normalisation', () => {
  it('a Twilio sender needs From, SID and token; MSG91 needs From and the key only', () => {
    expect(credentialsProblem(twilio)).toBeNull();
    expect(credentialsProblem({ ...twilio, authToken: ' ' })).toBe(NO_CREDENTIALS);
    expect(credentialsProblem({ ...twilio, accountSid: '' })).toBe(NO_CREDENTIALS);
    expect(credentialsProblem({ ...twilio, from: '  ' })).toBe(NO_CREDENTIALS);
    const msg91: SmsCredentials = { ...twilio, provider: 'msg91', accountSid: '' };
    expect(credentialsProblem(msg91)).toBeNull();
    expect(credentialsProblem({ ...msg91, authToken: '' })).toBe(NO_CREDENTIALS);
  });

  it('Twilio recipients are digits with a plus; MSG91 recipients are digits only', () => {
    expect(twilioRecipient('(415) 555-1234')).toBe('+4155551234');
    expect(msg91Recipient('+91 98765-43210')).toBe('919876543210');
    expect(twilioRecipient('abc')).toBeNull();
    expect(msg91Recipient('')).toBeNull();
    expect(BAD_RECIPIENT).toContain('could not be read');
  });

  it('a From with any letter is alphanumeric and passes through untouched; a number gets +digits', () => {
    expect(isAlphanumericFrom('ACMEIN')).toBe(true);
    expect(isAlphanumericFrom('+1 737 250 8034')).toBe(false);
    expect(twilioFrom('ACMEIN')).toBe('ACMEIN');
    expect(twilioFrom('1 (737) 250-8034')).toBe('+17372508034');
  });

  it('scrub hides every secret and ignores trivially short ones', () => {
    expect(scrub('bad token sekret-1234 for AC123456', ['sekret-1234', 'AC123456'])).toBe(
      'bad token *** for ***',
    );
    expect(scrub('abc', ['a'])).toBe('abc');
  });
});

describe('TW-SMS-013: provider error translation', () => {
  it.each([
    [572006, 'Trial accounts can only send their own preset templates'],
    [21608, 'Trial accounts can only send to verified numbers'],
    [21211, 'full international format, e.g. +919876543210'],
    [21606, 'not valid for SMS on this Twilio account'],
    [21212, 'not valid for SMS on this Twilio account'],
    [21610, 'replied STOP and is unsubscribed'],
    [21614, 'cannot receive SMS'],
  ])('Twilio %s', (code, fragment) => {
    expect(explainTwilio(code, 'Twilio words', 400)).toContain(fragment);
  });

  it("an unknown Twilio code keeps Twilio's own message, else the HTTP status", () => {
    expect(explainTwilio(30003, 'Unreachable destination handset', 400)).toBe(
      'Unreachable destination handset',
    );
    expect(explainTwilio(0, undefined, 503)).toBe('HTTP 503');
  });

  it('MSG91: the first matching rule wins and the original is kept in brackets where it helps', () => {
    expect(explainMsg91('Invalid authkey')).toBe(
      'MSG91 rejected the auth key — check it on the SMS page.',
    );
    expect(explainMsg91('DLT template mismatch')).toContain('MSG91 rejected the DLT template id.');
    expect(explainMsg91('DLT template mismatch')).toContain('(DLT template mismatch)');
    expect(explainMsg91('Invalid sender ID')).toContain('exactly 6 letters and DLT-registered');
    expect(explainMsg91('Invalid sender ID')).toContain('(Invalid sender ID)');
    expect(explainMsg91('Low balance')).toBe('The MSG91 account is out of credit.');
    expect(explainMsg91('Something else')).toBe('Something else');
  });
});

describe('TW-SMS-008 rule 10: the lookup sentence', () => {
  it('says what a number is and appends the carrier', () => {
    expect(describeLine('mobile', 'mobile', 'Airtel')).toBe(
      'Mobile — can receive SMS. Carrier: Airtel.',
    );
    expect(describeLine('landline', 'landline', null)).toBe(
      'Landline — cannot receive SMS. Texting it is charged and lost.',
    );
    expect(describeLine('voip', 'nonFixedVoip', null)).toContain('VoIP');
    expect(describeLine('invalid', null, null)).toContain(
      'texting it would be charged and never arrive',
    );
    expect(describeLine('unknown', null, null)).toBe(
      'Valid number. Twilio did not report a line type.',
    );
    expect(describeLine('unknown', 'tollFree', null)).toBe('Valid tollFree number.');
  });
});
