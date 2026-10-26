import { describe, expect, it } from 'vitest';
import { walletUsageReportedSchema } from '@crm/contracts';
import {
  telephonyCallUsage,
  telephonyUsageId,
  whatsappCallUsage,
} from '../../../src/modules/calling-voice/call-usage.rules';

const CONN = '3f2b8c1a-0d7e-4a55-9b3c-1c2d3e4f5a6b';

describe('a WhatsApp call as usage', () => {
  const maybe = (durationSec: number) =>
    whatsappCallUsage({
      metaCallId: 'wacid.HBgM123',
      customerPhone: '919811400001',
      durationSec,
    });
  // A call with minutes to bill: the report itself (the tests below are about what is in it).
  const call = (durationSec: number): NonNullable<ReturnType<typeof maybe>> => {
    const r = maybe(durationSec);
    if (!r) throw new Error(`a ${durationSec} second call should be billed`);
    return r;
  };

  it('is charged every started minute', () => {
    expect(call(1).units).toBe(1);
    expect(call(60).units).toBe(1);
    expect(call(61).units).toBe(2);
    expect(call(125).units).toBe(3);
    expect(call(3600).units).toBe(60);
  });

  it('is not reported when nobody answered: a zero-minute report would close the call as free for good', () => {
    expect(maybe(0)).toBeNull();
  });

  it('is charged under Meta’s call id, so a repeated terminate is one charge', () => {
    expect(call(125).usageId).toBe(call(125).usageId);
    expect(call(125).usageId).toBe('wacid.HBgM123');
  });

  it('names the kind, the vendor, the origin and the customer’s number', () => {
    expect(call(125)).toMatchObject({
      kind: 'whatsapp_call',
      provider: 'meta',
      source: 'inbox',
      recipient: '919811400001',
    });
  });

  it('is a report the wallet accepts', () => {
    expect(walletUsageReportedSchema.safeParse(call(125)).success).toBe(true);
  });
});

describe('a telephony call as usage', () => {
  const call = (over: Partial<Parameters<typeof telephonyCallUsage>[0]> = {}) =>
    telephonyCallUsage({
      connectionUuid: CONN,
      callId: 'CA123',
      status: 'completed',
      durationSec: 125,
      customerPhone: '+919811400001',
      provider: 'fake',
      ...over,
    });

  it('bills a completed call with talk time, every started minute', () => {
    expect(call()).toMatchObject({
      kind: 'voice_call',
      units: 3,
      status: 'used',
      source: 'telephony',
      provider: 'fake',
      recipient: '+919811400001',
    });
    expect(call({ durationSec: 1 })?.units).toBe(1);
    expect(call({ durationSec: 60 })?.units).toBe(1);
    expect(call({ durationSec: 61 })?.units).toBe(2);
  });

  it('bills nothing for a call that was not completed or had no talk time', () => {
    for (const status of ['no_answer', 'busy', 'failed', 'canceled', 'declined', 'voicemail']) {
      expect(call({ status, durationSec: 90 })).toBeNull();
    }
    expect(call({ durationSec: 0 })).toBeNull();
  });

  it('is charged under the entry’s own external id, so one call is one charge', () => {
    expect(call()?.usageId).toBe(`${CONN}:CA123`);
    expect(call()?.usageId).toBe(call()?.usageId);
    expect(call({ callId: 'CA124' })?.usageId).not.toBe(call()?.usageId);
  });

  it('keeps a long provider call id inside the wallet’s limit, stably and uniquely', () => {
    const long = 'x'.repeat(160);
    const id = telephonyUsageId(CONN, long);
    expect(id.length).toBeLessThanOrEqual(191);
    expect(id).toBe(telephonyUsageId(CONN, long));
    expect(id).not.toBe(telephonyUsageId(CONN, `${long.slice(0, 159)}y`));
    expect(id.startsWith(`${CONN}:`)).toBe(true);
    expect(walletUsageReportedSchema.safeParse(call({ callId: long })).success).toBe(true);
  });

  it('is a report the wallet accepts', () => {
    expect(walletUsageReportedSchema.safeParse(call()).success).toBe(true);
    expect(walletUsageReportedSchema.safeParse(call({ customerPhone: null })).success).toBe(true);
  });
});
