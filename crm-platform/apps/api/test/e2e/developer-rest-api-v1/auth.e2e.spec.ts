import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiV1DocsService } from '../../../src/modules/developer-rest-api-v1';
import { AUTH_FAILURES_PER_MINUTE } from '../../../src/modules/developer-rest-api-v1/auth/bearer-api-key.guard';
import { Api, mintKey, startHarness, tenantWithKey, v1, type Harness } from './support';

/**
 * How a key authenticates and is held to its limits on `/api/v1` (TW-API-005 to 009), the error envelope (TW-API-007) and the spec
 * document (TW-API-150). Uses `GET /me` as the probe route.
 */
describe('customer API: key authentication, limits, envelope', () => {
  let h: Harness;
  let api: Api;

  beforeAll(async () => {
    h = await startHarness();
    api = new Api(h);
    h.app.get(ApiV1DocsService).attach(h.app);
  }, 240_000);
  afterAll(async () => h.stop());

  it("authenticates a bearer key and an X-Api-Key, and answers for the key's own workspace (TW-API-005)", async () => {
    const a = await tenantWithKey(api, 'auth-a');
    const b = await tenantWithKey(api, 'auth-b');
    const viaBearer = await a.call.get('/me');
    expect(viaBearer.status, JSON.stringify(viaBearer.body)).toBe(200);
    const viaHeader = await v1(h, 'unused').raw('get', '/me').set('x-api-key', a.key.secret);
    expect(viaHeader.status).toBe(200);
    expect(viaHeader.body.data.workspace.id).toBe(viaBearer.body.data.workspace.id);
    expect((await b.call.get('/me')).body.data.workspace.id).not.toBe(
      viaBearer.body.data.workspace.id,
    );
  });

  it('answers 401 missing_api_key with no key, in the Reference envelope with the request id (TW-API-005, 007)', async () => {
    const res = await v1(h, 'x').raw('get', '/me');
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.error.code).toBe('missing_api_key');
    expect(res.body.error.message).toContain('Authorization: Bearer');
    expect(res.body.error.requestId).toBeTruthy();
    expect(Object.keys(res.body)).toEqual(['error']);
  });

  it('answers 401 invalid_api_key for a malformed, unknown, revoked, expired key, or one whose owner is gone (TW-API-005)', async () => {
    const t = await api.signup('auth-bad');
    const key = await mintKey(api, t);
    const call = (secret: string) => v1(h, secret).get('/me');

    expect((await call('wsk_short')).body.error.code).toBe('invalid_api_key');
    expect((await call('wsk_' + 'A'.repeat(40))).body.error.code).toBe('invalid_api_key');
    expect((await call(key.secret.slice(0, 20) + 'z'.repeat(24))).status).toBe(401);
    expect((await call(key.secret)).status).toBe(200);

    await h.owner.query(
      `UPDATE api_keys SET expires_at = now() - interval '1 minute' WHERE org_id = $1`,
      [t.orgId],
    );
    expect((await call(key.secret)).body.error.code).toBe('invalid_api_key');
    await h.owner.query(`UPDATE api_keys SET expires_at = NULL WHERE org_id = $1`, [t.orgId]);
    expect((await call(key.secret)).status).toBe(200);

    await h.owner.query(`UPDATE api_keys SET user_id = NULL WHERE org_id = $1`, [t.orgId]);
    expect((await call(key.secret)).body.error.code).toBe('invalid_api_key');
    await h.owner.query(`UPDATE api_keys SET user_id = $2 WHERE org_id = $1`, [
      t.orgId,
      t.adminUserId,
    ]);

    const revoked = await api
      .http()
      .delete(`/v2/developer/keys/${key.id}`)
      .set({ authorization: `Bearer ${t.admin}` });
    expect(revoked.status).toBe(200);
    const after = await call(key.secret);
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('invalid_api_key');
  });

  it('keeps the two schemes apart: a signed partner key cannot open /api/v1, a bearer key cannot open /public/v1 (TW-API-005)', async () => {
    const t = await tenantWithKey(api, 'auth-schemes');
    const prefix = `pk_${randomUUID().slice(0, 8)}`;
    await h.owner.query(
      `INSERT INTO api_keys (org_id, name, key_prefix, key_hash, signing_secret_enc, scopes, kind)
       VALUES ($1, 'partner', $2, $3, 'x', '{}', 'signed')`,
      [t.tenant.orgId, prefix, 'argon-ish'],
    );
    expect((await v1(h, `${prefix}.secret`).get('/me')).status).toBe(401);
    const publicRes = await v1(h, 'x')
      .raw('get', `/../public/v1/leads/${randomUUID()}`)
      .set('authorization', `Bearer ${t.key.secret}`);
    expect([401, 404]).toContain(publicRes.status);
  });

  it('writes last_used_at on use, at most once a minute (TW-API-005)', async () => {
    const t = await tenantWithKey(api, 'auth-last-used');
    const read = async () =>
      (await h.owner.query(`SELECT last_used_at FROM api_keys WHERE org_id = $1`, [t.tenant.orgId]))
        .rows[0].last_used_at as Date | null;
    expect(await read()).toBeNull();
    await t.call.get('/me');
    await new Promise((r) => setTimeout(r, 400));
    const first = await read();
    expect(first).not.toBeNull();
    await t.call.get('/me');
    await new Promise((r) => setTimeout(r, 400));
    expect((await read())?.getTime()).toBe(first?.getTime());
  });

  it('holds a key to its limit with headers, a 429 envelope and Retry-After; -1 lifts it (TW-API-006)', async () => {
    const t = await tenantWithKey(api, 'auth-rate');
    await h.owner.query(`UPDATE api_keys SET rate_limit_per_minute = 2 WHERE org_id = $1`, [
      t.tenant.orgId,
    ]);
    const first = await t.call.get('/me');
    expect(first.status).toBe(200);
    expect(first.headers['x-ratelimit-limit']).toBe('2');
    expect(first.headers['x-ratelimit-remaining']).toBe('1');
    expect((await t.call.get('/me')).headers['x-ratelimit-remaining']).toBe('0');
    const third = await t.call.get('/me');
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('rate_limited');
    expect(third.body.error.message).toContain('2 requests/minute');
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);

    await h.owner.query(
      `UPDATE org_plan_state SET overrides = jsonb_build_object('limits', jsonb_build_object('api_rate_limit_per_minute', -1)) WHERE org_id = $1`,
      [t.tenant.orgId],
    );
    await new Promise((r) => setTimeout(r, 5500)); // the entitlement read is cached for a few seconds
    expect((await t.call.get('/me')).status).toBe(200);
    expect((await t.call.get('/me')).headers['x-ratelimit-limit']).toBeUndefined();
  }, 60_000);

  it('counts each key on its own (TW-API-006)', async () => {
    const a = await tenantWithKey(api, 'auth-rate-a');
    const b = await tenantWithKey(api, 'auth-rate-b');
    await h.owner.query(`UPDATE api_keys SET rate_limit_per_minute = 1 WHERE org_id = $1`, [
      a.tenant.orgId,
    ]);
    expect((await a.call.get('/me')).status).toBe(200);
    expect((await a.call.get('/me')).status).toBe(429);
    expect((await b.call.get('/me')).status).toBe(200);
  });

  it('narrows a key that carries scopes and leaves a key without scopes full (TW-API-008)', async () => {
    const t = await tenantWithKey(api, 'auth-scope');
    expect((await t.call.get('/contacts')).status).toBe(200);
    await h.owner.query(`UPDATE api_keys SET scopes = '{contacts:read}' WHERE org_id = $1`, [
      t.tenant.orgId,
    ]);
    expect((await t.call.get('/contacts')).status).toBe(200);
    const denied = await t.call.post('/contacts', { name: 'X', phone: '+919800000001' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('forbidden');
    expect(denied.body.error.message).toContain('contacts:write');
    expect((await t.call.get('/me')).status).toBe(403);
    await h.owner.query(`UPDATE api_keys SET scopes = '{contacts:write}' WHERE org_id = $1`, [
      t.tenant.orgId,
    ]);
    expect((await t.call.get('/contacts')).status).toBe(200);
  });

  it('holds a key created with scopes from the console to them: a read key cannot write, a key cannot leave its resources (AUTH-073)', async () => {
    const t = await tenantWithKey(api, 'auth-scope-console', ['contacts:read']);
    expect(t.key.scopes).toEqual(['contacts:read']);

    expect((await t.call.get('/contacts')).status).toBe(200);
    const write = await t.call.post('/contacts', { name: 'X', phone: '+919800000003' });
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe('forbidden');
    expect(write.body.error.message).toContain('contacts:write');
    for (const path of ['/me', '/deals', '/contact-groups', '/templates', '/broadcasts']) {
      const res = await t.call.get(path);
      expect(res.status, path).toBe(403);
      expect(res.body.error.code, path).toBe('forbidden');
    }
    const send = await t.call.post('/messages', {
      to: '919812345678',
      type: 'text',
      text: 'hello',
    });
    expect(send.status).toBe(403);
    expect(send.body.error.message).toContain('messages:write');
  });

  it('lets a write scope do its write and read the same resource, and nothing else (AUTH-073)', async () => {
    const t = await tenantWithKey(api, 'auth-scope-write', ['contacts:write']);
    expect((await t.call.get('/contacts')).status).toBe(200);
    const created = await t.call.post('/contacts', { name: 'Scoped', phone: '+919800000004' });
    expect([200, 201], JSON.stringify(created.body)).toContain(created.status);
    expect((await t.call.get('/deals')).status).toBe(403);
    expect((await t.call.get('/me')).status).toBe(403);
  });

  it('keeps a key created without scopes at full access, and a scoped one beside it restricted (AUTH-073, TW-API-008)', async () => {
    const full = await tenantWithKey(api, 'auth-scope-full');
    expect(full.key.scopes).toEqual([]);
    for (const path of ['/me', '/contacts', '/contact-groups']) {
      expect((await full.call.get(path)).status, path).toBe(200);
    }

    const restricted = await tenantWithKey(api, 'auth-scope-beside', ['account:read']);
    expect((await restricted.call.get('/me')).status).toBe(200);
    expect((await restricted.call.get('/contacts')).status).toBe(403);
  });

  it('refuses every route when the plan has no Public API feature (TW-API-009)', async () => {
    const t = await tenantWithKey(api, 'auth-plan');
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = jsonb_build_object('features', jsonb_build_object('public_api', false)) WHERE org_id = $1`,
      [t.tenant.orgId],
    );
    await new Promise((r) => setTimeout(r, 5500));
    const res = await t.call.get('/me');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('plan_feature_disabled');
  }, 60_000);

  it('answers a route that does not exist and unreadable JSON in the same envelope (TW-API-007)', async () => {
    const t = await tenantWithKey(api, 'auth-envelope');
    const unknown = await t.call.get('/nope');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('not_found');
    const garbled = await v1(h, t.key.secret)
      .raw('post', '/contacts')
      .set('authorization', `Bearer ${t.key.secret}`)
      .set('content-type', 'application/json')
      .send('{"name": ');
    expect(garbled.status).toBe(422);
    expect(garbled.body.error.code).toBe('validation_failed');
    const invalid = await t.call.post('/contacts', {});
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('validation_failed');
    expect(typeof invalid.body.error.details).toBe('object');
  });

  it('answers a known path called with another method as 405 with the methods that work (TW-API-007)', async () => {
    const t = await tenantWithKey(api, 'auth-405');
    const res = await t.call.delete('/me');
    expect(res.status).toBe(405);
    expect(res.body.error.code).toBe('method_not_allowed');
    expect(res.body.error.message).toContain('Supported methods: GET');
    expect(res.headers.allow).toBe('GET');
    expect((await t.call.put('/contact-groups', {})).status).toBe(405);
  });

  it('serves the OpenAPI document of the customer API only, branded, public (TW-API-150)', async () => {
    const res = await api.http().get('/docs/api.json');
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const doc = res.body;
    expect(doc.info.title).toMatch(/ API$/);
    expect(JSON.stringify(doc)).not.toContain('{{brand}}');
    const paths = Object.keys(doc.paths);
    expect(paths.every((p) => p.startsWith('/api/v1/'))).toBe(true);
    for (const p of [
      '/api/v1/me',
      '/api/v1/usage',
      '/api/v1/contacts',
      '/api/v1/contacts/{id}',
      '/api/v1/messages',
    ]) {
      expect(paths, p).toContain(p);
    }
    expect(paths.some((p) => p.includes('developer/keys'))).toBe(false);
    expect(doc.tags.map((t: { name: string }) => t.name)).toEqual([
      'Message',
      'Template',
      'Media',
      'Contact',
      'ContactGroup',
      'Broadcast',
      'Campaign',
      'Scheduled',
      'AutoReply',
      'Flow',
      'Device',
      'Webhook',
      'Deal',
      'Conversation',
      'Account',
    ]);
    expect(doc.components.securitySchemes['api-key']).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('locks an address out after too many failed authentications (TW-API-005)', async () => {
    const t = await tenantWithKey(api, 'auth-lockout');
    // earlier specs in this file failed on purpose from the same address: start the count from zero
    for (const k of await h.redis.keys('apikey:authfail:*')) await h.redis.del(k);
    for (let i = 0; i < AUTH_FAILURES_PER_MINUTE; i += 1) {
      expect((await v1(h, 'wsk_' + 'B'.repeat(40)).get('/me')).status).toBe(401);
    }
    const locked = await v1(h, 'wsk_' + 'B'.repeat(40)).get('/me');
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('rate_limited');
    // even the right key is refused from that address until the minute turns
    expect((await t.call.get('/me')).status).toBe(429);
    for (const k of await h.redis.keys('apikey:authfail:*')) await h.redis.del(k);
    expect((await t.call.get('/me')).status).toBe(200);
  }, 120_000);
});
