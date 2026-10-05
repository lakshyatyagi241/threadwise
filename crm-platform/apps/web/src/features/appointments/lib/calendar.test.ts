import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import {
  calendarActions,
  calendarFailure,
  calendarName,
  readOutcome,
  safeConsentUrl,
  withoutOutcome,
} from './calendar';

describe("the outcome Google's callback leaves in the address", () => {
  it('reads each known outcome and nothing else', () => {
    expect(readOutcome('?calendar=connected')).toBe('connected');
    expect(readOutcome('?x=1&calendar=missing_scope')).toBe('missing_scope');
    expect(readOutcome('?calendar=hacked')).toBeNull();
    expect(readOutcome('')).toBeNull();
  });

  it('removes it and keeps the rest of the query', () => {
    expect(withoutOutcome('?calendar=connected')).toBe('');
    expect(withoutOutcome('?tab=hours&calendar=failed')).toBe('?tab=hours');
  });
});

describe('which buttons a state offers', () => {
  it('connect when disconnected, choose and disconnect when connected, reconnect when refused', () => {
    expect(calendarActions({ status: 'disconnected' }, true)).toEqual({
      connect: true,
      reconnect: false,
      choose: false,
      disconnect: false,
    });
    expect(calendarActions({ status: 'connected' }, true)).toMatchObject({
      choose: true,
      disconnect: true,
      connect: false,
    });
    expect(calendarActions({ status: 'needs_reconnect' }, true)).toMatchObject({
      reconnect: true,
      disconnect: true,
      choose: false,
    });
  });

  it('offers nothing when the platform has no Google client, and nothing to someone who may not edit', () => {
    for (const status of ['unavailable', 'disconnected', 'connected', 'needs_reconnect'] as const) {
      const none = calendarActions({ status }, false);
      expect(
        Object.values(none).every((v) => v === false),
        status,
      ).toBe(true);
    }
    expect(Object.values(calendarActions({ status: 'unavailable' }, true)).some(Boolean)).toBe(
      false,
    );
  });
});

describe('the calendar name', () => {
  it('prefers the name, then a chosen id, and says nothing for the default calendar', () => {
    expect(calendarName({ calendarId: 'x@group', calendarName: 'Team' })).toBe('Team');
    expect(calendarName({ calendarId: 'x@group', calendarName: null })).toBe('x@group');
    expect(calendarName({ calendarId: 'primary', calendarName: null })).toBeNull();
    expect(calendarName({ calendarId: null, calendarName: null })).toBeNull();
  });
});

describe('the consent address', () => {
  it('follows http and https only', () => {
    expect(safeConsentUrl('https://accounts.google.com/o/oauth2/v2/auth?x=1')).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth?x=1',
    );
    expect(safeConsentUrl('javascript:alert(1)')).toBeNull();
    expect(safeConsentUrl('data:text/html,hi')).toBeNull();
  });
});

describe("the calendar calls' own failures", () => {
  const failure = (code: string, status = 422) => new ApiError(status, code, 'x');
  it('are told apart by code', () => {
    expect(calendarFailure(failure('APPT_CALENDAR_NOT_CONFIGURED'))).toBe('notConfigured');
    expect(calendarFailure(failure('APPT_CALENDAR_NOT_CONNECTED', 409))).toBe('notConnected');
    expect(calendarFailure(failure('APPT_CALENDAR_PROVIDER_FAILED', 502))).toBe('providerFailed');
    expect(calendarFailure(failure('FORBIDDEN', 403))).toBeNull();
    expect(calendarFailure(new Error('network'))).toBeNull();
  });
});
