import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { LeadRetentionSweepService } from '../../../src/modules/leads/lead-retention-sweep.service';
import { LeadSyncRunsRepository } from '../../../src/modules/leads/lead-sync-runs.repository';
import {
  LEAD_MANAGE,
  LEAD_READ,
  LeadsApi,
  startHarness,
  type CreatedSource,
  type Harness,
  type Tenant,
} from './support';

/**
 * The management API of lead sources (spec L-04, L-05, L-11, L-12): permissions, secrets that never come back, optimistic locking,
 * mapping preview, events, audit and outbox, retention, and the database's own guarantees (forced RLS, composite foreign keys,
 * idempotency key, append-only attribution).
 */
let h: Harness;
let api: LeadsApi;

beforeAll(async () => {
  h = await startHarness();
  api = new LeadsApi(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const IN = { defaults: { countryCode: '91' } };

describe('permissions (L-12)', () => {
  let t: Tenant;
  let src: CreatedSource;
  let eventId: string;
  beforeAll(async () => {
    t = await api.signup('perm');
    src = await api.source(t.admin, { name: 'Perm source', ...IN });
    await api.hook(src.hookPath, { name: 'Perm Lead', phone: '98000 10001' });
    eventId = (await api.leadEvents(t.orgId, src.id))[0]!.uuid;
  });

  it('the Owner and Admin presets hold both keys, from the migration', async () => {
    const rows = await h.owner.query(
      `SELECT r.system_key, g.permission_key FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id
       WHERE g.org_id = $1 AND g.permission_key LIKE 'leads.sources.%' ORDER BY r.system_key, g.permission_key`,
      [t.orgId],
    );
    const by = (k: string) =>
      rows.rows.filter((r) => r.system_key === k).map((r) => r.permission_key);
    expect(by('admin')).toEqual(['leads.sources.manage', 'leads.sources.read']);
    expect(by('workspace_admin')).toEqual(['leads.sources.manage', 'leads.sources.read']);
    expect(by('agent')).toEqual([]);
    expect(by('manager')).toEqual([]);
    const defs = await h.owner.query(
      `SELECT key, category, supports_scope FROM permission_defs WHERE key LIKE 'leads.sources.%' ORDER BY key`,
    );
    expect(defs.rows.map((r) => r.key)).toEqual(['leads.sources.manage', 'leads.sources.read']);
  });

  it('a member with no leads key is refused every route', async () => {
    const m = await api.member(t, 'nobody', []);
    const calls = [
      api.as(m.token).get('/v2/lead-sources'),
      api.as(m.token).get(`/v2/lead-sources/${src.id}`),
      api.as(m.token).get(`/v2/lead-sources/${src.id}/events`),
      api.as(m.token).post('/v2/lead-sources').send({ name: 'x' }),
    ];
    for (const c of await Promise.all(calls)) expect(c.status).toBe(403);
  });

  it('read lets a member watch sources and events, never change them or open a payload', async () => {
    const m = await api.member(t, 'reader', LEAD_READ);
    expect((await api.as(m.token).get('/v2/lead-sources')).status).toBe(200);
    expect((await api.as(m.token).get(`/v2/lead-sources/${src.id}`)).status).toBe(200);
    const events = await api.as(m.token).get(`/v2/lead-sources/${src.id}/events`);
    expect(events.status).toBe(200);
    expect(events.body.data[0]).not.toHaveProperty('payload');
    expect(events.body.data[0].hasPayload).toBe(true);

    const refused = [
      api.as(m.token).post('/v2/lead-sources').send({ name: 'nope' }),
      api.as(m.token).patch(`/v2/lead-sources/${src.id}`).send({ rowVersion: 1, name: 'nope' }),
      api.as(m.token).delete(`/v2/lead-sources/${src.id}`),
      api.as(m.token).post(`/v2/lead-sources/${src.id}/rotate-token`),
      api.as(m.token).post(`/v2/lead-sources/${src.id}/test`).send({}),
      api.as(m.token).post(`/v2/lead-sources/${src.id}/mapping-preview`).send({}),
      api.as(m.token).get(`/v2/lead-sources/${src.id}/events/${eventId}`),
      api.as(m.token).post(`/v2/lead-sources/${src.id}/events/${eventId}/retry`),
    ];
    for (const r of await Promise.all(refused)) expect(r.status).toBe(403);
  });

  it('manage can do all of it', async () => {
    const m = await api.member(t, 'manager', LEAD_MANAGE);
    expect((await api.as(m.token).get(`/v2/lead-sources/${src.id}/events/${eventId}`)).status).toBe(
      200,
    );
    expect(
      (await api.as(m.token).post(`/v2/lead-sources/${src.id}/mapping-preview`).send({})).status,
    ).toBe(200);
    const created = await api.as(m.token).post('/v2/lead-sources').send({ name: 'By manager' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
  });

  it('no token at all is 401, and the public hook needs no session', async () => {
    expect((await api.http().get('/v2/lead-sources')).status).toBe(401);
    expect((await api.hook(src.hookPath, { name: 'Anonymous', phone: '98000 10002' })).status).toBe(
      200,
    );
  });

  it("a hook's token is not a session: it cannot open the management API", async () => {
    expect((await api.as(src.token).get('/v2/lead-sources')).status).toBe(401);
  });
});

describe('create, read, update, delete (L-04, L-12)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('crud');
  });

  it('create returns the token and URL once; a hash, a hint and nothing else is kept, and no read ever returns a secret', async () => {
    const secret = 'my-shared-secret-123';
    const s = await api.source(t.admin, { name: 'Hidden', secret, ...IN });
    expect(s.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.hookPath).toBe(`/v2/public/lead-hooks/${s.token}`);
    expect(s.tokenHint).toBe(s.token.slice(-4));
    expect(s.hasSecret).toBe(true);

    const row = (
      await api.rows(
        t.orgId,
        `SELECT token_hash, token_hint, secret_enc FROM lead_sources WHERE org_id = $1 AND uuid = $2::uuid`,
        [s.id],
      )
    )[0]!;
    expect(row.token_hash).toBe(sha(s.token));
    expect(JSON.stringify(row)).not.toContain(s.token);
    expect(JSON.stringify(row)).not.toContain(secret);

    const reads = [
      await api.as(t.admin).get(`/v2/lead-sources/${s.id}`),
      await api.as(t.admin).get('/v2/lead-sources'),
      await api
        .as(t.admin)
        .patch(`/v2/lead-sources/${s.id}`)
        .send({ rowVersion: s.rowVersion, secret: 'another-secret-456' }),
      await api.as(t.admin).get(`/v2/lead-sources/${s.id}/events`),
    ];
    for (const r of reads) {
      const text = JSON.stringify(r.body);
      expect(text).not.toContain(s.token);
      expect(text).not.toContain(row.token_hash);
      expect(text).not.toContain(secret);
      expect(text).not.toContain('another-secret-456');
      expect(text).not.toMatch(/secret_enc|secretEnc|tokenHash|token_hash|"token"/);
    }
    expect(reads[0]!.body).toMatchObject({ tokenHint: s.token.slice(-4), hasSecret: true });
  });

  it('names are unique per workspace, ignoring case, on create and on rename', async () => {
    await api.source(t.admin, { name: 'Unique Name' });
    const dup = await api.as(t.admin).post('/v2/lead-sources').send({ name: 'unique name' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('LEAD_SOURCE_NAME_TAKEN');
    const other = await api.source(t.admin, { name: 'Another Name' });
    const rename = await api
      .as(t.admin)
      .patch(`/v2/lead-sources/${other.id}`)
      .send({ rowVersion: other.rowVersion, name: 'UNIQUE NAME' });
    expect(rename.status).toBe(409);
    expect(rename.body.code).toBe('LEAD_SOURCE_NAME_TAKEN');
    // Another workspace may use the same name.
    const t2 = await api.signup('crud2');
    expect(
      (await api.as(t2.admin).post('/v2/lead-sources').send({ name: 'Unique Name' })).status,
    ).toBe(201);
  });

  it('update needs the version it read; a stale one is 409 and changes nothing', async () => {
    const s = await api.source(t.admin, { name: 'Versioned' });
    const first = await api
      .as(t.admin)
      .patch(`/v2/lead-sources/${s.id}`)
      .send({ rowVersion: s.rowVersion, name: 'Versioned v2' });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.rowVersion).toBe(s.rowVersion + 1);
    const stale = await api
      .as(t.admin)
      .patch(`/v2/lead-sources/${s.id}`)
      .send({ rowVersion: s.rowVersion, name: 'Versioned v3' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
    expect((await api.as(t.admin).get(`/v2/lead-sources/${s.id}`)).body.name).toBe('Versioned v2');
    expect(
      (await api.as(t.admin).patch(`/v2/lead-sources/${s.id}`).send({ name: 'No version' })).status,
    ).toBe(422);
  });

  it('the shared secret is set, replaced and cleared; absent keeps it', async () => {
    const s = await api.source(t.admin, { name: 'Secrets' });
    expect(s.hasSecret).toBe(false);
    const set = await api
      .as(t.admin)
      .patch(`/v2/lead-sources/${s.id}`)
      .send({ rowVersion: s.rowVersion, secret: 'first-shared-secret' });
    expect(set.body.hasSecret).toBe(true);
    const keep = await api
      .as(t.admin)
      .patch(`/v2/lead-sources/${s.id}`)
      .send({ rowVersion: set.body.rowVersion, name: 'Secrets kept' });
    expect(keep.body.hasSecret).toBe(true);
    const clear = await api
      .as(t.admin)
      .patch(`/v2/lead-sources/${s.id}`)
      .send({ rowVersion: keep.body.rowVersion, secret: null });
    expect(clear.body.hasSecret).toBe(false);
    expect((await api.hook(s.hookPath, { name: 'No Secret', phone: '98000 20001' })).status).toBe(
      200,
    );
  });

  it('delete removes the source and its events, stops its URL, and leaves the contacts it made', async () => {
    const s = await api.source(t.admin, { name: 'Doomed', ...IN });
    await api.hook(s.hookPath, { name: 'Survivor', phone: '98000 30001' });
    const del = await api.as(t.admin).delete(`/v2/lead-sources/${s.id}`);
    expect(del.status).toBe(204);
    expect((await api.hook(s.hookPath, { name: 'After', phone: '98000 30002' })).status).toBe(404);
    expect((await api.as(t.admin).get(`/v2/lead-sources/${s.id}`)).status).toBe(404);
    expect(
      await api.rows(
        t.orgId,
        `SELECT 1 FROM lead_events e WHERE e.org_id = $1 AND e.external_id LIKE 'h:%' AND e.payload->'raw'->>'name' = 'Survivor'`,
      ),
    ).toHaveLength(0);
    expect(await api.contactsWithPhone(t.orgId, '+919800030001')).toHaveLength(1);
    expect((await api.as(t.admin).delete(`/v2/lead-sources/${s.id}`)).status).toBe(404);
  });

  it('rotating the token gives a new one once and kills the old URL at once; a connector has no token to rotate', async () => {
    const s = await api.source(t.admin, { name: 'Rotated', ...IN });
    const res = await api.as(t.admin).post(`/v2/lead-sources/${s.id}/rotate-token`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.body.token).not.toBe(s.token);
    expect(res.body.tokenHint).toBe(res.body.token.slice(-4));
    expect((await api.hook(s.hookPath, { name: 'Old', phone: '98000 40001' })).status).toBe(404);
    expect((await api.hook(res.body.hookPath, { name: 'New', phone: '98000 40002' })).status).toBe(
      200,
    );
    const stored = await api.rows(
      t.orgId,
      `SELECT token_hash FROM lead_sources WHERE org_id = $1 AND uuid = $2::uuid`,
      [s.id],
    );
    expect(stored[0]!.token_hash).toBe(sha(res.body.token));
    expect(
      JSON.stringify((await api.as(t.admin).get(`/v2/lead-sources/${s.id}`)).body),
    ).not.toContain(res.body.token);

    const [connector] = await h.owner
      .query(
        `INSERT INTO lead_sources (org_id, kind, name, external_ref) VALUES ($1, 'connector', 'Portal', 'ref-1') RETURNING uuid`,
        [t.orgId],
      )
      .then((r) => r.rows);
    expect(
      (await api.as(t.admin).post(`/v2/lead-sources/${connector.uuid}/rotate-token`)).status,
    ).toBe(422);
  });

  it('a webhook source cannot exist without a token (the database says so)', async () => {
    await expect(
      h.owner.query(
        `INSERT INTO lead_sources (org_id, kind, name) VALUES ($1, 'webhook', 'No token')`,
        [t.orgId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('defaults and mapping are validated against the workspace (L-05, L-07, L-08)', () => {
  let a: Tenant;
  let b: Tenant;
  beforeAll(async () => {
    a = await api.signup('valida');
    b = await api.signup('validb');
  });

  const post = (body: Record<string, unknown>) =>
    api
      .as(a.admin)
      .post('/v2/lead-sources')
      .send({ name: `V ${Math.random()}`, ...body });

  it('an owner or notify user must be an active member of THIS workspace', async () => {
    const foreign = await api.userUuidById(b.adminUserId);
    for (const defaults of [
      { owner: { mode: 'fixed', userIds: [foreign] } },
      { notify: { userIds: [foreign] } },
    ]) {
      const res = await post({ defaults });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.code).toBe('LEAD_DEFAULTS_INVALID');
      expect(res.body.errors[0].message).toContain(foreign);
    }
    const mine = await api.userUuidById(a.adminUserId);
    expect((await post({ defaults: { owner: { mode: 'fixed', userIds: [mine] } } })).status).toBe(
      201,
    );
    const member = await api.member(a, 'gone', []);
    const gone = await api.userUuidById(member.userId);
    await h.owner.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [member.userId]);
    expect((await post({ defaults: { owner: { mode: 'fixed', userIds: [gone] } } })).status).toBe(
      422,
    );
  });

  it('the owner rule must be consistent: fixed is one user, round robin at least two', async () => {
    const mine = await api.userUuidById(a.adminUserId);
    expect((await post({ defaults: { owner: { mode: 'fixed', userIds: [] } } })).status).toBe(422);
    expect(
      (await post({ defaults: { owner: { mode: 'round_robin', userIds: [mine] } } })).status,
    ).toBe(422);
  });

  it("a deal rule: the pipeline and stage must be this workspace's, and the stage must be in the pipeline", async () => {
    const mine = await api.defaultPipeline(a.admin);
    const theirs = await api.defaultPipeline(b.admin);
    const firstStage = Object.values(mine.stage)[0]!;
    const theirStage = Object.values(theirs.stage)[0]!;
    expect(
      (await post({ defaults: { deal: { enabled: true, pipelineId: theirs.pipeline.id } } })).body
        .code,
    ).toBe('LEAD_DEFAULTS_INVALID');
    expect(
      (
        await post({
          defaults: {
            deal: { enabled: true, pipelineId: mine.pipeline.id, stageId: theirStage.id },
          },
        })
      ).body.code,
    ).toBe('LEAD_DEFAULTS_INVALID');
    expect(
      (await post({ defaults: { deal: { enabled: true, stageId: firstStage.id } } })).body.errors[0]
        .message,
    ).toBe('pipeline_required');
    const other = await api.as(a.admin).post('/v2/pipelines').send({ name: 'Second pipeline' });
    if (other.status === 201) {
      const otherStage = other.body.stages?.[0];
      if (otherStage) {
        const res = await post({
          defaults: {
            deal: { enabled: true, pipelineId: mine.pipeline.id, stageId: otherStage.id },
          },
        });
        expect(res.body.errors[0].message).toBe('stage_not_in_pipeline');
      }
    }
    expect(
      (
        await post({
          defaults: {
            deal: { enabled: true, pipelineId: mine.pipeline.id, stageId: firstStage.id },
          },
        })
      ).status,
    ).toBe(201);
  });

  it('a mapped custom property must be an existing contact property that a lead can fill', async () => {
    const res = await post({ mapping: { customFields: { ghost: 'x' } } });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('LEAD_MAPPING_INVALID');
    expect(res.body.errors).toEqual([
      { path: 'mapping.customFields.ghost', message: 'unknown_property' },
    ]);
    const section = await api
      .as(b.admin)
      .post('/v2/field-sections')
      .send({ moduleKey: 'contacts', name: 'B data' });
    await api.as(b.admin).post('/v2/fields').send({
      moduleKey: 'contacts',
      sectionId: section.body.id,
      key: 'only_in_b',
      label: 'Only in B',
      fieldType: 'text',
    });
    // Another workspace's property is not this workspace's.
    expect((await post({ mapping: { customFields: { only_in_b: 'x' } } })).status).toBe(422);
  });
});

describe('the complete webhook address (BL-061)', () => {
  const was = process.env.APP_URL;
  afterAll(() => {
    if (was === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = was;
  });

  it('create, rotate and the list build it from the configured public API address', async () => {
    const t = await api.signup('hookurl');
    process.env.APP_URL = 'https://api.acme.test/';
    const s = await api.source(t.admin, { name: 'Addressed' });
    expect(s.hookUrl).toBe(`https://api.acme.test/v2/public/lead-hooks/${s.token}`);
    expect(s.hookUrlProblem).toBeNull();
    const rotated = await api.as(t.admin).post(`/v2/lead-sources/${s.id}/rotate-token`);
    expect(rotated.body.hookUrl).toBe(
      `https://api.acme.test/v2/public/lead-hooks/${rotated.body.token}`,
    );
    const list = await api.as(t.admin).get('/v2/lead-sources');
    expect(list.body.hookAddress).toEqual({ baseUrl: 'https://api.acme.test', problem: null });
    // a read never carries the token, so never the complete address of a hook either
    expect(JSON.stringify(list.body.data)).not.toContain('lead-hooks');
  });

  it('says why there is no address instead of guessing one when the setting is missing', async () => {
    const t = await api.signup('hookurl2');
    delete process.env.APP_URL;
    const s = await api.source(t.admin, { name: 'Unaddressed' });
    expect(s.hookUrl).toBeNull();
    expect(s.hookUrlProblem).toBe('base_url_not_configured');
    expect(s.hookPath).toBe(`/v2/public/lead-hooks/${s.token}`);
    const list = await api.as(t.admin).get('/v2/lead-sources');
    expect(list.body.hookAddress).toEqual({ baseUrl: null, problem: 'base_url_not_configured' });
  });
});

describe('plan gating (L-12)', () => {
  it('the lead_sources cap counts sources, and a workspace at the cap gets 422 PLAN_LIMIT_REACHED', async () => {
    const t = await api.signup('cap');
    await api.setOverrides(t.orgId, { limits: { lead_sources: 1 } });
    await api.source(t.admin, { name: 'First' });
    const res = await api.as(t.admin).post('/v2/lead-sources').send({ name: 'Second' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PLAN_LIMIT_REACHED');
    // The screen says "You have used 1 of 1 lead sources" from these (BL-061).
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        { path: 'limit', message: 'lead_sources' },
        { path: 'used', message: '1' },
        { path: 'limitValue', message: '1' },
      ]),
    );
    await api.setOverrides(t.orgId, { limits: { lead_sources: 2 } });
    expect((await api.as(t.admin).post('/v2/lead-sources').send({ name: 'Second' })).status).toBe(
      201,
    );
  });

  it('a plan without the feature locks every management route with 422 PLAN_FEATURE_LOCKED', async () => {
    const t = await api.signup('lock');
    const s = await api.source(t.admin, { name: 'Locked soon' });
    await api.setOverrides(t.orgId, { features: { lead_sources: false } });
    for (const r of [
      await api.as(t.admin).get('/v2/lead-sources'),
      await api.as(t.admin).get(`/v2/lead-sources/${s.id}`),
      await api.as(t.admin).post('/v2/lead-sources').send({ name: 'x' }),
      await api.as(t.admin).get(`/v2/lead-sources/${s.id}/events`),
    ]) {
      expect(r.status).toBe(422);
      expect(r.body.code).toBe('PLAN_FEATURE_LOCKED');
      expect(r.body.errors).toEqual(
        expect.arrayContaining([{ path: 'feature', message: 'lead_sources' }]),
      );
    }
  });
});

describe('mapping preview (L-05)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('prev');
  });

  it('with nothing received and nothing posted there is nothing to preview', async () => {
    const s = await api.source(t.admin, { name: 'Empty' });
    const res = await api.as(t.admin).post(`/v2/lead-sources/${s.id}/mapping-preview`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      basedOn: 'none',
      usable: false,
      reasons: ['no_payload'],
      eventId: null,
    });
  });

  it('a posted payload is mapped by the saved mapping, or by a draft the admin has not saved', async () => {
    const s = await api.source(t.admin, { name: 'Draft', ...IN });
    const payload = {
      who: 'Ada L',
      tel: '98765 43210',
      mail: 'ADA@X.IO',
      lead: { campaign: 'Spring', form: 'F9' },
    };
    const saved = await api
      .as(t.admin)
      .post(`/v2/lead-sources/${s.id}/mapping-preview`)
      .send({ payload });
    expect(saved.body.contact).toMatchObject({
      name: null,
      phone: '+919876543210',
      phoneRaw: '98765 43210',
    });
    expect(saved.body.basedOn).toBe('payload');
    expect(saved.body.attribution).toMatchObject({ campaign: 'Spring', form: 'F9' });
    expect(saved.body.availablePaths).toEqual(
      expect.arrayContaining(['who', 'tel', 'mail', 'lead.campaign']),
    );

    const draft = await api
      .as(t.admin)
      .post(`/v2/lead-sources/${s.id}/mapping-preview`)
      .send({ payload, mapping: { name: 'who', email: 'mail' } });
    expect(draft.body.contact).toMatchObject({
      name: 'Ada L',
      email: 'ada@x.io',
      phone: '+919876543210',
    });
    expect(draft.body.usable).toBe(true);
    // Nothing was saved by previewing.
    expect((await api.as(t.admin).get(`/v2/lead-sources/${s.id}`)).body.mapping).toEqual({});
    expect(
      await api.rows(
        t.orgId,
        `SELECT 1 FROM lead_events e JOIN lead_sources s ON s.org_id = e.org_id AND s.id = e.source_id WHERE e.org_id = $1 AND s.uuid = $2::uuid`,
        [s.id],
      ),
    ).toHaveLength(0);

    const countryChange = await api
      .as(t.admin)
      .post(`/v2/lead-sources/${s.id}/mapping-preview`)
      .send({ payload: { phone: '07700 900123' }, defaults: { countryCode: '44' } });
    expect(countryChange.body.contact.phone).toBe('+447700900123');
    const unreadable = await api
      .as(t.admin)
      .post(`/v2/lead-sources/${s.id}/mapping-preview`)
      .send({ payload: { phone: 'tomorrow' } });
    expect(unreadable.body).toMatchObject({ usable: false, reasons: ['invalid_phone'] });
  });

  it('without a payload it works from the last real one the source still holds, and reading it is audited', async () => {
    const s = await api.source(t.admin, { name: 'From last', ...IN });
    await api.hook(s.hookPath, { full_name: 'Last Real', phone: '98000 50001', budget: 'x' });
    const before = Number(
      (
        await api.rows(
          t.orgId,
          `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'lead_events' AND action = 'export'`,
        )
      )[0]!.n,
    );
    const res = await api.as(t.admin).post(`/v2/lead-sources/${s.id}/mapping-preview`).send({});
    expect(res.body).toMatchObject({ basedOn: 'event', usable: true });
    expect(res.body.contact).toMatchObject({ name: 'Last Real', phone: '+919800050001' });
    expect(res.body.eventId).toMatch(/^[0-9a-f-]{36}$/);
    const after = Number(
      (
        await api.rows(
          t.orgId,
          `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'lead_events' AND action = 'export'`,
        )
      )[0]!.n,
    );
    expect(after).toBe(before + 1);

    const byId = await api
      .as(t.admin)
      .post(`/v2/lead-sources/${s.id}/mapping-preview`)
      .send({ eventId: res.body.eventId });
    expect(byId.body.eventId).toBe(res.body.eventId);
    expect(
      (
        await api
          .as(t.admin)
          .post(`/v2/lead-sources/${s.id}/mapping-preview`)
          .send({ eventId: '5c1e7a40-1111-4222-8333-444455556666' })
      ).status,
    ).toBe(404);
  });
});

describe('events (L-11, L-17)', () => {
  let t: Tenant;
  let s: CreatedSource;
  beforeAll(async () => {
    t = await api.signup('events');
    s = await api.source(t.admin, { name: 'Events', externalIdPath: 'id', ...IN });
    for (let i = 1; i <= 5; i++)
      await api.hook(s.hookPath, { id: `E-${i}`, name: `Person ${i}`, phone: `9800${i} 60001` });
    await api.hook(s.hookPath, { id: 'E-6', note: 'nothing usable' });
  });

  it('lists newest first and pages by cursor without gaps or repeats', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: {
        status: number;
        body: {
          data: Array<{ externalId: string }>;
          page: { nextCursor: string | null; hasMore: boolean };
        };
      } = await api
        .as(t.admin)
        .get(`/v2/lead-sources/${s.id}/events?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.data.map((e) => e.externalId));
      cursor = res.body.page.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(seen).toEqual(['E-6', 'E-5', 'E-4', 'E-3', 'E-2', 'E-1']);
    expect(pages).toBe(3);
  });

  it('filters by status', async () => {
    const review = await api.as(t.admin).get(`/v2/lead-sources/${s.id}/events?status=needs_review`);
    expect(review.body.data.map((e: { externalId: string }) => e.externalId)).toEqual(['E-6']);
    expect(review.body.data[0]).toMatchObject({
      reason: 'no_contact_point',
      contactId: null,
      hasPayload: true,
    });
    const created = await api
      .as(t.admin)
      .get(`/v2/lead-sources/${s.id}/events?status=created&limit=100`);
    expect(created.body.data).toHaveLength(5);
    expect(created.body.data[0].contactId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await api.as(t.admin).get(`/v2/lead-sources/${s.id}/events?status=bogus`)).status).toBe(
      422,
    );
  });

  it("opening an event's payload is audited and returns the payload; a purged one returns null", async () => {
    const ev = (await api.leadEvents(t.orgId, s.id))[0]!;
    const before = Number(
      (
        await api.rows(
          t.orgId,
          `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'lead_events' AND action = 'export' AND record_id = $2`,
          [ev.id],
        )
      )[0]!.n,
    );
    const res = await api.as(t.admin).get(`/v2/lead-sources/${s.id}/events/${ev.uuid}`);
    expect(res.status).toBe(200);
    expect(res.body.payload.raw).toMatchObject({ id: 'E-1' });
    const after = Number(
      (
        await api.rows(
          t.orgId,
          `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'lead_events' AND action = 'export' AND record_id = $2`,
          [ev.id],
        )
      )[0]!.n,
    );
    expect(after).toBe(before + 1);

    await h.owner.query(
      `UPDATE lead_events SET payload = NULL, payload_purged_at = now() WHERE id = $1`,
      [ev.id],
    );
    const purged = await api.as(t.admin).get(`/v2/lead-sources/${s.id}/events/${ev.uuid}`);
    expect(purged.body).toMatchObject({ payload: null, hasPayload: false, payloadExpiresAt: null });
  });

  it('an event of another source or workspace is a 404', async () => {
    const other = await api.source(t.admin, { name: 'Other source' });
    const ev = (await api.leadEvents(t.orgId, s.id))[1]!;
    expect(
      (await api.as(t.admin).get(`/v2/lead-sources/${other.id}/events/${ev.uuid}`)).status,
    ).toBe(404);
    expect(
      (await api.as(t.admin).post(`/v2/lead-sources/${other.id}/events/${ev.uuid}/retry`)).status,
    ).toBe(404);
    const t2 = await api.signup('events2');
    expect((await api.as(t2.admin).get(`/v2/lead-sources/${s.id}/events/${ev.uuid}`)).status).toBe(
      404,
    );
  });

  it('a paused source cannot be tested or retried (409), and says so', async () => {
    const p = await api.source(t.admin, { name: 'Pausable', ...IN });
    await api.hook(p.hookPath, { nothing: 'usable' });
    const ev = (await api.leadEvents(t.orgId, p.id))[0]!;
    await api
      .as(t.admin)
      .patch(`/v2/lead-sources/${p.id}`)
      .send({ rowVersion: p.rowVersion, status: 'paused' });
    const test = await api.as(t.admin).post(`/v2/lead-sources/${p.id}/test`).send({});
    expect(test.status).toBe(409);
    expect(test.body.code).toBe('LEAD_SOURCE_PAUSED');
    const retry = await api.as(t.admin).post(`/v2/lead-sources/${p.id}/events/${ev.uuid}/retry`);
    expect(retry.status).toBe(409);
    expect(retry.body.code).toBe('LEAD_SOURCE_PAUSED');
  });
});

describe('audit and outbox (L-12)', () => {
  it('create, update, rotate and delete each leave an audit row and an outbox event, and none carries a token or a secret', async () => {
    const t = await api.signup('audit');
    const s = await api.source(t.admin, { name: 'Audited', secret: 'audit-shared-secret', ...IN });
    const upd = await api
      .as(t.admin)
      .patch(`/v2/lead-sources/${s.id}`)
      .send({ rowVersion: s.rowVersion, name: 'Audited v2', secret: 'audit-shared-secret-2' });
    const rot = await api.as(t.admin).post(`/v2/lead-sources/${s.id}/rotate-token`);
    await api.as(t.admin).delete(`/v2/lead-sources/${s.id}`);

    const audit = await api.rows(
      t.orgId,
      `SELECT action, delta, actor_type FROM audit_log WHERE org_id = $1 AND module = 'lead_sources' ORDER BY id`,
    );
    expect(audit.map((a) => a.action)).toEqual(['insert', 'update', 'update', 'delete']);
    expect(audit.every((a) => a.actor_type === 'user')).toBe(true);
    expect(audit[1]!.delta).toHaveProperty('name');
    expect(audit[2]!.delta).toHaveProperty('tokenHint');

    const events = await api.rows(
      t.orgId,
      `SELECT event_type, payload FROM event_outbox WHERE org_id = $1 AND aggregate_module = 'lead_sources' ORDER BY id`,
    );
    expect(events.map((e) => e.event_type)).toEqual([
      'lead_source.created',
      'lead_source.updated',
      'lead_source.token_rotated',
      'lead_source.deleted',
    ]);

    const everything = JSON.stringify([audit, events]);
    for (const secret of [
      s.token,
      rot.body.token,
      'audit-shared-secret',
      'audit-shared-secret-2',
      sha(s.token),
      sha(rot.body.token),
    ]) {
      expect(everything).not.toContain(secret);
    }
    expect(upd.status).toBe(200);
  });

  it('each lead outcome leaves an audit row on the event and an outbox event', async () => {
    const t = await api.signup('outcome');
    const s = await api.source(t.admin, { name: 'Outcomes', ...IN });
    await api.hook(s.hookPath, { name: 'Out Come', phone: '98000 70001' });
    await api.hook(s.hookPath, { name: 'Out Come', phone: '98000 70001', again: 1 });
    await api.hook(s.hookPath, { nothing: 'usable' });
    const audit = await api.rows(
      t.orgId,
      `SELECT action, delta FROM audit_log WHERE org_id = $1 AND module = 'lead_events' ORDER BY id`,
    );
    expect(audit.filter((a) => a.action === 'insert')).toHaveLength(3);
    expect(audit.map((a) => a.delta?.status?.new).filter(Boolean)).toEqual([
      'created',
      'updated',
      'needs_review',
    ]);
    const types = (
      await api.rows(
        t.orgId,
        `SELECT event_type FROM event_outbox WHERE org_id = $1 AND aggregate_module = 'leads' ORDER BY id`,
      )
    ).map((r) => r.event_type);
    expect(types).toEqual(['lead.created', 'lead.updated', 'lead.needs_review']);
  });
});

describe('retention of raw payloads (L-12)', () => {
  it("the sweep purges only payloads past their retention, keeps the event and the contact, and uses the source's own period", async () => {
    const t = await api.signup('retain');
    const short = await api.source(t.admin, { name: 'One day', rawRetentionDays: 1, ...IN });
    const long = await api.source(t.admin, { name: 'Default', ...IN });
    await api.hook(short.hookPath, { name: 'Short Keep', phone: '98000 80001' });
    await api.hook(long.hookPath, { name: 'Long Keep', phone: '98000 80002' });
    const [se] = await api.leadEvents(t.orgId, short.id);
    const [le] = await api.leadEvents(t.orgId, long.id);
    const days = (e: { payload_expires_at: Date; received_at: Date }) =>
      Math.round(
        (new Date(e.payload_expires_at).getTime() - new Date(e.received_at).getTime()) / 86_400_000,
      );
    expect(days(se! as never)).toBe(1);
    expect(days(le! as never)).toBe(30);

    const sweep = new LeadRetentionSweepService(
      h.app.get(DatabaseService),
      new LeadSyncRunsRepository(),
    );
    expect(await sweep.sweep()).toBe(0);

    await h.owner.query(
      `UPDATE lead_events SET payload_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [se!.id],
    );
    expect(await sweep.sweep()).toBe(1);

    const after = await api.leadEvents(t.orgId);
    const sev = after.find((e) => e.id === se!.id)!;
    const lev = after.find((e) => e.id === le!.id)!;
    expect(sev.payload).toBeNull();
    expect(sev.payload_purged_at).not.toBeNull();
    expect(sev.status).toBe('created');
    expect(sev.contact_id).not.toBeNull();
    expect(lev.payload).not.toBeNull();
    expect(await api.contactsWithPhone(t.orgId, '+919800080001')).toHaveLength(1);

    const list = await api.as(t.admin).get(`/v2/lead-sources/${short.id}/events`);
    expect(list.body.data[0]).toMatchObject({ hasPayload: false, payloadExpiresAt: null });
    // A second sweep finds nothing left.
    expect(await sweep.sweep()).toBe(0);
  });

  it('a redelivery of a purged failed event stores its payload again with a fresh clock', async () => {
    const t = await api.signup('retain2');
    const s = await api.source(t.admin, { name: 'Redo', externalIdPath: 'id', ...IN });
    await api.hook(s.hookPath, { id: 'R-1', note: 'nothing usable' });
    const [ev] = await api.leadEvents(t.orgId, s.id);
    await h.owner.query(
      `UPDATE lead_events SET status = 'failed', payload = NULL, payload_purged_at = now() WHERE id = $1`,
      [ev!.id],
    );
    await api.hook(s.hookPath, { id: 'R-1', name: 'Now Usable', phone: '98000 90001' });
    const [after] = await api.leadEvents(t.orgId, s.id);
    expect(after).toMatchObject({ status: 'created', attempts: 2, payload_purged_at: null });
    expect(after!.payload.raw).toMatchObject({ name: 'Now Usable' });
  });
});

describe('what the database guarantees by itself', () => {
  let a: Tenant;
  let b: Tenant;
  let sa: CreatedSource;
  let app: Client;
  beforeAll(async () => {
    a = await api.signup('dba');
    b = await api.signup('dbb');
    sa = await api.source(a.admin, { name: 'DB source', ...IN });
    await api.hook(sa.hookPath, { name: 'DB Lead', phone: '98000 99001' });
    app = new Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });

  it('row-level security is forced: the app role sees no lead data without a tenant, and only its own with one', async () => {
    for (const table of ['lead_sources', 'lead_events', 'contact_attributions']) {
      expect((await app.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, table).toBe(0);
    }
    await app.query('BEGIN');
    await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(b.orgId)]);
    const inB = await app.query(`SELECT count(*)::int AS n FROM lead_sources`);
    await app.query('ROLLBACK');
    expect(inB.rows[0].n).toBe(0);
    await app.query('BEGIN');
    await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(a.orgId)]);
    const inA = await app.query(`SELECT count(*)::int AS n FROM lead_sources`);
    await app.query('ROLLBACK');
    expect(inA.rows[0].n).toBe(1);
  });

  it('the public lookup is a SECURITY DEFINER function that returns ids and a status only', async () => {
    const res = await app.query(`SELECT * FROM lead_source_lookup($1)`, [sha(sa.token)]);
    expect(res.rows).toHaveLength(1);
    expect(Object.keys(res.rows[0]).sort()).toEqual([
      'route_org_id',
      'route_source_id',
      'route_status',
    ]);
    expect(Number(res.rows[0].route_org_id)).toBe(a.orgId);
    expect(res.rows[0].route_status).toBe('active');
    expect(
      (await app.query(`SELECT * FROM lead_source_lookup($1)`, ['0'.repeat(64)])).rows,
    ).toHaveLength(0);
    // It lifted RLS only inside itself.
    expect((await app.query(`SELECT count(*)::int AS n FROM lead_sources`)).rows[0].n).toBe(0);
  });

  it("composite foreign keys: an event cannot point at another workspace's source, contact or deal", async () => {
    const [bContact] = (
      await h.owner.query(
        `INSERT INTO contacts (org_id, name) VALUES ($1, 'B only') RETURNING id`,
        [b.orgId],
      )
    ).rows;
    const [aSource] = await api.rows(
      a.orgId,
      `SELECT id FROM lead_sources WHERE org_id = $1 LIMIT 1`,
    );
    await expect(
      h.owner.query(
        `INSERT INTO lead_events (org_id, source_id, external_id) VALUES ($1, $2, 'x')`,
        [b.orgId, aSource!.id],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      h.owner.query(
        `INSERT INTO lead_events (org_id, source_id, external_id, contact_id) VALUES ($1, $2, 'y', $3)`,
        [a.orgId, aSource!.id, bContact.id],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      h.owner.query(
        `INSERT INTO contact_attributions (org_id, contact_id, source_label) VALUES ($1, $2, 'x')`,
        [a.orgId, bContact.id],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('(source, external id) is unique in the database, not only in the code', async () => {
    const [aSource] = await api.rows(
      a.orgId,
      `SELECT id FROM lead_sources WHERE org_id = $1 LIMIT 1`,
    );
    await h.owner.query(
      `INSERT INTO lead_events (org_id, source_id, external_id) VALUES ($1, $2, 'unique-1')`,
      [a.orgId, aSource!.id],
    );
    await expect(
      h.owner.query(
        `INSERT INTO lead_events (org_id, source_id, external_id) VALUES ($1, $2, 'unique-1')`,
        [a.orgId, aSource!.id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('attribution is append-only: what a touch says cannot be edited; its links may be cleared', async () => {
    const [row] = await api.rows(
      a.orgId,
      `SELECT id FROM contact_attributions WHERE org_id = $1 LIMIT 1`,
    );
    await expect(
      h.owner.query(`UPDATE contact_attributions SET campaign = 'rewritten' WHERE id = $1`, [
        row!.id,
      ]),
    ).rejects.toThrow(/append-only/);
    await expect(
      h.owner.query(
        `UPDATE contact_attributions SET captured_at = now() - interval '1 year' WHERE id = $1`,
        [row!.id],
      ),
    ).rejects.toThrow(/append-only/);
    await h.owner.query(`UPDATE contact_attributions SET source_id = NULL WHERE id = $1`, [
      row!.id,
    ]);
  });
});
