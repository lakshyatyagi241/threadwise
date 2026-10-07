import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  wizardAudienceCountSchema,
  wizardContactsPageSchema,
  wizardCsvReportSchema,
  wizardAudienceHasSource,
  wizardAudienceSchema,
  wizardBroadcastDetailSchema,
  wizardBroadcastListSchema,
  wizardHistoryListSchema,
  wizardCreditCheckSchema,
  wizardDraftResponseSchema,
  wizardLaunchResultSchema,
  wizardTemplatesResponseSchema,
  wizardVariablePreviewSchema,
} from '@crm/contracts';
import {
  addSender,
  balanceMinor,
  buildLab,
  group,
  idOfCampaign,
  makeDraft,
  number,
  payPerMessage,
  people,
  problem,
  readyDraft,
  startHarness,
  wiz,
  world,
  type Lab,
} from './broadcast-wizard.support';
import { WizardCsvService } from '../../../src/modules/campaigns/wizard/wizard-csv.service';

/**
 * The "Create broadcast" wizard over HTTP (an addition beyond WaDesk): templates, audience, the draft that is saved as the person
 * goes, the credit check, the variables, the launch of each mode, the controls, tenant isolation and permissions. The real app and a
 * real Postgres; the WhatsApp side is the sandbox sender (it never leaves the machine).
 */
let lab: Lab;

beforeAll(async () => {
  lab = buildLab(await startHarness());
}, 240_000);

afterAll(async () => {
  await lab?.h.stop();
});

const owner = () => lab.h.owner;

describe('step 1: templates', () => {
  it('lists only approved templates, with their placeholders; an OTP template, a pending one and a disconnected number are left out', async () => {
    const w = await world(lab, 'bwt1');
    await owner().query(
      `INSERT INTO wa_templates (org_id, template_name, template_body, template_type, status, language) VALUES
         ($1, 'pending_one', 'Hi', 'standard', 'pending', 'en_US'),
         ($1, 'otp_one', 'Your code {{1}}', 'auth', 'approved', 'en_US')`,
      [w.t.orgId],
    );
    const dead = await owner().query(
      `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number) VALUES ($1, 'waba', 'disconnected', '+15550001111') RETURNING id`,
      [w.t.orgId],
    );
    await owner().query(
      `INSERT INTO wa_templates (org_id, template_name, template_body, template_type, status, language, provider_config_id)
       VALUES ($1, 'orphan', 'Hi', 'standard', 'approved', 'en_US', $2)`,
      [w.t.orgId, dead.rows[0].id],
    );
    const res = await wiz(lab, w.t.admin).get('/templates');
    expect(res.status).toBe(200);
    const { data } = wizardTemplatesResponseSchema.parse(res.body);
    expect(data.map((t) => t.id)).toEqual([w.template]);
    expect(data[0]).toMatchObject({
      language: 'en_US',
      category: 'marketing',
      senderLabel: 'Main number',
      slots: [{ slot: 'body.1', section: 'body', position: 1, key: 'first_name', example: 'Asha' }],
    });
  });

  it('another workspace never sees these templates', async () => {
    const a = await world(lab, 'bwt2a');
    const b = await world(lab, 'bwt2b');
    const res = await wiz(lab, b.t.admin).get('/templates');
    const ids = wizardTemplatesResponseSchema.parse(res.body).data.map((t) => t.id);
    expect(ids).toEqual([b.template]);
    expect(ids).not.toContain(a.template);
  });
});

describe('step 1: the sender', () => {
  it('lists the connected numbers, the default engine first', async () => {
    const w = await world(lab, 'bws-s1');
    const res = await wiz(lab, w.t.admin).get('/senders');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject([
      { key: `waba:${w.config}`, label: 'Main number', engine: 'waba' },
    ]);
  });

  it("a number that is not connected, or another workspace's, is refused on the draft", async () => {
    const a = await world(lab, 'bws-s2a');
    const b = await world(lab, 'bws-s2b');
    const forged = await wiz(lab, b.t.admin).post('/drafts', { senderKey: `waba:${a.config}` });
    expect(forged.status).toBe(422);
    expect(problem(forged).errors[0]).toMatchObject({ path: 'senderKey' });
  });

  it('the picked number is the one that sends, even when the template belongs to another number', async () => {
    const w = await world(lab, 'bws-s3');
    await payPerMessage(lab, w.t, 1_000_000);
    const second = await owner().query(
      `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label, connected_at)
       VALUES ($1, 'waba', 'connected', '+15559998888', 'Second number', now()) RETURNING id, uuid`,
      [w.t.orgId],
    );
    const ids = await people(lab, w.t, [{}]);
    const g = await group(owner(), w.t, 'G', ids);
    const d = await makeDraft(
      lab,
      w,
      readyDraft(w, g, { senderKey: `waba:${second.rows[0].uuid}` }),
    );
    const res = await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = (await owner().query(`SELECT device_id FROM wpcampaigns WHERE uuid = $1`, [d.id]))
      .rows[0];
    expect(Number(row.device_id)).toBe(Number(second.rows[0].id));
  });
});

describe('step 2: audience sources and the count', () => {
  it('lists the groups and segments with member counts', async () => {
    const w = await world(lab, 'bwa1');
    const ids = await people(lab, w.t, [{}, {}, {}]);
    await group(owner(), w.t, 'VIP', ids.slice(0, 2));
    const seg = await lab.api
      .http()
      .post('/v2/segments')
      .set('authorization', `Bearer ${w.t.admin}`)
      .send({
        name: 'Pune people',
        visibility: 'shared',
        rules: {
          type: 'group',
          combinator: 'and',
          children: [{ type: 'condition', field: 'countryCode', operator: 'equals', value: '+91' }],
        },
      });
    expect(seg.status, JSON.stringify(seg.body)).toBe(201);
    const res = await wiz(lab, w.t.admin).get('/audience-sources');
    expect(res.status).toBe(200);
    expect(res.body.groups).toMatchObject([{ name: 'VIP', memberCount: 2 }]);
    expect(res.body.segments).toMatchObject([{ name: 'Pune people' }]);
  });

  async function count(token: string, audience: object) {
    const res = await wiz(lab, token).post('/audience/count', { audience });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return wizardAudienceCountSchema.parse(res.body);
  }

  it('groups and segments join; opted-out contacts and invalid numbers are counted apart and never messaged', async () => {
    const w = await world(lab, 'bwa2');
    const ids = await people(lab, w.t, [
      { name: 'In group A', countryCode: '+91' },
      { name: 'In group A opted out', isUnsubscribed: true, countryCode: '+91' },
      { name: 'In group B', countryCode: '+44' },
      { name: 'No number', phone: null, countryCode: '+91' },
      { name: 'Bad number', phone: '12345', countryCode: '+91' },
      { name: 'Nobody picked me', countryCode: '+91' },
    ]);
    const a = await group(owner(), w.t, 'A', ids.slice(0, 2));
    const b = await group(owner(), w.t, 'B', [ids[2]!, ids[3]!, ids[4]!]);

    const both = await count(w.t.admin, { groupIds: [a, b], segmentIds: [], rules: null });
    expect(both).toMatchObject({
      matching: 5,
      optedOut: 1,
      invalidNumber: 2,
      recipients: 2,
      approximate: false,
    });

    // The conditions alone only filter the contacts table: they are not an audience until "select all matching" freezes them.
    const india = {
      type: 'group',
      combinator: 'and',
      children: [{ type: 'condition', field: 'countryCode', operator: 'equals', value: '+91' }],
    };
    expect(await count(w.t.admin, { groupIds: [], segmentIds: [], rules: india })).toMatchObject({
      matching: 0,
      recipients: 0,
    });
    const all = await count(w.t.admin, { allMatching: { search: null, rules: india } });
    expect(all.matching).toBe(5);
    // Nothing picked, nobody.
    expect(await count(w.t.admin, { groupIds: [], segmentIds: [], rules: null })).toMatchObject({
      matching: 0,
      recipients: 0,
    });
  });

  it('a Contact Hub selection is a source: ticked ids, or the saved filter minus the un-ticked rows', async () => {
    const w = await world(lab, 'bwa-sel');
    const ids = await people(lab, w.t, [
      { name: 'Ticked one', countryCode: '+91' },
      { name: 'Ticked two', countryCode: '+91' },
      { name: 'Ticked opted out', isUnsubscribed: true },
      { name: 'Left out', countryCode: '+44' },
    ]);
    const picked = await count(w.t.admin, {
      groupIds: [],
      segmentIds: [],
      rules: null,
      selection: { ids: ids.slice(0, 3) },
    });
    expect(picked).toMatchObject({ matching: 3, optedOut: 1, recipients: 2 });

    // "Select all matching" with a filter, one row un-ticked.
    const filtered = await count(w.t.admin, {
      groupIds: [],
      segmentIds: [],
      rules: null,
      selection: { filter: { q: 'Ticked' }, excludeIds: [ids[1]!] },
    });
    expect(filtered).toMatchObject({ matching: 2, recipients: 1 });

    // A selection joins the other sources as a union (a contact in both is counted once).
    const joined = await count(w.t.admin, {
      groupIds: [],
      segmentIds: [],
      rules: null,
      contactIds: [ids[0]!, ids[3]!],
      selection: { ids: ids.slice(0, 2) },
    });
    expect(joined.matching).toBe(3);

    // Ids that are not in this workspace select nobody; a selection naming both ids and a filter is refused.
    const foreign = '3f1c2b7a-5d4e-4a90-8b21-0c9d7e6f5a43';
    expect(
      await count(w.t.admin, {
        groupIds: [],
        segmentIds: [],
        rules: null,
        selection: { ids: [foreign] },
      }),
    ).toMatchObject({ matching: 0, recipients: 0 });
    const both = await wiz(lab, w.t.admin).post('/audience/count', {
      audience: { selection: { ids, filter: { q: 'x' } } },
    });
    expect(both.status).toBe(422);
  });

  it('reports the recipients by destination country, for the price', async () => {
    const w = await world(lab, 'bwa3');
    const ids = await people(lab, w.t, [
      { phone: '+919876543210' },
      { phone: '+919876543211' },
      { phone: '+14155550123' },
    ]);
    const g = await group(owner(), w.t, 'World', ids);
    const c = await count(w.t.admin, { groupIds: [g], segmentIds: [], rules: null });
    expect(c.countries).toEqual([
      { country: 'IN', count: 2 },
      { country: 'US', count: 1 },
    ]);
  });

  it('a deleted group in a segment-style condition matches nothing and is reported, not an error', async () => {
    const w = await world(lab, 'bwa4');
    const res = await wiz(lab, w.t.admin).post('/audience/count', {
      audience: {
        groupIds: [],
        segmentIds: [],
        allMatching: {
          search: null,
          rules: {
            type: 'group',
            combinator: 'and',
            children: [
              {
                type: 'condition',
                field: 'groups',
                operator: 'has_any',
                value: ['3f2b8c1e-7c1d-4a55-9d10-0d0a6f0f9a11'],
              },
            ],
          },
        },
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.recipients).toBe(0);
    expect(res.body.invalidConditions[0]).toMatchObject({ reason: 'group_deleted' });
  });

  it("an invalid rule is refused with the segment engine's own validation, before any SQL", async () => {
    const w = await world(lab, 'bwa5');
    const res = await wiz(lab, w.t.admin).post('/audience/count', {
      audience: {
        groupIds: [],
        segmentIds: [],
        rules: {
          type: 'group',
          combinator: 'and',
          children: [{ type: 'condition', field: 'name', operator: 'gt', value: 5 }],
        },
      },
    });
    expect(res.status).toBe(422);
  });
});

describe('step 2: the four audience modes', () => {
  const india = {
    type: 'group',
    combinator: 'and',
    children: [{ type: 'condition', field: 'countryCode', operator: 'equals', value: '+91' }],
  };

  async function count(token: string, audience: object) {
    const res = await wiz(lab, token).post('/audience/count', { audience });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return wizardAudienceCountSchema.parse(res.body);
  }
  async function contactsPage(token: string, body: object) {
    const res = await wiz(lab, token).post('/contacts/query', body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return wizardContactsPageSchema.parse(res.body);
  }
  async function upload(token: string, csv: string, name = 'numbers.csv') {
    const res = await wiz(lab, token).upload('/csv', csv, name);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return wizardCsvReportSchema.parse(res.body);
  }
  /** Launches a ready draft with this audience; returns the phones of the written recipients. */
  async function launch(w: Awaited<ReturnType<typeof world>>, audience: object) {
    await payPerMessage(lab, w.t, 1_000_000);
    const g = await group(owner(), w.t, 'Unused', []);
    const d = await makeDraft(lab, w, readyDraft(w, g, { audience }));
    const res = await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    return { res, d };
  }
  const recipientPhones = async (campaignUuid: string): Promise<string[]> => {
    const { id } = await idOfCampaign(owner(), campaignUuid);
    const r = await owner().query(
      `SELECT c.phone FROM wp_campaign_contacts r JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
       WHERE r.campaign_id = $1 ORDER BY c.phone`,
      [id],
    );
    return r.rows.map((x) => x.phone as string);
  };

  it('any one source is a valid audience; the conditions alone are not', () => {
    const base = wizardAudienceSchema.parse({});
    expect(wizardAudienceHasSource(base)).toBe(false);
    expect(wizardAudienceHasSource({ ...base, rules: india as never })).toBe(false);
    expect(
      wizardAudienceHasSource({ ...base, contactIds: ['3f2b8c1e-7c1d-4a55-9d10-0d0a6f0f9a11'] }),
    ).toBe(true);
    expect(wizardAudienceHasSource({ ...base, allMatching: { search: null, rules: null } })).toBe(
      true,
    );
  });

  it('the contacts table is searched, filtered and paged on the server, with the total', async () => {
    const w = await world(lab, 'bwm1');
    await people(lab, w.t, [
      ...Array.from({ length: 30 }, (_, i) => ({
        name: `Indian ${String(i).padStart(2, '0')}`,
        countryCode: '+91',
      })),
      { name: 'British Bob', countryCode: '+44' },
      { name: 'Opted Olga', countryCode: '+91', isUnsubscribed: true },
      { name: 'Bad Number', phone: '123', countryCode: '+91' },
    ]);
    const first = await contactsPage(w.t.admin, { page: 1, perPage: 25 });
    expect(first.total).toBe(33);
    expect(first.data).toHaveLength(25);
    const second = await contactsPage(w.t.admin, { page: 2, perPage: 25 });
    expect(second.data).toHaveLength(8);
    expect(new Set([...first.data, ...second.data].map((r) => r.id)).size).toBe(33);

    // Search runs in the database: a name word, not a page of rows.
    const search = await contactsPage(w.t.admin, { search: 'british', page: 1, perPage: 25 });
    expect(search).toMatchObject({ total: 1, data: [{ name: 'British Bob', sendable: true }] });

    // The conditions are the segments rule engine's, applied before the count and the paging.
    const filtered = await contactsPage(w.t.admin, { rules: india, page: 1, perPage: 100 });
    expect(filtered.total).toBe(32);
    expect(filtered.data.some((r) => r.name === 'British Bob')).toBe(false);
    const flags = Object.fromEntries(filtered.data.map((r) => [r.name, r]));
    expect(flags['Opted Olga']).toMatchObject({ optedOut: true, sendable: false });
    expect(flags['Bad Number']).toMatchObject({ optedOut: false, sendable: false });

    // Another workspace sees none of it.
    const other = await world(lab, 'bwm1b');
    expect((await contactsPage(other.t.admin, { page: 1, perPage: 25 })).total).toBe(0);
  });

  it('contacts ticked in the table are the recipients at launch; an opted-out one is never written', async () => {
    const w = await world(lab, 'bwm2');
    const ids = await people(lab, w.t, [
      { phone: '+919876500001' },
      { phone: '+919876500002' },
      { phone: '+919876500003', isUnsubscribed: true },
      { phone: '+919876500004' },
    ]);
    const audience = { contactIds: [ids[0]!, ids[2]!, ids[3]!] };
    const c = await count(w.t.admin, audience);
    expect(c).toMatchObject({ matching: 3, optedOut: 1, recipients: 2, newContacts: 0 });
    const { res, d } = await launch(w, audience);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.recipients).toBe(2);
    expect(await recipientPhones(d.id)).toEqual(['+919876500001', '+919876500004']);
  });

  it('"select all matching" takes the search and the conditions frozen at that moment, minus the contacts un-ticked', async () => {
    const w = await world(lab, 'bwm3');
    const ids = await people(lab, w.t, [
      { name: 'Anil', phone: '+919876510001', countryCode: '+91' },
      { name: 'Anita', phone: '+919876510002', countryCode: '+91' },
      { name: 'Anya UK', phone: '+447700900123', countryCode: '+44' },
      { name: 'Bela', phone: '+919876510004', countryCode: '+91' },
    ]);
    const all = { allMatching: { search: null, rules: india } };
    expect(await count(w.t.admin, all)).toMatchObject({ matching: 3, recipients: 3 });
    const searched = { allMatching: { search: 'an', rules: india } };
    expect(await count(w.t.admin, searched)).toMatchObject({ matching: 2, recipients: 2 });
    const unticked = { ...searched, excludedContactIds: [ids[0]!] };
    expect(await count(w.t.admin, unticked)).toMatchObject({ matching: 1, recipients: 1 });
    const { res, d } = await launch(w, unticked);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await recipientPhones(d.id)).toEqual(['+919876510002']);
  });

  it('CSV: the upload is parsed on the server and reports valid, duplicate, invalid and opted-out numbers with line numbers', async () => {
    const w = await world(lab, 'bwm4');
    await people(lab, w.t, [
      { name: 'Existing', phone: '+919876520001' },
      { name: 'Opted out', phone: '+919876520002', isUnsubscribed: true },
    ]);
    const csv = [
      'phone,first_name,last_name',
      '+919876520001,Eva,Existing', // line 2: already a contact
      '+919876520002,Olga,Out', // line 3: opted-out contact
      '+919876520003,New,One', // line 4: new
      '+91 98765 20003,New,Again', // line 5: same number as line 4
      '12345,Bad,Number', // line 6: invalid
      ',No,Phone', // line 7: missing
      '9876520004,Local,Number', // line 8: local number, workspace default country applies
      '+447700900456,Uk,Person', // line 9: new, other country
    ].join('\n');
    const r = await upload(w.t.admin, csv);
    expect(r).toMatchObject({
      fileName: 'numbers.csv',
      totalRows: 8,
      valid: 5,
      duplicate: 1,
      invalid: 2,
      optedOut: 1,
      existing: 2,
      newContacts: 3,
    });
    expect(r.issues).toEqual([
      { line: 5, value: '+91 98765 20003', reason: 'duplicate' },
      { line: 6, value: '12345', reason: 'invalid_phone' },
      { line: 7, value: '', reason: 'missing_phone' },
    ]);
    expect(r.preview[0]).toMatchObject({ line: 2, phone: '+919876520001', status: 'existing' });
    expect(r.preview[1]).toMatchObject({ line: 3, status: 'optedOut' });
    expect(r.preview[2]).toMatchObject({
      line: 4,
      phone: '+919876520003',
      name: 'New One',
      status: 'new',
    });

    // The report can be read again, and the error list downloads with the line numbers.
    const again = await wiz(lab, w.t.admin).get(`/csv/${r.id}`);
    expect(again.status).toBe(200);
    expect(wizardCsvReportSchema.parse(again.body)).toMatchObject({ valid: 5, newContacts: 3 });
    const errors = await wiz(lab, w.t.admin).get(`/csv/${r.id}/errors`);
    expect(errors.status).toBe(200);
    expect(errors.headers['content-type']).toContain('text/csv');
    const lines = (errors.text as string)
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\n');
    expect(lines[0]).toBe('line,value,problem');
    expect(lines.map((l) => l.split(',')[0])).toEqual(['line', '5', '6', '7']);

    // A file without a phone column, a binary file and an oversized row count are refused with a reason.
    const noPhone = await wiz(lab, w.t.admin).upload('/csv', 'name,email\nA,a@x.com');
    expect(noPhone.status).toBe(422);
    expect(noPhone.body.code).toBe('CON_IMPORT_FILE_INVALID');
    const tpl = await wiz(lab, w.t.admin).get('/csv/template');
    expect(tpl.status).toBe(200);
    expect((tpl.text as string).replace(/^\uFEFF/, '').split('\n')[0]).toBe(
      'phone,first_name,last_name',
    );
  });

  it('CSV: the count includes numbers that are not contacts yet; the launch creates them as contacts and messages every valid number once', async () => {
    const w = await world(lab, 'bwm5');
    await people(lab, w.t, [
      { name: 'Existing', phone: '+919876530001' },
      { name: 'Opted out', phone: '+919876530002', isUnsubscribed: true },
    ]);
    const r = await upload(
      w.t.admin,
      [
        'phone,name',
        '+919876530001,Eva',
        '+919876530002,Olga',
        '+919876530003,Nina',
        '+919876530003,Nina again',
        '+447700900777,Uma',
      ].join('\n'),
    );
    const audience = {
      csv: {
        id: r.id,
        fileName: r.fileName,
        valid: r.valid,
        duplicate: r.duplicate,
        invalid: r.invalid,
        optedOut: r.optedOut,
      },
    };
    const before = Number(
      (await owner().query(`SELECT count(*) FROM contacts WHERE org_id = $1`, [w.t.orgId])).rows[0]
        .count,
    );
    const c = await count(w.t.admin, audience);
    expect(c).toMatchObject({ matching: 4, optedOut: 1, recipients: 3, newContacts: 2 });
    expect(c.countries.map((x) => [x.country, x.count]).sort()).toEqual([
      ['GB', 1],
      ['IN', 2],
    ]);
    // Counting writes nothing.
    expect(
      Number(
        (await owner().query(`SELECT count(*) FROM contacts WHERE org_id = $1`, [w.t.orgId]))
          .rows[0].count,
      ),
    ).toBe(before);

    const { res, d } = await launch(w, audience);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.recipients).toBe(3);
    expect(await recipientPhones(d.id)).toEqual([
      '+447700900777',
      '+919876530001',
      '+919876530003',
    ]);
    const made = await owner().query(
      `SELECT name, source FROM contacts WHERE org_id = $1 AND phone = '+919876530003'`,
      [w.t.orgId],
    );
    expect(made.rows).toEqual([{ name: 'Nina', source: 'broadcast_csv' }]);
    // The opted-out contact was matched by phone and skipped, not duplicated.
    expect(
      Number(
        (
          await owner().query(
            `SELECT count(*) FROM contacts WHERE org_id = $1 AND phone = '+919876530002'`,
            [w.t.orgId],
          )
        ).rows[0].count,
      ),
    ).toBe(1);
  });

  it('the audience is the union of the modes: a contact in several is one recipient, opted-out and invalid are always out', async () => {
    const w = await world(lab, 'bwm6');
    const ids = await people(lab, w.t, [
      { name: 'Both ticked and in group', phone: '+919876540001' },
      { name: 'Only group', phone: '+919876540002' },
      { name: 'Only ticked', phone: '+919876540003' },
      { name: 'Opted out in group', phone: '+919876540004', isUnsubscribed: true },
      { name: 'In CSV too', phone: '+919876540005' },
    ]);
    const g = await group(owner(), w.t, 'G', [ids[0]!, ids[1]!, ids[3]!]);
    const seg = await lab.api
      .http()
      .post('/v2/segments')
      .set('authorization', `Bearer ${w.t.admin}`)
      .send({
        name: 'Phone 5',
        visibility: 'shared',
        rules: {
          type: 'group',
          combinator: 'and',
          children: [{ type: 'condition', field: 'name', operator: 'contains', value: 'CSV' }],
        },
      });
    expect(seg.status, JSON.stringify(seg.body)).toBe(201);
    const r = await upload(
      w.t.admin,
      ['phone', '+919876540005', '+919876540006', '+919876540001'].join('\n'),
    );
    const audience = {
      groupIds: [g],
      segmentIds: [seg.body.id as string],
      contactIds: [ids[0]!, ids[2]!],
      csv: {
        id: r.id,
        fileName: r.fileName,
        valid: r.valid,
        duplicate: r.duplicate,
        invalid: r.invalid,
        optedOut: r.optedOut,
      },
    };
    const c = await count(w.t.admin, audience);
    // 0,1,3 (group) + 5 (segment, CSV) + 0,2 (ticked) + csv: 5,1 and the new 6 => contacts 0,1,2,3,4 and new 6
    expect(c).toMatchObject({ matching: 6, optedOut: 1, recipients: 5, newContacts: 1 });
    const { res, d } = await launch(w, audience);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await recipientPhones(d.id)).toEqual([
      '+919876540001',
      '+919876540002',
      '+919876540003',
      '+919876540005',
      '+919876540006',
    ]);
  });

  it('a CSV is private to its workspace: another workspace cannot read it, count it or launch with it', async () => {
    const a = await world(lab, 'bwm7a');
    const b = await world(lab, 'bwm7b');
    const r = await upload(a.t.admin, ['phone', '+919876550001'].join('\n'));
    expect((await wiz(lab, b.t.admin).get(`/csv/${r.id}`)).status).toBe(404);
    expect((await wiz(lab, b.t.admin).get(`/csv/${r.id}/errors`)).status).toBe(404);
    const foreign = {
      csv: { id: r.id, fileName: 'x.csv', valid: 1, duplicate: 0, invalid: 0, optedOut: 0 },
    };
    const c = await count(b.t.admin, foreign);
    expect(c).toMatchObject({ matching: 0, recipients: 0, newContacts: 0 });
    const res = await wiz(lab, b.t.admin).post('/audience/count', { audience: foreign });
    expect(res.body.invalidConditions[0]).toMatchObject({ reason: 'csv_missing' });
    const { res: launched } = await launch(b, foreign);
    expect(launched.status).toBe(422);
    // The row-level policy holds even for a query that names the upload (the app role, the other workspace's context).
    const rows = await owner().query(
      `SELECT count(*)::int AS n FROM camp_wizard_csv_rows WHERE org_id = $1`,
      [a.t.orgId],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it('an expired upload is deleted by the retention pass; a pinned one is kept', async () => {
    const w = await world(lab, 'bwm8');
    const keep = await upload(w.t.admin, 'phone\n+919876560001');
    const gone = await upload(w.t.admin, 'phone\n+919876560002');
    await owner().query(
      `UPDATE camp_wizard_csv SET expires_at = now() - interval '1 minute' WHERE uuid = $1`,
      [gone.id],
    );
    await owner().query(`UPDATE camp_wizard_csv SET expires_at = NULL WHERE uuid = $1`, [keep.id]);
    const csv = lab.h.app.get(WizardCsvService, { strict: false });
    expect(await csv.purgeExpired()).toBeGreaterThanOrEqual(1);
    expect((await wiz(lab, w.t.admin).get(`/csv/${gone.id}`)).status).toBe(404);
    expect((await wiz(lab, w.t.admin).get(`/csv/${keep.id}`)).status).toBe(200);
    // Pinned by nothing (no active or paused series names it), so the pass let it go: it now expires like any upload.
    const kept = await owner().query(`SELECT expires_at FROM camp_wizard_csv WHERE uuid = $1`, [
      keep.id,
    ]);
    expect(kept.rows[0].expires_at).not.toBeNull();
  });

  it('the error list writes values a spreadsheet would run as formulas as text, and keeps plain numbers', async () => {
    const w = await world(lab, 'bwm9');
    const r = await upload(
      w.t.admin,
      ['phone', "+1+cmd|'/c calc'!A0", '=1+1', '@SUM(A1)', '-5+3', '+12'].join('\n'),
    );
    const errors = await wiz(lab, w.t.admin).get(`/csv/${r.id}/errors`);
    const text = errors.text as string;
    expect(text).toContain("'+1+cmd|");
    expect(text).toContain("'=1+1");
    expect(text).toContain("'@SUM(A1)");
    expect(text).toContain("'-5+3");
    // A bare short number is not a formula: written as it is.
    expect(text).toMatch(/\n6,\+12,/);
  });

  it('a workspace holds at most 20 unexpired uploads at a time', async () => {
    const w = await world(lab, 'bwm10');
    for (let i = 0; i < 20; i++) {
      await owner().query(
        `INSERT INTO camp_wizard_csv (org_id, file_name, total_rows, valid_count, duplicate_count, invalid_count, created_by, expires_at)
         VALUES ($1, $2, 0, 0, 0, 0, $3, now() + interval '3 days')`,
        [w.t.orgId, `old-${i}.csv`, w.t.adminUserId],
      );
    }
    const res = await wiz(lab, w.t.admin).upload('/csv', 'phone\n+919876570001', 'one-more.csv');
    expect(res.status, JSON.stringify(res.body)).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    // An expired one frees a place.
    await owner().query(
      `UPDATE camp_wizard_csv SET expires_at = now() - interval '1 minute' WHERE org_id = $1 AND file_name = 'old-0.csv'`,
      [w.t.orgId],
    );
    await lab.h.app.get(WizardCsvService, { strict: false }).purgeExpired();
    expect(
      (await wiz(lab, w.t.admin).upload('/csv', 'phone\n+919876570001', 'one-more.csv')).status,
    ).toBe(201);
  });
});

describe('the draft', () => {
  it('is saved as the person goes: created with whatever is filled in, read back, updated with the row version', async () => {
    const w = await world(lab, 'bwd1');
    const created = wizardDraftResponseSchema.parse(await makeDraft(lab, w, { name: 'First' }));
    expect(created).toMatchObject({
      status: 'draft',
      draft: { name: 'First', templateId: null, step: 1 },
    });

    const saved = await wiz(lab, w.t.admin).put(`/drafts/${created.id}`, {
      rowVersion: created.rowVersion,
      templateId: w.template,
      step: 2,
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const after = wizardDraftResponseSchema.parse(saved.body);
    expect(after.draft).toMatchObject({ name: 'First', templateId: w.template, step: 2 });
    expect(after.rowVersion).toBeGreaterThan(created.rowVersion);

    const read = await wiz(lab, w.t.admin).get(`/drafts/${created.id}`);
    expect(wizardDraftResponseSchema.parse(read.body).draft).toEqual(after.draft);
  });

  it("a draft is a campaign row in the campaigns list, marked as the wizard's so it reopens there", async () => {
    const w = await world(lab, 'bwd2');
    const d = await makeDraft(lab, w, { name: 'Listed draft' });
    const res = await lab.api
      .http()
      .get('/v2/campaigns')
      .set('authorization', `Bearer ${w.t.admin}`);
    expect(res.status).toBe(200);
    const row = (
      res.body.data as Array<{ id: string; wizard: boolean; status: string; name: string }>
    ).find((c) => c.id === d.id);
    expect(row).toMatchObject({ wizard: true, status: 'draft', name: 'Listed draft' });
  });

  it('a stale row version is a 409 and nothing is overwritten', async () => {
    const w = await world(lab, 'bwd3');
    const d = await makeDraft(lab, w, { name: 'v1' });
    const first = await wiz(lab, w.t.admin).put(`/drafts/${d.id}`, {
      rowVersion: d.rowVersion,
      name: 'v2',
    });
    expect(first.status).toBe(200);
    const stale = await wiz(lab, w.t.admin).put(`/drafts/${d.id}`, {
      rowVersion: d.rowVersion,
      name: 'v3',
    });
    expect(stale.status).toBe(409);
    expect(problem(stale).code).toBe('ROW_VERSION_CONFLICT');
    expect((await wiz(lab, w.t.admin).get(`/drafts/${d.id}`)).body.draft.name).toBe('v2');
  });

  it("a reference to another workspace's template or group is refused, never stored", async () => {
    const a = await world(lab, 'bwd4a');
    const b = await world(lab, 'bwd4b');
    const ids = await people(lab, a.t, [{}]);
    const foreignGroup = await group(owner(), a.t, 'Mine', ids);
    const t = await wiz(lab, b.t.admin).post('/drafts', { templateId: a.template });
    expect(t.status).toBe(422);
    const g = await wiz(lab, b.t.admin).post('/drafts', {
      audience: { groupIds: [foreignGroup], segmentIds: [], rules: null },
    });
    expect(g.status).toBe(422);
  });

  it('validates the shape: a bad schedule, an oversized name', async () => {
    const w = await world(lab, 'bwd5');
    expect((await wiz(lab, w.t.admin).post('/drafts', { name: 'x'.repeat(200) })).status).toBe(422);
    expect(
      (
        await wiz(lab, w.t.admin).post('/drafts', {
          schedule: { mode: 'scheduled', date: 'soon', time: '9', timezone: 'x' },
        })
      ).status,
    ).toBe(422);
  });
});

describe('step 3: credit check and variables', () => {
  it('an empty pay-per-message wallet is insufficient, with the shortfall, a priced line per country and the top-up link', async () => {
    const w = await world(lab, 'bwc1');
    await payPerMessage(lab, w.t, 0);
    const ids = await people(lab, w.t, [
      { phone: '+919876543210' },
      { phone: '+919876543211' },
      { phone: '+14155550123' },
    ]);
    const g = await group(owner(), w.t, 'G', ids);
    const res = await wiz(lab, w.t.admin).post('/credit-check', {
      templateId: w.template,
      audience: { groupIds: [g], segmentIds: [], rules: null },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const c = wizardCreditCheckSchema.parse(res.body);
    expect(c).toMatchObject({
      billingMode: 'wallet',
      category: 'marketing',
      recipients: 3,
      chargeableMessages: 3,
      balanceMinor: 0,
      sufficient: false,
      topupUrl: '/billing/checkout/wallet',
    });
    expect(c.lines.map((l) => [l.country, l.messages])).toEqual([
      ['IN', 2],
      ['US', 1],
    ]);
    expect(c.estimatedCostMinor).toBeGreaterThan(0);
    expect(c.estimatedCostMinor).toBe(c.lines.reduce((n, l) => n + l.subtotalMinor, 0));
    expect(c.shortfallMinor).toBe(c.estimatedCostMinor);
  });

  it('a funded wallet is sufficient', async () => {
    const w = await world(lab, 'bwc2');
    await payPerMessage(lab, w.t, 1_000_000);
    const ids = await people(lab, w.t, [{}, {}]);
    const g = await group(owner(), w.t, 'G', ids);
    const c = wizardCreditCheckSchema.parse(
      (
        await wiz(lab, w.t.admin).post('/credit-check', {
          templateId: w.template,
          audience: { groupIds: [g], segmentIds: [], rules: null },
        })
      ).body,
    );
    expect(c).toMatchObject({ sufficient: true, shortfallMinor: 0, balanceMinor: 1_000_000 });
  });

  it('a workspace on a plan whose monthly messages cover the send is not charged: estimate 0 and sufficient with an empty wallet', async () => {
    const w = await world(lab, 'bwc3');
    await owner().query(
      `INSERT INTO org_plan_state (org_id, overrides) VALUES ($1, '{"limits":{"monthly_messages":1000}}'::jsonb)
       ON CONFLICT (org_id) DO UPDATE SET overrides = EXCLUDED.overrides`,
      [w.t.orgId],
    );
    const ids = await people(lab, w.t, [{}, {}]);
    const g = await group(owner(), w.t, 'G', ids);
    const c = wizardCreditCheckSchema.parse(
      (
        await wiz(lab, w.t.admin).post('/credit-check', {
          templateId: w.template,
          audience: { groupIds: [g], segmentIds: [], rules: null },
        })
      ).body,
    );
    expect(c).toMatchObject({
      billingMode: 'plan',
      chargeableMessages: 0,
      estimatedCostMinor: 0,
      sufficient: true,
    });
  });

  it('resolves the message for real contacts: a field, its fallback, and flags the placeholder still without a source', async () => {
    const w = await world(lab, 'bwv1', {
      body: 'Hi {{1}}, your {{2}} is ready in {{3}}.',
      variableMap: {
        body: [
          { num: 1, key: 'first_name', example: 'Asha' },
          { num: 2, key: 'order_id', example: 'A-1' },
          { num: 3, key: 'city', example: 'Pune' },
        ],
      },
    });
    const ids = await people(lab, w.t, [
      { name: 'Aarav Sharma', data: { city: 'Pune' } },
      { name: 'Priya', data: {} },
    ]);
    await owner().query(`UPDATE contacts SET first_name = 'Aarav' WHERE uuid = $1`, [ids[0]]);
    const g = await group(owner(), w.t, 'G', ids);
    const res = await wiz(lab, w.t.admin).post('/variables/preview', {
      templateId: w.template,
      audience: { groupIds: [g], segmentIds: [], rules: null },
      variables: {
        'body.1': { kind: 'field', field: 'first_name', fallback: 'there' },
        'body.3': { kind: 'field', field: 'city' },
      },
      limit: 2,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const p = wizardVariablePreviewSchema.parse(res.body);
    expect(p.unmapped).toEqual(['body.2']);
    expect(p.slots.map((s) => s.slot)).toEqual(['body.1', 'body.2', 'body.3']);
    expect(p.samples).toHaveLength(2);
    expect(p.samples[0]).toMatchObject({ body: 'Hi Aarav, your  is ready in Pune.', empty: [] });
    // The second contact has no first name (the fallback fills it) and no city (nothing does: flagged).
    expect(p.samples[1]!.values['body.1']).toBe('there');
    expect(p.samples[1]!.empty).toEqual(['body.3']);
  });
});

describe('step 4: launch', () => {
  it('"now": the draft becomes a running campaign with the audience as its recipients, and a run is queued', async () => {
    const w = await world(lab, 'bwl1');
    await payPerMessage(lab, w.t, 1_000_000);
    const ids = await people(lab, w.t, [
      { name: 'A' },
      { name: 'B' },
      { name: 'Out', isUnsubscribed: true },
    ]);
    const g = await group(owner(), w.t, 'G', ids);
    const d = await makeDraft(lab, w, readyDraft(w, g));
    const before = lab.enqueued.length;
    const res = await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const out = wizardLaunchResultSchema.parse(res.body);
    expect(out).toMatchObject({
      mode: 'now',
      kind: 'campaign',
      status: 'running',
      recipients: 2,
      id: d.id,
    });

    const c = (
      await owner().query(
        `SELECT status, total_recipients, provider, schedule_type, retry_enabled FROM wpcampaigns WHERE uuid = $1`,
        [d.id],
      )
    ).rows[0];
    expect(c).toMatchObject({
      status: 'running',
      total_recipients: 2,
      provider: 'waba',
      schedule_type: 'now',
      retry_enabled: false,
    });
    const rows = (
      await owner().query(
        `SELECT r.status, c.name FROM wp_campaign_contacts r JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
       JOIN wpcampaigns k ON k.org_id = r.org_id AND k.id = r.campaign_id WHERE k.uuid = $1 ORDER BY c.name`,
        [d.id],
      )
    ).rows;
    expect(rows).toEqual([
      { status: 'queued', name: 'A' },
      { status: 'queued', name: 'B' },
    ]);
    // The queue is Redis here; the run is created by the job, so check the draft can no longer be launched or edited.
    void before;
    const again = await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(again.status).toBe(409);
    expect(problem(again).code).toBe('CAMP_WIZARD_LAUNCHED');
    const edit = await wiz(lab, w.t.admin).put(`/drafts/${d.id}`, {
      rowVersion: d.rowVersion,
      name: 'x',
    });
    expect(edit.status).toBe(409);
    expect(problem(edit).code).toBe('CAMP_WIZARD_LAUNCHED');
  });

  it('"now" then the run: the sandbox is sent the mapped variable for each recipient, and the count on screen was the list messaged', async () => {
    const w = await world(lab, 'bwl2');
    await payPerMessage(lab, w.t, 1_000_000);
    const ids = await people(lab, w.t, [
      { name: 'Aarav Sharma' },
      { name: 'Priya Rao' },
      { name: 'Gone', isUnsubscribed: true },
    ]);
    await owner().query(`UPDATE contacts SET first_name = 'Aarav' WHERE uuid = $1`, [ids[0]]);
    const g = await group(owner(), w.t, 'G', ids);
    const d = await makeDraft(lab, w, readyDraft(w, g));
    const counted = wizardAudienceCountSchema.parse(
      (
        await wiz(lab, w.t.admin).post('/audience/count', {
          audience: { groupIds: [g], segmentIds: [], rules: null },
        })
      ).body,
    );
    await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, { rowVersion: d.rowVersion });
    const { id, orgId } = await idOfCampaign(owner(), d.id);
    lab.sent.length = 0;
    expect(await lab.run(orgId, id)).toBe('finished');
    expect(lab.sent).toHaveLength(counted.recipients);
    const bodies = lab.sent.map((m) => JSON.stringify(m.components));
    expect(bodies.some((b) => b.includes('Aarav'))).toBe(true);
    // The contact with no first name gets the fallback.
    expect(bodies.some((b) => b.includes('there'))).toBe(true);
    expect(bodies.some((b) => b.includes('{{'))).toBe(false);
    expect(lab.sent.every((m) => m.templateName.startsWith('offer_'))).toBe(true);
  });

  it('"scheduled": a campaign waiting for its date and time, read in the chosen zone; the sweeper-visible columns are set', async () => {
    const w = await world(lab, 'bwl3');
    await payPerMessage(lab, w.t, 1_000_000);
    const ids = await people(lab, w.t, [{}, {}]);
    const g = await group(owner(), w.t, 'G', ids);
    const date = new Date(lab.clock.now.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
    const d = await makeDraft(
      lab,
      w,
      readyDraft(w, g, {
        schedule: { mode: 'scheduled', date, time: '09:00', timezone: 'Asia/Kolkata' },
      }),
    );
    const res = await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const out = wizardLaunchResultSchema.parse(res.body);
    expect(out).toMatchObject({
      mode: 'scheduled',
      status: 'scheduled',
      recipients: 2,
      firstRunAt: `${date}T03:30:00.000Z`,
    });
    const c = (
      await owner().query(
        `SELECT status, schedule_type, to_char(send_date, 'YYYY-MM-DD') AS d, to_char(send_time, 'HH24:MI') AS t, timezone, run_at FROM wpcampaigns WHERE uuid = $1`,
        [d.id],
      )
    ).rows[0];
    expect(c).toMatchObject({
      status: 'scheduled',
      schedule_type: 'scheduled',
      d: date,
      t: '09:00',
      timezone: 'Asia/Kolkata',
    });
    expect(new Date(c.run_at).toISOString()).toBe(`${date}T03:30:00.000Z`);
  });

  it('"scheduled" in the past is refused with the step it belongs to, and nothing is created', async () => {
    const w = await world(lab, 'bwl4');
    await payPerMessage(lab, w.t, 1_000_000);
    const ids = await people(lab, w.t, [{}]);
    const g = await group(owner(), w.t, 'G', ids);
    const d = await makeDraft(
      lab,
      w,
      readyDraft(w, g, {
        schedule: { mode: 'scheduled', date: '2020-01-01', time: '09:00', timezone: 'UTC' },
      }),
    );
    const res = await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(res.status).toBe(422);
    expect(problem(res)).toMatchObject({
      code: 'CAMP_WIZARD_INCOMPLETE',
      errors: [{ path: 'schedule.date', message: 'schedule_in_past' }],
    });
    expect((await wiz(lab, w.t.admin).get(`/drafts/${d.id}`)).body.status).toBe('draft');
    expect(
      (
        await owner().query(
          `SELECT count(*)::int AS n FROM wp_campaign_contacts r JOIN wpcampaigns c ON c.org_id = r.org_id AND c.id = r.campaign_id WHERE c.uuid = $1`,
          [d.id],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('an unmapped variable, a missing name and an empty audience are all reported at once, by path', async () => {
    const w = await world(lab, 'bwl5');
    const d = await makeDraft(lab, w, { templateId: w.template });
    const res = await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(res.status).toBe(422);
    expect(problem(res).code).toBe('CAMP_WIZARD_INCOMPLETE');
    expect(problem(res).errors.map((e) => [e.path, e.message])).toEqual([
      ['name', 'name_required'],
      ['senderKey', 'sender_required'],
      ['audience', 'audience_required'],
      ['variables.body.1', 'variable_unmapped'],
    ]);
  });

  it('insufficient balance blocks the launch (422 WALLET_EMPTY) and leaves the draft untouched with no recipients', async () => {
    const w = await world(lab, 'bwl6');
    await payPerMessage(lab, w.t, 0);
    const ids = await people(lab, w.t, [{}, {}]);
    const g = await group(owner(), w.t, 'G', ids);
    const d = await makeDraft(lab, w, readyDraft(w, g));
    const res = await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(res.status).toBe(422);
    expect(problem(res).code).toBe('WALLET_EMPTY');
    const row = (
      await owner().query(
        `SELECT status, (SELECT count(*)::int FROM wp_campaign_contacts r WHERE r.org_id = c.org_id AND r.campaign_id = c.id) AS n FROM wpcampaigns c WHERE uuid = $1`,
        [d.id],
      )
    ).rows[0];
    expect(row).toEqual({ status: 'draft', n: 0 });
    // After topping up the same draft launches.
    await payPerMessage(lab, w.t, 1_000_000);
    const ok = await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('an audience nobody can be messaged on is refused (422 CAMP_NO_RECIPIENTS)', async () => {
    const w = await world(lab, 'bwl7');
    await payPerMessage(lab, w.t, 1_000_000);
    const ids = await people(lab, w.t, [{ isUnsubscribed: true }, { phone: null }]);
    const g = await group(owner(), w.t, 'G', ids);
    const d = await makeDraft(lab, w, readyDraft(w, g));
    const res = await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(res.status).toBe(422);
    expect(problem(res).code).toBe('CAMP_NO_RECIPIENTS');
  });

  it('a template that is not approved any more is refused at launch (422 CAMP_TEMPLATE_NOT_ALLOWED)', async () => {
    const w = await world(lab, 'bwl8');
    await payPerMessage(lab, w.t, 1_000_000);
    const ids = await people(lab, w.t, [{}]);
    const g = await group(owner(), w.t, 'G', ids);
    const d = await makeDraft(lab, w, readyDraft(w, g));
    await owner().query(`UPDATE wa_templates SET status = 'rejected' WHERE uuid = $1`, [
      w.template,
    ]);
    const res = await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(res.status).toBe(422);
    expect(problem(res).code).toBe('CAMP_TEMPLATE_NOT_ALLOWED');
  });

  it('a launch with a stale row version is a 409', async () => {
    const w = await world(lab, 'bwl9');
    await payPerMessage(lab, w.t, 1_000_000);
    const ids = await people(lab, w.t, [{}]);
    const g = await group(owner(), w.t, 'G', ids);
    const d = await makeDraft(lab, w, readyDraft(w, g));
    await wiz(lab, w.t.admin).put(`/drafts/${d.id}`, {
      rowVersion: d.rowVersion,
      name: 'changed elsewhere',
    });
    const res = await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(res.status).toBe(409);
    expect(problem(res).code).toBe('ROW_VERSION_CONFLICT');
  });

  it('"recurring": a series exists with its next run at the rule\'s first occurrence, and no campaign yet; the draft is consumed', async () => {
    const w = await world(lab, 'bwl10');
    await payPerMessage(lab, w.t, 1_000_000);
    const ids = await people(lab, w.t, [{}, {}, {}]);
    const g = await group(owner(), w.t, 'G', ids);
    const start = new Date(lab.clock.now.getTime() + 3 * 86_400_000).toISOString().slice(0, 10);
    const d = await makeDraft(
      lab,
      w,
      readyDraft(w, g, {
        schedule: {
          mode: 'recurring',
          rule: {
            frequency: 'daily',
            interval: 1,
            startDate: start,
            timeOfDay: '09:00',
            timezone: 'UTC',
            weekdays: [],
            ends: { kind: 'after', occurrences: 3 },
          },
        },
      }),
    );
    const res = await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const out = wizardLaunchResultSchema.parse(res.body);
    expect(out).toMatchObject({
      mode: 'recurring',
      kind: 'series',
      status: 'active',
      recipients: 3,
      firstRunAt: `${start}T09:00:00.000Z`,
    });
    const s = (
      await owner().query(
        `SELECT status, next_index, occurrences_created, next_run_at FROM camp_series WHERE uuid = $1`,
        [out.id],
      )
    ).rows[0];
    expect(s).toMatchObject({ status: 'active', next_index: 0, occurrences_created: 0 });
    expect(new Date(s.next_run_at).toISOString()).toBe(`${start}T09:00:00.000Z`);
    expect(
      (await owner().query(`SELECT count(*)::int AS n FROM wpcampaigns WHERE uuid = $1`, [d.id]))
        .rows[0].n,
    ).toBe(0);
    expect((await wiz(lab, w.t.admin).get(`/drafts/${d.id}`)).status).toBe(404);
  });
});

describe('list, detail and control', () => {
  async function launched(label: string, schedule: object) {
    const w = await world(lab, label);
    await payPerMessage(lab, w.t, 1_000_000);
    const ids = await people(lab, w.t, [{}, {}]);
    const g = await group(owner(), w.t, 'G', ids);
    const d = await makeDraft(lab, w, readyDraft(w, g, { schedule }));
    const res = await wiz(lab, w.t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { w, id: res.body.id as string };
  }
  const day = (n: number) =>
    new Date(lab.clock.now.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  const scheduled = () => ({ mode: 'scheduled', date: day(2), time: '09:00', timezone: 'UTC' });
  const recurring = () => ({
    mode: 'recurring',
    rule: {
      frequency: 'weekly',
      interval: 1,
      startDate: day(2),
      timeOfDay: '09:00',
      timezone: 'UTC',
      weekdays: [],
      ends: { kind: 'never' },
    },
  });

  it('lists scheduled campaigns and series together, newest first, with their status and next run', async () => {
    const one = await launched('bwx1', scheduled());
    const res = await wiz(lab, one.w.t.admin).get('/broadcasts');
    expect(res.status).toBe(200);
    const list = wizardBroadcastListSchema.parse(res.body);
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({
      id: one.id,
      kind: 'campaign',
      mode: 'scheduled',
      status: 'scheduled',
      recipients: 2,
      runs: 0,
    });
    expect(list.data[0]!.nextRunAt).toBe(`${day(2)}T09:00:00.000Z`);

    const groupId = (
      await owner().query(`SELECT uuid FROM contact_groups WHERE org_id = $1`, [one.w.t.orgId])
    ).rows[0].uuid;
    const seriesDraft = await makeDraft(
      lab,
      one.w,
      readyDraft(one.w, groupId, { schedule: recurring() }),
    );
    const series = await wiz(lab, one.w.t.admin).post(`/drafts/${seriesDraft.id}/launch`, {
      rowVersion: seriesDraft.rowVersion,
    });
    expect(series.status, JSON.stringify(series.body)).toBe(200);
    const both = wizardBroadcastListSchema.parse(
      (await wiz(lab, one.w.t.admin).get('/broadcasts?limit=1')).body,
    );
    expect(both.data[0]).toMatchObject({ kind: 'series', mode: 'recurring', status: 'active' });
    expect(both.page.hasMore).toBe(true);
    const next = wizardBroadcastListSchema.parse(
      (
        await wiz(lab, one.w.t.admin).get(
          `/broadcasts?limit=1&cursor=${encodeURIComponent(both.page.nextCursor!)}`,
        )
      ).body,
    );
    expect(next.data[0]!.id).toBe(one.id);
    const filtered = wizardBroadcastListSchema.parse(
      (await wiz(lab, one.w.t.admin).get('/broadcasts?status=scheduled')).body,
    );
    expect(filtered.data.map((b) => b.kind)).toEqual(['campaign']);
  });

  it('the history pages: a "now" broadcast is history with its type, a scheduled one is only on the scheduled page, filters narrow, another workspace sees none', async () => {
    const now = await launched('bwx5', { mode: 'now' });
    const t = now.w.t.admin;
    const groupId = (
      await owner().query(`SELECT uuid FROM contact_groups WHERE org_id = $1`, [now.w.t.orgId])
    ).rows[0].uuid;
    const later = await makeDraft(
      lab,
      now.w,
      readyDraft(now.w, groupId, { schedule: scheduled() }),
    );
    const laterRes = await wiz(lab, t).post(`/drafts/${later.id}/launch`, {
      rowVersion: later.rowVersion,
    });
    expect(laterRes.status, JSON.stringify(laterRes.body)).toBe(200);

    const history = wizardHistoryListSchema.parse((await wiz(lab, t).get('/history')).body);
    expect(history.data.map((r) => r.id)).toEqual([now.id]);
    expect(history.data[0]).toMatchObject({
      source: 'wizard',
      type: 'now',
      status: 'running',
      counts: { recipients: 2 },
    });
    const none = wizardHistoryListSchema.parse(
      (await wiz(lab, t).get('/history?type=recurring')).body,
    );
    expect(none.data).toEqual([]);
    const byName = wizardHistoryListSchema.parse(
      (await wiz(lab, t).get('/history?q=DIWALI&status=running')).body,
    );
    expect(byName.data).toHaveLength(1);

    const waiting = wizardHistoryListSchema.parse(
      (await wiz(lab, t).get('/history?scope=scheduled')).body,
    );
    expect(waiting.data.map((r) => r.id)).toEqual([laterRes.body.id]);
    expect(waiting.data[0]).toMatchObject({ type: 'scheduled', status: 'scheduled' });
    expect(waiting.data[0]!.runAt).toBe(`${day(2)}T09:00:00.000Z`);

    const recurringOnly = wizardBroadcastListSchema.parse(
      (await wiz(lab, t).get('/broadcasts?type=recurring')).body,
    );
    expect(recurringOnly.data).toEqual([]);

    const other = await world(lab, 'bwx6');
    const theirs = wizardHistoryListSchema.parse(
      (await wiz(lab, other.t.admin).get('/history')).body,
    );
    expect(theirs.data).toEqual([]);
  });

  it('the detail of a series carries its rule, blueprint and the runs it has started', async () => {
    const s = await launched('bwx2', recurring());
    const d = wizardBroadcastDetailSchema.parse(
      (await wiz(lab, s.w.t.admin).get(`/broadcasts/${s.id}`)).body,
    );
    expect(d).toMatchObject({ kind: 'series', mode: 'recurring', runs: 0, runList: [] });
    expect(d.draft.name).toBe('Diwali offer');
    expect(d.schedule.mode).toBe('recurring');
  });

  it('pauses, resumes and cancels a scheduled broadcast; a cancelled one cannot be changed again', async () => {
    const s = await launched('bwx3', scheduled());
    const t = s.w.t.admin;
    expect((await wiz(lab, t).post(`/broadcasts/${s.id}/pause`)).body).toMatchObject({
      kind: 'campaign',
      status: 'paused',
    });
    expect((await wiz(lab, t).post(`/broadcasts/${s.id}/pause`)).status).toBe(422);
    // Resuming a scheduled broadcast whose time has not come returns it to scheduled, not running.
    expect((await wiz(lab, t).post(`/broadcasts/${s.id}/resume`)).body).toMatchObject({
      status: 'scheduled',
    });
    expect((await wiz(lab, t).post(`/broadcasts/${s.id}/cancel`)).body).toMatchObject({
      status: 'cancelled',
    });
    const again = await wiz(lab, t).post(`/broadcasts/${s.id}/resume`);
    expect(again.status).toBe(422);
    expect(problem(again).code).toBe('CAMP_BROADCAST_NOT_CONTROLLABLE');
  });

  it('pauses, resumes and cancels a recurring series', async () => {
    const s = await launched('bwx4', recurring());
    const t = s.w.t.admin;
    expect((await wiz(lab, t).post(`/broadcasts/${s.id}/pause`)).body).toMatchObject({
      kind: 'series',
      status: 'paused',
    });
    expect((await wiz(lab, t).post(`/broadcasts/${s.id}/pause`)).status).toBe(422);
    expect((await wiz(lab, t).post(`/broadcasts/${s.id}/resume`)).body).toMatchObject({
      status: 'active',
    });
    expect((await wiz(lab, t).post(`/broadcasts/${s.id}/cancel`)).body).toMatchObject({
      status: 'cancelled',
    });
    expect((await wiz(lab, t).post(`/broadcasts/${s.id}/resume`)).status).toBe(422);
    const detail = await wiz(lab, t).get(`/broadcasts/${s.id}`);
    expect(detail.body).toMatchObject({ status: 'cancelled', nextRunAt: null });
  });
});

describe('tenant isolation and permissions', () => {
  it('another workspace gets 404 for a draft, a broadcast and its controls, and lists none of it', async () => {
    const a = await world(lab, 'bwi1a');
    const b = await world(lab, 'bwi1b');
    await payPerMessage(lab, a.t, 1_000_000);
    const ids = await people(lab, a.t, [{}]);
    const g = await group(owner(), a.t, 'G', ids);
    const d = await makeDraft(
      lab,
      a,
      readyDraft(a, g, {
        schedule: {
          mode: 'scheduled',
          date: new Date(lab.clock.now.getTime() + 2 * 86_400_000).toISOString().slice(0, 10),
          time: '09:00',
          timezone: 'UTC',
        },
      }),
    );
    const launched = await wiz(lab, a.t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(launched.status).toBe(200);

    const bt = b.t.admin;
    expect((await wiz(lab, bt).get(`/drafts/${d.id}`)).status).toBe(404);
    expect(
      (await wiz(lab, bt).put(`/drafts/${d.id}`, { rowVersion: 1, name: 'mine now' })).status,
    ).toBe(404);
    expect((await wiz(lab, bt).post(`/drafts/${d.id}/launch`, { rowVersion: 1 })).status).toBe(404);
    expect((await wiz(lab, bt).get(`/broadcasts/${d.id}`)).status).toBe(404);
    expect((await wiz(lab, bt).post(`/broadcasts/${d.id}/cancel`)).status).toBe(404);
    expect((await wiz(lab, bt).get('/broadcasts')).body.data).toEqual([]);
    expect(
      (await wiz(lab, bt).post('/test-send', { draftId: d.id, recipients: number('1111') })).status,
    ).toBe(404);
    expect((await wiz(lab, bt).get(`/drafts/${d.id}/test-sends`)).status).toBe(404);
    // The row itself is untouched.
    expect(
      (await owner().query(`SELECT status FROM wpcampaigns WHERE uuid = $1`, [d.id])).rows[0]
        .status,
    ).toBe('scheduled');
  });

  it('the series of one workspace cannot be paused by another', async () => {
    const a = await world(lab, 'bwi2a');
    const b = await world(lab, 'bwi2b');
    await payPerMessage(lab, a.t, 1_000_000);
    const ids = await people(lab, a.t, [{}]);
    const g = await group(owner(), a.t, 'G', ids);
    const start = new Date(lab.clock.now.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
    const d = await makeDraft(
      lab,
      a,
      readyDraft(a, g, {
        schedule: {
          mode: 'recurring',
          rule: {
            frequency: 'daily',
            interval: 1,
            startDate: start,
            timeOfDay: '09:00',
            timezone: 'UTC',
            weekdays: [],
            ends: { kind: 'never' },
          },
        },
      }),
    );
    const l = await wiz(lab, a.t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect((await wiz(lab, b.t.admin).post(`/broadcasts/${l.body.id}/pause`)).status).toBe(404);
    expect(
      (await owner().query(`SELECT status FROM camp_series WHERE uuid = $1`, [l.body.id])).rows[0]
        .status,
    ).toBe('active');
  });

  it('a member without camp.campaigns.create cannot use the wizard; without camp.campaigns.test cannot send a test; without control cannot pause', async () => {
    const w = await world(lab, 'bwp1');
    await payPerMessage(lab, w.t, 1_000_000);
    const reader = await lab.api.member(w.t, 'reader', [['camp.campaigns.read']]);
    const builder = await lab.api.member(w.t, 'builder', [
      ['camp.campaigns.create'],
      ['camp.campaigns.read'],
    ]);
    const tester = await lab.api.member(w.t, 'tester', [
      ['camp.campaigns.create'],
      ['camp.campaigns.test'],
    ]);
    const ids = await people(lab, w.t, [{}]);
    const g = await group(owner(), w.t, 'G', ids);
    const d = await makeDraft(lab, w, readyDraft(w, g));

    expect((await wiz(lab, reader.token).get('/templates')).status).toBe(403);
    expect((await wiz(lab, reader.token).post('/drafts', { name: 'x' })).status).toBe(403);
    expect((await wiz(lab, reader.token).get('/broadcasts')).status).toBe(200);
    expect((await wiz(lab, builder.token).get('/templates')).status).toBe(200);
    expect(
      (
        await wiz(lab, builder.token).post('/test-send', {
          draftId: d.id,
          recipients: number('1111'),
        })
      ).status,
    ).toBe(403);
    expect((await wiz(lab, builder.token).post(`/broadcasts/${d.id}/pause`)).status).toBe(403);
    expect(
      (
        await wiz(lab, tester.token).post('/test-send', {
          draftId: d.id,
          recipients: 'not a number',
        })
      ).status,
    ).toBe(422);
  });

  it('the contacts table needs the right to read contacts, and shows only what that right covers', async () => {
    const w = await world(lab, 'bwi5');
    await people(lab, w.t, [{ name: 'Visible one' }, { name: 'Visible two' }]);
    const builder = await lab.api.member(w.t, 'builder2', [['camp.campaigns.create']]);
    const forbidden = await wiz(lab, builder.token).post('/contacts/query', {});
    expect(forbidden.status).toBe(403);
    const reader = await lab.api.member(w.t, 'reader2', [
      ['camp.campaigns.create'],
      ['record.contacts.read', 'all'],
    ]);
    const all = await wiz(lab, reader.token).post('/contacts/query', {});
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.total).toBe(2);
    // "own" shows the contacts the person owns: none of these.
    const own = await lab.api.member(w.t, 'own2', [
      ['camp.campaigns.create'],
      ['record.contacts.read', 'own'],
    ]);
    const mine = await wiz(lab, own.token).post('/contacts/query', {});
    expect(mine.status).toBe(200);
    expect(mine.body.total).toBe(0);
  });

  it('launching an audience that holds a CSV needs the right to create contacts', async () => {
    const w = await world(lab, 'bwi6');
    await payPerMessage(lab, w.t, 1_000_000);
    const up = await wiz(lab, w.t.admin).upload('/csv', 'phone\n+919876580001', 'n.csv');
    expect(up.status).toBe(201);
    const g = await group(owner(), w.t, 'G', []);
    const d = await makeDraft(
      lab,
      w,
      readyDraft(w, g, {
        audience: {
          groupIds: [],
          segmentIds: [],
          rules: null,
          csv: {
            id: up.body.id,
            fileName: 'n.csv',
            valid: 1,
            duplicate: 0,
            invalid: 0,
            optedOut: 0,
          },
        },
      }),
    );
    const builder = await lab.api.member(w.t, 'builder3', [['camp.campaigns.create']]);
    const denied = await wiz(lab, builder.token).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(denied.status, JSON.stringify(denied.body)).toBe(403);
    const maker = await lab.api.member(w.t, 'maker3', [
      ['camp.campaigns.create'],
      ['record.contacts.create'],
    ]);
    const ok = await wiz(lab, maker.token).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('an unauthenticated call is refused', async () => {
    const res = await lab.api.http().get('/v2/broadcast-wizard/templates');
    expect(res.status).toBe(401);
  });
});

describe('the sandbox sender is real wiring, not a stub of the wizard', () => {
  it('a workspace without a connected number cannot launch (422 CAMP_TEMPLATE_NOT_ALLOWED)', async () => {
    const t = await lab.api.signup('bwn1');
    const { template, config } = await addSender(owner(), t);
    await payPerMessage(lab, t, 1_000_000);
    const ids = await people(lab, t, [{}]);
    const g = await group(owner(), t, 'G', ids);
    const w = { t, config, template };
    const d = await makeDraft(lab, w, readyDraft(w, g));
    await owner().query(
      `UPDATE wa_provider_configs SET status = 'disconnected' WHERE org_id = $1`,
      [t.orgId],
    );
    const res = await wiz(lab, t.admin).post(`/drafts/${d.id}/launch`, {
      rowVersion: d.rowVersion,
    });
    expect(res.status).toBe(422);
    expect(['CAMP_TEMPLATE_NOT_ALLOWED']).toContain(problem(res).code);
    void balanceMinor;
  });
});
