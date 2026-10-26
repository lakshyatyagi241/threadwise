import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContactsService } from '../../../src/modules/crm';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { Api, startHarness, type Harness, type Tenant } from './support';

/**
 * The "Web Analytics Information" contact properties (referrer, UTM, device, IP place, channel ...) record how a contact arrived and are
 * not edited by hand. They are flagged read-only by a migration (only those keys, only in the section of that name), and every path that
 * a person or an automation edits a contact through then refuses them: the contact form, the bulk update and the flow steps. A property
 * of another section that happens to share a key (`channel`) stays editable.
 */
let h: Harness;
let api: Api;
let contacts: ContactsService;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  contacts = h.app.get(ContactsService);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const MIGRATION = readFileSync(
  resolve(
    __dirname,
    '../../../../../packages/db/migrations/2029_web_analytics_fields_read_only.sql',
  ),
  'utf8',
);

async function section(t: Tenant, name: string) {
  const res = await api
    .as(t.admin)
    .post('/v2/field-sections')
    .send({ moduleKey: 'contacts', name });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}
async function field(t: Tenant, sectionId: string, key: string) {
  const res = await api
    .as(t.admin)
    .post('/v2/fields')
    .send({ moduleKey: 'contacts', sectionId, key, label: key, fieldType: 'text' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string };
}
const flagOf = async (id: string) =>
  (await h.owner.query(`SELECT is_read_only FROM fields WHERE uuid = $1`, [id])).rows[0]
    .is_read_only as boolean;

describe('Web Analytics Information properties are read-only everywhere', () => {
  let t: Tenant;
  let utm: { id: string };
  let referrer: { id: string };
  let decoy: { id: string };
  let uuid: string;
  let contactId: number;

  beforeAll(async () => {
    t = await api.signup('wa-ro');
    const wa = await section(t, 'Web Analytics Information');
    const other = await section(t, 'Sales');
    utm = await field(t, wa, 'utm_source');
    referrer = await field(t, wa, 'referrer');
    // same key as a web analytics one, but in another section: the workspace's own property
    decoy = await field(t, other, 'channel');
    [uuid] = await api.seedContacts(t, [{ name: 'Visitor', phone: '+919840001000', data: {} }]);
    contactId = Number(
      (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [uuid])).rows[0].id,
    );
  });

  it('the migration flags the properties of that section and only those, and a second run changes nothing', async () => {
    expect(await flagOf(utm.id)).toBe(false);
    await h.owner.query(MIGRATION);
    expect(await flagOf(utm.id)).toBe(true);
    expect(await flagOf(referrer.id)).toBe(true);
    expect(await flagOf(decoy.id)).toBe(false);
    const before = (await h.owner.query(`SELECT row_version FROM fields WHERE uuid = $1`, [utm.id]))
      .rows[0].row_version;
    await h.owner.query(MIGRATION);
    const after = (await h.owner.query(`SELECT row_version FROM fields WHERE uuid = $1`, [utm.id]))
      .rows[0].row_version;
    expect(after).toBe(before);
  });

  it('the contact form (single edit) cannot change one: 422 CON_PROPERTY_NOT_EDITABLE', async () => {
    const rv = (await api.as(t.admin).get(`/v2/contacts/${uuid}`)).body.rowVersion as number;
    const res = await api
      .as(t.admin)
      .patch(`/v2/contacts/${uuid}`)
      .send({ customFields: { utm_source: 'forged' }, rowVersion: rv });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CON_PROPERTY_NOT_EDITABLE');
    const ok = await api
      .as(t.admin)
      .patch(`/v2/contacts/${uuid}`)
      .send({ customFields: { channel: 'Email' }, rowVersion: rv });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('the bulk update cannot change one', async () => {
    const res = await api
      .as(t.admin)
      .post('/v2/contacts/bulk/update')
      .send({ ids: [uuid], values: { customFields: { referrer: 'forged' } } });
    expect(res.status).toBe(422);
    const read = (await api.as(t.admin).get(`/v2/contacts/${uuid}`)).body as {
      customFields: Record<string, unknown>;
    };
    expect(read.customFields.referrer).toBeUndefined();
  });

  it('a flow step cannot write one (the Update contact field step and "save the answer as property"), but can write an editable one', async () => {
    const run = <T>(fn: () => Promise<T>) =>
      RequestContextStore.run(
        { requestId: 'wa-ro', orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
        fn,
      );
    expect(
      await run(() => contacts.setFieldFromFlow(t.orgId, contactId, 'utm_source', 'x')),
    ).toBeNull();
    expect(
      await run(() => contacts.setPropertyFromFlow(t.orgId, contactId, 'utm_source', 'x')),
    ).toBe(false);
    expect(
      await run(() => contacts.setFieldFromFlow(t.orgId, contactId, 'channel', 'WhatsApp')),
    ).toEqual({
      stored: 'WhatsApp',
    });
    const row = (await h.owner.query(`SELECT data FROM contacts WHERE id = $1`, [contactId]))
      .rows[0];
    expect(row.data.utm_source).toBeUndefined();
    expect(row.data.channel).toBeDefined();
  });
});
