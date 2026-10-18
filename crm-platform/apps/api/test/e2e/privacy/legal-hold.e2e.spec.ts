import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type Pipeline } from '../chat-conversations/pipeline-support';
import type { Tenant } from '../contacts-attributes-tags/support';
import { ConsentGate } from '../../../src/modules/contact-consent/consent-gate.service';
import { LegalHoldMaintenanceService } from '../../../src/modules/privacy/legal-holds/legal-hold-maintenance.service';

/**
 * BL-295: legal hold end to end on a real API, real Postgres (restricted role, forced RLS) and the real worker services. A person's
 * erasure is asked for while the business must keep the data: the erasure is not executed, the case is "restricted", marketing and AI
 * are refused, a delete is a 409, and when the hold is released the confirmed erasure runs by itself. Nothing in this file changes
 * behaviour for a workspace that has no hold.
 */
let p: Pipeline;
let a: Tenant;
let b: Tenant;
let seq = 0;

const q = async (sql: string, params: unknown[] = []) => (await p.h.owner.query(sql, params)).rows;
const n = async (sql: string, params: unknown[] = []) => Number((await q(sql, params))[0]?.n ?? 0);

async function person(t: Tenant, name = 'Rita Sharma') {
  seq += 1;
  const phone = `+9198123${String(40000 + seq)}`;
  const [uuid] = await p.api.seedContacts(t, [
    { name: `${name} ${seq}`, phone, email: `p${seq}@example.test` },
  ]);
  const id = Number((await q(`SELECT id FROM contacts WHERE uuid = $1`, [uuid]))[0].id);
  return { uuid: uuid!, id, phone, name: `${name} ${seq}` };
}

const place = (t: Tenant, body: Record<string, unknown>, token = t.admin, key?: string) => {
  const req = p.api.as(token).post('/v2/privacy/legal-holds');
  return (key ? req.set('idempotency-key', key) : req.set('idempotency-key', `lh-${++seq}`)).send({
    reasonCategory: 'legal_claim',
    caseRef: `CASE-${seq}`,
    ...body,
  });
};

const erasureRequest = async (t: Tenant, contactUuid: string) => {
  const res = await p.api
    .as(t.admin)
    .post('/v2/privacy/requests')
    .set('idempotency-key', `er-${++seq}`)
    .send({ requestType: 'erasure', subject: { kind: 'contact', id: contactUuid } });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; reference: string; restricted: boolean };
};

const verify = async (t: Tenant, reqId: string) =>
  expect(
    (
      await p.api
        .as(t.admin)
        .post(`/v2/privacy/requests/${reqId}/verify`)
        .send({ outcome: 'verified', method: 'channel_code' })
    ).status,
  ).toBe(200);

const preview = async (t: Tenant, reqId: string) =>
  expect(
    (await p.api.as(t.admin).post(`/v2/privacy/requests/${reqId}/erase`).send({ dryRun: true }))
      .status,
  ).toBe(200);

const execute = (t: Tenant, reqId: string, reference: string) =>
  p.api
    .as(t.admin)
    .post(`/v2/privacy/requests/${reqId}/erase`)
    .send({ dryRun: false, confirmation: `ERASE ${reference}` });

const detail = async (t: Tenant, reqId: string) =>
  (await p.api.as(t.admin).get(`/v2/privacy/requests/${reqId}`)).body as {
    request: {
      status: string;
      restricted: boolean;
      restrictedAt: string | null;
      restrictionNotice: string | null;
      proof: Record<string, unknown> | null;
    };
    events: Array<{ eventType: string }>;
  };

beforeAll(async () => {
  p = await startPipeline(async () => [
    (await import('../../../src/modules/privacy/privacy-worker.module')).PrivacyWorkerModule,
  ]);
  a = await p.api.signup('lhA');
  b = await p.api.signup('lhB');
}, 720_000);

afterAll(async () => {
  await p?.stop();
});

describe('placing and reading a hold', () => {
  it('places a hold with a masked label and no personal value, once per subject', async () => {
    const c = await person(a);
    const res = await place(a, {
      scope: 'contact',
      subjectId: c.uuid,
      reasonCategory: 'regulator_request',
      caseRef: 'REG-1',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      scope: 'contact',
      status: 'active',
      reasonCategory: 'regulator_request',
      caseRef: 'REG-1',
    });
    expect(JSON.stringify(res.body)).not.toContain(c.phone);
    expect(JSON.stringify(res.body)).not.toContain('Rita');
    const again = await place(a, { scope: 'contact', subjectId: c.uuid });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('LEGAL_HOLD_EXISTS');
    const status = await p.api
      .as(a.admin)
      .get(`/v2/privacy/legal-holds/status?kind=contact&id=${c.uuid}`);
    expect(status.body).toMatchObject({ held: true, viaWorkspace: false });
    await p.api.as(a.admin).post(`/v2/privacy/legal-holds/${res.body.id}/release`).send({});
  });

  it('replays the same answer for the same Idempotency-Key and holds only once', async () => {
    const c = await person(a);
    const first = await place(a, { scope: 'contact', subjectId: c.uuid }, a.admin, 'lh-idem-1');
    const second = await place(a, { scope: 'contact', subjectId: c.uuid }, a.admin, 'lh-idem-1');
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(
      await n(
        `SELECT count(*)::int AS n FROM legal_holds WHERE org_id = $1 AND status = 'active' AND contact_id = $2`,
        [a.orgId, c.id],
      ),
    ).toBe(1);
    await p.api.as(a.admin).post(`/v2/privacy/legal-holds/${first.body.id}/release`).send({});
  });

  it('is permissioned by the existing privacy keys, and invisible to another workspace', async () => {
    const c = await person(a);
    const reader = await p.api.member(a, 'lhreader', [['privacy.requests.read']]);
    const manager = await p.api.member(a, 'lhmanager', [
      ['privacy.requests.read'],
      ['privacy.requests.manage'],
    ]);
    const nobody = await p.api.member(a, 'lhnobody', [['record.contacts.read']]);

    // no privacy key: nothing, not even the status of a contact
    expect((await p.api.as(nobody.token).get('/v2/privacy/legal-holds')).status).toBe(403);
    expect(
      (await p.api.as(nobody.token).get(`/v2/privacy/legal-holds/status?kind=contact&id=${c.uuid}`))
        .status,
    ).toBe(403);
    // read: may look, may not place
    expect((await p.api.as(reader.token).get('/v2/privacy/legal-holds')).status).toBe(200);
    expect((await place(a, { scope: 'contact', subjectId: c.uuid }, reader.token)).status).toBe(
      403,
    );
    // manage places and releases
    const h = await place(a, { scope: 'contact', subjectId: c.uuid }, manager.token);
    expect(h.status, JSON.stringify(h.body)).toBe(201);
    expect(
      (await p.api.as(reader.token).post(`/v2/privacy/legal-holds/${h.body.id}/release`).send({}))
        .status,
    ).toBe(403);
    expect(
      (
        await p.api
          .as(reader.token)
          .post(`/v2/privacy/legal-holds/${h.body.id}/extend`)
          .send({ note: 'x' })
      ).status,
    ).toBe(403);

    // another workspace: 404 on the hold, empty register, and it cannot hold a person that is not its own
    expect((await p.api.as(b.admin).get(`/v2/privacy/legal-holds/${h.body.id}`)).status).toBe(404);
    expect(
      (await p.api.as(b.admin).post(`/v2/privacy/legal-holds/${h.body.id}/release`).send({}))
        .status,
    ).toBe(404);
    expect((await p.api.as(b.admin).get('/v2/privacy/legal-holds')).body.data).toHaveLength(0);
    expect((await place(b, { scope: 'contact', subjectId: c.uuid })).status).toBe(404);
    expect(
      (await p.api.as(manager.token).post(`/v2/privacy/legal-holds/${h.body.id}/release`).send({}))
        .status,
    ).toBe(200);
  });

  it('exports the register as a CSV for auditors, audited', async () => {
    const c = await person(a);
    const h = await place(a, { scope: 'contact', subjectId: c.uuid, caseRef: 'AUDIT-77' });
    const res = await p.api.as(a.admin).get('/v2/privacy/legal-holds/export?status=active');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('AUDIT-77');
    expect(
      await n(
        `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'legal_holds' AND action = 'export'`,
        [a.orgId],
      ),
    ).toBeGreaterThanOrEqual(1);
    await p.api.as(a.admin).post(`/v2/privacy/legal-holds/${h.body.id}/release`).send({});
  });
});

describe('what a hold blocks', () => {
  it('refuses a single delete and a bulk delete with LEGAL_HOLD_ACTIVE, touching nothing', async () => {
    const held = await person(a);
    const free = await person(a);
    const h = await place(a, { scope: 'contact', subjectId: held.uuid });

    const del = await p.api.as(a.admin).delete(`/v2/contacts/${held.uuid}`);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('LEGAL_HOLD_ACTIVE');
    expect(JSON.stringify(del.body).toLowerCase()).not.toContain('investigation');

    const bulk = await p.api
      .as(a.admin)
      .post('/v2/contacts/bulk/delete')
      .send({ ids: [held.uuid, free.uuid] });
    expect(bulk.status).toBe(409);
    expect(bulk.body.code).toBe('LEGAL_HOLD_ACTIVE');
    expect(
      await n(`SELECT count(*)::int AS n FROM contacts WHERE uuid IN ($1, $2)`, [
        held.uuid,
        free.uuid,
      ]),
    ).toBe(2);

    // the free contact alone is deleted as ever
    expect((await p.api.as(a.admin).delete(`/v2/contacts/${free.uuid}`)).status).toBe(204);
    await p.api.as(a.admin).post(`/v2/privacy/legal-holds/${h.body.id}/release`).send({});
    expect((await p.api.as(a.admin).delete(`/v2/contacts/${held.uuid}`)).status).toBe(204);
  });

  it('refuses marketing and AI processing through the ConsentGate with a neutral reason, and keeps service messages', async () => {
    const c = await person(a);
    const gate = p.h.app.get(ConsentGate);
    const ask = (purpose: Parameters<ConsentGate['check']>[3]) =>
      gate.check(a.orgId, { type: 'contact', id: c.id }, 'whatsapp', purpose);
    expect((await ask('marketing_messaging')).decision).toBe('allow');
    const h = await place(a, { scope: 'contact', subjectId: c.uuid });
    expect(await ask('marketing_messaging')).toEqual({ decision: 'deny', reason: 'legal_hold' });
    expect(await ask('ai_content_processing')).toEqual({ decision: 'deny', reason: 'legal_hold' });
    expect((await ask('service_messaging')).decision).toBe('allow');
    const many = await gate.checkMany(a.orgId, [c.id], 'whatsapp', 'marketing_messaging');
    expect(many.counts.legal_hold).toBe(1);
    expect(many.allowed.size).toBe(0);
    await p.api.as(a.admin).post(`/v2/privacy/legal-holds/${h.body.id}/release`).send({});
    expect((await ask('marketing_messaging')).decision).toBe('allow');
  });

  it('leaves a held contact out of a CSV export unless the caller is an authorised legal user', async () => {
    const held = await person(a, 'Heldperson');
    const free = await person(a, 'Freeperson');
    const h = await place(a, { scope: 'contact', subjectId: held.uuid });
    const exporter = await p.api.member(a, 'lhexporter', [
      ['record.contacts.export'],
      ['record.contacts.read'],
    ]);
    const asExporter = await p.api
      .as(exporter.token)
      .post('/v2/contacts/export')
      .send({ ids: [held.uuid, free.uuid] })
      .buffer(true);
    expect(asExporter.status, asExporter.text).toBe(200);
    expect(asExporter.text).toContain('Freeperson');
    expect(asExporter.text).not.toContain('Heldperson');
    const asLegal = await p.api
      .as(a.admin)
      .post('/v2/contacts/export')
      .send({ ids: [held.uuid, free.uuid] })
      .buffer(true);
    expect(asLegal.text).toContain('Heldperson');
    expect(asLegal.text).toContain('Freeperson');
    await p.api.as(a.admin).post(`/v2/privacy/legal-holds/${h.body.id}/release`).send({});
  });

  it('logs the opening of a held contact', async () => {
    const c = await person(a);
    const before = await n(
      `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'contacts' AND action = 'read' AND record_id = $2`,
      [a.orgId, c.id],
    );
    await p.api.as(a.admin).get(`/v2/contacts/${c.uuid}`);
    expect(
      await n(
        `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'contacts' AND action = 'read' AND record_id = $2`,
        [a.orgId, c.id],
      ),
    ).toBe(before);
    const h = await place(a, { scope: 'contact', subjectId: c.uuid });
    expect((await p.api.as(a.admin).get(`/v2/contacts/${c.uuid}`)).status).toBe(200);
    expect(
      await n(
        `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'contacts' AND action = 'read' AND record_id = $2`,
        [a.orgId, c.id],
      ),
    ).toBe(before + 1);
    await p.api.as(a.admin).post(`/v2/privacy/legal-holds/${h.body.id}/release`).send({});
  });

  it('a workspace hold refuses every delete in the workspace and none in another', async () => {
    const inA = await person(a);
    const inB = await person(b);
    const w = await place(a, { scope: 'workspace' });
    expect(w.status, JSON.stringify(w.body)).toBe(201);
    expect((await p.api.as(a.admin).delete(`/v2/contacts/${inA.uuid}`)).status).toBe(409);
    expect((await p.api.as(b.admin).delete(`/v2/contacts/${inB.uuid}`)).status).toBe(204);
    await p.api.as(a.admin).post(`/v2/privacy/legal-holds/${w.body.id}/release`).send({});
    expect((await p.api.as(a.admin).delete(`/v2/contacts/${inA.uuid}`)).status).toBe(204);
  });
});

describe('a rights erasure under a hold', () => {
  it('is recorded as restricted when it is confirmed, nothing is erased, and the release resumes it by itself', async () => {
    const c = await person(a, 'Resume');
    await p.h.owner.query(
      `INSERT INTO leads (org_id, name, phone, contact_id, source) VALUES ($1,'Lead',$2,$3,'manual')`,
      [a.orgId, c.phone, c.id],
    );
    const h = await place(a, { scope: 'contact', subjectId: c.uuid });
    const req = await erasureRequest(a, c.uuid);
    // a request for a person already held is restricted from the start
    expect(req.restricted).toBe(true);
    await verify(a, req.id);
    await preview(a, req.id);

    const blocked = await execute(a, req.id, req.reference);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('LEGAL_HOLD_ACTIVE');
    expect(blocked.body.errors).toContainEqual({ path: 'restricted', message: 'true' });

    // nothing was erased, and the case says why
    expect(await n(`SELECT count(*)::int AS n FROM contacts WHERE uuid = $1`, [c.uuid])).toBe(1);
    const d1 = await detail(a, req.id);
    expect(d1.request).toMatchObject({ status: 'in_progress', restricted: true });
    expect(d1.request.proof).toBeNull();
    expect(d1.events.map((e) => e.eventType)).toEqual(expect.arrayContaining(['restricted']));
    expect(
      await n(
        `SELECT count(*)::int AS n FROM privacy_requests WHERE org_id = $1 AND erasure_confirmed_at IS NOT NULL AND status = 'in_progress'`,
        [a.orgId],
      ),
    ).toBeGreaterThanOrEqual(1);

    // the worker does nothing while the hold lasts
    const maintenance = p.h.app.get(LegalHoldMaintenanceService);
    expect((await maintenance.resumeConfirmed()).resumed).toBe(0);
    expect(await n(`SELECT count(*)::int AS n FROM contacts WHERE uuid = $1`, [c.uuid])).toBe(1);

    // release: the case leaves the restriction and the confirmed erasure runs
    const rel = await p.api
      .as(a.admin)
      .post(`/v2/privacy/legal-holds/${h.body.id}/release`)
      .send({ reason: 'matter closed' });
    expect(rel.status, JSON.stringify(rel.body)).toBe(200);
    expect(rel.body).toMatchObject({ casesLifted: 1, erasuresResuming: 1 });
    expect((await detail(a, req.id)).request.restricted).toBe(false);

    const out = await maintenance.resumeConfirmed();
    expect(out.resumed).toBe(1);
    expect(out.failed).toBe(0);
    expect(await n(`SELECT count(*)::int AS n FROM contacts WHERE uuid = $1`, [c.uuid])).toBe(0);
    const d2 = await detail(a, req.id);
    expect(d2.request.status).toBe('completed');
    expect(d2.request.proof).toMatchObject({ resumedAfterHold: true });
    expect(d2.events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining(['restricted', 'restriction_lifted', 'erased']),
    );
    // the register keeps the released hold, without the person
    const row = (
      await q(`SELECT status, contact_id FROM legal_holds WHERE uuid = $1`, [h.body.id])
    )[0];
    expect(row).toEqual({ status: 'released', contact_id: null });
  });

  it('a hold placed after the request restricts it; an unconfirmed case returns to normal on release and is executed by a person', async () => {
    const c = await person(a, 'After');
    const req = await erasureRequest(a, c.uuid);
    expect(req.restricted).toBe(false);
    await verify(a, req.id);
    await preview(a, req.id);

    const h = await place(a, { scope: 'contact', subjectId: c.uuid });
    expect((await detail(a, req.id)).request.restricted).toBe(true);

    const rel = await p.api
      .as(a.admin)
      .post(`/v2/privacy/legal-holds/${h.body.id}/release`)
      .send({});
    expect(rel.body).toMatchObject({ casesLifted: 1, erasuresResuming: 0 });
    // nobody confirmed it: the worker leaves it for staff
    const maintenance = p.h.app.get(LegalHoldMaintenanceService);
    expect((await maintenance.resumeConfirmed()).resumed).toBe(0);
    expect(await n(`SELECT count(*)::int AS n FROM contacts WHERE uuid = $1`, [c.uuid])).toBe(1);

    await preview(a, req.id);
    const done = await execute(a, req.id, req.reference);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(await n(`SELECT count(*)::int AS n FROM contacts WHERE uuid = $1`, [c.uuid])).toBe(0);
    expect((await detail(a, req.id)).request.proof).not.toHaveProperty('resumedAfterHold');
  });

  it('shows the requester response text the workspace configured, on a restricted case only', async () => {
    const c = await person(a, 'Notice');
    const set = await p.api
      .as(a.admin)
      .patch('/v2/privacy/settings')
      .send({ slaDays: 30, legalHoldRequesterNotice: 'We must keep some records by law.' });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.legalHoldRequesterNotice).toBe('We must keep some records by law.');
    const h = await place(a, {
      scope: 'contact',
      subjectId: c.uuid,
      reasonCategory: 'internal_investigation',
    });
    const req = await erasureRequest(a, c.uuid);
    const d = await detail(a, req.id);
    expect(d.request.restricted).toBe(true);
    expect(d.request.restrictionNotice).toBe('We must keep some records by law.');
    // the text given to the requester never carries the reason category
    expect(JSON.stringify(d.request)).not.toContain('internal_investigation');
    await p.api.as(a.admin).post(`/v2/privacy/legal-holds/${h.body.id}/release`).send({});
    const after = await detail(a, req.id);
    expect(after.request.restricted).toBe(false);
    expect(after.request.restrictionNotice).toBeNull();
    await p.api
      .as(a.admin)
      .patch('/v2/privacy/settings')
      .send({ slaDays: 30, legalHoldRequesterNotice: null });
  });

  it('filters the cases that wait on a hold', async () => {
    const c = await person(a, 'Filter');
    const h = await place(a, { scope: 'contact', subjectId: c.uuid });
    const req = await erasureRequest(a, c.uuid);
    const list = await p.api.as(a.admin).get('/v2/privacy/requests?restricted=true');
    expect(list.status).toBe(200);
    expect(list.body.data.map((r: { id: string }) => r.id)).toContain(req.id);
    expect(list.body.data.every((r: { restricted: boolean }) => r.restricted)).toBe(true);
    await p.api.as(a.admin).post(`/v2/privacy/legal-holds/${h.body.id}/release`).send({});
  });
});
