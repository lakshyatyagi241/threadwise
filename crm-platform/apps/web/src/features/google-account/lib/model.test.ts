import { describe, expect, it } from 'vitest';
import { ERROR_CODES, type GoogleAccountResponse } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import {
  actions,
  calendarName,
  consentFailureOf,
  consentReturnAddress,
  defaultTicks,
  failureOf,
  lastErrorKey,
  readConsentId,
  readOutcome,
  relativeTime,
  safeConsentUrl,
  viewState,
  wanted,
  withoutOutcome,
} from './model';

const account = (
  over: Partial<GoogleAccountResponse> = {},
  granted: string[] = [],
): GoogleAccountResponse => ({
  status: 'connected',
  account: 'ana@example.com',
  connectedAt: '2026-10-01T10:00:00.000Z',
  capabilities: (['calendar', 'sheets', 'docs', 'forms', 'drive_listing'] as const).map((key) => ({
    key,
    granted: granted.includes(key),
    restricted: key === 'docs' || key === 'drive_listing',
  })),
  calendarId: 'primary',
  calendarName: null,
  lastError: null,
  lastUsedAt: null,
  ...over,
});

describe('what Google sends the browser back with', () => {
  it('reads one of our outcomes and ignores anything else in the address', () => {
    expect(readOutcome('?calendar=connected')).toBe('connected');
    expect(readOutcome('?x=1&calendar=missing_scope')).toBe('missing_scope');
    expect(readOutcome('?calendar=hacked')).toBeNull();
    expect(readOutcome('')).toBeNull();
  });

  it('takes the outcome out of the address and keeps the rest', () => {
    expect(withoutOutcome('?calendar=connected')).toBe('');
    expect(withoutOutcome('?a=1&calendar=denied&b=2')).toBe('?a=1&b=2');
  });

  it('follows only http and https consent addresses', () => {
    expect(safeConsentUrl('https://accounts.google.com/o/oauth2/v2/auth?x=1')).toMatch(/^https:/);
    expect(safeConsentUrl('javascript:alert(1)')).toBeNull();
    expect(safeConsentUrl('data:text/html,hi')).toBeNull();
  });
});

describe('what is ticked and what is asked', () => {
  it('ticks the permissions that need no Google review, and the file list the pickers need, when not allowed yet', () => {
    expect(defaultTicks(undefined)).toEqual(['calendar', 'sheets', 'forms', 'drive_listing']);
    expect(defaultTicks(account({}, ['sheets']))).toEqual(['calendar', 'forms', 'drive_listing']);
    expect(defaultTicks(account({}, ['calendar', 'sheets', 'forms']))).toEqual(['drive_listing']);
    expect(defaultTicks(account({}, ['calendar', 'sheets', 'forms', 'drive_listing']))).toEqual([]);
  });

  it('asks for the ticked ones, and on a reconnect also for what the account held', () => {
    expect(wanted(account({}, ['sheets']), ['forms'])).toEqual(['forms']);
    expect(wanted(account({ status: 'needs_reconnect' }, ['sheets', 'docs']), ['forms'])).toEqual([
      'sheets',
      'docs',
      'forms',
    ]);
    expect(wanted(account({ status: 'disconnected' }), ['calendar', 'sheets'])).toEqual([
      'calendar',
      'sheets',
    ]);
  });
});

describe('which buttons a state offers', () => {
  it('gives nothing to someone who may not manage the account, and nothing to anyone when Google is not set up', () => {
    for (const status of ['unavailable', 'disconnected', 'connected', 'needs_reconnect'] as const) {
      expect(Object.values(actions(status, false)).some(Boolean)).toBe(false);
    }
    expect(Object.values(actions('unavailable', true)).some(Boolean)).toBe(false);
  });

  it('connects when disconnected, adds and disconnects when connected, reconnects when refused', () => {
    expect(actions('disconnected', true)).toMatchObject({ connect: true, disconnect: false });
    expect(actions('connected', true)).toMatchObject({
      add: true,
      disconnect: true,
      connect: false,
    });
    expect(actions('needs_reconnect', true)).toMatchObject({ reconnect: true, disconnect: true });
  });
});

describe('the view', () => {
  it('shows data when it has it, even while a refetch fails', () => {
    const data = account();
    expect(viewState({ canRead: true, isPending: false, isError: true, data })).toBe('ready');
    expect(viewState({ canRead: true, isPending: true, isError: false, data: undefined })).toBe(
      'loading',
    );
    expect(viewState({ canRead: true, isPending: false, isError: true, data: undefined })).toBe(
      'error',
    );
    expect(viewState({ canRead: false, isPending: false, isError: false, data })).toBe(
      'noPermission',
    );
  });

  it('names the calendar, and nothing for the default one', () => {
    expect(calendarName({ calendarId: 'primary', calendarName: null })).toBeNull();
    expect(calendarName({ calendarId: 'team@x.co', calendarName: null })).toBe('team@x.co');
    expect(calendarName({ calendarId: 'team@x.co', calendarName: 'Team' })).toBe('Team');
  });

  it('explains the last error by its code, never by the server wording', () => {
    expect(lastErrorKey('GOOGLE_RATE_LIMITED')).toBe('GOOGLE_RATE_LIMITED');
    expect(lastErrorKey('GOOGLE_API_NOT_ENABLED')).toBe('GOOGLE_API_NOT_ENABLED');
    expect(lastErrorKey('SOMETHING_ELSE')).toBe('other');
  });

  it('tells the platform-not-set-up failure from any other by code', () => {
    const notConfigured = new ApiError(422, ERROR_CODES.GOOGLE_ACCOUNT_NOT_CONFIGURED, 'x', 'r');
    expect(failureOf(notConfigured)).toBe('notConfigured');
    expect(failureOf(new ApiError(500, 'INTERNAL', 'x', 'r'))).toBe('generic');
    expect(failureOf(new Error('x'))).toBe('generic');
  });

  it('words a moment in the viewer language and survives garbage', () => {
    const now = new Date('2026-10-15T10:00:00Z');
    expect(relativeTime('2026-10-14T10:00:00Z', now, 'en')).toBe('yesterday');
    expect(relativeTime('nope', now, 'en')).toBe('');
    expect(relativeTime(null, now, 'en')).toBe('');
  });
});

describe('the confirmation page', () => {
  const ID = '0b8e6c1e-5f4e-4d57-9f0a-3a6a2d7f9c11';

  it('reads the request id only when it is a UUID', () => {
    expect(readConsentId(`?request=${ID}`)).toBe(ID);
    expect(readConsentId(`?a=1&request=${ID.toUpperCase()}`)).toBe(ID.toUpperCase());
    expect(readConsentId('?request=../../etc/passwd')).toBeNull();
    expect(readConsentId('?request=')).toBeNull();
    expect(readConsentId('')).toBeNull();
  });

  it('names each refusal by its stable code, never by the server wording', () => {
    const err = (code: string, status = 403) =>
      new ApiError(status, code, 'whatever the server says');
    expect(consentFailureOf(err(ERROR_CODES.GOOGLE_CONSENT_NOT_YOURS))).toBe('notYours');
    expect(consentFailureOf(err(ERROR_CODES.GOOGLE_CONSENT_EXPIRED, 410))).toBe('expired');
    expect(consentFailureOf(err(ERROR_CODES.GOOGLE_CONSENT_USED, 409))).toBe('used');
    expect(consentFailureOf(err(ERROR_CODES.GOOGLE_CONSENT_NOT_FOUND, 404))).toBe('notFound');
    expect(consentFailureOf(err('SOMETHING_ELSE', 500))).toBe('generic');
    expect(consentFailureOf(new Error('network'))).toBe('generic');
  });

  it('returns to the page the person came from with the outcome, like the old callback', () => {
    expect(consentReturnAddress({ returnTo: '/google-account', outcome: 'connected' })).toBe(
      '/google-account?calendar=connected',
    );
    expect(readOutcome('?calendar=cancelled')).toBe('cancelled');
  });
});
