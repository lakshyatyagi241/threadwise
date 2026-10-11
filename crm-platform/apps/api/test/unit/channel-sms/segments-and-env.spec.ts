import { describe, expect, it } from 'vitest';
import { measureSms, smsWarning } from '@crm/contracts';
import { readChannelSmsEnv } from '../../../src/config/domains/channel-sms.env';
import { SmsProviderGateway } from '../../../src/infra/providers/channel-sms/sms-gateway';
import type { SmsCredentials } from '../../../src/infra/providers/channel-sms/sms.port';

describe('TW-SMS-009: segments (contract acceptance criteria)', () => {
  it('160 GSM characters is one segment with nothing left; 161 is two of 153', () => {
    expect(measureSms('a'.repeat(160))).toEqual({
      segments: 1,
      encoding: 'GSM-7',
      units: 160,
      perSegment: 160,
      remaining: 0,
    });
    expect(measureSms('a'.repeat(161))).toEqual({
      segments: 2,
      encoding: 'GSM-7',
      units: 161,
      perSegment: 153,
      remaining: 145,
    });
    expect(measureSms('a'.repeat(306)).segments).toBe(2);
    expect(measureSms('a'.repeat(307)).segments).toBe(3);
  });

  it('one emoji makes the whole text UCS-2 (70 / 67), and an emoji counts as two UTF-16 units', () => {
    expect(measureSms('Hello 😀')).toMatchObject({
      encoding: 'UCS-2',
      segments: 1,
      perSegment: 70,
    });
    expect(measureSms('😀'.repeat(35)).segments).toBe(1);
    expect(measureSms('😀'.repeat(36)).segments).toBe(2);
    expect(measureSms('ы'.repeat(71))).toMatchObject({ segments: 2, perSegment: 67 });
    expect(measureSms('ы'.repeat(135)).segments).toBe(3);
  });

  it('extension characters cost two units; an empty text is one segment', () => {
    expect(measureSms('€€€')).toMatchObject({ units: 6, encoding: 'GSM-7' });
    expect(measureSms('€'.repeat(81)).segments).toBe(2);
    expect(measureSms('')).toEqual({
      segments: 1,
      encoding: 'GSM-7',
      units: 0,
      perSegment: 160,
      remaining: 160,
    });
  });

  it('the warning is empty for one segment and names the per-SMS limit otherwise', () => {
    expect(smsWarning(measureSms('hi'))).toBe('');
    expect(smsWarning(measureSms('ы'.repeat(71)))).toContain(
      '67 characters per SMS and will be billed as 2 messages',
    );
    expect(smsWarning(measureSms('a'.repeat(200)))).toBe(
      'This message is 200 characters and will be billed as 2 messages.',
    );
  });
});

describe('the SMS environment file', () => {
  it("defaults to the real provider addresses and Reference's timeouts", () => {
    expect(readChannelSmsEnv({})).toEqual({
      SMS_TWILIO_API_BASE: 'https://api.twilio.com',
      SMS_TWILIO_LOOKUP_BASE: 'https://lookups.twilio.com',
      SMS_MSG91_API_BASE: 'https://control.msg91.com',
      SMS_SEND_TIMEOUT_MS: 20_000,
      SMS_VERIFY_TIMEOUT_MS: 12_000,
    });
  });

  it('takes overrides, drops a trailing slash and stops the boot on a bad value', () => {
    expect(
      readChannelSmsEnv({ SMS_MSG91_API_BASE: 'http://stub.test/', SMS_SEND_TIMEOUT_MS: '3000' }),
    ).toMatchObject({
      SMS_MSG91_API_BASE: 'http://stub.test',
      SMS_SEND_TIMEOUT_MS: 3000,
    });
    expect(() => readChannelSmsEnv({ SMS_TWILIO_API_BASE: 'nope' })).toThrow(
      /Invalid SMS channel configuration/,
    );
    expect(() => readChannelSmsEnv({ SMS_SEND_TIMEOUT_MS: '5' })).toThrow(/SMS_SEND_TIMEOUT_MS/);
  });
});

describe('the gateway routes by provider (TW-SMS-010 rule 1)', () => {
  const env = readChannelSmsEnv({});
  const msg91: SmsCredentials = {
    provider: 'msg91',
    from: 'X',
    accountSid: '',
    authToken: '',
    senderId: '',
    dltTemplateId: '',
  };

  it('MSG91 never gets a Twilio lookup: the answer says so', async () => {
    const g = new SmsProviderGateway(env);
    expect(await g.lookup(msg91, '+14155551234')).toMatchObject({
      ok: false,
      message: 'Number checking needs a Twilio account; this number is on msg91.',
    });
  });

  it('a blank MSG91 key is refused before any network call (verify and send both)', async () => {
    const g = new SmsProviderGateway(env);
    expect(await g.verify(msg91)).toEqual({ ok: false, error: 'An MSG91 auth key is required.' });
    expect(await g.send(msg91, '919876543210', 'x')).toMatchObject({ ok: false });
  });
});
