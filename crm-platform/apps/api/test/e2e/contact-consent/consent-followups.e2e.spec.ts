import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { wizardAudienceSchema } from '@crm/contracts';
import { startPipeline, until, type Pipeline } from '../chat-conversations/pipeline-support';
import type { Tenant } from '../contacts-attributes-tags/support';

/**
 * Follow-ups of the consent ledger (BL-103): the yes / no consent column of the contact import, the asynchronous export of the proof
 * (built by the worker processor, real Redis queue), and the campaign wizard's recipient list under the consent switch. Real API, real
 * Postgres (restricted role, forced RLS).
 */
let p: Pipeline;
let t: Tenant;

beforeAll(async () => {
  p = await startPipeline(async () => [
    (await import('../../../src/modules/contact-consent/contact-consent-worker.module'))
      .ContactConsentWorkerModule,
  ]);
  t = await p.api.signup('consentf');
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

describe('contact import: a yes / no consent column', () => {
  const importCsv = (text: string, options?: Record<string, unknown>) => {
    let req = p.api
      .as(t.admin)
      .post('/v2/contacts/import')
      .attach('file', Buffer.from(text), 'consent-column.csv');
    if (options) req = req.field('options', JSON.stringify(options));
    return req;
  };
  const ledger = async (phone: string) =>
    (
      await p.h.owner.query(
        `SELECT e.action, e.source FROM contact_consent_events e
         JOIN contacts c ON c.org_id = e.org_id AND c.id = e.contact_id
         WHERE e.org_id = $1 AND c.phone = $2 ORDER BY e.id`,
        [t.orgId, phone],
      )
    ).rows as Array<{ action: string; source: string }>;
  const file = (prefix: string) =>
    [
      'name,phone,marketing consent',
      `Col Yes,${prefix}1,yes`,
      `Col No,${prefix}2,no`,
      `Col Blank,${prefix}3,`,
      `Col Odd,${prefix}4,perhaps`,
      `Col Arabic,${prefix}5,نعم`,
    ].join('\n');

  it('the preview counts yes, no and unknown values and writes nothing', async () => {
    const res = await p.api
      .as(t.admin)
      .post('/v2/contacts/import/preview')
      .attach('file', Buffer.from(file('+91985555000')), 'consent-column.csv');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.mapping.consent).toBe(2);
    expect(res.body.consent).toMatchObject({ granted: 2, notGranted: 2, unrecognised: 1 });
    expect(res.body.consent.unrecognisedSamples).toEqual(['perhaps']);
    expect(await ledger('+919855550001')).toHaveLength(0);
  });

  it('without the confirmation the column records nothing', async () => {
    const res = await importCsv(file('+91985556000'));
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    expect(await ledger('+919855560001')).toHaveLength(0);
  });

  it('with the confirmation only the yes rows are granted', async () => {
    const res = await importCsv(file('+91985557000'), { consentConfirmed: true });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    expect(await ledger('+919855570001')).toEqual([{ action: 'granted', source: 'import' }]);
    expect(await ledger('+919855570005')).toEqual([{ action: 'granted', source: 'import' }]);
    for (const none of ['+919855570002', '+919855570003', '+919855570004']) {
      expect(await ledger(none), none).toHaveLength(0);
    }
  });

  it('with the column unmapped the confirmation covers every contact, as before', async () => {
    const res = await importCsv(file('+91985558000'), {
      consentConfirmed: true,
      mapping: { consent: null },
    });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    expect(await ledger('+919855580002')).toEqual([{ action: 'granted', source: 'import' }]);
  });
});

describe('asynchronous export of the consent proof', () => {
  const exportsUrl = '/v2/contact-consent/exports';
  const request = (token: string) =>
    p.api.as(token).post(exportsUrl).set('idempotency-key', `x-${Math.random()}`).send({});

  it('builds the whole ledger in the worker, lists it, and serves the same CSV as the direct download', async () => {
    const before = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM contact_consent_events WHERE org_id = $1`,
      [t.orgId],
    );
    const n = before.rows[0].n as number;
    expect(n).toBeGreaterThan(0);
    const res = await request(t.admin);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.status).toBe('queued');

    const done = await until('export finished', async () => {
      const list = await p.api.as(t.admin).get(exportsUrl);
      const row = (list.body.data as Array<Record<string, unknown>>).find(
        (e) => e.id === res.body.id,
      );
      return row?.status === 'ready' || row?.status === 'failed' ? row : undefined;
    });
    expect(done.status, JSON.stringify(done)).toBe('ready');
    expect(done.rowCount).toBe(n);
    expect(done.expiresAt).toBeTruthy();

    const list = await p.api.as(t.admin).get(exportsUrl);
    expect(list.body).toMatchObject({ needsAsync: false, ledgerRows: n });

    const file = await p.api.as(t.admin).get(`${exportsUrl}/${res.body.id}/download`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/text\/csv/);
    const lines = String(file.text).trim().split('\r\n');
    expect(lines[0]).toBe(
      'contact_id,channel,purpose,action,source,occurred_at,recorded_at,recorded_by,note,evidence',
    );
    expect(lines).toHaveLength(n + 1);
    const direct = await p.api.as(t.admin).get('/v2/contact-consent/export');
    expect(String(file.text)).toBe(String(direct.text));
  });

  it('is one at a time per workspace, and a finished one can be followed by another', async () => {
    await p.h.owner.query(
      `INSERT INTO contact_consent_exports (org_id, requested_by, status) VALUES ($1, $2, 'running')`,
      [t.orgId, t.adminUserId],
    );
    const busy = await request(t.admin);
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe('CONSENT_EXPORT_IN_PROGRESS');
    await p.h.owner.query(
      `UPDATE contact_consent_exports SET status = 'failed' WHERE org_id = $1 AND status = 'running'`,
      [t.orgId],
    );
    expect((await request(t.admin)).status).toBe(202);
    await until('second export finished', async () => {
      const r = await p.h.owner.query(
        `SELECT 1 FROM contact_consent_exports WHERE org_id = $1 AND status IN ('queued', 'running')`,
        [t.orgId],
      );
      return r.rows.length === 0 ? true : undefined;
    });
  });

  it('needs the manage right, and another workspace cannot list or download it', async () => {
    const reader = await p.api.member(t, 'proofreader', [['contacts.consent.read']]);
    expect((await request(reader.token)).status).toBe(403);
    expect((await p.api.as(reader.token).get(exportsUrl)).status).toBe(403);

    const mine = await p.h.owner.query(
      `SELECT uuid FROM contact_consent_exports WHERE org_id = $1 AND status = 'ready' LIMIT 1`,
      [t.orgId],
    );
    const other = await p.api.signup('consentg');
    const spy = await p.api.as(other.admin).get(`${exportsUrl}/${mine.rows[0].uuid}/download`);
    expect(spy.status).toBe(404);
    expect(((await p.api.as(other.admin).get(exportsUrl)).body.data as unknown[]).length).toBe(0);
  });

  it('a file past its week is refused (409) and the sweep deletes it and marks the export expired', async () => {
    const row = await p.h.owner.query(
      `UPDATE contact_consent_exports SET expires_at = now() - interval '1 day'
       WHERE org_id = $1 AND status = 'ready' RETURNING uuid`,
      [t.orgId],
    );
    const gone = await p.api.as(t.admin).get(`${exportsUrl}/${row.rows[0].uuid}/download`);
    expect(gone.status).toBe(409);
    expect(gone.body.code).toBe('CONSENT_EXPORT_NOT_READY');
    const { ConsentExportSweepService } =
      await import('../../../src/modules/contact-consent/consent-export-sweep.service');
    const out = await p.h.app.get(ConsentExportSweepService, { strict: false }).sweep();
    expect(out.expired).toBeGreaterThanOrEqual(1);
    const after = await p.h.owner.query(
      `SELECT status, file_gz FROM contact_consent_exports WHERE uuid = $1`,
      [row.rows[0].uuid],
    );
    expect(after.rows[0]).toMatchObject({ status: 'expired', file_gz: null });
  });
});

describe('the campaign wizard recipient list honours the consent switch', () => {
  it('with the switch ON only contacts with a recorded grant are listed, counted and sampled', async () => {
    const { WizardAudienceService } =
      await import('../../../src/modules/campaigns/wizard/wizard-audience.service');
    const { DatabaseService } = await import('../../../src/infra/db/database.service');
    const audienceSvc = p.h.app.get(WizardAudienceService, { strict: false });
    const db = p.h.app.get(DatabaseService);
    const mk = async (name: string, phone: string) =>
      (
        await p.api
          .as(t.admin)
          .post('/v2/contacts')
          .set('idempotency-key', `w-${Math.random()}`)
          .send({ name, phone })
      ).body.id as string;
    const none = await mk('Wiz None', '+919866660001');
    const yes = await mk('Wiz Yes', '+919866660002');
    const gone = await mk('Wiz Gone', '+919866660003');
    const rec = (u: string, body: Record<string, unknown>) =>
      p.api
        .as(t.admin)
        .post(`/v2/contact-consent/contacts/${u}/events`)
        .set('idempotency-key', `wr-${Math.random()}`)
        .send(body);
    expect((await rec(yes, { action: 'granted', note: 'form' })).status).toBe(201);
    expect((await rec(gone, { action: 'withdrawn' })).status).toBe(201);
    const audience = wizardAudienceSchema.parse({ contactIds: [none, yes, gone] });
    const tenant = { orgId: t.orgId, userId: null };
    const ids = () =>
      db.txAs(tenant, (tx) => audienceSvc.recipientIds(tx, t.orgId, audience, 0, 100));
    const idOf = async (u: string) =>
      Number((await p.h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [u])).rows[0].id);

    // Off: the contact with no record is listed, the withdrawn one never is.
    expect((await ids()).sort()).toEqual([await idOf(none), await idOf(yes)].sort());

    const setSwitch = async (on: boolean) => {
      const cur = (await p.api.as(t.admin).get('/v2/contact-consent/settings')).body as Record<
        string,
        unknown
      >;
      const { rowVersion, updatedAt: _u, ...values } = cur;
      void _u;
      const res = await p.api
        .as(t.admin)
        .patch('/v2/contact-consent/settings')
        .send({
          ...values,
          requireConsentForMarketing: on,
          ...(rowVersion ? { rowVersion } : {}),
        });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    };
    await setSwitch(true);
    try {
      expect(await ids()).toEqual([await idOf(yes)]);
      const count = await db.txAs(tenant, (tx) => audienceSvc.count(tx, t.orgId, audience));
      expect(count.recipients).toBe(1);
      expect(count.noConsent).toBe(1);
      expect(count.optedOut).toBe(1);
      const sample = await db.txAs(tenant, (tx) => audienceSvc.sample(tx, t.orgId, audience, 10));
      expect(sample.map((s) => s.uuid)).toEqual([yes]);
    } finally {
      await setSwitch(false);
    }
  });
});
