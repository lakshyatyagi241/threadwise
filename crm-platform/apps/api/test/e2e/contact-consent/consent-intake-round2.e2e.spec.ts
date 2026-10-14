import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEAD_INGEST, type LeadIngestPort } from '../../../src/modules/leads/lead-ingest.port';
import {
  LEAD_SOURCE_DIRECTORY,
  type LeadSourceDirectoryPort,
} from '../../../src/modules/leads/lead-source-directory.port';
import { FormsApi, contactDefinition } from '../forms-builder/support';
import { LeadsApi, startHarness, type Harness, type Tenant } from '../leads/support';

/**
 * Consent at intake, round 2 (BL-168..BL-171, privacy spec 4.3.2): lead capture with the sender's proof, the click-to-WhatsApp ad
 * referral, the contact import and the broadcast wizard CSV, and the consent line of web forms. POLICY: a first inbound message permits
 * replying only and never grants marketing; a grant exists only because the person agreed, with the source, the wording and version and
 * the time as evidence. Real Postgres (restricted role, forced RLS), the real app.
 */
let h: Harness;
let api: LeadsApi;

beforeAll(async () => {
  h = await startHarness();
  api = new LeadsApi(h);
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

interface LedgerRow {
  channel: string;
  purpose: string;
  action: string;
  source: string;
  note: string | null;
  evidence: Record<string, string>;
  occurred_at: Date;
  email: string | null;
  phone: string | null;
}

const ledger = async (t: Tenant, where = 'true'): Promise<LedgerRow[]> =>
  (
    await h.owner.query(
      `SELECT e.channel, e.purpose, e.action, e.source, e.note, e.evidence, e.occurred_at, c.email, c.phone
         FROM contact_consent_events e JOIN contacts c ON c.org_id = e.org_id AND c.id = e.contact_id
        WHERE e.org_id = $1 AND ${where} ORDER BY e.channel, e.id`,
      [t.orgId],
    )
  ).rows as LedgerRow[];

const stateOf = async (t: Tenant, phone: string) =>
  (
    await h.owner.query(
      `SELECT s.channel, s.purpose, s.state FROM contact_consent_state s
         JOIN contacts c ON c.org_id = s.org_id AND c.id = s.contact_id
        WHERE s.org_id = $1 AND c.phone = $2 ORDER BY s.channel, s.purpose`,
      [t.orgId, phone],
    )
  ).rows as Array<{ channel: string; purpose: string; state: string }>;

const contactBy = async (t: Tenant, phone: string) =>
  (await h.owner.query(`SELECT * FROM contacts WHERE org_id = $1 AND phone = $2`, [t.orgId, phone]))
    .rows[0] as Record<string, unknown> | undefined;

describe('lead capture (BL-168)', () => {
  const IN = { defaults: { countryCode: '91' } };
  const lead = (n: number, extra: Record<string, unknown> = {}) => ({
    id: `L-${n}`,
    name: `Lead ${n}`,
    phone: `+9198000000${String(n).padStart(2, '0')}`,
    email: `lead${n}@example.com`,
    ...extra,
  });

  it('the generic webhook writes a grant only when the body carries the consent proof, with the proof as evidence', async () => {
    const t = await api.signup('lead-a');
    const src = await api.source(t.admin, { name: 'Landing page', ...IN });
    const when = '2026-10-01T08:00:00.000Z';

    // Without proof, a lead grants nothing.
    expect((await api.hook(src.hookPath, lead(1))).status).toBe(200);
    // With a yes and the wording: whatsapp (phone) and email (address), the time they agreed, the form and the ad.
    const res = await api.hook(
      src.hookPath,
      lead(2, {
        consent: {
          given: 'yes',
          text: 'I agree to receive offers on WhatsApp and email.',
          version: 'lp-3',
          at: when,
          form_id: 'FORM-9',
          ad_id: 'AD-5',
        },
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const rows = await ledger(t);
    expect(rows.map((r) => [r.phone, r.channel, r.purpose, r.action, r.source])).toEqual([
      ['+919800000002', 'email', 'marketing', 'granted', 'lead'],
      ['+919800000002', 'whatsapp', 'marketing', 'granted', 'lead'],
    ]);
    const ev = rows[0]!.evidence;
    expect(ev).toMatchObject({
      consentText: 'I agree to receive offers on WhatsApp and email.',
      consentVersion: 'lp-3',
      leadFormId: 'FORM-9',
      adId: 'AD-5',
      leadSourceId: src.id,
    });
    expect(ev.consentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.occurred_at.toISOString()).toBe(when);
    expect(JSON.stringify(ev)).not.toMatch(/10\.\d+\.\d+\.\d+/); // never an IP address
    // The label follows the proof; lead 1 has nothing.
    expect(await stateOf(t, '+919800000001')).toEqual([]);
    expect(await stateOf(t, '+919800000002')).toEqual([
      { channel: 'email', purpose: 'marketing', state: 'granted' },
      { channel: 'whatsapp', purpose: 'marketing', state: 'granted' },
    ]);
    expect(await contactBy(t, '+919800000002')).toMatchObject({
      whatsapp_subscription_status: 'subscribed',
      email_subscription_status: 'subscribed',
      sms_subscription_status: null,
    });
    expect(await contactBy(t, '+919800000001')).toMatchObject({
      whatsapp_subscription_status: null,
    });
  });

  it('a no, a bare yes, or a yes the sender cannot back up grants nothing', async () => {
    const t = await api.signup('lead-b');
    const src = await api.source(t.admin, { name: 'Landing', ...IN });
    await api.hook(src.hookPath, lead(3, { consent: { given: 'no', text: 'Offers' } }));
    await api.hook(src.hookPath, lead(4, { consent: { given: true } }));
    await api.hook(src.hookPath, lead(5, { consent_given: 'maybe', consent_text: 'Offers' }));
    expect(await ledger(t)).toEqual([]);
    for (const n of [3, 4, 5])
      expect(await stateOf(t, `+9198000000${String(n).padStart(2, '0')}`)).toEqual([]);
    // The leads themselves were created as ever.
    expect((await api.leadEvents(t.orgId)).map((e) => e.status)).toEqual([
      'created',
      'created',
      'created',
    ]);
  });

  it('flat consent_* keys work, sms is granted only when named, and a future date never outranks now', async () => {
    const t = await api.signup('lead-c');
    const src = await api.source(t.admin, { name: 'Form post', ...IN });
    const before = Date.now();
    const res = await api.hook(
      src.hookPath,
      lead(6, {
        consent_given: 'true',
        consent_text: 'Text me offers.',
        consent_channels: 'sms',
        consent_at: '2099-01-01T00:00:00Z',
      }),
    );
    expect(res.status).toBe(200);
    const rows = await ledger(t);
    expect(rows.map((r) => [r.channel, r.action, r.source])).toEqual([['sms', 'granted', 'lead']]);
    expect(rows[0]!.occurred_at.getTime()).toBeLessThanOrEqual(Date.now());
    expect(rows[0]!.occurred_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await contactBy(t, '+919800000006')).toMatchObject({
      sms_subscription_status: 'subscribed',
      whatsapp_subscription_status: null,
    });
  });

  it('a person who opted out is not turned back on by a later lead, and a repeat of the same lead writes once', async () => {
    const t = await api.signup('lead-d');
    const src = await api.source(t.admin, { name: 'Landing', ...IN });
    const body = lead(7, { consent: { given: true, text: 'Offers please', version: '1' } });
    await api.hook(src.hookPath, body);
    // Same lead id again: acknowledged, nothing more is written.
    await api.hook(src.hookPath, body);
    expect(await ledger(t)).toHaveLength(2);

    // The person opts out (STOP): a later lead with a fresh yes does not override it.
    const uuid = (await contactBy(t, '+919800000007'))!.uuid as string;
    for (const channel of ['whatsapp', 'email']) {
      const out = await api
        .as(t.admin)
        .post(`/v2/contact-consent/contacts/${uuid}/events`)
        .send({ channel, action: 'withdrawn', source: 'manual', note: 'asked to stop' });
      expect(out.status, JSON.stringify(out.body)).toBe(201);
    }
    await api.hook(
      src.hookPath,
      lead(7, { id: 'L-7b', consent: { given: true, text: 'Offers again', version: '2' } }),
    );
    const grants = await ledger(t, `e.action = 'granted'`);
    expect(grants).toHaveLength(2);
    expect((await stateOf(t, '+919800000007')).map((s) => s.state)).toEqual([
      'withdrawn',
      'withdrawn',
    ]);
  });

  it('a test lead from the source screen never grants, even when its payload carries consent', async () => {
    const t = await api.signup('lead-e');
    const src = await api.source(t.admin, { name: 'Landing', ...IN });
    const res = await api
      .as(t.admin)
      .post(`/v2/lead-sources/${src.id}/test`)
      .send({
        payload: lead(8, { consent: { given: true, text: 'Offers', version: '1' } }),
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.event).toMatchObject({ isTest: true, status: 'created' });
    expect(await ledger(t)).toEqual([]);
  });

  it('a connector hands the proof through the pipeline port and the grant carries the same evidence', async () => {
    const t = await api.signup('lead-f');
    const ingest = h.app.get<LeadIngestPort>(LEAD_INGEST);
    const directory = h.app.get<LeadSourceDirectoryPort>(LEAD_SOURCE_DIRECTORY);
    const { sourceId } = await directory.ensureConnectorSource(t.orgId, {
      providerKey: 'meta',
      externalRef: 'install-consent',
      name: 'Lead ads',
    });
    const withProof = await ingest.ingest(t.orgId, sourceId, {
      externalId: 'C-1',
      fields: { full_name: 'Ravi', phone_number: '+919811111111', email: 'ravi@example.com' },
      consent: {
        given: true,
        text: 'I agree to be contacted about this offer.',
        version: 'ad-form-4',
        formId: 'F-1',
        adId: 'AD-1',
        channels: ['whatsapp'],
      },
    });
    expect(withProof.status).toBe('created');
    const noProof = await ingest.ingest(t.orgId, sourceId, {
      externalId: 'C-2',
      fields: { full_name: 'Meera', phone_number: '+919822222222' },
    });
    expect(noProof.status).toBe('created');

    const rows = await ledger(t);
    expect(rows.map((r) => [r.phone, r.channel, r.source])).toEqual([
      ['+919811111111', 'whatsapp', 'lead'],
    ]);
    expect(rows[0]!.evidence).toMatchObject({
      consentVersion: 'ad-form-4',
      leadFormId: 'F-1',
      adId: 'AD-1',
    });
    expect(await stateOf(t, '+919822222222')).toEqual([]);
  });
});

describe('contact import (BL-170)', () => {
  const importCsv = (t: Tenant, text: string, options?: Record<string, unknown>) => {
    let req = api
      .as(t.admin)
      .post('/v2/contacts/import')
      .attach('file', Buffer.from(text), 'customers.csv');
    if (options) req = req.field('options', JSON.stringify(options));
    return req;
  };
  const FILE = [
    'name,phone,email,whatsapp consent,sms consent,email consent',
    'Yes All,+919870000001,all@example.com,yes,yes,yes',
    'Yes Wa Only,+919870000002,wa@example.com,yes,no,',
    'Sms No Email Addr,+919870000003,,no,yes,yes',
    'Nothing,+919870000004,none@example.com,no,no,no',
  ].join('\n');
  const NOTICE = {
    consentConfirmed: true,
    consentNoticeText: 'Opted in at the store checkout under privacy notice v3.',
    consentNoticeVersion: 'privacy-v3',
  };

  it('the preview detects the sms and email consent columns and counts them apart', async () => {
    const t = await api.signup('imp-prev');
    const res = await api
      .as(t.admin)
      .post('/v2/contacts/import/preview')
      .attach('file', Buffer.from(FILE), 'customers.csv');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.mapping).toMatchObject({ consent: 3, consentSms: 4, consentEmail: 5 });
    expect(res.body.consent).toMatchObject({ granted: 2, notGranted: 2 });
    expect(res.body.consentSms).toMatchObject({ granted: 2, notGranted: 2 });
    expect(res.body.consentEmail).toMatchObject({ granted: 2, notGranted: 2 });
    expect(await ledger(t)).toEqual([]);
  });

  it('with the confirmation each channel is granted only from its own yes, with the stated notice as proof', async () => {
    const t = await api.signup('imp-conf');
    const res = await importCsv(t, FILE, NOTICE);
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    const rows = await ledger(t, `e.action = 'granted'`);
    expect(rows.map((r) => [r.phone, r.channel])).toEqual([
      ['+919870000001', 'email'],
      ['+919870000001', 'sms'],
      ['+919870000001', 'whatsapp'],
      // sms yes without a whatsapp yes; the email "yes" has no address on the row, so no email grant
      ['+919870000002', 'whatsapp'],
      ['+919870000003', 'sms'],
    ]);
    for (const r of rows) {
      expect(r.source).toBe('import');
      expect(r.evidence).toMatchObject({
        fileName: 'customers.csv',
        consentText: NOTICE.consentNoticeText,
        consentVersion: 'privacy-v3',
      });
      expect(r.evidence.consentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.evidence.reference).toBeTruthy();
      expect(r.note).toMatch(/confirmed consent for this file/);
    }
    // The people who said no everywhere have no record at all.
    expect(await stateOf(t, '+919870000004')).toEqual([]);
  });

  it('without the confirmation the columns record nothing; without a column only WhatsApp is ever granted', async () => {
    const t = await api.signup('imp-none');
    expect((await importCsv(t, FILE)).status).toBeLessThan(300);
    expect(await ledger(t)).toEqual([]);

    const t2 = await api.signup('imp-nocol');
    const plain = ['name,phone,email', 'Plain One,+919870000011,p1@example.com'].join('\n');
    expect((await importCsv(t2, plain, { consentConfirmed: true })).status).toBeLessThan(300);
    const rows = await ledger(t2);
    expect(rows.map((r) => [r.channel, r.action])).toEqual([['whatsapp', 'granted']]);
    // No notice stated: the proof says only that the importer confirmed it, as before.
    expect(rows[0]!.evidence.consentText).toBeUndefined();
    expect(rows[0]!.evidence.fileName).toBe('customers.csv');
  });

  it('a person who opted out is not turned back on by a later file, on any channel', async () => {
    const t = await api.signup('imp-out');
    expect((await importCsv(t, FILE, NOTICE)).status).toBeLessThan(300);
    const uuid = (await contactBy(t, '+919870000001'))!.uuid as string;
    for (const channel of ['whatsapp', 'sms', 'email']) {
      const out = await api
        .as(t.admin)
        .post(`/v2/contact-consent/contacts/${uuid}/events`)
        .send({ channel, action: 'withdrawn', source: 'manual' });
      expect(out.status, JSON.stringify(out.body)).toBe(201);
    }
    expect((await importCsv(t, FILE, NOTICE)).status).toBeLessThan(300);
    const states = await stateOf(t, '+919870000001');
    expect(states.map((s) => s.state)).toEqual(['withdrawn', 'withdrawn', 'withdrawn']);
    // The second run wrote no new grant for the person who opted out (only the three from the first run exist).
    expect(await ledger(t, `e.action = 'granted' AND c.phone = '+919870000001'`)).toHaveLength(3);
  });
});

describe('broadcast wizard CSV (BL-170)', () => {
  const upload = (t: Tenant, text: string, options?: Record<string, unknown>) => {
    let req = api
      .as(t.admin)
      .post('/v2/broadcast-wizard/csv')
      .attach('file', Buffer.from(text), 'numbers.csv');
    if (options) req = req.field('options', JSON.stringify(options));
    return req;
  };
  const services = async () => {
    const { WizardAudienceService } =
      await import('../../../src/modules/campaigns/wizard/wizard-audience.service');
    const { DatabaseService } = await import('../../../src/infra/db/database.service');
    return {
      audience: h.app.get(WizardAudienceService, { strict: false }),
      db: h.app.get(DatabaseService),
    };
  };
  const audienceOf = async (id: string) =>
    (await import('@crm/contracts')).wizardAudienceSchema.parse({
      csv: { id, fileName: 'numbers.csv', valid: 1, duplicate: 0, invalid: 0, optedOut: 0 },
    });
  const setSwitch = async (t: Tenant, on: boolean) => {
    const cur = (await api.as(t.admin).get('/v2/contact-consent/settings')).body as Record<
      string,
      unknown
    >;
    const { rowVersion, updatedAt: _u, ...values } = cur;
    void _u;
    const res = await api
      .as(t.admin)
      .patch('/v2/contact-consent/settings')
      .send({ ...values, requireConsentForMarketing: on, ...(rowVersion ? { rowVersion } : {}) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };
  const mkContact = async (t: Tenant, name: string, phone: string) =>
    (
      await api
        .as(t.admin)
        .post('/v2/contacts')
        .set('idempotency-key', `w-${Math.random()}`)
        .send({ name, phone })
    ).body.id as string;

  it('an upload without the confirmation records no consent, as before', async () => {
    const t = await api.signup('wz-none');
    const res = await upload(t, 'phone,name\n+919880000001,Plain');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ consentConfirmed: false, consentNoticeVersion: null });
    // A notice typed without the confirmation is not kept.
    const res2 = await upload(t, 'phone,name\n+919880000002,Plain', {
      consentNoticeText: 'ignored',
      consentNoticeVersion: 'v9',
    });
    expect(res2.body).toMatchObject({ consentConfirmed: false, consentNoticeVersion: null });
    const kept = await h.owner.query(
      `SELECT consent_notice_text, consent_notice_version FROM camp_wizard_csv WHERE uuid = $1`,
      [res2.body.id],
    );
    expect(kept.rows[0]).toEqual({ consent_notice_text: null, consent_notice_version: null });

    const { audience, db } = await services();
    const aud = await audienceOf(res.body.id);
    await db.txAs({ orgId: t.orgId, userId: null }, (tx) =>
      audience.materializeCsv(tx, t.orgId, aud),
    );
    expect(await contactBy(t, '+919880000001')).toBeTruthy();
    expect(await ledger(t)).toEqual([]);
  });

  it('with the confirmation every number of the file is granted at launch, with the file and notice as proof, once', async () => {
    const t = await api.signup('wz-conf');
    await mkContact(t, 'Existing Eve', '+919880000011');
    const out = await mkContact(t, 'Opted Out Otto', '+919880000012');
    expect(
      (
        await api
          .as(t.admin)
          .post(`/v2/contact-consent/contacts/${out}/events`)
          .send({ channel: 'whatsapp', action: 'withdrawn', source: 'manual' })
      ).status,
    ).toBe(201);
    const res = await upload(
      t,
      'phone,name\n+919880000011,Existing Eve\n+919880000012,Opted Out Otto\n+919880000013,Brand New',
      {
        consentConfirmed: true,
        consentNoticeText: 'They ticked the offers box at the till.',
        consentNoticeVersion: 'till-2',
      },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      consentConfirmed: true,
      consentNoticeVersion: 'till-2',
      newContacts: 1,
    });
    const { audience, db } = await services();
    const tenant = { orgId: t.orgId, userId: null };
    const parsed = await audienceOf(res.body.id);

    // The switch ON: before launch the numbers of the file already count as consented (the grants are written at launch), the
    // opted-out one never does.
    await setSwitch(t, true);
    try {
      const count = await db.txAs(tenant, (tx) => audience.count(tx, t.orgId, parsed));
      expect(count).toMatchObject({ recipients: 2, noConsent: 0, optedOut: 1, newContacts: 1 });

      await db.txAs(tenant, (tx) => audience.materializeCsv(tx, t.orgId, parsed));
      await db.txAs(tenant, (tx) => audience.materializeCsv(tx, t.orgId, parsed)); // a recurring run
      const ids = await db.txAs(tenant, (tx) => audience.recipientIds(tx, t.orgId, parsed, 0, 100));
      expect(ids).toHaveLength(2);
    } finally {
      await setSwitch(t, false);
    }

    const granted = await ledger(t, `e.action = 'granted'`);
    expect(granted.map((r) => [r.phone, r.channel, r.source]).sort()).toEqual([
      ['+919880000011', 'whatsapp', 'import'],
      ['+919880000013', 'whatsapp', 'import'],
    ]);
    expect(granted[0]!.evidence).toMatchObject({
      fileName: 'numbers.csv',
      consentText: 'They ticked the offers box at the till.',
      consentVersion: 'till-2',
    });
    expect(granted[0]!.evidence.reference).toBe(`wizard_csv:${res.body.id}`);
    // The opted-out contact stays opted out.
    expect((await stateOf(t, '+919880000012')).map((s) => s.state)).toEqual(['withdrawn']);
  });

  it('without the confirmation the switch still holds the file back: nothing is counted as consented', async () => {
    const t = await api.signup('wz-sw');
    const res = await upload(t, 'phone,name\n+919880000021,One\n+919880000022,Two');
    const { audience, db } = await services();
    const parsed = await audienceOf(res.body.id);
    await setSwitch(t, true);
    try {
      const count = await db.txAs({ orgId: t.orgId, userId: null }, (tx) =>
        audience.count(tx, t.orgId, parsed),
      );
      expect(count).toMatchObject({ recipients: 0, noConsent: 2 });
    } finally {
      await setSwitch(t, false);
    }
  });

  it('refuses a malformed options field', async () => {
    const t = await api.signup('wz-bad');
    const res = await api
      .as(t.admin)
      .post('/v2/broadcast-wizard/csv')
      .attach('file', Buffer.from('phone\n+919880000031'), 'numbers.csv')
      .field('options', '{not json');
    expect(res.status).toBe(422);
  });
});

describe('web forms (BL-171)', () => {
  let forms: FormsApi;
  let ft: Tenant;
  let n = 0;
  const email = (tag: string) => `${tag}${Date.now()}${n++}@example.test`;
  const live = (consent: Record<string, unknown> | undefined) =>
    forms.liveForm(ft.admin, {
      definition: contactDefinition(consent ? { consent } : {}),
      settings: { rateLimits: { perContactPerHour: 50 } },
    });
  const submitTo = (
    key: string,
    answers: Record<string, unknown>,
    consent?: { given: boolean; textVersion: number },
  ) =>
    forms.submit(key, { answers, ...(consent ? { consent } : {}) }).then((r) => {
      expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
      return r;
    });
  const ledgerOf = async (address: string) =>
    (
      await h.owner.query(
        `SELECT e.channel, e.purpose, e.action, e.source, e.note, e.evidence, e.occurred_at
           FROM contact_consent_events e JOIN contacts c ON c.org_id = e.org_id AND c.id = e.contact_id
          WHERE e.org_id = $1 AND c.email = $2 ORDER BY e.channel, e.purpose, e.id`,
        [ft.orgId, address],
      )
    ).rows as Array<LedgerRow>;
  const PHONE = '+919811112222';

  beforeAll(async () => {
    forms = new FormsApi(h);
    ft = await forms.workspace('frm-consent');
  });

  it('a ticked line that is not marketing is evidence of agreement to service messages only, never a marketing grant', async () => {
    const form = await live({
      enabled: true,
      text: 'I agree to be contacted about my request.',
      required: false,
      marketing: false,
    });
    const a = email('svc');
    await submitTo(form.publicKey, { name: 'Service Sam', email: a, phone: PHONE }, {
      given: true,
      textVersion: 1,
    });
    const rows = await ledgerOf(a);
    expect(rows.map((r) => [r.channel, r.purpose, r.action, r.source])).toEqual([
      ['email', 'utility', 'granted', 'form'],
      ['whatsapp', 'utility', 'granted', 'form'],
    ]);
    expect(rows[0]!.evidence).toMatchObject({
      consentText: 'I agree to be contacted about my request.',
      consentVersion: '1',
      formId: form.id,
    });
    expect(rows[0]!.evidence.consentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.evidence.submissionId).toBeTruthy();
    expect(rows[0]!.note).toMatch(/not marketing/);
    // No marketing state, no subscription label, no opt-in announced.
    const states = (
      await h.owner.query(
        `SELECT s.channel, s.purpose, s.state FROM contact_consent_state s
           JOIN contacts c ON c.org_id = s.org_id AND c.id = s.contact_id
          WHERE s.org_id = $1 AND c.email = $2 ORDER BY s.channel`,
        [ft.orgId, a],
      )
    ).rows;
    expect(states).toEqual([
      { channel: 'email', purpose: 'utility', state: 'granted' },
      { channel: 'whatsapp', purpose: 'utility', state: 'granted' },
    ]);
    const contact = await forms.contactByEmail(ft.orgId, a);
    expect(contact).toMatchObject({
      email_subscription_status: null,
      whatsapp_subscription_status: null,
      sms_subscription_status: null,
    });
    expect(
      (await forms.eventsOfType(ft.orgId, 'contact.opt_in')).filter(
        (e) => JSON.stringify(e.payload).includes(form.id),
      ),
    ).toEqual([]);
  });

  it('an unticked line and a form without a consent line record nothing in the ledger', async () => {
    const optional = await live({
      enabled: true,
      text: 'Contact me about my request.',
      required: false,
      marketing: false,
    });
    const a = email('unt');
    await submitTo(optional.publicKey, { name: 'No Tick', email: a, phone: PHONE }, {
      given: false,
      textVersion: 1,
    });
    expect(await ledgerOf(a)).toEqual([]);
    expect((await forms.submissions(ft.orgId, optional.id)).at(-1)!.consent).toMatchObject({
      given: false,
    });

    const unticked = await live({
      enabled: true,
      text: 'Send me offers.',
      required: false,
      marketing: true,
    });
    const b = email('mkt');
    await submitTo(unticked.publicKey, { name: 'No Offers', email: b }, {
      given: false,
      textVersion: 1,
    });
    expect(await ledgerOf(b)).toEqual([]);

    const plain = await live(undefined);
    const c = email('pln');
    await submitTo(plain.publicKey, { name: 'Plain', email: c, phone: PHONE });
    expect(await ledgerOf(c)).toEqual([]);
  });

  it('a ticked marketing line grants marketing on whatsapp and email, and on sms only when the form says its wording covers sms', async () => {
    const noSms = await live({
      enabled: true,
      text: 'Send me offers.',
      required: false,
      marketing: true,
    });
    const a = email('m1');
    await submitTo(noSms.publicKey, { name: 'Marketing One', email: a, phone: PHONE }, {
      given: true,
      textVersion: 1,
    });
    expect((await ledgerOf(a)).map((r) => [r.channel, r.purpose])).toEqual([
      ['email', 'marketing'],
      ['whatsapp', 'marketing'],
    ]);

    const withSms = await live({
      enabled: true,
      text: 'Send me offers by WhatsApp, SMS or email.',
      required: false,
      marketing: true,
      coversSms: true,
    });
    const b = email('m2');
    await submitTo(withSms.publicKey, { name: 'Marketing Two', email: b, phone: PHONE }, {
      given: true,
      textVersion: 1,
    });
    const rows = await ledgerOf(b);
    expect(rows.map((r) => [r.channel, r.purpose, r.action])).toEqual([
      ['email', 'marketing', 'granted'],
      ['sms', 'marketing', 'granted'],
      ['whatsapp', 'marketing', 'granted'],
    ]);
    expect(rows[1]!.evidence).toMatchObject({
      consentText: 'Send me offers by WhatsApp, SMS or email.',
      formId: withSms.id,
    });
    expect(await forms.contactByEmail(ft.orgId, b)).toMatchObject({
      sms_subscription_status: 'subscribed',
      whatsapp_subscription_status: 'subscribed',
      email_subscription_status: 'subscribed',
    });

    // No phone collected: nothing for sms or whatsapp, whatever the wording covers.
    const c = email('m3');
    await submitTo(withSms.publicKey, { name: 'Marketing Three', email: c }, {
      given: true,
      textVersion: 1,
    });
    expect((await ledgerOf(c)).map((r) => r.channel)).toEqual(['email']);
  });

  it('a non-marketing line that covers sms records the sms service agreement too; a person who stopped service messages is not turned back on', async () => {
    const form = await live({
      enabled: true,
      text: 'Contact me about my request by WhatsApp, SMS or email.',
      required: true,
      marketing: false,
      coversSms: true,
    });
    const a = email('svcsms');
    await submitTo(form.publicKey, { name: 'Service Sms', email: a, phone: PHONE }, {
      given: true,
      textVersion: 1,
    });
    expect((await ledgerOf(a)).map((r) => [r.channel, r.purpose])).toEqual([
      ['email', 'utility'],
      ['sms', 'utility'],
      ['whatsapp', 'utility'],
    ]);

    // They later stop service messages on email; a new submission does not override it.
    const uuid = (await forms.contactByEmail(ft.orgId, a))!.uuid as string;
    const out = await forms
      .as(ft.admin)
      .post(`/v2/contact-consent/contacts/${uuid}/events`)
      .send({ channel: 'email', purpose: 'utility', action: 'withdrawn', source: 'manual' });
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    await submitTo(form.publicKey, { name: 'Service Sms', email: a, phone: PHONE }, {
      given: true,
      textVersion: 1,
    });
    const states = (
      await h.owner.query(
        `SELECT s.channel, s.state FROM contact_consent_state s
           JOIN contacts c ON c.org_id = s.org_id AND c.id = s.contact_id
          WHERE s.org_id = $1 AND c.email = $2 AND s.purpose = 'utility' ORDER BY s.channel`,
        [ft.orgId, a],
      )
    ).rows;
    expect(states).toEqual([
      { channel: 'email', state: 'withdrawn' },
      { channel: 'sms', state: 'granted' },
      { channel: 'whatsapp', state: 'granted' },
    ]);
  });
});
