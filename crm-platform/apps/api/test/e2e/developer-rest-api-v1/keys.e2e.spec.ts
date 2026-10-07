import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, bearer, mintKey, startHarness, type Harness } from './support';

/**
 * The Developers console's keys (WD-API-001 to 004, 010): create, list, revoke, the cap, the permissions.
 * The key's use on the API is in `auth.e2e.spec.ts`.
 */
describe('developer keys (console)', () => {
  let h: Harness;
  let api: Api;

  beforeAll(async () => {
    h = await startHarness();
    api = new Api(h);
  }, 240_000);
  afterAll(async () => h.stop());

  it('creates a key: the raw secret once, a hash and a 12-character prefix in the database (WD-API-001)', async () => {
    const t = await api.signup('keys-create');
    const res = await api
      .http()
      .post('/v2/developer/keys')
      .set(bearer(t.admin))
      .send({ name: '  Production backend ' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const secret: string = res.body.secret;
    expect(secret).toMatch(/^wsk_[A-Za-z0-9]{40}$/);
    expect(res.body.key.name).toBe('Production backend');
    expect(res.body.key.prefix).toBe(secret.slice(0, 12));
    expect(res.body.key.status).toBe('active');
    expect(res.body.key.lastUsedAt).toBeNull();
    expect(JSON.stringify(res.body.key)).not.toContain(secret.slice(12));

    const row = (
      await h.owner.query(
        `SELECT kind, key_prefix, key_hash, signing_secret_enc, user_id, created_by, rate_limit_per_minute FROM api_keys WHERE org_id = $1`,
        [t.orgId],
      )
    ).rows[0];
    expect(row.kind).toBe('bearer');
    expect(row.key_prefix).toBe(secret.slice(0, 12));
    expect(row.key_hash).toMatch(/^sha256\$[0-9a-f]{64}$/);
    expect(row.key_hash).not.toContain(secret);
    expect(row.signing_secret_enc).toBeNull();
    expect(Number(row.user_id)).toBe(t.adminUserId);
    expect(Number(row.created_by)).toBe(t.adminUserId);
    expect(row.rate_limit_per_minute).toBe(0);

    const audit = await h.owner.query(
      `SELECT action, actor_type FROM audit_log WHERE org_id = $1 AND module = 'api_keys'`,
      [t.orgId],
    );
    expect(audit.rows).toEqual([{ action: 'insert', actor_type: 'user' }]);
    const outbox = await h.owner.query(
      `SELECT event_type, payload FROM event_outbox WHERE org_id = $1 AND aggregate_module = 'api_keys'`,
      [t.orgId],
    );
    expect(outbox.rows.map((r) => r.event_type)).toEqual(['api.key_created']);
    expect(JSON.stringify(outbox.rows[0].payload)).not.toContain(secret);
  });

  it('refuses a blank name and a name over 120 characters (WD-API-001)', async () => {
    const t = await api.signup('keys-name');
    for (const name of ['', '   ', 'x'.repeat(121)]) {
      const res = await api.http().post('/v2/developer/keys').set(bearer(t.admin)).send({ name });
      expect(res.status, name).toBe(422);
    }
    expect(
      (await h.owner.query(`SELECT count(*)::int AS n FROM api_keys WHERE org_id = $1`, [t.orgId]))
        .rows[0].n,
    ).toBe(0);
    const ok = await api
      .http()
      .post('/v2/developer/keys')
      .set(bearer(t.admin))
      .send({ name: 'y'.repeat(120) });
    expect(ok.status).toBe(201);
  });

  it('lists the workspace keys, never the secret, and only its own (WD-API-002)', async () => {
    const a = await api.signup('keys-list-a');
    const b = await api.signup('keys-list-b');
    const keyA = await mintKey(api, a, 'A key');
    await mintKey(api, b, 'B key');

    const res = await api.http().get('/v2/developer/keys').set(bearer(a.admin));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id: keyA.id,
      name: 'A key',
      prefix: keyA.prefix,
      status: 'active',
    });
    expect(res.body.page).toEqual({ nextCursor: null, hasMore: false, limit: 50 });
    expect(JSON.stringify(res.body)).not.toContain(keyA.secret);
    expect(JSON.stringify(res.body)).not.toContain('sha256');
  });

  it('allows one active key per workspace on a one-key plan, with the WaDesk message; two at once make one (WD-API-004)', async () => {
    const t = await api.signup('keys-cap');
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = jsonb_build_object('limits', jsonb_build_object('api_keys', 1)) WHERE org_id = $1`,
      [t.orgId],
    );
    const [first, second] = await Promise.all([
      api.http().post('/v2/developer/keys').set(bearer(t.admin)).send({ name: 'one' }),
      api.http().post('/v2/developer/keys').set(bearer(t.admin)).send({ name: 'two' }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 422]);
    const refused = first.status === 422 ? first : second;
    expect(refused.body.code).toBe('PLAN_LIMIT_REACHED');
    expect(refused.body.detail).toBe(
      'You already have an active API key. Revoke it before creating a new one - only one key per workspace is allowed.',
    );
    expect(
      (await h.owner.query(`SELECT count(*)::int AS n FROM api_keys WHERE org_id = $1`, [t.orgId]))
        .rows[0].n,
    ).toBe(1);
  });

  it('revokes a key: idempotent, keeps the first revoked_at, frees the place for a new one (WD-API-003)', async () => {
    const t = await api.signup('keys-revoke');
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = jsonb_build_object('limits', jsonb_build_object('api_keys', 1)) WHERE org_id = $1`,
      [t.orgId],
    );
    const key = await mintKey(api, t);

    const first = await api.http().delete(`/v2/developer/keys/${key.id}`).set(bearer(t.admin));
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.status).toBe('revoked');
    expect(first.body.revokedAt).not.toBeNull();

    const again = await api.http().delete(`/v2/developer/keys/${key.id}`).set(bearer(t.admin));
    expect(again.status).toBe(200);
    expect(again.body.revokedAt).toBe(first.body.revokedAt);

    const audit = await h.owner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'api_keys' AND action = 'update'`,
      [t.orgId],
    );
    expect(audit.rows[0].n).toBe(1);

    const replacement = await api
      .http()
      .post('/v2/developer/keys')
      .set(bearer(t.admin))
      .send({ name: 'next' });
    expect(replacement.status, JSON.stringify(replacement.body)).toBe(201);
  });

  it('answers 404 for a key of another workspace and for an unknown id (WD-API-003)', async () => {
    const a = await api.signup('keys-iso-a');
    const b = await api.signup('keys-iso-b');
    const keyA = await mintKey(api, a);
    const foreign = await api.http().delete(`/v2/developer/keys/${keyA.id}`).set(bearer(b.admin));
    expect(foreign.status).toBe(404);
    const unknown = await api
      .http()
      .delete(`/v2/developer/keys/00000000-0000-4000-8000-000000000000`)
      .set(bearer(b.admin));
    expect(unknown.status).toBe(404);
    const still = await api.http().get('/v2/developer/keys').set(bearer(a.admin));
    expect(still.body.data[0].status).toBe('active');
  });

  it('is for staff with the keys: an agent without api.keys.* is refused, a viewer of keys cannot create (WD-API-010)', async () => {
    const t = await api.signup('keys-perm');
    const agent = await api.member(t, 'agent', [['record.contacts.read']]);
    expect((await api.http().get('/v2/developer/keys').set(bearer(agent.token))).status).toBe(403);
    expect(
      (await api.http().post('/v2/developer/keys').set(bearer(agent.token)).send({ name: 'x' }))
        .status,
    ).toBe(403);

    const reader = await api.member(t, 'reader', [['api.keys.read']]);
    expect((await api.http().get('/v2/developer/keys').set(bearer(reader.token))).status).toBe(200);
    expect(
      (await api.http().post('/v2/developer/keys').set(bearer(reader.token)).send({ name: 'x' }))
        .status,
    ).toBe(403);
    const key = await mintKey(api, t);
    expect(
      (await api.http().delete(`/v2/developer/keys/${key.id}`).set(bearer(reader.token))).status,
    ).toBe(403);

    expect((await api.http().get('/v2/developer/keys')).status).toBe(401);
  });

  it('does not store the raw key anywhere an idempotent replay could read it (WD-API-001)', async () => {
    const t = await api.signup('keys-idem');
    const res = await api
      .http()
      .post('/v2/developer/keys')
      .set(bearer(t.admin))
      .set('idempotency-key', 'k-1')
      .send({ name: 'idem' });
    expect(res.status).toBe(201);
    const keys = await h.redis.keys('*idem*');
    for (const k of keys) {
      const v = (await h.redis.get(k)) ?? '';
      expect(v).not.toContain(res.body.secret);
    }
  });
});
