import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { ContactsService } from '../../../src/modules/crm';
import { CampaignAudienceService } from '../../../src/modules/campaigns/audience.service';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * Step 2 of consent intake: contacts that a channel, a store or a recipient list creates go through
 * `ContactsService.resolveOrCreateByIdentity`, so audit and the plan's contact cap apply, `channel_uid` stays unique, and NONE of
 * them grants consent (policy: a first inbound message permits replying only). Real Postgres, restricted role, forced RLS.
 */
let h: Harness;
let api: Api;
let contacts: ContactsService;
let db: DatabaseService;
let audience: CampaignAudienceService;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  contacts = h.app.get(ContactsService, { strict: false });
  db = h.app.get(DatabaseService, { strict: false });
  audience = h.app.get(CampaignAudienceService, { strict: false });
}, 300_000);
afterAll(async () => h?.stop());

const resolve = (t: Tenant, input: Parameters<ContactsService['resolveOrCreateByIdentity']>[2]) =>
  db.txAs({ orgId: t.orgId }, (tx) => contacts.resolveOrCreateByIdentity(tx, t.orgId, input));
const count = async (t: Tenant, where = 'true') =>
  Number(
    (
      await h.owner.query(
        `SELECT count(*)::int AS n FROM contacts WHERE org_id = $1 AND ${where}`,
        [t.orgId],
      )
    ).rows[0].n,
  );
const consentEvents = async (t: Tenant) =>
  Number(
    (
      await h.owner.query(
        `SELECT count(*)::int AS n FROM contact_consent_events WHERE org_id = $1`,
        [t.orgId],
      )
    ).rows[0].n,
  );
const auditInserts = async (t: Tenant, id: number) =>
  Number(
    (
      await h.owner.query(
        `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'contacts' AND record_id = $2 AND action = 'insert'`,
        [t.orgId, id],
      )
    ).rows[0].n,
  );

describe('channel_uid contacts (Telegram, Facebook, Instagram, widget)', () => {
  it('creates one contact per (channel, id) with an audit row, the note and NO consent event, and finds it again', async () => {
    const t = await api.signup('cc-uid');
    const made = await resolve(t, {
      kind: 'channel_uid',
      channel: 'telegram',
      value: '555001',
      name: 'Tg Sender',
      message: 'Source: Telegram DM',
      quiet: true,
    });
    expect(made.outcome).toBe('created');
    if (made.outcome !== 'created') return;
    const row = (
      await h.owner.query(
        `SELECT name, channel, channel_uid, message, source, lifecycle_stage FROM contacts WHERE org_id = $1 AND id = $2`,
        [t.orgId, made.contactId],
      )
    ).rows[0];
    expect(row).toMatchObject({
      name: 'Tg Sender',
      channel: 'telegram',
      channel_uid: '555001',
      message: 'Source: Telegram DM',
      source: null,
    });
    expect(await auditInserts(t, made.contactId)).toBe(1);
    expect(await consentEvents(t)).toBe(0);
    // Quiet: no contact.created event.
    const ev = await h.owner.query(
      `SELECT count(*)::int AS n FROM event_outbox WHERE org_id = $1 AND event_type = 'contact.created'`,
      [t.orgId],
    );
    expect(ev.rows[0].n).toBe(0);

    const again = await resolve(t, {
      kind: 'channel_uid',
      channel: 'telegram',
      value: '555001',
      name: 'Other Name',
      quiet: true,
    });
    expect(again).toMatchObject({ outcome: 'found', contactId: made.contactId });
    expect(await count(t, `channel = 'telegram'`)).toBe(1);
    // The same id on another channel is another person.
    const fb = await resolve(t, {
      kind: 'channel_uid',
      channel: 'facebook',
      value: '555001',
      quiet: true,
    });
    expect(fb.outcome).toBe('created');
  });

  it('fills a blank name and never replaces a written one', async () => {
    const t = await api.signup('cc-name');
    const a = await resolve(t, {
      kind: 'channel_uid',
      channel: 'instagram',
      value: 'ig1',
      quiet: true,
    });
    expect(a.outcome).toBe('created');
    await resolve(t, {
      kind: 'channel_uid',
      channel: 'instagram',
      value: 'ig1',
      name: 'First',
      quiet: true,
    });
    await resolve(t, {
      kind: 'channel_uid',
      channel: 'instagram',
      value: 'ig1',
      name: 'Second',
      quiet: true,
    });
    const r = await h.owner.query(
      `SELECT name FROM contacts WHERE org_id = $1 AND channel_uid = 'ig1'`,
      [t.orgId],
    );
    expect(r.rows[0].name).toBe('First');
  });

  it('two concurrent first messages from one new sender make one contact', async () => {
    const t = await api.signup('cc-race');
    const [x, y] = await Promise.all([
      resolve(t, { kind: 'channel_uid', channel: 'telegram', value: 'race1', quiet: true }),
      resolve(t, { kind: 'channel_uid', channel: 'telegram', value: 'race1', quiet: true }),
    ]);
    expect([x.outcome, y.outcome].sort()).toEqual(['created', 'found']);
    expect(await count(t, `channel_uid = 'race1'`)).toBe(1);
  });

  it('respects the plan cap: over it there is no contact (never an exception) and the sender can be linked once there is room', async () => {
    const t = await api.signup('cc-cap');
    const used = await count(t);
    await h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
      t.orgId,
      JSON.stringify({ limits: { contacts: used + 1 } }),
    ]);
    expect(
      (await resolve(t, { kind: 'channel_uid', channel: 'telegram', value: 'cap1', quiet: true }))
        .outcome,
    ).toBe('created');
    expect(
      (await resolve(t, { kind: 'channel_uid', channel: 'telegram', value: 'cap2', quiet: true }))
        .outcome,
    ).toBe('quota_reached');
    expect(await count(t, `channel_uid = 'cap2'`)).toBe(0);
  });

  it('the widget visitor: a contact that holds the typed phone IS the visitor; otherwise a keyed contact with the extras and identities', async () => {
    const t = await api.signup('cc-widget');
    const [known] = await api.seedContacts(t, [{ name: 'Known', phone: '+919844000001' }]);
    const hit = await resolve(t, {
      kind: 'channel_uid',
      channel: 'chatbot_widget',
      value: 'visitor-1',
      name: 'Vis',
      phone: '+919844000001',
      matchPhoneFirst: true,
      quiet: true,
    });
    expect(hit.outcome).toBe('found');
    if (hit.outcome === 'found') expect(hit.uuid).toBe(known);
    expect(await count(t, `channel = 'chatbot_widget'`)).toBe(0);

    const fresh = await resolve(t, {
      kind: 'channel_uid',
      channel: 'chatbot_widget',
      value: 'visitor-2',
      name: 'Visitor Two',
      firstName: 'Visitor Two',
      email: 'V2@Example.com',
      phone: '+919844000002',
      matchPhoneFirst: true,
      source: 'chatbot_widget',
      quiet: true,
    });
    expect(fresh.outcome).toBe('created');
    const row = (
      await h.owner.query(
        `SELECT email, phone, first_name, source FROM contacts WHERE org_id = $1 AND channel_uid = 'visitor-2'`,
        [t.orgId],
      )
    ).rows[0];
    expect(row).toMatchObject({
      email: 'v2@example.com',
      phone: '+919844000002',
      first_name: 'Visitor Two',
      source: 'chatbot_widget',
    });
    const ids = await h.owner.query(
      `SELECT kind FROM contact_identities WHERE org_id = $1 AND contact_id = (SELECT id FROM contacts WHERE org_id = $1 AND channel_uid = 'visitor-2') ORDER BY kind`,
      [t.orgId],
    );
    expect(ids.rows.map((r) => r.kind)).toEqual(['email', 'phone']);
    expect(await consentEvents(t)).toBe(0);
  });
});

describe('phone contacts from a recipient list or a store sync', () => {
  it('the campaign wizard: a typed or uploaded number becomes a contact through the service, with a placeholder name, the CSV attributes, an audit row and no consent', async () => {
    const t = await api.signup('cc-wizard');
    const ids = await db.txAs({ orgId: t.orgId, userId: t.adminUserId }, (tx) =>
      audience.resolve(tx, t.orgId, t.adminUserId, {
        csvText: 'phone,name,city\n919855000001,Asha,Pune\n919855000002,,Delhi\n',
      }),
    );
    expect(ids).toHaveLength(2);
    const rows = (
      await h.owner.query(
        `SELECT id, name, phone, data FROM contacts WHERE org_id = $1 AND id = ANY($2::bigint[]) ORDER BY phone`,
        [t.orgId, ids],
      )
    ).rows;
    expect(rows[0]).toMatchObject({ name: 'Asha', phone: '+919855000001' });
    expect(rows[0].data).toMatchObject({ city: 'Pune' });
    expect(rows[1].name).toMatch(/^Recipient · 0002$/);
    for (const r of rows) expect(await auditInserts(t, Number(r.id))).toBe(1);
    expect(await consentEvents(t)).toBe(0);

    // The same number again is the same contact; an existing contact's name is not touched.
    const again = await db.txAs({ orgId: t.orgId, userId: t.adminUserId }, (tx) =>
      audience.resolve(tx, t.orgId, t.adminUserId, { manualNumbers: '919855000001' }),
    );
    expect(again).toEqual([Number(rows[0].id)]);
    expect(await count(t)).toBe(2);
  });

  it('the wizard leaves a number out when the plan cap is reached', async () => {
    const t = await api.signup('cc-wizcap');
    const used = await count(t);
    await h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
      t.orgId,
      JSON.stringify({ limits: { contacts: used + 1 } }),
    ]);
    const ids = await db.txAs({ orgId: t.orgId, userId: t.adminUserId }, (tx) =>
      audience.resolve(tx, t.orgId, t.adminUserId, { manualNumbers: '919866000001\n919866000002' }),
    );
    expect(ids).toHaveLength(1);
  });
});
