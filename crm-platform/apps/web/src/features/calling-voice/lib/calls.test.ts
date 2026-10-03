import { CALL_ERROR_CODES, ERROR_CODES, type PendingCall } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import {
  CALL_FAILURE_KINDS,
  CALL_FAILURE_TEXT,
  CallError,
  DEFAULT_ICE_SERVERS,
  END_REASON_TEXT,
  callErrorKey,
  digitsOf,
  elapsedText,
  endReasonText,
  freshestRinging,
  isPermissionRequested,
  isStateConflict,
  parseIceServers,
  serverWorded,
} from './calls';

const api = (status: number, code: string, message = 'm') => new ApiError(status, code, message);

describe('elapsedText', () => {
  it('is empty before the call connects', () => expect(elapsedText(null, 5000)).toBe(''));
  it('shows M:SS', () => {
    expect(elapsedText(0, 0)).toBe('0:00');
    expect(elapsedText(0, 9_999)).toBe('0:09');
    expect(elapsedText(0, 65_000)).toBe('1:05');
    expect(elapsedText(1000, 601_000)).toBe('10:00');
  });
  it('never goes negative', () => expect(elapsedText(5000, 1000)).toBe('0:00'));
});

describe('digitsOf', () => {
  it('keeps digits only', () => {
    expect(digitsOf('+91 98765-43210')).toBe('919876543210');
    expect(digitsOf(null)).toBe('');
  });
});

describe('end reasons (TW-CALL-009 rule 7)', () => {
  it('maps every reason to its text', () => {
    expect(endReasonText('REJECTED')).toBe('The customer declined the call.');
    expect(endReasonText('BUSY')).toBe('The customer is on another call.');
    expect(endReasonText('NO_ANSWER')).toBe('No answer - the customer did not pick up.');
    expect(endReasonText('MISSED')).toBe('The customer missed the call.');
    expect(endReasonText('CANCELLED')).toBe('The call was cancelled.');
  });
  it('ignores case', () => expect(endReasonText('rejected')).toBe(END_REASON_TEXT.REJECTED));
  it('falls back for an unknown or missing reason', () => {
    expect(endReasonText('SOMETHING_ELSE')).toBe('Call ended before it connected.');
    expect(endReasonText(null)).toBe('Call ended before it connected.');
  });
  it('keeps the exact mic text', () => {
    expect(CALL_FAILURE_TEXT.MIC_BLOCKED).toBe(
      'Microphone access blocked - the caller will not hear you. Grant mic permission in your browser and retry.',
    );
    expect(new CallError('MIC_BLOCKED').message).toBe(CALL_FAILURE_TEXT.MIC_BLOCKED);
    expect(CALL_FAILURE_KINDS).toContain('BUSY_SLOT');
  });
  it('appends the browser reason to a failed answer', () => {
    expect(new CallError('ANSWER_FAILED', 'bad sdp').message).toBe(
      'Failed to apply WhatsApp answer: bad sdp',
    );
  });
});

describe('request errors', () => {
  it('maps every call error code to itself', () => {
    for (const code of Object.values(CALL_ERROR_CODES))
      expect(callErrorKey(api(422, code))).toBe(code);
  });
  it('maps shared codes, network and anything else', () => {
    expect(callErrorKey(api(403, ERROR_CODES.FORBIDDEN))).toBe('FORBIDDEN');
    expect(callErrorKey(api(403, ERROR_CODES.PLAN_FEATURE_LOCKED))).toBe('PLAN_FEATURE_LOCKED');
    expect(callErrorKey(api(500, 'INTERNAL'))).toBe('UNEXPECTED');
    expect(callErrorKey(new TypeError('Failed to fetch'))).toBe('NETWORK');
  });
  it('shows the server text in full only for Meta refusals and coexistence', () => {
    const long = 'Calling needs a number fully onboarded to the Cloud API. '.repeat(5).trim();
    expect(serverWorded(api(422, CALL_ERROR_CODES.CALL_META_REFUSED, long))).toBe(long);
    expect(serverWorded(api(422, CALL_ERROR_CODES.CALL_COEXISTENCE_UNSUPPORTED, long))).toBe(long);
    expect(serverWorded(api(422, CALL_ERROR_CODES.CALL_NOT_ENABLED, long))).toBeNull();
    expect(serverWorded(api(422, CALL_ERROR_CODES.CALL_META_REFUSED, '  '))).toBeNull();
    expect(serverWorded(new Error('x'))).toBeNull();
  });
  it('recognises a permission request and a state conflict by code or status', () => {
    expect(isPermissionRequested(api(422, CALL_ERROR_CODES.CALL_PERMISSION_REQUESTED))).toBe(true);
    expect(isPermissionRequested(api(422, CALL_ERROR_CODES.CALL_NOT_ENABLED))).toBe(false);
    expect(isStateConflict(api(409, CALL_ERROR_CODES.CALL_STATE_CONFLICT))).toBe(true);
    expect(isStateConflict(api(409, 'ROW_VERSION_CONFLICT'))).toBe(true);
    expect(isStateConflict(api(422, CALL_ERROR_CODES.CALL_STATE_CONFLICT))).toBe(true);
    expect(isStateConflict(api(500, 'INTERNAL'))).toBe(false);
  });
});

describe('parseIceServers', () => {
  it('has the four public STUN servers by default', () => {
    expect(DEFAULT_ICE_SERVERS).toHaveLength(4);
    expect(parseIceServers(undefined)).toBe(DEFAULT_ICE_SERVERS);
    expect(parseIceServers([])).toBe(DEFAULT_ICE_SERVERS);
    expect(parseIceServers('not json')).toBe(DEFAULT_ICE_SERVERS);
    expect(parseIceServers({ urls: 'stun:x' })).toBe(DEFAULT_ICE_SERVERS);
  });
  it('takes a list, with TURN credentials', () => {
    const turn = { urls: ['turn:t.example.com:3478'], username: 'u', credential: 'c' };
    expect(parseIceServers([turn, { urls: 'stun:s.example.com' }])).toEqual([
      turn,
      { urls: 'stun:s.example.com' },
    ]);
  });
  it('takes the JSON text of a list', () => {
    expect(
      parseIceServers('[{"urls":"turns:t.example.com:443","username":"u","credential":"c"}]'),
    ).toEqual([{ urls: 'turns:t.example.com:443', username: 'u', credential: 'c' }]);
  });
  it('drops entries that are not ICE servers and falls back when none are left', () => {
    expect(parseIceServers([{ urls: 'http://x' }, { urls: [] }, null, 'stun:x', { nope: 1 }])).toBe(
      DEFAULT_ICE_SERVERS,
    );
    expect(parseIceServers([{ urls: 'http://x' }, { urls: 'stun:ok' }])).toEqual([
      { urls: 'stun:ok' },
    ]);
  });
});

describe('freshestRinging', () => {
  const call = (
    id: string,
    startedAt: string | null,
    direction: PendingCall['direction'] = 'USER_INITIATED',
  ) =>
    ({
      id,
      direction,
      fromPhone: '1',
      toPhone: '2',
      contactId: null,
      contactName: null,
      startedAt,
      metaCallId: null,
      sdpOffer: null,
      aiHandled: false,
    }) satisfies PendingCall;

  it('picks the newest inbound call', () => {
    const list = [
      call('a', '2026-01-01T10:00:00Z'),
      call('b', '2026-01-01T10:00:30Z'),
      call('c', null),
    ];
    expect(freshestRinging(list)?.id).toBe('b');
  });
  it('ignores outbound rows and calls already handled here', () => {
    const list = [
      call('a', '2026-01-01T10:00:00Z'),
      call('b', '2026-01-01T10:00:30Z', 'BUSINESS_INITIATED'),
    ];
    expect(freshestRinging(list)?.id).toBe('a');
    expect(freshestRinging(list, new Set(['a']))).toBeNull();
    expect(freshestRinging([])).toBeNull();
  });
});
