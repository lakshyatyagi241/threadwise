import { describe, expect, it } from 'vitest';
import { ERROR_CODES, type CalendarOverviewResponse } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import {
  hasWriteChoice,
  icsFailure,
  outlookFailure,
  readOutlookReturn,
  toWebcal,
  withoutOutlookParams,
  writeTargetChoices,
  writeTargetValue,
} from './calendars';

const ticket = `${'a'.repeat(60)}.${'b'.repeat(43)}`;
const apiError = (code: string) => new ApiError(409, code, 'x');

describe('readOutlookReturn', () => {
  it('a ticket is read from ?outlook=confirm&ticket=...', () => {
    expect(readOutlookReturn(`?outlook=confirm&ticket=${ticket}`)).toEqual({
      kind: 'confirm',
      ticket,
    });
  });

  it('a confirm without a usable ticket is a failure, never a confirmation', () => {
    expect(readOutlookReturn('?outlook=confirm')).toEqual({ kind: 'outcome', outcome: 'failed' });
    expect(readOutlookReturn('?outlook=confirm&ticket=short')).toEqual({
      kind: 'outcome',
      outcome: 'failed',
    });
    expect(readOutlookReturn('?outlook=confirm&ticket=<script>.<script>')).toEqual({
      kind: 'outcome',
      outcome: 'failed',
    });
  });

  it('reads the outcomes Microsoft leaves, and ignores anything else', () => {
    for (const o of [
      'denied',
      'failed',
      'expired',
      'not_configured',
      'connected',
      'missing_scope',
    ]) {
      expect(readOutlookReturn(`?outlook=${o}`)).toEqual({ kind: 'outcome', outcome: o });
    }
    expect(readOutlookReturn('?outlook=whatever')).toBeNull();
    expect(readOutlookReturn('?calendar=connected')).toBeNull();
    expect(readOutlookReturn('')).toBeNull();
  });

  it("Google's ?calendar= outcome is never taken for Outlook's, nor the other way round", () => {
    expect(readOutlookReturn('?calendar=denied')).toBeNull();
  });
});

describe('withoutOutlookParams', () => {
  it('removes what we read, so a reload or a shared link does not carry the one-time ticket', () => {
    expect(withoutOutlookParams(`?outlook=confirm&ticket=${ticket}`)).toBe('');
    expect(withoutOutlookParams(`?tab=a&outlook=confirm&ticket=${ticket}&x=1`)).toBe('?tab=a&x=1');
    expect(withoutOutlookParams('?calendar=connected')).toBe('?calendar=connected');
  });
});

describe('outlookFailure', () => {
  it("names the calls' own failures by code", () => {
    expect(outlookFailure(apiError(ERROR_CODES.APPT_CALENDAR_NOT_CONFIGURED))).toBe(
      'notConfigured',
    );
    expect(outlookFailure(apiError(ERROR_CODES.APPT_CALENDAR_NOT_CONNECTED))).toBe('notConnected');
    expect(outlookFailure(apiError(ERROR_CODES.APPT_CALENDAR_PROVIDER_FAILED))).toBe(
      'providerFailed',
    );
    expect(outlookFailure(apiError(ERROR_CODES.APPT_CALENDAR_CONFIRM_NOT_YOURS))).toBe('notYours');
    expect(outlookFailure(apiError(ERROR_CODES.APPT_CALENDAR_CONFIRM_INVALID))).toBe(
      'invalidTicket',
    );
  });

  it('leaves everything else to the generic error line', () => {
    expect(outlookFailure(apiError('SOMETHING_ELSE'))).toBeNull();
    expect(outlookFailure(new Error('boom'))).toBeNull();
    expect(outlookFailure(null)).toBeNull();
  });
});

describe('where bookings are written', () => {
  const overview = (
    google: CalendarOverviewResponse['providers'][number]['status'],
    microsoft: CalendarOverviewResponse['providers'][number]['status'],
    preferred: CalendarOverviewResponse['preferredProvider'] = null,
  ): Pick<CalendarOverviewResponse, 'providers' | 'preferredProvider'> => ({
    preferredProvider: preferred,
    providers: [
      {
        provider: 'google',
        status: google,
        account: null,
        calendarId: null,
        calendarName: null,
        connectedAt: null,
        lastErrorCode: null,
        active: false,
      },
      {
        provider: 'microsoft',
        status: microsoft,
        account: null,
        calendarId: null,
        calendarName: null,
        connectedAt: null,
        lastErrorCode: null,
        active: false,
      },
    ],
  });

  it('a choice exists only with two connected calendars', () => {
    expect(hasWriteChoice(overview('connected', 'connected'))).toBe(true);
    expect(hasWriteChoice(overview('connected', 'disconnected'))).toBe(false);
    expect(hasWriteChoice(overview('needs_reconnect', 'connected'))).toBe(false);
    expect(hasWriteChoice(overview('unavailable', 'unavailable'))).toBe(false);
  });

  it('offers automatic always and a provider only while it is connected', () => {
    expect(writeTargetChoices(overview('connected', 'needs_reconnect'))).toEqual([
      { value: 'auto', enabled: true },
      { value: 'google', enabled: true },
      { value: 'microsoft', enabled: false },
    ]);
  });

  it("selects the admin's choice, else automatic", () => {
    expect(writeTargetValue(overview('connected', 'connected', 'microsoft'))).toBe('microsoft');
    expect(writeTargetValue(overview('connected', 'connected'))).toBe('auto');
  });
});

describe('icsFailure', () => {
  const withUrl = (code: string, reason: string) =>
    new ApiError(422, code, 'x', undefined, [{ path: 'url', message: reason }]);

  it('names the feed calls own failures by code', () => {
    expect(icsFailure(apiError(ERROR_CODES.APPT_ICS_FEED_INVALID))).toEqual({ kind: 'invalid' });
    expect(icsFailure(apiError(ERROR_CODES.APPT_ICS_FEED_DUPLICATE))).toEqual({
      kind: 'duplicate',
    });
    expect(icsFailure(apiError(ERROR_CODES.APPT_ICS_FEED_LIMIT))).toEqual({ kind: 'limit' });
  });

  it('takes the reason of an unreadable address from the url detail, and never trusts an unknown one', () => {
    expect(icsFailure(withUrl(ERROR_CODES.APPT_ICS_FEED_UNREADABLE, 'not_a_calendar'))).toEqual({
      kind: 'unreadable',
      reason: 'not_a_calendar',
    });
    expect(icsFailure(withUrl(ERROR_CODES.APPT_ICS_FEED_UNREADABLE, 'some new thing'))).toEqual({
      kind: 'unreadable',
      reason: 'unknown',
    });
    expect(icsFailure(apiError(ERROR_CODES.APPT_ICS_FEED_UNREADABLE))).toEqual({
      kind: 'unreadable',
      reason: 'unknown',
    });
  });

  it('leaves everything else to the generic error line', () => {
    expect(icsFailure(apiError('SOMETHING_ELSE'))).toBeNull();
    expect(icsFailure(new Error('x'))).toBeNull();
  });
});

describe('toWebcal', () => {
  it('turns the feed link into an address a calendar app opens directly', () => {
    expect(toWebcal('https://api.example/v2/public/appointments/feed/abc.ics')).toBe(
      'webcal://api.example/v2/public/appointments/feed/abc.ics',
    );
    expect(toWebcal('http://localhost:3000/feed.ics')).toBe('webcal://localhost:3000/feed.ics');
  });
});
