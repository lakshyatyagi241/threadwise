import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  sessionResponseSchema,
  impersonationStatusSchema,
  startImpersonationResponseSchema,
  type StartImpersonationResponse,
} from '@crm/contracts';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/**
 * Operator "Login as owner" through HTTP (TW-WSP-032/033): start, the one-time handoff, the act-as token's rules (read-only,
 * forbidden routes, instant stop) and that nothing of the owner's own session or the operator's moves.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const PASSWORD = 'Str0ngPassw0rd#1';
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));
let ipCounter = 10;
const nextIp = () => `10.9.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;

let superToken = '';
let supportToken = '';
let ownerToken = '';
let orgUuid = '';
let orgId = 0;

const start = (token: string, body: Record<string, unknown>) =>
  api().post(`/v2/platform/workspaces/${orgUuid}/impersonate`).set(bearer(token)).send(body);
const codeOf = (s: StartImpersonationResponse) => new URL(s.handoffUrl).searchParams.get('code')!;
const redeem = (code: string) => api().post('/v2/auth/impersonation/redeem').send({ code });

async function startAndRedeem(readOnly: boolean) {
  const res = await start(superToken, { reason: 'Ticket 1234 debug', readOnly });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const started = startImpersonationResponseSchema.parse(res.body);
  const out = await redeem(codeOf(started));
  expect(out.status, JSON.stringify(out.body)).toBe(200);
  return { started, token: out.body.accessToken as string };
}

beforeAll(async () => {
  h = await startHarness();
  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  await api()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: totp(setup.body.secret) });
  superToken = token;
  await h.owner.query(
    `INSERT INTO platform_operators (email, full_name, password_hash, role)
     SELECT 'imp-support@platform.test', 'support operator', password_hash, 'support' FROM platform_operators WHERE email = $1 ON CONFLICT DO NOTHING`,
    [OPERATOR_EMAIL],
  );
  supportToken = (
    await api()
      .post('/v2/platform/auth/login')
      .send({ email: 'imp-support@platform.test', password: OPERATOR_PASSWORD })
  ).body.tokens.accessToken as string;

  const email = `imp${Date.now()}@example.test`;
  const res = await api().post('/v2/auth/signup').set('x-forwarded-for', nextIp()).send({
    orgName: 'Imp Org',
    fullName: 'Owner Person',
    email,
    password: PASSWORD,
    acceptTerms: true,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  ownerToken = res.body.tokens.accessToken as string;
  const row = await h.owner.query(
    `SELECT u.org_id, o.uuid FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.email = $1`,
    [email],
  );
  orgId = Number(row.rows[0].org_id);
  orgUuid = row.rows[0].uuid as string;
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

describe('starting a session', () => {
  it('needs the permission AND the super admin role, and a reason of 8+ characters', async () => {
    expect((await start(supportToken, { reason: 'Ticket 1234 debug' })).status).toBe(403);
    expect((await start(superToken, { reason: 'short' })).status).toBe(422);
    expect(
      (
        await api()
          .post(`/v2/platform/workspaces/${orgUuid}/impersonate`)
          .send({ reason: 'Ticket 1234 debug' })
      ).status,
    ).toBe(401);
    // an ordinary workspace token is not an operator
    expect((await start(ownerToken, { reason: 'Ticket 1234 debug' })).status).toBe(401);
    expect(
      (
        await api()
          .post('/v2/platform/workspaces/00000000-0000-4000-8000-000000000000/impersonate')
          .set(bearer(superToken))
          .send({ reason: 'Ticket 1234 debug' })
      ).status,
    ).toBe(404);
  });
});

describe('the act-as session', () => {
  it('opens the workspace as its owner, shows the banner data, and a second tab or the owner is not affected', async () => {
    const { started, token } = await startAndRedeem(false);

    const session = await api().get('/v2/auth/session').set(bearer(token));
    expect(session.status, JSON.stringify(session.body)).toBe(200);
    // The web shell only accepts a body its own schema parses: a masked permission map (`all` -> `******`) made it treat the act-as
    // session as signed out and bounce the operator to the console.
    const parsedSession = sessionResponseSchema.safeParse(session.body);
    expect(parsedSession.success, JSON.stringify(parsedSession.success ? '' : parsedSession.error.issues)).toBe(true);
    expect(session.body.org.id).toBe(orgUuid);
    // act-as responses mask personal data: the owner's name arrives masked
    expect(session.body.user.fullName).toBe('O*** P***');

    const status = impersonationStatusSchema.parse(
      (await api().get('/v2/auth/impersonation').set(bearer(token))).body,
    );
    expect(status).toMatchObject({
      active: true,
      sessionId: started.sessionId,
      readOnly: false,
      reason: 'Ticket 1234 debug',
    });
    expect(status.operatorName).toBeTruthy();

    // an ordinary session of the same owner sees no banner
    const plain = impersonationStatusSchema.parse(
      (await api().get('/v2/auth/impersonation').set(bearer(ownerToken))).body,
    );
    expect(plain.active).toBe(false);
    // and the owner's own session is intact
    expect((await api().get('/v2/auth/session').set(bearer(ownerToken))).status).toBe(200);

    // a write the owner could make works (as the owner), and the platform-wide trail records the OPERATOR behind it
    const patch = await api()
      .patch('/v2/account/profile')
      .set(bearer(token))
      .send({ displayName: 'Via support' });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    const ev = await h.owner.query(
      `SELECT actor_type FROM security_events WHERE payload -> 'impersonation' ->> 'sessionId' = $1`,
      [started.sessionId],
    );
    expect(ev.rows.length).toBeGreaterThan(0);
    expect(ev.rows.every((r) => r.actor_type === 'platform_operator')).toBe(true);
    const trail = await h.owner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND delta -> '_impersonatedBy' -> 'new' ->> 'sessionId' = $2`,
      [orgId, started.sessionId],
    );
    expect(trail.rows[0].n).toBeGreaterThan(0);
  });

  it('refuses the owner-only routes with WSP_IMPERSONATION_FORBIDDEN, and the operator console is not reachable from it', async () => {
    const { token } = await startAndRedeem(false);
    for (const [method, path] of [
      ['post', '/v2/account/password'],
      ['post', '/v2/account/mfa/disable'],
      ['get', '/v2/account/sessions'],
      ['get', '/v2/developer/keys'],
      ['delete', '/v2/account'],
    ] as const) {
      const res = await api()[method](path).set(bearer(token)).send({});
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.code, `${method} ${path}`).toBe('WSP_IMPERSONATION_FORBIDDEN');
    }
    const console_ = await api().get('/v2/platform/auth/session').set(bearer(token));
    expect(console_.status).toBeGreaterThanOrEqual(401);
    expect(console_.status).toBeLessThan(500);
  });

  it('a read-only session can look and cannot write, and can still stop', async () => {
    const { token } = await startAndRedeem(true);
    expect((await api().get('/v2/auth/session').set(bearer(token))).status).toBe(200);
    const write = await api()
      .patch('/v2/account/profile')
      .set(bearer(token))
      .send({ displayName: 'nope' });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('WSP_IMPERSONATION_READ_ONLY');
    expect(
      impersonationStatusSchema.parse(
        (await api().get('/v2/auth/impersonation').set(bearer(token))).body,
      ).readOnly,
    ).toBe(true);
    const stop = await api().post('/v2/auth/impersonation/stop').set(bearer(token));
    expect(stop.status, JSON.stringify(stop.body)).toBe(200);
    expect(stop.body.returnUrl).toMatch(/\/admin\/workspaces$/);
  });

  it('stop ends it at once: the token fails, the audit summary exists, the operator and the owner keep their sessions', async () => {
    const { started, token } = await startAndRedeem(false);
    await api()
      .patch('/v2/account/profile')
      .set(bearer(token))
      .send({ displayName: 'Before stop' });
    const stop = await api().post('/v2/auth/impersonation/stop').set(bearer(token));
    expect(stop.status).toBe(200);

    const after = await api().get('/v2/auth/session').set(bearer(token));
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('WSP_IMPERSONATION_ENDED');

    const row = (
      await h.owner.query(`SELECT ended_by, ended_at FROM impersonation_sessions WHERE uuid = $1`, [
        started.sessionId,
      ])
    ).rows[0];
    expect(row.ended_by).toBe('operator');
    const summary = await h.owner.query(
      `SELECT payload FROM security_events WHERE event = 'platform.impersonation.stopped' AND payload ->> 'sessionId' = $1`,
      [started.sessionId],
    );
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].payload.endedBy).toBe('operator');
    expect(summary.rows[0].payload.totalEvents).toBeGreaterThanOrEqual(0);

    expect((await api().get('/v2/platform/auth/session').set(bearer(superToken))).status).toBe(200);
    expect((await api().get('/v2/auth/session').set(bearer(ownerToken))).status).toBe(200);
  });

  it('the handoff code works once, and starting a second session ends the first token', async () => {
    const res = await start(superToken, { reason: 'Ticket 1234 debug' });
    const code = codeOf(startImpersonationResponseSchema.parse(res.body));
    expect((await redeem(code)).status).toBe(200);
    const again = await redeem(code);
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('WSP_IMPERSONATION_CODE_INVALID');

    const first = await startAndRedeem(false);
    const second = await startAndRedeem(false);
    const old = await api().get('/v2/auth/session').set(bearer(first.token));
    expect(old.status).toBe(401);
    expect(old.body.code).toBe('WSP_IMPERSONATION_ENDED');
    expect((await api().get('/v2/auth/session').set(bearer(second.token))).status).toBe(200);
  });

  it('stop from an ordinary session changes nothing', async () => {
    const stop = await api().post('/v2/auth/impersonation/stop').set(bearer(ownerToken));
    expect(stop.status).toBe(200);
    expect((await api().get('/v2/auth/session').set(bearer(ownerToken))).status).toBe(200);
  });
});
