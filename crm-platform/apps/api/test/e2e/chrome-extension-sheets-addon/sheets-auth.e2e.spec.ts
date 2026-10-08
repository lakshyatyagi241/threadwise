import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Api,
  addon,
  generateKey,
  installSheets,
  memberWithKey,
  startHarness,
  uninstallSheets,
  FULL_GRANTS,
  VIEWER_GRANTS,
  type Harness,
} from './support';
import { SHEETS_AUTH_FAILURES_PER_MINUTE } from '../../../src/modules/chrome-extension-sheets-addon/sheets-key.rules';

/**
 * How the add-on API authenticates and what stands between a key and the workspace (WD-EXT-004, 007, 013): the bearer key alone, every
 * refusal, the install gate, the member's role, and the per-key and per-address limits.
 */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);
afterAll(async () => h?.stop());

describe('bearer authentication', () => {
  it('answers a good key with who it is, the workspace, what it may do and the limits', async () => {
    const t = await api.signup('ea-ok');
    await installSheets(h, t);
    const key = await generateKey(api, t.admin);
    const res = await addon(h, key).get('/health');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      user: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        name: expect.any(String),
        email: expect.stringContaining('@'),
      },
      workspace: { id: expect.stringMatching(/^[0-9a-f-]{36}$/), name: expect.any(String) },
      can: { read_contacts: true, write_contacts: true, read_catalog: true, write_catalog: true },
      limits: { max_rows: 500, max_pull: 500 },
      api_version: 1,
    });
    expect(new Date(res.body.server_time as string).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('refuses a call with no key, in the add-on envelope and with the request id', async () => {
    const res = await addon(h, null).get('/health');
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).toMatchObject({
      ok: false,
      code: 'EXT_KEY_MISSING',
      error: expect.stringContaining('Bearer'),
    });
    expect(res.body.requestId).toBeTruthy();
    expect(Object.keys(res.body).sort()).toEqual(['code', 'error', 'ok', 'requestId']);
  });

  it('refuses a malformed key, an unknown key of the right shape, and a revoked key with one and the same answer', async () => {
    const t = await api.signup('ea-bad');
    await installSheets(h, t);
    const good = await generateKey(api, t.admin);
    const unknown = 'wsn_live_' + 'a'.repeat(32);
    const answers = [];
    for (const key of [
      'wsn_live_short',
      unknown,
      good.slice(0, -1) + (good.endsWith('0') ? '1' : '0'),
      'wsk_' + 'A'.repeat(40),
      'garbage',
    ]) {
      const res = await addon(h, key).get('/health');
      expect(res.status, key).toBe(401);
      answers.push(res.body);
    }
    for (const body of answers) {
      expect(body).toMatchObject({ ok: false, code: 'EXT_KEY_INVALID' });
      expect(body.error).toBe(answers[0].error);
    }
    await api.as(t.admin).delete('/v2/extension/sheets/key');
    const revoked = await addon(h, good).get('/health');
    expect(revoked.status).toBe(401);
    expect(revoked.body.error).toBe(answers[0].error);
  });

  it('reads the key from the Authorization header only, not from a query string or X-Api-Key', async () => {
    const t = await api.signup('ea-hdr');
    await installSheets(h, t);
    const key = await generateKey(api, t.admin);
    const viaQuery = await addon(h, null).get(`/health?key=${key}&api_key=${key}`);
    expect(viaQuery.status).toBe(401);
    const viaHeader = await addon(h, null).raw('get', '/health').set('x-api-key', key);
    expect(viaHeader.status).toBe(401);
    const lower = await addon(h, null).raw('get', '/health').set('authorization', `bearer ${key}`);
    expect(lower.status).toBe(200);
  });

  it("does not take the staff session token, and the customer API's wsk_ keys do not open it", async () => {
    const t = await api.signup('ea-sess');
    await installSheets(h, t);
    expect((await addon(h, t.admin).get('/health')).status).toBe(401);
    const minted = await api
      .http()
      .post('/v2/developer/keys')
      .set({ authorization: `Bearer ${t.admin}` })
      .send({ name: 'k' });
    expect(minted.status, JSON.stringify(minted.body)).toBe(201);
    expect((await addon(h, minted.body.secret as string).get('/health')).status).toBe(401);
  });

  it('locks an address out after too many wrong keys, and a good key from another address still works', async () => {
    const t = await api.signup('ea-lock');
    await installSheets(h, t);
    const key = await generateKey(api, t.admin);
    const attacker = addon(h, 'wsn_live_' + 'b'.repeat(32));
    for (let i = 0; i < SHEETS_AUTH_FAILURES_PER_MINUTE; i += 1) {
      expect((await attacker.get('/health')).status).toBe(401);
    }
    const locked = await attacker.get('/health');
    expect(locked.status).toBe(429);
    expect(locked.body).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    // Even the right key is refused from the locked address (the throttle comes first)...
    expect((await addon(h, key, attacker.ip).get('/health')).status).toBe(429);
    // ...and nobody else is affected.
    expect((await addon(h, key).get('/health')).status).toBe(200);
  });
});

describe('one workspace never reaches another', () => {
  it("a key resolves to its own workspace: two workspaces' keys answer for their own, and a key is not valid for the other's data", async () => {
    const a = await api.signup('ea-iso-a');
    const b = await api.signup('ea-iso-b');
    await installSheets(h, a);
    await installSheets(h, b);
    const ka = await generateKey(api, a.admin);
    const kb = await generateKey(api, b.admin);
    const ha = await addon(h, ka).get('/health');
    const hb = await addon(h, kb).get('/health');
    expect(ha.body.workspace.id).not.toBe(hb.body.workspace.id);
    expect(ha.body.user.email).not.toBe(hb.body.user.email);

    await api.seedContacts(a, [{ name: 'Only in A', email: 'only-a@example.test' }]);
    await api.seedContacts(b, [{ name: 'Only in B', email: 'only-b@example.test' }]);
    const pa = await addon(h, ka).get('/contacts');
    const pb = await addon(h, kb).get('/contacts');
    expect(pa.body.contacts.map((c: { name: string }) => c.name)).toEqual(['Only in A']);
    expect(pb.body.contacts.map((c: { name: string }) => c.name)).toEqual(['Only in B']);
  });

  it('installing in one workspace does not switch the add-on on in another', async () => {
    const a = await api.signup('ea-inst-a');
    const b = await api.signup('ea-inst-b');
    await installSheets(h, a);
    const ka = await generateKey(api, a.admin);
    // B has a key row only because the test forces one in; B never installed the add-on.
    await h.owner.query(
      `INSERT INTO user_settings (org_id, user_id, sheets_key_hash, sheets_key_suffix, sheets_key_created_at)
       VALUES ($1, $2, encode(sha256('wsn_live_${'c'.repeat(32)}'::bytea), 'hex'), 'cccccccc', now())`,
      [b.orgId, b.adminUserId],
    );
    expect((await addon(h, ka).get('/health')).status).toBe(200);
    const res = await addon(h, 'wsn_live_' + 'c'.repeat(32)).get('/health');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EXT_APP_NOT_INSTALLED');
  });
});

describe('the add-on must be installed', () => {
  it('stops at once when it is uninstalled, disabled or killed, and works again when it is back', async () => {
    const t = await api.signup('ea-gate');
    await installSheets(h, t);
    const key = await generateKey(api, t.admin);
    const call = () => addon(h, key).get('/health');
    expect((await call()).status).toBe(200);

    await uninstallSheets(h, t);
    const gone = await call();
    expect(gone.status).toBe(403);
    expect(gone.body).toMatchObject({ ok: false, code: 'EXT_APP_NOT_INSTALLED' });

    await installSheets(h, t, undefined, 'disabled');
    expect((await call()).body.code).toBe('EXT_APP_NOT_INSTALLED');
    await installSheets(h, t, undefined, 'killed');
    expect((await call()).body.code).toBe('EXT_APP_NOT_INSTALLED');

    await installSheets(h, t);
    expect((await call()).status).toBe(200);
  });

  it('refuses what the install did not consent to, whatever the role holds', async () => {
    const t = await api.signup('ea-scope');
    await installSheets(h, t, ['contacts.read']);
    const key = await generateKey(api, t.admin);
    expect((await addon(h, key).get('/contacts')).status).toBe(200);
    const write = await addon(h, key).post('/contacts/sync', {
      rows: [{ email: 'x@example.test' }],
    });
    expect(write.status).toBe(403);
    expect(write.body).toMatchObject({ ok: false, code: 'EXT_SCOPE_NOT_GRANTED' });
    expect((await addon(h, key).get('/shops')).body.code).toBe('EXT_SCOPE_NOT_GRANTED');
    expect((await addon(h, key).get('/health')).body.can).toEqual({
      read_contacts: true,
      write_contacts: false,
      read_catalog: false,
      write_catalog: false,
    });
  });
});

describe("the key follows its owner's role", () => {
  it('a viewer key can read but not write, and says so in /health', async () => {
    const t = await api.signup('ea-viewer');
    await installSheets(h, t);
    const m = await memberWithKey(api, t, 'viewer', VIEWER_GRANTS);
    const health = await addon(h, m.key).get('/health');
    expect(health.body.can).toEqual({
      read_contacts: true,
      write_contacts: false,
      read_catalog: true,
      write_catalog: false,
    });
    expect((await addon(h, m.key).get('/contacts')).status).toBe(200);
    expect((await addon(h, m.key).get('/shops')).status).toBe(200);

    const w = await addon(h, m.key).post('/contacts/sync', { rows: [{ email: 'v@example.test' }] });
    expect(w.status).toBe(403);
    expect(w.body).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
      error: expect.stringContaining('create or edit contacts'),
    });
    const p = await addon(h, m.key).post('/sync', {
      shop_name: 'S',
      products: [{ name: 'A', price: 1 }],
    });
    expect(p.status).toBe(403);
    expect(p.body.code).toBe('FORBIDDEN');
    // Nothing was written by either refused call.
    expect(
      (
        await h.owner.query(`SELECT count(*)::int AS n FROM wa_storefronts WHERE org_id = $1`, [
          t.orgId,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(
      (await h.owner.query(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [t.orgId]))
        .rows[0].n,
    ).toBe(0);
  });

  it('takes effect as soon as the role changes: removing the app permission ends the key, removing a write permission ends writes', async () => {
    const t = await api.signup('ea-role');
    await installSheets(h, t);
    const m = await memberWithKey(api, t, 'changing', FULL_GRANTS);
    const body = { rows: [{ email: 'role@example.test' }] };
    expect((await addon(h, m.key).post('/contacts/sync', body)).status).toBe(200);

    const roleId = (
      await h.owner.query(`SELECT role_id FROM user_roles WHERE org_id = $1 AND user_id = $2`, [
        t.orgId,
        m.userId,
      ])
    ).rows[0].role_id;
    // What `RbacService.bumpRolesVersion` does after a role edit: raise the version and drop the cached one.
    const bump = async () => {
      await h.owner.query(
        `UPDATE organizations SET roles_version = roles_version + 1 WHERE id = $1`,
        [t.orgId],
      );
      await h.redis.del(`rbac:version:${t.orgId}`);
    };
    await h.owner.query(
      `DELETE FROM role_grants WHERE org_id = $1 AND role_id = $2 AND permission_key IN ('record.contacts.create','record.contacts.update')`,
      [t.orgId, roleId],
    );
    await bump();
    const noWrite = await addon(h, m.key).post('/contacts/sync', body);
    expect(noWrite.status).toBe(403);
    expect(noWrite.body.code).toBe('FORBIDDEN');
    expect((await addon(h, m.key).get('/contacts')).status).toBe(200);

    await h.owner.query(
      `DELETE FROM role_grants WHERE org_id = $1 AND role_id = $2 AND permission_key = 'app.google-sheets.use'`,
      [t.orgId, roleId],
    );
    await bump();
    const gone = await addon(h, m.key).get('/health');
    expect(gone.status).toBe(403);
    expect(gone.body.code).toBe('FORBIDDEN');
  });

  it('a record scope of "own" limits what a sheet pull shows', async () => {
    const t = await api.signup('ea-own');
    await installSheets(h, t);
    const grants = FULL_GRANTS.map(([k]) =>
      k === 'record.contacts.read' ? ([k, 'own'] as [string, 'own']) : ([k] as [string]),
    );
    const m = await memberWithKey(api, t, 'ownonly', grants);
    await api.seedContacts(t, [
      { name: 'Mine', email: 'mine@example.test', ownerId: m.userId },
      { name: 'Theirs', email: 'theirs@example.test', ownerId: t.adminUserId },
    ]);
    const res = await addon(h, m.key).get('/contacts');
    expect(res.body.contacts.map((c: { name: string }) => c.name)).toEqual(['Mine']);
  });

  it('refuses a suspended member and a suspended workspace like the app does', async () => {
    const t = await api.signup('ea-susp');
    await installSheets(h, t);
    const m = await memberWithKey(api, t, 'susp', FULL_GRANTS);
    await h.owner.query(`UPDATE users SET status = 'suspended' WHERE org_id = $1 AND id = $2`, [
      t.orgId,
      m.userId,
    ]);
    await h.redis.flushall();
    const res = await addon(h, m.key).get('/health');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AUTH_ACCOUNT_SUSPENDED');
    await h.owner.query(`UPDATE users SET status = 'active' WHERE org_id = $1 AND id = $2`, [
      t.orgId,
      m.userId,
    ]);

    await h.owner.query(`UPDATE organizations SET status = 'suspended' WHERE id = $1`, [t.orgId]);
    await h.redis.flushall();
    const org = await addon(h, m.key).get('/health');
    expect(org.status).toBe(403);
    expect(org.body.code).toBe('WSP_ORG_SUSPENDED');
    await h.owner.query(`UPDATE organizations SET status = 'active' WHERE id = $1`, [t.orgId]);
    await h.redis.flushall();
  });

  it('ends a key with its member: deleting the user deletes the key', async () => {
    const t = await api.signup('ea-del');
    await installSheets(h, t);
    const m = await memberWithKey(api, t, 'leaver', FULL_GRANTS);
    expect((await addon(h, m.key).get('/health')).status).toBe(200);
    await h.owner.query(`DELETE FROM users WHERE org_id = $1 AND id = $2`, [t.orgId, m.userId]);
    expect((await addon(h, m.key).get('/health')).body.code).toBe('EXT_KEY_INVALID');
  });
});

describe('limits', () => {
  it("holds a key to the plan's API ceiling with headers and a 429 envelope", async () => {
    const t = await api.signup('ea-rate');
    await installSheets(h, t);
    const key = await generateKey(api, t.admin);
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = jsonb_build_object('limits', jsonb_build_object('api_rate_limit_per_minute', 3)) WHERE org_id = $1`,
      [t.orgId],
    );
    await h.redis.flushall();
    const first = await addon(h, key).get('/health');
    expect(first.status).toBe(200);
    expect(first.headers['x-ratelimit-limit']).toBe('3');
    expect(first.headers['x-ratelimit-remaining']).toBe('2');
    await addon(h, key).get('/health');
    await addon(h, key).get('/health');
    const over = await addon(h, key).get('/health');
    expect(over.status).toBe(429);
    expect(over.body).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('answers 413 for a body over the add-on cap, and 422 for a request that is not shaped right', async () => {
    const t = await api.signup('ea-size');
    await installSheets(h, t);
    const key = await generateKey(api, t.admin);
    const big = await addon(h, key).post('/contacts/sync', {
      rows: [{ name: 'x'.repeat(2.2 * 1024 * 1024) }],
    });
    expect(big.status).toBe(413);
    expect(big.body).toMatchObject({ ok: false, code: 'PAYLOAD_TOO_LARGE' });

    const empty = await addon(h, key).post('/contacts/sync', { rows: [] });
    expect(empty.status).toBe(422);
    expect(empty.body).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(empty.body.details.rows).toEqual(['Send at least one row']);
    const many = await addon(h, key).post('/contacts/sync', {
      rows: new Array(501).fill({ email: 'a@b.co' }),
    });
    expect(many.status).toBe(422);
    expect(many.body.details.rows[0]).toContain('at most 500');
  });
});
