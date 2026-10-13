import { describe, expect, it } from 'vitest';
import { EMPTY_CONNECT, toConnectInput, validateConnect, type ConnectForm } from './connect-model';

const form = (o: Partial<ConnectForm> = {}): ConnectForm => ({
  ...EMPTY_CONNECT,
  fromNumber: '+17372508034',
  ...o,
});

describe('the connect form checks before the provider is asked', () => {
  it('accepts a Twilio number with the keys left blank (the WhatsApp keys are reused)', () => {
    expect(validateConnect(form())).toEqual({});
  });

  it('needs the From value, and caps it at 32 characters', () => {
    expect(validateConnect(form({ fromNumber: '   ' })).fromNumber).toBe('fromRequired');
    expect(validateConnect(form({ fromNumber: 'x'.repeat(33) })).fromNumber).toBe('fromTooLong');
    expect(validateConnect(form({ fromNumber: 'x'.repeat(32) })).fromNumber).toBeUndefined();
  });

  it('refuses a Twilio SID that is not an Account SID, such as an API key', () => {
    expect(validateConnect(form({ accountSid: 'SKabc' })).accountSid).toBe('sidShape');
    expect(validateConnect(form({ accountSid: 'ACabc' })).accountSid).toBeUndefined();
    expect(validateConnect(form({ accountSid: `AC${'1'.repeat(70)}` })).accountSid).toBe(
      'sidTooLong',
    );
  });

  it('requires the MSG91 key, which lives in the token field, and ignores the SID', () => {
    expect(validateConnect(form({ provider: 'msg91' })).authToken).toBe('tokenRequired');
    expect(validateConnect(form({ provider: 'msg91', authToken: 'key' }))).toEqual({});
    expect(
      validateConnect(form({ provider: 'msg91', authToken: 'key', accountSid: 'SK' })),
    ).toEqual({});
  });

  it('caps the DLT fields, the token, the rate and the currency', () => {
    const e = validateConnect(
      form({
        provider: 'msg91',
        authToken: 'k'.repeat(256),
        senderId: 'S'.repeat(17),
        dltTemplateId: 'T'.repeat(65),
        ratePerSegment: '-1',
        currency: 'CURRENCY12',
      }),
    );
    expect(e).toEqual({
      authToken: 'tokenTooLong',
      senderId: 'senderIdTooLong',
      dltTemplateId: 'dltTemplateTooLong',
      ratePerSegment: 'rateInvalid',
      currency: 'currencyTooLong',
    });
  });

  it('takes a blank rate, zero and decimals; rejects text', () => {
    expect(validateConnect(form({ ratePerSegment: '' })).ratePerSegment).toBeUndefined();
    expect(validateConnect(form({ ratePerSegment: '0' })).ratePerSegment).toBeUndefined();
    expect(validateConnect(form({ ratePerSegment: '0.0075' })).ratePerSegment).toBeUndefined();
    expect(validateConnect(form({ ratePerSegment: 'abc' })).ratePerSegment).toBe('rateInvalid');
  });
});

describe('the request built from the form', () => {
  it('trims, and turns blanks into absent fields', () => {
    const r = toConnectInput(form({ fromNumber: '  +1 737  ', ratePerSegment: '', currency: ' ' }));
    expect(r).toMatchObject({ provider: 'twilio', fromNumber: '+1 737' });
    expect(r.ratePerSegment).toBeUndefined();
    expect(r.currency).toBeUndefined();
    expect(r.accountSid).toBeUndefined();
  });

  it('never sends the DLT fields for Twilio, even when they were typed before switching', () => {
    const r = toConnectInput(form({ senderId: 'ACMEIN', dltTemplateId: '123', accountSid: 'AC1' }));
    expect(r.senderId).toBe('');
    expect(r.dltTemplateId).toBe('');
    expect(r.accountSid).toBe('AC1');
  });

  it('sends the DLT fields and the key for MSG91, and never the Twilio SID', () => {
    const r = toConnectInput(
      form({
        provider: 'msg91',
        authToken: 'key',
        senderId: 'ACMEIN',
        dltTemplateId: '1107',
        accountSid: 'AC1',
        ratePerSegment: '0.0075',
        currency: 'inr',
      }),
    );
    expect(r).toMatchObject({
      provider: 'msg91',
      authToken: 'key',
      senderId: 'ACMEIN',
      dltTemplateId: '1107',
      ratePerSegment: 0.0075,
      currency: 'inr',
    });
    expect(r.accountSid).toBeUndefined();
  });
});
