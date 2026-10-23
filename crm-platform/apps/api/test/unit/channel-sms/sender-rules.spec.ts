import { describe, expect, it } from 'vitest';
import { connectSmsSenderSchema } from '@crm/contracts';
import {
  contactOfReference,
  credentialsToStore,
  deliveryReportUrl,
  mergeMeta,
  quotaMessage,
  randomToken,
  senderKey,
  subjectOfReference,
  usageAggregateOf,
  usagePeriod,
  usageSourceOf,
} from '../../../src/modules/channel-sms/sender-rules';

const parse = (v: Record<string, unknown>) =>
  connectSmsSenderSchema.parse({ fromNumber: '+17372508034', ...v });

describe('TW-SMS-002: the connect input', () => {
  it('defaults the provider to Twilio and treats blank credentials as absent', () => {
    const i = parse({ accountSid: '  ', authToken: '' });
    expect(i.provider).toBe('twilio');
    expect(i.accountSid).toBeUndefined();
    expect(i.authToken).toBeUndefined();
    expect(i.senderId).toBe('');
  });

  it("rejects an unknown provider, an over-long field and a missing From with Reference's sentences", () => {
    expect(
      connectSmsSenderSchema.safeParse({ fromNumber: '1', provider: 'telegram' }).error?.issues[0]
        ?.message,
    ).toBe('The selected sms provider is invalid.');
    expect(connectSmsSenderSchema.safeParse({ fromNumber: '' }).success).toBe(false);
    expect(connectSmsSenderSchema.safeParse({ fromNumber: 'x'.repeat(33) }).success).toBe(false);
    expect(
      connectSmsSenderSchema.safeParse({ fromNumber: '1', senderId: 'x'.repeat(17) }).success,
    ).toBe(false);
    expect(
      connectSmsSenderSchema.safeParse({ fromNumber: '1', dltTemplateId: 'x'.repeat(65) }).success,
    ).toBe(false);
    expect(connectSmsSenderSchema.safeParse({ fromNumber: '1', ratePerSegment: -1 }).success).toBe(
      false,
    );
  });

  it('trims the From value and keeps "+1 737" and "1737" as different values', () => {
    expect(parse({ fromNumber: '  +1 737 250 8034 ' }).fromNumber).toBe('+1 737 250 8034');
    expect(parse({ fromNumber: '17372508034' }).fromNumber).not.toBe(
      parse({ fromNumber: '+17372508034' }).fromNumber,
    );
  });
});

describe('TW-SMS-002 rules 5, 8, 9, 13: what is stored', () => {
  it('MSG91 keeps its key in the token field, from the SID field when the token is blank, and never in both', () => {
    const typedInSid = parse({ provider: 'msg91', accountSid: 'KEY-IN-SID' });
    expect(credentialsToStore(typedInSid, null)).toEqual({
      accountSid: '',
      authToken: 'KEY-IN-SID',
    });
    const both = parse({ provider: 'msg91', accountSid: 'A', authToken: 'B' });
    expect(credentialsToStore(both, null)).toEqual({ accountSid: '', authToken: 'B' });
  });

  it("Twilio fills each blank field on its own from the workspace's WhatsApp Twilio keys; a typed field wins", () => {
    const reuse = { accountSid: 'ACold', authToken: 'oldtoken' };
    expect(credentialsToStore(parse({}), reuse)).toEqual(reuse);
    expect(credentialsToStore(parse({ accountSid: 'ACnew' }), reuse)).toEqual({
      accountSid: 'ACnew',
      authToken: 'oldtoken',
    });
    expect(credentialsToStore(parse({ authToken: 'newtoken' }), reuse)).toEqual({
      accountSid: 'ACold',
      authToken: 'newtoken',
    });
    expect(credentialsToStore(parse({}), null)).toEqual({ accountSid: '', authToken: '' });
  });

  it('meta: rate as a string (blank stays null), currency upper-cased and USD by default, blank DLT fields overwrite', () => {
    const first = mergeMeta(
      null,
      parse({ ratePerSegment: '0.0075', currency: 'inr', senderId: 'THRDWS', dltTemplateId: 'T1' }),
      () => 's',
    );
    expect(first).toMatchObject({
      sms_provider: 'twilio',
      rate_per_segment: '0.0075',
      currency: 'INR',
      sender_id: 'THRDWS',
      dlt_template_id: 'T1',
    });
    const again = mergeMeta(first, parse({}), () => 's');
    expect(again).toMatchObject({
      rate_per_segment: null,
      currency: 'USD',
      sender_id: '',
      dlt_template_id: '',
    });
  });

  it('only MSG91 gets a delivery-report secret, and a re-submit keeps it', () => {
    expect(mergeMeta(null, parse({}), () => 'x').dlr_secret).toBeUndefined();
    const m = mergeMeta(null, parse({ provider: 'msg91', authToken: 'k' }), () => 'fresh-secret');
    expect(m.dlr_secret).toBe('fresh-secret');
    expect(
      mergeMeta(m, parse({ provider: 'msg91', authToken: 'k' }), () => 'other').dlr_secret,
    ).toBe('fresh-secret');
  });

  it('clears a previous refusal on reconnect', () => {
    expect(mergeMeta({ last_error: 'key revoked' }, parse({}), () => 's').last_error).toBeNull();
  });
});

describe('addresses, references and the month', () => {
  it('the delivery-report address is forced to https and keeps the secret path for MSG91', () => {
    expect(deliveryReportUrl('http://localhost:3000/')).toBe(
      'https://localhost:3000/v2/sms/status',
    );
    expect(deliveryReportUrl('https://api.example.com', 'abc')).toBe(
      'https://api.example.com/v2/sms/status/abc',
    );
  });

  it('the contact of a dispatcher client reference, else null', () => {
    expect(contactOfReference('bcast-12-345')).toBe(345);
    expect(contactOfReference('camp-7-9')).toBe(9);
    expect(contactOfReference('camp-7-9-r2')).toBe(9);
    expect(contactOfReference('camptest-7-1700000000000-0')).toBeNull();
    expect(contactOfReference('whatever')).toBeNull();
  });

  it('the broadcast or campaign a dispatcher reference names, else null', () => {
    expect(subjectOfReference('bcast-12-345')).toEqual({ kind: 'broadcast', id: 12 });
    expect(subjectOfReference('camp-7-9')).toEqual({ kind: 'campaign', id: 7 });
    expect(subjectOfReference('camp-7-9-r2')).toEqual({ kind: 'campaign', id: 7 });
    expect(subjectOfReference('camptest-7-1700000000000-0')).toBeNull();
    expect(subjectOfReference('lead-first-1-5')).toBeNull();
    expect(subjectOfReference('')).toBeNull();
  });

  it("where an SMS came from, for the expense log: the reference first, then the send's own source, else api", () => {
    expect(usageSourceOf('bcast-12-345')).toBe('broadcast');
    expect(usageSourceOf('camp-7-9-r1')).toBe('campaign');
    expect(usageSourceOf('lead-first-1-5')).toBe('lead_first');
    // a reference of the lead pipeline's shape wins over a source the caller typed
    expect(usageSourceOf('lead-first-1-5', 'appointment')).toBe('lead_first');
    expect(usageSourceOf('appt-msg-abc', 'Appointment')).toBe('appointment');
    expect(usageSourceOf('x', ' Flow Builder! ')).toBe('flow_builder');
    expect(usageSourceOf('x', 'a'.repeat(40))).toHaveLength(24);
    expect(usageSourceOf('whatever')).toBe('api');
    expect(usageSourceOf('whatever', '  ')).toBe('api');
    expect(usageSourceOf('whatever', null)).toBe('api');
  });

  it('the billing aggregate of a message is stable, per message, and a safe integer for the outbox column', () => {
    const a = usageAggregateOf('SM0123456789abcdef0123456789abcdef');
    expect(usageAggregateOf('SM0123456789abcdef0123456789abcdef')).toBe(a);
    expect(usageAggregateOf('SM0123456789abcdef0123456789abcdee')).not.toBe(a);
    for (const id of ['SM1', 'msg91-request-id', 'x'.repeat(191)]) {
      const n = usageAggregateOf(id);
      expect(Number.isSafeInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
    }
  });

  it('the allowance month is the UTC calendar month; the quota sentence names the cap', () => {
    expect(usagePeriod(new Date('2026-01-31T23:59:59Z'))).toBe('202601');
    expect(usagePeriod(new Date('2026-12-01T00:00:00Z'))).toBe('202612');
    expect(quotaMessage(100)).toContain('limit of 100 SMS messages a month');
  });

  it('keys and secrets', () => {
    expect(senderKey('abc')).toBe('sms:abc');
    expect(randomToken()).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(randomToken()).not.toBe(randomToken());
  });
});
