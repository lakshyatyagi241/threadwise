import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from './support';

/**
 * Contact groups end to end through HTTP: TW-CON-033..037 (and the membership half of TW-CON-010).
 * One app, one database; each describe block works in organizations of its own.
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

const names = (rows: Array<{ name: string }>) => rows.map((r) => r.name);

describe('creating a group (TW-CON-034)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('grp');
  });

  it('TW-CON-034 #2: "Leads" with colour #22C55E comes back with memberCount 0', async () => {
    const res = await api
      .as(t.admin)
      .post('/v2/contact-groups')
      .send({ name: 'Leads', color: '#22C55E' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Leads',
      color: '#22C55E',
      memberCount: 0,
      existing: false,
    });
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(res.body)).not.toMatch(/"(orgId|org_id)"/);
  });

  it('TW-CON-034 #1: creating "  vip " when "VIP" exists returns the existing group and adds no row', async () => {
    const first = await api
      .as(t.admin)
      .post('/v2/contact-groups')
      .send({ name: 'VIP', note: 'keep me' });
    expect(first.status).toBe(201);
    const again = await api
      .as(t.admin)
      .post('/v2/contact-groups')
      .send({ name: '  vip ', note: 'ignored', color: '#E87A5D' });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({
      id: first.body.id,
      name: 'VIP',
      note: 'keep me',
      existing: true,
    });
    const rows = await h.owner.query(
      `SELECT count(*)::int AS n FROM contact_groups WHERE org_id = $1 AND lower(name) = 'vip'`,
      [t.orgId],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it('TW-CON-034 #3: no name is a validation error with a problem+json body', async () => {
    const res = await api.as(t.admin).post('/v2/contact-groups').send({});
    expect(res.status).toBe(422);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('TW-CON-034: a colour that is not a hex value is refused', async () => {
    const res = await api
      .as(t.admin)
      .post('/v2/contact-groups')
      .send({ name: 'Bad', color: 'green' });
    expect(res.status).toBe(422);
  });

  it('TW-CON-034 #2 (race): five simultaneous creates of one name leave one row (the index decides)', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        api.as(t.admin).post('/v2/contact-groups').send({ name: 'Racers' }),
      ),
    );
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const rows = await h.owner.query(
      `SELECT count(*)::int AS n FROM contact_groups WHERE org_id = $1 AND name = 'Racers'`,
      [t.orgId],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it('TW-CON-034: a long name (Reference probably failed past ~30 characters) is fine up to 191', async () => {
    const name = 'N'.repeat(191);
    const ok = await api.as(t.admin).post('/v2/contact-groups').send({ name });
    expect(ok.status).toBe(201);
    const tooLong = await api
      .as(t.admin)
      .post('/v2/contact-groups')
      .send({ name: `${name}x` });
    expect(tooLong.status).toBe(422);
  });

  it('writes one audit row and one outbox event with the insert, in the same transaction', async () => {
    const before = await api.auditCount(t.orgId, 'contact_groups', 'insert');
    const eventsBefore = (await api.events(t.orgId, 'contact_group.created')).length;
    const res = await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Audited' });
    expect(res.status).toBe(201);
    expect(await api.auditCount(t.orgId, 'contact_groups', 'insert')).toBe(before + 1);
    expect((await api.events(t.orgId, 'contact_group.created')).length).toBe(eventsBefore + 1);
    // a duplicate create writes neither
    await api.as(t.admin).post('/v2/contact-groups').send({ name: 'audited' });
    expect(await api.auditCount(t.orgId, 'contact_groups', 'insert')).toBe(before + 1);
  });
});

describe('listing, counting and the group panel (TW-CON-033, 037)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('lst');
  });

  it('TW-CON-033 #3: with no groups the list is empty (only the create tile shows)', async () => {
    const res = await api.as(t.admin).get('/v2/contact-groups');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.page.hasMore).toBe(false);
  });

  it('TW-CON-033 #1 and TW-CON-037 #2: three groups, newest first, each with its member count', async () => {
    const contactIds = await api.seedContacts(
      t,
      Array.from({ length: 30 }, (_, i) => ({
        name: `C${i}`,
        phone: `+9190000000${String(i).padStart(2, '0')}`,
      })),
    );
    const a = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Alpha' })).body;
    const b = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Beta' })).body;
    await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Gamma' });
    const half = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/group')
      .send({ ids: contactIds.slice(0, 15), groupId: a.id, action: 'add' });
    expect(half.status, JSON.stringify(half.body)).toBe(200);
    await api
      .as(t.admin)
      .post('/v2/contacts/bulk/group')
      .send({ ids: contactIds.slice(0, 4), groupId: b.id, action: 'add' });

    const list = await api.as(t.admin).get('/v2/contact-groups');
    expect(names(list.body.data)).toEqual(['Gamma', 'Beta', 'Alpha']);
    const byName = Object.fromEntries(
      list.body.data.map((g: { name: string; memberCount: number }) => [g.name, g.memberCount]),
    );
    expect(byName).toEqual({ Alpha: 15, Beta: 4, Gamma: 0 });
    // the same number on every surface
    expect((await api.as(t.admin).get(`/v2/contact-groups/${a.id}`)).body.memberCount).toBe(15);
    const stats = await api.as(t.admin).get('/v2/contacts/stats');
    expect(stats.body).toMatchObject({ total: 30, groups: 3, grouped: 15, noGroup: 15 });
  });

  it('paginates with a cursor and filters by name', async () => {
    const page1 = await api.as(t.admin).get('/v2/contact-groups?limit=2');
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.page.hasMore).toBe(true);
    const page2 = await api
      .as(t.admin)
      .get(`/v2/contact-groups?limit=2&cursor=${page1.body.page.nextCursor}`);
    expect(names(page2.body.data)).toEqual(['Alpha']);
    const q = await api.as(t.admin).get('/v2/contact-groups?q=bet');
    expect(names(q.body.data)).toEqual(['Beta']);
  });
});

describe('editing a group (TW-CON-035)', () => {
  let t: Tenant;
  let other: Tenant;
  beforeAll(async () => {
    t = await api.signup('edt');
    other = await api.signup('edo');
  });

  it('TW-CON-035 #1: renaming a group with 7 members answers memberCount 7', async () => {
    const ids = await api.seedContacts(
      t,
      Array.from({ length: 7 }, (_, i) => ({ name: `M${i}`, phone: `+9180000000${i}0` })),
    );
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Old name' })).body;
    await api
      .as(t.admin)
      .post('/v2/contacts/bulk/group')
      .send({ ids, groupId: g.id, action: 'add' });
    const res = await api
      .as(t.admin)
      .patch(`/v2/contact-groups/${g.id}`)
      .send({ name: 'New name', rowVersion: g.rowVersion });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ name: 'New name', memberCount: 7 });
    expect(res.body.rowVersion).toBe(g.rowVersion + 1);
  });

  it('TW-CON-035 #2: a group of another organization is a 404, and nothing changes', async () => {
    const theirs = (await api.as(other.admin).post('/v2/contact-groups').send({ name: 'Theirs' }))
      .body;
    const res = await api
      .as(t.admin)
      .patch(`/v2/contact-groups/${theirs.id}`)
      .send({ name: 'Mine now', rowVersion: 1 });
    expect(res.status).toBe(404);
    expect((await api.as(other.admin).get(`/v2/contact-groups/${theirs.id}`)).body.name).toBe(
      'Theirs',
    );
    expect((await api.as(t.admin).delete(`/v2/contact-groups/${theirs.id}`)).status).toBe(404);
  });

  it("TW-CON-035 #3 (fixed): renaming onto another group's name is 409 CON_GROUP_NAME_TAKEN, in any case", async () => {
    await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Taken' });
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Free' })).body;
    const res = await api
      .as(t.admin)
      .patch(`/v2/contact-groups/${g.id}`)
      .send({ name: 'tAKEN', rowVersion: g.rowVersion });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CON_GROUP_NAME_TAKEN');
    // changing only the case of its own name is allowed
    const own = await api
      .as(t.admin)
      .patch(`/v2/contact-groups/${g.id}`)
      .send({ name: 'FREE', rowVersion: g.rowVersion });
    expect(own.status).toBe(200);
  });

  it('a stale rowVersion is 409 ROW_VERSION_CONFLICT', async () => {
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Versioned' })).body;
    const ok = await api
      .as(t.admin)
      .patch(`/v2/contact-groups/${g.id}`)
      .send({ note: 'x', rowVersion: g.rowVersion });
    expect(ok.status).toBe(200);
    const stale = await api
      .as(t.admin)
      .patch(`/v2/contact-groups/${g.id}`)
      .send({ note: 'y', rowVersion: g.rowVersion });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
  });

  it('a note absent from the request is kept (Reference cleared it); null clears it; the colour follows the same rule', async () => {
    const g = (
      await api
        .as(t.admin)
        .post('/v2/contact-groups')
        .send({ name: 'Noted', note: 'hello', color: '#13478A' })
    ).body;
    const renamed = (
      await api
        .as(t.admin)
        .patch(`/v2/contact-groups/${g.id}`)
        .send({ name: 'Noted 2', rowVersion: g.rowVersion })
    ).body;
    expect(renamed).toMatchObject({ note: 'hello', color: '#13478A' });
    const cleared = (
      await api
        .as(t.admin)
        .patch(`/v2/contact-groups/${g.id}`)
        .send({ note: null, color: null, rowVersion: renamed.rowVersion })
    ).body;
    expect(cleared).toMatchObject({ note: null, color: null, name: 'Noted 2' });
  });
});

describe('deleting a group (TW-CON-036)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('del');
  });

  it('TW-CON-036 #1: 3 contacts in G; deleting G leaves the contacts and their other groups', async () => {
    const [c1, c2, c3, c4] = await api.seedContacts(t, [
      { name: 'One', phone: '+917000000001' },
      { name: 'Two', phone: '+917000000002' },
      { name: 'Three', phone: '+917000000003' },
      { name: 'Four', phone: '+917000000004' },
    ]);
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'G' })).body;
    const keep = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Keep' })).body;
    await api
      .as(t.admin)
      .post('/v2/contacts/bulk/group')
      .send({ ids: [c1, c2, c3], groupId: g.id, action: 'add' });
    await api
      .as(t.admin)
      .post('/v2/contacts/bulk/group')
      .send({ ids: [c1], groupId: keep.id, action: 'add' });
    const phoneBefore = await h.owner.query(
      `SELECT phone, normalized_phone FROM contacts WHERE uuid = $1`,
      [c1],
    );

    const del = await api.as(t.admin).delete(`/v2/contact-groups/${g.id}`);
    expect(del.status).toBe(204);

    expect((await api.as(t.admin).get(`/v2/contact-groups/${g.id}`)).status).toBe(404);
    const c1Groups = await api.as(t.admin).get(`/v2/contacts/${c1}/groups`);
    expect(names(c1Groups.body)).toEqual(['Keep']);
    expect((await api.as(t.admin).get(`/v2/contacts/${c2}/groups`)).body).toEqual([]);
    for (const c of [c1, c2, c3, c4])
      expect((await api.as(t.admin).get(`/v2/contacts/${c}`)).status).toBe(200);
    // Reference nulled the phone hash of every detached contact; nothing about the contact changes here
    const phoneAfter = await h.owner.query(
      `SELECT phone, normalized_phone FROM contacts WHERE uuid = $1`,
      [c1],
    );
    expect(phoneAfter.rows[0]).toEqual(phoneBefore.rows[0]);
    const members = await h.owner.query(
      `SELECT count(*)::int AS n FROM contact_group_members WHERE org_id = $1 AND group_id IN (SELECT id FROM contact_groups WHERE name = 'G')`,
      [t.orgId],
    );
    expect(members.rows[0].n).toBe(0);
  });

  it('TW-CON-037 #1: a contact that lost its only group is "no group" (Reference counted it as neither)', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Orphan', phone: '+917000000009' }]);
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Doomed' })).body;
    await api
      .as(t.admin)
      .post('/v2/contacts/bulk/group')
      .send({ ids: [c], groupId: g.id, action: 'add' });
    await api.as(t.admin).delete(`/v2/contact-groups/${g.id}`);
    const list = await api.as(t.admin).get('/v2/contacts?noGroup=true&q=Orphan');
    expect(names(list.body.data)).toEqual(['Orphan']);
  });

  it('TW-CON-003 #3: filtering by a deleted group answers an empty list, not an error', async () => {
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Gone soon' })).body;
    await api.as(t.admin).delete(`/v2/contact-groups/${g.id}`);
    const res = await api.as(t.admin).get(`/v2/contacts?groupId=${g.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('records the delete in the audit trail and the outbox, with how many contacts were detached', async () => {
    const [c1, c2] = await api.seedContacts(t, [
      { name: 'D1', phone: '+917000000011' },
      { name: 'D2', phone: '+917000000012' },
    ]);
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Audit delete' }))
      .body;
    await api
      .as(t.admin)
      .post('/v2/contacts/bulk/group')
      .send({ ids: [c1, c2], groupId: g.id, action: 'add' });
    const before = await api.auditCount(t.orgId, 'contact_groups', 'delete');
    await api.as(t.admin).delete(`/v2/contact-groups/${g.id}`);
    expect(await api.auditCount(t.orgId, 'contact_groups', 'delete')).toBe(before + 1);
    const ev = (await api.events(t.orgId, 'contact_group.deleted')).pop();
    expect(ev).toMatchObject({ uuid: g.id, detachedContacts: 2 });
  });
});

describe("one contact's groups (TW-CON-010 #2, fixed)", () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('mem');
  });

  it('sets the groups as an explicit array, and an empty array removes the last group too', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Member', phone: '+917100000001' }]);
    const a = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'A' })).body;
    const b = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'B' })).body;

    const both = await api
      .as(t.admin)
      .put(`/v2/contacts/${c}/groups`)
      .send({ groupIds: [a.id, b.id] });
    expect(both.status, JSON.stringify(both.body)).toBe(200);
    expect(names(both.body)).toEqual(['A', 'B']);
    const justA = await api
      .as(t.admin)
      .put(`/v2/contacts/${c}/groups`)
      .send({ groupIds: [a.id] });
    expect(names(justA.body)).toEqual(['A']);
    const none = await api.as(t.admin).put(`/v2/contacts/${c}/groups`).send({ groupIds: [] });
    expect(none.body).toEqual([]);

    const added = await api.events(t.orgId, 'contact.group_added');
    const removed = await api.events(t.orgId, 'contact.group_removed');
    expect(added.filter((e) => e.uuid === c)).toHaveLength(2);
    expect(removed.filter((e) => e.uuid === c)).toHaveLength(2);
  });

  it('TW-CON-009 #4 (fixed): a group of another organization cannot be attached', async () => {
    const other = await api.signup('memo');
    const theirs = (await api.as(other.admin).post('/v2/contact-groups').send({ name: 'Foreign' }))
      .body;
    const [c] = await api.seedContacts(t, [{ name: 'Mine', phone: '+917100000002' }]);
    const res = await api
      .as(t.admin)
      .put(`/v2/contacts/${c}/groups`)
      .send({ groupIds: [theirs.id] });
    expect(res.status).toBe(404);
    const bulk = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/group')
      .send({ ids: [c], groupId: theirs.id, action: 'add' });
    expect(bulk.status).toBe(404);
  });
});

describe('permissions and tenant isolation', () => {
  let t: Tenant;
  let other: Tenant;
  beforeAll(async () => {
    t = await api.signup('prm');
    other = await api.signup('prmo');
  });

  it('every group route needs its own capability: a member with only read can list but not create, edit or delete', async () => {
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Guarded' })).body;
    const reader = await api.member(t, 'reader', [['record.contact-groups.read']]);
    expect((await api.as(reader.token).get('/v2/contact-groups')).status).toBe(200);
    expect(
      (await api.as(reader.token).post('/v2/contact-groups').send({ name: 'Nope' })).status,
    ).toBe(403);
    expect(
      (
        await api
          .as(reader.token)
          .patch(`/v2/contact-groups/${g.id}`)
          .send({ name: 'Nope', rowVersion: 1 })
      ).status,
    ).toBe(403);
    expect((await api.as(reader.token).delete(`/v2/contact-groups/${g.id}`)).status).toBe(403);
    const nobody = await api.member(t, 'nobody', []);
    expect((await api.as(nobody.token).get('/v2/contact-groups')).status).toBe(403);
  });

  it("a workspace never sees another workspace's groups, in a list or by id", async () => {
    await api.as(other.admin).post('/v2/contact-groups').send({ name: 'Only theirs' });
    const mine = await api.as(t.admin).get('/v2/contact-groups');
    expect(names(mine.body.data)).not.toContain('Only theirs');
  });

  it('the same name can exist in two workspaces', async () => {
    const a = await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Shared name' });
    const b = await api.as(other.admin).post('/v2/contact-groups').send({ name: 'Shared name' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  it('adding a contact needs update permission on contacts: a member with only the group keys is refused', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Guard', phone: '+917200000001' }]);
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Needs update' }))
      .body;
    const m = await api.member(t, 'grouponly', [
      ['record.contact-groups.read'],
      ['record.contacts.read'],
    ]);
    const res = await api
      .as(m.token)
      .put(`/v2/contacts/${c}/groups`)
      .send({ groupIds: [g.id] });
    expect(res.status).toBe(403);
  });
});
