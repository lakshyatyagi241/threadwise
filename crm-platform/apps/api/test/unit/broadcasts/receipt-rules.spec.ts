import { describe, expect, it } from 'vitest';
import {
  counterDelta,
  failureText,
  mapBaileysAck,
  mapTwilioStatus,
} from '../../../src/modules/broadcasts/receipt-rules';

describe('counterDelta (TW-BCAST-027)', () => {
  it('moves one tier at a time', () => {
    expect(counterDelta('pending', 'sent')).toEqual({ success: 1, delivered: 0, read: 0, fail: 0 });
    expect(counterDelta('sent', 'delivered')).toEqual({
      success: 0,
      delivered: 1,
      read: 0,
      fail: 0,
    });
    expect(counterDelta('delivered', 'read')).toEqual({
      success: 0,
      delivered: 0,
      read: 1,
      fail: 0,
    });
  });
  it('jumping over a tier counts the tiers it includes', () => {
    expect(counterDelta('sent', 'read')).toEqual({ success: 0, delivered: 1, read: 1, fail: 0 });
    expect(counterDelta('pending', 'read')).toEqual({ success: 1, delivered: 1, read: 1, fail: 0 });
  });
  it('failing takes the recipient out of success and into fail', () => {
    expect(counterDelta('sent', 'failed')).toEqual({ success: -1, delivered: 0, read: 0, fail: 1 });
    expect(counterDelta('delivered', 'failed')).toEqual({
      success: -1,
      delivered: -1,
      read: 0,
      fail: 1,
    });
    expect(counterDelta('pending', 'failed')).toEqual({
      success: 0,
      delivered: 0,
      read: 0,
      fail: 1,
    });
  });
  it('no move, no change', () => {
    expect(counterDelta('sent', 'sent')).toEqual({ success: 0, delivered: 0, read: 0, fail: 0 });
  });
  it('adds up to the recompute: {1 sent, 2 delivered, 1 read, 1 failed} is success 4, delivered 3, read 1, fail 1', () => {
    const total = { success: 0, delivered: 0, read: 0, fail: 0 };
    for (const to of ['sent', 'delivered', 'delivered', 'read', 'failed']) {
      const d = counterDelta('pending', to);
      for (const k of Object.keys(total) as Array<keyof typeof total>) total[k] += d[k];
    }
    expect(total).toEqual({ success: 4, delivered: 3, read: 1, fail: 1 });
  });
});

describe('provider status maps', () => {
  it('Baileys: 3 delivered, 4 and 5 read, 1 and 2 nothing', () => {
    expect([1, 2, 3, 4, 5, 0, 9].map(mapBaileysAck)).toEqual([
      null,
      null,
      'delivered',
      'read',
      'read',
      null,
      null,
    ]);
  });
  it('Twilio: the final states, the rest nothing', () => {
    expect(
      ['sent', 'Delivered', 'read', 'undelivered', 'failed', 'queued', 'accepted', 'sending'].map(
        mapTwilioStatus,
      ),
    ).toEqual(['sent', 'delivered', 'read', 'failed', 'failed', null, null, null]);
  });
});

describe('failureText (TW-BCAST-027 rule 4)', () => {
  it('prefers the message, falls back to the code, cuts to 512', () => {
    expect(failureText('Message undeliverable', '131026')).toBe('Message undeliverable');
    expect(failureText(null, '131026')).toBe('error_code:131026');
    expect(failureText('  ', null)).toBeNull();
    expect(failureText('x'.repeat(600), null)).toHaveLength(512);
  });
});
