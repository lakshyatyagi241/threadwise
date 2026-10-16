import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from './support';

/**
 * Bulk actions end to end: TW-CON-019..024. The point of the whole block is the fix for
 * Reference's gap: "select all N matching this filter" must work for EVERY action, not only the
 * two group ones.
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

const phone = (i: number) => `+9190${String(10_000_000 + i)}`;
const count = async (t: Tenant, where = 'true') =>
  Number(
    (
      await h.owner.query(
        `SELECT count(*)::int AS n FROM contacts WHERE org_id = $1 AND ${where}`,
        [t.orgId],
      )
    ).rows[0].n,
  );

describe('select all matching works for every action (TW-CON-019)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('sel');
  });

  it('TW-CON-019 #2: "all matching" + Add to group processes every matching contact, not the visible page', async () => {
    await api.seedContacts(
      t,
      Array.from({ length: 40 }, (_, i) => ({ name: `Match ${i}`, phone: phone(i) })),
    );
    await api.seedContacts(
      t,
      Array.from({ length: 5 }, (_, i) => ({ name: `Other ${i}`, phone: phone(100 + i) })),
    );
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Matching' })).body;
    const res = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/group')
      .send({ filter: { q: 'Match' }, groupId: g.id, action: 'add' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ matched: 40, changed: 40, failedCount: 0, succeeded: [] });
    expect((await api.as(t.admin).get(`/v2/contact-groups/${g.id}`)).body.memberCount).toBe(40);
  });

  it('TW-CON-019 #1: the filter is the one the list uses, so the count the screen showed is the count processed', async () => {
    const shown = await api.as(t.admin).get('/v2/contacts?q=Match&includeTotal=true&limit=12');
    expect(shown.body.data).toHaveLength(12);
    expect(shown.body.meta.total).toBe(40);
  });

  it('un-ticking rows after "select all matching" excludes them', async () => {
    const page = await api.as(t.admin).get('/v2/contacts?q=Match&limit=2');
    const excluded = page.body.data.map((r: { id: string }) => r.id);
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Minus two' })).body;
    const res = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/group')
      .send({ filter: { q: 'Match' }, excludeIds: excluded, groupId: g.id, action: 'add' });
    expect(res.body).toMatchObject({ matched: 38, changed: 38 });
  });

  it('TW-CON-019 #3 (fixed): "all matching" + Tag tags every match; Untag removes from every match', async () => {
    const tag = (await api.as(t.admin).post('/v2/tags').send({ name: 'All matching' })).body;
    const add = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/tag')
      .send({ filter: { q: 'Match' }, tagId: tag.id, action: 'add' });
    expect(add.body).toMatchObject({ matched: 40, changed: 40 });
    expect(
      await count(t, `id IN (SELECT contact_id FROM contact_tags WHERE org_id = ${t.orgId})`),
    ).toBe(40);
    const remove = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/tag')
      .send({ filter: { q: 'Match' }, tagId: tag.id, action: 'remove' });
    expect(remove.body).toMatchObject({ matched: 40, changed: 40 });
    expect(
      await count(t, `id IN (SELECT contact_id FROM contact_tags WHERE org_id = ${t.orgId})`),
    ).toBe(0);
  });

  it('TW-CON-019 #3 (fixed): "all matching" + Delete deletes all 40, not the 12 on the page', async () => {
    const res = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/delete')
      .send({ filter: { q: 'Match' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ matched: 40, changed: 40, failedCount: 0 });
    expect(await count(t, `name LIKE 'Match %'`)).toBe(0);
    expect(await count(t, `name LIKE 'Other %'`)).toBe(5);
  });

  it('a filter naming a group or tag that does not exist matches nothing, never everything', async () => {
    const res = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/delete')
      .send({ filter: { groupId: randomUUID() } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ matched: 0, changed: 0 });
    expect(await count(t)).toBe(5);
  });

  it('a request names ids or a filter, not both and not neither', async () => {
    expect((await api.as(t.admin).post('/v2/contacts/bulk/delete').send({})).status).toBe(422);
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/contacts/bulk/delete')
          .send({ ids: [randomUUID()], filter: {} })
      ).status,
    ).toBe(422);
  });
});

describe('bulk delete (TW-CON-020)', () => {
  let t: Tenant;
  let other: Tenant;
  beforeAll(async () => {
    t = await api.signup('bdl');
    other = await api.signup('bdlo');
  });

  it('TW-CON-020 #1: 3 ticked contacts are deleted, with an audit row and an event for each', async () => {
    const ids = await api.seedContacts(
      t,
      [1, 2, 3].map((i) => ({ name: `D${i}`, phone: phone(200 + i) })),
    );
    const auditBefore = await api.auditCount(t.orgId, 'contacts', 'delete');
    const evBefore = (await api.events(t.orgId, 'contact.deleted')).length;
    const res = await api.as(t.admin).post('/v2/contacts/bulk/delete').send({ ids });
    expect(res.body).toMatchObject({ matched: 3, changed: 3, failedCount: 0 });
    expect(new Set(res.body.succeeded)).toEqual(new Set(ids));
    expect(await api.auditCount(t.orgId, 'contacts', 'delete')).toBe(auditBefore + 3);
    expect((await api.events(t.orgId, 'contact.deleted')).length).toBe(evBefore + 3);
    expect(await count(t, `name LIKE 'D_'`)).toBe(0);
  });

  it('TW-CON-020 #2 (fixed): one id already deleted elsewhere is listed as failed; the others are still deleted', async () => {
    const [a, b] = await api.seedContacts(t, [
      { name: 'Stale A', phone: phone(210) },
      { name: 'Stale B', phone: phone(211) },
    ]);
    const gone = randomUUID();
    const res = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/delete')
      .send({ ids: [a, gone, b] });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(2);
    expect(res.body.failed).toEqual([
      { id: gone, code: 'NOT_FOUND', message: 'Contact not found' },
    ]);
    expect(res.body.failedCount).toBe(1);
    // the answer echoes what was deleted, not what was asked for
    expect(new Set(res.body.succeeded)).toEqual(new Set([a, b]));
  });

  it('TW-CON-020 #3: ids from another workspace are not touched, and are reported as not found', async () => {
    const [mine] = await api.seedContacts(t, [{ name: 'Mine', phone: phone(220) }]);
    const [theirs] = await api.seedContacts(other, [{ name: 'Theirs', phone: phone(221) }]);
    const res = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/delete')
      .send({ ids: [mine, theirs] });
    expect(res.body).toMatchObject({ changed: 1, failedCount: 1 });
    expect(res.body.failed[0].id).toBe(theirs);
    expect(await count(other, `name = 'Theirs'`)).toBe(1);
  });

  it('what pointed at a deleted contact is detached by the foreign keys (no dangling ids)', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Linked', phone: phone(230) }]);
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Link group' })).body;
    await api
      .as(t.admin)
      .put(`/v2/contacts/${c}/groups`)
      .send({ groupIds: [g.id] });
    const tag = (await api.as(t.admin).post('/v2/tags').send({ name: 'Link tag' })).body;
    await api.as(t.admin).post(`/v2/contacts/${c}/tags`).send({ tagId: tag.id });
    await api
      .as(t.admin)
      .post('/v2/contacts/bulk/delete')
      .send({ ids: [c] });
    expect((await api.as(t.admin).get(`/v2/contact-groups/${g.id}`)).body.memberCount).toBe(0);
    const tags = await h.owner.query(
      `SELECT count(*)::int AS n FROM contact_tags WHERE org_id = $1`,
      [t.orgId],
    );
    expect(tags.rows[0].n).toBe(0);
  });

  it('deleting needs the delete capability, and the caller\'s record scope applies: "own" cannot delete another owner\'s contact', async () => {
    const m = await api.member(t, 'owndel', [
      ['record.contacts.delete', 'own'],
      ['record.contacts.read', 'own'],
    ]);
    const [mine, theirs] = await api.seedContacts(t, [
      { name: 'Own one', phone: phone(240), ownerId: m.userId },
      { name: 'Not own', phone: phone(241), ownerId: t.adminUserId },
    ]);
    const res = await api
      .as(m.token)
      .post('/v2/contacts/bulk/delete')
      .send({ ids: [mine, theirs] });
    expect(res.body).toMatchObject({ changed: 1, failedCount: 1 });
    expect(res.body.failed[0].id).toBe(theirs);
    const reader = await api.member(t, 'rdonly', [['record.contacts.read']]);
    expect(
      (
        await api
          .as(reader.token)
          .post('/v2/contacts/bulk/delete')
          .send({ ids: [theirs] })
      ).status,
    ).toBe(403);
  });
});

describe('export (TW-CON-021, 022)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('exp');
  });

  const csv = async (body: Record<string, unknown>, token = t.admin) => {
    const res = await api
      .as(token)
      .post('/v2/contacts/export')
      .send(body)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
      });
    return { res, text: res.body as unknown as string };
  };

  it('TW-CON-021 #1: 2 ticked contacts download a CSV with the header and 2 rows', async () => {
    const [a, b] = await api.seedContacts(t, [
      { name: 'Aarav Sharma', phone: '+919812345678', email: 'aarav@example.com' },
      { name: 'Priya Patel', phone: '+919898765432', email: 'priya@example.com' },
    ]);
    const { res, text } = await csv({ ids: [a, b], bom: false });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain('contacts-export.csv');
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      'name,first_name,last_name,phone,country_code,email,groups,tags,language,title,address,memo,status,source,unsubscribed,created_at,owner_email,timezone',
    );
    // newest first
    expect(lines[1]!.startsWith('Priya Patel,')).toBe(true);
  });

  it('TW-CON-021 #2: a name like "=cmd" is exported as "\'=cmd"; an E.164 number keeps its plus (Reference wrote "\'+91...")', async () => {
    const [c] = await api.seedContacts(t, [{ name: '=cmd', phone: '+919812300009' }]);
    const { text } = await csv({ ids: [c], bom: false });
    const row = text.trimEnd().split('\n')[1]!;
    expect(row.startsWith("'=cmd,,,+919812300009,")).toBe(true);
  });

  it('TW-CON-021 #3: groups are exported by name, tags too, joined with a comma and a space', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Grouped', phone: '+919812300010' }]);
    const g1 = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'VIP' })).body;
    const g2 = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'New leads' })).body;
    await api
      .as(t.admin)
      .put(`/v2/contacts/${c}/groups`)
      .send({ groupIds: [g1.id, g2.id] });
    const tag = (await api.as(t.admin).post('/v2/tags').send({ name: 'Hot' })).body;
    await api.as(t.admin).post(`/v2/contacts/${c}/tags`).send({ tagId: tag.id });
    const { text } = await csv({ ids: [c], bom: false });
    expect(text).toContain('"New leads, VIP",Hot');
  });

  it('TW-CON-021: a UTF-8 BOM leads the file unless bom is false (spreadsheets mis-decode non-ASCII without it)', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Zoë Müller', phone: '+919812300011' }]);
    const withBom = await csv({ ids: [c] });
    expect(withBom.text.charCodeAt(0)).toBe(0xfeff);
    expect(withBom.text).toContain('Zoë Müller');
    expect((await csv({ ids: [c], bom: false })).text.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('TW-CON-022 #2: "export all" with a group filter exports only that group\'s members', async () => {
    const ids = await api.seedContacts(
      t,
      Array.from({ length: 5 }, (_, i) => ({ name: `GE${i}`, phone: phone(300 + i) })),
    );
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Export group' }))
      .body;
    await api
      .as(t.admin)
      .post('/v2/contacts/bulk/group')
      .send({ ids: ids.slice(0, 3), groupId: g.id, action: 'add' });
    const { text } = await csv({ filter: { groupId: g.id }, bom: false });
    expect(text.trimEnd().split('\n')).toHaveLength(4);
  });

  it('TW-CON-022 #3: a search with no result downloads a header-only file', async () => {
    const { res, text } = await csv({ filter: { q: 'no-such-contact-anywhere' }, bom: false });
    expect(res.status).toBe(200);
    expect(text.trimEnd().split('\n')).toHaveLength(1);
  });

  it('TW-CON-022 #1: 1,800 contacts and no filter download all 1,800 rows (batched, newest first)', async () => {
    const t2 = await api.signup('expbig');
    await h.owner.query(
      `INSERT INTO contacts (org_id, name, phone, created_at)
       SELECT $1, 'Bulk ' || g, '+9170' || (20000000 + g), now() - (g || ' seconds')::interval
       FROM generate_series(1, 1800) g`,
      [t2.orgId],
    );
    const { res, text } = await csv({ filter: {}, bom: false }, t2.admin);
    expect(res.status).toBe(200);
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(1801);
    expect(lines[1]!.startsWith('Bulk 1,')).toBe(true);
    expect(new Set(lines.slice(1).map((l) => l.split(',')[0])).size).toBe(1800);
  }, 60_000);

  it('records an export in the audit trail (who pulled how many contacts)', async () => {
    const before = await api.auditCount(t.orgId, 'contacts', 'export');
    await csv({ filter: {} });
    expect(await api.auditCount(t.orgId, 'contacts', 'export')).toBe(before + 1);
  });

  it('lists past exports, newest first, with who, when, how many and how selected', async () => {
    const ids = await api.seedContacts(t, [
      { name: 'Hist One', phone: phone(401) },
      { name: 'Hist Two', phone: phone(402) },
    ]);
    await csv({ ids, bom: false });
    const second = await csv({ filter: {}, bom: false });
    const res = await api.as(t.admin).get('/v2/contacts/exports?limit=2');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({ selection: 'filter' });
    expect(res.body.data[1]).toMatchObject({ selection: 'ids', rows: 2 });
    expect(typeof res.body.data[0].by).toBe('string');
    expect(new Date(res.body.data[0].at).getTime()).toBeGreaterThanOrEqual(
      new Date(res.body.data[1].at).getTime(),
    );
    // the file of an export is kept and can be downloaded again, byte for byte
    const fileId = res.body.data[0].fileId as string;
    expect(fileId).toMatch(/^[0-9a-f-]{36}$/);
    const again = await api
      .as(t.admin)
      .get(`/v2/contacts/exports/${fileId}/download`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
      });
    expect(again.status).toBe(200);
    expect(again.body as unknown as string).toBe(second.text);
    // another workspace sees none of them (and cannot fetch the file); no export capability, no history
    const other = await api.signup('exp-hist-b');
    expect((await api.as(other.admin).get(`/v2/contacts/exports/${fileId}/download`)).status).toBe(
      404,
    );
    expect((await api.as(other.admin).get('/v2/contacts/exports')).body.data).toEqual([]);
    const reader = await api.member(t, 'nohist', [['record.contacts.read']]);
    expect((await api.as(reader.token).get('/v2/contacts/exports')).status).toBe(403);
  });

  it("needs the export capability, and only exports what the caller's record scope allows", async () => {
    const reader = await api.member(t, 'noexp', [['record.contacts.read']]);
    expect(
      (await api.as(reader.token).post('/v2/contacts/export').send({ filter: {} })).status,
    ).toBe(403);
    const own = await api.member(t, 'ownexp', [['record.contacts.export', 'own']]);
    await api.seedContacts(t, [
      { name: 'Owned by member', phone: phone(390), ownerId: own.userId },
    ]);
    const { text } = await csv({ filter: {}, bom: false }, own.token);
    expect(text.trimEnd().split('\n')).toHaveLength(2);
    expect(text).toContain('Owned by member');
  });

  it('exports the active attributes as attr:<key> columns', async () => {
    const t3 = await api.signup('expattr');
    await api.as(t3.admin).post('/v2/attributes').send({ name: 'Order ID', key: 'order_id' });
    const [c] = await api.seedContacts(t3, [
      { name: 'Has attr', phone: '+919812300020', data: { order_id: 'A12' } },
    ]);
    const { text } = await csv({ ids: [c], bom: false }, t3.admin);
    const [head, row] = text.trimEnd().split('\n');
    expect(head!.endsWith(',attr:order_id')).toBe(true);
    expect(row!.endsWith(',A12')).toBe(true);
  });
});

describe('bulk add and remove a group (TW-CON-023)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('bgr');
  });

  it('TW-CON-023 #1: 5 contacts, 2 already in G; adding G changes 3', async () => {
    const ids = await api.seedContacts(
      t,
      Array.from({ length: 5 }, (_, i) => ({ name: `BG${i}`, phone: phone(400 + i) })),
    );
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'G' })).body;
    await api
      .as(t.admin)
      .post('/v2/contacts/bulk/group')
      .send({ ids: ids.slice(0, 2), groupId: g.id, action: 'add' });
    const evBefore = (await api.events(t.orgId, 'contact.group_added')).length;
    const res = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/group')
      .send({ ids, groupId: g.id, action: 'add' });
    expect(res.body).toMatchObject({ matched: 5, changed: 3, failedCount: 0 });
    // one event per contact that really joined: flows trigger on these, not on the 2 who were in already
    expect((await api.events(t.orgId, 'contact.group_added')).length).toBe(evBefore + 3);
    // and once more is a no-op
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/contacts/bulk/group')
          .send({ ids, groupId: g.id, action: 'add' })
      ).body.changed,
    ).toBe(0);
  });

  it('removing skips contacts that are not in the group, and fires an event for each that left', async () => {
    const ids = await api.seedContacts(
      t,
      Array.from({ length: 4 }, (_, i) => ({ name: `RG${i}`, phone: phone(410 + i) })),
    );
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'R' })).body;
    await api
      .as(t.admin)
      .post('/v2/contacts/bulk/group')
      .send({ ids: ids.slice(0, 2), groupId: g.id, action: 'add' });
    const evBefore = (await api.events(t.orgId, 'contact.group_removed')).length;
    const res = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/group')
      .send({ ids, groupId: g.id, action: 'remove' });
    expect(res.body).toMatchObject({ matched: 4, changed: 2 });
    expect((await api.events(t.orgId, 'contact.group_removed')).length).toBe(evBefore + 2);
  });

  it('TW-CON-023 #2: with a search filter every match is processed, beyond any page', async () => {
    await api.seedContacts(
      t,
      Array.from({ length: 30 }, (_, i) => ({
        name: `Corp ${i}`,
        phone: phone(500 + i),
        email: `p${i}@acme.test`,
      })),
    );
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Acme' })).body;
    const res = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/group')
      .send({ filter: { q: 'acme' }, groupId: g.id, action: 'add' });
    expect(res.body).toMatchObject({ matched: 30, changed: 30 });
  });

  it('TW-CON-023 #3: a group of another workspace is a 404', async () => {
    const other = await api.signup('bgro');
    const theirs = (await api.as(other.admin).post('/v2/contact-groups').send({ name: 'Theirs' }))
      .body;
    const res = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/group')
      .send({ filter: {}, groupId: theirs.id, action: 'add' });
    expect(res.status).toBe(404);
  });

  it('one audit row and one aggregated event describe the whole action (not one notification per contact)', async () => {
    const ids = await api.seedContacts(
      t,
      Array.from({ length: 3 }, (_, i) => ({ name: `AU${i}`, phone: phone(600 + i) })),
    );
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Aggregated' })).body;
    const before = await api.auditCount(t.orgId, 'contact_groups', 'update');
    await api
      .as(t.admin)
      .post('/v2/contacts/bulk/group')
      .send({ ids, groupId: g.id, action: 'add' });
    expect(await api.auditCount(t.orgId, 'contact_groups', 'update')).toBe(before + 1);
    const ev = (await api.events(t.orgId, 'contact_group.members_changed')).pop();
    expect(ev).toMatchObject({ uuid: g.id, action: 'add', changed: 3, selection: 'ids' });
  });

  it('needs the update capability on contacts; "own" scope only reaches the caller\'s contacts', async () => {
    const [mine, theirs] = [
      ...(await api.seedContacts(t, [
        { name: 'Scoped mine', phone: phone(620) },
        { name: 'Scoped theirs', phone: phone(621) },
      ])),
    ];
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Scoped' })).body;
    const m = await api.member(t, 'scoped', [['record.contacts.update', 'own']]);
    await h.owner.query(`UPDATE contacts SET owner_id = $1 WHERE uuid = $2`, [m.userId, mine]);
    const res = await api
      .as(m.token)
      .post('/v2/contacts/bulk/group')
      .send({ ids: [mine, theirs], groupId: g.id, action: 'add' });
    expect(res.body).toMatchObject({ matched: 1, changed: 1, failedCount: 1 });
    const reader = await api.member(t, 'rdr', [['record.contacts.read']]);
    expect(
      (
        await api
          .as(reader.token)
          .post('/v2/contacts/bulk/group')
          .send({ ids: [mine], groupId: g.id, action: 'add' })
      ).status,
    ).toBe(403);
  });
});

describe('bulk tag and untag (TW-CON-024)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('btg');
  });

  it('TW-CON-024 #1: 200 selected, 190 already tagged T; adding T changes 10', async () => {
    const ids = await api.seedContacts(
      t,
      Array.from({ length: 200 }, (_, i) => ({ name: `BT${i}`, phone: phone(1000 + i) })),
    );
    const tag = (await api.as(t.admin).post('/v2/tags').send({ name: 'T' })).body;
    await api
      .as(t.admin)
      .post('/v2/contacts/bulk/tag')
      .send({ ids: ids.slice(0, 190), tagId: tag.id, action: 'add' });
    const evBefore = (await api.events(t.orgId, 'contact.tag_added')).length;
    const res = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/tag')
      .send({ ids, tagId: tag.id, action: 'add' });
    expect(res.body).toMatchObject({ matched: 200, changed: 10 });
    expect((await api.events(t.orgId, 'contact.tag_added')).length).toBe(evBefore + 10);
  });

  it('TW-CON-024 #2: typing "VIP" when a tag "vip" exists reuses it (any case) and creates nothing', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Vippy', phone: phone(1300) }]);
    const existing = (await api.as(t.admin).post('/v2/tags').send({ name: 'vip' })).body;
    const before = await h.owner.query(`SELECT count(*)::int AS n FROM tags WHERE org_id = $1`, [
      t.orgId,
    ]);
    const res = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/tag')
      .send({ ids: [c], name: 'VIP', action: 'add' });
    expect(res.body.changed).toBe(1);
    const after = await h.owner.query(`SELECT count(*)::int AS n FROM tags WHERE org_id = $1`, [
      t.orgId,
    ]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const tags = await api.as(t.admin).get(`/v2/contacts/${c}/tags`);
    expect(tags.body.map((x: { id: string }) => x.id)).toEqual([existing.id]);
  });

  it('adding with a name nobody has creates the tag (with the audit row and event of a normal create)', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Hot lead', phone: phone(1301) }]);
    const evBefore = (await api.events(t.orgId, 'tag.created')).length;
    const res = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/tag')
      .send({ ids: [c], name: 'Hot Lead', action: 'add' });
    expect(res.body.changed).toBe(1);
    expect((await api.events(t.orgId, 'tag.created')).length).toBe(evBefore + 1);
    const list = await api.as(t.admin).get('/v2/tags?q=hot lead');
    expect(list.body.data).toHaveLength(1);
  });

  it('TW-CON-024 #3: removing with no tag, or a name that matches nothing, is 422 CON_TAG_REQUIRED and creates no tag', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Untag me', phone: phone(1302) }]);
    const before = await h.owner.query(`SELECT count(*)::int AS n FROM tags WHERE org_id = $1`, [
      t.orgId,
    ]);
    for (const body of [
      { ids: [c], action: 'remove' },
      { ids: [c], action: 'remove', name: 'never existed' },
    ]) {
      const res = await api.as(t.admin).post('/v2/contacts/bulk/tag').send(body);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('CON_TAG_REQUIRED');
    }
    const after = await h.owner.query(`SELECT count(*)::int AS n FROM tags WHERE org_id = $1`, [
      t.orgId,
    ]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('TW-CON-024 (fixed): creating a tag this way needs the tag-create permission, like POST /tags', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Perm', phone: phone(1303) }]);
    const m = await api.member(t, 'notagcreate', [
      ['record.contacts.update'],
      ['record.tags.read'],
    ]);
    const create = await api
      .as(m.token)
      .post('/v2/contacts/bulk/tag')
      .send({ ids: [c], name: 'Brand new', action: 'add' });
    expect(create.status).toBe(403);
    // attaching an EXISTING tag needs no create permission
    const tag = (await api.as(t.admin).post('/v2/tags').send({ name: 'Existing' })).body;
    const attach = await api
      .as(m.token)
      .post('/v2/contacts/bulk/tag')
      .send({ ids: [c], tagId: tag.id, action: 'add' });
    expect(attach.status).toBe(200);
  });

  it("TW-CON-024 (fixed): the plan's tag limit applies to a tag created from Contacts, to POST /tags and to attach-by-name", async () => {
    const t2 = await api.signup('tlim');
    const [c] = await api.seedContacts(t2, [{ name: 'Limited', phone: phone(1400) }]);
    await h.owner.query(
      `INSERT INTO org_plan_state (org_id, overrides) VALUES ($1, '{"limits":{"tags":2}}'::jsonb)
       ON CONFLICT (org_id) DO UPDATE SET overrides = '{"limits":{"tags":2}}'::jsonb`,
      [t2.orgId],
    );
    expect((await api.as(t2.admin).post('/v2/tags').send({ name: 'one' })).status).toBe(201);
    expect(
      (
        await api
          .as(t2.admin)
          .post('/v2/contacts/bulk/tag')
          .send({ ids: [c], name: 'two', action: 'add' })
      ).status,
    ).toBe(200);
    const third = await api
      .as(t2.admin)
      .post('/v2/contacts/bulk/tag')
      .send({ ids: [c], name: 'three', action: 'add' });
    expect(third.status).toBe(422);
    expect(third.body.code).toBe('PLAN_LIMIT_REACHED');
    expect((await api.as(t2.admin).post('/v2/tags').send({ name: 'four' })).body.code).toBe(
      'PLAN_LIMIT_REACHED',
    );
    expect(
      (await api.as(t2.admin).post(`/v2/contacts/${c}/tags`).send({ name: 'five' })).body.code,
    ).toBe('PLAN_LIMIT_REACHED');
    // using an existing tag is never limited
    const one = (await api.as(t2.admin).get('/v2/tags?q=one')).body.data[0];
    expect(
      (await api.as(t2.admin).post(`/v2/contacts/${c}/tags`).send({ tagId: one.id })).status,
    ).toBe(201);
  });
});
