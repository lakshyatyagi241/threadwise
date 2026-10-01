import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from './support';

/** Remove duplicates, as a merge (TW-CON-025). */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

/** Which of these contacts are still there, oldest first. */
const present = async (t: Tenant, names: string[]) =>
  (
    await h.owner.query(
      `SELECT name FROM contacts WHERE org_id = $1 AND name = ANY($2::text[]) ORDER BY created_at, id`,
      [t.orgId, names],
    )
  ).rows.map((r) => r.name as string);

describe('removing duplicates (TW-CON-025)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('dd');
  });

  it('TW-CON-025 #1: three contacts with the same number; the oldest stays, two are removed', async () => {
    await api.seedContacts(t, [
      { name: 'Oldest', phone: '+919812340001', createdAt: '2026-01-01T00:00:00Z' },
      { name: 'Middle', phone: '+919812340001', createdAt: '2026-02-01T00:00:00Z' },
      { name: 'Newest', phone: '+919812340001', createdAt: '2026-03-01T00:00:00Z' },
    ]);
    const res = await api.as(t.admin).post('/v2/contacts/dedupe').send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ mergedSets: 1, removed: 2, remainingSets: 0 });
    expect(await present(t, ['Oldest', 'Middle', 'Newest'])).toEqual(['Oldest']);
  });

  it('TW-CON-025 #2 (fixed): "+91 98123 45678", "919812345678" and "0091 9812345678" are all duplicates of each other', async () => {
    await api.seedContacts(t, [
      { name: 'Spaced', phone: '+91 98123 40002', createdAt: '2026-01-01T00:00:00Z' },
      { name: 'Bare', phone: '919812340002', createdAt: '2026-01-02T00:00:00Z' },
      { name: 'Zeros', phone: '0091 9812340002', createdAt: '2026-01-03T00:00:00Z' },
    ]);
    const res = await api.as(t.admin).post('/v2/contacts/dedupe').send({});
    expect(res.body).toMatchObject({ mergedSets: 1, removed: 2 });
    expect(await present(t, ['Spaced', 'Bare', 'Zeros'])).toEqual(['Spaced']);
  });

  it('a number written with a separate country code ("9812340003" + "+91") matches the full number', async () => {
    await api.seedContacts(t, [
      { name: 'Full', phone: '+919812340003', createdAt: '2026-01-01T00:00:00Z' },
      { name: 'Split', phone: '9812340003', countryCode: '+91', createdAt: '2026-01-02T00:00:00Z' },
    ]);
    const res = await api.as(t.admin).post('/v2/contacts/dedupe').send({});
    expect(res.body.removed).toBe(1);
    expect(await present(t, ['Full', 'Split'])).toEqual(['Full']);
  });

  it('TW-CON-025 #3: with no duplicates nothing is removed', async () => {
    const t2 = await api.signup('ddn');
    await api.seedContacts(t2, [
      { name: 'A', phone: '+919812340010' },
      { name: 'B', phone: '+919812340011' },
      { name: 'No phone' },
    ]);
    const res = await api.as(t2.admin).post('/v2/contacts/dedupe').send({});
    expect(res.body).toEqual({ mergedSets: 0, removed: 0, remainingSets: 0 });
    const preview = await api.as(t2.admin).get('/v2/contacts/duplicates');
    expect(preview.body).toEqual({ totalSets: 0, totalDuplicates: 0, sets: [] });
  });

  it('contacts without a number are never duplicates of each other', async () => {
    const t3 = await api.signup('ddb');
    await api.seedContacts(t3, [
      { name: 'No phone 1', email: 'a@x.test' },
      { name: 'No phone 2', email: 'b@x.test' },
    ]);
    expect((await api.as(t3.admin).post('/v2/contacts/dedupe').send({})).body.removed).toBe(0);
  });

  it('shows the duplicate sets first: the survivor and the contacts that would be folded into it', async () => {
    const t4 = await api.signup('ddp');
    const [a, b, c] = await api.seedContacts(t4, [
      { name: 'Keep', phone: '+919812340020', createdAt: '2026-01-01T00:00:00Z' },
      { name: 'Fold 1', phone: '+919812340020', createdAt: '2026-01-02T00:00:00Z' },
      { name: 'Fold 2', phone: '+91 98123 40020', createdAt: '2026-01-03T00:00:00Z' },
    ]);
    const preview = await api.as(t4.admin).get('/v2/contacts/duplicates');
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ totalSets: 1, totalDuplicates: 2 });
    expect(preview.body.sets[0]).toEqual({
      phone: '+919812340020',
      survivorId: a,
      duplicateIds: [b, c],
    });
    // a preview removes nothing
    expect(await present(t4, ['Keep', 'Fold 1', 'Fold 2'])).toHaveLength(3);
  });
});

describe('a merge, not a delete (TW-CON-025 port notes)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('mg');
  });

  it("the survivor takes the duplicates' groups and tags (the union), their attribute values, and the fields it lacks", async () => {
    const [keep, dup] = await api.seedContacts(t, [
      {
        name: 'Keeper',
        phone: '+919812340100',
        createdAt: '2026-01-01T00:00:00Z',
        data: { city: 'Pune' },
      },
      {
        name: 'Dupe',
        phone: '+919812340100',
        email: 'dupe@example.com',
        createdAt: '2026-01-02T00:00:00Z',
        data: { city: 'Mumbai', plan: 'gold' },
      },
    ]);
    const g1 = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Group 1' })).body;
    const g2 = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Group 2' })).body;
    await api
      .as(t.admin)
      .put(`/v2/contacts/${keep}/groups`)
      .send({ groupIds: [g1.id] });
    await api
      .as(t.admin)
      .put(`/v2/contacts/${dup}/groups`)
      .send({ groupIds: [g1.id, g2.id] });
    const tag = (await api.as(t.admin).post('/v2/tags').send({ name: 'Dupe tag' })).body;
    await api.as(t.admin).post(`/v2/contacts/${dup}/tags`).send({ tagId: tag.id });

    const res = await api.as(t.admin).post('/v2/contacts/dedupe').send({});
    expect(res.body).toMatchObject({ mergedSets: 1, removed: 1 });

    const merged = (await api.as(t.admin).get(`/v2/contacts/${keep}`)).body;
    expect(merged.email).toBe('dupe@example.com'); // it had none
    expect(merged.name).toBe('Keeper');
    expect(merged.customFields).toEqual({ city: 'Pune', plan: 'gold' }); // its own value wins, the rest is added
    expect(
      (await api.as(t.admin).get(`/v2/contacts/${keep}/groups`)).body.map(
        (g: { name: string }) => g.name,
      ),
    ).toEqual(['Group 1', 'Group 2']);
    expect(
      (await api.as(t.admin).get(`/v2/contacts/${keep}/tags`)).body.map(
        (x: { name: string }) => x.name,
      ),
    ).toEqual(['Dupe tag']);
    expect((await api.as(t.admin).get(`/v2/contacts/${dup}`)).status).toBe(404);
  });

  it("the survivor answers to the duplicate's email and number too (identities move with the merge)", async () => {
    const [keep, dup] = await api.seedContacts(t, [
      { name: 'Id keep', phone: '+919812340150', createdAt: '2026-01-01T00:00:00Z' },
      {
        name: 'Id dup',
        phone: '+919812340150',
        email: 'iddup@example.com',
        createdAt: '2026-01-02T00:00:00Z',
      },
    ]);
    const rows = await h.owner.query(`SELECT uuid, id FROM contacts WHERE uuid = ANY($1::uuid[])`, [
      [keep, dup],
    ]);
    const idOf = (u: string) => Number(rows.rows.find((r) => r.uuid === u).id);
    await h.owner.query(
      `INSERT INTO contact_identities (org_id, contact_id, kind, value, is_primary) VALUES ($1,$2,'email','iddup@example.com',true)`,
      [t.orgId, idOf(dup)],
    );
    await api.as(t.admin).post('/v2/contacts/dedupe').send({});
    const identity = await h.owner.query(
      `SELECT contact_id FROM contact_identities WHERE org_id = $1 AND kind = 'email' AND value = 'iddup@example.com'`,
      [t.orgId],
    );
    expect(identity.rows.map((r) => Number(r.contact_id))).toEqual([idOf(keep)]);
  });

  it('everything that pointed at a duplicate (notes, deals, conversations) points at the survivor afterwards', async () => {
    const [keep, dup] = await api.seedContacts(t, [
      { name: 'Hist keep', phone: '+919812340200', createdAt: '2026-01-01T00:00:00Z' },
      { name: 'Hist dup', phone: '+919812340200', createdAt: '2026-01-02T00:00:00Z' },
    ]);
    const ids = await h.owner.query(`SELECT uuid, id FROM contacts WHERE uuid = ANY($1::uuid[])`, [
      [keep, dup],
    ]);
    const idOf = (u: string) => Number(ids.rows.find((r) => r.uuid === u).id);
    await h.owner.query(
      `INSERT INTO contact_notes (org_id, contact_id, body) VALUES ($1, $2, 'a note on the duplicate')`,
      [t.orgId, idOf(dup)],
    );
    await api.as(t.admin).post('/v2/contacts/dedupe').send({});
    const notes = await h.owner.query(
      `SELECT contact_id, body FROM contact_notes WHERE org_id = $1 AND body = 'a note on the duplicate'`,
      [t.orgId],
    );
    expect(notes.rows.map((r) => ({ ...r, contact_id: Number(r.contact_id) }))).toEqual([
      { contact_id: idOf(keep), body: 'a note on the duplicate' },
    ]);
  });

  it('an opt-out is never forgotten by a merge', async () => {
    const [keep] = await api.seedContacts(t, [
      { name: 'Subscribed', phone: '+919812340300', createdAt: '2026-01-01T00:00:00Z' },
      {
        name: 'Opted out',
        phone: '+919812340300',
        createdAt: '2026-01-02T00:00:00Z',
        isUnsubscribed: true,
      },
    ]);
    await api.as(t.admin).post('/v2/contacts/dedupe').send({});
    expect((await api.as(t.admin).get(`/v2/contacts/${keep}`)).body.isUnsubscribed).toBe(true);
  });

  it('leaves the trail: a merge entry on the survivor, a delete entry per duplicate, and the events', async () => {
    const t2 = await api.signup('mgt');
    const [keep, a, b] = await api.seedContacts(t2, [
      { name: 'K', phone: '+919812340400', createdAt: '2026-01-01T00:00:00Z' },
      { name: 'A', phone: '+919812340400', createdAt: '2026-01-02T00:00:00Z' },
      { name: 'B', phone: '+919812340400', createdAt: '2026-01-03T00:00:00Z' },
    ]);
    await api.as(t2.admin).post('/v2/contacts/dedupe').send({});
    expect(await api.auditCount(t2.orgId, 'contacts', 'merge')).toBe(1);
    expect(await api.auditCount(t2.orgId, 'contacts', 'delete')).toBe(2);
    const merged = await api.events(t2.orgId, 'contact.merged');
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ uuid: keep, mergedUuids: [a, b], phone: '+919812340400' });
    const deleted = await api.events(t2.orgId, 'contact.deleted');
    expect(deleted.map((e) => [e.uuid, e.mergedInto])).toEqual([
      [a, keep],
      [b, keep],
    ]);
  });

  it('a number with a trunk zero and a separate country code is a different number (Reference rule, kept: the zero may be part of the number)', async () => {
    const t3 = await api.signup('mgi');
    await api.as(t3.admin).post('/v2/contacts').send({ name: 'API made', phone: '+919812340500' });
    await api.seedContacts(t3, [{ name: 'Old data', phone: '09812340500', countryCode: '91' }]);
    const res = await api.as(t3.admin).post('/v2/contacts/dedupe').send({});
    expect(res.body.removed).toBe(0);
  });
});

describe('limits and permissions', () => {
  it('maxSets bounds one call and the answer says how many sets are left', async () => {
    const t = await api.signup('ddm');
    for (let i = 0; i < 3; i += 1) {
      await api.seedContacts(t, [
        {
          name: `S${i} a`,
          phone: `+9198123406${String(i).padStart(2, '0')}`,
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          name: `S${i} b`,
          phone: `+9198123406${String(i).padStart(2, '0')}`,
          createdAt: '2026-01-02T00:00:00Z',
        },
      ]);
    }
    const first = await api.as(t.admin).post('/v2/contacts/dedupe').send({ maxSets: 2 });
    expect(first.body).toEqual({ mergedSets: 2, removed: 2, remainingSets: 1 });
    const second = await api.as(t.admin).post('/v2/contacts/dedupe').send({ maxSets: 2 });
    expect(second.body).toEqual({ mergedSets: 1, removed: 1, remainingSets: 0 });
  });

  it('needs merge permission over every contact: "own" scope cannot merge across owners', async () => {
    const t = await api.signup('ddp2');
    const own = await api.member(t, 'ownmerge', [['record.contacts.merge', 'own']]);
    const all = await api.member(t, 'allmerge', [['record.contacts.merge', 'all']]);
    const none = await api.member(t, 'nomerge', [['record.contacts.read']]);
    for (const path of ['/v2/contacts/duplicates']) {
      expect((await api.as(none.token).get(path)).status).toBe(403);
      const scoped = await api.as(own.token).get(path);
      expect(scoped.status).toBe(403);
      expect(scoped.body.code).toBe('CON_MERGE_SCOPE_REQUIRED');
      expect((await api.as(all.token).get(path)).status).toBe(200);
    }
    expect((await api.as(own.token).post('/v2/contacts/dedupe').send({})).body.code).toBe(
      'CON_MERGE_SCOPE_REQUIRED',
    );
    expect((await api.as(none.token).post('/v2/contacts/dedupe').send({})).status).toBe(403);
  });

  it("only this workspace's contacts are looked at: the same number in two workspaces is not a duplicate", async () => {
    const a = await api.signup('ddi');
    const b = await api.signup('ddib');
    await api.seedContacts(a, [{ name: 'A side', phone: '+919812340700' }]);
    await api.seedContacts(b, [{ name: 'B side', phone: '+919812340700' }]);
    expect((await api.as(a.admin).post('/v2/contacts/dedupe').send({})).body.removed).toBe(0);
    expect(await present(b, ['B side'])).toEqual(['B side']);
  });
});
