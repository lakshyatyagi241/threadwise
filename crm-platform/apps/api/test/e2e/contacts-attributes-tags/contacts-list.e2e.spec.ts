import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from './support';

/**
 * The contacts list, search, filters and stat tiles end to end: WD-CON-001..008 on the existing
 * GET /v2/contacts (extended, not replaced) and the new GET /v2/contacts/stats.
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

const names = (rows: Array<{ name: string | null }>) => rows.map((r) => r.name);

describe('listing (WD-CON-001, 005)', () => {
  let a: Tenant;
  let b: Tenant;
  beforeAll(async () => {
    a = await api.signup('lsta');
    b = await api.signup('lstb');
    await api.seedContacts(
      a,
      Array.from({ length: 30 }, (_, i) => ({
        name: `A contact ${String(i).padStart(2, '0')}`,
        phone: `+91900000${String(1000 + i)}`,
      })),
    );
    await api.seedContacts(
      b,
      Array.from({ length: 5 }, (_, i) => ({
        name: `B contact ${i}`,
        phone: `+91800000${String(1000 + i)}`,
      })),
    );
  });

  it("WD-CON-001 #1: 30 contacts in A and 5 in B; A counts 30, newest first, 12 on the first page, none of B's", async () => {
    const res = await api.as(a.admin).get('/v2/contacts?limit=12&includeTotal=true');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.meta.total).toBe(30);
    expect(res.body.data).toHaveLength(12);
    expect(res.body.page.hasMore).toBe(true);
    expect(res.body.data[0].name).toBe('A contact 29');
    expect(names(res.body.data).every((n) => n?.startsWith('A contact'))).toBe(true);
    const page2 = await api
      .as(a.admin)
      .get(`/v2/contacts?limit=12&cursor=${res.body.page.nextCursor}`);
    expect(page2.body.data[0].name).toBe('A contact 17');
  });

  it('WD-CON-001 #2: a member without the contacts capability gets 403; the admin gets the page', async () => {
    const nobody = await api.member(a, 'nolist', []);
    expect((await api.as(nobody.token).get('/v2/contacts')).status).toBe(403);
    expect((await api.as(a.admin).get('/v2/contacts')).status).toBe(200);
  });

  it('the total is only computed when asked for (an unfiltered count is not free on a big book)', async () => {
    const res = await api.as(a.admin).get('/v2/contacts?limit=5');
    expect(res.body.meta).toBeUndefined();
  });

  it('WD-CON-005 #1/#2 (adapted): any page size from 1 to 1000 works, 1001 is a validation error', async () => {
    expect((await api.as(a.admin).get('/v2/contacts?limit=7')).body.data).toHaveLength(7);
    expect((await api.as(a.admin).get('/v2/contacts?limit=1000')).body.data).toHaveLength(30);
    const tooBig = await api.as(a.admin).get('/v2/contacts?limit=1001');
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.code).toBe('VALIDATION_FAILED');
  });

  it('the older query (order, lifecycleStage) keeps working', async () => {
    const asc = await api.as(a.admin).get('/v2/contacts?order=asc&limit=2');
    expect(names(asc.body.data)).toEqual(['A contact 00', 'A contact 01']);
    const stage = await api.as(a.admin).get('/v2/contacts?lifecycleStage=new&limit=1');
    expect(stage.body.data).toHaveLength(1);
    const none = await api.as(a.admin).get('/v2/contacts?lifecycleStage=customer');
    expect(none.body.data).toEqual([]);
  });

  it('the response carries uuids only and the new source and consent fields', async () => {
    const res = await api.as(a.admin).get('/v2/contacts?limit=1');
    const row = res.body.data[0];
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row).toMatchObject({ source: null, isUnsubscribed: false });
    expect(JSON.stringify(row)).not.toMatch(/"(orgId|org_id)"/);
  });

  it('WD-CON-008: expand=groups,tags adds the chips for each row, nothing else is loaded without it', async () => {
    const [c] = await api.seedContacts(a, [{ name: 'Chip person', phone: '+919000009999' }]);
    const g = (
      await api
        .as(a.admin)
        .post('/v2/contact-groups')
        .send({ name: 'Chip group', color: '#22C55E' })
    ).body;
    await api
      .as(a.admin)
      .put(`/v2/contacts/${c}/groups`)
      .send({ groupIds: [g.id] });
    const tag = (await api.as(a.admin).post('/v2/tags').send({ name: 'Chip tag' })).body;
    await api.as(a.admin).post(`/v2/contacts/${c}/tags`).send({ tagId: tag.id });

    const plain = await api.as(a.admin).get('/v2/contacts?q=Chip person');
    expect(plain.body.data[0].groups).toBeUndefined();
    const rich = await api.as(a.admin).get('/v2/contacts?q=Chip person&expand=groups,tags');
    expect(rich.body.data[0].groups).toEqual([{ id: g.id, name: 'Chip group', color: '#22C55E' }]);
    expect(rich.body.data[0].tags).toEqual([{ id: tag.id, name: 'Chip tag', color: null }]);
  });
});

describe('search (WD-CON-002)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('srch');
    await api.seedContacts(t, [
      { name: 'Aarav Sharma', phone: '+919812345678', email: 'aarav@example.com' },
      { name: 'Priya Patel', phone: '+919898765432', email: 'priya@example.com' },
      { name: 'Support', phone: '+14155550100', email: 'x@acme.io' },
      { name: '100% Real_Name', phone: '+14155550101' },
    ]);
  });

  it('WD-CON-002 #1: "PATEL" finds only Priya, whatever the case', async () => {
    const res = await api.as(t.admin).get('/v2/contacts?q=PATEL&includeTotal=true');
    expect(names(res.body.data)).toEqual(['Priya Patel']);
    expect(res.body.meta.total).toBe(1);
  });

  it('WD-CON-002 #2: "acme" matches the email x@acme.io; "acme x" matches too (every word, any field)', async () => {
    expect(names((await api.as(t.admin).get('/v2/contacts?q=acme')).body.data)).toEqual([
      'Support',
    ]);
    // WaDesk needed the whole string in ONE field and so missed this; here each word is matched on its own
    expect(names((await api.as(t.admin).get('/v2/contacts?q=acme%20x')).body.data)).toEqual([
      'Support',
    ]);
  });

  it('words can come in any order: "Sharma Aarav" finds "Aarav Sharma"', async () => {
    expect(names((await api.as(t.admin).get('/v2/contacts?q=Sharma%20Aarav')).body.data)).toEqual([
      'Aarav Sharma',
    ]);
  });

  it('WD-CON-002 (port note): the digits of a number find it however it is typed', async () => {
    expect(names((await api.as(t.admin).get('/v2/contacts?q=98123')).body.data)).toEqual([
      'Aarav Sharma',
    ]);
    expect(names((await api.as(t.admin).get('/v2/contacts?q=%2B91%209812')).body.data)).toEqual([
      'Aarav Sharma',
    ]);
    expect(names((await api.as(t.admin).get('/v2/contacts?q=9898-765')).body.data)).toEqual([
      'Priya Patel',
    ]);
  });

  it('wildcards the user types are text: "%" and "_" match only names that really contain them', async () => {
    expect(names((await api.as(t.admin).get('/v2/contacts?q=%25')).body.data)).toEqual([
      '100% Real_Name',
    ]);
    expect(names((await api.as(t.admin).get('/v2/contacts?q=l_N')).body.data)).toEqual([
      '100% Real_Name',
    ]);
  });

  it('WD-CON-002 #4: a search with no result is an empty page with total 0', async () => {
    const res = await api.as(t.admin).get('/v2/contacts?q=zzzz&includeTotal=true');
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });

  it('the picker (select-data) searches the same way as the list', async () => {
    const res = await api.as(t.admin).get('/v2/contacts/select-data?q=Sharma%20Aarav');
    expect(res.body.map((r: { name: string }) => r.name)).toEqual(['Aarav Sharma']);
  });
});

describe('group and tag filters (WD-CON-003, 004)', () => {
  let t: Tenant;
  let ids: string[];
  let g: { id: string };
  beforeAll(async () => {
    t = await api.signup('flt');
    ids = await api.seedContacts(
      t,
      Array.from({ length: 10 }, (_, i) => ({
        name: `F${i}`,
        phone: `+9170000010${String(i).padStart(2, '0')}`,
      })),
    );
    g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'G' })).body;
    await api
      .as(t.admin)
      .post('/v2/contacts/bulk/group')
      .send({ ids: ids.slice(0, 3), groupId: g.id, action: 'add' });
  });

  it('WD-CON-003 #1: 10 contacts, 3 in G; ?groupId=G lists 3', async () => {
    const res = await api.as(t.admin).get(`/v2/contacts?groupId=${g.id}&includeTotal=true`);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.meta.total).toBe(3);
  });

  it('WD-CON-003 #2: ?noGroup=true lists only contacts with no group', async () => {
    const res = await api.as(t.admin).get('/v2/contacts?noGroup=true&includeTotal=true');
    expect(res.body.meta.total).toBe(7);
    expect(names(res.body.data)).not.toContain('F0');
  });

  it('WD-CON-003: a group and a search combine; a group of another organization matches nothing', async () => {
    const res = await api.as(t.admin).get(`/v2/contacts?groupId=${g.id}&q=F1`);
    expect(names(res.body.data)).toEqual(['F1']);
    const other = await api.signup('fltx');
    const theirs = (await api.as(other.admin).post('/v2/contact-groups').send({ name: 'Theirs' }))
      .body;
    const none = await api.as(t.admin).get(`/v2/contacts?groupId=${theirs.id}`);
    expect(none.status).toBe(200);
    expect(none.body.data).toEqual([]);
  });

  it('WD-CON-003: groupId together with noGroup is a validation error', async () => {
    expect((await api.as(t.admin).get(`/v2/contacts?groupId=${g.id}&noGroup=true`)).status).toBe(
      422,
    );
  });

  it('WD-CON-004 #1: contacts A (tag VIP) and B (no tag); filtering by VIP lists only A', async () => {
    const vip = (await api.as(t.admin).post('/v2/tags').send({ name: 'VIP' })).body;
    await api.as(t.admin).post(`/v2/contacts/${ids[5]}/tags`).send({ tagId: vip.id });
    const res = await api.as(t.admin).get(`/v2/contacts?tagIds=${vip.id}`);
    expect(names(res.body.data)).toEqual(['F5']);
    // the single-tag spelling WaDesk's chip link used
    expect(names((await api.as(t.admin).get(`/v2/contacts?tagId=${vip.id}`)).body.data)).toEqual([
      'F5',
    ]);
  });

  it('WD-CON-004 #2: a tag and a search apply together', async () => {
    const tag = (await api.as(t.admin).post('/v2/tags').send({ name: 'Both' })).body;
    await api.as(t.admin).post(`/v2/contacts/${ids[6]}/tags`).send({ tagId: tag.id });
    await api.as(t.admin).post(`/v2/contacts/${ids[7]}/tags`).send({ tagId: tag.id });
    const res = await api.as(t.admin).get(`/v2/contacts?tagIds=${tag.id}&q=F6`);
    expect(names(res.body.data)).toEqual(['F6']);
  });

  it('WD-CON-004 #3 (changed): a tag that is not a uuid is a validation error instead of being ignored', async () => {
    expect((await api.as(t.admin).get('/v2/contacts?tagId=abc')).status).toBe(422);
  });

  it('WD-CON-004 (port note): several tags, any or all of them', async () => {
    const t1 = (await api.as(t.admin).post('/v2/tags').send({ name: 'T-one' })).body;
    const t2 = (await api.as(t.admin).post('/v2/tags').send({ name: 'T-two' })).body;
    await api.as(t.admin).post(`/v2/contacts/${ids[8]}/tags`).send({ tagId: t1.id });
    await api.as(t.admin).post(`/v2/contacts/${ids[8]}/tags`).send({ tagId: t2.id });
    await api.as(t.admin).post(`/v2/contacts/${ids[9]}/tags`).send({ tagId: t1.id });
    const any = await api.as(t.admin).get(`/v2/contacts?tagIds=${t1.id},${t2.id}&tagMode=any`);
    expect(names(any.body.data).sort()).toEqual(['F8', 'F9']);
    const all = await api.as(t.admin).get(`/v2/contacts?tagIds=${t1.id},${t2.id}&tagMode=all`);
    expect(names(all.body.data)).toEqual(['F8']);
    // a tag that does not exist makes "all" impossible
    const ghost = await api
      .as(t.admin)
      .get(`/v2/contacts?tagIds=${t1.id},00000000-0000-4000-8000-000000000000&tagMode=all`);
    expect(ghost.body.data).toEqual([]);
  });
});

describe('stat tiles (WD-CON-006)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('stat');
  });

  it('WD-CON-006 #1: 10 contacts with 2 unsubscribed read Total 10, Subscribed 8, Unsubscribed 2 whatever the search', async () => {
    await api.seedContacts(
      t,
      Array.from({ length: 10 }, (_, i) => ({
        name: `S${i}`,
        phone: `+9160000000${String(i).padStart(2, '0')}`,
        isUnsubscribed: i < 2,
      })),
    );
    const stats = await api.as(t.admin).get('/v2/contacts/stats');
    expect(stats.status, JSON.stringify(stats.body)).toBe(200);
    expect(stats.body).toMatchObject({
      total: 10,
      subscribed: 8,
      unsubscribed: 2,
      groups: 0,
      noGroup: 10,
      grouped: 0,
      imported: 0,
    });
    // the tiles take no filter at all: a query string changes nothing
    const filtered = await api.as(t.admin).get('/v2/contacts/stats?q=S1');
    expect(filtered.body.total).toBe(10);
  });

  it('WD-CON-006: the consent filter lists the opted-out contacts', async () => {
    const out = await api.as(t.admin).get('/v2/contacts?unsubscribed=true&includeTotal=true');
    expect(out.body.meta.total).toBe(2);
    const subscribed = await api
      .as(t.admin)
      .get('/v2/contacts?unsubscribed=false&includeTotal=true');
    expect(subscribed.body.meta.total).toBe(8);
  });

  it('WD-CON-006 #2 (fixed): a deleted group leaves its contacts counted as "no group", and never as grouped', async () => {
    const [c1, c2, c3] = (await api.as(t.admin).get('/v2/contacts?limit=3')).body.data.map(
      (r: { id: string }) => r.id,
    );
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Short lived' })).body;
    await api
      .as(t.admin)
      .post('/v2/contacts/bulk/group')
      .send({ ids: [c1, c2, c3], groupId: g.id, action: 'add' });
    const during = await api.as(t.admin).get('/v2/contacts/stats');
    expect(during.body).toMatchObject({ groups: 1, grouped: 3, noGroup: 7 });
    await api.as(t.admin).delete(`/v2/contact-groups/${g.id}`);
    const after = await api.as(t.admin).get('/v2/contacts/stats');
    expect(after.body).toMatchObject({ groups: 0, grouped: 0, noGroup: 10 });
  });

  it('WD-CON-006 #3 (fixed): "Imported" is a real filter on a real column, matching contacts a CSV import made', async () => {
    const before = await api.as(t.admin).get('/v2/contacts?imported=true&includeTotal=true');
    expect(before.body.meta.total).toBe(0);
    const csv = 'name,mobile,country_code\nImp One,9812300001,+91\nImp Two,9812300002,+91\n';
    const imp = await api
      .as(t.admin)
      .post('/v2/contacts/import')
      .attach('file', Buffer.from(csv), 'people.csv');
    expect(imp.status, JSON.stringify(imp.body)).toBe(200);
    const after = await api.as(t.admin).get('/v2/contacts?imported=true&includeTotal=true');
    expect(names(after.body.data).sort()).toEqual(['Imp One', 'Imp Two']);
    expect((await api.as(t.admin).get('/v2/contacts/stats')).body.imported).toBe(2);
    expect(
      (await api.as(t.admin).get('/v2/contacts?imported=false&includeTotal=true')).body.meta.total,
    ).toBe(10);
    // "false" in a query string is false, not true
    expect((await api.as(t.admin).get('/v2/contacts?imported=false&q=Imp')).body.data).toEqual([]);
  });

  it('the filter by source finds them too', async () => {
    const res = await api.as(t.admin).get('/v2/contacts?source=import');
    expect(res.body.data).toHaveLength(2);
  });
});

describe('record scope applies to every read the new filters touch', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('scp');
  });

  it('a member granted contacts.read at "own" sees only their contacts in the list, the count and the tiles', async () => {
    const m = await api.member(t, 'own', [['record.contacts.read', 'own']]);
    await api.seedContacts(t, [
      { name: 'Mine 1', phone: '+915000000001', ownerId: m.userId },
      { name: 'Mine 2', phone: '+915000000002', ownerId: m.userId },
      { name: 'Theirs', phone: '+915000000003', ownerId: t.adminUserId },
      { name: 'Unowned', phone: '+915000000004' },
    ]);
    const list = await api.as(m.token).get('/v2/contacts?includeTotal=true');
    expect(names(list.body.data).sort()).toEqual(['Mine 1', 'Mine 2']);
    expect(list.body.meta.total).toBe(2);
    expect((await api.as(m.token).get('/v2/contacts/stats')).body.total).toBe(2);
    expect((await api.as(t.admin).get('/v2/contacts/stats')).body.total).toBe(4);
  });
});

describe('source and status as real columns (WD-CON-015)', () => {
  it('WD-CON-015 #1 and #2: source is set on create, filterable, shown, and cleared with null', async () => {
    const t = await api.signup('src');
    const created = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'Web lead', phone: '+919990000001', status: 'vip', source: 'Website form' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ source: 'Website form', status: 'vip' });
    await api.as(t.admin).post('/v2/contacts').send({ name: 'Other lead', phone: '+919990000002' });

    expect(
      names((await api.as(t.admin).get('/v2/contacts?source=Website form')).body.data),
    ).toEqual(['Web lead']);
    expect(names((await api.as(t.admin).get('/v2/contacts?status=vip')).body.data)).toEqual([
      'Web lead',
    ]);
    const cleared = await api
      .as(t.admin)
      .patch(`/v2/contacts/${created.body.id}`)
      .send({ source: null, rowVersion: created.body.rowVersion });
    expect(cleared.body.source).toBeNull();
    expect((await api.as(t.admin).get('/v2/contacts?source=Website form')).body.data).toEqual([]);
  });

  it('source is capped at 128 characters', async () => {
    const t = await api.signup('srcl');
    const res = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'x', phone: '+919990000003', source: 's'.repeat(129) });
    expect(res.status).toBe(422);
  });
});

describe('identity keys follow an edit (WD-CON-013)', () => {
  it('releases the old phone and email on an edit or a clear, so a new contact with them is a new contact', async () => {
    const t = await api.signup('idk');
    const made = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'Mover', phone: '+919990001001', email: 'mover@example.com' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);

    const moved = await api
      .as(t.admin)
      .patch(`/v2/contacts/${made.body.id}`)
      .send({ phone: '+919990001002', email: null, rowVersion: made.body.rowVersion });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);

    // Before the fix both of these answered with "Mover" (the stale identity), swallowing the new contact.
    const byOldPhone = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'Newcomer', phone: '+919990001001' });
    expect(byOldPhone.status, JSON.stringify(byOldPhone.body)).toBe(201);
    expect(byOldPhone.body.id).not.toBe(made.body.id);
    expect(byOldPhone.body.name).toBe('Newcomer');

    const byOldEmail = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'Mail owner', phone: '+919990001003', email: 'mover@example.com' });
    expect(byOldEmail.body.id).not.toBe(made.body.id);
    expect(byOldEmail.body.name).toBe('Mail owner');

    // The number the contact holds now is still its identity: creating it again returns the same contact.
    const again = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'Mover again', phone: '+919990001002' });
    expect(again.body.id).toBe(made.body.id);
  });
});

describe('marketing opt-out write path (WD-CON-017)', () => {
  it('create and edit set and clear the opt-out, and the stats and the consent filter follow', async () => {
    const t = await api.signup('optout');
    const made = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'Opted out', phone: '+919990002001', isUnsubscribed: true });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.isUnsubscribed).toBe(true);
    await api.as(t.admin).post('/v2/contacts').send({ name: 'Subscribed', phone: '+919990002002' });

    const stats = await api.as(t.admin).get('/v2/contacts/stats');
    expect(stats.body).toMatchObject({ total: 2, unsubscribed: 1, subscribed: 1 });
    const only = await api.as(t.admin).get('/v2/contacts?unsubscribed=true');
    expect(names(only.body.data)).toEqual(['Opted out']);

    const back = await api
      .as(t.admin)
      .patch(`/v2/contacts/${made.body.id}`)
      .send({ isUnsubscribed: false, rowVersion: made.body.rowVersion });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.isUnsubscribed).toBe(false);
    expect((await api.as(t.admin).get('/v2/contacts?unsubscribed=true')).body.data).toEqual([]);

    // Turning it on again stamps the time, and sending the same value is not a change.
    const again = await api
      .as(t.admin)
      .patch(`/v2/contacts/${made.body.id}`)
      .send({ isUnsubscribed: true, rowVersion: back.body.rowVersion });
    expect(again.body.isUnsubscribed).toBe(true);
    const same = await api
      .as(t.admin)
      .patch(`/v2/contacts/${made.body.id}`)
      .send({ isUnsubscribed: true, rowVersion: again.body.rowVersion });
    expect(same.status).toBe(200);
    expect(same.body.isUnsubscribed).toBe(true);
  });
});

describe('sorting by a column', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('srt');
    await api.seedContacts(t, [
      { name: 'bravo', email: 'b@x.test', data: { language: 'fr', size: 'M' } },
      { name: 'Alpha', email: 'C@x.test', data: { language: 'en', size: 'S' } },
      { name: 'charlie', email: null, data: { language: 'de' } },
      { name: 'Delta', email: '', data: { size: 'L' } },
      { name: 'echo', email: 'a@x.test' },
    ]);
  });

  const all = async (qs: string, limit = 2) => {
    const out: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const res = await api
        .as(t.admin)
        .get(`/v2/contacts?limit=${limit}&${qs}${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      out.push(...names(res.body.data).map((n) => n ?? ''));
      cursor = res.body.page.nextCursor;
      if (!cursor) break;
    }
    return out;
  };

  it('sorts names case-insensitively, both ways, across pages', async () => {
    expect(await all('sort=name&order=asc')).toEqual([
      'Alpha',
      'bravo',
      'charlie',
      'Delta',
      'echo',
    ]);
    expect(await all('sort=name&order=desc')).toEqual([
      'echo',
      'Delta',
      'charlie',
      'bravo',
      'Alpha',
    ]);
  });

  it('puts contacts with no value last, in either direction', async () => {
    const asc = await all('sort=email&order=asc');
    expect(asc.slice(0, 3)).toEqual(['echo', 'bravo', 'Alpha']);
    expect(asc.slice(3).sort()).toEqual(['Delta', 'charlie']);
    const desc = await all('sort=email&order=desc');
    expect(desc.slice(0, 3)).toEqual(['Alpha', 'bravo', 'echo']);
    expect(desc.slice(3).sort()).toEqual(['Delta', 'charlie']);
  });

  it('sorts by a custom field and by a custom attribute key', async () => {
    expect((await all('sort=language&order=asc')).slice(0, 3)).toEqual([
      'charlie',
      'Alpha',
      'bravo',
    ]);
    expect((await all('sort=attr:size&order=asc')).slice(0, 3)).toEqual([
      'Delta',
      'bravo',
      'Alpha',
    ]);
  });

  it('rejects an unknown column and a forged cursor', async () => {
    expect((await api.as(t.admin).get('/v2/contacts?sort=password')).status).toBe(422);
    expect((await api.as(t.admin).get('/v2/contacts?sort=name&cursor=abc')).status).toBe(400);
  });
});
