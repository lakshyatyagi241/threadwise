import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
} from '../../../src/kernel/outbox/outbox-subscribers';
import { ContactsService } from '../../../src/modules/crm';
import { LEAD_INGEST, type LeadIngestPort } from '../../../src/modules/leads/lead-ingest.port';
import {
  LEAD_SOURCE_DIRECTORY,
  type LeadSourceDirectoryPort,
} from '../../../src/modules/leads/lead-source-directory.port';
import { LeadNotificationConsumer } from '../../../src/modules/leads/lead-notification.consumer';
import { NotificationsRepository } from '../../../src/modules/notifications/notifications.repository';
import {
  LeadsApi,
  nextIp,
  startHarness,
  type CreatedSource,
  type Harness,
  type Tenant,
} from './support';

/**
 * The lead pipeline end to end (spec L-01..L-10) against a real Postgres and Redis: the public webhook door, the identity-first
 * dedupe, the attribution, the owner rules, the deal, the notification, and the port other domains call. Test names carry the
 * requirement they cover.
 */
let h: Harness;
let api: LeadsApi;
let registry: OutboxSubscriberRegistry;

beforeAll(async () => {
  h = await startHarness();
  api = new LeadsApi(h);
  registry = new OutboxSubscriberRegistry();
  new LeadNotificationConsumer(
    h.app.get(DatabaseService),
    new NotificationsRepository(),
    registry,
  ).onModuleInit();
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

/** What the worker's drain loop does for one workspace: every lead event in the outbox goes to the registry. */
async function deliverLeadEvents(orgId: number): Promise<void> {
  const res = await h.owner.query(
    `SELECT id, org_id, aggregate_module, aggregate_id, event_type, payload FROM event_outbox
     WHERE org_id = $1 AND event_type IN ('lead.created', 'lead.updated') ORDER BY id`,
    [orgId],
  );
  for (const r of res.rows) {
    const event: OutboxEvent = {
      id: String(r.id),
      orgId: Number(r.org_id),
      aggregateModule: r.aggregate_module,
      aggregateId: String(r.aggregate_id),
      eventType: r.event_type,
      payload: r.payload,
    };
    await registry.dispatch(event);
  }
}

const contactCount = async (t: Tenant) =>
  Number(
    (await api.rows(t.orgId, `SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`))[0]!.n,
  );

const ADA = {
  name: 'Ada Lovelace',
  phone: '98765 43210',
  email: 'Ada@Example.com',
  campaign: 'Spring sale',
};
const IN = { defaults: { countryCode: '91' } };

describe('the webhook door and a new lead (L-01, L-02, L-03, L-04)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('door');
  });

  it('L-04 JSON: a lead becomes a contact, with the number in E.164, the platform label and its attribution', async () => {
    const s = await api.source(t.admin, { name: 'Zapier', ...IN });
    const res = await api.hook(s.hookPath, ADA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ ok: true, received: true });

    const [c] = await api.contactsWithPhone(t.orgId, '+919876543210');
    expect(c).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com', source: 'Webhook' });
    const ids = await api.rows(
      t.orgId,
      `SELECT kind, value FROM contact_identities WHERE org_id = $1 AND contact_id = $2 ORDER BY kind`,
      [c!.id],
    );
    expect(ids).toEqual([
      { kind: 'email', value: 'ada@example.com' },
      { kind: 'phone', value: '+919876543210' },
    ]);

    const [ev] = await api.leadEvents(t.orgId, s.id);
    expect(ev).toMatchObject({ status: 'created', is_test: false, reason: null });
    expect(Number(ev!.contact_id)).toBe(Number(c!.id));
    expect(ev!.payload.raw).toMatchObject({ name: 'Ada Lovelace' });

    const attr = await api.rows(
      t.orgId,
      `SELECT * FROM contact_attributions WHERE org_id = $1 AND contact_id = $2`,
      [c!.id],
    );
    expect(attr).toHaveLength(1);
    expect(attr[0]).toMatchObject({
      platform: 'Webhook',
      source_label: 'Webhook',
      campaign: 'Spring sale',
    });
    expect(Number(attr[0]!.lead_event_id)).toBe(Number(ev!.id));
  });

  it('L-04 form: an application/x-www-form-urlencoded body is a lead too', async () => {
    const s = await api.source(t.admin, { name: 'Form post', ...IN });
    const res = await api.hook(
      s.hookPath,
      { name: 'Grace Hopper', mobile: '99887 76655', email: 'grace@example.com' },
      { form: true },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [c] = await api.contactsWithPhone(t.orgId, '+919988776655');
    expect(c).toMatchObject({ name: 'Grace Hopper', email: 'grace@example.com' });
  });

  it("L-04 a nested payload is mapped by its configured paths, and the sender's own id is the idempotency key", async () => {
    const s = await api.source(t.admin, {
      name: 'Nested',
      externalIdPath: 'lead.id',
      mapping: { name: 'lead.contact.full', phone: 'lead.contact.tel', email: 'lead.contact.mail' },
      defaults: { countryCode: '+44', platform: 'Landing page' },
    });
    const body = {
      lead: {
        id: 'LP-1',
        contact: { full: 'Alan Turing', tel: '07700 900123', mail: 'alan@example.com' },
      },
    };
    expect((await api.hook(s.hookPath, body)).status).toBe(200);
    const [c] = await api.contactsWithPhone(t.orgId, '+447700900123');
    expect(c).toMatchObject({ name: 'Alan Turing', source: 'Landing page' });
    const [ev] = await api.leadEvents(t.orgId, s.id);
    expect(ev!.external_id).toBe('LP-1');
  });

  it('L-01 the same (source, id) twice is acknowledged and not repeated', async () => {
    const s = await api.source(t.admin, { name: 'Idem', externalIdPath: 'id', ...IN });
    const before = await contactCount(t);
    const first = await api.hook(s.hookPath, { id: 'X-9', name: 'Once', phone: '90000 11111' });
    const second = await api.hook(s.hookPath, { id: 'X-9', name: 'Once', phone: '90000 11111' });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await contactCount(t)).toBe(before + 1);
    const events = await api.leadEvents(t.orgId, s.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: 'created', duplicate_count: 1 });
    expect(
      await api.rows(
        t.orgId,
        `SELECT 1 FROM contact_attributions WHERE org_id = $1 AND lead_event_id = $2`,
        [events[0]!.id],
      ),
    ).toHaveLength(1);
  });

  it('L-04 without an id path a hash of the body is the id: a retried POST is a duplicate, a different body is not', async () => {
    const s = await api.source(t.admin, { name: 'Hashed', ...IN });
    await api.hook(s.hookPath, { name: 'Hash One', phone: '91111 22222' });
    await api.hook(s.hookPath, { phone: '91111 22222', name: 'Hash One' });
    await api.hook(s.hookPath, { name: 'Hash One', phone: '91111 22222', note: 'second form' });
    const events = await api.leadEvents(t.orgId, s.id);
    expect(events).toHaveLength(2);
    expect(events[0]!.external_id).toMatch(/^h:[0-9a-f]{40}$/);
    expect(events[0]!.duplicate_count).toBe(1);
  });

  it('L-04 the answer never says whether a contact existed, was created or updated, or needs review', async () => {
    const s = await api.source(t.admin, { name: 'Opaque', ...IN });
    const fresh = await api.hook(s.hookPath, { name: 'New Person', phone: '92222 33333' });
    const known = await api.hook(s.hookPath, {
      name: 'New Person',
      phone: '92222 33333',
      again: 1,
    });
    const empty = await api.hook(s.hookPath, { nothing: 'usable' });
    for (const r of [fresh, known, empty]) {
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true, received: true });
    }
    expect(JSON.stringify(known.headers)).not.toMatch(/contact|created|updated/i);
  });

  it('L-04 an unknown, malformed, paused or rotated-away token is the same 404', async () => {
    const s = await api.source(t.admin, { name: 'Gate', ...IN });
    const unknown = await api.hook('/v2/public/lead-hooks/' + 'a'.repeat(43), ADA);
    const malformed = await api.hook('/v2/public/lead-hooks/short', ADA);
    expect(unknown.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect(malformed.body.code).toBe(unknown.body.code);

    const fresh = (await api.as(t.admin).get(`/v2/lead-sources/${s.id}`)).body;
    await api
      .as(t.admin)
      .patch(`/v2/lead-sources/${s.id}`)
      .send({ rowVersion: fresh.rowVersion, status: 'paused' });
    const paused = await api.hook(s.hookPath, ADA);
    expect(paused.status).toBe(404);
    expect(paused.body.code).toBe(unknown.body.code);
    expect(paused.body.detail).toBe(unknown.body.detail);

    const rotated = await api.as(t.admin).post(`/v2/lead-sources/${s.id}/rotate-token`);
    expect(rotated.status, JSON.stringify(rotated.body)).toBe(200);
    expect((await api.hook(s.hookPath, ADA)).status).toBe(404);
  });

  it('L-04 a workspace whose plan no longer has lead sources answers its hooks like an unknown token', async () => {
    const t2 = await api.signup('doorplan');
    const s = await api.source(t2.admin, { name: 'Plan gated', ...IN });
    expect((await api.hook(s.hookPath, { name: 'A', phone: '93333 44444' })).status).toBe(200);
    await api.setOverrides(t2.orgId, { features: { lead_sources: false } });
    const res = await api.hook(s.hookPath, { name: 'B', phone: '94444 55555' });
    expect(res.status).toBe(404);
    expect(await api.contactsWithPhone(t2.orgId, '+919444455555')).toHaveLength(0);
  });

  it('L-04 an optional shared secret: missing or wrong is 401, the right one is accepted, and it is never returned', async () => {
    const s = await api.source(t.admin, { name: 'Secret', secret: 'a-long-shared-secret', ...IN });
    expect(s.hasSecret).toBe(true);
    const lead = { name: 'Secure', phone: '95555 66666' };
    expect((await api.hook(s.hookPath, lead)).status).toBe(401);
    expect(
      (await api.hook(s.hookPath, lead, { headers: { 'x-webhook-secret': 'wrong-secret-value' } }))
        .status,
    ).toBe(401);
    expect(await api.contactsWithPhone(t.orgId, '+919555566666')).toHaveLength(0);
    expect(
      (
        await api.hook(s.hookPath, lead, {
          headers: { 'x-webhook-secret': 'a-long-shared-secret' },
        })
      ).status,
    ).toBe(200);
    expect(await api.contactsWithPhone(t.orgId, '+919555566666')).toHaveLength(1);

    const stored = await api.rows(
      t.orgId,
      `SELECT secret_enc FROM lead_sources WHERE org_id = $1 AND uuid = $2::uuid`,
      [s.id],
    );
    expect(stored[0]!.secret_enc).toMatch(/^v1:/);
    expect(stored[0]!.secret_enc).not.toContain('a-long-shared-secret');
  });

  it('L-04 only JSON objects and forms are accepted, within the body cap', async () => {
    const s = await api.source(t.admin, { name: 'Shapes', ...IN });
    const text = await api
      .http()
      .post(s.hookPath)
      .set('x-forwarded-for', nextIp())
      .set('content-type', 'text/plain')
      .send('hello');
    expect(text.status).toBe(415);
    expect((await api.hook(s.hookPath, [{ name: 'x' }])).status).toBe(422);
    expect((await api.hook(s.hookPath, {})).status).toBe(422);
    const big = await api.hook(s.hookPath, { name: 'x', blob: 'y'.repeat(300_000) });
    expect(big.status).toBe(413);
  });

  it('L-04 per-IP and per-token rate limits answer 429 with a retry hint', async () => {
    const s = await api.source(t.admin, { name: 'Limited', ...IN });
    const ip = '10.99.0.1';
    await h.redis.set(`lead:hook:ip:${ip}`, '120', 'EX', 60);
    const byIp = await api.hook(s.hookPath, ADA, { ip });
    expect(byIp.status).toBe(429);
    expect(byIp.body.code).toBe('RATE_LIMITED');
    expect(byIp.body.errors[0].path).toBe('retryAfterSeconds');

    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(s.token).digest('hex').slice(0, 24);
    await h.redis.set(`lead:hook:token:${hash}`, '600', 'EX', 60);
    const byToken = await api.hook(s.hookPath, ADA, { ip: '10.99.0.2' });
    expect(byToken.status).toBe(429);
    // Another source is untouched by this one's budget.
    const other = await api.source(t.admin, { name: 'Unlimited', ...IN });
    expect(
      (await api.hook(other.hookPath, { name: 'Free', phone: '96666 77777' }, { ip: '10.99.0.3' }))
        .status,
    ).toBe(200);
  });

  it('L-04 a lead through a hook never writes into another workspace, even for the same number', async () => {
    const a = await api.signup('isoa');
    const b = await api.signup('isob');
    const [bContact] = await api.seedContacts(b, [{ name: 'B Person', phone: '+919777788888' }]);
    const sa = await api.source(a.admin, { name: 'A hook', ...IN });
    expect((await api.hook(sa.hookPath, { name: 'A Person', phone: '97777 88888' })).status).toBe(
      200,
    );

    expect(await api.contactsWithPhone(a.orgId, '+919777788888')).toHaveLength(1);
    const bRows = await api.contactsWithPhone(b.orgId, '+919777788888');
    expect(bRows).toHaveLength(1);
    expect(bRows[0]!.uuid).toBe(bContact);
    expect(bRows[0]!.name).toBe('B Person');
    expect(await api.rows(b.orgId, `SELECT 1 FROM lead_events WHERE org_id = $1`)).toHaveLength(0);
    expect(
      await api.rows(b.orgId, `SELECT 1 FROM contact_attributions WHERE org_id = $1`),
    ).toHaveLength(0);
    // B cannot see A's source, its events or its attribution.
    expect((await api.as(b.admin).get(`/v2/lead-sources/${sa.id}`)).status).toBe(404);
    expect((await api.as(b.admin).get(`/v2/lead-sources/${sa.id}/events`)).status).toBe(404);
    expect((await api.as(b.admin).get('/v2/lead-sources')).body.data).toEqual([]);
  });
});

describe('dedupe and update (L-02)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('dedupe');
  });

  it('L-02 a lead whose phone matches an existing contact updates it: blanks filled, nothing curated overwritten, a new attribution', async () => {
    const s = await api.source(t.admin, { name: 'By phone', mapping: { customFields: {} }, ...IN });
    const owner = await api.member(t, 'ownerp', []);
    const made = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({
        name: 'Curated Name',
        phone: '+919120000001',
        ownerId: await api.userUuidById(owner.userId),
        source: 'import',
      });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const before = await contactCount(t);

    const res = await api.hook(s.hookPath, {
      name: 'Different Name',
      phone: '91200 00001',
      email: 'filled@example.com',
    });
    expect(res.status).toBe(200);
    expect(await contactCount(t)).toBe(before);

    const [c] = await api.contactsWithPhone(t.orgId, '+919120000001');
    expect(c).toMatchObject({
      name: 'Curated Name',
      email: 'filled@example.com',
      source: 'import',
    });
    expect(Number(c!.owner_id)).toBe(owner.userId);
    const [ev] = await api.leadEvents(t.orgId, s.id);
    expect(ev!.status).toBe('updated');
    const attrs = await api.rows(
      t.orgId,
      `SELECT * FROM contact_attributions WHERE org_id = $1 AND contact_id = $2`,
      [c!.id],
    );
    expect(attrs).toHaveLength(1);
    // The email the lead brought is now an identity: the next lead with only that address finds the same contact.
    const again = await api.hook(s.hookPath, { name: 'Mail only', email: 'filled@example.com' });
    expect(again.status).toBe(200);
    expect(await contactCount(t)).toBe(before);
    expect(
      await api.rows(
        t.orgId,
        `SELECT 1 FROM contact_attributions WHERE org_id = $1 AND contact_id = $2`,
        [c!.id],
      ),
    ).toHaveLength(2);
  });

  it('L-02 a lead whose email matches an existing contact updates it (identity first), and fills its missing phone', async () => {
    const s = await api.source(t.admin, { name: 'By email', ...IN });
    const made = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'Email Person', email: 'known@example.com' });
    expect(made.status).toBe(201);
    const before = await contactCount(t);
    await api.hook(s.hookPath, {
      email: 'Known@Example.com',
      phone: '93000 00002',
      campaign: 'C2',
    });
    expect(await contactCount(t)).toBe(before);
    const [c] = await api.contactsWithPhone(t.orgId, '+919300000002');
    expect(c).toMatchObject({ name: 'Email Person', email: 'known@example.com' });
    const [ev] = await api.leadEvents(t.orgId, s.id);
    expect(ev!.status).toBe('updated');
  });

  it('L-02 a contact that predates identities (stored number only) is still found, not duplicated', async () => {
    const s = await api.source(t.admin, { name: 'Legacy', ...IN });
    await api.seedContacts(t, [{ name: 'Legacy Person', phone: '+919400000003' }]);
    const before = await contactCount(t);
    await api.hook(s.hookPath, { name: 'Lead Name', phone: '94000 00003' });
    expect(await contactCount(t)).toBe(before);
    expect((await api.leadEvents(t.orgId, s.id))[0]!.status).toBe('updated');
  });

  it('L-02 an email and a phone that belong to two different contacts: the lead joins one, steals nothing, and says so', async () => {
    const s = await api.source(t.admin, { name: 'Conflict', ...IN });
    await api.as(t.admin).post('/v2/contacts').send({ name: 'Holder A', phone: '+919500000004' });
    await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'Holder B', email: 'holder-b@example.com' });
    const before = await contactCount(t);
    await api.hook(s.hookPath, { phone: '95000 00004', email: 'holder-b@example.com' });
    expect(await contactCount(t)).toBe(before);
    const [ev] = await api.leadEvents(t.orgId, s.id);
    expect(ev).toMatchObject({ status: 'updated', reason: 'identity_conflict' });
    const [a] = await api.contactsWithPhone(t.orgId, '+919500000004');
    expect(a!.email).toBeNull();
  });

  it('L-03 first and latest touch: two leads from different campaigns are two attributions, oldest first', async () => {
    const s = await api.source(t.admin, { name: 'Touches', ...IN });
    await api.hook(s.hookPath, {
      name: 'Touchy',
      phone: '96000 00005',
      utm_source: 'facebook',
      campaign: 'Launch',
      adset: 'AS-1',
      ad: 'Ad-1',
      form: 'F-1',
    });
    await api.hook(s.hookPath, {
      name: 'Touchy',
      phone: '96000 00005',
      utm_source: 'google',
      campaign: 'Retarget',
    });
    const [c] = await api.contactsWithPhone(t.orgId, '+919600000005');
    const res = await api.as(t.admin).get(`/v2/contacts/${c!.uuid}/attribution`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.first).toMatchObject({
      platform: 'facebook',
      campaign: 'Launch',
      adset: 'AS-1',
      ad: 'Ad-1',
      form: 'F-1',
    });
    expect(res.body.latest).toMatchObject({ platform: 'google', campaign: 'Retarget' });
    expect(res.body.touches.map((x: { campaign: string }) => x.campaign)).toEqual([
      'Retarget',
      'Launch',
    ]);
    expect(res.body.first.leadSourceId).toBe(s.id);
    // contacts.source keeps the first touch's platform label (the free-text column still works).
    expect(c!.source).toBe('facebook');
  });

  it('L-03 a contact that never came through a lead has an empty attribution; another record scope cannot read it', async () => {
    const [plain] = await api.seedContacts(t, [{ name: 'No lead', phone: '+919700000006' }]);
    const res = await api.as(t.admin).get(`/v2/contacts/${plain}/attribution`);
    expect(res.body).toEqual({ first: null, latest: null, touches: [], total: 0 });

    const own = await api.member(t, 'scoped', [['record.contacts.read', 'own']]);
    expect((await api.as(own.token).get(`/v2/contacts/${plain}/attribution`)).status).toBe(404);
    const nobody = await api.member(t, 'nogrant', []);
    expect((await api.as(nobody.token).get(`/v2/contacts/${plain}/attribution`)).status).toBe(403);
  });

  it('L-02 a custom property mapped from the payload is stored in its type, and only for properties that exist', async () => {
    const section = await api
      .as(t.admin)
      .post('/v2/field-sections')
      .send({ moduleKey: 'contacts', name: 'Lead data' });
    expect(section.status, JSON.stringify(section.body)).toBe(201);
    const field = await api.as(t.admin).post('/v2/fields').send({
      moduleKey: 'contacts',
      sectionId: section.body.id,
      key: 'budget',
      label: 'Budget',
      fieldType: 'integer',
    });
    expect(field.status, JSON.stringify(field.body)).toBe(201);
    const bad = await api
      .as(t.admin)
      .post('/v2/lead-sources')
      .send({ name: 'Bad map', mapping: { customFields: { nope: 'x' } } });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('LEAD_MAPPING_INVALID');

    const s = await api.source(t.admin, {
      name: 'Custom',
      mapping: { customFields: { budget: 'Budget (INR)' } },
      ...IN,
    });
    await api.hook(s.hookPath, { name: 'Rich', phone: '98000 00007', 'Budget (INR)': '1,25,000' });
    const [c] = await api.contactsWithPhone(t.orgId, '+919800000007');
    expect(c!.data).toMatchObject({ budget: 125000 });
  });

  it("L-02 the source's lifecycle stage applies to a created contact, and the workspace default otherwise", async () => {
    const st = await api.as(t.admin).post('/v2/status-options').send({
      moduleKey: 'contacts',
      optionGroup: 'lifecycle_stage',
      value: 'ad_lead',
      label: 'Ad lead',
    });
    expect(st.status, JSON.stringify(st.body)).toBe(201);
    const s = await api.source(t.admin, {
      name: 'Staged',
      defaults: { countryCode: '91', lifecycleStage: 'ad_lead' },
    });
    await api.hook(s.hookPath, { name: 'Staged', phone: '98100 00008' });
    const [c] = await api.contactsWithPhone(t.orgId, '+919810000008');
    expect(c!.lifecycle_stage).toBe('ad_lead');
    const bad = await api
      .as(t.admin)
      .post('/v2/lead-sources')
      .send({ name: 'Bad stage', defaults: { lifecycleStage: 'does_not_exist' } });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('LEAD_DEFAULTS_INVALID');
  });

  it('L-10 a created lead emits contact.created with the lead source in the payload; an update emits contact.updated', async () => {
    const s = await api.source(t.admin, {
      name: 'Automation hook',
      defaults: { countryCode: '91', platform: 'Instagram' },
    });
    await api.hook(s.hookPath, { name: 'Flow Person', phone: '98200 00009', campaign: 'Reels' });
    const created = (await api.eventsOfType(t.orgId, 'contact.created')).map((e) => e.payload);
    expect(created.find((p) => p.phone === '+919820000009')).toMatchObject({
      via: 'Instagram',
      leadSource: 'Automation hook',
      leadSourceId: s.id,
      origin: 'lead',
      campaign: 'Reels',
    });
    await api.hook(s.hookPath, {
      name: 'Flow Person',
      phone: '98200 00009',
      email: 'flow@example.com',
    });
    const updated = (await api.eventsOfType(t.orgId, 'contact.updated')).map((e) => e.payload);
    expect(updated.some((p) => p.via === 'lead')).toBe(true);
  });

  it('L-01 the tag WaDesk gave every webhook lead is applied, once, unless the source says no tag', async () => {
    const s = await api.source(t.admin, { name: 'Tagged', ...IN });
    await api.hook(s.hookPath, { name: 'Tag Me', phone: '98300 00010' });
    await api.hook(s.hookPath, { name: 'Tag Me', phone: '98300 00010', again: 1 });
    const [c] = await api.contactsWithPhone(t.orgId, '+919830000010');
    const tags = await api.rows(
      t.orgId,
      `SELECT tg.name FROM contact_tags ct JOIN tags tg ON tg.org_id = ct.org_id AND tg.id = ct.tag_id WHERE ct.org_id = $1 AND ct.contact_id = $2`,
      [c!.id],
    );
    expect(tags).toEqual([{ name: 'Lead' }]);

    const none = await api.source(t.admin, {
      name: 'Untagged',
      defaults: { countryCode: '91', tag: null },
    });
    await api.hook(none.hookPath, { name: 'No Tag', phone: '98400 00011' });
    const [n] = await api.contactsWithPhone(t.orgId, '+919840000011');
    expect(
      await api.rows(t.orgId, `SELECT 1 FROM contact_tags WHERE org_id = $1 AND contact_id = $2`, [
        n!.id,
      ]),
    ).toHaveLength(0);
  });
});

describe('leads that cannot become contacts are kept (L-01, L-02)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('review');
  });

  it('L-01 neither a usable email nor a phone: stored as needs_review with its payload, no contact made', async () => {
    const s = await api.source(t.admin, { name: 'Review', ...IN });
    const before = await contactCount(t);
    expect(
      (await api.hook(s.hookPath, { name: 'Nobody', note: 'no way to reach me' })).status,
    ).toBe(200);
    expect(await contactCount(t)).toBe(before);
    const [ev] = await api.leadEvents(t.orgId, s.id);
    expect(ev).toMatchObject({
      status: 'needs_review',
      reason: 'no_contact_point',
      contact_id: null,
    });
    expect(ev!.payload.raw).toMatchObject({ name: 'Nobody' });
    expect(ev!.error).toMatch(/neither a usable email/i);
    expect(await api.eventsOfType(t.orgId, 'lead.needs_review')).toHaveLength(1);
  });

  it('L-01 a phone that cannot be read, and no email: needs_review with its own reason', async () => {
    const s = await api.source(t.admin, { name: 'Badphone' });
    await api.hook(s.hookPath, { name: 'Local', phone: '98765 43210' });
    const [ev] = await api.leadEvents(t.orgId, s.id);
    expect(ev).toMatchObject({ status: 'needs_review', reason: 'invalid_phone' });
  });

  it('L-17 after the admin fixes the default country code, the lead is retried from its stored payload and becomes a contact', async () => {
    const s = await api.source(t.admin, { name: 'Fixable' });
    await api.hook(s.hookPath, { name: 'Fix Me', phone: '98765 43211' });
    const events = await api.as(t.admin).get(`/v2/lead-sources/${s.id}/events?status=needs_review`);
    expect(events.body.data).toHaveLength(1);
    const eventId = events.body.data[0].id;

    const fresh = (await api.as(t.admin).get(`/v2/lead-sources/${s.id}`)).body;
    expect(fresh.needsAttention).toBe(1);
    const fix = await api
      .as(t.admin)
      .patch(`/v2/lead-sources/${s.id}`)
      .send({ rowVersion: fresh.rowVersion, defaults: { countryCode: '91' } });
    expect(fix.status, JSON.stringify(fix.body)).toBe(200);

    const retry = await api.as(t.admin).post(`/v2/lead-sources/${s.id}/events/${eventId}/retry`);
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body.event).toMatchObject({ status: 'created', attempts: 2, reason: null });
    expect(await api.contactsWithPhone(t.orgId, '+919876543211')).toHaveLength(1);
    expect((await api.as(t.admin).get(`/v2/lead-sources/${s.id}`)).body.needsAttention).toBe(0);

    const again = await api.as(t.admin).post(`/v2/lead-sources/${s.id}/events/${eventId}/retry`);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('LEAD_EVENT_NOT_RETRYABLE');
  });

  it('L-17 a purged payload cannot be retried and says why', async () => {
    const s = await api.source(t.admin, { name: 'Purged' });
    await api.hook(s.hookPath, { nothing: 'usable' });
    const [ev] = await api.leadEvents(t.orgId, s.id);
    await h.owner.query(
      `UPDATE lead_events SET payload = NULL, payload_purged_at = now() WHERE id = $1`,
      [ev!.id],
    );
    const res = await api.as(t.admin).post(`/v2/lead-sources/${s.id}/events/${ev!.uuid}/retry`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LEAD_PAYLOAD_PURGED');
  });

  it('L-02 plan contact quota reached: the lead is stored as needs_review (never dropped) and a retry after an upgrade makes the contact', async () => {
    const q = await api.signup('quota');
    const s = await api.source(q.admin, { name: 'Quota', ...IN });
    await api.seedContacts(q, [
      { name: 'One', phone: '+919010000001' },
      { name: 'Two', phone: '+919010000002' },
    ]);
    await api.setOverrides(q.orgId, { limits: { contacts: 2 } });

    expect((await api.hook(s.hookPath, { name: 'Over', phone: '90100 00003' })).status).toBe(200);
    expect(await contactCount(q)).toBe(2);
    const [ev] = await api.leadEvents(q.orgId, s.id);
    expect(ev).toMatchObject({ status: 'needs_review', reason: 'plan_limit_reached' });
    expect(ev!.error).toMatch(/contact limit/i);
    expect(ev!.payload).not.toBeNull();

    // A lead for a contact that already exists still works at the cap: nothing new is added.
    expect(
      (await api.hook(s.hookPath, { name: 'Over', phone: '90100 00001', again: 1 })).status,
    ).toBe(200);
    expect((await api.leadEvents(q.orgId, s.id))[1]!.status).toBe('updated');

    await api.setOverrides(q.orgId, { limits: { contacts: 10 } });
    const retry = await api.as(q.admin).post(`/v2/lead-sources/${s.id}/events/${ev!.uuid}/retry`);
    expect(retry.body.event.status).toBe('created');
    expect(await contactCount(q)).toBe(3);
  });

  it("L-01 an unexpected error is recorded as failed (with a reason), and the sender's redelivery processes it again", async () => {
    const contacts = h.app.get(ContactsService);
    const spy = vi
      .spyOn(contacts, 'resolveOrCreateByIdentity')
      .mockRejectedValueOnce(new Error('database went away'));
    const body = { id: 'F-1', name: 'Flaky Person', phone: '97000 00001' };
    const flakySource = await api.source(t.admin, {
      name: 'Flaky ids',
      externalIdPath: 'id',
      ...IN,
    });
    expect((await api.hook(flakySource.hookPath, body)).status).toBe(200);
    spy.mockRestore();
    const [failed] = await api.leadEvents(t.orgId, flakySource.id);
    expect(failed).toMatchObject({ status: 'failed', reason: 'internal_error' });
    expect(failed!.error).toContain('database went away');
    expect(await api.eventsOfType(t.orgId, 'lead.failed')).toHaveLength(1);
    expect(await api.contactsWithPhone(t.orgId, '+919700000001')).toHaveLength(0);

    // The same delivery again: a failed event is taken over, not ignored.
    expect((await api.hook(flakySource.hookPath, body)).status).toBe(200);
    const [done] = await api.leadEvents(t.orgId, flakySource.id);
    expect(done).toMatchObject({ status: 'created', attempts: 2, reason: null });
    expect(await api.contactsWithPhone(t.orgId, '+919700000001')).toHaveLength(1);
  });
});

describe('owner, deal and notification (L-07, L-08, L-09)', () => {
  let t: Tenant;
  let ana: { token: string; userId: number; uuid: string };
  let ben: { token: string; userId: number; uuid: string };

  beforeAll(async () => {
    t = await api.signup('own');
    const mk = async (name: string) => {
      const m = await api.member(t, name, [['record.contacts.read']]);
      return { ...m, uuid: await api.userUuidById(m.userId) };
    };
    ana = await mk('ana');
    ben = await mk('ben');
  });

  const owners = async (s: CreatedSource, n: number) => {
    for (let i = 0; i < n; i++) {
      await api.hook(s.hookPath, { name: `RR ${i}`, phone: `9${i}000 0000${i}` });
    }
    const rows = await api.rows(
      t.orgId,
      `SELECT owner_id FROM contacts WHERE org_id = $1 AND name LIKE 'RR %' ORDER BY id DESC LIMIT $2`,
      [n],
    );
    return rows.reverse().map((r) => Number(r.owner_id));
  };

  it('L-07 a fixed owner is assigned to the new contact', async () => {
    const s = await api.source(t.admin, {
      name: 'Fixed',
      defaults: { countryCode: '91', owner: { mode: 'fixed', userIds: [ana.uuid] } },
    });
    await api.hook(s.hookPath, { name: 'Fixed Lead', phone: '98100 11111' });
    const [c] = await api.contactsWithPhone(t.orgId, '+919810011111');
    expect(Number(c!.owner_id)).toBe(ana.userId);
  });

  it('L-07 round robin hands leads to the listed users in turn, skips one who is no longer active, and keeps an existing owner', async () => {
    const s = await api.source(t.admin, {
      name: 'Robin',
      defaults: {
        countryCode: '91',
        owner: { mode: 'round_robin', userIds: [ana.uuid, ben.uuid] },
      },
    });
    expect(await owners(s, 4)).toEqual([ana.userId, ben.userId, ana.userId, ben.userId]);

    await h.owner.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [ben.userId]);
    const next = await api.hook(s.hookPath, { name: 'RR solo', phone: '98200 22222' });
    expect(next.status).toBe(200);
    const [solo] = await api.contactsWithPhone(t.orgId, '+919820022222');
    expect(Number(solo!.owner_id)).toBe(ana.userId);
    await h.owner.query(`UPDATE users SET status = 'active' WHERE id = $1`, [ben.userId]);

    // A returning lead for an owned contact keeps its owner and costs the rotation no turn.
    const before = await api.rows(
      t.orgId,
      `SELECT rr_cursor FROM lead_sources WHERE org_id = $1 AND uuid = $2::uuid`,
      [s.id],
    );
    await api.hook(s.hookPath, { name: 'RR solo', phone: '98200 22222', again: 1 });
    const after = await api.rows(
      t.orgId,
      `SELECT rr_cursor, row_version FROM lead_sources WHERE org_id = $1 AND uuid = $2::uuid`,
      [s.id],
    );
    expect(Number(after[0]!.rr_cursor)).toBe(Number(before[0]!.rr_cursor));
    const [again] = await api.contactsWithPhone(t.orgId, '+919820022222');
    expect(Number(again!.owner_id)).toBe(ana.userId);
  });

  it('L-07 the rotation counter does not bump the version the editor saves against', async () => {
    const s = await api.source(t.admin, {
      name: 'Lockless',
      defaults: {
        countryCode: '91',
        owner: { mode: 'round_robin', userIds: [ana.uuid, ben.uuid] },
      },
    });
    const v = s.rowVersion;
    await api.hook(s.hookPath, { name: 'Lockless 1', phone: '98300 33333' });
    await api.hook(s.hookPath, { name: 'Lockless 2', phone: '98300 33334' });
    const now = (await api.as(t.admin).get(`/v2/lead-sources/${s.id}`)).body;
    expect(now.rowVersion).toBe(v);
    expect(now.lastEventAt).not.toBeNull();
    const save = await api
      .as(t.admin)
      .patch(`/v2/lead-sources/${s.id}`)
      .send({ rowVersion: v, name: 'Lockless renamed' });
    expect(save.status, JSON.stringify(save.body)).toBe(200);
  });

  it('L-08 a deal is created in the chosen pipeline and stage with the new source value, linked to the contact and owned by the assignee', async () => {
    const { pipeline, stage } = await api.defaultPipeline(t.admin);
    const second = Object.values(stage)[1]!;
    const s = await api.source(t.admin, {
      name: 'Deals',
      defaults: {
        countryCode: '91',
        platform: 'Facebook',
        owner: { mode: 'fixed', userIds: [ben.uuid] },
        deal: {
          enabled: true,
          pipelineId: pipeline.id,
          stageId: second.id,
          title: '{{name}} via {{source}}',
        },
      },
    });
    await api.hook(s.hookPath, { name: 'Deal Lead', phone: '98400 44444' });
    const [c] = await api.contactsWithPhone(t.orgId, '+919840044444');
    const deals = await api.rows(
      t.orgId,
      `SELECT d.*, st.uuid AS stage_uuid FROM deals d JOIN pipeline_stages st ON st.org_id = d.org_id AND st.id = d.stage_id WHERE d.org_id = $1 AND d.contact_id = $2`,
      [c!.id],
    );
    expect(deals).toHaveLength(1);
    expect(deals[0]).toMatchObject({
      title: 'Deal Lead via Facebook',
      source: 'lead_ad',
      stage_uuid: second.id,
    });
    expect(Number(deals[0]!.owner_user_id)).toBe(ben.userId);
    const [ev] = await api.leadEvents(t.orgId, s.id);
    expect(Number(ev!.deal_id)).toBe(Number(deals[0]!.id));
    expect(ev!.error).toBeNull();

    // A returning lead for a contact that already has an open deal does not open a second one.
    await api.hook(s.hookPath, { name: 'Deal Lead', phone: '98400 44444', again: 1 });
    expect(
      await api.rows(t.orgId, `SELECT 1 FROM deals WHERE org_id = $1 AND contact_id = $2`, [c!.id]),
    ).toHaveLength(1);
    // The deals list can filter by the new source.
    const list = await api.as(t.admin).get('/v2/deals?source=lead_ad');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.data.map((d: { title: string }) => d.title)).toContain(
      'Deal Lead via Facebook',
    );
  });

  it('L-08 a deal that cannot be made does not undo the lead: the contact exists and the event says why', async () => {
    const t2 = await api.signup('nodeal');
    await api.setOverrides(t2.orgId, { features: { sales_pipeline: false } });
    const s = await api.source(t2.admin, {
      name: 'No pipeline',
      defaults: { countryCode: '91', deal: { enabled: true } },
    });
    await api.hook(s.hookPath, { name: 'Dealless', phone: '98500 55555' });
    expect(await api.contactsWithPhone(t2.orgId, '+919850055555')).toHaveLength(1);
    const [ev] = await api.leadEvents(t2.orgId, s.id);
    expect(ev!.status).toBe('created');
    expect(ev!.deal_id).toBeNull();
    expect(ev!.error).toMatch(/deal_skipped/);
  });

  it('L-09 the owner and the extra users are notified once per lead; redelivery does not repeat it', async () => {
    const t3 = await api.signup('notify');
    const a = await api.member(t3, 'noan', []);
    const b = await api.member(t3, 'nobo', []);
    const au = await api.userUuidById(a.userId);
    const bu = await api.userUuidById(b.userId);
    const s = await api.source(t3.admin, {
      name: 'Notify',
      defaults: {
        countryCode: '91',
        platform: 'LinkedIn',
        owner: { mode: 'fixed', userIds: [au] },
        notify: { owner: true, userIds: [bu] },
      },
    });
    await api.hook(s.hookPath, { name: 'Notify Me', phone: '98600 66666', campaign: 'Q4' });
    await deliverLeadEvents(t3.orgId);
    await deliverLeadEvents(t3.orgId);

    for (const who of [a, b]) {
      const feed = await api.as(who.token).get('/v2/notifications');
      expect(feed.status, JSON.stringify(feed.body)).toBe(200);
      const leads = feed.body.data.filter((n: { type: string }) => n.type === 'new_lead');
      expect(leads).toHaveLength(1);
      expect(leads[0]).toMatchObject({
        title: 'New lead',
        body: 'Notify Me came in from LinkedIn',
      });
      expect(leads[0].link).toMatch(/^\/contacts\/[0-9a-f-]{36}$/);
      expect(leads[0].data).toMatchObject({
        contactName: 'Notify Me',
        platform: 'LinkedIn',
        returning: false,
      });
    }
    // The admin was not named, so was not told.
    const adminFeed = await api.as(t3.admin).get('/v2/notifications');
    expect(adminFeed.body.data.filter((n: { type: string }) => n.type === 'new_lead')).toHaveLength(
      0,
    );

    // A returning lead is a second notification (its own lead event), worded as a returning lead.
    await api.hook(s.hookPath, { name: 'Notify Me', phone: '98600 66666', again: 1 });
    await deliverLeadEvents(t3.orgId);
    const feed2 = await api.as(a.token).get('/v2/notifications');
    const titles = feed2.body.data
      .filter((n: { type: string }) => n.type === 'new_lead')
      .map((n: { title: string }) => n.title);
    expect(titles.sort()).toEqual(['Lead came in again', 'New lead']);
  });

  it('L-09 a lead that needs review is not announced, and neither is one for nobody (no owner, no extra users)', async () => {
    const t4 = await api.signup('quiet');
    const s = await api.source(t4.admin, { name: 'Quiet', defaults: { countryCode: '91' } });
    await api.hook(s.hookPath, { name: 'Unowned', phone: '98700 77777' });
    await api.hook(s.hookPath, { nothing: 'usable' });
    await deliverLeadEvents(t4.orgId);
    expect(
      await api.rows(t4.orgId, `SELECT 1 FROM inbox_notifications WHERE org_id = $1`),
    ).toHaveLength(0);
  });

  it('L-11 a test lead goes through the real pipeline (contact, attribution, owner) but is flagged, quiet and never notifies', async () => {
    const t5 = await api.signup('testlead');
    const a = await api.member(t5, 'tlan', []);
    const au = await api.userUuidById(a.userId);
    const s = await api.source(t5.admin, {
      name: 'Tester',
      mapping: { name: 'who', email: 'mail', phone: 'tel' },
      defaults: { countryCode: '91', owner: { mode: 'fixed', userIds: [au] } },
    });
    const res = await api.as(t5.admin).post(`/v2/lead-sources/${s.id}/test`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.event).toMatchObject({ status: 'created', isTest: true });
    const [c] = await api.rows(t5.orgId, `SELECT * FROM contacts WHERE org_id = $1`);
    expect(c).toMatchObject({ name: 'Test Lead' });
    expect(Number(c!.owner_id)).toBe(a.userId);
    expect(c!.phone).toMatch(/^\+120255501\d\d$/);
    expect(
      await api.rows(t5.orgId, `SELECT 1 FROM contact_attributions WHERE org_id = $1`),
    ).toHaveLength(1);
    // Quiet: no contact.created for a flow to react to, and the notification consumer skips it.
    expect(await api.eventsOfType(t5.orgId, 'contact.created')).toHaveLength(0);
    await deliverLeadEvents(t5.orgId);
    expect(
      await api.rows(t5.orgId, `SELECT 1 FROM inbox_notifications WHERE org_id = $1`),
    ).toHaveLength(0);
    // A test payload of the admin's own choosing is mapped by the source's mapping too.
    const own = await api
      .as(t5.admin)
      .post(`/v2/lead-sources/${s.id}/test`)
      .send({ payload: { who: 'Custom Tester', tel: '98800 88888' } });
    expect(own.body.event.status).toBe('created');
    // Test events are filtered out on request.
    const real = await api.as(t5.admin).get(`/v2/lead-sources/${s.id}/events?isTest=false`);
    expect(real.body.data).toHaveLength(0);
    expect(
      (await api.as(t5.admin).get(`/v2/lead-sources/${s.id}/events?isTest=true`)).body.data,
    ).toHaveLength(2);
  });
});

describe('the port other domains call (L-01, M-06)', () => {
  let t: Tenant;
  let ingest: LeadIngestPort;
  let directory: LeadSourceDirectoryPort;
  beforeAll(async () => {
    t = await api.signup('port');
    ingest = h.app.get<LeadIngestPort>(LEAD_INGEST);
    directory = h.app.get<LeadSourceDirectoryPort>(LEAD_SOURCE_DIRECTORY);
  });

  it('a connector gets one source per reference, idempotently, and ingests through it', async () => {
    const a = await directory.ensureConnectorSource(t.orgId, {
      providerKey: 'IndiaMART',
      externalRef: 'install-1',
      name: 'IndiaMART',
    });
    const b = await directory.ensureConnectorSource(t.orgId, {
      providerKey: 'IndiaMART',
      externalRef: 'install-1',
      name: 'IndiaMART',
    });
    expect(b).toEqual(a);
    const second = await directory.ensureConnectorSource(t.orgId, {
      providerKey: 'IndiaMART',
      externalRef: 'install-2',
      name: 'IndiaMART',
    });
    expect(second.sourceId).not.toBe(a.sourceId);
    const list = await api.as(t.admin).get('/v2/lead-sources');
    expect(list.body.data.map((s: { name: string }) => s.name).sort()).toEqual([
      'IndiaMART',
      'IndiaMART (2)',
    ]);
    expect(list.body.data[0]).toMatchObject({ kind: 'connector', tokenHint: null });

    const lead = {
      externalId: 'IM-100',
      fields: {
        full_name: 'Rahul Verma',
        email: 'rahul@example.in',
        phone_number: '+91 98765 00001',
      },
      attribution: { platform: 'IndiaMART', campaign: 'Buy leads' },
    };
    const r1 = await ingest.ingest(t.orgId, a.sourceId, lead);
    expect(r1).toMatchObject({ status: 'created' });
    expect(typeof r1.contactId).toBe('number');
    const [c] = await api.contactsWithPhone(t.orgId, '+919876500001');
    expect(c).toMatchObject({ name: 'Rahul Verma', source: 'IndiaMART' });
    const attr = await api.rows(
      t.orgId,
      `SELECT * FROM contact_attributions WHERE org_id = $1 AND contact_id = $2`,
      [c!.id],
    );
    expect(attr[0]).toMatchObject({ platform: 'IndiaMART', campaign: 'Buy leads' });

    const r2 = await ingest.ingest(t.orgId, a.sourceId, lead);
    expect(r2).toMatchObject({ status: 'duplicate', contactId: r1.contactId });
    const r3 = await ingest.ingest(t.orgId, a.sourceId, {
      ...lead,
      externalId: 'IM-101',
      fields: { ...lead.fields, full_name: 'Someone Else' },
    });
    expect(r3).toMatchObject({ status: 'updated', contactId: r1.contactId });
    const r4 = await ingest.ingest(t.orgId, a.sourceId, {
      externalId: 'IM-102',
      fields: { note: 'x' },
    });
    expect(r4).toMatchObject({ status: 'needs_review', reason: 'no_contact_point' });
  });

  it('a source that does not exist or is paused is a failed result, never a throw and never a write', async () => {
    expect(
      await ingest.ingest(t.orgId, 999_999, {
        externalId: 'x',
        fields: { phone: '+919999900000' },
      }),
    ).toEqual({
      status: 'failed',
      reason: 'source_not_found',
    });
    const s = await directory.ensureConnectorSource(t.orgId, {
      providerKey: 'JustDial',
      externalRef: 'install-jd',
      name: 'JustDial',
    });
    await h.owner.query(`UPDATE lead_sources SET status = 'paused' WHERE id = $1`, [s.sourceId]);
    expect(
      await ingest.ingest(t.orgId, s.sourceId, {
        externalId: 'y',
        fields: { phone: '+919999900001' },
      }),
    ).toEqual({
      status: 'failed',
      reason: 'source_paused',
    });
    expect(await api.contactsWithPhone(t.orgId, '+919999900001')).toHaveLength(0);
  });

  it("the tenant is the caller's, never the payload's: another workspace's source id is not found", async () => {
    const other = await api.signup('portx');
    const mine = await directory.ensureConnectorSource(t.orgId, {
      providerKey: 'Housing',
      externalRef: 'install-h',
      name: 'Housing',
    });
    const res = await ingest.ingest(other.orgId, mine.sourceId, {
      externalId: 'z',
      fields: { phone: '+919999900002' },
    });
    expect(res).toEqual({ status: 'failed', reason: 'source_not_found' });
    expect(await api.contactsWithPhone(other.orgId, '+919999900002')).toHaveLength(0);
    expect(await api.contactsWithPhone(t.orgId, '+919999900002')).toHaveLength(0);
  });

  it('a connector source counts toward the plan cap, and releasing it deletes it with its events', async () => {
    const p = await api.signup('portcap');
    await api.setOverrides(p.orgId, { limits: { lead_sources: 1 } });
    const first = await directory.ensureConnectorSource(p.orgId, {
      providerKey: 'A',
      externalRef: 'r1',
      name: 'A',
    });
    await expect(
      directory.ensureConnectorSource(p.orgId, { providerKey: 'B', externalRef: 'r2', name: 'B' }),
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    // The one it has is still returned at the cap.
    expect(
      await directory.ensureConnectorSource(p.orgId, {
        providerKey: 'A',
        externalRef: 'r1',
        name: 'A',
      }),
    ).toEqual(first);
    await ingest.ingest(p.orgId, first.sourceId, {
      externalId: 'e1',
      fields: { phone: '+919999900003' },
    });
    await directory.releaseConnectorSource(p.orgId, 'r1');
    expect(await api.rows(p.orgId, `SELECT 1 FROM lead_sources WHERE org_id = $1`)).toHaveLength(0);
    expect(await api.rows(p.orgId, `SELECT 1 FROM lead_events WHERE org_id = $1`)).toHaveLength(0);
    // The contact it made stays, and its attribution stays with it (the source link is simply cleared).
    expect(await api.contactsWithPhone(p.orgId, '+919999900003')).toHaveLength(1);
    expect(
      await api.rows(
        p.orgId,
        `SELECT source_id, lead_event_id FROM contact_attributions WHERE org_id = $1`,
      ),
    ).toEqual([{ source_id: null, lead_event_id: null }]);
    await directory.releaseConnectorSource(p.orgId, 'r1');
  });
});

describe('robustness of the door (L-01, L-04)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('robust');
  });

  it('L-01 the same lead delivered five times at once is one contact and one event; the rest are acknowledged duplicates', async () => {
    const s = await api.source(t.admin, { name: 'Parallel same', externalIdPath: 'id', ...IN });
    const before = await contactCount(t);
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        api.hook(s.hookPath, { id: 'P-1', name: 'Parallel', phone: '98100 70001' }),
      ),
    );
    for (const r of responses) expect(r.status).toBe(200);
    expect(await contactCount(t)).toBe(before + 1);
    const events = await api.leadEvents(t.orgId, s.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: 'created', duplicate_count: 4 });
    expect(
      await api.rows(
        t.orgId,
        `SELECT 1 FROM contact_attributions WHERE org_id = $1 AND lead_event_id = $2`,
        [events[0]!.id],
      ),
    ).toHaveLength(1);
  });

  it('L-02 five different leads for one new phone number at once make one contact: one created, four updated, five attributions', async () => {
    const s = await api.source(t.admin, {
      name: 'Parallel same phone',
      externalIdPath: 'id',
      ...IN,
    });
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        api.hook(s.hookPath, {
          id: `Q-${i}`,
          name: 'Same Person',
          phone: '98100 70002',
          ad: `Ad ${i}`,
        }),
      ),
    );
    for (const r of responses) expect(r.status).toBe(200);
    const contacts = await api.contactsWithPhone(t.orgId, '+919810070002');
    expect(contacts).toHaveLength(1);
    const statuses = (await api.leadEvents(t.orgId, s.id)).map((e) => e.status).sort();
    expect(statuses).toEqual(['created', 'updated', 'updated', 'updated', 'updated']);
    expect(
      await api.rows(
        t.orgId,
        `SELECT 1 FROM contact_attributions WHERE org_id = $1 AND contact_id = $2`,
        [contacts[0]!.id],
      ),
    ).toHaveLength(5);
    // The identity is single: one phone row for the contact.
    expect(
      await api.rows(
        t.orgId,
        `SELECT 1 FROM contact_identities WHERE org_id = $1 AND kind = 'phone' AND value = '+919810070002'`,
      ),
    ).toHaveLength(1);
  });

  it('L-07 round robin under load hands each user the same number of leads', async () => {
    const a = await api.member(t, 'rra', []);
    const b = await api.member(t, 'rrb', []);
    const s = await api.source(t.admin, {
      name: 'Parallel robin',
      defaults: {
        countryCode: '91',
        owner: {
          mode: 'round_robin',
          userIds: [await api.userUuidById(a.userId), await api.userUuidById(b.userId)],
        },
      },
    });
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        api.hook(s.hookPath, { name: `Load ${i}`, phone: `98200 7000${i}` }),
      ),
    );
    const counts = await api.rows(
      t.orgId,
      `SELECT owner_id, count(*)::int AS n FROM contacts WHERE org_id = $1 AND name LIKE 'Load %' GROUP BY owner_id ORDER BY owner_id`,
    );
    expect(counts.map((c) => c.n)).toEqual([4, 4]);
  });

  it('L-02 a lead with only an email makes a contact with an email identity and no phone', async () => {
    const s = await api.source(t.admin, { name: 'Email only', ...IN });
    await api.hook(s.hookPath, { name: 'Mail Person', email: 'mail.only@example.com' });
    const [c] = await api.rows(
      t.orgId,
      `SELECT * FROM contacts WHERE org_id = $1 AND email = 'mail.only@example.com'`,
    );
    expect(c).toMatchObject({ name: 'Mail Person', phone: null });
    expect(
      await api.rows(
        t.orgId,
        `SELECT kind FROM contact_identities WHERE org_id = $1 AND contact_id = $2`,
        [c!.id],
      ),
    ).toEqual([{ kind: 'email' }]);
  });

  it('L-04 a body that carries a NUL character, which Postgres refuses, is stored with it removed, not failed', async () => {
    const s = await api.source(t.admin, { name: 'Nul', ...IN });
    const res = await api
      .http()
      .post(s.hookPath)
      .set('x-forwarded-for', nextIp())
      .set('content-type', 'application/json')
      .send('{"name":"Nu\\u0000l Person","phone":"98300 70001","note":"a\\u0000b"}');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [c] = await api.contactsWithPhone(t.orgId, '+919830070001');
    expect(c!.name).toBe('Nul Person');
    const [ev] = await api.leadEvents(t.orgId, s.id);
    expect(ev!.status).toBe('created');
    expect(ev!.payload.raw.note).toBe('ab');
  });

  it('L-04 an unusual but valid body (deep nesting, unicode, a very long value) is accepted and bounded', async () => {
    const s = await api.source(t.admin, { name: 'Odd', ...IN });
    let deep: Record<string, unknown> = { phone: '98400 70001', name: 'Zoë 山田' };
    for (let i = 0; i < 20; i++) deep = { wrap: deep };
    const res = await api.hook(s.hookPath, {
      name: 'Zoë 山田',
      phone: '98400 70001',
      long: 'x'.repeat(50_000),
      deep,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [c] = await api.contactsWithPhone(t.orgId, '+919840070001');
    expect(c!.name).toBe('Zoë 山田');
  });
});
