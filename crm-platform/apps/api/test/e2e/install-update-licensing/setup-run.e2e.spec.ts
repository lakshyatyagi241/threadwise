import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  setupDatabaseDefaultsResponseSchema,
  setupRequirementsResponseSchema,
  setupRunResponseSchema,
  setupStatusResponseSchema,
  systemStatusResponseSchema,
} from '@crm/contracts';
import { apiDatabase, bearer, operatorToken } from './helpers';
import { SETUP_TOKEN, startHarness, type Harness } from './harness';

/**
 * The install wizard's server side (WD-INST-004 to -011): requirements, database test, the six-step run with its
 * order and idempotency, the Node bridge and application settings it saves, and the Updater's licence card when no
 * licence is enforced. A fresh deployment: migrated, no operator, organization or plan.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());

const PASSWORD = 'Tr1cky-Passphrase!42';
const NODE_TOKEN = 'f'.repeat(64);
const form = (over: Record<string, unknown> = {}) => ({
  setupToken: SETUP_TOKEN,
  app: { name: 'Acme Desk', url: 'https://app.acme.test' },
  node: { serverUrl: 'http://localhost:8888', port: 8888, token: NODE_TOKEN },
  operator: { fullName: 'Asha Rao', email: 'owner@acme.test', password: PASSWORD },
  organization: { name: 'Acme Ltd', slug: 'acme', timezone: 'Asia/Kolkata', locale: 'hi' },
  ...over,
});
const run = (step: number, over: Record<string, unknown> = {}) =>
  api()
    .post('/v2/setup/run')
    .send({ ...form(over), step });

const count = async (table: string) =>
  Number((await h.owner.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
const setting = async (key: string) =>
  (await h.owner.query('SELECT value, is_secret FROM platform_settings WHERE key = $1', [key]))
    .rows[0] as { value: unknown; is_secret: boolean } | undefined;

async function resetPlatform() {
  await h.owner.query('DELETE FROM platform_sessions');
  await h.owner.query('DELETE FROM platform_setup');
  await h.owner.query('DELETE FROM platform_operators');
  await h.owner.query('DELETE FROM organizations');
  await h.owner.query(`DELETE FROM platform_settings WHERE key LIKE 'inst.%' OR key LIKE 'set.%'`);
  await h.owner.query(`DELETE FROM security_events WHERE event LIKE 'platform.setup.%'`);
  await h.owner.query(`DELETE FROM event_outbox WHERE event_type = 'platform.setup_completed'`);
}

beforeAll(async () => {
  h = await startHarness();
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('status (WD-INST-001, -002)', () => {
  it('reports the lock, that no licence is enforced by default, the progress and the version', async () => {
    const status = setupStatusResponseSchema.parse((await api().get('/v2/setup/status')).body);
    expect(status).toMatchObject({ state: 'open', licenceRequired: false, runStep: 0 });
    expect(status.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('requirements (WD-INST-004)', () => {
  it('needs the setup token: a wrong one is refused and nothing about the server is revealed', async () => {
    const res = await api()
      .post('/v2/setup/requirements')
      .send({ setupToken: 'x'.repeat(40) });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ERROR_CODES.SETUP_TOKEN_INVALID);
    expect(JSON.stringify(res.body)).not.toMatch(/\d+\.\d+\.\d+/);
  });

  it('reports the runtime, native modules, services, directories and database like WaDesk’s five panels', async () => {
    const res = await api().post('/v2/setup/requirements').send({ setupToken: SETUP_TOKEN });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = setupRequirementsResponseSchema.parse(res.body);
    expect(r.runtime).toMatchObject({
      version: process.version.slice(1),
      required: '22',
      ok: true,
    });
    expect(r.modules.length).toBeGreaterThanOrEqual(8);
    expect(r.modules.every((m) => m.ok)).toBe(true);
    expect(r.services.map((s) => s.key)).toEqual([
      'database',
      'redis',
      'migrations',
      'permissions',
    ]);
    expect(r.directories.map((d) => d.key)).toEqual(['temp', 'migrations']);
    expect(r.database).toMatchObject({ engine: 'postgresql', ok: true });
    expect(r.database.version).toMatch(/^16\./);
    expect(r.database.extensions).toEqual(
      expect.arrayContaining(['citext', 'pg_trgm', 'pgcrypto', 'vector']),
    );
    expect(r.allPassed).toBe(true);
  });

  it('turns a failing check into allPassed=false (the Continue button stays disabled)', async () => {
    await h.owner.query('CREATE TABLE _pd_backup AS SELECT * FROM permission_defs');
    await h.owner.query('DELETE FROM permission_defs');
    try {
      const r = setupRequirementsResponseSchema.parse(
        (await api().post('/v2/setup/requirements').send({ setupToken: SETUP_TOKEN })).body,
      );
      expect(r.allPassed).toBe(false);
      expect(r.services.find((s) => s.key === 'permissions')).toEqual({
        key: 'permissions',
        ok: false,
      });
    } finally {
      await h.owner.query('INSERT INTO permission_defs SELECT * FROM _pd_backup');
      await h.owner.query('DROP TABLE _pd_backup');
    }
  });
});

describe('database step (WD-INST-005, -006)', () => {
  it('starts from this deployment’s own connection and never sends its password', async () => {
    const res = await api().post('/v2/setup/database-defaults').send({ setupToken: SETUP_TOKEN });
    expect(res.status).toBe(200);
    expect(setupDatabaseDefaultsResponseSchema.parse(res.body)).toEqual(apiDatabase());
    expect(JSON.stringify(res.body)).not.toContain('test');
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it('reports "Connection successful." for the deployment’s database, with a blank password', async () => {
    const res = await api()
      .post('/v2/setup/test-database')
      .send({ setupToken: SETUP_TOKEN, ...apiDatabase() });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Connection successful.' });
  });

  it('succeeds with an explicit correct password too', async () => {
    const res = await api()
      .post('/v2/setup/test-database')
      .send({ setupToken: SETUP_TOKEN, ...apiDatabase(), password: 'test' });
    expect(res.status).toBe(200);
  });

  it('answers 422 with the server’s own message on a wrong password and stops there', async () => {
    const res = await api()
      .post('/v2/setup/test-database')
      .send({ setupToken: SETUP_TOKEN, ...apiDatabase(), password: 'not-the-password' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(ERROR_CODES.SETUP_DATABASE_TEST_FAILED);
    expect(res.body.detail ?? res.body.message).toMatch(/password authentication failed/i);
    expect(res.body.errors).toEqual([{ path: 'reason', message: 'server' }]);
  });

  it('shows the server message for a database that does not exist', async () => {
    const res = await api()
      .post('/v2/setup/test-database')
      .send({
        setupToken: SETUP_TOKEN,
        ...apiDatabase(),
        database: 'no_such_db',
        password: 'test',
      });
    expect(res.status).toBe(422);
    expect(res.body.detail ?? res.body.message).toMatch(/does not exist/i);
  });

  it('collapses transport failures into one hint after trying every route', async () => {
    const res = await api()
      .post('/v2/setup/test-database')
      .send({
        setupToken: SETUP_TOKEN,
        ...apiDatabase(),
        host: '127.0.0.1',
        port: 1,
        password: 'test',
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(ERROR_CODES.SETUP_DATABASE_TEST_FAILED);
    expect(res.body.errors).toEqual([{ path: 'reason', message: 'unreachable' }]);
  });

  it('validates the fields and needs the token', async () => {
    const missing = await api()
      .post('/v2/setup/test-database')
      .send({ setupToken: SETUP_TOKEN, ...apiDatabase(), database: '' });
    expect(missing.status).toBe(422);
    const badToken = await api()
      .post('/v2/setup/test-database')
      .send({ setupToken: 'q'.repeat(40), ...apiDatabase() });
    expect(badToken.status).toBe(403);
  });
});

describe('the install run (WD-INST-010, -011)', () => {
  it('refuses a step before the one it depends on, whatever the page showed', async () => {
    const res = await run(4);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ERROR_CODES.SETUP_STEP_OUT_OF_ORDER);
    expect(await count('platform_operators')).toBe(0);
    expect(await count('organizations')).toBe(0);
  });

  it('runs the six steps in order, recording progress, and creates nothing until step 4', async () => {
    for (const step of [1, 2, 3]) {
      const res = await run(step);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(setupRunResponseSchema.parse(res.body)).toMatchObject({ step, ok: true });
    }
    expect(await count('platform_operators')).toBe(0);
    let status = setupStatusResponseSchema.parse((await api().get('/v2/setup/status')).body);
    expect(status).toMatchObject({ state: 'open', runStep: 3 });

    expect((await run(4)).status).toBe(200);
    expect(await count('platform_operators')).toBe(1);
    expect(await count('organizations')).toBe(1);
    // created, but not locked: the run can still be retried, and the platform is not yet "completed"
    status = setupStatusResponseSchema.parse((await api().get('/v2/setup/status')).body);
    expect(status).toMatchObject({ state: 'open', runStep: 4 });
    expect((await run(5)).status).toBe(200);
  });

  it('keeps one workspace when a step is repeated or the run starts over (WaDesk made a second one)', async () => {
    for (const step of [1, 2, 3, 4, 5]) expect((await run(step)).status).toBe(200);
    expect(await count('platform_operators')).toBe(1);
    expect(await count('organizations')).toBe(1);
    expect(await count('users')).toBe(1);
  });

  it('saved the Node bridge: URL and port as a setting, the shared token sealed', async () => {
    expect((await setting('inst.node_bridge'))?.value).toEqual({
      serverUrl: 'http://localhost:8888',
      port: 8888,
    });
    const sealed = await setting('inst.node_bridge.token');
    expect(sealed?.is_secret).toBe(true);
    expect(JSON.stringify(sealed?.value)).not.toContain(NODE_TOKEN);
  });

  it('finalizes: locks setup, applies the application settings, audits and emits once', async () => {
    const res = await run(6);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const done = setupRunResponseSchema.parse(res.body);
    expect(done.result?.organization).toMatchObject({ slug: 'acme', name: 'Acme Ltd' });
    expect(done.result?.operator.email).toBe('owner@acme.test');

    const general = (await setting('set.general'))?.value as Record<string, unknown>;
    expect(general).toMatchObject({
      appName: 'Acme Desk',
      appUrl: 'https://app.acme.test',
      defaultTimezone: 'Asia/Kolkata',
      defaultLanguage: 'hi',
    });
    const lock = (await h.owner.query('SELECT completed_at, run_step, app_url FROM platform_setup'))
      .rows[0];
    expect(lock.run_step).toBe(6);
    expect(lock.app_url).toBe('https://app.acme.test');
    expect(new Date(lock.completed_at).toISOString()).toBe(done.result?.completedAt);

    expect(await count(`security_events WHERE event = 'platform.setup.provisioned'`)).toBe(1);
    expect(await count(`security_events WHERE event = 'platform.setup.completed'`)).toBe(1);
    expect(await count(`event_outbox WHERE event_type = 'platform.setup_completed'`)).toBe(1);
  });

  it('is closed afterwards: every run step, the requirements and the database test answer 409', async () => {
    for (const step of [1, 4, 6]) {
      const res = await run(step);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe(ERROR_CODES.SETUP_ALREADY_COMPLETED);
    }
    expect(
      (await api().post('/v2/setup/requirements').send({ setupToken: SETUP_TOKEN })).status,
    ).toBe(409);
    expect(
      (
        await api()
          .post('/v2/setup/test-database')
          .send({ setupToken: SETUP_TOKEN, ...apiDatabase() })
      ).status,
    ).toBe(409);
    expect(
      (await api().post('/v2/setup/database-defaults').send({ setupToken: SETUP_TOKEN })).status,
    ).toBe(409);
    expect(await count('organizations')).toBe(1);
  });
});

describe('run refusals create nothing (WD-INST-010 quirks: no step order, no state check)', () => {
  it('rejects a wrong token, a weak password and a bad node port before any step runs', async () => {
    await resetPlatform();
    const wrong = await run(1, { setupToken: 'y'.repeat(40) });
    expect(wrong.status).toBe(403);

    const weak = await run(1, {
      operator: { fullName: 'Asha Rao', email: 'owner@acme.test', password: 'weakpass' },
    });
    expect(weak.status).toBe(422);

    const port = await run(1, {
      node: { serverUrl: 'http://localhost:8888', port: 70000, token: NODE_TOKEN },
    });
    expect(port.status).toBe(422);
    expect((port.body.errors as Array<{ path: string }>).map((e) => e.path)).toContain('node.port');

    const shortToken = await run(1, {
      node: { serverUrl: 'http://localhost:8888', port: 8888, token: 'short' },
    });
    expect(shortToken.status).toBe(422);

    const url = await run(1, { app: { name: 'Acme', url: 'app.acme.test' } });
    expect(url.status).toBe(422);
    expect((url.body.errors as Array<{ path: string }>).map((e) => e.path)).toContain('app.url');

    const longName = await run(1, { app: { name: 'x'.repeat(101), url: 'https://app.acme.test' } });
    expect(longName.status).toBe(422);

    expect(await setting('inst.node_bridge')).toBeUndefined();
    expect(await count('platform_setup')).toBe(0);
  });

  it('stops at step 1 while a requirement fails, and says which one', async () => {
    await h.owner.query('CREATE TABLE _pd_backup AS SELECT * FROM permission_defs');
    await h.owner.query('DELETE FROM permission_defs');
    try {
      const res = await run(1);
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

  it('treats an operator made outside the run (the CLI) as the end of setup, even mid-run', async () => {
    expect((await run(1)).status).toBe(200);
    await h.owner.query(
      `INSERT INTO platform_operators (email, full_name, password_hash, role) VALUES ('cli@ops.test', 'CLI', 'x', 'super_admin')`,
    );
    const res = await run(2);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(ERROR_CODES.SETUP_ALREADY_COMPLETED);
    expect(await count('organizations')).toBe(0);
  });
});

describe('the Updater page with no licence enforced (WD-INST-019, -020, -025)', () => {
  it('shows the licence card as not required, and refuses to verify a code nobody asked for', async () => {
    await resetPlatform();
    const res = await api()
      .post('/v2/setup/bootstrap')
      .send({
        setupToken: SETUP_TOKEN,
        operator: { fullName: 'Asha Rao', email: 'owner@acme.test', password: PASSWORD },
        organization: { name: 'Acme Ltd', slug: 'acme', timezone: 'UTC', locale: 'en' },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const token = await operatorToken(h, 'owner@acme.test', PASSWORD);
    const sys = systemStatusResponseSchema.parse(
      (await api().get('/v2/platform/system').set(bearer(token))).body,
    );
    expect(sys.licence).toEqual({ required: false, verified: false, verifiedAt: null });

    const verify = await api()
      .post('/v2/platform/system/licence')
      .set(bearer(token))
      .send({ purchaseCode: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
    expect(verify.status).toBe(409);
    expect(verify.body.code).toBe(ERROR_CODES.LICENCE_NOT_ENABLED);
  });

  it('applied the bootstrap without an application block: General keeps the time zone and language', async () => {
    const general = (await setting('set.general'))?.value as Record<string, unknown>;
    expect(general).toMatchObject({ defaultTimezone: 'UTC', defaultLanguage: 'en' });
    expect(await setting('inst.node_bridge')).toBeUndefined();
  });
});
