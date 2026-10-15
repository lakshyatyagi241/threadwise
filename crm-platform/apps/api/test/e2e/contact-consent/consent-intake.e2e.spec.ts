import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Api,
  addon,
  generateKey,
  installSheets,
  startHarness,
  type Harness,
  type Tenant,
} from '../chrome-extension-sheets-addon/support';
import { tenantWithKey } from '../developer-rest-api-v1/support';

/**
 * Consent at intake, step 1: a subscription status set to `subscribed`, or a consent block, on a contact write needs proof and writes a
 * ledger grant; the status alone never grants. Real Postgres (restricted role, forced RLS), the real app. Spec
 * privacy-and-data-governance 4.3.2.
 */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 300_000);
afterAll(async () => h?.stop());

const events = async (t: Tenant, contactUuid: string) =>
  (
    await h.owner.query(
      `SELECT e.channel, e.action, e.source, e.note, e.evidence
         FROM contact_consent_events e JOIN contacts c ON c.org_id = e.org_id AND c.id = e.contact_id
        WHERE e.org_id = $1 AND c.uuid = $2 ORDER BY e.id`,
      [t.orgId, contactUuid],
    )
  ).rows as Array<{
    channel: string;
    action: string;
    source: string;
    note: string | null;
    evidence: Record<string, string>;
  }>;
const statusOf = async (t: Tenant, uuid: string) =>
  (
    await h.owner.query(
      `SELECT whatsapp_subscription_status AS wa, email_subscription_status AS em, sms_subscription_status AS sms
         FROM contacts WHERE org_id = $1 AND uuid = $2`,
      [t.orgId, uuid],
    )
  ).rows[0] as { wa: string | null; em: string | null; sms: string | null };

describe('manual CRM create and update', () => {
  it('refuses a subscribed status without proof and writes nothing', async () => {
    const t = await api.signup('ci-refuse');
    const res = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'No Proof', phone: '+919811000001', whatsappSubscriptionStatus: 'subscribed' });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code).toBe('CONSENT_NOTE_REQUIRED');
    const n = await h.owner.query(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [
      t.orgId,
    ]);
    expect(n.rows[0].n).toBe(0);
  });

  it('a subscribed status with a note writes a grant with the actor, source, wording, version and time', async () => {
    const t = await api.signup('ci-grant');
    const res = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({
        name: 'With Proof',
        phone: '+919811000002',
        email: 'withproof@example.com',
        whatsappSubscriptionStatus: 'subscribed',
        consent: {
          note: 'Signed the paper form at the expo',
          text: 'I agree to receive offers on WhatsApp.',
          version: '2',
        },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const ev = await events(t, res.body.id);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      channel: 'whatsapp',
      action: 'granted',
      source: 'manual',
      note: 'Signed the paper form at the expo',
    });
    expect(ev[0]!.evidence).toMatchObject({
      consentText: 'I agree to receive offers on WhatsApp.',
      consentVersion: '2',
    });
    expect(ev[0]!.evidence.consentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(ev[0]!.evidence).sort()).toEqual([
      'consentHash',
      'consentText',
      'consentVersion',
    ]);
  });

  it('a consent block alone grants on the channels the contact can be reached on and fills the blank statuses', async () => {
    const t = await api.signup('ci-block');
    const res = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({
        name: 'Block',
        phone: '+919811000003',
        email: 'block@example.com',
        consent: { note: 'Said yes at the counter' },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const ev = await events(t, res.body.id);
    expect(ev.map((e) => e.channel).sort()).toEqual(['email', 'whatsapp']);
    expect(await statusOf(t, res.body.id)).toEqual({ wa: 'subscribed', em: 'subscribed', sms: null });
  });

  it('a contact with no status and no consent block has NO ledger event (nothing is invented)', async () => {
    const t = await api.signup('ci-none');
    const res = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'Plain', phone: '+919811000004' });
    expect(res.status).toBe(201);
    expect(await events(t, res.body.id)).toHaveLength(0);
  });

  it('refuses a grant and an opt-out in the same create', async () => {
    const t = await api.signup('ci-both');
    const res = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({
        name: 'Both',
        phone: '+919811000005',
        isUnsubscribed: true,
        consent: { note: 'Said yes' },
      });
    expect(res.status).toBe(422);
  });

  it('update: a status moving to subscribed needs proof, then writes the grant once', async () => {
    const t = await api.signup('ci-upd');
    const made = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'Upd', phone: '+919811000006' });
    const refused = await api
      .as(t.admin)
      .patch(`/v2/contacts/${made.body.id}`)
      .send({ whatsappSubscriptionStatus: 'subscribed', rowVersion: made.body.rowVersion });
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.code).toBe('CONSENT_NOTE_REQUIRED');

    const ok = await api
      .as(t.admin)
      .patch(`/v2/contacts/${made.body.id}`)
      .send({
        whatsappSubscriptionStatus: 'subscribed',
        consent: { note: 'Phoned and agreed' },
        rowVersion: made.body.rowVersion,
      });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const ev = await events(t, made.body.id);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ channel: 'whatsapp', action: 'granted', source: 'manual' });

    // The same status sent again is not a new agreement.
    const again = await api
      .as(t.admin)
      .patch(`/v2/contacts/${made.body.id}`)
      .send({ whatsappSubscriptionStatus: 'subscribed', name: 'Upd 2', rowVersion: ok.body.rowVersion });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(await events(t, made.body.id)).toHaveLength(1);
  });

  it('a grant never overrides a withdrawal the contact made themselves', async () => {
    const t = await api.signup('ci-withdrawn');
    const [uuid] = await api.seedContacts(t, [
      { name: 'Stopper', phone: '+919811000007', isUnsubscribed: true },
    ]);
    await h.owner.query(
      `INSERT INTO contact_consent_events (org_id, contact_id, channel, purpose, action, source, idempotency_key)
       SELECT org_id, id, 'whatsapp', 'marketing', 'withdrawn', 'keyword', 'k:' || id FROM contacts WHERE uuid = $1`,
      [uuid],
    );
    await h.owner.query(
      `INSERT INTO contact_consent_state (org_id, contact_id, channel, purpose, state, last_event_id, last_occurred_at)
       SELECT e.org_id, e.contact_id, 'whatsapp', 'marketing', 'withdrawn', e.id, e.occurred_at
         FROM contact_consent_events e JOIN contacts c ON c.org_id = e.org_id AND c.id = e.contact_id WHERE c.uuid = $1`,
      [uuid],
    );
    const res = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'Stopper', phone: '+919811000007', consent: { note: 'Filled the form again' } });
    expect(res.status).toBe(201);
    const ev = await events(t, uuid!);
    expect(ev.filter((e) => e.action === 'granted')).toHaveLength(0);
    const st = await h.owner.query(
      `SELECT state FROM contact_consent_state s JOIN contacts c ON c.org_id = s.org_id AND c.id = s.contact_id WHERE c.uuid = $1`,
      [uuid],
    );
    expect(st.rows[0].state).toBe('withdrawn');
  });

  it('a create that matches an existing contact still records the agreement on it', async () => {
    const t = await api.signup('ci-match');
    const known = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'Known', phone: '+919811000008' });
    const uuid = known.body.id as string;
    expect(await events(t, uuid)).toHaveLength(0);
    const res = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({ name: 'Known', phone: '+919811000008', consent: { note: 'Agreed on the call' } });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(uuid);
    expect((await events(t, uuid)).map((e) => e.action)).toEqual(['granted']);
  });

  it('a future date from the caller is clamped to now, so it can never outrank a later STOP', async () => {
    const t = await api.signup('ci-future');
    const res = await api
      .as(t.admin)
      .post('/v2/contacts')
      .send({
        name: 'Future',
        phone: '+919811000009',
        consent: { note: 'Agreed', at: '2999-01-01T00:00:00.000Z' },
      });
    expect(res.status).toBe(201);
    const r = await h.owner.query(
      `SELECT occurred_at FROM contact_consent_events e JOIN contacts c ON c.org_id = e.org_id AND c.id = e.contact_id WHERE c.uuid = $1`,
      [res.body.id],
    );
    expect(new Date(r.rows[0].occurred_at).getTime()).toBeLessThan(Date.now() + 60_000);
  });
});

describe('customer REST API v1', () => {
  it('create with a consent block records source api with the key as evidence; without proof it is refused', async () => {
    const { tenant, call } = await tenantWithKey(api, 'ci-v1');
    const refused = await call.post('/contacts', {
      name: 'V1 No Proof',
      phone: '+919822000001',
      consent: { channels: ['whatsapp'] },
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);

    const ok = await call.post('/contacts', {
      name: 'V1 Proof',
      phone: '+919822000002',
      consent: { note: 'Ticked the box on our checkout', text: 'Send me offers', version: '5' },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const ev = await events(tenant, ok.body.data.id);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ channel: 'whatsapp', action: 'granted', source: 'api' });
    expect(ev[0]!.evidence.apiKeyId).toBeTruthy();
    expect(ev[0]!.evidence.consentVersion).toBe('5');
  });

  it('a plain create (no consent) records nothing, and update with a consent block records a grant', async () => {
    const { tenant, call } = await tenantWithKey(api, 'ci-v1b');
    const made = await call.post('/contacts', { name: 'Plain V1', phone: '+919822000003' });
    expect(made.status).toBe(201);
    expect(await events(tenant, made.body.data.id)).toHaveLength(0);
    const upd = await call.put(`/contacts/${made.body.data.id}`, {
      consent: { note: 'Agreed by email reply' },
    });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect((await events(tenant, made.body.data.id)).map((e) => e.source)).toEqual(['api']);
  });
});

describe('Google Sheets add-on', () => {
  it('a row that says yes needs a note; with the note it grants once, however often the sheet is re-sent', async () => {
    const t = await api.signup('ci-sheets');
    await installSheets(h, t);
    const call = addon(h, await generateKey(api, t.admin));

    const refused = await call.post('/contacts/sync', {
      rows: [{ email: 'sheet1@example.com', consent: 'yes' }],
    });
    expect(refused.body.results[0]).toMatchObject({ status: 'failed' });
    expect(refused.body.results[0].error.field).toBe('consent_note');

    const row = {
      email: 'sheet2@example.com',
      phone: '+919833000001',
      consent: 'yes',
      consent_note: 'Event sign-up sheet, 14 Oct',
    };
    const first = await call.post('/contacts/sync', { rows: [row] });
    expect(first.body.results[0].status, JSON.stringify(first.body)).toBe('created');
    const id = first.body.results[0].id as string;
    const ev = await events(t, id);
    expect(ev.map((e) => e.channel).sort()).toEqual(['email', 'whatsapp']);
    expect(ev[0]).toMatchObject({ source: 'api', action: 'granted' });
    expect(ev[0]!.evidence.reference).toBe('google_sheets');

    await call.post('/contacts/sync', { rows: [row] });
    await call.post('/contacts/sync', { rows: [row] });
    expect(await events(t, id)).toHaveLength(2);
  });

  it('a no or a blank consent cell changes nothing and never withdraws', async () => {
    const t = await api.signup('ci-sheets2');
    await installSheets(h, t);
    const call = addon(h, await generateKey(api, t.admin));
    const res = await call.post('/contacts/sync', {
      rows: [{ email: 'sheet3@example.com', consent: 'no' }, { email: 'sheet4@example.com' }],
    });
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(['created', 'created']);
    const n = await h.owner.query(
      `SELECT count(*)::int AS n FROM contact_consent_events WHERE org_id = $1`,
      [t.orgId],
    );
    expect(n.rows[0].n).toBe(0);
  });
});
