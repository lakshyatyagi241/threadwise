import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { QUEUES } from '../../../src/infra/queue/queues';
import {
  SegmentActionsService,
  SegmentsRepository,
  SegmentsService,
} from '../../../src/modules/crm';
import { SegmentCountSweepService } from '../../../src/modules/crm/segments/segment-count-sweep.service';
import {
  Api,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * Segments end to end through HTTP: CRUD, visibility and permissions, preview, the `segmentId`
 * contact filter, "save this filter", the actions, references to things that were deleted, the
 * cached count, and what other domains call. One app, one database; each describe block works in an
 * organization of its own.
 */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const cond = (field: string, operator: string, value?: unknown) => ({
  type: 'condition',
  field,
  operator,
  ...(value === undefined ? {} : { value }),
});
const rules = (...children: unknown[]) => ({ type: 'group', combinator: 'and', children });
const names = (rows: Array<{ name: string | null }>) => rows.map((r) => r.name).sort();

/** The grants of the front-line preset the migration and sign-up give. */
const AGENT: Grant[] = [
  ['record.segments.read'],
  ['record.segments.create'],
  ['record.segments.update', 'own'],
  ['record.segments.delete', 'own'],
  ['record.contacts.read', 'own'],
  ['record.contacts.update', 'own'],
  ['record.contacts.export', 'own'],
  ['record.tags.read'],
];

const create = (token: string, body: Record<string, unknown>) =>
  api.as(token).post('/v2/segments').send(body);

describe('creating, reading, updating and deleting', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('seg-crud');
    await api.seedContacts(t, [
      { name: 'Aarav Sharma', phone: '+919800000001', source: 'import' },
      { name: 'Bina Rao', phone: '+919800000002', source: 'web' },
      { name: 'Chitra Iyer', phone: '+919800000003', source: 'import' },
    ]);
  });

  it('creates a private segment owned by the caller, with its member count', async () => {
    const res = await create(t.admin, {
      name: 'Imported',
      description: 'Everyone from a file',
      color: '#22C55E',
      rules: rules(cond('source', 'equals', 'import')),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Imported',
      description: 'Everyone from a file',
      color: '#22C55E',
      visibility: 'private',
      memberCount: 2,
      countApproximate: false,
      invalidConditions: [],
      canEdit: true,
      rulesVersion: 1,
      rowVersion: 1,
    });
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.ownerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.memberCountAt).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toMatch(/"(orgId|org_id|ownerId":\s*\d)/);
  });

  it('a name another segment has (any case) is 409 SEG_NAME_TAKEN and leaves no row, audit or event', async () => {
    const before = await api.auditCount(t.orgId, 'segments', 'insert');
    const events = (await api.events(t.orgId, 'segment.created')).length;
    const res = await create(t.admin, {
      name: '  IMPORTED ',
      rules: rules(cond('source', 'equals', 'web')),
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SEG_NAME_TAKEN');
    expect(await api.auditCount(t.orgId, 'segments', 'insert')).toBe(before);
    expect((await api.events(t.orgId, 'segment.created')).length).toBe(events);
  });

  it('a create writes one audit row and one segment.created event, in the same transaction', async () => {
    const before = await api.auditCount(t.orgId, 'segments', 'insert');
    const res = await create(t.admin, {
      name: 'Audited',
      rules: rules(cond('name', 'contains', 'a')),
    });
    expect(res.status).toBe(201);
    expect(await api.auditCount(t.orgId, 'segments', 'insert')).toBe(before + 1);
    const events = await api.events(t.orgId, 'segment.created');
    expect(events.at(-1)).toMatchObject({
      uuid: res.body.id,
      name: 'Audited',
      visibility: 'private',
    });
  });

  it('a repeated Idempotency-Key creates one segment', async () => {
    const send = () =>
      api
        .as(t.admin)
        .post('/v2/segments')
        .set('Idempotency-Key', 'seg-idem-1')
        .send({ name: 'Once', rules: rules(cond('name', 'contains', 'z')) });
    const a = await send();
    const b = await send();
    expect(a.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    const n = await h.owner.query(
      `SELECT count(*)::int AS n FROM segments WHERE org_id = $1 AND name = 'Once'`,
      [t.orgId],
    );
    expect(n.rows[0].n).toBe(1);
  });

  it('lists newest first with cursor paging, searches by name and filters by visibility', async () => {
    const all = await api.as(t.admin).get('/v2/segments?limit=2');
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(2);
    expect(all.body.page.hasMore).toBe(true);
    const second = await api
      .as(t.admin)
      .get(`/v2/segments?limit=2&cursor=${encodeURIComponent(all.body.page.nextCursor)}`);
    const seen = [...all.body.data, ...second.body.data].map((s: { id: string }) => s.id);
    expect(new Set(seen).size).toBe(seen.length);
    // newest first
    expect(all.body.data[0].createdAt >= all.body.data[1].createdAt).toBe(true);

    const found = await api.as(t.admin).get('/v2/segments?q=audit');
    expect(names(found.body.data)).toEqual(['Audited']);
    const shared = await api.as(t.admin).get('/v2/segments?visibility=shared');
    expect(shared.body.data).toEqual([]);
  });

  it('gets one by id; an unknown or malformed id is 404 / 400', async () => {
    const list = await api.as(t.admin).get('/v2/segments?q=Imported');
    const id = list.body.data[0].id;
    const got = await api.as(t.admin).get(`/v2/segments/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.name).toBe('Imported');
    expect(
      (await api.as(t.admin).get('/v2/segments/00000000-0000-4000-8000-000000000000')).status,
    ).toBe(404);
    expect((await api.as(t.admin).get('/v2/segments/not-a-uuid')).status).toBe(400);
  });

  describe('updating', () => {
    let id: string;
    beforeAll(async () => {
      const res = await create(t.admin, {
        name: 'To edit',
        rules: rules(cond('source', 'equals', 'web')),
      });
      id = res.body.id;
    });

    it('needs the rowVersion you read: current one passes and bumps it, a stale one is 409', async () => {
      const ok = await api
        .as(t.admin)
        .patch(`/v2/segments/${id}`)
        .send({ description: 'now with text', rowVersion: 1 });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body).toMatchObject({ description: 'now with text', rowVersion: 2 });
      const stale = await api
        .as(t.admin)
        .patch(`/v2/segments/${id}`)
        .send({ color: '#112233', rowVersion: 1 });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
      expect(
        (await api.as(t.admin).patch(`/v2/segments/${id}`).send({ color: '#112233' })).status,
      ).toBe(422);
    });

    it('absent keeps, null clears; a rename onto a taken name is 409 SEG_NAME_TAKEN', async () => {
      const cleared = await api
        .as(t.admin)
        .patch(`/v2/segments/${id}`)
        .send({ description: null, rowVersion: 2 });
      expect(cleared.body).toMatchObject({ description: null, name: 'To edit', rowVersion: 3 });
      const clash = await api
        .as(t.admin)
        .patch(`/v2/segments/${id}`)
        .send({ name: 'imported', rowVersion: 3 });
      expect(clash.status).toBe(409);
      expect(clash.body.code).toBe('SEG_NAME_TAKEN');
    });

    it('new rules are validated, recounted and the change is audited with a segment.updated event', async () => {
      const before = await api.auditCount(t.orgId, 'segments', 'update');
      const res = await api
        .as(t.admin)
        .patch(`/v2/segments/${id}`)
        .send({ rules: rules(cond('source', 'equals', 'import')), rowVersion: 3 });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.memberCount).toBe(2);
      expect(await api.auditCount(t.orgId, 'segments', 'update')).toBe(before + 1);
      const ev = (await api.events(t.orgId, 'segment.updated')).at(-1);
      expect(ev).toMatchObject({ uuid: id, rulesChanged: true });
      const bad = await api
        .as(t.admin)
        .patch(`/v2/segments/${id}`)
        .send({ rules: rules(cond('nope', 'equals', 'x')), rowVersion: res.body.rowVersion });
      expect(bad.status).toBe(422);
    });

    it('an edit that changes nothing is not a write', async () => {
      const cur = (await api.as(t.admin).get(`/v2/segments/${id}`)).body;
      const before = await api.auditCount(t.orgId, 'segments', 'update');
      const res = await api
        .as(t.admin)
        .patch(`/v2/segments/${id}`)
        .send({ name: cur.name, rowVersion: cur.rowVersion });
      expect(res.status).toBe(200);
      expect(res.body.rowVersion).toBe(cur.rowVersion);
      expect(await api.auditCount(t.orgId, 'segments', 'update')).toBe(before);
    });
  });

  it('deletes: 204, the segment is gone, its contacts are not, with an audit row and a segment.deleted event', async () => {
    const made = await create(t.admin, {
      name: 'Doomed',
      rules: rules(cond('name', 'contains', 'a')),
    });
    const before = await api.auditCount(t.orgId, 'segments', 'delete');
    const del = await api.as(t.admin).delete(`/v2/segments/${made.body.id}`);
    expect(del.status).toBe(204);
    expect((await api.as(t.admin).get(`/v2/segments/${made.body.id}`)).status).toBe(404);
    expect((await api.as(t.admin).delete(`/v2/segments/${made.body.id}`)).status).toBe(404);
    expect(await api.auditCount(t.orgId, 'segments', 'delete')).toBe(before + 1);
    expect((await api.events(t.orgId, 'segment.deleted')).at(-1)).toMatchObject({
      uuid: made.body.id,
      name: 'Doomed',
    });
    const contacts = await h.owner.query(
      `SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`,
      [t.orgId],
    );
    expect(contacts.rows[0].n).toBe(3);
  });
});

describe('rule validation at the edge', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('seg-val');
  });

  const post = (body: unknown) =>
    api
      .as(t.admin)
      .post('/v2/segments')
      .send(body as object);
  const err = (res: { body: { errors?: Array<{ path: string; message: string }> } }) =>
    (res.body.errors ?? []).map((e) => `${e.path}: ${e.message}`);

  it('refuses an unknown field, an unknown operator, an operator the field does not have and a bad value, with the path', async () => {
    const res = await post({
      name: 'Bad',
      rules: rules(
        cond('password_hash', 'equals', 'x'),
        cond('createdAt', 'contains', 'x'),
        cond('leadScore', 'gt', 'high'),
      ),
    });
    expect(res.status).toBe(422);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    const paths = (res.body.errors as Array<{ path: string }>).map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'rules.children.0.field',
        'rules.children.1.value',
        'rules.children.2.value',
      ]),
    );
    expect((await post({ name: 'Bad2', rules: rules(cond('name', 'regex', '.*')) })).status).toBe(
      422,
    );
  });

  it('refuses more than 3 levels, more than 50 conditions, empty groups and unknown keys', async () => {
    const leaf = cond('name', 'contains', 'a');
    const deep = {
      type: 'group',
      combinator: 'and',
      children: [
        {
          type: 'group',
          combinator: 'or',
          children: [
            {
              type: 'group',
              combinator: 'and',
              children: [{ type: 'group', combinator: 'or', children: [leaf] }],
            },
          ],
        },
      ],
    };
    expect((await post({ name: 'Deep', rules: deep })).status).toBe(422);
    expect(
      (
        await post({
          name: 'Many',
          rules: rules(...Array.from({ length: 51 }, (_, i) => cond('name', 'contains', `x${i}`))),
        })
      ).status,
    ).toBe(422);
    expect((await post({ name: 'Empty', rules: rules() })).status).toBe(422);
    expect((await post({ name: 'Extra', rules: { ...rules(leaf), sql: '1=1' } })).status).toBe(422);
    expect(
      (
        await post({
          name: 'Extra2',
          rules: rules(leaf),
          ownerId: '00000000-0000-4000-8000-000000000000',
        })
      ).status,
    ).toBe(422);
  });

  it('SQL in a value is stored as text and matches nothing; the table is untouched', async () => {
    await api.seedContacts(t, [{ name: 'Safe Person', phone: '+919800000009' }]);
    const res = await post({
      name: 'Injection',
      rules: rules(cond('name', 'equals', "'; DROP TABLE contacts; --")),
    });
    expect(res.status).toBe(201);
    expect(res.body.memberCount).toBe(0);
    const n = await h.owner.query(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [
      t.orgId,
    ]);
    expect(n.rows[0].n).toBe(1);
  });

  it('a tag, group, stage, status, user or property that does not exist is 422 SEG_RULES_INVALID, with the condition path', async () => {
    const missing = '3b241101-e2bb-4255-8caf-4136c566a962';
    const res = await post({
      name: 'Dangling',
      rules: rules(
        cond('tags', 'has_any', [missing]),
        cond('groups', 'has_any', [missing]),
        cond('owner', 'equals', missing),
        cond('lifecycleStage', 'equals', 'no_such_stage'),
        cond('status', 'equals', 'no_such_status'),
        cond('custom.no_such_field', 'equals', 'x'),
      ),
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SEG_RULES_INVALID');
    expect(err(res).map((e) => e.split(':')[0])).toEqual([
      'rules.children.0',
      'rules.children.1',
      'rules.children.2',
      'rules.children.3',
      'rules.children.4',
      'rules.children.5',
    ]);
  });

  it('a custom property is checked against its type: contains on a number is refused, between on a number works', async () => {
    const section = await api
      .as(t.admin)
      .post('/v2/field-sections')
      .send({ moduleKey: 'contacts', name: 'Seg' });
    await api.as(t.admin).post('/v2/fields').send({
      moduleKey: 'contacts',
      sectionId: section.body.id,
      key: 'budget',
      label: 'Budget',
      fieldType: 'integer',
    });
    const bad = await post({
      name: 'Budget text',
      rules: rules(cond('custom.budget', 'contains', '5')),
    });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('SEG_RULES_INVALID');
    const good = await post({
      name: 'Budget range',
      rules: rules(cond('custom.budget', 'between', { from: 10, to: 20 })),
    });
    expect(good.status, JSON.stringify(good.body)).toBe(201);
  });
});

describe('who can see and change what', () => {
  let t: Tenant;
  let agent: { token: string; userId: number };
  let agent2: { token: string; userId: number };
  let viewer: { token: string; userId: number };
  let nobody: { token: string; userId: number };
  let adminShared: string;
  let agentPrivate: string;
  let agentShared: string;
  const allRule = rules(cond('name', 'contains', 'e'));

  beforeAll(async () => {
    t = await api.signup('seg-perm');
    agent = await api.member(t, 'agent', AGENT);
    agent2 = await api.member(t, 'agenttwo', AGENT);
    viewer = await api.member(t, 'viewer', [['record.segments.read']]);
    nobody = await api.member(t, 'nobody', [['record.contacts.read']]);
    await api.seedContacts(t, [
      { name: 'Eve One', phone: '+919811000001', ownerId: agent.userId },
      { name: 'Eve Two', phone: '+919811000002', ownerId: agent.userId },
      { name: 'Eve Three', phone: '+919811000003', ownerId: agent2.userId },
      { name: 'Eve Four', phone: '+919811000004', ownerId: t.adminUserId },
      { name: 'Eve Five', phone: '+919811000005' },
    ]);
    adminShared = (
      await create(t.admin, { name: 'Admin shared', visibility: 'shared', rules: allRule })
    ).body.id;
    agentPrivate = (await create(agent.token, { name: 'Agent private', rules: allRule })).body.id;
    agentShared = (
      await create(agent.token, { name: 'Agent shared', visibility: 'shared', rules: allRule })
    ).body.id;
  });

  it('a private segment is visible to its owner and to admins only; to anyone else it does not exist', async () => {
    expect((await api.as(agent.token).get(`/v2/segments/${agentPrivate}`)).status).toBe(200);
    expect((await api.as(t.admin).get(`/v2/segments/${agentPrivate}`)).status).toBe(200);
    for (const other of [agent2.token, viewer.token]) {
      const res = await api.as(other).get(`/v2/segments/${agentPrivate}`);
      expect(res.status).toBe(404);
    }
    const seenByAgent2 = await api.as(agent2.token).get('/v2/segments');
    expect(names(seenByAgent2.body.data)).toEqual(['Admin shared', 'Agent shared']);
    const seenByAdmin = await api.as(t.admin).get('/v2/segments');
    expect(names(seenByAdmin.body.data)).toEqual(['Admin shared', 'Agent private', 'Agent shared']);
    expect(names((await api.as(agent.token).get('/v2/segments?mine=true')).body.data)).toEqual([
      'Agent private',
      'Agent shared',
    ]);
  });

  it('a hidden segment cannot be reached through its contacts, actions or the contact filter either', async () => {
    const as = api.as(agent2.token);
    expect((await as.get(`/v2/segments/${agentPrivate}/contacts`)).status).toBe(404);
    expect((await as.post(`/v2/segments/${agentPrivate}/export`).send({})).status).toBe(404);
    expect((await as.post(`/v2/segments/${agentPrivate}/tag`).send({ name: 'x' })).status).toBe(
      404,
    );
    expect((await as.post(`/v2/segments/${agentPrivate}/refresh-count`)).status).toBe(404);
    expect(
      (await as.patch(`/v2/segments/${agentPrivate}`).send({ name: 'mine now', rowVersion: 1 }))
        .status,
    ).toBe(404);
    expect((await as.delete(`/v2/segments/${agentPrivate}`)).status).toBe(404);
    const viaFilter = await as.get(`/v2/contacts?segmentId=${agentPrivate}`);
    expect(viaFilter.status).toBe(200);
    expect(viaFilter.body.data).toEqual([]);
  });

  it('making a private segment shared shows it to everyone who can read segments', async () => {
    const made = await create(agent.token, { name: 'Soon shared', rules: allRule });
    expect((await api.as(agent2.token).get(`/v2/segments/${made.body.id}`)).status).toBe(404);
    const shared = await api
      .as(agent.token)
      .patch(`/v2/segments/${made.body.id}`)
      .send({ visibility: 'shared', rowVersion: 1 });
    expect(shared.status).toBe(200);
    expect((await api.as(agent2.token).get(`/v2/segments/${made.body.id}`)).status).toBe(200);
  });

  it('update and delete follow the scope: own = segments I own, all = any', async () => {
    // agent2 can see agent's shared segment but not change it
    const patch = await api
      .as(agent2.token)
      .patch(`/v2/segments/${agentShared}`)
      .send({ name: 'Hijack', rowVersion: 1 });
    expect(patch.status).toBe(403);
    expect(patch.body.code).toBe('FORBIDDEN');
    expect((await api.as(agent2.token).delete(`/v2/segments/${agentShared}`)).status).toBe(403);
    // the owner can
    const own = await api
      .as(agent.token)
      .patch(`/v2/segments/${agentShared}`)
      .send({ description: 'mine', rowVersion: 1 });
    expect(own.status).toBe(200);
    expect(own.body.canEdit).toBe(true);
    // and canEdit tells the screen
    const asOther = await api.as(agent2.token).get(`/v2/segments/${agentShared}`);
    expect(asOther.body.canEdit).toBe(false);
    // an admin (update scope all) can change anyone's
    const byAdmin = await api
      .as(t.admin)
      .patch(`/v2/segments/${agentShared}`)
      .send({ color: '#445566', rowVersion: own.body.rowVersion });
    expect(byAdmin.status).toBe(200);
    // a copy of the admin's segment owned by admin cannot be deleted by an agent
    expect((await api.as(agent.token).delete(`/v2/segments/${adminShared}`)).status).toBe(403);
  });

  it('without the permission the route is 403: no segments.read, no segments.create', async () => {
    expect((await api.as(nobody.token).get('/v2/segments')).status).toBe(403);
    expect((await api.as(nobody.token).get(`/v2/segments/${adminShared}`)).status).toBe(403);
    expect((await create(viewer.token, { name: 'Nope', rules: allRule })).status).toBe(403);
    expect((await api.as(viewer.token).delete(`/v2/segments/${adminShared}`)).status).toBe(403);
    // a contacts filter naming a segment the caller may not read is empty, not an error and not a leak
    const res = await api.as(nobody.token).get(`/v2/contacts?segmentId=${adminShared}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("the member count and the contacts follow the caller's contact scope, and no contacts.read means no count", async () => {
    expect((await api.as(t.admin).get(`/v2/segments/${adminShared}`)).body.memberCount).toBe(5);
    expect((await api.as(agent.token).get(`/v2/segments/${adminShared}`)).body.memberCount).toBe(2);
    expect((await api.as(agent2.token).get(`/v2/segments/${adminShared}`)).body.memberCount).toBe(
      1,
    );
    expect(
      (await api.as(viewer.token).get(`/v2/segments/${adminShared}`)).body.memberCount,
    ).toBeNull();

    const members = await api.as(agent.token).get(`/v2/segments/${adminShared}/contacts`);
    expect(names(members.body.data)).toEqual(['Eve One', 'Eve Two']);
    const adminMembers = await api.as(t.admin).get(`/v2/segments/${adminShared}/contacts`);
    expect(adminMembers.body.data).toHaveLength(5);
    // the segment screen without contacts.read cannot list contacts
    expect((await api.as(viewer.token).get(`/v2/segments/${adminShared}/contacts`)).status).toBe(
      403,
    );
  });

  it('the usage lookup lists only the segments the caller can see', async () => {
    const tag = (await api.as(t.admin).post('/v2/tags').send({ name: 'perm-tag' })).body.id;
    await create(agent.token, {
      name: 'Uses tag (private)',
      rules: rules(cond('tags', 'has_any', [tag])),
    });
    await create(t.admin, {
      name: 'Uses tag (shared)',
      visibility: 'shared',
      rules: rules(cond('tags', 'has_any', [tag])),
    });
    const adminSees = await api.as(t.admin).get(`/v2/segments/usage?kind=tag&ref=${tag}`);
    expect(names(adminSees.body.data)).toEqual(['Uses tag (private)', 'Uses tag (shared)']);
    const other = await api.as(agent2.token).get(`/v2/segments/usage?kind=tag&ref=${tag}`);
    expect(names(other.body.data)).toEqual(['Uses tag (shared)']);
  });
});

describe('a workspace never sees another one', () => {
  it('another workspace gets 404 for the id, an empty list, and no contacts from the filter', async () => {
    const a = await api.signup('seg-iso-a');
    const b = await api.signup('seg-iso-b');
    await api.seedContacts(a, [{ name: 'Mine', phone: '+919822000001' }]);
    await api.seedContacts(b, [{ name: 'Theirs', phone: '+919822000002' }]);
    const made = await create(a.admin, {
      name: 'Secret',
      visibility: 'shared',
      rules: rules(cond('name', 'contains', 'e')),
    });
    expect((await api.as(b.admin).get(`/v2/segments/${made.body.id}`)).status).toBe(404);
    expect((await api.as(b.admin).get('/v2/segments')).body.data).toEqual([]);
    expect(
      (
        await api
          .as(b.admin)
          .patch(`/v2/segments/${made.body.id}`)
          .send({ name: 'x', rowVersion: 1 })
      ).status,
    ).toBe(404);
    expect((await api.as(b.admin).delete(`/v2/segments/${made.body.id}`)).status).toBe(404);
    const viaFilter = await api.as(b.admin).get(`/v2/contacts?segmentId=${made.body.id}`);
    expect(viaFilter.body.data).toEqual([]);
    // and a name is free in the other workspace
    expect(
      (await create(b.admin, { name: 'Secret', rules: rules(cond('name', 'contains', 'e')) }))
        .status,
    ).toBe(201);
    // a rule cannot point at the other workspace's tag
    const theirTag = (await api.as(a.admin).post('/v2/tags').send({ name: 'theirs' })).body.id;
    const probe = await create(b.admin, {
      name: 'Probe',
      rules: rules(cond('tags', 'has_any', [theirTag])),
    });
    expect(probe.status).toBe(422);
    expect(probe.body.code).toBe('SEG_RULES_INVALID');
  });
});

describe('preview', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('seg-prev');
    await api.seedContacts(
      t,
      Array.from({ length: 14 }, (_, i) => ({
        name: `Prev ${String(i).padStart(2, '0')}`,
        phone: `+9198330000${String(i).padStart(2, '0')}`,
        source: i < 12 ? 'import' : 'web',
      })),
    );
  });

  it('answers the count and the first 10 contacts without saving anything', async () => {
    const res = await api
      .as(t.admin)
      .post('/v2/segments/preview')
      .send({ rules: rules(cond('source', 'equals', 'import')) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.count).toBe(12);
    expect(res.body.countApproximate).toBe(false);
    expect(res.body.sample).toHaveLength(10);
    expect(res.body.sample[0]).toHaveProperty('id');
    expect(res.body.invalidConditions).toEqual([]);
    const saved = await h.owner.query(`SELECT count(*)::int AS n FROM segments WHERE org_id = $1`, [
      t.orgId,
    ]);
    expect(saved.rows[0].n).toBe(0);
  });

  it('validates the rules like a save does, and refuses unknown shapes', async () => {
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/segments/preview')
          .send({ rules: rules(cond('nope', 'equals', 'x')) })
      ).status,
    ).toBe(422);
    expect((await api.as(t.admin).post('/v2/segments/preview').send({})).status).toBe(422);
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/segments/preview')
          .send({ rules: rules(cond('name', 'contains', 'a')), name: 'x' })
      ).status,
    ).toBe(422);
  });

  it('a condition on something that does not exist previews as "matches nothing" and is reported, not a 500', async () => {
    const gone = '3b241101-e2bb-4255-8caf-4136c566a962';
    const res = await api
      .as(t.admin)
      .post('/v2/segments/preview')
      .send({ rules: rules(cond('tags', 'has_any', [gone])) });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.invalidConditions).toMatchObject([
      { path: 'children.0', field: 'tags', reason: 'tag_deleted', refs: [gone] },
    ]);
  });

  it('shows only what the caller may see, and needs contacts.read', async () => {
    const own = await api.member(t, 'previewer', [
      ['record.segments.read'],
      ['record.contacts.read', 'own'],
    ]);
    const res = await api
      .as(own.token)
      .post('/v2/segments/preview')
      .send({ rules: rules(cond('source', 'equals', 'import')) });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    const none = await api.member(t, 'noread', [['record.segments.read']]);
    expect(
      (
        await api
          .as(none.token)
          .post('/v2/segments/preview')
          .send({ rules: rules(cond('source', 'equals', 'import')) })
      ).status,
    ).toBe(403);
  });

  it('is rate limited per user: the 31st request inside a minute is 429', async () => {
    const solo = await api.signup('seg-rl');
    const body = { rules: rules(cond('name', 'contains', 'a')) };
    let last = 0;
    let first429 = -1;
    for (let i = 1; i <= 32; i++) {
      last = (await api.as(solo.admin).post('/v2/segments/preview').send(body)).status;
      if (last === 429 && first429 < 0) first429 = i;
    }
    expect(first429).toBe(31);
    // another user in the same workspace has a budget of their own
    expect((await api.as(t.admin).post('/v2/segments/preview').send(body)).status).toBe(200);
  });
});

describe('contacts of a segment: GET /contacts?segmentId=', () => {
  let t: Tenant;
  let segId: string;
  let ids: string[];
  beforeAll(async () => {
    t = await api.signup('seg-list');
    ids = await api.seedContacts(t, [
      { name: 'L1', phone: '+919844000001', source: 'import', data: { plan: 'gold' } },
      { name: 'L2', phone: '+919844000002', source: 'import' },
      { name: 'L3', phone: '+919844000003', source: 'web' },
      { name: 'L4', phone: '+919844000004', source: 'import' },
    ]);
    segId = (
      await create(t.admin, {
        name: 'From a file',
        rules: rules(cond('source', 'equals', 'import')),
      })
    ).body.id;
  });

  it('lists the members, with the contacts list query: paging, expand, includeTotal', async () => {
    const first = await api
      .as(t.admin)
      .get(`/v2/contacts?segmentId=${segId}&limit=2&includeTotal=true&expand=groups,tags`);
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.meta).toEqual({ total: 3 });
    expect(first.body.data[0]).toHaveProperty('groups');
    expect(first.body.page.hasMore).toBe(true);
    const second = await api
      .as(t.admin)
      .get(
        `/v2/contacts?segmentId=${segId}&limit=2&cursor=${encodeURIComponent(first.body.page.nextCursor)}`,
      );
    expect(second.body.data).toHaveLength(1);
    expect(second.body.page.hasMore).toBe(false);
    expect(names([...first.body.data, ...second.body.data])).toEqual(['L1', 'L2', 'L4']);
  });

  it('GET /contacts?rules= filters by ad-hoc conditions, ANDed with a segment and other filters', async () => {
    const q = (r: unknown) => encodeURIComponent(JSON.stringify(r));
    const web = await api
      .as(t.admin)
      .get(`/v2/contacts?includeTotal=true&rules=${q(rules(cond('source', 'equals', 'web')))}`);
    expect(web.status, JSON.stringify(web.body)).toBe(200);
    expect(names(web.body.data)).toEqual(['L3']);
    expect(web.body.meta).toEqual({ total: 1 });

    // OR group
    const either = await api
      .as(t.admin)
      .get(
        `/v2/contacts?rules=${q({ type: 'group', combinator: 'or', children: [cond('source', 'equals', 'web'), cond('name', 'equals', 'L1')] })}`,
      );
    expect(names(either.body.data)).toEqual(['L1', 'L3']);

    // with a segment: import AND name L2 -> L2 only
    const both = await api
      .as(t.admin)
      .get(`/v2/contacts?segmentId=${segId}&rules=${q(rules(cond('name', 'equals', 'L2')))}`);
    expect(names(both.body.data)).toEqual(['L2']);

    // another workspace sees none of these
    const other = await api.signup('seg-list-b');
    const foreign = await api
      .as(other.admin)
      .get(`/v2/contacts?rules=${q(rules(cond('source', 'equals', 'web')))}`);
    expect(foreign.body.data).toEqual([]);
  });

  it('GET /contacts?rules= answers 422 for text that is not a rule tree', async () => {
    const bad = await api.as(t.admin).get('/v2/contacts?rules=not-json');
    expect(bad.status).toBe(422);
    const wrong = await api
      .as(t.admin)
      .get(`/v2/contacts?rules=${encodeURIComponent('{"type":"nope"}')}`);
    expect(wrong.status).toBe(422);
  });

  it('the same list through the segment route, in the same shape', async () => {
    const res = await api
      .as(t.admin)
      .get(`/v2/segments/${segId}/contacts?limit=10&includeTotal=true`);
    expect(res.status).toBe(200);
    expect(names(res.body.data)).toEqual(['L1', 'L2', 'L4']);
    expect(res.body.meta).toEqual({ total: 3 });
    expect(res.body.segment).toEqual({ id: segId, invalidConditions: [] });
  });

  it('combines with every other filter by AND', async () => {
    const q = await api.as(t.admin).get(`/v2/contacts?segmentId=${segId}&q=L4`);
    expect(names(q.body.data)).toEqual(['L4']);
    const none = await api.as(t.admin).get(`/v2/contacts?segmentId=${segId}&source=web`);
    expect(none.body.data).toEqual([]);
    const dated = await api
      .as(t.admin)
      .get(`/v2/contacts?segmentId=${segId}&createdFrom=2000-01-01&createdTo=2100-01-01`);
    expect(dated.body.data).toHaveLength(3);
    const old = await api.as(t.admin).get(`/v2/contacts?segmentId=${segId}&createdTo=2000-01-01`);
    expect(old.body.data).toEqual([]);
  });

  it('an unknown segment id is an empty list, never "all contacts"', async () => {
    const res = await api
      .as(t.admin)
      .get('/v2/contacts?segmentId=00000000-0000-4000-8000-000000000000&includeTotal=true');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta).toEqual({ total: 0 });
    expect((await api.as(t.admin).get('/v2/contacts?segmentId=nope')).status).toBe(422);
  });

  it('contacts enter and leave as their data changes, with nothing to maintain', async () => {
    // L3 (web) becomes an import: it joins. L1 changes source: it leaves.
    const l3 = (await api.as(t.admin).get(`/v2/contacts/${ids[2]}`)).body;
    await api
      .as(t.admin)
      .patch(`/v2/contacts/${ids[2]}`)
      .send({ source: 'import', rowVersion: l3.rowVersion });
    const l1 = (await api.as(t.admin).get(`/v2/contacts/${ids[0]}`)).body;
    await api
      .as(t.admin)
      .patch(`/v2/contacts/${ids[0]}`)
      .send({ source: 'web', rowVersion: l1.rowVersion });
    const after = await api.as(t.admin).get(`/v2/contacts?segmentId=${segId}&includeTotal=true`);
    expect(names(after.body.data)).toEqual(['L2', 'L3', 'L4']);
    expect(after.body.meta.total).toBe(3);
    // archived contacts are never members
    await h.owner.query(`UPDATE contacts SET is_archived = true WHERE org_id = $1 AND uuid = $2`, [
      t.orgId,
      ids[1],
    ]);
    expect(names((await api.as(t.admin).get(`/v2/contacts?segmentId=${segId}`)).body.data)).toEqual(
      ['L3', 'L4'],
    );
  });

  it('the cached count is served for 5 minutes, refresh-count recounts, an old cache is recounted by the next read', async () => {
    const seg = (
      await create(t.admin, { name: 'Cache probe', rules: rules(cond('name', 'starts_with', 'L')) })
    ).body;
    expect(seg.memberCount).toBe(3); // 4 contacts, one archived
    await api.seedContacts(t, [{ name: 'L5 later', phone: '+919844000005' }]);
    const cached = await api.as(t.admin).get(`/v2/segments/${seg.id}`);
    expect(cached.body.memberCount).toBe(3);
    expect(cached.body.memberCountAt).toBe(seg.memberCountAt);
    const refreshed = await api.as(t.admin).post(`/v2/segments/${seg.id}/refresh-count`);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body).toMatchObject({ memberCount: 4, countApproximate: false });
    await api.seedContacts(t, [{ name: 'L6 later', phone: '+919844000006' }]);
    await h.owner.query(
      `UPDATE segments SET member_count_at = now() - interval '6 minutes' WHERE org_id = $1 AND uuid = $2`,
      [t.orgId, seg.id],
    );
    expect((await api.as(t.admin).get(`/v2/segments/${seg.id}`)).body.memberCount).toBe(5);
    // counts are bookkeeping: they never touch the version a person edits against
    const row = await h.owner.query(
      `SELECT row_version FROM segments WHERE org_id = $1 AND uuid = $2`,
      [t.orgId, seg.id],
    );
    expect(row.rows[0].row_version).toBe(1);
  });

  it('the list shows cached counts and never counts', async () => {
    const seg = (
      await create(t.admin, {
        name: 'No count in list',
        rules: rules(cond('name', 'starts_with', 'L')),
      })
    ).body;
    await h.owner.query(
      `UPDATE segments SET member_count_cache = 999, member_count_at = now() - interval '1 hour' WHERE org_id = $1 AND uuid = $2`,
      [t.orgId, seg.id],
    );
    const list = await api.as(t.admin).get('/v2/segments?q=No count');
    expect(list.body.data[0].memberCount).toBe(999);
  });
});

describe('save the current contacts filter as a segment', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('seg-ff');
    await api.seedContacts(t, [
      { name: 'F1', phone: '+919855000001', source: 'import' },
      { name: 'F2', phone: '+919855000002', source: 'import', isUnsubscribed: true },
      { name: 'F3', phone: '+919855000003', source: 'web' },
    ]);
  });

  it('turns the filter into rules and the segment has exactly the contacts the list showed', async () => {
    const listed = await api
      .as(t.admin)
      .get('/v2/contacts?source=import&unsubscribed=false&includeTotal=true');
    const res = await api
      .as(t.admin)
      .post('/v2/segments/from-filters')
      .send({
        name: 'Saved filter',
        filter: { source: 'import', unsubscribed: false, createdFrom: '2000-01-01' },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.rules.combinator).toBe('and');
    expect(res.body.rules.children).toHaveLength(3);
    expect(res.body.memberCount).toBe(listed.body.meta.total);
    const members = await api.as(t.admin).get(`/v2/contacts?segmentId=${res.body.id}`);
    expect(names(members.body.data)).toEqual(names(listed.body.data));
  });

  it('a tag filter and a group filter become tag and group conditions', async () => {
    const tag = (await api.as(t.admin).post('/v2/tags').send({ name: 'ff-tag' })).body.id;
    const grp = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'ff-group' })).body
      .id;
    const res = await api
      .as(t.admin)
      .post('/v2/segments/from-filters')
      .send({
        name: 'Tags and groups',
        filter: { tagIds: [tag], tagMode: 'all', groupId: grp, q: 'F' },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const fields = res.body.rules.children
      .map((c: { field: string; operator: string }) => `${c.field}:${c.operator}`)
      .sort();
    expect(fields).toEqual(['groups:has_any', 'search:matches', 'tags:has_all']);
  });

  it('a filter with no conditions, or with a segment of its own, cannot become a segment', async () => {
    const empty = await api
      .as(t.admin)
      .post('/v2/segments/from-filters')
      .send({ name: 'Empty', filter: {} });
    expect(empty.status).toBe(422);
    const nested = await api
      .as(t.admin)
      .post('/v2/segments/from-filters')
      .send({
        name: 'Nested',
        filter: { segmentId: '00000000-0000-4000-8000-000000000000' },
      });
    expect(nested.status).toBe(422);
    const taken = await api
      .as(t.admin)
      .post('/v2/segments/from-filters')
      .send({ name: 'saved FILTER', filter: { source: 'web' } });
    expect(taken.status).toBe(409);
    // the permission is the segment one
    const reader = await api.member(t, 'ffreader', [['record.segments.read']]);
    expect(
      (
        await api
          .as(reader.token)
          .post('/v2/segments/from-filters')
          .send({ name: 'No', filter: { source: 'web' } })
      ).status,
    ).toBe(403);
  });
});

describe('actions on a segment', () => {
  let t: Tenant;
  let segId: string;
  beforeAll(async () => {
    t = await api.signup('seg-act');
    await api.seedContacts(t, [
      { name: 'A1', phone: '+919866000001', source: 'import', email: 'a1@x.test' },
      { name: 'A2', phone: '+919866000002', source: 'import' },
      { name: '=SUM(A1)', phone: '+919866000003', source: 'import' },
      { name: 'Other', phone: '+919866000004', source: 'web' },
    ]);
    segId = (
      await create(t.admin, {
        name: 'Actionable',
        visibility: 'shared',
        rules: rules(cond('source', 'equals', 'import')),
      })
    ).body.id;
  });

  it('export: the members as CSV, nothing else, with a safe file name and formula guard', async () => {
    const res = await api
      .as(t.admin)
      .post(`/v2/segments/${segId}/export`)
      .send({})
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.on('data', (c: Buffer) => (data += c.toString('utf8')));
        r.on('end', () => cb(null, data));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain('segment-Actionable.csv');
    const text = res.body as string;
    expect(text).toContain('A1');
    expect(text).toContain('A2');
    expect(text).not.toContain('Other');
    expect(text).toContain("'=SUM(A1)");
    expect(await api.auditCount(t.orgId, 'contacts', 'export')).toBeGreaterThanOrEqual(1);
  });

  it('export needs the contacts export permission', async () => {
    const reader = await api.member(t, 'noexport', [
      ['record.segments.read'],
      ['record.contacts.read'],
    ]);
    expect((await api.as(reader.token).post(`/v2/segments/${segId}/export`).send({})).status).toBe(
      403,
    );
  });

  it('tag: tags every current member by name (creating the tag), and is a snapshot', async () => {
    const res = await api
      .as(t.admin)
      .post(`/v2/segments/${segId}/tag`)
      .send({ name: 'campaign-x' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ matched: 3, changed: 3, queued: false });
    const tagged = await h.owner.query(
      `SELECT c.name FROM contact_tags ct JOIN tags t ON t.org_id = ct.org_id AND t.id = ct.tag_id JOIN contacts c ON c.org_id = ct.org_id AND c.id = ct.contact_id WHERE ct.org_id = $1 AND t.name = 'campaign-x' ORDER BY c.name`,
      [t.orgId],
    );
    expect(tagged.rows.map((r) => r.name).sort()).toEqual(['=SUM(A1)', 'A1', 'A2'].sort());

    // a contact that joins later is not tagged, tagging again changes nothing
    await api.seedContacts(t, [{ name: 'A3 late', phone: '+919866000005', source: 'import' }]);
    const again = await api
      .as(t.admin)
      .post(`/v2/segments/${segId}/tag`)
      .send({ name: 'campaign-x' });
    expect(again.body).toEqual({ matched: 4, changed: 1, queued: false });
    // by id works too, and either id or name is required
    const tag = (await api.as(t.admin).get('/v2/tags')).body.data.find(
      (x: { name: string }) => x.name === 'campaign-x',
    );
    expect(
      (await api.as(t.admin).post(`/v2/segments/${segId}/tag`).send({ tagId: tag.id })).body
        .changed,
    ).toBe(0);
    expect((await api.as(t.admin).post(`/v2/segments/${segId}/tag`).send({})).status).toBe(422);
    expect(
      (await api.as(t.admin).post(`/v2/segments/${segId}/tag`).send({ tagId: tag.id, name: 'x' }))
        .status,
    ).toBe(422);
    const events = await api.events(t.orgId, 'tag.contacts_changed');
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it("tag respects the caller's contact scope: only their own contacts are tagged", async () => {
    const scoped = await api.member(t, 'scopedtag', [...AGENT, ['record.tags.create']]);
    await h.owner.query(`UPDATE contacts SET owner_id = $2 WHERE org_id = $1 AND name = 'A1'`, [
      t.orgId,
      scoped.userId,
    ]);
    const res = await api
      .as(scoped.token)
      .post(`/v2/segments/${segId}/tag`)
      .send({ name: 'scoped-tag' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ matched: 1, changed: 1 });
  });

  it('add to group: copies the current members into a group (a snapshot)', async () => {
    const grp = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Snapshot' })).body
      .id;
    const res = await api
      .as(t.admin)
      .post(`/v2/segments/${segId}/add-to-group`)
      .send({ groupId: grp });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ matched: 4, changed: 4, queued: false });
    const group = (await api.as(t.admin).get(`/v2/contact-groups/${grp}`)).body;
    expect(group.memberCount).toBe(4);
    // a contact that joins the segment afterwards is not in the group
    await api.seedContacts(t, [{ name: 'A4 later', phone: '+919866000006', source: 'import' }]);
    expect((await api.as(t.admin).get(`/v2/contact-groups/${grp}`)).body.memberCount).toBe(4);
    expect(
      (
        await api
          .as(t.admin)
          .post(`/v2/segments/${segId}/add-to-group`)
          .send({ groupId: '00000000-0000-4000-8000-000000000000' })
      ).status,
    ).toBe(404);
    expect((await api.as(t.admin).post(`/v2/segments/${segId}/add-to-group`).send({})).status).toBe(
      422,
    );
  });

  it('refresh-count and the actions are counted in the audit trail of the group they changed', async () => {
    expect(await api.auditCount(t.orgId, 'contact_groups', 'update')).toBeGreaterThanOrEqual(1);
  });
});

describe('a big segment is added to a group by a job, in chunks', () => {
  let t: Tenant;
  let segId: string;
  let grp: string;
  beforeAll(async () => {
    t = await api.signup('seg-job');
    await h.owner.query(
      `INSERT INTO contacts (org_id, name, source, owner_id) SELECT $1, 'Bulk ' || g, 'bulk', NULL FROM generate_series(1, 2100) g`,
      [t.orgId],
    );
    segId = (
      await create(t.admin, { name: 'Bulk', rules: rules(cond('source', 'equals', 'bulk')) })
    ).body.id;
    grp = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Bulk group' })).body.id;
  }, 60_000);

  it('over 1000 members the request returns queued and a job carries only ids and the scope', async () => {
    const res = await api
      .as(t.admin)
      .post(`/v2/segments/${segId}/add-to-group`)
      .send({ groupId: grp });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ matched: 2100, changed: 0, queued: true });
    const queue = h.app.get<Queue>(getQueueToken(QUEUES.SEGMENT_ACTIONS), { strict: false });
    const jobs = (await queue.getJobs(['waiting', 'delayed', 'active', 'prioritized'])).filter(
      (j) => j.data.orgId === t.orgId,
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.data).toMatchObject({
      orgId: t.orgId,
      segmentUuid: segId,
      groupUuid: grp,
      scope: 'all',
    });
    expect(Object.keys(jobs[0]!.data).sort()).toEqual([
      'groupUuid',
      'orgId',
      'requestId',
      'scope',
      'segmentUuid',
      'userId',
    ]);
    // nothing was written by the request
    expect((await api.as(t.admin).get(`/v2/contact-groups/${grp}`)).body.memberCount).toBe(0);
  });

  it('the job adds every member, chunk by chunk, and running it again changes nothing', async () => {
    const actions = h.app.get(SegmentActionsService, { strict: false });
    const queue = h.app.get<Queue>(getQueueToken(QUEUES.SEGMENT_ACTIONS), { strict: false });
    const job = (await queue.getJobs(['waiting', 'delayed', 'active', 'prioritized'])).find(
      (j) => j.data.orgId === t.orgId,
    )!;
    const grants = new Map([
      ['record.segments.read', { effect: 'allow' as const, scope: 'all' as const }],
      ['record.segments.update', { effect: 'allow' as const, scope: 'all' as const }],
    ]);
    const run = () =>
      RequestContextStore.run(
        {
          requestId: 'job-test',
          orgId: t.orgId,
          actorType: 'user',
          actorId: t.adminUserId,
          userId: t.adminUserId,
          grants,
        },
        () => actions.runAddToGroup(job.data),
      );
    expect(await run()).toEqual({ matched: 2100, changed: 2100 });
    expect((await api.as(t.admin).get(`/v2/contact-groups/${grp}`)).body.memberCount).toBe(2100);
    expect(await run()).toEqual({ matched: 2100, changed: 0 });
    // one audit row and one event for the whole run
    expect(
      (await api.events(t.orgId, 'contact_group.members_changed')).filter(
        (e) => e.selection === 'segment',
      ),
    ).toHaveLength(1);
  }, 60_000);

  it('the job only copies contacts the person who started it could change (their scope)', async () => {
    const actions = h.app.get(SegmentActionsService, { strict: false });
    const scoped = await api.member(t, 'jobscope', AGENT);
    await h.owner.query(
      `UPDATE contacts SET owner_id = $2 WHERE org_id = $1 AND name IN ('Bulk 1', 'Bulk 2', 'Bulk 3')`,
      [t.orgId, scoped.userId],
    );
    const g2 = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Scoped group' }))
      .body.id;
    const grants = new Map([
      ['record.segments.read', { effect: 'allow' as const, scope: 'all' as const }],
      ['record.segments.update', { effect: 'allow' as const, scope: 'all' as const }],
    ]);
    const result = await RequestContextStore.run(
      {
        requestId: 'job-scope',
        orgId: t.orgId,
        actorType: 'user',
        actorId: scoped.userId,
        userId: scoped.userId,
        grants,
      },
      () =>
        actions.runAddToGroup({
          orgId: t.orgId,
          userId: scoped.userId,
          segmentUuid: segId,
          groupUuid: g2,
          scope: 'own',
          requestId: null,
        }),
    );
    expect(result).toEqual({ matched: 3, changed: 3 });
  });
});

describe('references to things that were deleted', () => {
  let t: Tenant;
  let tag: string;
  let grp: string;
  let stage: { id: string; value: string };
  let other: { id: string; value: string };
  let statusId: string;
  let fieldId: string;
  let segId: string;
  let c: string[];

  beforeAll(async () => {
    t = await api.signup('seg-del');
    const mkStage = async (value: string) =>
      (
        await api
          .as(t.admin)
          .post('/v2/status-options')
          .send({ moduleKey: 'contacts', optionGroup: 'lifecycle_stage', value, label: value })
      ).body;
    stage = await mkStage('doomed_stage');
    other = await mkStage('other_stage');
    statusId = (
      await api.as(t.admin).post('/v2/status-options').send({
        moduleKey: 'contacts',
        optionGroup: 'status',
        value: 'doomed_status',
        label: 'doomed',
      })
    ).body.id;
    const section = await api
      .as(t.admin)
      .post('/v2/field-sections')
      .send({ moduleKey: 'contacts', name: 'Del' });
    fieldId = (
      await api.as(t.admin).post('/v2/fields').send({
        moduleKey: 'contacts',
        sectionId: section.body.id,
        key: 'doomed_field',
        label: 'Doomed',
        fieldType: 'text',
      })
    ).body.id;
    tag = (await api.as(t.admin).post('/v2/tags').send({ name: 'doomed-tag' })).body.id;
    grp = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'doomed-group' })).body.id;
    c = await api.seedContacts(t, [
      { name: 'D1', phone: '+919877000001', source: 'import', data: { doomed_field: 'yes' } },
      { name: 'D2', phone: '+919877000002', source: 'web' },
    ]);
    await api
      .as(t.admin)
      .post('/v2/tags/attach')
      .send({ contactIds: [c[0]], tagIds: [tag] });
    await api
      .as(t.admin)
      .put(`/v2/contacts/${c[0]}/groups`)
      .send({ groupIds: [grp] });
    segId = (
      await create(t.admin, {
        name: 'Many refs',
        visibility: 'shared',
        // every branch is an OR of one live condition (source) and one that will die
        rules: {
          type: 'group',
          combinator: 'and',
          children: [
            cond('source', 'equals', 'import'),
            {
              type: 'group',
              combinator: 'or',
              children: [
                cond('tags', 'has_any', [tag]),
                cond('groups', 'has_any', [grp]),
                cond('lifecycleStage', 'equals', 'doomed_stage'),
                cond('status', 'equals', 'doomed_status'),
                cond('custom.doomed_field', 'equals', 'yes'),
              ],
            },
          ],
        },
      })
    ).body.id;
  });

  it('before any delete the usage of each reference lists the segment', async () => {
    const usage = async (kind: string, ref: string) =>
      (await api.as(t.admin).get(`/v2/segments/usage?kind=${kind}&ref=${encodeURIComponent(ref)}`))
        .body.data;
    for (const [kind, ref] of [
      ['tag', tag],
      ['group', grp],
      ['stage', 'doomed_stage'],
      ['status', 'doomed_status'],
      ['field', 'doomed_field'],
    ]) {
      expect(names(await usage(kind!, ref!)), kind).toEqual(['Many refs']);
    }
    expect(await usage('tag', grp)).toEqual([]);
    const stages = (
      await api
        .as(t.admin)
        .get('/v2/status-options/usage?moduleKey=contacts&optionGroup=lifecycle_stage')
    ).body.data;
    expect(stages.find((s: { value: string }) => s.value === 'doomed_stage').segments).toBe(1);
    expect(stages.find((s: { value: string }) => s.value === 'other_stage').segments).toBe(0);
    const statuses = (
      await api.as(t.admin).get('/v2/status-options/usage?moduleKey=contacts&optionGroup=status')
    ).body.data;
    expect(statuses.find((s: { value: string }) => s.value === 'doomed_status').segments).toBe(1);
    const fields = (await api.as(t.admin).get('/v2/fields/usage?moduleKey=contacts')).body.data;
    expect(fields.find((f: { key: string }) => f.key === 'doomed_field').segments).toBe(1);
    expect((await api.as(t.admin).get('/v2/segments/usage?kind=tag')).status).toBe(422);
    expect((await api.as(t.admin).get('/v2/segments/usage?kind=colour&ref=x')).status).toBe(422);
  });

  it('with everything alive the segment has no invalid conditions and the live contacts', async () => {
    const res = await api.as(t.admin).get(`/v2/segments/${segId}`);
    expect(res.body.invalidConditions).toEqual([]);
    expect(res.body.memberCount).toBe(1);
  });

  it('deleting each reference never makes the segment fail: it is flagged, the broken condition matches nothing, the rest still works', async () => {
    expect((await api.as(t.admin).delete(`/v2/tags/${tag}`)).status).toBe(204);
    expect((await api.as(t.admin).delete(`/v2/contact-groups/${grp}`)).status).toBe(204);
    expect(
      (await api.as(t.admin).delete(`/v2/status-options/${stage.id}?moveTo=${other.id}`)).status,
    ).toBe(204);
    expect((await api.as(t.admin).delete(`/v2/status-options/${statusId}`)).status).toBe(204);
    expect((await api.as(t.admin).delete(`/v2/fields/${fieldId}`)).status).toBe(204);

    const res = await api.as(t.admin).get(`/v2/segments/${segId}`);
    expect(res.status).toBe(200);
    expect(
      res.body.invalidConditions.map((i: { path: string; reason: string }) => [i.path, i.reason]),
    ).toEqual([
      ['children.1.children.0', 'tag_deleted'],
      ['children.1.children.1', 'group_deleted'],
      ['children.1.children.2', 'stage_deleted'],
      ['children.1.children.3', 'status_deleted'],
      ['children.1.children.4', 'field_deleted'],
    ]);
    for (const i of res.body.invalidConditions) {
      expect(i.message).toEqual(expect.any(String));
      expect(i.refs.length).toBe(1);
    }
    // every condition inside the OR is now false, so nobody is a member; the count is not the stale 1
    expect(res.body.memberCount).toBe(0);
  });

  it('listing, counting, exporting, previewing and the contact filter all still answer', async () => {
    const list = await api.as(t.admin).get('/v2/segments');
    expect(list.status).toBe(200);
    expect(list.body.data[0].invalidConditions).toHaveLength(5);

    const members = await api.as(t.admin).get(`/v2/contacts?segmentId=${segId}&includeTotal=true`);
    expect(members.status).toBe(200);
    expect(members.body.data).toEqual([]);
    expect(members.body.segment.invalidConditions).toHaveLength(5);
    expect(members.body.segment.id).toBe(segId);

    const viaSegment = await api.as(t.admin).get(`/v2/segments/${segId}/contacts`);
    expect(viaSegment.status).toBe(200);
    expect(viaSegment.body.segment.invalidConditions).toHaveLength(5);

    expect((await api.as(t.admin).post(`/v2/segments/${segId}/export`).send({})).status).toBe(200);
    expect((await api.as(t.admin).post(`/v2/segments/${segId}/refresh-count`)).body).toMatchObject({
      memberCount: 0,
    });
    const preview = await api
      .as(t.admin)
      .post('/v2/segments/preview')
      .send({ rules: (await api.as(t.admin).get(`/v2/segments/${segId}`)).body.rules });
    expect(preview.status).toBe(200);
    expect(preview.body.invalidConditions).toHaveLength(5);
  });

  it('a negated condition on a deleted reference is "matches nothing", never "matches everyone"', async () => {
    // arrange a segment that points at a live tag, then delete the tag
    const live = (await api.as(t.admin).post('/v2/tags').send({ name: 'negated-tag' })).body.id;
    const seg = await create(t.admin, {
      name: 'No such tag',
      rules: rules(cond('tags', 'has_none', [live])),
    });
    expect(seg.body.memberCount).toBe(2);
    await api.as(t.admin).delete(`/v2/tags/${live}`);
    const after = await api.as(t.admin).get(`/v2/segments/${seg.body.id}`);
    expect(after.body.invalidConditions).toHaveLength(1);
    expect(after.body.memberCount).toBe(0);
  });

  it('the delete is traceable: the audit row and the event name the segments it left with a broken condition', async () => {
    const tagEvent = (await api.events(t.orgId, 'tag.deleted')).find((e) => e.uuid === tag);
    expect(tagEvent?.segments).toEqual(['Many refs']);
    const groupEvent = (await api.events(t.orgId, 'contact_group.deleted')).find(
      (e) => e.uuid === grp,
    );
    expect(groupEvent?.segments).toEqual(['Many refs']);
    const stageEvent = (await api.events(t.orgId, 'status_option.deleted')).find(
      (e) => e.uuid === stage.id,
    );
    expect(stageEvent?.segments).toEqual(['Many refs']);
    const fieldEvent = (await api.events(t.orgId, 'field.deleted')).find((e) => e.uuid === fieldId);
    expect(fieldEvent?.segments).toEqual(['Many refs']);
    // deleting a tag no segment uses says so with an empty list
    const spare = (await api.as(t.admin).post('/v2/tags').send({ name: 'unused-tag' })).body.id;
    await api.as(t.admin).delete(`/v2/tags/${spare}`);
    expect(
      (await api.events(t.orgId, 'tag.deleted')).find((e) => e.uuid === spare)?.segments,
    ).toEqual([]);
  });

  it('fixing the segment (removing the broken conditions) clears the flags', async () => {
    const cur = (await api.as(t.admin).get(`/v2/segments/${segId}`)).body;
    const fixed = await api
      .as(t.admin)
      .patch(`/v2/segments/${segId}`)
      .send({ rules: rules(cond('source', 'equals', 'import')), rowVersion: cur.rowVersion });
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
    expect(fixed.body.invalidConditions).toEqual([]);
    expect(fixed.body.memberCount).toBe(1);
  });
});

describe('what other domains call', () => {
  let t: Tenant;
  let segId: string;
  let segments: SegmentsService;
  const as = <T>(fn: () => Promise<T>) =>
    RequestContextStore.run(
      {
        requestId: 'domain-call',
        orgId: t.orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      fn,
    );

  beforeAll(async () => {
    t = await api.signup('seg-dom');
    await api.seedContacts(
      t,
      Array.from({ length: 7 }, (_, i) => ({
        name: `Dom ${i}`,
        phone: `+91988800000${i}`,
        source: 'camp',
      })),
    );
    await api.seedContacts(t, [{ name: 'Not in', phone: '+919888000099', source: 'other' }]);
    // private to the admin: a domain resolving an audience is not a person looking at a screen
    segId = (
      await create(t.admin, { name: 'Audience', rules: rules(cond('source', 'equals', 'camp')) })
    ).body.id;
    segments = h.app.get(SegmentsService, { strict: false });
  });

  it('resolveMembers pages through the contacts by id, with no cursor state to keep', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Awaited<ReturnType<SegmentsService['resolveMembers']>> = await as(() =>
        segments.resolveMembers(segId, { cursor, limit: 3 }),
      );
      expect(page.members.length).toBeLessThanOrEqual(3);
      expect(page.invalidConditions).toEqual([]);
      seen.push(...page.members.map((m) => m.uuid));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(7);
    // every member is a real contact of the segment
    const rows = await h.owner.query(
      `SELECT source FROM contacts WHERE org_id = $1 AND uuid = ANY($2::uuid[])`,
      [t.orgId, seen],
    );
    expect(rows.rows.every((r) => r.source === 'camp')).toBe(true);
    await expect(
      as(() => segments.resolveMembers(segId, { cursor: 'abc', limit: 3 })),
    ).rejects.toThrow();
    await expect(
      as(() => segments.resolveMembers('00000000-0000-4000-8000-000000000000', { limit: 3 })),
    ).rejects.toThrow(/not found/i);
  });

  it('countMembers answers the count and stores it', async () => {
    const counted = await as(() => segments.countMembers(segId));
    expect(counted).toMatchObject({ count: 7, approximate: false, invalidConditions: [] });
  });

  it('the worker sweep refreshes the count of a segment someone used lately, and leaves the rest alone', async () => {
    const used = (
      await create(t.admin, {
        name: 'Recently used',
        rules: rules(cond('source', 'equals', 'camp')),
      })
    ).body.id;
    const idle = (
      await create(t.admin, { name: 'Never used', rules: rules(cond('source', 'equals', 'camp')) })
    ).body.id;
    await api.seedContacts(t, [{ name: 'Dom late', phone: '+919888000077', source: 'camp' }]);
    await h.owner.query(
      `UPDATE segments SET member_count_at = now() - interval '10 minutes', last_used_at = CASE WHEN uuid = $2 THEN now() ELSE NULL END
        WHERE org_id = $1 AND uuid IN ($2, $3)`,
      [t.orgId, used, idle],
    );
    const sweep = new SegmentCountSweepService(
      h.app.get(DatabaseService, { strict: false }),
      h.app.get(SegmentsRepository, { strict: false }),
    );
    expect(await sweep.sweep()).toBeGreaterThanOrEqual(1);
    const rows = await h.owner.query(
      `SELECT uuid, member_count_cache, row_version FROM segments WHERE org_id = $1 AND uuid IN ($2, $3)`,
      [t.orgId, used, idle],
    );
    const by = Object.fromEntries(rows.rows.map((r) => [r.uuid, r]));
    expect(by[used].member_count_cache).toBe(8);
    expect(by[used].row_version).toBe(1);
    expect(by[idle].member_count_cache).toBe(7);
  });

  it('the controller order: usage, preview and from-filters are not read as ids', async () => {
    expect((await api.as(t.admin).get('/v2/segments/usage?kind=tag&ref=x')).status).toBe(200);
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/segments/preview')
          .send({ rules: rules(cond('name', 'contains', 'a')) })
      ).status,
    ).toBe(200);
  });
});
