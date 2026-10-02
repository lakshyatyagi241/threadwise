import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEAL_VIEWER, DealsApi, startHarness, uuidRe, type Harness, type Tenant } from './support';

/**
 * Deals end to end through HTTP: TW-DEAL-001 and 006..016 (create, read, edit, stage moves, won/lost, delete, the timeline and
 * its tasks), with the permission, scope, tenant and audit/outbox properties every write must have.
 * One app, one database; each describe block works in organizations of its own.
 */
let h: Harness;
let api: DealsApi;

beforeAll(async () => {
  h = await startHarness();
  api = new DealsApi(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const problem = (res: { body: { code?: string } }) => res.body.code;

describe('plan gate and permissions (TW-DEAL-001)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('dpg');
  });

  it('TW-DEAL-001 #1: a workspace whose plan lacks the sales pipeline is refused with 422 PLAN_FEATURE_LOCKED and nothing changes', async () => {
    const { stage } = await api.defaultPipeline(t.admin);
    const deal = await api.deal(t.admin, { title: 'Before the lock' });
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"sales_pipeline":false}}' WHERE org_id = $1`,
      [t.orgId],
    );
    try {
      const move = await api
        .as(t.admin)
        .patch(`/v2/deals/${deal.id}/stage`)
        .send({ stageId: stage['Won']!.id });
      expect(move.status).toBe(422);
      expect(problem(move)).toBe('PLAN_FEATURE_LOCKED');
      expect(move.body.errors).toEqual(
        expect.arrayContaining([{ path: 'feature', message: 'sales_pipeline' }]),
      );
      const create = await api.as(t.admin).post('/v2/deals').send({ title: 'Locked' });
      expect(create.status).toBe(422);
      const row = await h.owner.query(`SELECT status FROM deals WHERE uuid = $1`, [deal.id]);
      expect(row.rows[0].status).toBe('open');
    } finally {
      await h.owner.query(`UPDATE org_plan_state SET overrides = '{}' WHERE org_id = $1`, [
        t.orgId,
      ]);
    }
  });

  it('TW-DEAL-001 #2 / D-01: reads are refused too (Reference let the JSON through and only drew a paywall over it)', async () => {
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"sales_pipeline":false}}' WHERE org_id = $1`,
      [t.orgId],
    );
    try {
      for (const path of [
        '/v2/deals',
        '/v2/deals/board',
        '/v2/pipelines',
        '/v2/deals/reports',
        '/v2/deals/tasks',
      ]) {
        const res = await api.as(t.admin).get(path);
        expect(res.status, path).toBe(422);
        expect(problem(res), path).toBe('PLAN_FEATURE_LOCKED');
      }
    } finally {
      await h.owner.query(`UPDATE org_plan_state SET overrides = '{}' WHERE org_id = $1`, [
        t.orgId,
      ]);
    }
    expect((await api.as(t.admin).get('/v2/deals')).status).toBe(200);
  });

  it('TW-DEAL-001 #3 / D-02: a viewer can read deals but cannot create, edit, move, win, lose, delete or add to the timeline', async () => {
    const viewer = await api.member(t, 'viewer', DEAL_VIEWER);
    const { stage } = await api.defaultPipeline(t.admin);
    const deal = await api.deal(t.admin, { title: 'Look but do not touch' });

    expect((await api.as(viewer.token).get('/v2/deals')).status).toBe(200);
    expect((await api.as(viewer.token).get(`/v2/deals/${deal.id}`)).status).toBe(200);
    const writes = [
      api.as(viewer.token).post('/v2/deals').send({ title: 'x' }),
      api
        .as(viewer.token)
        .patch(`/v2/deals/${deal.id}`)
        .send({ title: 'y', rowVersion: deal.rowVersion }),
      api.as(viewer.token).patch(`/v2/deals/${deal.id}/stage`).send({ stageId: stage['Won']!.id }),
      api.as(viewer.token).post(`/v2/deals/${deal.id}/won`).send({}),
      api.as(viewer.token).post(`/v2/deals/${deal.id}/lost`).send({}),
      api.as(viewer.token).delete(`/v2/deals/${deal.id}`),
      api
        .as(viewer.token)
        .post(`/v2/deals/${deal.id}/activities`)
        .send({ type: 'note', body: 'x' }),
    ];
    for (const res of await Promise.all(writes)) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
    const row = await h.owner.query(`SELECT title, status FROM deals WHERE uuid = $1`, [deal.id]);
    expect(row.rows[0]).toEqual({ title: 'Look but do not touch', status: 'open' });
  });

  it('TW-DEAL-001: the signed-up Agent preset works its own deals but cannot delete them, read reports or edit pipelines', async () => {
    const agent = await api.memberWithRole(t, 'agent', 'Agent');
    const mine = await api.deal(agent.token, { title: 'Agent deal' });
    expect(mine.owner).not.toBeNull();
    expect(
      (
        await api
          .as(agent.token)
          .patch(`/v2/deals/${mine.id}`)
          .send({ title: 'Agent deal 2', rowVersion: mine.rowVersion })
      ).status,
    ).toBe(200);
    expect((await api.as(agent.token).delete(`/v2/deals/${mine.id}`)).status).toBe(403);
    expect((await api.as(agent.token).get('/v2/deals/reports')).status).toBe(403);
    expect((await api.as(agent.token).post('/v2/pipelines').send({ name: 'Nope' })).status).toBe(
      403,
    );
    expect((await api.as(agent.token).get('/v2/pipelines')).status).toBe(200);
  });

  it('TW-DEAL-001 / D-02: with record scope own, a rep sees and changes only the deals they own (anything else is 404, never 403)', async () => {
    const rep = await api.member(t, 'rep', [
      ['record.deals.read', 'own'],
      ['record.deals.update', 'own'],
      ['record.deals.delete', 'own'],
      ['record.deals.create'],
      ['record.pipelines.read'],
    ]);
    const adminsDeal = await api.deal(t.admin, { title: 'Admin only', ownerId: null });
    const repsDeal = await api.deal(rep.token, { title: 'Rep deal' });

    const list = await api.as(rep.token).get('/v2/deals');
    expect(list.body.data.map((d: { title: string }) => d.title)).toEqual(['Rep deal']);
    for (const res of [
      await api.as(rep.token).get(`/v2/deals/${adminsDeal.id}`),
      await api
        .as(rep.token)
        .patch(`/v2/deals/${adminsDeal.id}`)
        .send({ title: 'hijack', rowVersion: adminsDeal.rowVersion }),
      await api.as(rep.token).delete(`/v2/deals/${adminsDeal.id}`),
      await api.as(rep.token).get(`/v2/deals/${adminsDeal.id}/activities`),
    ]) {
      expect(res.status).toBe(404);
    }
    expect((await api.as(rep.token).delete(`/v2/deals/${repsDeal.id}`)).status).toBe(204);
  });
});

describe('creating a deal (TW-DEAL-009)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('dcr');
  });

  it("TW-DEAL-009 #1: {title} alone lands in the default pipeline's first stage, owned by the caller, source manual, value 0.00", async () => {
    const { pipeline, stage } = await api.defaultPipeline(t.admin);
    const res = await api.as(t.admin).post('/v2/deals').send({ title: 'A' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      title: 'A',
      status: 'open',
      value: '0.00',
      source: 'manual',
      pipeline: { id: pipeline.id },
      stage: { id: stage['New Lead']!.id, name: 'New Lead', kind: 'open' },
      owner: { id: await api.userUuid(t.adminUserId) },
      contact: null,
      company: null,
      wonAt: null,
      lostAt: null,
      lostReason: null,
    });
    expect(res.body.id).toMatch(uuidRe);
    expect(JSON.stringify(res.body)).not.toMatch(/"(orgId|org_id)"/);
    // no internal bigint id anywhere in the response
    for (const [k, v] of Object.entries(res.body)) {
      if (k === 'rowVersion') continue;
      expect(typeof v === 'number', k).toBe(false);
    }
  });

  it('TW-DEAL-009 #2 / D-11: a stage of another pipeline is 422 DEAL_STAGE_MISMATCH, not a silent fall back to the first stage', async () => {
    const other = await api
      .as(t.admin)
      .post('/v2/pipelines')
      .send({ name: 'Other', stages: [{ name: 'Only' }] });
    expect(other.status, JSON.stringify(other.body)).toBe(201);
    const { pipeline } = await api.defaultPipeline(t.admin);
    const res = await api
      .as(t.admin)
      .post('/v2/deals')
      .send({ title: 'x', pipelineId: pipeline.id, stageId: other.body.stages[0].id });
    expect(res.status).toBe(422);
    expect(problem(res)).toBe('DEAL_STAGE_MISMATCH');
    expect(
      (await h.owner.query(`SELECT 1 FROM deals WHERE org_id = $1 AND title = 'x'`, [t.orgId]))
        .rows,
    ).toHaveLength(0);
  });

  it('TW-DEAL-009 #3: no title is a 422 problem+json with a field error', async () => {
    const res = await api.as(t.admin).post('/v2/deals').send({ value: '10' });
    expect(res.status).toBe(422);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(problem(res)).toBe('VALIDATION_FAILED');
    expect(res.body.errors.map((e: { path: string }) => e.path)).toContain('title');
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/deals')
          .send({ title: 'x'.repeat(192) })
      ).status,
    ).toBe(422);
    expect((await api.as(t.admin).post('/v2/deals').send({ title: '   ' })).status).toBe(422);
  });

  it('TW-DEAL-009 / parity run: an expected close date that is not a real day is a 422, never a 500, on create and on edit', async () => {
    const bad = await api.as(t.admin).post('/v2/deals').send({ title: 'Bad day', expectedCloseDate: '2026-02-31' });
    expect(bad.status).toBe(422);
    expect(problem(bad)).toBe('VALIDATION_FAILED');
    expect(bad.body.errors.map((e: { path: string }) => e.path)).toContain('expectedCloseDate');
    const deal = await api.deal(t.admin, { title: 'Good day', expectedCloseDate: '2026-02-28' });
    const edit = await api
      .as(t.admin)
      .patch(`/v2/deals/${deal.id}`)
      .send({ expectedCloseDate: '2026-04-31', rowVersion: deal.rowVersion });
    expect(edit.status).toBe(422);
    expect(problem(edit)).toBe('VALIDATION_FAILED');
  });

  it('TW-DEAL-009 #4 / D-12: an owner must be an active member of this workspace; another member is recorded in the creation event', async () => {
    const mate = await api.member(t, 'mate', DEAL_VIEWER);
    const mateUuid = await api.userUuid(mate.userId);
    const ok = await api.deal(t.admin, { title: 'Assigned', ownerId: mateUuid });
    expect(ok.owner?.id).toBe(mateUuid);
    const events = await api.events(t.orgId, 'deal.created');
    expect(events.some((e) => e.uuid === ok.id && e.ownerId === mateUuid)).toBe(true);

    const stranger = await api.signup('dcr-other');
    const foreignUser = await api.userUuid(stranger.adminUserId);
    for (const ownerId of [foreignUser, '00000000-0000-4000-8000-000000000000']) {
      const bad = await api.as(t.admin).post('/v2/deals').send({ title: 'Bad owner', ownerId });
      expect(bad.status).toBe(422);
      expect(problem(bad)).toBe('DEAL_OWNER_INVALID');
    }
    await h.owner.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [mate.userId]);
    const suspended = await api
      .as(t.admin)
      .post('/v2/deals')
      .send({ title: 'Suspended owner', ownerId: mateUuid });
    expect(suspended.status).toBe(422);
    const unowned = await api.deal(t.admin, { title: 'No owner', ownerId: null });
    expect(unowned.owner).toBeNull();
  });

  it('TW-DEAL-009 / TW-DEAL-008 #5: a deal created straight into the Won stage is won in the same step and fires deal.won', async () => {
    const { stage } = await api.defaultPipeline(t.admin);
    const deal = await api.deal(t.admin, {
      title: 'Born won',
      stageId: stage['Won']!.id,
      value: '500',
    });
    expect(deal.status).toBe('won');
    expect(deal.wonAt).not.toBeNull();
    expect(deal.lostAt).toBeNull();
    expect((await api.events(t.orgId, 'deal.won')).some((e) => e.uuid === deal.id)).toBe(true);

    const lost = await api.deal(t.admin, { title: 'Born lost', stageId: stage['Lost']!.id });
    expect(lost.status).toBe('lost');
    expect(lost.lostAt).not.toBeNull();
    expect((await api.events(t.orgId, 'deal.lost')).some((e) => e.uuid === lost.id)).toBe(true);
  });

  it('TW-DEAL-008 #7 / D-10: the first placement is logged on the timeline and fires deal.stage_changed (Reference did neither on create)', async () => {
    const deal = await api.deal(t.admin, { title: 'Placed' });
    const tl = await api.timeline(t.admin, deal.id);
    expect(tl).toHaveLength(1);
    expect(tl[0]).toMatchObject({
      type: 'stage_change',
      stageChange: { from: null, to: { name: 'New Lead' } },
    });
    const placed = (await api.events(t.orgId, 'deal.stage_changed')).filter(
      (e) => e.uuid === deal.id,
    );
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ fromStageId: null, previousStatus: null });
  });

  it('TW-DEAL-009: a create writes exactly one audit row and one deal.created event, in the same transaction; a refused create writes neither', async () => {
    const before = {
      audit: await api.auditCount(t.orgId, 'deals', 'insert'),
      events: (await api.events(t.orgId, 'deal.created')).length,
    };
    await api.deal(t.admin, { title: 'Audited' });
    expect(await api.auditCount(t.orgId, 'deals', 'insert')).toBe(before.audit + 1);
    expect((await api.events(t.orgId, 'deal.created')).length).toBe(before.events + 1);

    const { pipeline } = await api.defaultPipeline(t.admin);
    const refused = await api
      .as(t.admin)
      .post('/v2/deals')
      .send({
        title: 'Refused',
        pipelineId: pipeline.id,
        ownerId: '00000000-0000-4000-8000-000000000000',
      });
    expect(refused.status).toBe(422);
    expect(await api.auditCount(t.orgId, 'deals', 'insert')).toBe(before.audit + 1);
    expect((await api.events(t.orgId, 'deal.created')).length).toBe(before.events + 1);
  });

  it('TW-DEAL-009: the same Idempotency-Key replays the first answer and creates one deal', async () => {
    const key = `deal-${Date.now()}`;
    const first = await api
      .as(t.admin)
      .post('/v2/deals')
      .set('Idempotency-Key', key)
      .send({ title: 'Once' });
    const again = await api
      .as(t.admin)
      .post('/v2/deals')
      .set('Idempotency-Key', key)
      .send({ title: 'Once' });
    expect(first.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(
      (
        await h.owner.query(
          `SELECT count(*)::int AS n FROM deals WHERE org_id = $1 AND title = 'Once'`,
          [t.orgId],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('TW-DEAL-006 #1 / #3: 100.50 is stored exactly and read back as "100.50"; 100000000 is refused', async () => {
    const d = await api.deal(t.admin, { title: 'Money', value: '100.50', currency: 'usd' });
    expect(d.value).toBe('100.50');
    expect(d.currency).toBe('USD');
    expect(
      (await h.owner.query(`SELECT value_minor::text AS v FROM deals WHERE uuid = $1`, [d.id]))
        .rows[0].v,
    ).toBe('10050');
    expect(
      (await api.as(t.admin).post('/v2/deals').send({ title: 'Big', value: '100000000' })).status,
    ).toBe(422);
    expect(
      (await api.as(t.admin).post('/v2/deals').send({ title: 'Float', value: 100.5 })).status,
    ).toBe(422);
  });

  it('TW-DEAL-006 port decision: the decimals follow the currency (JPY has none) and an unfitting amount is 422 DEAL_VALUE_INVALID', async () => {
    const yen = await api.deal(t.admin, { title: 'Yen', value: '1500', currency: 'JPY' });
    expect(yen.value).toBe('1500');
    const bad = await api
      .as(t.admin)
      .post('/v2/deals')
      .send({ title: 'Yen cents', value: '1500.5', currency: 'JPY' });
    expect(bad.status).toBe(422);
    expect(problem(bad)).toBe('DEAL_VALUE_INVALID');
  });

  it('TW-DEAL-002 #3 / D-03: a deal priced in another currency than the pipeline keeps it (no silent relabel on any later call)', async () => {
    const eur = await api.deal(t.admin, { title: 'Euro deal', value: '10', currency: 'EUR' });
    await api.as(t.admin).get('/v2/deals/board');
    await api.as(t.admin).get('/v2/deals/reports');
    await api.as(t.admin).get('/v2/pipelines');
    const again = await api.as(t.admin).get(`/v2/deals/${eur.id}`);
    expect(again.body.currency).toBe('EUR');
  });
});

describe('contact and company links (TW-DEAL-014, 038)', () => {
  let t: Tenant;
  let other: Tenant;
  beforeAll(async () => {
    t = await api.signup('dlk');
    other = await api.signup('dlk2');
  });

  const company = async (orgId: number, name: string) =>
    (
      await h.owner.query(`INSERT INTO companies (org_id, name) VALUES ($1,$2) RETURNING uuid`, [
        orgId,
        name,
      ])
    ).rows[0].uuid as string;

  it("TW-DEAL-038 / D-14: a deal linked to a contact inherits the contact's company (Reference never wrote deals.company_id)", async () => {
    const acme = await company(t.orgId, 'Acme');
    const [contact] = await api.seedContacts(t, [{ name: 'Ana', phone: '+14155550101' }]);
    await h.owner.query(
      `UPDATE contacts SET company_id = (SELECT id FROM companies WHERE uuid = $1) WHERE uuid = $2`,
      [acme, contact],
    );
    const d = await api.deal(t.admin, { title: 'Acme annual', contactId: contact });
    expect(d.contact).toMatchObject({ id: contact, name: 'Ana', phone: '+14155550101' });
    expect(d.company).toMatchObject({ id: acme, name: 'Acme' });
    expect(
      (await h.owner.query(`SELECT company_id FROM deals WHERE uuid = $1`, [d.id])).rows[0]
        .company_id,
    ).not.toBeNull();
  });

  it("TW-DEAL-038: an explicit company wins over the contact's, and null clears the inherited one", async () => {
    const acme = await company(t.orgId, 'Acme2');
    const beta = await company(t.orgId, 'Beta');
    const [contact] = await api.seedContacts(t, [{ name: 'Bo' }]);
    await h.owner.query(
      `UPDATE contacts SET company_id = (SELECT id FROM companies WHERE uuid = $1) WHERE uuid = $2`,
      [acme, contact],
    );
    const explicit = await api.deal(t.admin, {
      title: 'Explicit',
      contactId: contact,
      companyId: beta,
    });
    expect(explicit.company?.id).toBe(beta);
    const cleared = await api.deal(t.admin, {
      title: 'Cleared',
      contactId: contact,
      companyId: null,
    });
    expect(cleared.company).toBeNull();
  });

  it('TW-DEAL-014 #2 / D-11: a contact or company of another workspace is 404 (Reference silently dropped the link)', async () => {
    const [foreign] = await api.seedContacts(other, [{ name: 'Foreign' }]);
    const foreignCompany = await company(other.orgId, 'Foreign Co');
    const a = await api.as(t.admin).post('/v2/deals').send({ title: 'x', contactId: foreign });
    expect(a.status).toBe(404);
    const b = await api
      .as(t.admin)
      .post('/v2/deals')
      .send({ title: 'x', companyId: foreignCompany });
    expect(b.status).toBe(404);
    const d = await api.deal(t.admin, { title: 'Own' });
    const c = await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}`)
      .send({ contactId: foreign, rowVersion: d.rowVersion });
    expect(c.status).toBe(404);
  });

  it('TW-DEAL-014 / D-15: a contact can be linked, changed and unlinked after creation (Reference could only link once)', async () => {
    const [c1, c2] = await api.seedContacts(t, [{ name: 'One' }, { name: 'Two' }]);
    let d = await api.deal(t.admin, { title: 'Relink' });
    const link = await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}`)
      .send({ contactId: c1, rowVersion: d.rowVersion });
    expect(link.body.contact.id).toBe(c1);
    const swap = await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}`)
      .send({ contactId: c2, rowVersion: link.body.rowVersion });
    expect(swap.body.contact.id).toBe(c2);
    const unlink = await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}`)
      .send({ contactId: null, rowVersion: swap.body.rowVersion });
    expect(unlink.body.contact).toBeNull();
    d = unlink.body;
  });

  it("TW-DEAL-037 #1: a contact's deals list open ones first with the rollup (open count, won value per currency)", async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Rollup' }]);
    const { stage } = await api.defaultPipeline(t.admin);
    await api.deal(t.admin, {
      title: 'Won 100',
      contactId: c,
      stageId: stage['Won']!.id,
      value: '100',
    });
    await api.deal(t.admin, { title: 'Open 1', contactId: c, value: '40' });
    const res = await api.as(t.admin).get(`/v2/contacts/${c}/deals`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.deals.map((d: { title: string }) => d.title)).toEqual(['Open 1', 'Won 100']);
    expect(res.body.rollup).toEqual({
      openCount: 1,
      openValue: [{ currency: 'INR', amount: '40.00' }],
      wonCount: 1,
      wonValue: [{ currency: 'INR', amount: '100.00' }],
    });
    expect((await api.as(t.admin).get(`/v2/deals?contactId=${c}`)).body.data).toHaveLength(2);
    const foreign = await api.as(other.admin).get(`/v2/contacts/${c}/deals`);
    expect(foreign.status).toBe(404);
  });

  it('TW-DEAL-014: deleting a contact keeps its deals and only clears the link; deleting a company likewise', async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Leaver' }]);
    const co = await company(t.orgId, 'Leaving Co');
    const d = await api.deal(t.admin, { title: 'Survivor', contactId: c, companyId: co });
    await h.owner.query(`DELETE FROM contacts WHERE uuid = $1`, [c]);
    await h.owner.query(`DELETE FROM companies WHERE uuid = $1`, [co]);
    const got = await api.as(t.admin).get(`/v2/deals/${d.id}`);
    expect(got.status).toBe(200);
    expect(got.body.contact).toBeNull();
    expect(got.body.company).toBeNull();
  });
});

describe('reading and editing a deal (TW-DEAL-010, 011)', () => {
  let t: Tenant;
  let other: Tenant;
  beforeAll(async () => {
    t = await api.signup('ded');
    other = await api.signup('ded2');
  });

  it("TW-DEAL-010 #2: another workspace's deal is 404, and so is every write against it", async () => {
    const mine = await api.deal(t.admin, { title: 'Private' });
    const { stage: theirStage } = await api.defaultPipeline(other.admin);
    expect((await api.as(other.admin).get(`/v2/deals/${mine.id}`)).status).toBe(404);
    expect(
      (await api.as(other.admin).patch(`/v2/deals/${mine.id}`).send({ title: 'x', rowVersion: 1 }))
        .status,
    ).toBe(404);
    expect(
      (
        await api
          .as(other.admin)
          .patch(`/v2/deals/${mine.id}/stage`)
          .send({ stageId: theirStage['Won']!.id })
      ).status,
    ).toBe(404);
    expect((await api.as(other.admin).delete(`/v2/deals/${mine.id}`)).status).toBe(404);
    expect((await api.as(other.admin).get(`/v2/deals/${mine.id}/activities`)).status).toBe(404);
    expect((await api.as(other.admin).get('/v2/deals')).body.data).toHaveLength(0);
  });

  it('TW-DEAL-007 / RLS: a stage of another workspace cannot be a move target (404)', async () => {
    const mine = await api.deal(t.admin, { title: 'Mine' });
    const { stage: theirStage } = await api.defaultPipeline(other.admin);
    const res = await api
      .as(t.admin)
      .patch(`/v2/deals/${mine.id}/stage`)
      .send({ stageId: theirStage['Won']!.id });
    expect(res.status).toBe(404);
  });

  it('TW-DEAL-011 #1: changing the value to 250.5 stores 25050 minor units and bumps the version', async () => {
    const d = await api.deal(t.admin, { title: 'Edit me', value: '100' });
    const res = await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}`)
      .send({ value: '250.5', rowVersion: d.rowVersion });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.value).toBe('250.50');
    expect(res.body.rowVersion).toBe(d.rowVersion + 1);
    expect(
      (await h.owner.query(`SELECT value_minor::text AS v FROM deals WHERE uuid = $1`, [d.id]))
        .rows[0].v,
    ).toBe('25050');
  });

  it('TW-DEAL-011 #2: an owner of null unassigns the deal', async () => {
    const d = await api.deal(t.admin, { title: 'Unassign me' });
    expect(d.owner).not.toBeNull();
    const res = await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}`)
      .send({ ownerId: null, rowVersion: d.rowVersion });
    expect(res.body.owner).toBeNull();
    expect(
      (await h.owner.query(`SELECT owner_user_id FROM deals WHERE uuid = $1`, [d.id])).rows[0]
        .owner_user_id,
    ).toBeNull();
  });

  it('TW-DEAL-011 #3 / D-11: the stage is not an edit field and a foreign-pipeline stage on the stage route is 422, never silently ignored', async () => {
    const other2 = await api
      .as(t.admin)
      .post('/v2/pipelines')
      .send({ name: 'Foreign stages', stages: [{ name: 'F1' }] });
    const d = await api.deal(t.admin, { title: 'Stay put' });
    const res = await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}/stage`)
      .send({ stageId: other2.body.stages[0].id });
    expect(res.status).toBe(422);
    expect(problem(res)).toBe('DEAL_STAGE_MISMATCH');
    expect((await api.as(t.admin).get(`/v2/deals/${d.id}`)).body.stage.name).toBe('New Lead');
  });

  it('TW-DEAL-011 #7: an update with a stale rowVersion is 409 ROW_VERSION_CONFLICT and changes nothing (Reference: last write wins)', async () => {
    const d = await api.deal(t.admin, { title: 'Race' });
    const first = await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}`)
      .send({ title: 'First', rowVersion: d.rowVersion });
    expect(first.status).toBe(200);
    const stale = await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}`)
      .send({ title: 'Second', rowVersion: d.rowVersion });
    expect(stale.status).toBe(409);
    expect(problem(stale)).toBe('ROW_VERSION_CONFLICT');
    expect((await api.as(t.admin).get(`/v2/deals/${d.id}`)).body.title).toBe('First');
    expect(
      (await api.as(t.admin).patch(`/v2/deals/${d.id}`).send({ title: 'No version' })).status,
    ).toBe(422);
  });

  it('TW-DEAL-011 #6: a blank title is refused; clearing expected close date and notes works with null', async () => {
    const d = await api.deal(t.admin, {
      title: 'Dates',
      expectedCloseDate: '2026-12-01',
      notes: 'hello',
    });
    expect((await api.as(t.admin).get(`/v2/deals/${d.id}`)).body.expectedCloseDate).toBe(
      '2026-12-01',
    );
    expect(
      (
        await api
          .as(t.admin)
          .patch(`/v2/deals/${d.id}`)
          .send({ title: '   ', rowVersion: d.rowVersion })
      ).status,
    ).toBe(422);
    const cleared = await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}`)
      .send({ expectedCloseDate: null, notes: null, rowVersion: d.rowVersion });
    expect(cleared.body.expectedCloseDate).toBeNull();
    expect(cleared.body.notes).toBeNull();
  });

  it('TW-DEAL-006 #5 / D-03: a new currency needs the value in that currency (the amount is never silently relabelled)', async () => {
    const d = await api.deal(t.admin, { title: 'Reprice', value: '100', currency: 'USD' });
    const bare = await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}`)
      .send({ currency: 'EUR', rowVersion: d.rowVersion });
    expect(bare.status).toBe(422);
    const ok = await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}`)
      .send({ currency: 'EUR', value: '90', rowVersion: d.rowVersion });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ value: '90.00', currency: 'EUR' });
  });

  it('TW-DEAL-011: an update writes an audit row holding only the changed fields and one deal.updated event; an unchanged update writes neither', async () => {
    const d = await api.deal(t.admin, { title: 'Audit me', value: '10' });
    const before = await api.auditCount(t.orgId, 'deals', 'update');
    const res = await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}`)
      .send({ title: 'Audit me too', rowVersion: d.rowVersion });
    expect(await api.auditCount(t.orgId, 'deals', 'update')).toBe(before + 1);
    const audit = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'deals' AND action = 'update' ORDER BY id DESC LIMIT 1`,
      [t.orgId],
    );
    expect(audit.rows[0].delta).toEqual({ title: { old: 'Audit me', new: 'Audit me too' } });
    expect(
      (await api.events(t.orgId, 'deal.updated')).some(
        (e) => e.uuid === d.id && (e.changed as string[]).includes('title'),
      ),
    ).toBe(true);

    await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}`)
      .send({ title: 'Audit me too', rowVersion: res.body.rowVersion });
    expect(await api.auditCount(t.orgId, 'deals', 'update')).toBe(before + 1);
  });

  it('TW-DEAL-011: changing the owner fires deal.owner_changed with the previous owner', async () => {
    const mate = await api.member(t, 'mate2', DEAL_VIEWER);
    const mateUuid = await api.userUuid(mate.userId);
    const d = await api.deal(t.admin, { title: 'Handover' });
    const res = await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}`)
      .send({ ownerId: mateUuid, rowVersion: d.rowVersion });
    expect(res.body.owner.id).toBe(mateUuid);
    const ev = (await api.events(t.orgId, 'deal.owner_changed')).filter((e) => e.uuid === d.id);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ ownerId: mateUuid, previousOwnerId: d.owner!.id });
  });
});

describe('stage moves and the stage-change engine (TW-DEAL-007, 008)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('dmv');
  });

  it('TW-DEAL-007 #1 / TW-DEAL-008 #1: a deal dragged to Won is won, won_at is set, exactly one new stage_change row exists and the events fire', async () => {
    const { stage } = await api.defaultPipeline(t.admin);
    const d = await api.deal(t.admin, { title: 'To won', value: '10' });
    const res = await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}/stage`)
      .send({ stageId: stage['Won']!.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      status: 'won',
      stage: { name: 'Won', kind: 'won' },
      lostAt: null,
    });
    expect(res.body.wonAt).not.toBeNull();
    const tl = await api.timeline(t.admin, d.id);
    expect(tl.filter((a) => a.type === 'stage_change')).toHaveLength(2); // placement + this move
    expect(tl[0]!.stageChange).toMatchObject({ from: { name: 'New Lead' }, to: { name: 'Won' } });
    const moved = (await api.events(t.orgId, 'deal.stage_changed')).filter((e) => e.uuid === d.id);
    expect(moved).toHaveLength(2);
    expect(moved[1]).toMatchObject({
      fromStageId: stage['New Lead']!.id,
      toStageId: stage['Won']!.id,
      previousStatus: 'open',
      status: 'won',
    });
    expect((await api.events(t.orgId, 'deal.won')).filter((e) => e.uuid === d.id)).toHaveLength(1);
  });

  it('TW-DEAL-008 #2: a lost deal with a reason moved to Qualified is open again, with no lost_at and no lost_reason; deal.reopened fires', async () => {
    const { stage } = await api.defaultPipeline(t.admin);
    const d = await api.deal(t.admin, { title: 'Come back' });
    const lost = await api.as(t.admin).post(`/v2/deals/${d.id}/lost`).send({ reason: 'Budget' });
    expect(lost.body).toMatchObject({ status: 'lost', lostReason: 'Budget' });
    const back = await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}/stage`)
      .send({ stageId: stage['Qualified']!.id });
    expect(back.body).toMatchObject({
      status: 'open',
      lostAt: null,
      lostReason: null,
      wonAt: null,
      stage: { name: 'Qualified' },
    });
    expect(
      (await api.events(t.orgId, 'deal.reopened')).filter((e) => e.uuid === d.id),
    ).toHaveLength(1);
  });

  it('TW-DEAL-008 #3: a deal moved won -> lost has no won_at and a lost_at', async () => {
    const { stage } = await api.defaultPipeline(t.admin);
    const d = await api.deal(t.admin, { title: 'Flip', stageId: stage['Won']!.id });
    const res = await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}/stage`)
      .send({ stageId: stage['Lost']!.id });
    expect(res.body).toMatchObject({ status: 'lost', wonAt: null });
    expect(res.body.lostAt).not.toBeNull();
  });

  it('TW-DEAL-008 #4: every move leaves exactly one stage_change row with the from and to stage names', async () => {
    const { stage } = await api.defaultPipeline(t.admin);
    const d = await api.deal(t.admin, { title: 'Walk' });
    for (const name of ['Qualified', 'Proposal', 'Negotiation']) {
      await api.as(t.admin).patch(`/v2/deals/${d.id}/stage`).send({ stageId: stage[name]!.id });
    }
    const changes = (await api.timeline(t.admin, d.id))
      .filter((a) => a.type === 'stage_change')
      .map((a) => [a.stageChange!.from?.name ?? null, a.stageChange!.to.name]);
    expect(changes.reverse()).toEqual([
      [null, 'New Lead'],
      ['New Lead', 'Qualified'],
      ['Qualified', 'Proposal'],
      ['Proposal', 'Negotiation'],
    ]);
  });

  it('TW-DEAL-007 #2: a stage from another pipeline is 422 and leaves the deal, its timeline, the audit trail and the outbox untouched', async () => {
    const p2 = await api
      .as(t.admin)
      .post('/v2/pipelines')
      .send({ name: 'Elsewhere', stages: [{ name: 'E1' }] });
    const d = await api.deal(t.admin, { title: 'Stay' });
    const audits = await api.auditCount(t.orgId, 'deals', 'update');
    const events = (await api.events(t.orgId, 'deal.stage_changed')).length;
    const res = await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}/stage`)
      .send({ stageId: p2.body.stages[0].id });
    expect(res.status).toBe(422);
    expect(problem(res)).toBe('DEAL_STAGE_MISMATCH');
    expect(await api.auditCount(t.orgId, 'deals', 'update')).toBe(audits);
    expect((await api.events(t.orgId, 'deal.stage_changed')).length).toBe(events);
    expect(await api.timeline(t.admin, d.id)).toHaveLength(1);
  });

  it('TW-DEAL-007 #3: moving to the stage the deal is in is accepted, records no stage change and fires no event', async () => {
    const { stage } = await api.defaultPipeline(t.admin);
    const d = await api.deal(t.admin, { title: 'Same' });
    const events = (await api.events(t.orgId, 'deal.stage_changed')).length;
    const res = await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}/stage`)
      .send({ stageId: stage['New Lead']!.id });
    expect(res.status).toBe(200);
    expect(await api.timeline(t.admin, d.id)).toHaveLength(1);
    expect((await api.events(t.orgId, 'deal.stage_changed')).length).toBe(events);
  });

  it('TW-DEAL-007 #4: a stage move carrying a stale rowVersion is 409; without one it is last write wins as before', async () => {
    const { stage } = await api.defaultPipeline(t.admin);
    const d = await api.deal(t.admin, { title: 'Versioned' });
    await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}`)
      .send({ title: 'Versioned 2', rowVersion: d.rowVersion });
    const stale = await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}/stage`)
      .send({ stageId: stage['Qualified']!.id, rowVersion: d.rowVersion });
    expect(stale.status).toBe(409);
    const free = await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}/stage`)
      .send({ stageId: stage['Qualified']!.id });
    expect(free.status).toBe(200);
  });

  it('TW-DEAL-007: a drop anchor that is not in the target stage is 422 DEAL_POSITION_INVALID', async () => {
    const { stage } = await api.defaultPipeline(t.admin);
    const a = await api.deal(t.admin, { title: 'Anchor' });
    const b = await api.deal(t.admin, { title: 'Mover' });
    const res = await api
      .as(t.admin)
      .patch(`/v2/deals/${b.id}/stage`)
      .send({ stageId: stage['Qualified']!.id, beforeDealId: a.id });
    expect(res.status).toBe(422);
    expect(problem(res)).toBe('DEAL_POSITION_INVALID');
    const both = await api
      .as(t.admin)
      .patch(`/v2/deals/${b.id}/stage`)
      .send({ stageId: stage['Qualified']!.id, beforeDealId: a.id, afterDealId: a.id });
    expect(both.status).toBe(422);
  });
});

describe('mark won, mark lost, reopen (TW-DEAL-012, 043)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('dwl');
  });

  it('TW-DEAL-012 #1: POST /won marks the deal won with won_at; POST /lost with a reason sets it; a repeat of /won is a no-op', async () => {
    const a = await api.deal(t.admin, { title: 'Win' });
    const won = await api.as(t.admin).post(`/v2/deals/${a.id}/won`).send({});
    expect(won.status).toBe(200);
    expect(won.body).toMatchObject({ status: 'won', stage: { name: 'Won' } });
    const stamp = won.body.wonAt;
    const again = await api.as(t.admin).post(`/v2/deals/${a.id}/won`).send({});
    expect(again.status).toBe(200);
    expect(again.body.wonAt).toBe(stamp);
    expect(
      (await api.timeline(t.admin, a.id)).filter((x) => x.type === 'stage_change'),
    ).toHaveLength(2);

    const b = await api.deal(t.admin, { title: 'Lose' });
    const lost = await api.as(t.admin).post(`/v2/deals/${b.id}/lost`).send({ reason: 'Budget' });
    expect(lost.body).toMatchObject({
      status: 'lost',
      lostReason: 'Budget',
      stage: { name: 'Lost' },
    });
    expect((await api.events(t.orgId, 'deal.lost')).find((e) => e.uuid === b.id)).toMatchObject({
      lostReason: 'Budget',
    });
  });

  it('TW-DEAL-012 #2: a pipeline with no Lost stage is 422 DEAL_NO_LOST_STAGE, and with no Won stage 422 DEAL_NO_WON_STAGE', async () => {
    const p = await api
      .as(t.admin)
      .post('/v2/pipelines')
      .send({ name: 'Open only', stages: [{ name: 'Working' }] });
    const d = await api.deal(t.admin, { title: 'No ending', pipelineId: p.body.id });
    const lost = await api.as(t.admin).post(`/v2/deals/${d.id}/lost`).send({ reason: 'x' });
    expect(lost.status).toBe(422);
    expect(problem(lost)).toBe('DEAL_NO_LOST_STAGE');
    const won = await api.as(t.admin).post(`/v2/deals/${d.id}/won`).send({});
    expect(won.status).toBe(422);
    expect(problem(won)).toBe('DEAL_NO_WON_STAGE');
  });

  it('TW-DEAL-012 #3 / port decision: a reason longer than 191 characters is a 422, not silently truncated', async () => {
    const d = await api.deal(t.admin, { title: 'Long reason' });
    const res = await api
      .as(t.admin)
      .post(`/v2/deals/${d.id}/lost`)
      .send({ reason: 'r'.repeat(300) });
    expect(res.status).toBe(422);
    expect((await api.as(t.admin).get(`/v2/deals/${d.id}`)).body.status).toBe('open');
    const ok = await api
      .as(t.admin)
      .post(`/v2/deals/${d.id}/lost`)
      .send({ reason: 'r'.repeat(191) });
    expect(ok.body.lostReason).toHaveLength(191);
  });

  it('TW-DEAL-043 / D-08: a catalogue reason is picked by id, its name is kept on the deal, and an unknown or inactive one is refused', async () => {
    const reason = (
      await api.as(t.admin).post('/v2/deal-lost-reasons').send({ name: 'Went with a competitor' })
    ).body;
    const retired = (
      await api
        .as(t.admin)
        .post('/v2/deal-lost-reasons')
        .send({ name: 'Retired reason', isActive: false })
    ).body;
    const d = await api.deal(t.admin, { title: 'Catalogue loss' });

    const inactive = await api
      .as(t.admin)
      .post(`/v2/deals/${d.id}/lost`)
      .send({ lostReasonId: retired.id });
    expect(inactive.status).toBe(422);
    const unknown = await api
      .as(t.admin)
      .post(`/v2/deals/${d.id}/lost`)
      .send({ lostReasonId: '00000000-0000-4000-8000-000000000000' });
    expect(unknown.status).toBe(404);

    const ok = await api
      .as(t.admin)
      .post(`/v2/deals/${d.id}/lost`)
      .send({ lostReasonId: reason.id });
    expect(ok.body).toMatchObject({
      status: 'lost',
      lostReason: 'Went with a competitor',
      lostReasonId: reason.id,
    });
    const list = await api.as(t.admin).get('/v2/deal-lost-reasons');
    expect(list.body.find((r: { id: string }) => r.id === reason.id).dealCount).toBe(1);
  });

  it('TW-DEAL-043 / D-08: when the workspace requires a reason, a loss without one is 422 DEAL_LOST_REASON_REQUIRED (button and drag alike)', async () => {
    const { stage } = await api.defaultPipeline(t.admin);
    const reason = (await api.as(t.admin).post('/v2/deal-lost-reasons').send({ name: 'Timing' }))
      .body;
    expect(
      (await api.as(t.admin).put('/v2/deal-settings').send({ lostReasonRequired: true })).body
        .lostReasonRequired,
    ).toBe(true);
    try {
      const a = await api.deal(t.admin, { title: 'Needs a reason A' });
      const b = await api.deal(t.admin, { title: 'Needs a reason B' });
      const viaButton = await api.as(t.admin).post(`/v2/deals/${a.id}/lost`).send({});
      expect(viaButton.status).toBe(422);
      expect(problem(viaButton)).toBe('DEAL_LOST_REASON_REQUIRED');
      const viaDrag = await api
        .as(t.admin)
        .patch(`/v2/deals/${b.id}/stage`)
        .send({ stageId: stage['Lost']!.id });
      expect(viaDrag.status).toBe(422);
      expect(problem(viaDrag)).toBe('DEAL_LOST_REASON_REQUIRED');
      expect((await api.as(t.admin).get(`/v2/deals/${b.id}`)).body.status).toBe('open');

      const dragged = await api
        .as(t.admin)
        .patch(`/v2/deals/${b.id}/stage`)
        .send({ stageId: stage['Lost']!.id, lostReasonId: reason.id });
      expect(dragged.body).toMatchObject({ status: 'lost', lostReason: 'Timing' });
      const typed = await api
        .as(t.admin)
        .post(`/v2/deals/${a.id}/lost`)
        .send({ reason: 'Free text is fine too' });
      expect(typed.status).toBe(200);
    } finally {
      await api.as(t.admin).put('/v2/deal-settings').send({ lostReasonRequired: false });
    }
  });

  it('TW-DEAL-012: marking an already-lost deal lost again with a new reason replaces the reason without a stage change', async () => {
    const d = await api.deal(t.admin, { title: 'Second thoughts' });
    await api.as(t.admin).post(`/v2/deals/${d.id}/lost`).send({ reason: 'Budget' });
    const events = (await api.events(t.orgId, 'deal.lost')).length;
    const res = await api.as(t.admin).post(`/v2/deals/${d.id}/lost`).send({ reason: 'Timing' });
    expect(res.body.lostReason).toBe('Timing');
    const keep = await api.as(t.admin).post(`/v2/deals/${d.id}/lost`).send({});
    expect(keep.body.lostReason).toBe('Timing');
    expect((await api.events(t.orgId, 'deal.lost')).length).toBe(events);
  });

  it('TW-DEAL-008: a deal won after being lost drops the stale reason; reopen goes to the first open stage or the one named', async () => {
    const { stage } = await api.defaultPipeline(t.admin);
    const d = await api.deal(t.admin, { title: 'Round trip' });
    await api.as(t.admin).post(`/v2/deals/${d.id}/lost`).send({ reason: 'Budget' });
    const won = await api.as(t.admin).post(`/v2/deals/${d.id}/won`).send({});
    expect(won.body).toMatchObject({ status: 'won', lostReason: null, lostAt: null });
    const re = await api.as(t.admin).post(`/v2/deals/${d.id}/reopen`).send({});
    expect(re.body).toMatchObject({ status: 'open', wonAt: null, stage: { name: 'New Lead' } });
    const named = await api.as(t.admin).post(`/v2/deals/${d.id}/lost`).send({ reason: 'x' });
    expect(named.status).toBe(200);
    const re2 = await api
      .as(t.admin)
      .post(`/v2/deals/${d.id}/reopen`)
      .send({ stageId: stage['Proposal']!.id });
    expect(re2.body.stage.name).toBe('Proposal');
    const bad = await api
      .as(t.admin)
      .post(`/v2/deals/${d.id}/reopen`)
      .send({ stageId: stage['Won']!.id });
    expect(bad.status).toBe(422); // reopening into a won stage makes no sense
  });
});

describe('deleting a deal (TW-DEAL-013)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ddl');
  });

  it('TW-DEAL-013 #1: deleting a deal with five timeline rows removes all of them, and a second DELETE is 404', async () => {
    const d = await api.deal(t.admin, { title: 'Doomed' });
    for (let i = 0; i < 4; i++) {
      expect(
        (
          await api
            .as(t.admin)
            .post(`/v2/deals/${d.id}/activities`)
            .send({ type: 'note', body: `n${i}` })
        ).status,
      ).toBe(201);
    }
    expect(await api.timeline(t.admin, d.id)).toHaveLength(5);
    const res = await api.as(t.admin).delete(`/v2/deals/${d.id}`);
    expect(res.status).toBe(204);
    expect(
      (
        await h.owner.query(
          `SELECT 1 FROM deal_activities a JOIN deals d ON d.id = a.deal_id WHERE d.uuid = $1`,
          [d.id],
        )
      ).rows,
    ).toHaveLength(0);
    expect((await h.owner.query(`SELECT 1 FROM deals WHERE uuid = $1`, [d.id])).rows).toHaveLength(
      0,
    );
    expect((await api.as(t.admin).delete(`/v2/deals/${d.id}`)).status).toBe(404);
    expect((await api.as(t.admin).get(`/v2/deals/${d.id}`)).status).toBe(404);
  });

  it('TW-DEAL-013 / D-13: a delete is audited with what was deleted and fires deal.deleted (Reference left no trace)', async () => {
    const d = await api.deal(t.admin, { title: 'Traceable', value: '75' });
    await api.as(t.admin).delete(`/v2/deals/${d.id}`);
    const audit = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'deals' AND action = 'delete' ORDER BY id DESC LIMIT 1`,
      [t.orgId],
    );
    expect(audit.rows[0].delta).toMatchObject({
      title: { old: 'Traceable' },
      value: { old: '75.00' },
    });
    expect((await api.events(t.orgId, 'deal.deleted')).some((e) => e.uuid === d.id)).toBe(true);
  });
});

describe('timeline and tasks (TW-DEAL-015, 016)', () => {
  let t: Tenant;
  let other: Tenant;
  beforeAll(async () => {
    t = await api.signup('dtl');
    other = await api.signup('dtl2');
  });

  it('TW-DEAL-015 #1: a task with a due date comes back open with that due date, assigned to the caller by default', async () => {
    const d = await api.deal(t.admin, { title: 'Task deal' });
    const res = await api
      .as(t.admin)
      .post(`/v2/deals/${d.id}/activities`)
      .send({ type: 'task', body: 'Call back', dueAt: '2026-11-01T09:30:00Z' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      type: 'task',
      body: 'Call back',
      dueAt: '2026-11-01T09:30:00.000Z',
      done: false,
      doneAt: null,
      assignee: { id: await api.userUuid(t.adminUserId) },
      author: { id: await api.userUuid(t.adminUserId) },
    });
  });

  it('TW-DEAL-015 #2 / port decision: a due date or an assignee on a note is 422 (Reference silently discarded it)', async () => {
    const d = await api.deal(t.admin, { title: 'Note deal' });
    const res = await api
      .as(t.admin)
      .post(`/v2/deals/${d.id}/activities`)
      .send({ type: 'note', body: 'x', dueAt: '2026-11-01T00:00:00Z' });
    expect(res.status).toBe(422);
    expect(problem(res)).toBe('VALIDATION_FAILED');
  });

  it('TW-DEAL-015 #3: an unknown type is 422; email, meeting and call are timeline types; stage_change cannot be added by hand', async () => {
    const d = await api.deal(t.admin, { title: 'Types' });
    for (const type of ['tweet', 'stage_change']) {
      expect(
        (await api.as(t.admin).post(`/v2/deals/${d.id}/activities`).send({ type, body: 'x' }))
          .status,
        type,
      ).toBe(422);
    }
    for (const type of ['note', 'call', 'message', 'email', 'meeting']) {
      const r = await api
        .as(t.admin)
        .post(`/v2/deals/${d.id}/activities`)
        .send({ type, body: `a ${type}` });
      expect(r.status, type).toBe(201);
      expect(r.body.dueAt).toBeNull();
    }
    expect(
      (
        await api
          .as(t.admin)
          .post(`/v2/deals/${d.id}/activities`)
          .send({ type: 'note', body: '   ' })
      ).status,
    ).toBe(422);
    expect(
      (
        await api
          .as(t.admin)
          .post(`/v2/deals/${d.id}/activities`)
          .send({ type: 'note', body: 'x'.repeat(5001) })
      ).status,
    ).toBe(422);
  });

  it('TW-DEAL-015 / D-26: the body is encrypted at rest and readable through the API', async () => {
    const d = await api.deal(t.admin, { title: 'Secrets' });
    const res = await api
      .as(t.admin)
      .post(`/v2/deals/${d.id}/activities`)
      .send({ type: 'note', body: 'the launch code is 0000' });
    const raw = await h.owner.query(`SELECT body FROM deal_activities WHERE uuid = $1`, [
      res.body.id,
    ]);
    expect(raw.rows[0].body).toMatch(/^v1:/);
    expect(raw.rows[0].body).not.toContain('launch code');
    const tl = await api.timeline(t.admin, d.id);
    expect(tl.find((a) => a.type === 'note')!.body).toBe('the launch code is 0000');
  });

  it('TW-DEAL-015: the timeline is newest first and keyset-paged without losing or repeating rows that share a timestamp', async () => {
    const d = await api.deal(t.admin, { title: 'Busy' });
    const dealId = (await h.owner.query(`SELECT id FROM deals WHERE uuid = $1`, [d.id])).rows[0].id;
    // seven rows with the SAME created_at to the microsecond, then one a microsecond later
    await h.owner.query(
      `INSERT INTO deal_activities (org_id, deal_id, type, body, created_at)
       SELECT $1, $2, 'note', 'tie-' || g, '2026-09-01T10:00:00.000001Z'::timestamptz FROM generate_series(1,7) g`,
      [t.orgId, dealId],
    );
    await h.owner.query(
      `INSERT INTO deal_activities (org_id, deal_id, type, body, created_at) VALUES ($1,$2,'note','later','2026-09-01T10:00:00.000002Z')`,
      [t.orgId, dealId],
    );
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const res = await api
        .as(t.admin)
        .get(`/v2/deals/${d.id}/activities?limit=3&type=note${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.data.map((a: { id: string }) => a.id));
      if (!res.body.page.hasMore) break;
      cursor = res.body.page.nextCursor;
    }
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);
  });

  it('TW-DEAL-016 #1: completing a task and reopening it toggles done; a stage_change row is not a task (404 DEAL_TASK_NOT_FOUND)', async () => {
    const d = await api.deal(t.admin, { title: 'Toggle' });
    const task = (
      await api
        .as(t.admin)
        .post(`/v2/deals/${d.id}/activities`)
        .send({ type: 'task', body: 'Do it' })
    ).body;
    const done = await api.as(t.admin).post(`/v2/deals/${d.id}/activities/${task.id}/complete`);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ done: true });
    expect(done.body.doneAt).not.toBeNull();
    const again = await api.as(t.admin).post(`/v2/deals/${d.id}/activities/${task.id}/complete`);
    expect(again.body.doneAt).toBe(done.body.doneAt);
    const reopened = await api.as(t.admin).post(`/v2/deals/${d.id}/activities/${task.id}/reopen`);
    expect(reopened.body).toMatchObject({ done: false, doneAt: null });

    const stageRow = (await api.timeline(t.admin, d.id)).find((a) => a.type === 'stage_change')!;
    const notTask = await api
      .as(t.admin)
      .post(`/v2/deals/${d.id}/activities/${stageRow.id}/complete`);
    expect(notTask.status).toBe(404);
    expect(problem(notTask)).toBe('DEAL_TASK_NOT_FOUND');
    const otherDeal = await api.deal(t.admin, { title: 'Different deal' });
    expect(
      (await api.as(t.admin).post(`/v2/deals/${otherDeal.id}/activities/${task.id}/complete`))
        .status,
    ).toBe(404);
  });

  it('TW-DEAL-016 / D-20: reopening a task clears its reminder stamp so an overdue task can be reminded again', async () => {
    const d = await api.deal(t.admin, { title: 'Remind' });
    const task = (
      await api
        .as(t.admin)
        .post(`/v2/deals/${d.id}/activities`)
        .send({ type: 'task', body: 'Soon', dueAt: '2026-01-01T00:00:00Z' })
    ).body;
    await h.owner.query(
      `UPDATE deal_activities SET reminded_at = now(), done_at = now() WHERE uuid = $1`,
      [task.id],
    );
    await api.as(t.admin).post(`/v2/deals/${d.id}/activities/${task.id}/reopen`);
    expect(
      (
        await h.owner.query(`SELECT reminded_at, done_at FROM deal_activities WHERE uuid = $1`, [
          task.id,
        ])
      ).rows[0],
    ).toEqual({
      reminded_at: null,
      done_at: null,
    });
  });

  it('TW-DEAL-016: tasks across deals list mine, overdue and done, soonest due first with undated tasks last', async () => {
    const mate = await api.member(t, 'mate3', [...DEAL_VIEWER, ['record.deals.update']]);
    const mateUuid = await api.userUuid(mate.userId);
    const d = await api.deal(t.admin, { title: 'Tasks deal' });
    const add = async (body: string, extra: Record<string, unknown>) =>
      (
        await api
          .as(t.admin)
          .post(`/v2/deals/${d.id}/activities`)
          .send({ type: 'task', body, ...extra })
      ).body;
    await add('undated', {});
    await add('later', { dueAt: '2030-01-01T00:00:00Z' });
    const overdue = await add('overdue', { dueAt: '2020-01-01T00:00:00Z' });
    await add('theirs', { dueAt: '2020-06-01T00:00:00Z', assigneeId: mateUuid });
    const finished = await add('finished', { dueAt: '2020-03-01T00:00:00Z' });
    await api.as(t.admin).post(`/v2/deals/${d.id}/activities/${finished.id}/complete`);

    const mine = await api.as(t.admin).get(`/v2/deals/tasks?mine=true&dealId=${d.id}`);
    expect(mine.body.data.map((x: { body: string }) => x.body)).toEqual([
      'overdue',
      'later',
      'undated',
    ]);
    expect(mine.body.data[0].deal).toMatchObject({ title: 'Tasks deal' });
    const late = await api.as(t.admin).get(`/v2/deals/tasks?overdue=true&dealId=${d.id}`);
    expect(late.body.data.map((x: { body: string }) => x.body)).toEqual(['overdue', 'theirs']);
    const done = await api.as(t.admin).get(`/v2/deals/tasks?status=done&dealId=${d.id}`);
    expect(done.body.data.map((x: { body: string }) => x.body)).toEqual(['finished']);
    const page1 = await api.as(t.admin).get(`/v2/deals/tasks?limit=2&dealId=${d.id}`);
    expect(page1.body.page.hasMore).toBe(true);
    const page2 = await api
      .as(t.admin)
      .get(`/v2/deals/tasks?limit=2&dealId=${d.id}&cursor=${page1.body.page.nextCursor}`);
    expect([...page1.body.data, ...page2.body.data].map((x: { id: string }) => x.id)).toContain(
      overdue.id,
    );
    expect(
      new Set([...page1.body.data, ...page2.body.data].map((x: { id: string }) => x.id)).size,
    ).toBe(page1.body.data.length + page2.body.data.length);
  });

  it('TW-DEAL-015: an assignee who is not an active member is 422; the timeline of a deal in another workspace is 404', async () => {
    const d = await api.deal(t.admin, { title: 'Assign' });
    const foreign = await api.userUuid(other.adminUserId);
    const res = await api
      .as(t.admin)
      .post(`/v2/deals/${d.id}/activities`)
      .send({ type: 'task', body: 'x', assigneeId: foreign });
    expect(res.status).toBe(422);
    expect(problem(res)).toBe('DEAL_OWNER_INVALID');
    expect(
      (
        await api
          .as(other.admin)
          .post(`/v2/deals/${d.id}/activities`)
          .send({ type: 'note', body: 'x' })
      ).status,
    ).toBe(404);
  });

  it('TW-DEAL-015: adding an activity writes one audit row and one deal.activity_added event', async () => {
    const d = await api.deal(t.admin, { title: 'Evented' });
    const before = (await api.events(t.orgId, 'deal.activity_added')).length;
    await api
      .as(t.admin)
      .post(`/v2/deals/${d.id}/activities`)
      .send({ type: 'call', body: 'Spoke to them' });
    const events = await api.events(t.orgId, 'deal.activity_added');
    expect(events.length).toBe(before + 1);
    expect(events[events.length - 1]).toMatchObject({ uuid: d.id, type: 'call' });
  });
});
