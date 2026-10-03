import { describe, expect, it } from 'vitest';
import {
  callBubble,
  humanDuration,
  isAlreadyPermitted,
  isCoexistenceNumber,
  isUsable,
  metaTime,
  permissionFromUpdate,
  permissionLabel,
  phoneForms,
  toggleRefusal,
  usableAnswer,
  COEXISTENCE_MESSAGE,
  PREREQUISITE_MESSAGE,
} from '../../../src/modules/calling-voice/calling.rules';

const now = new Date('2026-10-05T10:00:00Z');
const day = 86_400_000;

describe('call permission', () => {
  it('only an unexpired grant is usable', () => {
    expect(isUsable({ status: 'granted', expiresAt: null }, now)).toBe(true);
    expect(isUsable({ status: 'granted', expiresAt: new Date(now.getTime() + day) }, now)).toBe(
      true,
    );
    expect(isUsable({ status: 'granted', expiresAt: new Date(now.getTime() - 1) }, now)).toBe(
      false,
    );
    expect(isUsable({ status: 'declined', expiresAt: null }, now)).toBe(false);
    expect(isUsable({ status: 'expired', expiresAt: null }, now)).toBe(false);
    expect(isUsable(null, now)).toBe(false);
  });

  it('a lapsed grant reads as expired, not granted (the Reference quirk, fixed)', () => {
    expect(
      permissionLabel({ status: 'granted', expiresAt: new Date(now.getTime() - 1) }, now),
    ).toBe('expired');
    expect(permissionLabel({ status: 'granted', expiresAt: null }, now)).toBe('granted');
    expect(permissionLabel({ status: 'declined', expiresAt: null }, now)).toBe('declined');
    expect(permissionLabel(null, now)).toBeNull();
  });

  it("an accept grants until Meta's expiry, or a week; anything else declines", () => {
    const ts = Math.floor((now.getTime() + 3 * day) / 1000);
    const a = permissionFromUpdate('accept', ts, now);
    expect(a.status).toBe('granted');
    expect(a.expiresAt?.getTime()).toBe(ts * 1000);
    const b = permissionFromUpdate('ACCEPT', undefined, now);
    expect(b.expiresAt?.getTime()).toBe(now.getTime() + 7 * day);
    expect(permissionFromUpdate('reject', ts, now)).toEqual({
      status: 'declined',
      grantedAt: null,
      expiresAt: null,
    });
    expect(permissionFromUpdate(undefined, ts, now).status).toBe('declined');
  });

  it('knows Meta\'s "already permitted" code and the forms a number was stored in', () => {
    expect(isAlreadyPermitted(138017)).toBe(true);
    expect(isAlreadyPermitted(138009)).toBe(false);
    expect(phoneForms('+91 98765-43210')).toEqual([
      '+91 98765-43210',
      '919876543210',
      '+919876543210',
    ]);
    expect(phoneForms('')).toEqual([]);
  });

  it('reads Meta epoch seconds', () => {
    expect(metaTime('1760000000')?.toISOString()).toBe('2025-10-09T08:53:20.000Z');
    expect(metaTime(0)).toBeNull();
    expect(metaTime('x')).toBeNull();
  });
});

describe('the calling switch', () => {
  it('spots a coexistence number by flag or platform type', () => {
    expect(isCoexistenceNumber({ coexistence: true })).toBe(true);
    expect(isCoexistenceNumber({ platform_type: 'smb_app' })).toBe(true);
    expect(isCoexistenceNumber({ platform_type: 'CLOUD_API' })).toBe(false);
    expect(isCoexistenceNumber(null)).toBe(false);
  });

  it("puts Meta's refusals in words", () => {
    expect(toggleRefusal(141000, 'x', 400)).toBe(COEXISTENCE_MESSAGE);
    expect(toggleRefusal(null, 'Calling Pre-requisite not met', 400)).toBe(PREREQUISITE_MESSAGE);
    expect(toggleRefusal(null, 'Prerequisite missing', 400)).toBe(PREREQUISITE_MESSAGE);
    expect(toggleRefusal(100, 'Invalid parameter', 400)).toBe(
      'Meta refused the call toggle (400): Invalid parameter',
    );
  });
});

describe('what a finished call looks like in the thread', () => {
  it('formats durations', () => {
    expect(humanDuration(45)).toBe('45 s');
    expect(humanDuration(120)).toBe('2 min');
    expect(humanDuration(130)).toBe('2 min 10 s');
  });

  it('answered, declined, no answer and missed', () => {
    expect(
      callBubble({ durationSec: 130, endReason: 'COMPLETED', direction: 'USER_INITIATED' }),
    ).toEqual({
      label: 'Voice call - 2 min 10 s',
      callStatus: 'answered',
      side: 'in',
    });
    expect(
      callBubble({ durationSec: 0, endReason: 'rejected', direction: 'USER_INITIATED' }).label,
    ).toBe('Voice call declined');
    expect(
      callBubble({ durationSec: 0, endReason: 'DECLINED', direction: 'BUSINESS_INITIATED' })
        .callStatus,
    ).toBe('declined');
    expect(
      callBubble({ durationSec: 0, endReason: null, direction: 'BUSINESS_INITIATED' }),
    ).toEqual({
      label: 'Voice call - no answer',
      callStatus: 'no_answer',
      side: 'out',
    });
    expect(
      callBubble({ durationSec: 0, endReason: 'FAILED', direction: 'USER_INITIATED' }),
    ).toEqual({
      label: 'Missed voice call',
      callStatus: 'missed',
      side: 'in',
    });
  });

  it('never hands the dialler an offer as its answer', () => {
    expect(usableAnswer('answer', 'v=0\r\n...')).toBe('v=0\r\n...');
    expect(usableAnswer('offer', 'v=0')).toBeNull();
    expect(usableAnswer('answer', '')).toBeNull();
    expect(usableAnswer(undefined, undefined)).toBeNull();
  });
});
