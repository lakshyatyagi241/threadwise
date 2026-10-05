import { afterEach, describe, expect, it } from 'vitest';
import {
  GOOGLE_CALENDAR_REQUIRED_SCOPES,
  GOOGLE_CALENDAR_SCOPES,
  googleCalendarEnv,
} from '../../../src/config/domains/appointments-booking.env';
import { GoogleCalendarClient } from '../../../src/infra/providers/appointments-booking/google-calendar.client';

/** The consent URL and the environment of the Google adapter (WD-APPT-028). */
const creds = {
  clientId: 'cid.apps.googleusercontent.com',
  clientSecret: 's',
  redirectUri: 'https://app.test/v2/public/appointments/calendar/google/callback',
};

describe('the consent URL', () => {
  const saved = process.env.GOOGLE_OAUTH_AUTH_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.GOOGLE_OAUTH_AUTH_URL;
    else process.env.GOOGLE_OAUTH_AUTH_URL = saved;
  });

  it('asks for offline access and a fresh consent, so Google always issues a refresh token', () => {
    const url = new URL(new GoogleCalendarClient().authorizeUrl(creds, 'the-state'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(creds.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(creds.redirectUri);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('the-state');
  });

  it('asks for calendar scopes and the account email, and nothing else (no Drive, Sheets, Docs or Forms)', () => {
    const url = new URL(new GoogleCalendarClient().authorizeUrl(creds, 's'));
    const scopes = url.searchParams.get('scope')!.split(' ');
    expect(scopes).toEqual([...GOOGLE_CALENDAR_SCOPES]);
    expect(scopes).toContain('https://www.googleapis.com/auth/calendar.events');
    expect(scopes).toContain('https://www.googleapis.com/auth/calendar.freebusy');
    expect(scopes).toContain('https://www.googleapis.com/auth/calendar.calendarlist.readonly');
    expect(scopes.some((s) => /drive|spreadsheets|documents|forms/.test(s))).toBe(false);
    // What the callback insists was granted: every calendar scope (a person may untick one), not the identity ones.
    expect(GOOGLE_CALENDAR_REQUIRED_SCOPES.every((s) => scopes.includes(s))).toBe(true);
    expect(GOOGLE_CALENDAR_REQUIRED_SCOPES).toHaveLength(3);
  });

  it('is built on the address in the environment, so a test can aim it at a stand-in', () => {
    process.env.GOOGLE_OAUTH_AUTH_URL = 'http://127.0.0.1:9999/auth';
    expect(new GoogleCalendarClient().authorizeUrl(creds, 's')).toMatch(
      /^http:\/\/127\.0\.0\.1:9999\/auth\?/,
    );
  });
});

describe('the environment', () => {
  it('has Google\'s real addresses by default and a blank value means "not set"', () => {
    const env = googleCalendarEnv({ GOOGLE_CALENDAR_API_URL: '', GOOGLE_CALENDAR_CLIENT_ID: ' ' });
    expect(env.GOOGLE_CALENDAR_API_URL).toBe('https://www.googleapis.com/calendar/v3');
    expect(env.GOOGLE_OAUTH_TOKEN_URL).toBe('https://oauth2.googleapis.com/token');
    expect(env.GOOGLE_OAUTH_REVOKE_URL).toBe('https://oauth2.googleapis.com/revoke');
    expect(env.GOOGLE_CALENDAR_CLIENT_ID).toBeUndefined();
    expect(env.GOOGLE_HTTP_TIMEOUT_MS).toBe(8000);
    expect(env.GOOGLE_BUSY_CACHE_SECONDS).toBe(30);
  });

  it('refuses an address that is not a URL, naming the variable', () => {
    expect(() => googleCalendarEnv({ GOOGLE_CALENDAR_API_URL: 'not a url' })).toThrow(
      /GOOGLE_CALENDAR_API_URL/,
    );
  });
});
