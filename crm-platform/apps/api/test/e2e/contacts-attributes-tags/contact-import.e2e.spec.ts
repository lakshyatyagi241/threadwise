import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { ContactImportEngine } from '../../../src/modules/crm';
import { Api, startHarness, type Harness, type Tenant } from './support';

/**
 * CSV import end to end: preview, import (inline and as a queued job), mapping, knobs, duplicate
 * handling, the plan cap, the result and the rejects report. TW-CON-026..032.
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

const BOM = String.fromCharCode(0xfeff);
const SAMPLE =
  'name,last_name,country_code,mobile,email,group,language\n' +
  'Aarav Sharma,Sharma,91,9812345678,aarav@example.com,"VIP, New leads",en\n' +
  'Priya Patel,Patel,91,9898765432,priya@example.com,Customers,en\n';

const upload = (
  token: string,
  csv: string | Buffer,
  options?: Record<string, unknown>,
  name = 'people.csv',
  path = '/v2/contacts/import',
) => {
  let req = api
    .as(token)
    .post(path)
    .attach('file', Buffer.isBuffer(csv) ? csv : Buffer.from(csv), name);
  if (options) req = req.field('options', JSON.stringify(options));
  return req;
};

const countContacts = async (t: Tenant) =>
  Number(
    (await h.owner.query(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [t.orgId]))
      .rows[0].n,
  );
const groupNames = async (t: Tenant, contactName: string) =>
  (
    await h.owner.query(
      `SELECT g.name FROM contact_group_members m JOIN contact_groups g ON g.org_id = m.org_id AND g.id = m.group_id
         JOIN contacts c ON c.org_id = m.org_id AND c.id = m.contact_id
        WHERE m.org_id = $1 AND c.name = $2 ORDER BY g.name`,
      [t.orgId, contactName],
    )
  ).rows.map((r) => r.name as string);
const contactRow = async (t: Tenant, name: string) =>
  (
    await h.owner.query(`SELECT * FROM contacts WHERE org_id = $1 AND name = $2 ORDER BY id`, [
      t.orgId,
      name,
    ])
  ).rows;

describe('the sample file (TW-CON-032)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('smp');
  });

  it('TW-CON-032 #1: GET returns the 3-line CSV as an attachment', async () => {
    const res = await api.as(t.admin).get('/v2/contacts/import/sample');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain('contacts-sample.csv');
    expect(res.text.trimEnd().split('\n')).toHaveLength(3);
    expect(res.text.split('\n')[0]).toBe('name,last_name,country_code,mobile,email,group,language');
  });

  it('TW-CON-032 #3: a member without the import capability is refused', async () => {
    const m = await api.member(t, 'noimp', [['record.contacts.read']]);
    expect((await api.as(m.token).get('/v2/contacts/import/sample')).status).toBe(403);
  });
});

describe('importing (TW-CON-027)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('imp');
  });

  it('TW-CON-027 #1 and TW-CON-032 #2: the sample, imported unchanged, makes 2 contacts and the groups VIP, New leads, Customers', async () => {
    const res = await upload(t.admin, SAMPLE);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      status: 'completed',
      totalRows: 2,
      created: 2,
      updated: 0,
      invalid: 0,
      duplicatesInFile: 0,
      limitExceeded: 0,
      error: null,
    });
    expect(await countContacts(t)).toBe(2);
    expect(await groupNames(t, 'Aarav Sharma')).toEqual(['New leads', 'VIP']);
    expect(await groupNames(t, 'Priya Patel')).toEqual(['Customers']);
    const groups = (await api.as(t.admin).get('/v2/contact-groups')).body.data;
    expect(
      groups.map((g: { name: string; memberCount: number }) => [g.name, g.memberCount]).sort(),
    ).toEqual([
      ['Customers', 1],
      ['New leads', 1],
      ['VIP', 1],
    ]);
  });

  it('writes contacts in the one canonical shape: E.164 phone, name as given, the owner, the source and the job', async () => {
    const [c] = await contactRow(t, 'Aarav Sharma');
    expect(c).toMatchObject({
      phone: '+919812345678',
      normalized_phone: '+919812345678',
      email: 'aarav@example.com',
      first_name: null,
      last_name: 'Sharma',
      language: 'en',
      source: 'import',
      owner_id: t.adminUserId,
    });
    expect(c.import_job_id).not.toBeNull();
    // TW-CON-012 #4 (fixed): the full name is NOT also copied into first_name
    expect(c.name).toBe('Aarav Sharma');
    expect(c.display_id).toMatch(/^CON-\d+$/);
  });

  it('imports and the contact API agree on identity: creating the same number returns the imported contact', async () => {
    const list = await api.as(t.admin).get('/v2/contacts?q=Aarav');
    const created = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'Someone else', phone: '+919812345678' });
    expect(created.body.id).toBe(list.body.data[0].id);
  });

  it('TW-CON-027 #2: a row with no name and a row with no number are rejected, counted and reported with a reason', async () => {
    const t2 = await api.signup('impr');
    const csv = 'name,mobile\nGood One,9812300001\n,9812300002\nNo Number,\nGood Two,9812300003\n';
    const res = await upload(t2.admin, csv, { defaultCountryCode: '+91' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ totalRows: 4, created: 2, invalid: 2 });
    const rejects = await api.as(t2.admin).get(`/v2/contacts/import/jobs/${res.body.id}/rejects`);
    expect(rejects.status).toBe(200);
    expect(rejects.headers['content-type']).toMatch(/text\/csv/);
    const lines = rejects.text
      .replace(new RegExp(`^${BOM}`), '')
      .trimEnd()
      .split('\n');
    expect(lines[0]).toBe('row,reason,name,mobile');
    expect(lines.slice(1)).toEqual(['3,missing_name,,9812300002', '4,missing_phone,No Number,']);
  });

  it('TW-CON-027 #3: a header "Full Name, WhatsApp, Lists" is recognised and the groups are created and linked', async () => {
    const t3 = await api.signup('impl');
    const csv = 'Full Name,WhatsApp,Lists\nNeha Rao,+919812300010,"VIP, New leads"\n';
    const res = await upload(t3.admin, csv);
    expect(res.body).toMatchObject({ created: 1, invalid: 0 });
    expect(await groupNames(t3, 'Neha Rao')).toEqual(['New leads', 'VIP']);
  });

  it('TW-CON-027 #5 (fixed): a header with no phone column is a 422 that names what is missing, not "imported 0" with ok', async () => {
    const res = await upload(t.admin, 'Name,Colour\nA,red\n');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CON_IMPORT_FILE_INVALID');
    expect(res.body.errors).toEqual([{ path: 'mapping', message: 'phone' }]);
  });

  it('TW-CON-027: a mapping in the request overrides the header guess, so unusual headers can be imported', async () => {
    const t4 = await api.signup('impm');
    const csv = 'Col A,Col B\nKiran Das,+919812300020\n';
    const res = await upload(t4.admin, csv, { mapping: { name: 0, phone: 1 } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.created).toBe(1);
  });

  it('TW-CON-027: semicolon, tab and pipe delimited files import (Reference read commas only); a BOM is harmless', async () => {
    const t5 = await api.signup('impd');
    const res = await upload(
      t5.admin,
      `${BOM}name;mobile\nSemi One;+919812300030\nSemi Two;+919812300031\n`,
    );
    expect(res.body).toMatchObject({ created: 2, invalid: 0 });
    const tab = await upload(t5.admin, 'name\tmobile\nTab One\t+919812300032\n');
    expect(tab.body.created).toBe(1);
  });

  it('TW-CON-027: a quoted cell with a comma and a line break stays one cell', async () => {
    const t6 = await api.signup('impq');
    const res = await upload(
      t6.admin,
      'name,mobile,memo\n"Doe, Jane",+919812300040,"line1\nline2"\n',
    );
    expect(res.body.created).toBe(1);
    const [c] = await contactRow(t6, 'Doe, Jane');
    expect(c.message).toBe('line1\nline2');
  });

  it('TW-CON-027: rows are validated: a bad email or phone is rejected with its reason (Reference imported both)', async () => {
    const t7 = await api.signup('impv');
    const res = await upload(
      t7.admin,
      'name,mobile,email\nOk,+919812300050,ok@example.com\nBadMail,+919812300051,nope\nBadPhone,12,a@b.co\n',
    );
    expect(res.body).toMatchObject({ created: 1, invalid: 2 });
    const rejects = (await api.as(t7.admin).get(`/v2/contacts/import/jobs/${res.body.id}/rejects`))
      .text;
    expect(rejects).toContain('invalid_email');
    expect(rejects).toContain('invalid_phone');
  });

  it('TW-CON-027 #4: a 6 MB file imports (the limit is 20 MB and the same number everywhere)', async () => {
    const t8 = await api.signup('impbig');
    const memo = 'x'.repeat(1900);
    const rows = Array.from(
      { length: 3400 },
      (_, i) => `Big ${i},+9198${String(10_000_000 + i)},${memo}`,
    );
    const csv = `name,mobile,memo\n${rows.join('\n')}\n`;
    expect(Buffer.byteLength(csv)).toBeGreaterThan(6 * 1024 * 1024);
    const res = await upload(t8.admin, csv);
    expect([200, 202]).toContain(res.status);
    expect(res.body.totalRows).toBe(3400);
  }, 60_000);

  it('a file over 20 MB is refused with 413', async () => {
    const huge = Buffer.alloc(21 * 1024 * 1024, 'a');
    const res = await upload(t.admin, huge, undefined, 'huge.csv');
    expect(res.status).toBe(413);
  });

  it('not a text CSV (a binary, a wrong type, no file) is refused with a reason', async () => {
    const binary = await upload(
      t.admin,
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]),
      undefined,
      'people.csv',
    );
    expect(binary.status).toBe(422);
    expect(binary.body.code).toBe('CON_IMPORT_FILE_INVALID');
    const wrongType = await upload(t.admin, SAMPLE, undefined, 'people.pdf');
    expect(wrongType.status).toBe(422);
    const none = await api.as(t.admin).post('/v2/contacts/import');
    expect(none.status).toBe(422);
    expect(none.body.code).toBe('CON_IMPORT_FILE_INVALID');
  });

  it('writes the audit rows and the events of the import, and no per-contact events unless asked (TW-CON-053 #3)', async () => {
    const t9 = await api.signup('impev');
    const res = await upload(t9.admin, 'name,mobile\nEv One,+919812300060\nEv Two,+919812300061\n');
    expect(res.body.created).toBe(2);
    expect(await api.auditCount(t9.orgId, 'contact_import_jobs', 'insert')).toBe(1);
    expect(await api.auditCount(t9.orgId, 'contact_import_jobs', 'update')).toBe(1);
    expect(await api.events(t9.orgId, 'contact.import_started')).toHaveLength(1);
    const done = await api.events(t9.orgId, 'contact.import_completed');
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ created: 2, updated: 0, totalRows: 2 });
    expect(await api.events(t9.orgId, 'contact.created')).toHaveLength(0);

    const on = await upload(t9.admin, 'name,mobile\nEv Three,+919812300062\n', {
      triggerAutomations: true,
    });
    expect(on.body.created).toBe(1);
    expect(await api.events(t9.orgId, 'contact.created')).toHaveLength(1);
  });

  it('needs both the import and the create capability; new groups need the group-create capability', async () => {
    const t10 = await api.signup('impperm');
    const importOnly = await api.member(t10, 'importonly', [['record.contacts.import']]);
    expect((await upload(importOnly.token, SAMPLE)).status).toBe(403);
    const noGroups = await api.member(t10, 'nogroups', [
      ['record.contacts.import'],
      ['record.contacts.create'],
    ]);
    const denied = await upload(noGroups.token, SAMPLE);
    expect(denied.status).toBe(403);
    expect(await countContacts(t10)).toBe(0);
    // a file that creates no new group is fine
    const fine = await upload(noGroups.token, 'name,mobile\nNo Group,+919812300070\n');
    expect(fine.status).toBe(200);
  });

  it("a workspace cannot read another workspace's import", async () => {
    const a = await api.signup('impiso');
    const b = await api.signup('impisob');
    const job = (await upload(a.admin, 'name,mobile\nIso,+919812300080\n')).body;
    expect((await api.as(b.admin).get(`/v2/contacts/import/jobs/${job.id}`)).status).toBe(404);
    expect((await api.as(b.admin).get(`/v2/contacts/import/jobs/${job.id}/rejects`)).status).toBe(
      404,
    );
    expect((await api.as(b.admin).get('/v2/contacts/import/jobs')).body.data).toEqual([]);
    expect((await api.as(a.admin).get('/v2/contacts/import/jobs')).body.data).toHaveLength(1);
  });
});

describe('duplicates (TW-CON-030)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('dup');
  });

  it('TW-CON-030 #1: a contact "A" with number N; a CSV row N named "B" with an email updates it: updated 1, nothing new', async () => {
    await api.as(t.admin).post('/v2/contacts').send({ name: 'A', phone: '+919812300100' });
    const res = await upload(t.admin, 'name,mobile,email\nB,+919812300100,b@example.com\n');
    expect(res.body).toMatchObject({ created: 0, updated: 1, invalid: 0, duplicatesInFile: 0 });
    const rows = await contactRow(t, 'B');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: 'b@example.com', phone: '+919812300100' });
    expect(await countContacts(t)).toBe(1);
  });

  it('TW-CON-030 #2: the same number twice in one file makes one contact; the repeat is counted as a duplicate in the file', async () => {
    const res = await upload(
      t.admin,
      'name,mobile,email\nFirst,+919812300101,\nSecond,+919812300101,second@example.com\n',
    );
    expect(res.body).toMatchObject({ created: 1, updated: 0, duplicatesInFile: 1 });
    // the later row's cells win
    const rows = await h.owner.query(
      `SELECT name, email FROM contacts WHERE org_id = $1 AND phone = '+919812300101'`,
      [t.orgId],
    );
    expect(rows.rows).toEqual([{ name: 'Second', email: 'second@example.com' }]);
  });

  it('TW-CON-030 #3 (fixed): of two existing duplicates the OLDEST is updated (Reference updated the newest)', async () => {
    const [older, newer] = await api.seedContacts(t, [
      { name: 'Old dup', phone: '+919812300102', createdAt: '2026-01-01T00:00:00Z' },
      { name: 'New dup', phone: '+919812300102', createdAt: '2026-02-01T00:00:00Z' },
    ]);
    const res = await upload(t.admin, 'name,mobile\nRenamed,+919812300102\n');
    expect(res.body.updated).toBe(1);
    const a = await h.owner.query(`SELECT name FROM contacts WHERE uuid = $1`, [older]);
    const b = await h.owner.query(`SELECT name FROM contacts WHERE uuid = $1`, [newer]);
    expect(a.rows[0].name).toBe('Renamed');
    expect(b.rows[0].name).toBe('New dup');
  });

  it('TW-CON-013 / 025: the same number written three ways is ONE contact ("+91 98123 45678", "919812345678", "0091 9812345678")', async () => {
    const t2 = await api.signup('dupf');
    const csv = 'name,mobile\nSpaced,+91 98123 45600\nBare,919812345600\nZeros,0091 9812345600\n';
    const res = await upload(t2.admin, csv);
    expect(res.body).toMatchObject({ created: 1, duplicatesInFile: 2 });
    expect(await countContacts(t2)).toBe(1);
  });

  it('an existing contact stored the way Reference stored numbers ("+91 98123 45601") is matched by its digits', async () => {
    await api.seedContacts(t, [{ name: 'Legacy format', phone: '+91 98123 45601' }]);
    const res = await upload(t.admin, 'name,mobile\nLegacy renamed,919812345601\n');
    expect(res.body).toMatchObject({ created: 0, updated: 1 });
  });

  it('blank-phone rows are rejected, never matched with each other', async () => {
    const res = await upload(t.admin, 'name,mobile\nNo phone 1,\nNo phone 2,\n');
    expect(res.status).toBe(422);
  });
});

describe('the "apply to every contact" knobs (TW-CON-029)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('knb');
  });

  it('TW-CON-029 #1 and #2: status customer, source "Spring 2026", group G and a tag are stamped on every new row', async () => {
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'G' })).body;
    const tag = (await api.as(t.admin).post('/v2/tags').send({ name: 'Imported tag' })).body;
    const csv =
      'name,mobile,group\nK1,+919812300201,"Csv group"\nK2,+919812300202,\nK3,+919812300203,\n';
    const res = await upload(t.admin, csv, {
      status: 'customer',
      source: 'Spring 2026',
      groupId: g.id,
      tagIds: [tag.id],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.created).toBe(3);
    for (const n of ['K1', 'K2', 'K3']) {
      const [c] = await contactRow(t, n);
      expect(c).toMatchObject({ status: 'customer', source: 'Spring 2026' });
    }
    // the row's own group first, the knob's group added
    expect(await groupNames(t, 'K1')).toEqual(['Csv group', 'G']);
    expect(await groupNames(t, 'K2')).toEqual(['G']);
    // TW-CON-029 #3 (fixed): the tag really is applied
    const tagged = await api.as(t.admin).get(`/v2/contacts?tagIds=${tag.id}&includeTotal=true`);
    expect(tagged.body.meta.total).toBe(3);
  });

  it('TW-CON-029 #4 (fixed): a contact the file only UPDATES joins the group and gets the tag too, but keeps its status and source', async () => {
    await api.seedContacts(t, [{ name: 'Existing', phone: '+919812300210', source: 'manual' }]);
    await h.owner.query(
      `UPDATE contacts SET status = 'prospect' WHERE org_id = $1 AND name = 'Existing'`,
      [t.orgId],
    );
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Updated group' }))
      .body;
    const tag = (await api.as(t.admin).post('/v2/tags').send({ name: 'Updated tag' })).body;
    const res = await upload(t.admin, 'name,mobile\nExisting,+919812300210\n', {
      groupId: g.id,
      tagIds: [tag.id],
      status: 'vip',
      source: 'Autumn',
    });
    expect(res.body).toMatchObject({ created: 0, updated: 1 });
    expect(await groupNames(t, 'Existing')).toEqual(['Updated group']);
    const [c] = await contactRow(t, 'Existing');
    expect(c).toMatchObject({ status: 'prospect', source: 'manual' });
    expect((await api.as(t.admin).get(`/v2/contacts?tagIds=${tag.id}`)).body.data).toHaveLength(1);
  });

  it('TW-CON-029 #1 (fixed): a group or tag of another workspace is a 404, not a foreign reference', async () => {
    const other = await api.signup('knbo');
    const theirs = (await api.as(other.admin).post('/v2/contact-groups').send({ name: 'Theirs' }))
      .body;
    const res = await upload(t.admin, 'name,mobile\nF,+919812300220\n', { groupId: theirs.id });
    expect(res.status).toBe(404);
    const theirTag = (await api.as(other.admin).post('/v2/tags').send({ name: 'Their tag' })).body;
    expect(
      (await upload(t.admin, 'name,mobile\nF,+919812300220\n', { tagIds: [theirTag.id] })).status,
    ).toBe(404);
    expect(await contactRow(t, 'F')).toHaveLength(0);
  });

  it('the tags and status/source columns of the file itself are read', async () => {
    const t2 = await api.signup('knbc');
    const res = await upload(
      t2.admin,
      'name,mobile,tags,status,source,title,address,notes\nCols,+919812300230,"Alpha, Beta",lead,Web form,Dr,1 Main St,Called twice\n',
    );
    expect(res.body.created).toBe(1);
    const [c] = await contactRow(t2, 'Cols');
    expect(c).toMatchObject({
      status: 'lead',
      source: 'Web form',
      title: 'Dr',
      address: '1 Main St',
      message: 'Called twice',
    });
    expect(
      (await api.as(t2.admin).get('/v2/tags')).body.data
        .map((x: { name: string }) => x.name)
        .sort(),
    ).toEqual(['Alpha', 'Beta']);
  });

  it('a request mapping can switch a detected field off', async () => {
    const t3 = await api.signup('knbm');
    const res = await upload(t3.admin, 'name,mobile,email\nNoMail,+919812300240,a@b.co\n', {
      mapping: { email: null },
    });
    expect(res.body.created).toBe(1);
    expect((await contactRow(t3, 'NoMail'))[0].email).toBeNull();
  });
});

describe("the plan's contact cap (TW-CON-026)", () => {
  const capAt = (t: Tenant, n: number) =>
    h.owner.query(
      `INSERT INTO org_plan_state (org_id, overrides) VALUES ($1, $2::jsonb)
       ON CONFLICT (org_id) DO UPDATE SET overrides = $2::jsonb`,
      [t.orgId, JSON.stringify({ limits: { contacts: n } })],
    );

  it('TW-CON-026 #1: at the cap, adding a contact is 422 PLAN_LIMIT_REACHED and nothing is created', async () => {
    const t = await api.signup('cap1');
    await capAt(t, 3);
    for (const i of [1, 2, 3]) {
      expect(
        (
          await api
            .as(t.admin)
            .post('/v2/contacts')
            .send({ name: `C${i}`, phone: `+91981230030${i}` })
        ).status,
      ).toBe(201);
    }
    const res = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'C4', phone: '+919812300304' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PLAN_LIMIT_REACHED');
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        { path: 'limit', message: 'contacts' },
        { path: 'used', message: '3' },
        { path: 'limitValue', message: '3' },
      ]),
    );
    expect(await countContacts(t)).toBe(3);
    // the same number again is not a new contact: it is returned, not refused
    expect(
      (await api.as(t.admin).post('/v2/contacts').send({ name: 'again', phone: '+919812300301' }))
        .status,
    ).toBe(201);
  });

  it('TW-CON-026 #1 (plan check first): an import at the cap is refused before the file is even read', async () => {
    const t = await api.signup('cap2');
    await capAt(t, 1);
    await api.as(t.admin).post('/v2/contacts').send({ name: 'Only', phone: '+919812300310' });
    const res = await upload(t.admin, 'not a csv at all');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('TW-CON-026 #2 (fixed): one under the cap, importing 5 new rows creates 1 and reports the other 4 as stopped by the plan', async () => {
    const t = await api.signup('cap3');
    await capAt(t, 3);
    await api.seedContacts(t, [
      { name: 'Seed 1', phone: '+919812300320' },
      { name: 'Seed 2', phone: '+919812300321' },
    ]);
    const csv =
      'name,mobile\n' +
      Array.from({ length: 5 }, (_, i) => `New ${i},+91981230033${i}`).join('\n') +
      '\n';
    const res = await upload(t.admin, csv);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ created: 1, limitExceeded: 4, invalid: 0 });
    expect(await countContacts(t)).toBe(3);
    const rejects = (await api.as(t.admin).get(`/v2/contacts/import/jobs/${res.body.id}/rejects`))
      .text;
    expect(rejects.match(/plan_limit_reached/g)).toHaveLength(4);
  });

  it('rows that only UPDATE existing contacts do not use up the room: one below the cap, an update-only file passes', async () => {
    const t = await api.signup('cap4');
    await capAt(t, 3);
    await api.seedContacts(t, [
      { name: 'U1', phone: '+919812300340' },
      { name: 'U2', phone: '+919812300341' },
    ]);
    const res = await upload(
      t.admin,
      'name,mobile\nU1 renamed,+919812300340\nU2 renamed,+919812300341\n',
    );
    expect(res.body).toMatchObject({ updated: 2, created: 0, limitExceeded: 0 });
    expect(await countContacts(t)).toBe(2);
  });

  it('TW-CON-026 #3: no limit (0 or no plan row) means unlimited', async () => {
    const t = await api.signup('cap5');
    const res = await upload(
      t.admin,
      'name,mobile\n' +
        Array.from({ length: 30 }, (_, i) => `N${i},+9198123004${String(10 + i)}`).join('\n') +
        '\n',
    );
    expect(res.body.created).toBe(30);
  });
});

describe('preview (TW-CON-031)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('prv');
  });

  it('TW-CON-031 #1: "Phone, Name" with 8 rows: 2 headers, detected {phone:0, name:1}, 5 sample rows, and nothing is written', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => `+91981230050${i},Person ${i}`).join('\n');
    const res = await upload(
      t.admin,
      `Phone,Name\n${rows}\n`,
      undefined,
      'p.csv',
      '/v2/contacts/import/preview',
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.headers).toEqual(['Phone', 'Name']);
    expect(res.body.detected).toEqual({ phone: 0, name: 1 });
    expect(res.body.mapping).toMatchObject({ phone: 0, name: 1, email: null });
    expect(res.body.sampleRows).toHaveLength(5);
    expect(res.body.sampleRows[0]).toEqual({ Phone: '+919812300500', Name: 'Person 0' });
    expect(res.body.totals).toMatchObject({
      rows: 8,
      valid: 8,
      invalid: 0,
      duplicateInFile: 0,
      willCreate: 8,
      willUpdate: 0,
    });
    expect(res.body.runsAsJob).toBe(false);
    expect(await countContacts(t)).toBe(0);
  });

  it('TW-CON-031 #2: an empty file is 422', async () => {
    const res = await upload(t.admin, '', undefined, 'e.csv', '/v2/contacts/import/preview');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CON_IMPORT_FILE_INVALID');
  });

  it('predicts what the import would do: new and updated contacts, duplicates in the file, bad rows, and new groups and tags', async () => {
    await api.seedContacts(t, [{ name: 'Known', phone: '+919812300600' }]);
    await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Existing group' });
    const csv =
      'name,mobile,group,tags\n' +
      'Known,+919812300600,Existing group,\n' +
      'Fresh,+919812300601,"Existing group, Brand new group",Hot\n' +
      'Fresh again,+919812300601,,\n' +
      ',+919812300602,,\n';
    const res = await upload(t.admin, csv, undefined, 'p.csv', '/v2/contacts/import/preview');
    expect(res.body.totals).toEqual({
      rows: 4,
      valid: 3,
      invalid: 1,
      duplicateInFile: 1,
      willCreate: 1,
      willUpdate: 1,
    });
    expect(res.body.newGroups).toEqual(['Brand new group']);
    expect(res.body.newTags).toEqual(['Hot']);
    expect(res.body.invalidSamples).toEqual([
      { row: 5, reason: 'missing_name', values: expect.any(Object) },
    ]);
    expect(await countContacts(t)).toBe(1);
  });

  it('reports a file that cannot be imported as it stands: the fields no column was found for', async () => {
    const res = await upload(
      t.admin,
      'Name,Colour\nA,red\n',
      undefined,
      'p.csv',
      '/v2/contacts/import/preview',
    );
    expect(res.body.missingRequired).toEqual(['phone']);
  });

  it('reports the plan room left, and whether the file would run as a job', async () => {
    const t2 = await api.signup('prvq');
    await h.owner.query(
      `INSERT INTO org_plan_state (org_id, overrides) VALUES ($1, '{"limits":{"contacts":50}}'::jsonb) ON CONFLICT (org_id) DO UPDATE SET overrides = '{"limits":{"contacts":50}}'::jsonb`,
      [t2.orgId],
    );
    await api.seedContacts(t2, [{ name: 'One', phone: '+919812300700' }]);
    const big =
      'name,mobile\n' +
      Array.from({ length: 1200 }, (_, i) => `P${i},+9198123${String(10_000 + i)}`).join('\n') +
      '\n';
    const res = await upload(t2.admin, big, undefined, 'p.csv', '/v2/contacts/import/preview');
    expect(res.body.quota).toEqual({ limit: 50, used: 1, remaining: 49 });
    expect(res.body.runsAsJob).toBe(true);
  });

  it('needs the import capability', async () => {
    const m = await api.member(t, 'prvno', [['record.contacts.read']]);
    expect(
      (await upload(m.token, SAMPLE, undefined, 'p.csv', '/v2/contacts/import/preview')).status,
    ).toBe(403);
  });
});

describe('a large file runs as a background job (TW-CON-027)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('job');
  });

  const run = (jobInternalId: number) =>
    RequestContextStore.run(
      {
        requestId: 'test-worker',
        orgId: t.orgId,
        actorType: 'user',
        actorId: t.adminUserId,
        userId: t.adminUserId,
      },
      () =>
        h.app
          .get(ContactImportEngine, { strict: false })
          .run(t.orgId, t.adminUserId, jobInternalId),
    );

  it('above 1,000 rows the request answers 202 with a queued job, stores the file and enqueues it on con-import', async () => {
    const csv =
      'name,mobile,group\n' +
      Array.from(
        { length: 1500 },
        (_, i) => `Job ${i},+9197${String(10_000_000 + i)},${i % 2 ? 'Odd' : 'Even'}`,
      ).join('\n') +
      '\n' +
      ',+919700000001,\n'; // one bad row
    const res = await upload(t.admin, csv);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toMatchObject({
      status: 'queued',
      totalRows: 1501,
      processedRows: 0,
      created: 0,
    });

    const row = await h.owner.query(
      `SELECT id, source_csv, status FROM contact_import_jobs WHERE uuid = $1`,
      [res.body.id],
    );
    expect(row.rows[0].status).toBe('queued');
    expect(String(row.rows[0].source_csv).startsWith('name,mobile,group')).toBe(true);
    expect(await countContacts(t)).toBe(0);

    const queue = h.app.get<Queue>(getQueueToken('con-import'), { strict: false });
    const queued = await queue.getJob(`con-import-${t.orgId}-${row.rows[0].id}`);
    expect(queued?.data).toEqual({
      orgId: t.orgId,
      userId: t.adminUserId,
      jobId: Number(row.rows[0].id),
    });

    // the worker's part: the processor calls the engine with exactly this payload
    await run(Number(row.rows[0].id));

    const done = await api.as(t.admin).get(`/v2/contacts/import/jobs/${res.body.id}`);
    expect(done.body).toMatchObject({
      status: 'completed',
      totalRows: 1501,
      processedRows: 1501,
      created: 1500,
      updated: 0,
      invalid: 1,
      error: null,
    });
    expect(done.body.finishedAt).not.toBeNull();
    expect(await countContacts(t)).toBe(1500);
    const groups = (await api.as(t.admin).get('/v2/contact-groups')).body.data;
    expect(
      groups.map((g: { name: string; memberCount: number }) => [g.name, g.memberCount]).sort(),
    ).toEqual([
      ['Even', 750],
      ['Odd', 750],
    ]);
    // the uploaded text does not stay in the database
    expect(
      (
        await h.owner.query(`SELECT source_csv FROM contact_import_jobs WHERE uuid = $1`, [
          res.body.id,
        ])
      ).rows[0].source_csv,
    ).toBeNull();
    expect(
      (await api.as(t.admin).get(`/v2/contacts/import/jobs/${res.body.id}/rejects`)).text,
    ).toContain('missing_name');
  }, 120_000);

  it('running the same job again does nothing (a retried or redelivered job is harmless)', async () => {
    const [job] = (
      await h.owner.query(`SELECT id FROM contact_import_jobs WHERE org_id = $1`, [t.orgId])
    ).rows;
    const before = await countContacts(t);
    await run(Number(job.id));
    expect(await countContacts(t)).toBe(before);
  });

  it('a job that stopped half way resumes from the rows it had finished, without duplicating them', async () => {
    const csv =
      'name,mobile\n' +
      Array.from({ length: 1200 }, (_, i) => `Res ${i},+9196${String(10_000_000 + i)}`).join('\n') +
      '\n';
    const res = await upload(t.admin, csv);
    expect(res.status).toBe(202);
    const row = (
      await h.owner.query(`SELECT id FROM contact_import_jobs WHERE uuid = $1`, [res.body.id])
    ).rows[0];
    // the first 500 rows were committed by an attempt that then died
    await h.owner.query(
      `INSERT INTO contacts (org_id, name, phone, import_job_id, source)
       SELECT $1, 'Res ' || g, '+9196' || (10000000 + g), $2, 'import' FROM generate_series(0, 499) g`,
      [t.orgId, row.id],
    );
    await h.owner.query(
      `UPDATE contact_import_jobs SET status = 'running', processed_rows = 500, created_count = 500 WHERE id = $1`,
      [row.id],
    );
    const before = await countContacts(t);
    await run(Number(row.id));
    const done = (await api.as(t.admin).get(`/v2/contacts/import/jobs/${res.body.id}`)).body;
    expect(done).toMatchObject({ status: 'completed', processedRows: 1200, created: 1200 });
    expect(await countContacts(t)).toBe(before + 700);
  }, 120_000);

  it('a job that fails is marked failed with the reason, and the file is kept for another try', async () => {
    const csv =
      'name,mobile\n' +
      Array.from({ length: 1100 }, (_, i) => `Fail ${i},+9195${String(10_000_000 + i)}`).join(
        '\n',
      ) +
      '\n';
    const res = await upload(t.admin, csv, { groupId: undefined });
    expect(res.status).toBe(202);
    const row = (
      await h.owner.query(`SELECT id FROM contact_import_jobs WHERE uuid = $1`, [res.body.id])
    ).rows[0];
    // the knob group is deleted between accepting the job and running it
    const g = (await api.as(t.admin).post('/v2/contact-groups').send({ name: 'Vanishing' })).body;
    await h.owner.query(
      `UPDATE contact_import_jobs SET options = options || jsonb_build_object('groupId', $2::text) WHERE id = $1`,
      [row.id, g.id],
    );
    await api.as(t.admin).delete(`/v2/contact-groups/${g.id}`);
    await expect(run(Number(row.id))).rejects.toThrow();
    const failed = (await api.as(t.admin).get(`/v2/contacts/import/jobs/${res.body.id}`)).body;
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('Contact group');
    expect(await countContacts(t)).toBe(2700); // nothing from this file
  }, 120_000);
});

describe('the contact API creates contacts the way an import does (TW-CON-012, 013)', () => {
  it('TW-CON-012: first and last name with no name give "Dr"-free "Aarav Sharma"; a typed name stays as typed', async () => {
    const t = await api.signup('nm');
    const a = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ firstName: 'Aarav', lastName: 'Sharma', phone: '+919812300800' });
    expect(a.body.name).toBe('Aarav Sharma');
    const b = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'ACME Support', phone: '+919812300801' });
    expect(b.body).toMatchObject({ name: 'ACME Support', firstName: null });
  });
});
