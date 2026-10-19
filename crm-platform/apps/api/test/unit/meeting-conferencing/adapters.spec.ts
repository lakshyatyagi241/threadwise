import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConferencingError,
  FakeVideoProvider,
  TeamsAdapter,
  teamsGrantCovers,
  ZoomAdapter,
  zoomDurationMinutes,
  zoomStartTime,
  type ProviderCredentialsSource,
} from '../../../src/infra/providers/meeting-conferencing';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** A `fetch` stand-in that answers from a queue and records what it was asked. */
function stubFetch(answers: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      headers: init.headers as Record<string, string>,
      body: init.body as string | undefined,
    });
    const a = answers.shift() ?? { status: 500 };
    return new Response(a.body === undefined ? null : JSON.stringify(a.body), {
      status: a.status,
      headers: a.headers,
    });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const creds: ProviderCredentialsSource = {
  credentials: async () => ({
    clientId: 'cid',
    clientSecret: 'secret',
    redirectUri: 'https://app.example/cb',
    tenant: 'common',
  }),
};
const none: ProviderCredentialsSource = { credentials: async () => null };

const req = {
  meetingKey: '3f2a9c1e-0000-4000-8000-000000000001',
  topic: 'Intro call',
  startsAt: new Date('2027-02-01T10:00:00.000Z'),
  endsAt: new Date('2027-02-01T10:45:00.000Z'),
  timezone: 'Asia/Kolkata',
};

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ['CONFERENCING_RETRIES', 'CONFERENCING_RETRY_BASE_MS']) saved[k] = process.env[k];
  process.env.CONFERENCING_RETRIES = '0';
  process.env.CONFERENCING_RETRY_BASE_MS = '1';
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('Zoom adapter (written from Zoom documentation; not run against a live Zoom account)', () => {
  it('works out the length and the start the way Zoom wants them', () => {
    expect(zoomDurationMinutes(req.startsAt, req.endsAt)).toBe(45);
    expect(zoomDurationMinutes(req.startsAt, req.startsAt)).toBe(30);
    expect(zoomDurationMinutes(req.endsAt, req.startsAt)).toBe(30);
    expect(zoomStartTime(req.startsAt)).toBe('2027-02-01T10:00:00Z');
  });

  it('builds the consent address and refuses when the platform has no app', async () => {
    const zoom = new ZoomAdapter(creds);
    const url = new URL(await zoom.authorizeUrl('STATE'));
    expect(url.origin + url.pathname).toBe('https://zoom.us/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('state')).toBe('STATE');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/cb');
    expect(await new ZoomAdapter(none).configured()).toBe(false);
    await expect(new ZoomAdapter(none).authorizeUrl('s')).rejects.toMatchObject({
      kind: 'invalid_client',
    });
  });

  it('exchanges a code with Basic auth, once, and reads the rotated tokens', async () => {
    const f = stubFetch([
      { status: 200, body: { access_token: 'A', refresh_token: 'R', expires_in: 3599, scope: 'meeting:write' } },
    ]);
    const t = await new ZoomAdapter(creds, f.impl).exchangeCode('CODE');
    expect(t).toEqual({ accessToken: 'A', refreshToken: 'R', expiresInSeconds: 3599, scope: 'meeting:write' });
    expect(f.calls[0]!.headers.authorization).toBe(`Basic ${Buffer.from('cid:secret').toString('base64')}`);
    expect(f.calls[0]!.body).toContain('grant_type=authorization_code');
    expect(f.calls[0]!.body).toContain('code=CODE');
  });

  it('classifies a revoked grant and a wrong platform secret apart', async () => {
    const revoked = stubFetch([{ status: 400, body: { error: 'invalid_grant' } }]);
    await expect(new ZoomAdapter(creds, revoked.impl).refresh('R')).rejects.toMatchObject({
      kind: 'invalid_grant',
    });
    const wrong = stubFetch([{ status: 401, body: { error: 'invalid_client' } }]);
    await expect(new ZoomAdapter(creds, wrong.impl).refresh('R')).rejects.toMatchObject({
      kind: 'invalid_client',
    });
  });

  it('creates a scheduled meeting and returns its id and join address', async () => {
    const f = stubFetch([{ status: 201, body: { id: 987654321, join_url: 'https://zoom.us/j/987654321' } }]);
    const made = await new ZoomAdapter(creds, f.impl).createMeeting('TOKEN', req);
    expect(made).toEqual({ providerMeetingId: '987654321', joinUrl: 'https://zoom.us/j/987654321' });
    const c = f.calls[0]!;
    expect(c.url).toBe('https://api.zoom.us/v2/users/me/meetings');
    expect(c.method).toBe('POST');
    expect(c.headers.authorization).toBe('Bearer TOKEN');
    expect(JSON.parse(c.body!)).toEqual({
      topic: 'Intro call',
      type: 2,
      start_time: '2027-02-01T10:00:00Z',
      duration: 45,
      timezone: 'Asia/Kolkata',
    });
  });

  it('never repeats a create after a transient failure (a lost answer would make a second meeting)', async () => {
    process.env.CONFERENCING_RETRIES = '3';
    const f = stubFetch([{ status: 503 }, { status: 201, body: { id: 1, join_url: 'https://zoom.us/j/1' } }]);
    await expect(new ZoomAdapter(creds, f.impl).createMeeting('T', req)).rejects.toMatchObject({
      kind: 'server',
    });
    expect(f.calls).toHaveLength(1);
  });

  it('moves a meeting with a PATCH (no body back) and treats a meeting that is gone as success on delete', async () => {
    const f = stubFetch([
      { status: 204 },
      { status: 404, body: { code: 3001, message: 'Meeting does not exist' } },
    ]);
    const zoom = new ZoomAdapter(creds, f.impl);
    expect(await zoom.updateMeeting('T', '123', req)).toEqual({ providerMeetingId: '123', joinUrl: null });
    expect(f.calls[0]!.method).toBe('PATCH');
    expect(f.calls[0]!.url).toBe('https://api.zoom.us/v2/meetings/123');
    await expect(zoom.deleteMeeting('T', '123')).resolves.toBeUndefined();
  });

  it('reports a meeting somebody deleted as not_found on update, and a stale token as auth', async () => {
    const gone = stubFetch([{ status: 404, body: { code: 3001 } }]);
    await expect(new ZoomAdapter(creds, gone.impl).updateMeeting('T', '1', req)).rejects.toMatchObject({
      kind: 'not_found',
    });
    const stale = stubFetch([{ status: 401, body: { code: 124, message: 'Invalid access token.' } }]);
    await expect(new ZoomAdapter(creds, stale.impl).deleteMeeting('T', '1')).rejects.toMatchObject({
      kind: 'auth',
    });
  });

  it('retries a rate limit once more when it is safe to', async () => {
    process.env.CONFERENCING_RETRIES = '1';
    const f = stubFetch([
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 200, body: { id: 'u1', email: 'Ana@Example.com' } },
    ]);
    expect(await new ZoomAdapter(creds, f.impl).profile('T')).toEqual({ id: 'u1', email: 'ana@example.com' });
    expect(f.calls).toHaveLength(2);
  });
});

describe('Teams adapter (written from Microsoft documentation; not run against a live tenant)', () => {
  it('asks for the online meetings permission and the refresh token', async () => {
    const url = new URL(await new TeamsAdapter(creds).authorizeUrl('S'));
    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    expect(url.searchParams.get('scope')).toBe('offline_access User.Read OnlineMeetings.ReadWrite');
    expect(url.searchParams.get('state')).toBe('S');
  });

  it('reads whether the person kept the permission on the consent screen', () => {
    expect(teamsGrantCovers('User.Read OnlineMeetings.ReadWrite')).toBe(true);
    expect(teamsGrantCovers('user.read onlinemeetings.readwrite')).toBe(true);
    expect(teamsGrantCovers('User.Read')).toBe(false);
    expect(teamsGrantCovers(null)).toBe(false);
  });

  it('creates through createOrGet keyed by the meeting, so a repeat finds the same meeting', async () => {
    const f = stubFetch([{ status: 201, body: { id: 'AAMk', joinWebUrl: 'https://teams.microsoft.com/l/meetup-join/x' } }]);
    const made = await new TeamsAdapter(creds, f.impl).createMeeting('T', req);
    expect(made).toEqual({ providerMeetingId: 'AAMk', joinUrl: 'https://teams.microsoft.com/l/meetup-join/x' });
    const c = f.calls[0]!;
    expect(c.url).toBe('https://graph.microsoft.com/v1.0/me/onlineMeetings/createOrGet');
    expect(JSON.parse(c.body!)).toEqual({
      subject: 'Intro call',
      startDateTime: '2027-02-01T10:00:00.000Z',
      endDateTime: '2027-02-01T10:45:00.000Z',
      externalId: req.meetingKey,
    });
  });

  it('classifies a refused refresh token, and a delete the tenant does not allow', async () => {
    const revoked = stubFetch([
      { status: 400, body: { error: 'invalid_grant', error_description: 'AADSTS70008: expired', error_codes: [70008] } },
    ]);
    await expect(new TeamsAdapter(creds, revoked.impl).refresh('R')).rejects.toMatchObject({
      kind: 'invalid_grant',
    });
    const refused = stubFetch([{ status: 403, body: { error: { code: 'Forbidden' } } }]);
    await expect(new TeamsAdapter(creds, refused.impl).deleteMeeting('T', 'AAMk')).rejects.toMatchObject({
      kind: 'forbidden',
    });
    const gone = stubFetch([{ status: 404, body: { error: { code: 'NotFound' } } }]);
    await expect(new TeamsAdapter(creds, gone.impl).deleteMeeting('T', 'AAMk')).resolves.toBeUndefined();
  });

  it('reads the profile address from mail, else the sign-in name', async () => {
    const f = stubFetch([{ status: 200, body: { id: 'oid', userPrincipalName: 'Ana@Contoso.com' } }]);
    expect(await new TeamsAdapter(creds, f.impl).profile('T')).toEqual({ id: 'oid', email: 'ana@contoso.com' });
  });
});

describe('FakeVideoProvider', () => {
  it('makes and moves rooms, repeats a Teams create for the same key, and fails on demand', async () => {
    const zoom = new FakeVideoProvider('zoom');
    const a = await zoom.createMeeting('t', req);
    const b = await zoom.createMeeting('t', req);
    expect(a.providerMeetingId).not.toBe(b.providerMeetingId);
    const teams = new FakeVideoProvider('teams');
    const x = await teams.createMeeting('t', req);
    expect((await teams.createMeeting('t', req)).providerMeetingId).toBe(x.providerMeetingId);

    await zoom.updateMeeting('t', a.providerMeetingId, { ...req, topic: 'Moved' });
    expect(zoom.rooms.get(a.providerMeetingId)!.request.topic).toBe('Moved');
    await zoom.deleteMeeting('t', a.providerMeetingId);
    await expect(zoom.updateMeeting('t', a.providerMeetingId, req)).rejects.toMatchObject({ kind: 'not_found' });

    zoom.failNext('server', 'create');
    await expect(zoom.createMeeting('t', req)).rejects.toBeInstanceOf(ConferencingError);
    await expect(zoom.createMeeting('t', req)).resolves.toBeTruthy();
  });
});
