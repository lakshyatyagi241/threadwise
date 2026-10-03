import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  setupBootstrapResponseSchema,
  setupStatusResponseSchema,
  systemStatusResponseSchema,
} from '@crm/contracts';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { SETUP_TOKEN, startHarness, type Harness } from './harness';

/**
 * First-run setup and the operator System page through HTTP, against a database that starts as a fresh deployment
 * would: migrated, with no operator, organization or plan. Tests run in order and reset the platform between the
 * phases that need an open lock.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

const OWNER_PASSWORD = 'Tr1cky-Passphrase!42';
const body = (over: Record<string, unknown> = {}, org: Record<string, unknown> = {}) => ({
  setupToken: SETUP_TOKEN,
  operator: { fullName: 'Asha Rao', email: 'owner@acme.test', password: OWNER_PASSWORD, ...over },
  organization: { name: 'Acme Ltd', slug: 'acme', timezone: 'Asia/Kolkata', locale: 'en', ...org },
});

const count = async (table: string) =>
  Number((await h.owner.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);

/** Back to a fresh deployment: no operator, organization (cascades to every tenant row) or lock. */
async function resetPlatform() {
  await h.owner.query('DELETE FROM platform_sessions');
  await h.owner.query('DELETE FROM platform_setup');
  await h.owner.query('DELETE FROM platform_operators');
  await h.owner.query('DELETE FROM organizations');
  await h.owner.query(`DELETE FROM security_events WHERE event = 'platform.setup.completed'`);
  await h.owner.query(`DELETE FROM event_outbox WHERE event_type = 'platform.setup_completed'`);
}

beforeAll(async () => {
  h = await startHarness();
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('status and token (WD-INST-001, -004)', () => {
  it('reports an open lock, a configured token and ready prerequisites on a fresh deployment', async () => {
    const res = await api().get('/v2/setup/status');
    expect(res.status).toBe(200);
    const status = setupStatusResponseSchema.parse(res.body);
    expect(status).toMatchObject({ state: 'open', tokenConfigured: true, completedAt: null });
    expect(status.prerequisites).toEqual([
      { key: 'database', ok: true },
      { key: 'migrations', ok: true },
      { key: 'permissions', ok: true },
    ]);
  });

  it('refuses a wrong token and accepts the right one', async () => {
    const wrong = await api()
      .post('/v2/setup/verify-token')
      .send({ setupToken: 'x'.repeat(40) });
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe(ERROR_CODES.SETUP_TOKEN_INVALID);

    const short = await api().post('/v2/setup/verify-token').send({ setupToken: 'short' });
    expect(short.status).toBe(422);

    const ok = await api().post('/v2/setup/verify-token').send({ setupToken: SETUP_TOKEN });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });
  });
});

describe('bootstrap refusals create nothing (WD-INST-003 quirk: the gate is the write, not the page)', () => {
  it('rejects a wrong token even though everything else is valid', async () => {
    const res = await api()
      .post('/v2/setup/bootstrap')
      .send({ ...body(), setupToken: 'y'.repeat(40) });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ERROR_CODES.SETUP_TOKEN_INVALID);
    expect(await count('platform_operators')).toBe(0);
    expect(await count('organizations')).toBe(0);
  });

  it('rejects a weak password, an unknown timezone and a bad slug with field paths', async () => {
    const res = await api()
      .post('/v2/setup/bootstrap')
      .send(body({ password: 'weakpass' }, { timezone: 'Mars/Olympus', slug: '!!' }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    const paths = (res.body.errors as Array<{ path: string }>).map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining(['operator.password', 'organization.timezone', 'organization.slug']),
    );
    expect(await count('platform_operators')).toBe(0);
    expect(await count('organizations')).toBe(0);
  });

  it('rejects a password built from the person details', async () => {
    const res = await api()
      .post('/v2/setup/bootstrap')
      .send(body({ password: 'Asha-Rao-Is-Great-2026!' }));
    expect(res.status).toBe(422);
  });
});

describe('the lock under a race (WD-INST-015)', () => {
  it('lets exactly one of two simultaneous bootstraps win and leaves one operator and one organization', async () => {
    const [a, b] = await Promise.all([
      api()
        .post('/v2/setup/bootstrap')
        .send(
          body({ email: 'a@acme.test', fullName: 'Alice Wong' }, { slug: 'org-a', name: 'Org A' }),
        ),
      api()
        .post('/v2/setup/bootstrap')
        .send(
          body({ email: 'b@acme.test', fullName: 'Bruno Silva' }, { slug: 'org-b', name: 'Org B' }),
        ),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.code).toBe(ERROR_CODES.SETUP_ALREADY_COMPLETED);

    expect(await count('platform_operators')).toBe(1);
    expect(await count('organizations')).toBe(1);
    expect(await count('platform_setup')).toBe(1);
    // the loser's org rolled back with it: no stray users, roles or audit rows
    expect(await count('users')).toBe(1);
    expect(await count('roles')).toBe(5); // the Owner, Admin, Manager, Agent and Viewer presets
    await resetPlatform();
  });
});

describe('a successful bootstrap (WD-INST-008, -013, -014, -015)', () => {
  let result: ReturnType<typeof setupBootstrapResponseSchema.parse>;

  it('creates the operator, the organization and its admin, and locks setup, in one go', async () => {
    const res = await api().post('/v2/setup/bootstrap').send(body());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    result = setupBootstrapResponseSchema.parse(res.body);
    expect(result.organization).toMatchObject({ slug: 'acme', name: 'Acme Ltd' });
    expect(result.operator.email).toBe('owner@acme.test');

    const op = (
      await h.owner.query(
        `SELECT uuid, role, status, password_hash, mfa_enabled FROM platform_operators WHERE email = 'owner@acme.test'`,
      )
    ).rows;
    expect(op).toHaveLength(1);
    expect(op[0]).toMatchObject({
      uuid: result.operator.id,
      role: 'super_admin',
      status: 'active',
    });
    // hashed, never the plaintext, and not yet enrolled in MFA
    expect(op[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(op[0].password_hash).not.toContain(OWNER_PASSWORD);
    expect(op[0].mfa_enabled).toBe(false);

    const org = (
      await h.owner.query(`SELECT id, uuid, settings FROM organizations WHERE slug = 'acme'`)
    ).rows[0];
    expect(org.uuid).toBe(result.organization.id);
    expect(org.settings).toMatchObject({ onboardingStep: 'done', timezone: 'Asia/Kolkata' });

    // the org admin holds every capability key (a locked-out first admin is the failure WD-INST-013 guards against)
    const grants = await h.owner.query(
      `SELECT count(*)::int AS granted, (SELECT count(*)::int FROM permission_defs) AS total
         FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id
        WHERE g.org_id = $1 AND r.system_key = 'admin'`,
      [org.id],
    );
    expect(grants.rows[0].granted).toBe(grants.rows[0].total);
    expect(grants.rows[0].total).toBeGreaterThan(0);

    const lock = (
      await h.owner.query(
        `SELECT completed_at, completed_version, first_org_id, first_operator_id, app_url FROM platform_setup`,
      )
    ).rows;
    expect(lock).toHaveLength(1);
    expect(lock[0].completed_version).toMatch(/^\d+\.\d+\.\d+/);
    expect(lock[0].first_org_id).toBe(org.id);
    expect(lock[0].app_url).toBe('http://localhost:3001');
    expect(new Date(lock[0].completed_at).toISOString()).toBe(result.completedAt);
  });

  it('wrote the audit trail and the outbox event in the same transaction (CONTRIBUTING rule 6)', async () => {
    const audit = await h.owner.query(
      `SELECT status, payload FROM security_events WHERE event = 'platform.setup.completed'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].status).toBe('success');
    expect(audit.rows[0].payload).toMatchObject({ operatorId: result.operator.id });
    // no secret, token or password reaches the audit payload
    expect(JSON.stringify(audit.rows[0].payload)).not.toContain(OWNER_PASSWORD);
    expect(JSON.stringify(audit.rows[0].payload)).not.toContain(SETUP_TOKEN);

    const outbox = await h.owner.query(
      `SELECT payload FROM event_outbox WHERE event_type = 'platform.setup_completed'`,
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0].payload).toMatchObject({
      orgUuid: result.organization.id,
      operatorUuid: result.operator.id,
    });
  });

  it('is unreachable afterwards: every setup route answers 409 and status reports completed', async () => {
    const again = await api()
      .post('/v2/setup/bootstrap')
      .send(body({}, { slug: 'second' }));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe(ERROR_CODES.SETUP_ALREADY_COMPLETED);
    // even a wrong token learns nothing more than "completed"
    const wrongToken = await api()
      .post('/v2/setup/bootstrap')
      .send({ ...body(), setupToken: 'z'.repeat(40) });
    expect(wrongToken.status).toBe(409);
    const verify = await api().post('/v2/setup/verify-token').send({ setupToken: SETUP_TOKEN });
    expect(verify.status).toBe(409);

    const status = setupStatusResponseSchema.parse((await api().get('/v2/setup/status')).body);
    expect(status).toMatchObject({ state: 'completed', prerequisites: [] });
    expect(status.completedAt).toBe(result.completedAt);
    expect(await count('organizations')).toBe(1);
    expect(await count('platform_operators')).toBe(1);
  });

  it('gives the new owner a working workspace login', async () => {
    const login = await api()
      .post('/v2/auth/login')
      .set('x-forwarded-for', '10.9.0.1')
      .send({ orgSlug: 'acme', email: 'owner@acme.test', password: OWNER_PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBe(201);
    expect(login.body).toMatchObject({ status: 'authenticated', orgSlug: 'acme' });
    // the setup token proved control of the deployment, so there is no verification gate or onboarding step
    expect(login.body.landing).toBe('dashboard');
  });

  it('gives the new owner a platform login that must enrol MFA, then reads the System page', async () => {
    const first = await api()
      .post('/v2/platform/auth/login')
      .send({ email: 'owner@acme.test', password: OWNER_PASSWORD });
    expect(first.body).toMatchObject({ status: 'authenticated', mfaEnrolmentRequired: true });
    const token = first.body.tokens.accessToken as string;

    // gated until MFA is enrolled
    const gated = await api().get('/v2/platform/system').set(bearer(token));
    expect(gated.status).toBe(403);
    expect(gated.body.code).toBe(ERROR_CODES.AUTH_MFA_ENROLMENT_REQUIRED);

    const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
    const enabled = await api()
      .post('/v2/platform/auth/mfa/enable')
      .set(bearer(token))
      .send({ code: hotp(base32Decode(setup.body.secret), totpStep(Date.now())) });
    expect(enabled.status).toBe(201);

    const res = await api().get('/v2/platform/system').set(bearer(token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sys = systemStatusResponseSchema.parse(res.body);
    expect(sys.release).toMatchObject({
      gitSha: 'deadbee',
      buildNumber: '7',
      environment: 'test',
      demoMode: false,
    });
    expect(sys.release.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(sys.setup).toMatchObject({ state: 'completed' });
    expect(sys.migrations.status).toBe('current');
    expect(sys.migrations.rows.every((r) => r.state === 'applied')).toBe(true);
    expect(sys.migrations.appliedCount).toBe(sys.migrations.rows.length);
    expect(sys.checks.map((c) => [c.key, c.status])).toEqual([
      ['database', 'up'],
      ['redis', 'up'],
      ['migrations', 'up'],
    ]);
  });

  it('keeps the System page behind the operator pool', async () => {
    expect((await api().get('/v2/platform/system')).status).toBe(401);
    const tenant = await api()
      .post('/v2/auth/login')
      .set('x-forwarded-for', '10.9.0.2')
      .send({ orgSlug: 'acme', email: 'owner@acme.test', password: OWNER_PASSWORD });
    const res = await api()
      .get('/v2/platform/system')
      .set(bearer(tenant.body.tokens.accessToken as string));
    expect([401, 403]).toContain(res.status);
  });

  it('shows a support operator the same read-only page (no role restriction on reads)', async () => {
    await h.owner.query(
      `INSERT INTO platform_operators (email, full_name, password_hash, role)
       SELECT 'support@acme.test', 'Support', password_hash, 'support' FROM platform_operators WHERE email = 'owner@acme.test'`,
    );
    const login = await api()
      .post('/v2/platform/auth/login')
      .send({ email: 'support@acme.test', password: OWNER_PASSWORD });
    expect(login.body.status).toBe('authenticated');
    const res = await api()
      .get('/v2/platform/system')
      .set(bearer(login.body.tokens.accessToken as string));
    expect(res.status).toBe(200);
  });
});

describe('an existing platform is never re-opened (WD-INST-001: guard on state, not on a file)', () => {
  it('treats an environment that already has an operator as completed, with no lock row', async () => {
    await resetPlatform();
    await h.owner.query(
      `INSERT INTO platform_operators (email, full_name, password_hash, role) VALUES ('cli@ops.test', 'CLI', 'x', 'super_admin')`,
    );
    const status = setupStatusResponseSchema.parse((await api().get('/v2/setup/status')).body);
    expect(status.state).toBe('completed');
    expect(status.completedAt).toBeNull();

    const res = await api().post('/v2/setup/bootstrap').send(body());
    expect(res.status).toBe(409);
    expect(await count('organizations')).toBe(0);
  });
});

describe('prerequisites (WD-INST-004, -012, -013)', () => {
  it('refuses to bootstrap while a migration is pending, and says which prerequisite failed', async () => {
    await resetPlatform();
    const id = '20261003090000_inst_platform_setup';
    const saved = (await h.owner.query('SELECT * FROM _migrations WHERE id = $1', [id])).rows[0];
    await h.owner.query('DELETE FROM _migrations WHERE id = $1', [id]);
    try {
      const status = setupStatusResponseSchema.parse((await api().get('/v2/setup/status')).body);
      expect(status.prerequisites.find((p) => p.key === 'migrations')).toMatchObject({ ok: false });

      const res = await api().post('/v2/setup/bootstrap').send(body());
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ERROR_CODES.SETUP_PREREQUISITES_FAILED);
      expect((res.body.errors as Array<{ path: string }>).map((e) => e.path)).toEqual([
        'migrations',
      ]);
      expect(await count('organizations')).toBe(0);
    } finally {
      await h.owner.query(
        'INSERT INTO _migrations (id, checksum, applied_at, duration_ms) VALUES ($1, $2, $3, $4)',
        [saved.id, saved.checksum, saved.applied_at, saved.duration_ms],
      );
    }
  });

  it('refuses to bootstrap when no capability keys are seeded (the admin would be locked out)', async () => {
    await resetPlatform();
    await h.owner.query('CREATE TABLE _pd_backup AS SELECT * FROM permission_defs');
    await h.owner.query('DELETE FROM permission_defs');
    try {
      const res = await api().post('/v2/setup/bootstrap').send(body());
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ERROR_CODES.SETUP_PREREQUISITES_FAILED);
      expect((res.body.errors as Array<{ path: string }>).map((e) => e.path)).toEqual([
        'permissions',
      ]);
    } finally {
      await h.owner.query('INSERT INTO permission_defs SELECT * FROM _pd_backup');
      await h.owner.query('DROP TABLE _pd_backup');
    }
  });

  it('then succeeds once the prerequisites hold again', async () => {
    const res = await api().post('/v2/setup/bootstrap').send(body());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});
