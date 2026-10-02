import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { navLayoutResponseSchema, NAV_LAYOUT_DEFAULT_BAR } from '@crm/contracts';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/** WD-ASHELL-009 end to end: operator editor, customer read, permissions and audit. */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
let superToken = '';
let supportToken = '';
let userToken = '';

beforeAll(async () => {
  h = await startHarness();
  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  const code = hotp(base32Decode(setup.body.secret), totpStep(Date.now()));
  await api().post('/v2/platform/auth/mfa/enable').set(bearer(token)).send({ code });
  superToken = token;
  const sup = await api()
    .post('/v2/platform/auth/login')
    .send({ email: 'support@platform.test', password: OPERATOR_PASSWORD });
  supportToken = sup.body.tokens.accessToken as string;
  const signup = await api()
    .post('/v2/auth/signup')
    .set('x-forwarded-for', '10.9.0.1')
    .send({
      orgName: 'Shell Org',
      fullName: 'Shell Person',
      email: `shell${Date.now()}@example.test`,
      password: 'Str0ngPassw0rd#1',
      acceptTerms: true,
    });
  expect(signup.status, JSON.stringify(signup.body)).toBe(201);
  userToken = signup.body.tokens.accessToken as string;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('top-bar layout API', () => {
  it('requires a sign-in on both the customer and the operator route', async () => {
    expect((await api().get('/v2/shell/nav-layout')).status).toBe(401);
    expect((await api().get('/v2/platform/shell/nav-layout')).status).toBe(401);
  });

  it('serves the default bar to a customer on a fresh install', async () => {
    const res = await api().get('/v2/shell/nav-layout').set(bearer(userToken));
    expect(res.status).toBe(200);
    expect(navLayoutResponseSchema.parse(res.body)).toMatchObject({ isDefault: true });
    expect(res.body.bar).toEqual([...NAV_LAYOUT_DEFAULT_BAR]);
  });

  it('keeps a customer token out of the operator editor and an operator token out of the customer route', async () => {
    const asUser = await api().get('/v2/platform/shell/nav-layout').set(bearer(userToken));
    expect([401, 403]).toContain(asUser.status);
    const asOperator = await api().get('/v2/shell/nav-layout').set(bearer(superToken));
    expect([401, 403]).toContain(asOperator.status);
  });

  it('a support operator can read but not save or reset', async () => {
    const read = await api().get('/v2/platform/shell/nav-layout').set(bearer(supportToken));
    expect(read.status).toBe(200);
    const put = await api()
      .put('/v2/platform/shell/nav-layout')
      .set(bearer(supportToken))
      .send({ bar: ['flows'] });
    expect(put.status).toBe(403);
    const reset = await api().post('/v2/platform/shell/nav-layout/reset').set(bearer(supportToken));
    expect(reset.status).toBe(403);
  });

  it('a super admin save drops unknown keys, keeps "more", reaches customers and is audited', async () => {
    const auditRows = async () =>
      (
        await h.owner.query(
          `SELECT actor_type FROM security_events WHERE event = 'platform.shell.nav_layout_saved'`,
        )
      ).rows;
    const before = (await auditRows()).length;
    const put = await api()
      .put('/v2/platform/shell/nav-layout')
      .set(bearer(superToken))
      .send({ bar: ['flows', 'nope', 'dashboard', 'broadcasts'] });
    expect(put.status).toBe(200);
    expect(put.body.bar).toEqual(['flows', 'dashboard', 'broadcasts', 'more']);
    expect(put.body.more).not.toContain('broadcasts');
    expect(put.body.isDefault).toBe(false);

    const seen = await api().get('/v2/shell/nav-layout').set(bearer(userToken));
    expect(seen.body.bar).toEqual(['flows', 'dashboard', 'broadcasts', 'more']);

    const after = await auditRows();
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)!.actor_type).toBe('platform_operator');
  });

  it('rejects a body that is not a list', async () => {
    const res = await api()
      .put('/v2/platform/shell/nav-layout')
      .set(bearer(superToken))
      .send({ bar: 'flows' });
    expect(res.status).toBe(422);
  });

  it('reset restores the default bar', async () => {
    const res = await api().post('/v2/platform/shell/nav-layout/reset').set(bearer(superToken));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ isDefault: true, bar: [...NAV_LAYOUT_DEFAULT_BAR] });
    const seen = await api().get('/v2/shell/nav-layout').set(bearer(userToken));
    expect(seen.body.isDefault).toBe(true);
  });
});
