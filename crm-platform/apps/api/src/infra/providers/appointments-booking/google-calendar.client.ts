import { Injectable } from '@nestjs/common';
import {
  GOOGLE_CALENDAR_SCOPES,
  googleCalendarEnv,
  type GoogleCalendarEnv,
} from '../../../config/domains/appointments-booking.env';
import type { CalendarBusyInterval } from './calendar-sync.port';
import {
  classifyApiError,
  classifyTokenError,
  GoogleCalendarError,
} from './google-calendar.errors';
import {
  OWN_EVENT_KEY,
  parseEventIntervals,
  parseFreeBusy,
  type GoogleEventBody,
} from './google-calendar.mapping';

/** The platform's OAuth client: where the consent screen and the token calls are made as. */
export interface GoogleClientCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleTokens {
  accessToken: string;
  /** Only on a code exchange, and only when Google issued one (it does with `access_type=offline` and `prompt=consent`). */
  refreshToken: string | null;
  expiresInSeconds: number;
  /** The scopes actually granted (a person can untick some on the consent screen). */
  scope: string;
}

export interface GoogleCalendarListEntry {
  id: string;
  name: string;
  primary: boolean;
  timezone: string | null;
  accessRole: string;
}

export interface GoogleEventResult {
  id: string;
  hangoutLink?: string;
  conferenceData?: unknown;
  status?: string;
}

type Json = Record<string, unknown>;

/**
 * Google's OAuth and Calendar v3 endpoints, one method per call (TW-APPT-028, 029). Plain HTTP with a timeout: it holds no tenant, no
 * database and no secret of its own, every credential and token is an argument, and every failure is a `GoogleCalendarError` whose
 * `kind` the caller switches on. The base addresses come from the environment so a test can aim it at a local stand-in.
 *
 * Endpoints and parameters were taken from developers.google.com (OAuth 2.0 for web server apps, Calendar API v3 reference) and are
 * not verified against a live Google account in this repository.
 */
@Injectable()
export class GoogleCalendarClient {
  private env(): GoogleCalendarEnv {
    return googleCalendarEnv();
  }

  // --- OAuth -----------------------------------------------------------------------------------------------------------

  /** `access_type=offline` + `prompt=consent`: Google issues a refresh token on every consent, a reconnect included. */
  authorizeUrl(creds: GoogleClientCredentials, state: string): string {
    const q = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: creds.redirectUri,
      response_type: 'code',
      scope: GOOGLE_CALENDAR_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `${this.env().GOOGLE_OAUTH_AUTH_URL}?${q.toString()}`;
  }

  async exchangeCode(creds: GoogleClientCredentials, code: string): Promise<GoogleTokens> {
    const body = await this.token({
      grant_type: 'authorization_code',
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: creds.redirectUri,
    });
    return {
      accessToken: String(body.access_token ?? ''),
      refreshToken:
        typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : null,
      expiresInSeconds: Number(body.expires_in) || 3600,
      scope: typeof body.scope === 'string' ? body.scope : '',
    };
  }

  /** Google does not rotate the refresh token: only a new access token comes back. */
  async refresh(creds: GoogleClientCredentials, refreshToken: string): Promise<GoogleTokens> {
    const body = await this.token({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    });
    if (typeof body.access_token !== 'string' || !body.access_token) {
      throw new GoogleCalendarError('server', 200, 'no_access_token');
    }
    return {
      accessToken: body.access_token,
      refreshToken: null,
      expiresInSeconds: Number(body.expires_in) || 3600,
      scope: typeof body.scope === 'string' ? body.scope : '',
    };
  }

  /** Withdraws the grant at Google. An already-revoked token answers 400 `invalid_token`: that is as good as revoked. */
  async revoke(token: string): Promise<void> {
    try {
      await this.send(this.env().GOOGLE_OAUTH_REVOKE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
        classify: classifyTokenError,
      });
    } catch (err) {
      if (err instanceof GoogleCalendarError && err.status === 400) return;
      throw err;
    }
  }

  async userinfo(accessToken: string): Promise<{ sub: string | null; email: string | null }> {
    const body = (await this.send(this.env().GOOGLE_USERINFO_URL, {
      token: accessToken,
      classify: classifyApiError,
    })) as Json;
    return {
      sub: typeof body.sub === 'string' ? body.sub : null,
      email: typeof body.email === 'string' ? body.email : null,
    };
  }

  // --- Calendar --------------------------------------------------------------------------------------------------------

  /** The calendars the account can write to (`minAccessRole=writer`), the primary one first. */
  async listCalendars(accessToken: string): Promise<GoogleCalendarListEntry[]> {
    const out: GoogleCalendarListEntry[] = [];
    let pageToken: string | undefined;
    // A few pages are plenty for a person's calendar list; the cap only stops a runaway loop.
    for (let page = 0; page < 5; page += 1) {
      const q = new URLSearchParams({ minAccessRole: 'writer', maxResults: '250' });
      if (pageToken) q.set('pageToken', pageToken);
      const body = (await this.api(accessToken, 'GET', `/users/me/calendarList?${q}`)) as Json;
      for (const raw of (body.items as Json[] | undefined) ?? []) {
        if (typeof raw.id !== 'string') continue;
        const name = (raw.summaryOverride ?? raw.summary ?? raw.id) as string;
        out.push({
          id: raw.id,
          name: String(name),
          primary: raw.primary === true,
          timezone: typeof raw.timeZone === 'string' ? raw.timeZone : null,
          accessRole: typeof raw.accessRole === 'string' ? raw.accessRole : 'writer',
        });
      }
      pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : undefined;
      if (!pageToken) break;
    }
    return out.sort((a, b) => Number(b.primary) - Number(a.primary));
  }

  async freeBusy(
    accessToken: string,
    calendarId: string,
    from: Date,
    to: Date,
  ): Promise<CalendarBusyInterval[]> {
    const body = await this.api(accessToken, 'POST', '/freeBusy', {
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      items: [{ id: calendarId }],
    });
    const parsed = parseFreeBusy(body, calendarId);
    if (parsed.error) {
      // Not "free": the calendar could not be read (deleted, access withdrawn).
      throw new GoogleCalendarError('not_found', 200, parsed.error);
    }
    return parsed.busy;
  }

  /** The timed events this platform wrote in a range (they carry a private `crmManaged` property). */
  async ownEventIntervals(
    accessToken: string,
    calendarId: string,
    from: Date,
    to: Date,
  ): Promise<CalendarBusyInterval[]> {
    const q = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: 'true',
      showDeleted: 'false',
      maxResults: '250',
      privateExtendedProperty: `${OWN_EVENT_KEY}=1`,
      fields: 'items(status,start/dateTime,end/dateTime)',
    });
    return parseEventIntervals(
      await this.api(accessToken, 'GET', `/calendars/${enc(calendarId)}/events?${q}`),
    );
  }

  async insertEvent(
    accessToken: string,
    calendarId: string,
    body: GoogleEventBody,
    opts: { conference: boolean; sendUpdates: boolean },
  ): Promise<GoogleEventResult> {
    return (await this.api(
      accessToken,
      'POST',
      `/calendars/${enc(calendarId)}/events${eventQuery(opts)}`,
      body,
    )) as GoogleEventResult;
  }

  async patchEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    body: Partial<GoogleEventBody>,
    opts: { conference: boolean; sendUpdates: boolean },
  ): Promise<GoogleEventResult> {
    return (await this.api(
      accessToken,
      'PATCH',
      `/calendars/${enc(calendarId)}/events/${enc(eventId)}${eventQuery(opts)}`,
      body,
    )) as GoogleEventResult;
  }

  async getEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
  ): Promise<GoogleEventResult> {
    return (await this.api(
      accessToken,
      'GET',
      `/calendars/${enc(calendarId)}/events/${enc(eventId)}?conferenceDataVersion=1`,
    )) as GoogleEventResult;
  }

  /** Already gone (404, 410) counts as deleted: a retried delete must succeed. */
  async deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
    try {
      await this.api(
        accessToken,
        'DELETE',
        `/calendars/${enc(calendarId)}/events/${enc(eventId)}?sendUpdates=all`,
      );
    } catch (err) {
      if (err instanceof GoogleCalendarError && (err.kind === 'not_found' || err.kind === 'gone')) {
        return;
      }
      throw err;
    }
  }

  // --- transport -------------------------------------------------------------------------------------------------------

  private async token(form: Record<string, string>): Promise<Json> {
    return (await this.send(this.env().GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      classify: classifyTokenError,
    })) as Json;
  }

  private api(token: string, method: string, path: string, body?: unknown): Promise<unknown> {
    return this.send(`${this.env().GOOGLE_CALENDAR_API_URL}${path}`, {
      method,
      token,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      classify: classifyApiError,
    });
  }

  private async send(
    url: string,
    opts: {
      method?: string;
      token?: string;
      headers?: Record<string, string>;
      body?: string;
      classify: (status: number, body: unknown) => GoogleCalendarError;
    },
  ): Promise<unknown> {
    const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body,
        signal: AbortSignal.timeout(this.env().GOOGLE_HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new GoogleCalendarError(
        timedOut ? 'timeout' : 'network',
        0,
        timedOut ? 'timeout' : ((err as { cause?: { code?: string } }).cause?.code ?? 'network'),
      );
    }
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (!res.ok) throw opts.classify(res.status, parsed);
    return parsed ?? {};
  }
}

const enc = encodeURIComponent;

/** `conferenceDataVersion=1` is what makes Google keep (and create) the Meet room; without it the field is silently dropped. */
function eventQuery(opts: { conference: boolean; sendUpdates: boolean }): string {
  const q = new URLSearchParams();
  if (opts.conference) q.set('conferenceDataVersion', '1');
  if (opts.sendUpdates) q.set('sendUpdates', 'all');
  const s = q.toString();
  return s ? `?${s}` : '';
}
