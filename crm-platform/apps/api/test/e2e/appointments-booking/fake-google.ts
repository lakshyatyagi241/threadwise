import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for Google's OAuth and Calendar v3 endpoints, local to a test. It keeps real state (accounts, codes, tokens, calendars,
 * events) so the adapter is exercised against something that answers like Google does: 409 on a repeated event id, 410 on a deleted
 * event, 404 for an event that never existed, `invalid_grant` for a revoked refresh token, 401 for an access token that stopped
 * working, free/busy that includes the events written to the calendar.
 *
 * It is written from Google's documentation, not recorded from Google: it proves the adapter behaves correctly against that
 * description, and says nothing about what a live Google account would answer.
 */
export interface FakeAccount {
  sub: string;
  email: string;
}

export interface FakeRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  auth: string | null;
  body: Record<string, unknown>;
}

export interface FakeEvent {
  id: string;
  status: 'confirmed' | 'cancelled';
  summary?: string;
  description?: string | null;
  location?: string | null;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
  attendees?: Array<{ email: string; displayName?: string }>;
  extendedProperties?: { private?: Record<string, string> };
  hangoutLink?: string;
  conferenceData?: unknown;
  [k: string]: unknown;
}

interface Failure {
  method: string;
  path: RegExp;
  status: number;
  body: unknown;
  times: number;
  /** Apply the request's effect first, then answer with the failure: the answer was lost, the event was not. */
  afterEffect: boolean;
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(text);
};

export class FakeGoogle {
  private server!: Server;
  url = '';
  clientId = 'test-client';
  clientSecret = 'test-secret';
  requests: FakeRequest[] = [];

  /** code -> who it signs in, what it grants. A code is good once. */
  codes = new Map<string, { account: FakeAccount; scope?: string; refresh?: boolean }>();
  refreshTokens = new Map<string, { account: FakeAccount; valid: boolean }>();
  accessTokens = new Map<string, { account: FakeAccount; valid: boolean }>();
  revoked: string[] = [];
  revokeStatus = 200;
  /** Calendars the account can write to (the primary one's id is the account email, as in Google). */
  calendars: Array<{ id: string; summary: string; primary?: boolean; accessRole: string }> = [];
  busy = new Map<string, Array<{ start: string; end: string }>>();
  events = new Map<string, Map<string, FakeEvent>>();
  private failures: Failure[] = [];
  private seq = 0;

  static async start(): Promise<FakeGoogle> {
    const g = new FakeGoogle();
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
      GOOGLE_OAUTH_AUTH_URL: `${this.url}/auth`,
      GOOGLE_OAUTH_TOKEN_URL: `${this.url}/token`,
      GOOGLE_OAUTH_REVOKE_URL: `${this.url}/revoke`,
      GOOGLE_USERINFO_URL: `${this.url}/userinfo`,
      GOOGLE_CALENDAR_API_URL: `${this.url}/calendar/v3`,
    };
  }

  account(email: string): FakeAccount {
    const acc = { sub: `sub-${email}`, email };
    if (!this.calendars.some((c) => c.id === email)) {
      this.calendars.unshift({ id: email, summary: email, primary: true, accessRole: 'owner' });
    }
    return acc;
  }

  /** A consent the person is about to complete: the callback gets this `code`. */
  grant(
    code: string,
    account: FakeAccount,
    opts: { scope?: string; refresh?: boolean } = {},
  ): string {
    this.codes.set(code, { account, ...opts });
    return code;
  }

  count(method: string, path: RegExp): number {
    return this.requests.filter((r) => r.method === method && path.test(r.path)).length;
  }

  forms(grantType: string): FakeRequest[] {
    return this.requests.filter((r) => r.path === '/token' && r.body.grant_type === grantType);
  }

  failNext(
    method: string,
    path: RegExp,
    status: number,
    opts: { times?: number; afterEffect?: boolean; body?: unknown } = {},
  ): void {
    this.failures.push({
      method,
      path,
      status,
      body: opts.body ?? {
        error: { code: status, message: 'injected', errors: [{ reason: 'backendError' }] },
      },
      times: opts.times ?? 1,
      afterEffect: opts.afterEffect ?? false,
    });
  }

  clearFailures(): void {
    this.failures = [];
  }

  /** Every access token stops working (as when Google revokes it early): the adapter's next call gets a 401. */
  killAccessTokens(): void {
    for (const t of this.accessTokens.values()) t.valid = false;
  }

  eventsOf(calendarId: string): FakeEvent[] {
    return [...(this.events.get(calendarId)?.values() ?? [])];
  }

  /** `primary` is an alias for the signed-in account's own calendar. */
  private norm(calendarId: string, email: string): string {
    return calendarId === 'primary' ? email : decodeURIComponent(calendarId);
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
    this.requests.push({ method, path: url.pathname, query: url.searchParams, auth, body });

    const failure = this.failures.find(
      (f) => f.method === method && f.path.test(url.pathname) && f.times > 0,
    );
    if (failure && !failure.afterEffect) {
      failure.times -= 1;
      return json(res, failure.status, failure.body);
    }
    const result = this.route(method, url, body, auth);
    if (failure?.afterEffect) {
      failure.times -= 1;
      return json(res, failure.status, failure.body);
    }
    json(res, result.status, result.body);
  }

  private route(
    method: string,
    url: URL,
    body: Record<string, unknown>,
    token: string | null,
  ): { status: number; body: unknown } {
    const path = url.pathname;
    if (path === '/token' && method === 'POST') return this.token(body);
    if (path === '/revoke' && method === 'POST') {
      this.revoked.push(String(body.token));
      const rt = this.refreshTokens.get(String(body.token));
      if (rt) rt.valid = false;
      return this.revokeStatus === 200
        ? { status: 200, body: {} }
        : { status: this.revokeStatus, body: { error: 'server_error' } };
    }
    // Everything below needs a live access token.
    const live = token ? this.accessTokens.get(token) : undefined;
    if (!live?.valid) {
      return {
        status: 401,
        body: { error: { code: 401, status: 'UNAUTHENTICATED', message: 'Invalid Credentials' } },
      };
    }
    if (path === '/userinfo')
      return { status: 200, body: { sub: live.account.sub, email: live.account.email } };

    const api = path.replace(/^\/calendar\/v3/, '');
    if (api === '/users/me/calendarList' && method === 'GET') {
      return {
        status: 200,
        body: {
          items: this.calendars.filter(
            (c) =>
              (c.accessRole === 'owner' || c.accessRole === 'writer') &&
              // A primary calendar is the signed-in account's own; shared ones are visible to every account of the test.
              (!c.primary || c.id === live.account.email),
          ),
        },
      };
    }
    if (api === '/freeBusy' && method === 'POST') return this.freeBusy(body, live.account.email);
    const m = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(api);
    if (m)
      return this.events_(
        method,
        url,
        body,
        this.norm(m[1]!, live.account.email),
        m[2] ? decodeURIComponent(m[2]) : null,
      );
    return { status: 404, body: { error: { code: 404, errors: [{ reason: 'notFound' }] } } };
  }

  private token(form: Record<string, unknown>) {
    if (form.client_id !== this.clientId || form.client_secret !== this.clientSecret) {
      return {
        status: 401,
        body: { error: 'invalid_client', error_description: 'The OAuth client was not found.' },
      };
    }
    const newAccess = (account: FakeAccount) => {
      const t = `at-${++this.seq}`;
      this.accessTokens.set(t, { account, valid: true });
      return t;
    };
    if (form.grant_type === 'authorization_code') {
      const grant = this.codes.get(String(form.code));
      this.codes.delete(String(form.code));
      if (!grant)
        return { status: 400, body: { error: 'invalid_grant', error_description: 'Bad Request' } };
      const scope =
        grant.scope ??
        [
          'openid',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/calendar.events',
          'https://www.googleapis.com/auth/calendar.freebusy',
          'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
        ].join(' ');
      const out: Record<string, unknown> = {
        access_token: newAccess(grant.account),
        expires_in: 3599,
        scope,
        token_type: 'Bearer',
      };
      if (grant.refresh !== false) {
        const rt = `rt-${String(form.code)}-${++this.seq}`;
        this.refreshTokens.set(rt, { account: grant.account, valid: true });
        out.refresh_token = rt;
      }
      return { status: 200, body: out };
    }
    if (form.grant_type === 'refresh_token') {
      const rt = this.refreshTokens.get(String(form.refresh_token));
      if (!rt?.valid) {
        return {
          status: 400,
          body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
        };
      }
      return {
        status: 200,
        body: { access_token: newAccess(rt.account), expires_in: 3599, token_type: 'Bearer' },
      };
    }
    return { status: 400, body: { error: 'unsupported_grant_type' } };
  }

  private freeBusy(body: Record<string, unknown>, email: string) {
    const items = (body.items as Array<{ id: string }>) ?? [];
    const min = Date.parse(String(body.timeMin));
    const max = Date.parse(String(body.timeMax));
    const calendars: Record<string, unknown> = {};
    for (const { id } of items) {
      if (id === 'gone@example.com') {
        calendars[id] = { errors: [{ domain: 'global', reason: 'notFound' }], busy: [] };
        continue;
      }
      const real = this.norm(id, email);
      const blocks = [
        ...(this.busy.get(real) ?? []),
        ...this.eventsOf(real)
          .filter((e) => e.status !== 'cancelled')
          .map((e) => ({ start: e.start.dateTime, end: e.end.dateTime })),
      ]
        .filter((b) => Date.parse(b.end) > min && Date.parse(b.start) < max)
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      calendars[id] = { busy: blocks };
    }
    return { status: 200, body: { kind: 'calendar#freeBusy', calendars } };
  }

  private events_(
    method: string,
    url: URL,
    body: Record<string, unknown>,
    calendar: string,
    eventId: string | null,
  ) {
    const store = this.events.get(calendar) ?? new Map<string, FakeEvent>();
    this.events.set(calendar, store);
    const notFound = {
      status: 404,
      body: { error: { code: 404, message: 'Not Found', errors: [{ reason: 'notFound' }] } },
    };

    if (!eventId && method === 'GET') {
      const prop = url.searchParams.get('privateExtendedProperty');
      const [k, v] = (prop ?? '').split('=');
      const min = Date.parse(url.searchParams.get('timeMin') ?? '');
      const max = Date.parse(url.searchParams.get('timeMax') ?? '');
      const items = [...store.values()].filter(
        (e) =>
          e.status !== 'cancelled' &&
          (!prop || e.extendedProperties?.private?.[k!] === v) &&
          Date.parse(e.end.dateTime) > min &&
          Date.parse(e.start.dateTime) < max,
      );
      return { status: 200, body: { items } };
    }
    if (!eventId && method === 'POST') {
      const id = (body.id as string | undefined) ?? `ev${++this.seq}`;
      if (store.has(id)) {
        return {
          status: 409,
          body: {
            error: {
              code: 409,
              message: 'The requested identifier already exists.',
              errors: [{ reason: 'duplicate' }],
            },
          },
        };
      }
      const event = this.compose(
        { ...(body as unknown as FakeEvent), id, status: 'confirmed' },
        url,
      );
      store.set(id, event);
      return { status: 200, body: event };
    }
    const existing = eventId ? store.get(eventId) : undefined;
    if (method === 'GET') return existing ? { status: 200, body: existing } : notFound;
    if (method === 'PATCH') {
      if (!existing) return notFound;
      const merged: Record<string, unknown> = { ...existing };
      for (const [k, v] of Object.entries(body)) {
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      const event = this.compose(merged as unknown as FakeEvent, url, existing);
      store.set(eventId!, event);
      return { status: 200, body: event };
    }
    if (method === 'DELETE') {
      if (!existing) return notFound;
      if (existing.status === 'cancelled') {
        return {
          status: 410,
          body: {
            error: {
              code: 410,
              message: 'Resource has been deleted',
              errors: [{ reason: 'deleted' }],
            },
          },
        };
      }
      existing.status = 'cancelled';
      return { status: 204, body: undefined };
    }
    return notFound;
  }

  /** Meet rooms exist only when the request asked for conference data version 1, and an event keeps the one it has. */
  private compose(event: FakeEvent, url: URL, before?: FakeEvent): FakeEvent {
    const wanted = (event.conferenceData as { createRequest?: { requestId: string } } | undefined)
      ?.createRequest;
    if (before?.hangoutLink) {
      event.hangoutLink = before.hangoutLink;
      event.conferenceData = before.conferenceData;
    } else if (wanted && url.searchParams.get('conferenceDataVersion') === '1') {
      const link = `https://meet.fake/${wanted.requestId}`;
      event.hangoutLink = link;
      event.conferenceData = { entryPoints: [{ entryPointType: 'video', uri: link }] };
    } else {
      delete event.conferenceData;
    }
    return event;
  }
}
