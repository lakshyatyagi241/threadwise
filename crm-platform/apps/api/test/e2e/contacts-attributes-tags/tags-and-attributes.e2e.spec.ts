import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from './support';

/** Contact tags (WD-CON-038..041) and attributes with the merge-tag feed (WD-CON-042..048). */
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

describe("a contact's tags (WD-CON-038)", () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('tg');
  });

  it('WD-CON-038 #1: a contact tagged VIP in a workspace with 6 tags has 1 tag; the workspace list has 6', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Tagged', phone: '+919900000001' }]);
    const created: Array<{ id: string; name: string }> = [];
    for (const n of ['New Lead', 'Interested', 'Customer', 'VIP', 'Follow Up', 'Not Interested']) {
      created.push((await api.as(t.admin).post('/v2/tags').send({ name: n })).body);
    }
    const vip = created.find((x) => x.name === 'VIP')!;
    await api.as(t.admin).post(`/v2/contacts/${c}/tags`).send({ tagId: vip.id });
    expect(names((await api.as(t.admin).get(`/v2/contacts/${c}/tags`)).body)).toEqual(['VIP']);
    expect((await api.as(t.admin).get('/v2/tags?limit=200')).body.data).toHaveLength(6);
  });

  it('WD-CON-038 #2: a contact of another workspace is a 404', async () => {
    const other = await api.signup('tgo');
    const [theirs] = await api.seedContacts(other, [{ name: 'Theirs', phone: '+919900000002' }]);
    expect((await api.as(t.admin).get(`/v2/contacts/${theirs}/tags`)).status).toBe(404);
    const tag = (await api.as(t.admin).post('/v2/tags').send({ name: 'Mine only' })).body;
    expect(
      (await api.as(t.admin).post(`/v2/contacts/${theirs}/tags`).send({ tagId: tag.id })).status,
    ).toBe(404);
  });

  it('WD-CON-038 #3: with no tags both lists are empty', async () => {
    const t2 = await api.signup('tg0');
    const [c] = await api.seedContacts(t2, [{ name: 'Bare', phone: '+919900000003' }]);
    expect((await api.as(t2.admin).get(`/v2/contacts/${c}/tags`)).body).toEqual([]);
    expect((await api.as(t2.admin).get('/v2/tags')).body.data).toEqual([]);
  });

  it('the bulk picker asks for counts: includeCounts adds how many contacts carry each tag', async () => {
    const t3 = await api.signup('tgc');
    const ids = await api.seedContacts(
      t3,
      [1, 2, 3].map((i) => ({ name: `T${i}`, phone: `+91990000010${i}` })),
    );
    const a = (await api.as(t3.admin).post('/v2/tags').send({ name: 'Counted' })).body;
    await api.as(t3.admin).post('/v2/tags').send({ name: 'Unused' });
    await api.as(t3.admin).post('/v2/contacts/bulk/tag').send({ ids, tagId: a.id, action: 'add' });
    const res = await api.as(t3.admin).get('/v2/tags?includeCounts=true');
    expect(
      Object.fromEntries(
        res.body.data.map((x: { name: string; contactCount: number }) => [x.name, x.contactCount]),
      ),
    ).toEqual({ Counted: 3, Unused: 0 });
    expect((await api.as(t3.admin).get('/v2/tags')).body.data[0].contactCount).toBeUndefined();
  });
});

describe('attaching a tag (WD-CON-039) and detaching it (WD-CON-040)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('att');
  });

  it('WD-CON-039 #1 and #2: attaching by id creates the pivot and ONE event; attaching again changes nothing and fires nothing', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Att', phone: '+919900000201' }]);
    const tag = (await api.as(t.admin).post('/v2/tags').send({ name: 'T' })).body;
    const before = (await api.events(t.orgId, 'contact.tag_added')).length;
    const first = await api.as(t.admin).post(`/v2/contacts/${c}/tags`).send({ tagId: tag.id });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toMatchObject({ id: tag.id, name: 'T' });
    const again = await api.as(t.admin).post(`/v2/contacts/${c}/tags`).send({ tagId: tag.id });
    expect(again.status).toBe(201);
    expect((await api.events(t.orgId, 'contact.tag_added')).length).toBe(before + 1);
    expect((await api.as(t.admin).get(`/v2/contacts/${c}/tags`)).body).toHaveLength(1);
  });

  it('WD-CON-039 #3: the name "Hot Lead" with no such tag creates it and attaches it', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Hot', phone: '+919900000202' }]);
    const res = await api.as(t.admin).post(`/v2/contacts/${c}/tags`).send({ name: 'Hot Lead' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Hot Lead');
    expect(res.body.color).toBe('#075E54');
    expect(names((await api.as(t.admin).get(`/v2/contacts/${c}/tags`)).body)).toEqual(['Hot Lead']);
    // and once more with other casing resolves to the same tag, not a second one
    const again = await api.as(t.admin).post(`/v2/contacts/${c}/tags`).send({ name: 'hot lead' });
    expect(again.body.id).toBe(res.body.id);
    expect((await api.as(t.admin).get('/v2/tags?q=hot lead')).body.data).toHaveLength(1);
  });

  it('WD-CON-039 #4: an unknown tag id and no name is 422 CON_TAG_REQUIRED', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Req', phone: '+919900000203' }]);
    const res = await api.as(t.admin).post(`/v2/contacts/${c}/tags`).send({ tagId: randomUUID() });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CON_TAG_REQUIRED');
    expect((await api.as(t.admin).post(`/v2/contacts/${c}/tags`).send({})).status).toBe(422);
  });

  it('an unknown tag id falls through to the name when there is one (as WaDesk does)', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Fall', phone: '+919900000204' }]);
    const res = await api
      .as(t.admin)
      .post(`/v2/contacts/${c}/tags`)
      .send({ tagId: randomUUID(), name: 'Fallback' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Fallback');
  });

  it('WD-CON-039 (fixed): names are at most 64 characters (WaDesk allowed 80 against a 64 character column)', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Long', phone: '+919900000205' }]);
    expect(
      (
        await api
          .as(t.admin)
          .post(`/v2/contacts/${c}/tags`)
          .send({ name: 'x'.repeat(64) })
      ).status,
    ).toBe(201);
    expect(
      (
        await api
          .as(t.admin)
          .post(`/v2/contacts/${c}/tags`)
          .send({ name: 'x'.repeat(65) })
      ).status,
    ).toBe(422);
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/tags')
          .send({ name: 'y'.repeat(65) })
      ).status,
    ).toBe(422);
  });

  it('WD-CON-041 #3: "Lead" and "lead" are one tag: creating the second is 409 CON_TAG_NAME_TAKEN', async () => {
    await api.as(t.admin).post('/v2/tags').send({ name: 'Lead' });
    const res = await api.as(t.admin).post('/v2/tags').send({ name: 'lead' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CON_TAG_NAME_TAKEN');
  });

  it('WD-CON-039 (fixed): creating a tag needs record.tags.create; attaching an existing one needs only the contact update capability', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Perm', phone: '+919900000206' }]);
    const existing = (await api.as(t.admin).post('/v2/tags').send({ name: 'Existing for perm' }))
      .body;
    const m = await api.member(t, 'tagger', [['record.contacts.update']]);
    expect(
      (await api.as(m.token).post(`/v2/contacts/${c}/tags`).send({ name: 'Brand new for perm' }))
        .status,
    ).toBe(403);
    expect(
      (await api.as(m.token).post(`/v2/contacts/${c}/tags`).send({ tagId: existing.id })).status,
    ).toBe(201);
    const reader = await api.member(t, 'rdr', [['record.contacts.read']]);
    expect(
      (await api.as(reader.token).post(`/v2/contacts/${c}/tags`).send({ tagId: existing.id }))
        .status,
    ).toBe(403);
  });

  it("the caller's record scope applies: a member limited to their own contacts cannot tag another owner's contact", async () => {
    const m = await api.member(t, 'ownscope', [['record.contacts.update', 'own']]);
    const [mine, theirs] = await api.seedContacts(t, [
      { name: 'Scope mine', phone: '+919900000207', ownerId: m.userId },
      { name: 'Scope theirs', phone: '+919900000208', ownerId: t.adminUserId },
    ]);
    const tag = (await api.as(t.admin).post('/v2/tags').send({ name: 'Scope tag' })).body;
    expect(
      (await api.as(m.token).post(`/v2/contacts/${mine}/tags`).send({ tagId: tag.id })).status,
    ).toBe(201);
    expect(
      (await api.as(m.token).post(`/v2/contacts/${theirs}/tags`).send({ tagId: tag.id })).status,
    ).toBe(404);
  });

  it('WD-CON-040 #1: a detached tag no longer lists, and one event says so', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Det', phone: '+919900000209' }]);
    const tag = (await api.as(t.admin).post('/v2/tags').send({ name: 'Detach me' })).body;
    await api.as(t.admin).post(`/v2/contacts/${c}/tags`).send({ tagId: tag.id });
    const before = (await api.events(t.orgId, 'contact.tag_removed')).length;
    expect((await api.as(t.admin).delete(`/v2/contacts/${c}/tags/${tag.id}`)).status).toBe(204);
    expect((await api.as(t.admin).get(`/v2/contacts/${c}/tags`)).body).toEqual([]);
    expect((await api.events(t.orgId, 'contact.tag_removed')).length).toBe(before + 1);
  });

  it('WD-CON-040 #2: detaching a tag the contact does not have succeeds quietly and fires nothing', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Det2', phone: '+919900000210' }]);
    const tag = (await api.as(t.admin).post('/v2/tags').send({ name: 'Never attached' })).body;
    const before = (await api.events(t.orgId, 'contact.tag_removed')).length;
    expect((await api.as(t.admin).delete(`/v2/contacts/${c}/tags/${tag.id}`)).status).toBe(204);
    expect((await api.events(t.orgId, 'contact.tag_removed')).length).toBe(before);
  });

  it('WD-CON-040 #3: a contact of another workspace is a 404', async () => {
    const other = await api.signup('attx');
    const [theirs] = await api.seedContacts(other, [{ name: 'Theirs', phone: '+919900000211' }]);
    const tag = (await api.as(t.admin).post('/v2/tags').send({ name: 'Foreign detach' })).body;
    expect((await api.as(t.admin).delete(`/v2/contacts/${theirs}/tags/${tag.id}`)).status).toBe(
      404,
    );
  });

  it('WD-CON-041 #2: deleting a tag removes it from every contact (no orphan rows to hide)', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Orphan test', phone: '+919900000212' }]);
    const tag = (await api.as(t.admin).post('/v2/tags').send({ name: 'Doomed tag' })).body;
    await api.as(t.admin).post(`/v2/contacts/${c}/tags`).send({ tagId: tag.id });
    await api.as(t.admin).delete(`/v2/tags/${tag.id}`);
    expect((await api.as(t.admin).get(`/v2/contacts/${c}/tags`)).body).toEqual([]);
    const rows = await h.owner.query(
      `SELECT count(*)::int AS n FROM contact_tags WHERE org_id = $1 AND tag_id NOT IN (SELECT id FROM tags WHERE org_id = $1)`,
      [t.orgId],
    );
    expect(rows.rows[0].n).toBe(0);
  });

  it('attaching leaves an audit row on the contact', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Audited tag', phone: '+919900000213' }]);
    const tag = (await api.as(t.admin).post('/v2/tags').send({ name: 'Audited tag t' })).body;
    const before = await api.auditCount(t.orgId, 'contacts', 'update');
    await api.as(t.admin).post(`/v2/contacts/${c}/tags`).send({ tagId: tag.id });
    expect(await api.auditCount(t.orgId, 'contacts', 'update')).toBe(before + 1);
  });
});

describe('the attribute list and its tiles (WD-CON-042)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('al');
    for (let i = 0; i < 30; i += 1) {
      const res = await api
        .as(t.admin)
        .post('/v2/attributes')
        .send({
          name: i % 3 === 0 ? `Order thing ${i}` : `Field ${i}`,
          key: `attr_${String(i).padStart(2, '0')}`,
          description: i === 7 ? 'Where it ships' : undefined,
          isActive: i % 5 !== 0,
        });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
  }, 60_000);

  it('WD-CON-042 #1: 30 attributes show 12, with workspace-wide counts (all 30, 24 active, 6 inactive) and a next page', async () => {
    const res = await api.as(t.admin).get('/v2/attributes?limit=12');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toHaveLength(12);
    expect(res.body.counts).toEqual({ all: 30, active: 24, inactive: 6 });
    expect(res.body.page.hasMore).toBe(true);
    expect(res.body.data[0].key).toBe('attr_29'); // newest first
    const p2 = await api
      .as(t.admin)
      .get(`/v2/attributes?limit=12&cursor=${res.body.page.nextCursor}`);
    expect(p2.body.data[0].key).toBe('attr_17');
  });

  it('WD-CON-042 #2: ?q=order&status=active lists only matching active rows, and the counts stay workspace-wide', async () => {
    const res = await api.as(t.admin).get('/v2/attributes?q=order&status=active&limit=50');
    expect(
      res.body.data.every(
        (a: { name: string; isActive: boolean }) => /order/i.test(a.name) && a.isActive,
      ),
    ).toBe(true);
    expect(res.body.data).toHaveLength(8); // i = 3,6,9,12,15,18,21,24,27 minus the inactive multiples of 15 (0 and 15 and 30): 9 - 1 = 8
    expect(res.body.counts).toEqual({ all: 30, active: 24, inactive: 6 });
  });

  it('search covers the name, the key and the description; the inactive filter works', async () => {
    expect(
      (await api.as(t.admin).get('/v2/attributes?q=ships')).body.data.map(
        (a: { key: string }) => a.key,
      ),
    ).toEqual(['attr_07']);
    expect((await api.as(t.admin).get('/v2/attributes?q=attr_2&limit=50')).body.data).toHaveLength(
      10,
    );
    const inactive = await api.as(t.admin).get('/v2/attributes?status=inactive&limit=50');
    expect(inactive.body.data).toHaveLength(6);
    expect(inactive.body.data.every((a: { isActive: boolean }) => !a.isActive)).toBe(true);
  });

  it('WD-CON-042 #3 (fixed): a member without the contact-properties capability gets 403; WaDesk showed the page to an agent', async () => {
    const agent = await api.member(t, 'agent', [
      ['record.contacts.read'],
      ['record.contacts.update'],
    ]);
    expect((await api.as(agent.token).get('/v2/attributes')).status).toBe(403);
    const reader = await api.member(t, 'propreader', [['record.contact-properties.read']]);
    expect((await api.as(reader.token).get('/v2/attributes')).status).toBe(200);
  });

  it("another workspace's attributes are not visible", async () => {
    const other = await api.signup('alo');
    expect((await api.as(other.admin).get('/v2/attributes')).body).toMatchObject({
      data: [],
      counts: { all: 0, active: 0, inactive: 0 },
    });
    const mine = (await api.as(t.admin).get('/v2/attributes?limit=1')).body.data[0];
    expect((await api.as(other.admin).get(`/v2/attributes/${mine.id}`)).status).toBe(404);
  });
});

describe('creating, editing and deleting an attribute (WD-CON-043..045)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ac');
  });

  it('WD-CON-043 #1: "Order ID" with key order_id is created, active, and listed', async () => {
    const res = await api.as(t.admin).post('/v2/attributes').send({
      name: 'Order ID',
      key: 'order_id',
      defaultValue: 'none yet',
      description: 'The shop order',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Order ID',
      key: 'order_id',
      type: 'text',
      defaultValue: 'none yet',
      description: 'The shop order',
      isActive: true,
      rowVersion: 1,
    });
    expect(
      (await api.as(t.admin).get('/v2/attributes')).body.data.map((a: { key: string }) => a.key),
    ).toContain('order_id');
    // it is a row of the field registry, in a section of its own
    const row = await h.owner.query(
      `SELECT f.module_key, f.field_type, s.name AS section FROM fields f JOIN field_sections s ON s.org_id = f.org_id AND s.id = f.section_id WHERE f.org_id = $1 AND f.key = 'order_id'`,
      [t.orgId],
    );
    expect(row.rows[0]).toEqual({
      module_key: 'contacts',
      field_type: 'text',
      section: 'Custom attributes',
    });
  });

  it('WD-CON-043 #2: the same key again is 409 FIELD_KEY_TAKEN', async () => {
    const res = await api
      .as(t.admin)
      .post('/v2/attributes')
      .send({ name: 'Other', key: 'order_id' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('FIELD_KEY_TAKEN');
  });

  it('WD-CON-043 #3 (fixed): Active unticked (isActive false) creates an INACTIVE attribute', async () => {
    const res = await api
      .as(t.admin)
      .post('/v2/attributes')
      .send({ name: 'Off', key: 'off_attr', isActive: false });
    expect(res.status).toBe(201);
    expect(res.body.isActive).toBe(false);
  });

  it('WD-CON-043 #4: a key with a space is rejected; so are uppercase and non-ASCII keys', async () => {
    for (const key of ['order id', 'Order_ID', 'ünï', '1abc', '']) {
      const res = await api.as(t.admin).post('/v2/attributes').send({ name: 'Bad', key });
      expect(res.status, key).toBe(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
  });

  it('WD-CON-043 (fixed): a key that already means something at send time (a built-in token, a contact column, status, source) is refused', async () => {
    for (const key of [
      'name',
      'email',
      'today',
      'phone',
      'status',
      'source',
      'first_name',
      'groups',
    ]) {
      const res = await api.as(t.admin).post('/v2/attributes').send({ name: 'Shadow', key });
      expect(res.status, key).toBe(422);
      expect(res.body.code, key).toBe('CON_ATTRIBUTE_KEY_RESERVED');
    }
  });

  it('WD-CON-043: limits: name 120, default 255, description 500', async () => {
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/attributes')
          .send({ name: 'n'.repeat(121), key: 'lim_a' })
      ).status,
    ).toBe(422);
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/attributes')
          .send({ name: 'ok', key: 'lim_b', defaultValue: 'd'.repeat(256) })
      ).status,
    ).toBe(422);
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/attributes')
          .send({ name: 'ok', key: 'lim_c', description: 'd'.repeat(501) })
      ).status,
    ).toBe(422);
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/attributes')
          .send({
            name: 'n'.repeat(120),
            key: 'lim_d',
            defaultValue: 'd'.repeat(255),
            description: 'd'.repeat(500),
          })
      ).status,
    ).toBe(201);
  });

  it('WD-CON-043 (fixed): a viewer cannot create, edit or delete an attribute', async () => {
    const attr = (
      await api
        .as(t.admin)
        .post('/v2/attributes')
        .send({ name: 'Viewer target', key: 'viewer_target' })
    ).body;
    const viewer = await api.member(t, 'viewer', [
      ['record.contacts.read'],
      ['record.contact-properties.read'],
    ]);
    expect(
      (await api.as(viewer.token).post('/v2/attributes').send({ name: 'X', key: 'viewer_new' }))
        .status,
    ).toBe(403);
    expect(
      (
        await api
          .as(viewer.token)
          .patch(`/v2/attributes/${attr.id}`)
          .send({ name: 'Hacked', rowVersion: 1 })
      ).status,
    ).toBe(403);
    expect((await api.as(viewer.token).delete(`/v2/attributes/${attr.id}`)).status).toBe(403);
    expect((await api.as(t.admin).get(`/v2/attributes/${attr.id}`)).body.name).toBe(
      'Viewer target',
    );
  });

  it('a create writes one audit row and one outbox event', async () => {
    const before = await api.auditCount(t.orgId, 'fields', 'insert');
    const evBefore = (await api.events(t.orgId, 'field.created')).length;
    await api.as(t.admin).post('/v2/attributes').send({ name: 'Audited', key: 'audited_attr' });
    expect(await api.auditCount(t.orgId, 'fields', 'insert')).toBe(before + 1);
    expect((await api.events(t.orgId, 'field.created')).length).toBe(evBefore + 1);
  });

  it('WD-CON-044 #1: changing the default is picked up by the merge-tag preview for a contact with no value', async () => {
    const attr = (
      await api
        .as(t.admin)
        .post('/v2/attributes')
        .send({ name: 'City', key: 'city', defaultValue: 'unknown' })
    ).body;
    const [c] = await api.seedContacts(t, [{ name: 'No city', phone: '+919900000301' }]);
    const render = async () =>
      (
        await api
          .as(t.admin)
          .post('/v2/attributes/resolve')
          .send({ template: 'From {{city}}', contactId: c })
      ).body.rendered;
    expect(await render()).toBe('From unknown');
    const edited = await api
      .as(t.admin)
      .patch(`/v2/attributes/${attr.id}`)
      .send({ defaultValue: 'N/A', rowVersion: attr.rowVersion });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body).toMatchObject({
      defaultValue: 'N/A',
      key: 'city',
      rowVersion: attr.rowVersion + 1,
    });
    expect(await render()).toBe('From N/A');
  });

  it('WD-CON-044 #2 (fixed): Active unticked deactivates the attribute; it leaves the picker and stops resolving', async () => {
    const attr = (
      await api
        .as(t.admin)
        .post('/v2/attributes')
        .send({ name: 'Plan', key: 'plan_name', defaultValue: 'free' })
    ).body;
    expect(
      (await api.as(t.admin).get('/v2/attributes/picker')).body.custom.map(
        (c: { key: string }) => c.key,
      ),
    ).toContain('plan_name');
    const off = await api
      .as(t.admin)
      .patch(`/v2/attributes/${attr.id}`)
      .send({ isActive: false, rowVersion: attr.rowVersion });
    expect(off.body.isActive).toBe(false);
    expect(
      (await api.as(t.admin).get('/v2/attributes/picker')).body.custom.map(
        (c: { key: string }) => c.key,
      ),
    ).not.toContain('plan_name');
    expect(
      (await api.as(t.admin).post('/v2/attributes/resolve').send({ template: '[{{plan_name}}]' }))
        .body.rendered,
    ).toBe('[]');
    const on = await api
      .as(t.admin)
      .patch(`/v2/attributes/${attr.id}`)
      .send({ isActive: true, rowVersion: off.body.rowVersion });
    expect(on.body.isActive).toBe(true);
    expect(
      (await api.as(t.admin).post('/v2/attributes/resolve').send({ template: '[{{plan_name}}]' }))
        .body.rendered,
    ).toBe('[free]');
  });

  it('WD-CON-044: the key and the type cannot be changed; a description or default is cleared with null and kept when absent', async () => {
    const attr = (
      await api
        .as(t.admin)
        .post('/v2/attributes')
        .send({ name: 'Keep', key: 'keep_me', description: 'd', defaultValue: 'v' })
    ).body;
    const renamed = (
      await api
        .as(t.admin)
        .patch(`/v2/attributes/${attr.id}`)
        .send({ name: 'Keep 2', key: 'changed', type: 'date', rowVersion: attr.rowVersion })
    ).body;
    expect(renamed).toMatchObject({
      name: 'Keep 2',
      key: 'keep_me',
      type: 'text',
      description: 'd',
      defaultValue: 'v',
    });
    const cleared = (
      await api
        .as(t.admin)
        .patch(`/v2/attributes/${attr.id}`)
        .send({ description: null, defaultValue: '', rowVersion: renamed.rowVersion })
    ).body;
    expect(cleared).toMatchObject({ description: null, defaultValue: null });
  });

  it('WD-CON-044 #3: an id from another workspace is a 404; a stale rowVersion is 409', async () => {
    const other = await api.signup('acx');
    const theirs = (
      await api.as(other.admin).post('/v2/attributes').send({ name: 'Theirs', key: 'theirs' })
    ).body;
    expect(
      (
        await api
          .as(t.admin)
          .patch(`/v2/attributes/${theirs.id}`)
          .send({ name: 'x', rowVersion: 1 })
      ).status,
    ).toBe(404);
    expect((await api.as(t.admin).delete(`/v2/attributes/${theirs.id}`)).status).toBe(404);
    const mine = (
      await api.as(t.admin).post('/v2/attributes').send({ name: 'Mine', key: 'mine_attr' })
    ).body;
    await api.as(t.admin).patch(`/v2/attributes/${mine.id}`).send({ name: 'v2', rowVersion: 1 });
    const stale = await api
      .as(t.admin)
      .patch(`/v2/attributes/${mine.id}`)
      .send({ name: 'v3', rowVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
  });

  it('WD-CON-045 #1: a deleted attribute disappears from the list and the picker', async () => {
    const attr = (
      await api.as(t.admin).post('/v2/attributes').send({ name: 'Gone', key: 'gone_attr' })
    ).body;
    expect((await api.as(t.admin).delete(`/v2/attributes/${attr.id}`)).status).toBe(204);
    expect(
      (await api.as(t.admin).get('/v2/attributes?limit=100')).body.data.map(
        (a: { key: string }) => a.key,
      ),
    ).not.toContain('gone_attr');
    expect(
      (await api.as(t.admin).get('/v2/attributes/picker')).body.custom.map(
        (c: { key: string }) => c.key,
      ),
    ).not.toContain('gone_attr');
    // the key is free again
    expect(
      (await api.as(t.admin).post('/v2/attributes').send({ name: 'Back', key: 'gone_attr' }))
        .status,
    ).toBe(201);
  });

  it('WD-CON-045 #2 (fixed): deleting an attribute some contacts hold a value for asks first (409 CON_ATTRIBUTE_IN_USE); with force=true their values stay', async () => {
    const attr = (
      await api.as(t.admin).post('/v2/attributes').send({ name: 'Held', key: 'held_attr' })
    ).body;
    const [c] = await api.seedContacts(t, [
      { name: 'Holder', phone: '+919900000401', data: { held_attr: 'x' } },
    ]);
    const refused = await api.as(t.admin).delete(`/v2/attributes/${attr.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('CON_ATTRIBUTE_IN_USE');
    expect(refused.body.errors).toEqual([{ path: 'contacts', message: '1' }]);
    expect((await api.as(t.admin).get(`/v2/attributes/${attr.id}`)).status).toBe(200);
    expect((await api.as(t.admin).delete(`/v2/attributes/${attr.id}?force=true`)).status).toBe(204);
    expect((await api.as(t.admin).get(`/v2/contacts/${c}`)).body.customFields).toEqual({
      held_attr: 'x',
    });
  });

  it("WD-CON-016: a contact's own attribute value fills the tag; a contact without one gets the default; editing merges customFields", async () => {
    await api
      .as(t.admin)
      .post('/v2/attributes')
      .send({ name: 'Order ID', key: 'order_ref', defaultValue: 'n/a' });
    const [c1, c2] = await api.seedContacts(t, [
      { name: 'Has', phone: '+919900000402' },
      { name: 'Lacks', phone: '+919900000403' },
    ]);
    const c1Row = (await api.as(t.admin).get(`/v2/contacts/${c1}`)).body;
    const patched = await api
      .as(t.admin)
      .patch(`/v2/contacts/${c1}`)
      .send({ customFields: { order_ref: 'A12' }, rowVersion: c1Row.rowVersion });
    expect(patched.body.customFields).toEqual({ order_ref: 'A12' });
    const render = async (id: string) =>
      (
        await api
          .as(t.admin)
          .post('/v2/attributes/resolve')
          .send({ template: '{{order_ref}}', contactId: id })
      ).body.rendered;
    expect(await render(c1)).toBe('A12');
    expect(await render(c2)).toBe('n/a');
  });
});

describe('the picker feed and the catalogue (WD-CON-046, 047)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('pk');
    await api
      .as(t.admin)
      .post('/v2/attributes')
      .send({ name: 'Order ID', key: 'order_id', defaultValue: 'A-0', description: 'Shop order' });
    await api
      .as(t.admin)
      .post('/v2/attributes')
      .send({ name: 'Promo', key: 'promo', defaultValue: 'SAVE' });
    await api
      .as(t.admin)
      .post('/v2/attributes')
      .send({ name: 'Hidden', key: 'hidden_attr', isActive: false });
  });

  it('WD-CON-046 #1: 2 active and 1 inactive attributes: the feed has 2 custom and 10 built-in entries', async () => {
    const res = await api.as(t.admin).get('/v2/attributes/picker');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.system).toHaveLength(10);
    expect(res.body.system.map((s: { key: string }) => s.key)).toEqual([
      'first_name',
      'name',
      'last_name',
      'phone_number',
      'email',
      'country_code',
      'address',
      'language',
      'business_name',
      'today',
    ]);
    expect(res.body.custom).toEqual([
      { key: 'order_id', name: 'Order ID', description: 'Shop order', value: 'A-0' },
      { key: 'promo', name: 'Promo', description: null, value: 'SAVE' },
    ]);
  });

  it('the feed needs only the right to read contacts: any composer user can load it', async () => {
    const agent = await api.member(t, 'composer', [['record.contacts.read']]);
    expect((await api.as(agent.token).get('/v2/attributes/picker')).status).toBe(200);
    const nobody = await api.member(t, 'nobodypick', []);
    expect((await api.as(nobody.token).get('/v2/attributes/picker')).status).toBe(403);
  });

  it('WD-CON-047 #1..#3: the catalogue groups contact fields, custom fields found on contacts, workspace attributes and system tokens, each key once', async () => {
    await api.seedContacts(t, [
      {
        name: 'Sample Person',
        phone: '+919900000501',
        email: 's@example.com',
        data: { city: 'Pune', order_id: 'Z9' },
      },
    ]);
    const res = await api.as(t.admin).get('/v2/attributes/catalog');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const group = (g: string) =>
      res.body.groups.find((x: { group: string }) => x.group === g).items as Array<{
        key: string;
        label: string;
        sample: string | null;
      }>;
    expect(group('contact').map((i) => i.key)).toEqual([
      'name',
      'first_name',
      'middle_name',
      'last_name',
      'title',
      'phone',
      'country_code',
      'email',
      'address',
      'language',
      'groups',
    ]);
    expect(group('contact').find((i) => i.key === 'name')!.sample).toBe('Sample Person');
    expect(group('contact').find((i) => i.key === 'phone')!.sample).toBe('919900000501');
    // "City" is found on contacts; order_id is registered, so it is listed under the workspace, not twice
    expect(group('custom_field')).toEqual([{ key: 'city', label: 'City', sample: 'Pune' }]);
    expect(group('workspace')).toEqual([
      { key: 'order_id', label: 'Order ID', sample: 'A-0' },
      { key: 'promo', label: 'Promo', sample: 'SAVE' },
    ]);
    expect(group('system').map((i) => i.key)).toEqual(['today', 'business_name', 'company_name']);
  });
});

describe('merge-tag preview (WD-CON-048)', () => {
  let t: Tenant;
  let contactId: string;
  beforeAll(async () => {
    t = await api.signup('mt');
    await api
      .as(t.admin)
      .post('/v2/attributes')
      .send({ name: 'City', key: 'city', defaultValue: 'N/A' });
    [contactId] = await api.seedContacts(t, [
      {
        name: 'Aarav Sharma',
        phone: '+919812345678',
        email: 'aarav@example.com',
        countryCode: '+91',
        data: { city: 'Pune' },
      },
    ]);
  });

  const render = (template: string, id?: string, token = t.admin) =>
    api.as(token).post('/v2/attributes/resolve').send({ template, contactId: id });

  it('WD-CON-048 #1: "{{Customer Name}}" resolves to the contact\'s full name', async () => {
    const res = await render('Hi {{Customer Name}}', contactId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.rendered).toBe('Hi Aarav Sharma');
    expect(res.body.tokens).toEqual([
      { token: '{{Customer Name}}', key: 'name', resolved: true, source: 'contact' },
    ]);
  });

  it("WD-CON-048 #2: the contact's city beats the attribute default; a contact without one gets the default", async () => {
    expect((await render('{{city}}', contactId)).body.rendered).toBe('Pune');
    expect((await render('{{city}}')).body.rendered).toBe('N/A');
  });

  it('WD-CON-048 #3: an unknown token is blank (never the literal braces)', async () => {
    const res = await render('a{{foo}}b', contactId);
    expect(res.body.rendered).toBe('ab');
    expect(res.body.tokens[0]).toMatchObject({ resolved: false, source: 'unresolved' });
  });

  it('WD-CON-048 #4: business_name and today come from the workspace and the clock', async () => {
    const res = await render('{{business_name}} / {{today}}');
    const org = await h.owner.query(`SELECT name FROM organizations WHERE id = $1`, [t.orgId]);
    expect(res.body.rendered).toBe(
      `${org.rows[0].name} / ${new Date().toISOString().slice(0, 10)}`,
    );
  });

  it('phone is digits with the country code, mobile the local part, groups are names', async () => {
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'VIP' })).body;
    await api
      .as(t.admin)
      .put(`/v2/contacts/${contactId}/groups`)
      .send({ groupIds: [g.id] });
    const res = await render('{{phone_number}}|{{mobile}}|{{groups}}', contactId);
    expect(res.body.rendered).toBe('919812345678|9812345678|VIP');
  });

  it("a contact of another workspace is a 404, and the caller's record scope applies", async () => {
    const other = await api.signup('mtx');
    const [theirs] = await api.seedContacts(other, [{ name: 'Theirs', phone: '+919812345679' }]);
    expect((await render('{{name}}', theirs)).status).toBe(404);
    const own = await api.member(t, 'ownmt', [['record.contacts.read', 'own']]);
    expect((await render('{{name}}', contactId, own.token)).status).toBe(404);
  });

  it('a template over 5,000 characters is a validation error', async () => {
    expect((await render('x'.repeat(5001))).status).toBe(422);
  });
});
