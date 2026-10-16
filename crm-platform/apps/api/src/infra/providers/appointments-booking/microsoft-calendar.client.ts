import { Injectable } from '@nestjs/common';
import { MICROSOFT_CALENDAR_SCOPES } from '@crm/contracts';
import {
  microsoftCalendarEnv,
  type MicrosoftCalendarEnv,
} from '../../../config/domains/microsoft-calendar.env';
import type { CalendarBusyInterval } from './calendar-sync.port';
import {
  classifyGraphError,
  classifyMicrosoftTokenError,
  MicrosoftCalendarError,
} from './microsoft-calendar.errors';
import {
  APPOINTMENT_PROPERTY_ID,
  busyIntervalsOf,
  OWN_EVENT_PROPERTY_ID,
  ownIntervalsOf,
  type GraphEventBody,
} from './microsoft-calendar.mapping';
import { microsoftRequest } from './microsoft-transport';

/** The platform's Entra app: where the consent screen and the token calls are made as. */
export interface MicrosoftClientCredentials {
  clientId: string;
  clientSecret: string;
  /** `common`, `organizations`, `consumers` or a directory id. */
  tenant: string;
  redirectUri: string;
}

export interface MicrosoftTokens {
  accessToken: string;
  /** Microsoft rotates it: a refresh returns a new one, which replaces the one in use. */
  refreshToken: string | null;
  expiresInSeconds: number;
  /** The scopes actually granted, space separated (a person or an admin can narrow them). */
  scope: string;
}

export interface MicrosoftAccount {
  /** The directory object id: stable for the account. */
  id: string | null;
  /** `mail`, else the sign-in name. Lower-cased. */
  address: string | null;
}

export interface MicrosoftCalendarListEntry {
  id: string;
  name: string;
  primary: boolean;
  timezone: string | null;
  accessRole: string;
}

export interface MicrosoftEventResult {
  id: string;
  '@odata.etag'?: string;
  isCancelled?: boolean;
  isAllDay?: boolean;
  start?: unknown;
  end?: unknown;
  attendees?: Array<{ type?: string; emailAddress?: { address?: string } }>;
  onlineMeeting?: { joinUrl?: string } | null;
  onlineMeetingUrl?: string | null;
}

type Json = Record<string, unknown>;

const enc = encodeURIComponent;
/** Pages of a calendar view are followed at most this far: a workspace with thousands of events in a window is not read to the end. */
const MAX_PAGES = 10;

/**
 * Microsoft's identity platform (v2.0) OAuth endpoints and Microsoft Graph's calendar endpoints, one method per call (BL-035). Plain HTTP with
 * a timeout: it holds no tenant, no database and no secret of its own, every credential and token is an argument, and every failure is a
 * `MicrosoftCalendarError` whose `kind` the caller switches on. The base addresses come from the environment so a test can aim it at a local
 * stand-in.
 *
 * Endpoints and parameters were taken from learn.microsoft.com (OAuth 2.0 authorization code flow; Graph: user, calendar, event,
 * calendarView) and are NOT verified against a live Microsoft tenant in this repository.
 */
@Injectable()
export class MicrosoftCalendarClient {
  private env(): MicrosoftCalendarEnv {
    return microsoftCalendarEnv();
  }

  private authority(tenant: string): string {
    return `${this.env().MICROSOFT_CALENDAR_LOGIN_URL.replace(/\/$/, '')}/${enc(tenant || 'common')}/oauth2/v2.0`;
  }

  private graph(path: string): string {
    return `${this.env().MICROSOFT_CALENDAR_GRAPH_URL.replace(/\/$/, '')}${path}`;
  }

  /** `/me/calendar` for the default calendar, `/me/calendars/{id}` for a picked one. */
  private calendarPath(calendarId: string | null): string {
    return !calendarId || calendarId === 'primary'
      ? '/me/calendar'
      : `/me/calendars/${enc(calendarId)}`;
  }

  // --- OAuth -----------------------------------------------------------------------------------------------------------

  /**
   * `offline_access` gets the refresh token. `select_account` lets a person with several Microsoft sessions pick the account (a reconnect
   * names it with `login_hint`). `response_mode=query` brings the code back on the redirect's query string.
   */
  authorizeUrl(
    creds: MicrosoftClientCredentials,
    state: string,
    loginHint?: string | null,
  ): string {
    const q = new URLSearchParams({
      client_id: creds.clientId,
      response_type: 'code',
      redirect_uri: creds.redirectUri,
      response_mode: 'query',
      scope: MICROSOFT_CALENDAR_SCOPES.join(' '),
      state,
    });
    if (loginHint) q.set('login_hint', loginHint);
    else q.set('prompt', 'select_account');
    return `${this.authority(creds.tenant)}/authorize?${q.toString()}`;
  }

  async exchangeCode(creds: MicrosoftClientCredentials, code: string): Promise<MicrosoftTokens> {
    // A code is good once: a repeat after a lost answer would fail with invalid_grant and hide the real outcome.
    return this.token(
      creds,
      {
        grant_type: 'authorization_code',
        code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: creds.redirectUri,
        scope: MICROSOFT_CALENDAR_SCOPES.join(' '),
      },
      0,
    );
  }

  /** Microsoft rotates the refresh token: the one in the answer replaces the one that was used. */
  async refresh(creds: MicrosoftClientCredentials, refreshToken: string): Promise<MicrosoftTokens> {
    return this.token(creds, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: MICROSOFT_CALENDAR_SCOPES.join(' '),
    });
  }

  /** The account behind an access token. `mail` is empty on some personal accounts, whose sign-in name is then the address. */
  async me(accessToken: string): Promise<MicrosoftAccount> {
    const body = (await microsoftRequest(this.graph('/me?$select=id,mail,userPrincipalName'), {
      token: accessToken,
      classify: classifyGraphError,
    })) as Json;
    const mail = typeof body.mail === 'string' && body.mail.includes('@') ? body.mail : null;
    const upn =
      typeof body.userPrincipalName === 'string' && body.userPrincipalName.includes('@')
        ? body.userPrincipalName
        : null;
    return {
      id: typeof body.id === 'string' && body.id ? body.id : null,
      address: (mail ?? upn)?.trim().toLowerCase() ?? null,
    };
  }

  private async token(
    creds: MicrosoftClientCredentials,
    form: Record<string, string>,
    retries?: number,
  ): Promise<MicrosoftTokens> {
    const body = (await microsoftRequest(`${this.authority(creds.tenant)}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      classify: classifyMicrosoftTokenError,
      retries,
    })) as Json;
    if (typeof body.access_token !== 'string' || !body.access_token) {
      throw new MicrosoftCalendarError('server', 200, 'no_access_token');
    }
    return {
      accessToken: body.access_token,
      refreshToken:
        typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : null,
      expiresInSeconds: Number(body.expires_in) || 3600,
      scope: typeof body.scope === 'string' ? body.scope : '',
    };
  }

  // --- calendars -------------------------------------------------------------------------------------------------------

  /** The calendars the account can write to (`canEdit`), the default one first. */
  async listCalendars(token: string): Promise<MicrosoftCalendarListEntry[]> {
    const out: MicrosoftCalendarListEntry[] = [];
    let url: string | null = this.graph(
      '/me/calendars?$select=id,name,canEdit,isDefaultCalendar&$top=100',
    );
    for (let page = 0; url && page < 3; page += 1) {
      const body = (await microsoftRequest(url, { token, classify: classifyGraphError })) as Json;
      for (const raw of (body.value as Json[] | undefined) ?? []) {
        if (raw.canEdit !== true || typeof raw.id !== 'string') continue;
        const primary = raw.isDefaultCalendar === true;
        out.push({
          id: primary ? 'primary' : raw.id,
          name: typeof raw.name === 'string' && raw.name ? raw.name : 'Calendar',
          primary,
          timezone: null,
          accessRole: primary ? 'owner' : 'writer',
        });
      }
      url = typeof body['@odata.nextLink'] === 'string' ? body['@odata.nextLink'] : null;
    }
    return out.sort((a, b) => Number(b.primary) - Number(a.primary));
  }

  /** Whether the calendar still exists and is visible to the account (a 404 is an answer, not a failure). */
  async getCalendar(token: string, calendarId: string | null): Promise<void> {
    await microsoftRequest(this.graph(`${this.calendarPath(calendarId)}?$select=id`), {
      token,
      classify: classifyGraphError,
    });
  }

  // --- busy time -------------------------------------------------------------------------------------------------------

  /**
   * The busy intervals of one calendar in a range, from its calendar view (recurring meetings are already expanded there). No retries and
   * a short timeout: a visitor is waiting on this, and the caller turns a failure into "no busy data". `withOwn` also returns the
   * events this platform wrote, so a group type's seats are not closed by its own first booking.
   */
  async busy(
    token: string,
    calendarId: string | null,
    from: Date,
    to: Date,
    withOwn: boolean,
  ): Promise<{ busy: CalendarBusyInterval[]; own: CalendarBusyInterval[] }> {
    const select = '$select=id,start,end,showAs,isCancelled,isAllDay';
    const expand = withOwn
      ? `&$expand=singleValueExtendedProperties($filter=id eq '${OWN_EVENT_PROPERTY_ID}')`
      : '';
    let url: string | null = this.graph(
      `${this.calendarPath(calendarId)}/calendarView?startDateTime=${enc(from.toISOString())}&endDateTime=${enc(
        to.toISOString(),
      )}&${select}&$top=100${expand}`,
    );
    const items: unknown[] = [];
    for (let page = 0; url && page < MAX_PAGES; page += 1) {
      const body = (await microsoftRequest(url, {
        token,
        headers: { prefer: 'outlook.timezone="UTC"' },
        classify: classifyGraphError,
        retries: 0,
      })) as Json;
      items.push(...(((body.value as unknown[] | undefined) ?? []) as unknown[]));
      url = typeof body['@odata.nextLink'] === 'string' ? body['@odata.nextLink'] : null;
    }
    return { busy: busyIntervalsOf(items), own: withOwn ? ownIntervalsOf(items) : [] };
  }

  // --- events ----------------------------------------------------------------------------------------------------------

  /** Creates the event in `calendarId`. The body's `transactionId` makes a repeat of this POST find the event it already made. */
  async insertEvent(
    token: string,
    calendarId: string | null,
    body: GraphEventBody,
  ): Promise<MicrosoftEventResult> {
    return (await microsoftRequest(this.graph(`${this.calendarPath(calendarId)}/events`), {
      method: 'POST',
      token,
      headers: { 'content-type': 'application/json', prefer: 'outlook.timezone="UTC"' },
      body: JSON.stringify(body),
      classify: classifyGraphError,
    })) as MicrosoftEventResult;
  }

  /** Events are addressed by id alone: the id is unique in the mailbox, whichever calendar holds the event. */
  async patchEvent(
    token: string,
    eventId: string,
    body: GraphEventBody,
  ): Promise<MicrosoftEventResult> {
    return (await microsoftRequest(this.graph(`/me/events/${enc(eventId)}`), {
      method: 'PATCH',
      token,
      headers: { 'content-type': 'application/json', prefer: 'outlook.timezone="UTC"' },
      body: JSON.stringify(body),
      classify: classifyGraphError,
    })) as MicrosoftEventResult;
  }

  async getEvent(token: string, eventId: string): Promise<MicrosoftEventResult> {
    return (await microsoftRequest(
      this.graph(
        `/me/events/${enc(eventId)}?$select=id,start,end,isCancelled,isAllDay,attendees,onlineMeeting`,
      ),
      { token, headers: { prefer: 'outlook.timezone="UTC"' }, classify: classifyGraphError },
    )) as MicrosoftEventResult;
  }

  /** Deleting an event the account organized also cancels it for the guests (Graph sends the cancellation). */
  async deleteEvent(token: string, eventId: string): Promise<void> {
    await microsoftRequest(this.graph(`/me/events/${enc(eventId)}`), {
      method: 'DELETE',
      token,
      classify: classifyGraphError,
    });
  }

  /** The event we wrote for an appointment, found by our private property: how a create whose answer was lost is recognised. */
  async findByAppointment(
    token: string,
    calendarId: string | null,
    appointmentId: string,
  ): Promise<MicrosoftEventResult | null> {
    const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${APPOINTMENT_PROPERTY_ID}' and ep/value eq '${appointmentId.replace(/[^0-9a-f-]/gi, '')}')`;
    const body = (await microsoftRequest(
      this.graph(
        `${this.calendarPath(calendarId)}/events?$filter=${enc(filter)}&$select=id,start,end,isCancelled,attendees,onlineMeeting&$top=1`,
      ),
      { token, headers: { prefer: 'outlook.timezone="UTC"' }, classify: classifyGraphError },
    )) as Json;
    const first = ((body.value as MicrosoftEventResult[] | undefined) ?? [])[0];
    return first ?? null;
  }
}
