import { describe, expect, it } from 'vitest';
import type { CallingCheck } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import {
  STALE_CHECK_MS,
  canTestCall,
  digitsOnly,
  isDialable,
  isStale,
  metaReasonOf,
  needsAction,
} from './readiness';

const api = (code: string, fieldErrors: Array<{ path: string; message: string }>) =>
  new ApiError(422, code, 'words that must never be read', undefined, fieldErrors);

describe('metaReasonOf', () => {
  it('reads the reason code of a refusal by Meta, never its words', () => {
    expect(
      metaReasonOf(api('CALL_META_REFUSED', [{ path: 'reason', message: 'receiver_uncallable' }])),
    ).toBe('receiver_uncallable');
  });
  it('is null for no reason, for unknown, for a stranger and for another error', () => {
    expect(metaReasonOf(api('CALL_META_REFUSED', []))).toBeNull();
    expect(
      metaReasonOf(api('CALL_META_REFUSED', [{ path: 'reason', message: 'unknown' }])),
    ).toBeNull();
    expect(
      metaReasonOf(api('CALL_META_REFUSED', [{ path: 'reason', message: 'made_up' }])),
    ).toBeNull();
    expect(
      metaReasonOf(api('UNAUTHENTICATED', [{ path: 'reason', message: 'token_expired' }])),
    ).toBeNull();
    expect(metaReasonOf(new Error('x'))).toBeNull();
  });
});

describe('isStale', () => {
  const now = Date.parse('2026-12-06T10:00:00Z');
  it('treats no result, a bad date and an old result as stale, and a fresh one as not', () => {
    expect(isStale(null, now)).toBe(true);
    expect(isStale('not a date', now)).toBe(true);
    expect(isStale(new Date(now - STALE_CHECK_MS - 1).toISOString(), now)).toBe(true);
    expect(isStale(new Date(now - 60_000).toISOString(), now)).toBe(false);
  });
});

describe('the test call', () => {
  it('is offered when calling is on and nothing blocks the number', () => {
    expect(canTestCall({ status: 'ready', callingEnabled: true })).toBe(true);
    expect(canTestCall({ status: 'attention', callingEnabled: true })).toBe(true);
    expect(canTestCall({ status: 'blocked', callingEnabled: true })).toBe(false);
    expect(canTestCall({ status: 'ready_to_enable', callingEnabled: false })).toBe(false);
    expect(canTestCall({ status: 'ready', callingEnabled: false })).toBe(false);
  });
  it('wants 6 to 15 digits, whatever the person typed around them', () => {
    expect(digitsOnly('+91 98123-45678')).toBe('919812345678');
    expect(isDialable('+91 98123-45678')).toBe(true);
    expect(isDialable('12345')).toBe(false);
    expect(isDialable('1234567890123456')).toBe(false);
    expect(isDialable('')).toBe(false);
  });
});

describe('needsAction', () => {
  it('lists fails before warnings and leaves out what is fine', () => {
    const rows: CallingCheck[] = [
      { key: 'turn', state: 'warn', code: 'turn_missing' },
      { key: 'plan_feature', state: 'ok', code: 'plan_ok' },
      { key: 'connection', state: 'fail', code: 'not_connected' },
    ];
    expect(needsAction(rows).map((c) => c.key)).toEqual(['connection', 'turn']);
  });
});
