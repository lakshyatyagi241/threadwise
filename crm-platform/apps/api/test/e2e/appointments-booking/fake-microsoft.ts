import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for the Microsoft identity platform (v2.0 token endpoint) and the part of Microsoft Graph the Outlook calendar adapter uses
 * (`/me`, calendars, events, calendar view), local to a test. It keeps real state (accounts, codes, tokens, calendars, events) so the adapter
 * is exercised against something that answers like Microsoft does: single-use codes, refresh tokens that rotate, `transactionId` returning
 * the event a repeated create already made, 404 for an event that never existed, a calendar view that includes the events written to the
 * calendar, `invalid_grant` for a revoked refresh token, 401 for an access token that stopped working.
 *
 * It is written from Microsoft's documentation, not recorded from Microsoft: it proves the adapter behaves correctly against that
 * description, and says nothing about what a live Microsoft 365 tenant would answer.
 */
export interface FakeMsAccount {
  id: string;
  email: string;
}

export interface FakeMsRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  auth: string | null;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
}

export interface FakeMsEvent {
  id: string;
  calendarId: string;
  subject: string;
  body?: { content?: string };
  location?: { displayName?: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  showAs: string;
  isCancelled: boolean;
  isAllDay: boolean;
  attendees: Array<{ type: string; emailAddress: { address: string; name?: string } }>;
  transactionId?: string;
  onlineMeeting: { joinUrl: string } | null;
  singleValueExtendedProperties: Array<{ id: string; value: string }>;
  '@odata.etag': string;
}

interface Failure {
  method: string;
  path: RegExp;
  status: number;
  body: unknown;
  times: number;
  headers?: Record<string, string>;
}

const json = (
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) => {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(text);
};

const graphError = (status: number, code: string) => ({
  status,
  body: { error: { code, message: 'injected' } },
});

export class FakeMicrosoft {
  private server!: Server;
  url = '';
  clientId = 'ms-client';
  clientSecret = 'ms-secret';
  requests: FakeMsRequest[] = [];

  /** code -> who it signs in, what it grants. A code is good once. */
  codes = new Map<string, { account: FakeMsAccount; scope?: string; refresh?: boolean }>();
  usedCodes = new Set<string>();
  refreshTokens = new Map<string, { account: FakeMsAccount; valid: boolean; scope: string }>();
  accessTokens = new Map<string, { account: FakeMsAccount; valid: boolean }>();
  /** When true, a refresh invalidates the refresh token it used (Microsoft allows the old one to live on; a test can be strict). */
  strictRotation = false;
  /** Calendars per account id. The default calendar of an account has id `default-<id>`. */
  calendars = new Map<
    string,
    Array<{ id: string; name: string; canEdit: boolean; isDefaultCalendar: boolean }>
  >();
  events = new Map<string, FakeMsEvent>();
  /** Events that belong to the person, not to us: they block time in the calendar view. */
  private failures: Failure[] = [];
  private seq = 0;
  private tokenSeq = 0;
  /** Accounts that have no Teams meeting (personal accounts): a create that asks for one is a 400. */
  noTeams = new Set<string>();

  static async start(): Promise<FakeMicrosoft> {
    const g = new FakeMicrosoft();
    g.server = createServer((req, res) => void g.handle(req, res));
    await new Promise<void>((resolve) => g.server.listen(0, '127.0.0.1', resolve));
    g.url = `http://127.0.0.1:${(g.server.address() as AddressInfo).port}`;
    return g;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** Points the app at this server (the adapter reads these at call time). */
  env(): Record<string, string> {
    return {
      MICROSOFT_CALENDAR_LOGIN_URL: this.url,
      MICROSOFT_CALENDAR_GRAPH_URL: `${this.url}/v1.0`,
    };
  }

  account(email: string): FakeMsAccount {
    const acc = { id: `oid-${email}`, email };
    if (!this.calendars.has(acc.id)) {
      this.calendars.set(acc.id, [
        { id: `default-${acc.id}`, name: 'Calendar', canEdit: true, isDefaultCalendar: true },
      ]);
    }
    return acc;
  }

  addCalendar(account: FakeMsAccount, id: string, name: string, canEdit = true): void {
    this.calendars.get(account.id)!.push({ id, name, canEdit, isDefaultCalendar: false });
  }

  /** A consent the person is about to complete: the callback gets this `code`. */
  grant(
    code: string,
    account: FakeMsAccount,
    opts: { scope?: string; refresh?: boolean } = {},
  ): string {
    this.codes.set(code, { account, ...opts });
    return code;
  }

  /** A meeting of the person's own (not ours): it blocks time in the calendar view of `calendarId` (default: the account's default). */
  addBusy(
    account: FakeMsAccount,
    startIso: string,
    endIso: string,
    opts: { showAs?: string; calendarId?: string; cancelled?: boolean } = {},
  ): FakeMsEvent {
    return this.put({
      calendarId: opts.calendarId ?? `default-${account.id}`,
      subject: 'Their meeting',
      start: { dateTime: startIso.slice(0, 19), timeZone: 'UTC' },
      end: { dateTime: endIso.slice(0, 19), timeZone: 'UTC' },
      showAs: opts.showAs ?? 'busy',
      isCancelled: opts.cancelled ?? false,
      attendees: [],
    });
  }

  eventsOf(calendarId: string): FakeMsEvent[] {
    return [...this.events.values()].filter((e) => e.calendarId === calendarId);
  }

  /** Somebody edits an event in Outlook's own UI: the fields change and Microsoft issues a new version tag. */
  editEvent(id: string, patch: Partial<FakeMsEvent>): FakeMsEvent {
    const ev = this.events.get(id);
    if (!ev) throw new Error(`no event ${id}`);
    Object.assign(ev, patch, { '@odata.etag': `W/"${++this.seq}"` });
    return ev;
  }

  removeEvent(id: string): void {
    this.events.delete(id);
  }

  count(method: string, path: RegExp): number {
    return this.requests.filter((r) => r.method === method && path.test(r.path)).length;
  }

  tokenCalls(grantType: string): FakeMsRequest[] {
    return this.requests.filter((r) => /\/token$/.test(r.path) && r.body.grant_type === grantType);
  }

  failNext(
    method: string,
    path: RegExp,
    status: number,
    opts: { times?: number; body?: unknown; headers?: Record<string, string> } = {},
  ): void {
    this.failures.push({
      method,
      path,
      status,
      body: opts.body ?? { error: { code: 'generalException', message: 'injected' } },
      times: opts.times ?? 1,
      headers: opts.headers,
    });
  }

  clearFailures(): void {
    this.failures = [];
  }

  /** Every access token stops working (as when Microsoft revokes it early): the adapter's next call gets a 401. */
  killAccessTokens(): void {
    for (const t of this.accessTokens.values()) t.valid = false;
  }

  private put(
    e: Omit<
      FakeMsEvent,
      'id' | '@odata.etag' | 'isAllDay' | 'onlineMeeting' | 'singleValueExtendedProperties'
    > &
      Partial<
        Pick<FakeMsEvent, 'onlineMeeting' | 'singleValueExtendedProperties' | 'transactionId'>
      >,
  ): FakeMsEvent {
    const id = `AAMk-${++this.seq}`;
    const ev: FakeMsEvent = {
      isAllDay: false,
      onlineMeeting: null,
      singleValueExtendedProperties: [],
      ...e,
      id,
      '@odata.etag': `W/"${++this.seq}"`,
    };
    this.events.set(id, ev);
    return ev;
  }

  // --- the server ------------------------------------------------------------------------------------------------------

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    const raw = await new Promise<string>((resolve) => {
      let data = '';
      req.on('data', (c: Buffer) => (data += c.toString()));
      req.on('end', () => resolve(data));
    });
    let body: Record<string, unknown> = {};
    if (raw) {
      if ((req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded')) {
        body = Object.fromEntries(new URLSearchParams(raw));
      } else {
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          body = {};
        }
      }
    }
    const auth = (req.headers.authorization ?? '').replace(/^Bearer /, '') || null;
    const method = req.method ?? 'GET';
    this.requests.push({
      method,
      path: url.pathname,
      query: url.searchParams,
      auth,
      headers: req.headers,
      body,
    });

    const failure = this.failures.find(
      (f) => f.method === method && f.path.test(url.pathname) && f.times > 0,
    );
    if (failure) {
      failure.times -= 1;
      return json(res, failure.status, failure.body, failure.headers);
    }
    const result = this.route(method, url, body, auth);
    json(res, result.status, result.body);
  }

  private route(
    method: string,
    url: URL,
    body: Record<string, unknown>,
    token: string | null,
  ): { status: number; body: unknown } {
    const path = url.pathname;
    if (/\/oauth2\/v2\.0\/token$/.test(path) && method === 'POST') return this.token(body);

    // Everything below is Graph and needs a live access token.
    const live = token ? this.accessTokens.get(token) : undefined;
    if (!live?.valid) return graphError(401, 'InvalidAuthenticationToken');
    const api = path.replace(/^\/v1\.0/, '');
    const account = live.account;

    if (api === '/me' && method === 'GET') {
      return {
        status: 200,
        body: { id: account.id, mail: account.email, userPrincipalName: account.email },
      };
    }
    if (api === '/me/calendars' && method === 'GET') {
      return { status: 200, body: { value: this.calendars.get(account.id) ?? [] } };
    }
    const calPath = /^\/me\/calendar(?:s\/([^/]+))?(\/[a-zA-Z]+)?$/.exec(api);
    if (calPath) {
      const id = calPath[1] ? decodeURIComponent(calPath[1]) : `default-${account.id}`;
      const owned = (this.calendars.get(account.id) ?? []).find((c) => c.id === id);
      const sub = calPath[2] ?? '';
      if (!owned) return graphError(404, 'ErrorItemNotFound');
      if (sub === '' && method === 'GET') return { status: 200, body: { id } };
      if (sub === '/calendarView' && method === 'GET') return this.view(id, url);
      if (sub === '/events' && method === 'POST') return this.create(id, body, account);
      if (sub === '/events' && method === 'GET') return this.find(id, url);
    }
    const ev = /^\/me\/events\/([^/]+)$/.exec(api);
    if (ev) {
      const id = decodeURIComponent(ev[1]!);
      const found = this.events.get(id);
      if (!found) return graphError(404, 'ErrorItemNotFound');
      if (method === 'GET') return { status: 200, body: found };
      if (method === 'DELETE') {
        this.events.delete(id);
        return { status: 204, body: undefined };
      }
      if (method === 'PATCH') {
        const patch = { ...body };
        delete patch.transactionId;
        Object.assign(found, patch, { '@odata.etag': `W/"${++this.seq}"` });
        return { status: 200, body: found };
      }
    }
    return graphError(404, 'ErrorInvalidRequest');
  }

  private create(
    calendarId: string,
    body: Record<string, unknown>,
    account: FakeMsAccount,
  ): { status: number; body: unknown } {
    const tx = typeof body.transactionId === 'string' ? body.transactionId : undefined;
    if (tx) {
      const again = [...this.events.values()].find(
        (e) => e.transactionId === tx && e.calendarId === calendarId,
      );
      if (again) return { status: 201, body: again };
    }
    const wantsMeeting = body.isOnlineMeeting === true;
    if (wantsMeeting && this.noTeams.has(account.id)) {
      return graphError(400, 'ErrorInvalidRequest');
    }
    const ev = this.put({
      calendarId,
      subject: String(body.subject ?? ''),
      body: body.body as FakeMsEvent['body'],
      location: body.location as FakeMsEvent['location'],
      start: body.start as FakeMsEvent['start'],
      end: body.end as FakeMsEvent['end'],
      showAs: String(body.showAs ?? 'busy'),
      isCancelled: false,
      attendees: (body.attendees as FakeMsEvent['attendees'] | undefined) ?? [],
      transactionId: tx,
      onlineMeeting: wantsMeeting ? { joinUrl: `https://teams.example/meet/${this.seq}` } : null,
      singleValueExtendedProperties:
        (body.singleValueExtendedProperties as
          FakeMsEvent['singleValueExtendedProperties'] | undefined) ?? [],
    });
    return { status: 201, body: ev };
  }

  private view(calendarId: string, url: URL): { status: number; body: unknown } {
    const from = Date.parse(`${url.searchParams.get('startDateTime')}`);
    const to = Date.parse(`${url.searchParams.get('endDateTime')}`);
    const expand = url.searchParams.get('$expand') ?? '';
    const items = this.eventsOf(calendarId)
      .filter(
        (e) => Date.parse(`${e.start.dateTime}Z`) < to && Date.parse(`${e.end.dateTime}Z`) > from,
      )
      .map((e) => ({
        id: e.id,
        start: { dateTime: `${e.start.dateTime}.0000000`, timeZone: 'UTC' },
        end: { dateTime: `${e.end.dateTime}.0000000`, timeZone: 'UTC' },
        showAs: e.showAs,
        isCancelled: e.isCancelled,
        isAllDay: e.isAllDay,
        ...(expand ? { singleValueExtendedProperties: e.singleValueExtendedProperties } : {}),
      }));
    return { status: 200, body: { value: items } };
  }

  private find(calendarId: string, url: URL): { status: number; body: unknown } {
    const filter = url.searchParams.get('$filter') ?? '';
    const wanted = /ep\/value eq '([^']+)'/.exec(filter)?.[1];
    const value = this.eventsOf(calendarId).filter((e) =>
      e.singleValueExtendedProperties.some(
        (p) => p.value === wanted && /crmAppointment/.test(p.id),
      ),
    );
    return { status: 200, body: { value } };
  }

  private token(body: Record<string, unknown>): { status: number; body: unknown } {
    if (body.client_id !== this.clientId || body.client_secret !== this.clientSecret) {
      return {
        status: 401,
        body: {
          error: 'invalid_client',
          error_description: 'AADSTS7000215: Invalid client secret provided',
          error_codes: [7000215],
        },
      };
    }
    if (body.grant_type === 'authorization_code') {
      const code = String(body.code);
      const grant = this.codes.get(code);
      if (!grant || this.usedCodes.has(code)) {
        return {
          status: 400,
          body: {
            error: 'invalid_grant',
            error_description: 'AADSTS54005: code already redeemed',
            error_codes: [54005],
          },
        };
      }
      this.usedCodes.add(code);
      const scope =
        grant.scope ?? 'openid profile email User.Read Calendars.ReadWrite offline_access';
      return { status: 200, body: this.issue(grant.account, scope, grant.refresh !== false) };
    }
    if (body.grant_type === 'refresh_token') {
      const rt = this.refreshTokens.get(String(body.refresh_token));
      if (!rt?.valid) {
        return {
          status: 400,
          body: {
            error: 'invalid_grant',
            error_description: 'AADSTS700082: The refresh token has expired due to inactivity',
            error_codes: [700082],
          },
        };
      }
      if (this.strictRotation) rt.valid = false;
      return { status: 200, body: this.issue(rt.account, rt.scope, true) };
    }
    return { status: 400, body: { error: 'unsupported_grant_type' } };
  }

  private issue(account: FakeMsAccount, scope: string, withRefresh: boolean) {
    const n = ++this.tokenSeq;
    const access = `ms-at-${n}`;
    this.accessTokens.set(access, { account, valid: true });
    const out: Record<string, unknown> = {
      token_type: 'Bearer',
      scope,
      expires_in: 3600,
      access_token: access,
    };
    if (withRefresh) {
      const refresh = `ms-rt-${n}`;
      this.refreshTokens.set(refresh, { account, valid: true, scope });
      out.refresh_token = refresh;
    }
    return out;
  }
}
