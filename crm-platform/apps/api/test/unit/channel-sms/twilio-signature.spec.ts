import { describe, expect, it } from 'vitest';
import {
  twilioSignature,
  verifyTwilioSignature,
} from '../../../src/infra/providers/channel-sms/twilio-signature';

const url = 'https://app.example.com/v2/sms/status';
const params = { MessageSid: 'SM1', MessageStatus: 'delivered', ErrorCode: '' };

describe('Twilio request signature (TW-SMS-022 rule 9)', () => {
  it("matches Twilio's published algorithm: HMAC-SHA1 over url + name/value pairs in name order, base64", () => {
    // Worked example from Twilio's documentation of the algorithm.
    const sig = twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', {
      CallSid: 'CA1234567890ABCDE',
      Caller: '+12349013030',
      Digits: '1234',
      From: '+12349013030',
      To: '+18005551212',
    });
    expect(sig).toBe('0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
  });

  it('accepts the right signature and refuses a wrong token, url, field, empty or missing header', () => {
    const good = twilioSignature('tok', url, params);
    expect(verifyTwilioSignature('tok', url, params, good)).toBe(true);
    expect(verifyTwilioSignature('other', url, params, good)).toBe(false);
    expect(verifyTwilioSignature('tok', `${url}x`, params, good)).toBe(false);
    expect(verifyTwilioSignature('tok', url, { ...params, MessageStatus: 'failed' }, good)).toBe(
      false,
    );
    expect(verifyTwilioSignature('tok', url, params, undefined)).toBe(false);
    expect(verifyTwilioSignature('tok', url, params, '')).toBe(false);
    expect(verifyTwilioSignature('', url, params, good)).toBe(false);
    expect(verifyTwilioSignature('tok', url, params, 'short')).toBe(false);
  });
});
