import { describe, expect, it } from 'vitest';
import {
  mapProviderStatus,
  parseMsg91Report,
  parseTwilioReport,
} from '../../../src/modules/channel-sms/status-rules';

describe('TW-SMS-022 rule 4: status mapping', () => {
  it.each([
    ['sent', 'sent'],
    ['delivered', 'delivered'],
    ['undelivered', 'failed'],
    ['failed', 'failed'],
    [' DELIVERED ', 'delivered'],
    ['DELIVRD', 'delivered'],
    ['1', 'delivered'],
    ['2', 'failed'],
    ['9', 'failed'],
    ['25', 'failed'],
    ['Rejected', 'failed'],
    ['EXPIRED', 'failed'],
    ['BLOCKED', 'failed'],
    ['ndnd', 'failed'],
    ['NDNC', 'failed'],
    ['message sent to operator', 'sent'],
  ])('%s -> %s', (raw, want) => {
    expect(mapProviderStatus(raw)).toBe(want);
  });

  it.each(['queued', 'sending', 'accepted', 'submitted', 'scheduled', 'canceled', '7', '', '   '])(
    '%s records nothing',
    (raw) => {
      expect(mapProviderStatus(raw)).toBeNull();
    },
  );

  it('failure is checked before delivery, so "undelivered" is never delivered', () => {
    expect(mapProviderStatus('undelivered')).toBe('failed');
    expect(mapProviderStatus('NOT DELIVERED - rejected')).toBe('failed');
  });

  it('delivery_unknown and partially_delivered are not delivery (a deliberate fix of Reference)', () => {
    expect(mapProviderStatus('delivery_unknown')).toBeNull();
    expect(mapProviderStatus('partially_delivered')).toBeNull();
  });
});

describe('TW-SMS-022: Twilio form callback', () => {
  it('reads MessageSid / MessageStatus / ErrorCode, with the older SmsSid / SmsStatus as fallback', () => {
    expect(
      parseTwilioReport({
        MessageSid: 'SM1',
        MessageStatus: 'undelivered',
        ErrorCode: '30003',
        ErrorMessage: 'Unreachable',
      }),
    ).toEqual({
      provider: 'twilio',
      messageId: 'SM1',
      status: 'failed',
      errorCode: '30003',
      errorMessage: 'Unreachable',
    });
    expect(parseTwilioReport({ SmsSid: 'SM2', SmsStatus: 'delivered' })).toMatchObject({
      messageId: 'SM2',
      status: 'delivered',
      errorCode: null,
    });
  });

  it('a missing id or status, a status that says nothing and a malformed body all read as nothing', () => {
    expect(parseTwilioReport({ MessageStatus: 'delivered' })).toBeNull();
    expect(parseTwilioReport({ MessageSid: 'SM1' })).toBeNull();
    expect(parseTwilioReport({ MessageSid: 'SM1', MessageStatus: 'queued' })).toBeNull();
    expect(parseTwilioReport(null)).toBeNull();
    expect(parseTwilioReport('x')).toBeNull();
    expect(parseTwilioReport([1])).toBeNull();
  });
});

describe('TW-SMS-022: MSG91 delivery report shapes', () => {
  it('top level requestId and status', () => {
    expect(parseMsg91Report({ requestId: 'R1', status: 'DELIVRD' })).toMatchObject({
      messageId: 'R1',
      status: 'delivered',
      provider: 'msg91',
    });
    expect(parseMsg91Report({ request_id: 'R2', deliveryStatus: 'failed' })).toMatchObject({
      messageId: 'R2',
      status: 'failed',
    });
  });

  it('wrapped in data', () => {
    expect(parseMsg91Report({ data: { requestId: 'R3', status: 'delivered' } })).toMatchObject({
      messageId: 'R3',
      status: 'delivered',
    });
  });

  it('a nested report: a string, or a list whose first entry holds status, deliveryStatus or desc (and the id)', () => {
    expect(parseMsg91Report({ requestId: 'R4', report: 'DELIVRD' })).toMatchObject({
      status: 'delivered',
    });
    expect(parseMsg91Report({ report: [{ requestId: 'R5', desc: 'Rejected' }] })).toMatchObject({
      messageId: 'R5',
      status: 'failed',
    });
    expect(
      parseMsg91Report({ requestId: 'R6', report: [{ deliveryStatus: 'delivered' }] }),
    ).toMatchObject({ messageId: 'R6', status: 'delivered' });
  });

  it('nothing to act on', () => {
    expect(parseMsg91Report({ requestId: 'R7' })).toBeNull();
    expect(parseMsg91Report({ status: 'delivered' })).toBeNull();
    expect(parseMsg91Report({ requestId: 'R8', status: 'queued' })).toBeNull();
    expect(parseMsg91Report(undefined)).toBeNull();
  });
});
