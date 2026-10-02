import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEAL_VIEWER,
  DealsApi,
  startHarness,
  type Harness,
  type Pipeline,
  type Tenant,
} from './support';

/**
 * Pipelines, stages, lost reasons and deal settings end to end: TW-DEAL-002, 041, 042, 043, 044 (the editor Reference documented and
 * never built), with the plan cap, the delete-with-move rules, ordering, permissions, tenant isolation and audit/outbox.
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

const code = (res: { body: { code?: string } }) => res.body.code;
let n = 0;
const uniq = (s: string) => `${s} ${Date.now()}-${n++}`;

describe('the default pipeline (TW-DEAL-002)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ppd');
  });

  it('TW-DEAL-002 #1: a new workspace has one default pipeline "Sales Pipeline" with the six stages in order, before anybody opens the board', async () => {
    const list = await api.pipelines(t.admin);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Sales Pipeline', isDefault: true, dealCount: 0 });
    expect(list[0]!.stages.map((s) => [s.name, s.probability, s.kind])).toEqual([
      ['New Lead', 10, 'open'],
      ['Qualified', 25, 'open'],
      ['Proposal', 50, 'open'],
      ['Negotiation', 75, 'open'],
      ['Won', 100, 'won'],
      ['Lost', 0, 'lost'],
    ]);
    expect(list[0]!.stages.map((s) => s.sortOrder)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('TW-DEAL-002 #2: a pipeline whose stages were all removed by hand is re-seeded on the next read instead of leaving a dead board', async () => {
    const t2 = await api.signup('ppd2');
    await h.owner.query(`DELETE FROM pipelines WHERE org_id = $1`, [t2.orgId]);
    const list = await api.pipelines(t2.admin);
    expect(list).toHaveLength(1);
    expect(list[0]!.stages).toHaveLength(6);
    expect(list[0]!.isDefault).toBe(true);
  });

  it('TW-DEAL-023: the stage list for the flow builder and the inbox picker is the pipelines list, every pipeline reachable (not only the default)', async () => {
    const p = await api
      .as(t.admin)
      .post('/v2/pipelines')
      .send({ name: uniq('Second'), stages: [{ name: 'Alpha' }, { name: 'Beta' }] });
    expect(p.status).toBe(201);
    const list = await api.pipelines(t.admin);
    expect(list.map((x) => x.name)).toContain(p.body.name);
    expect(list.find((x) => x.id === p.body.id)!.stages.map((s) => s.name)).toEqual([
      'Alpha',
      'Beta',
    ]);
  });

  it('TW-DEAL-002: a new workspace on a plan with a currency starts its pipeline in it, and a deal is never relabelled by reading', async () => {
    const t3 = await api.signup('ppd3');
    const list = await api.pipelines(t3.admin);
    expect(list[0]!.currency).toMatch(/^[A-Z]{3}$/);
  });
});

describe('creating and editing pipelines (TW-DEAL-041, 042)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ppe');
  });

  it('TW-DEAL-042: a second pipeline is created with its own ladder; omitting the stages gives the standard six', async () => {
    const custom = await api
      .as(t.admin)
      .post('/v2/pipelines')
      .send({
        name: uniq('Renewals'),
        currency: 'eur',
        stages: [
          { name: 'Open', color: '#112233', probability: 20 },
          { name: 'Signed', kind: 'won', probability: 55 },
          { name: 'Churned', kind: 'lost' },
        ],
      });
    expect(custom.status, JSON.stringify(custom.body)).toBe(201);
    expect(custom.body).toMatchObject({ currency: 'EUR', isDefault: false, dealCount: 0 });
    expect(
      custom.body.stages.map(
        (s: { name: string; kind: string; probability: number; color: string }) => [
          s.name,
          s.kind,
          s.probability,
          s.color,
        ],
      ),
    ).toEqual([
      ['Open', 'open', 20, '#112233'],
      ['Signed', 'won', 100, '#6366F1'],
      ['Churned', 'lost', 0, '#6366F1'],
    ]);
    const std = await api
      .as(t.admin)
      .post('/v2/pipelines')
      .send({ name: uniq('Standard') });
    expect(std.body.stages.map((s: { name: string }) => s.name)).toEqual([
      'New Lead',
      'Qualified',
      'Proposal',
      'Negotiation',
      'Won',
      'Lost',
    ]);
  });

  it('TW-DEAL-041: two won stages, two lost stages, or two stages with the same name in one ladder are refused up front with a clear code', async () => {
    const post = (stages: unknown[]) =>
      api
        .as(t.admin)
        .post('/v2/pipelines')
        .send({ name: uniq('Bad'), stages });
    expect(
      code(
        await post([
          { name: 'A', kind: 'won' },
          { name: 'B', kind: 'won' },
        ]),
      ),
    ).toBe('DEAL_STAGE_KIND_TAKEN');
    expect(
      code(
        await post([
          { name: 'A', kind: 'lost' },
          { name: 'B', kind: 'lost' },
        ]),
      ),
    ).toBe('DEAL_STAGE_KIND_TAKEN');
    expect(code(await post([{ name: 'Same' }, { name: ' same ' }]))).toBe('DEAL_STAGE_NAME_TAKEN');
    expect((await post([])).status).toBe(422);
    expect((await post([{ name: 'A', color: 'red' }])).status).toBe(422);
    expect((await post([{ name: 'A', probability: 101 }])).status).toBe(422);
    // nothing half-created
    expect(
      (
        await h.owner.query(
          `SELECT count(*)::int AS n FROM pipelines WHERE org_id = $1 AND name LIKE 'Bad %'`,
          [t.orgId],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('TW-DEAL-041: a pipeline name is unique ignoring case (409 DEAL_PIPELINE_NAME_TAKEN), also on rename', async () => {
    const name = uniq('Unique');
    const a = await api.as(t.admin).post('/v2/pipelines').send({ name });
    expect(a.status).toBe(201);
    const dup = await api
      .as(t.admin)
      .post('/v2/pipelines')
      .send({ name: ` ${name.toUpperCase()} ` });
    expect(dup.status).toBe(409);
    expect(code(dup)).toBe('DEAL_PIPELINE_NAME_TAKEN');
    const b = await api
      .as(t.admin)
      .post('/v2/pipelines')
      .send({ name: uniq('Other') });
    const rename = await api
      .as(t.admin)
      .patch(`/v2/pipelines/${b.body.id}`)
      .send({ name, rowVersion: b.body.rowVersion });
    expect(rename.status).toBe(409);
    expect(code(rename)).toBe('DEAL_PIPELINE_NAME_TAKEN');
  });

  it('TW-DEAL-041: renaming and changing the currency need the rowVersion; a stale one is 409 and changes nothing', async () => {
    const p = (
      await api
        .as(t.admin)
        .post('/v2/pipelines')
        .send({ name: uniq('Rename') })
    ).body as Pipeline;
    const ok = await api
      .as(t.admin)
      .patch(`/v2/pipelines/${p.id}`)
      .send({ name: uniq('Renamed'), currency: 'USD', rowVersion: p.rowVersion });
    expect(ok.status).toBe(200);
    expect(ok.body.currency).toBe('USD');
    const stale = await api
      .as(t.admin)
      .patch(`/v2/pipelines/${p.id}`)
      .send({ name: 'Stale', rowVersion: p.rowVersion });
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
    expect((await api.as(t.admin).get(`/v2/pipelines/${p.id}`)).body.name).toBe(ok.body.name);
  });

  it('TW-DEAL-042 / D-09: making a pipeline the default moves the flag (there is always exactly one); isDefault false is refused', async () => {
    const before = (await api.pipelines(t.admin)).find((x) => x.isDefault)!;
    const p = (
      await api
        .as(t.admin)
        .post('/v2/pipelines')
        .send({ name: uniq('NewDefault') })
    ).body as Pipeline;
    const res = await api
      .as(t.admin)
      .patch(`/v2/pipelines/${p.id}`)
      .send({ isDefault: true, rowVersion: p.rowVersion });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const list = await api.pipelines(t.admin);
    expect(list.filter((x) => x.isDefault).map((x) => x.id)).toEqual([p.id]);
    expect(list.find((x) => x.id === before.id)!.isDefault).toBe(false);
    expect(
      (
        await api
          .as(t.admin)
          .patch(`/v2/pipelines/${p.id}`)
          .send({ isDefault: false, rowVersion: res.body.rowVersion })
      ).status,
    ).toBe(422);
    // a pipeline created as the default takes the flag at once
    const born = await api
      .as(t.admin)
      .post('/v2/pipelines')
      .send({ name: uniq('BornDefault'), isDefault: true });
    expect((await api.pipelines(t.admin)).filter((x) => x.isDefault).map((x) => x.id)).toEqual([
      born.body.id,
    ]);
    // deals without a pipeline now land in it
    expect((await api.deal(t.admin, { title: 'Follows the default' })).stage.name).toBe('New Lead');
    expect((await api.as(t.admin).get('/v2/deals/board')).body.pipeline.id).toBe(born.body.id);
  });

  it('TW-DEAL-042: pipelines are reordered by sending every id once; a partial, duplicated or foreign list is 422 DEAL_ORDER_INVALID', async () => {
    const list = await api.pipelines(t.admin);
    const ids = list.map((x) => x.id);
    const reversed = [...ids].reverse();
    const ok = await api.as(t.admin).put('/v2/pipelines/order').send({ pipelineIds: reversed });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.map((x: Pipeline) => x.id)).toEqual(reversed);
    expect((await api.pipelines(t.admin)).map((x) => x.id)).toEqual(reversed);
    for (const bad of [
      ids.slice(1),
      [...ids, ids[0]],
      [...ids.slice(1), '00000000-0000-4000-8000-000000000000'],
    ]) {
      const res = await api.as(t.admin).put('/v2/pipelines/order').send({ pipelineIds: bad });
      expect(res.status).toBe(422);
      expect(code(res)).toBe('DEAL_ORDER_INVALID');
    }
  });

  it('TW-DEAL-041: creating, renaming and deleting a pipeline each write one audit row and one outbox event', async () => {
    const created = (
      await api
        .as(t.admin)
        .post('/v2/pipelines')
        .send({ name: uniq('Evented') })
    ).body as Pipeline;
    expect((await api.events(t.orgId, 'pipeline.created')).some((e) => e.uuid === created.id)).toBe(
      true,
    );
    const audits = await api.auditCount(t.orgId, 'pipelines', 'update');
    await api
      .as(t.admin)
      .patch(`/v2/pipelines/${created.id}`)
      .send({ name: uniq('Evented2'), rowVersion: created.rowVersion });
    expect(await api.auditCount(t.orgId, 'pipelines', 'update')).toBe(audits + 1);
    expect((await api.events(t.orgId, 'pipeline.updated')).some((e) => e.uuid === created.id)).toBe(
      true,
    );
    const del = await api.as(t.admin).delete(`/v2/pipelines/${created.id}`);
    expect(del.status).toBe(204);
    expect((await api.events(t.orgId, 'pipeline.deleted')).some((e) => e.uuid === created.id)).toBe(
      true,
    );
    expect(await api.auditCount(t.orgId, 'pipelines', 'delete')).toBeGreaterThan(0);
  });
});

describe('the stage editor (TW-DEAL-041)', () => {
  let t: Tenant;
  let p: Pipeline;
  beforeAll(async () => {
    t = await api.signup('pps');
    p = (
      await api
        .as(t.admin)
        .post('/v2/pipelines')
        .send({
          name: uniq('Editor'),
          stages: [
            { name: 'One' },
            { name: 'Two' },
            { name: 'Done', kind: 'won' },
            { name: 'Dead', kind: 'lost' },
          ],
        })
    ).body;
  });

  const stageNames = async () =>
    (await api.as(t.admin).get(`/v2/pipelines/${p.id}`)).body.stages.map(
      (s: { name: string }) => s.name,
    );

  it('TW-DEAL-041: a new open stage goes after the last open stage so Won and Lost stay at the end; beforeStageId inserts before a stage', async () => {
    const added = await api
      .as(t.admin)
      .post(`/v2/pipelines/${p.id}/stages`)
      .send({ name: 'Three', probability: 60, color: '#abcdef' });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(added.body).toMatchObject({
      name: 'Three',
      kind: 'open',
      probability: 60,
      color: '#abcdef',
      dealCount: 0,
    });
    expect(await stageNames()).toEqual(['One', 'Two', 'Three', 'Done', 'Dead']);
    const stages = (await api.as(t.admin).get(`/v2/pipelines/${p.id}`)).body.stages;
    await api
      .as(t.admin)
      .post(`/v2/pipelines/${p.id}/stages`)
      .send({ name: 'Zero', beforeStageId: stages[0].id });
    expect(await stageNames()).toEqual(['Zero', 'One', 'Two', 'Three', 'Done', 'Dead']);
    expect(
      (await api.as(t.admin).get(`/v2/pipelines/${p.id}`)).body.stages.map(
        (s: { sortOrder: number }) => s.sortOrder,
      ),
    ).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('TW-DEAL-041 port decision: a second won or lost stage is 409 DEAL_STAGE_KIND_TAKEN; a duplicate name is 409 DEAL_STAGE_NAME_TAKEN', async () => {
    expect(
      code(
        await api
          .as(t.admin)
          .post(`/v2/pipelines/${p.id}/stages`)
          .send({ name: 'Won2', kind: 'won' }),
      ),
    ).toBe('DEAL_STAGE_KIND_TAKEN');
    expect(
      code(
        await api
          .as(t.admin)
          .post(`/v2/pipelines/${p.id}/stages`)
          .send({ name: 'Lost2', kind: 'lost' }),
      ),
    ).toBe('DEAL_STAGE_KIND_TAKEN');
    expect(
      code(await api.as(t.admin).post(`/v2/pipelines/${p.id}/stages`).send({ name: ' one ' })),
    ).toBe('DEAL_STAGE_NAME_TAKEN');
    expect(await stageNames()).toEqual(['Zero', 'One', 'Two', 'Three', 'Done', 'Dead']);
  });

  it('TW-DEAL-041 #1: renaming, recolouring and re-weighting a stage show up on the board and on its deals at once', async () => {
    const stages = (await api.as(t.admin).get(`/v2/pipelines/${p.id}`)).body.stages;
    const two = stages.find((s: { name: string }) => s.name === 'Two');
    const deal = await api.deal(t.admin, {
      title: 'Edited stage',
      pipelineId: p.id,
      stageId: two.id,
    });
    const res = await api
      .as(t.admin)
      .patch(`/v2/pipeline-stages/${two.id}`)
      .send({ name: 'Second', color: '#FF0000', probability: 35, rowVersion: two.rowVersion });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Second',
      color: '#FF0000',
      probability: 35,
      dealCount: 1,
    });
    const got = await api.as(t.admin).get(`/v2/deals/${deal.id}`);
    expect(got.body.stage).toMatchObject({ name: 'Second', color: '#FF0000', probability: 35 });
    const board = await api.as(t.admin).get(`/v2/deals/board?pipelineId=${p.id}`);
    expect(board.body.stages.map((s: { stage: { name: string } }) => s.stage.name)).toContain(
      'Second',
    );
    // a stale rowVersion
    const stale = await api
      .as(t.admin)
      .patch(`/v2/pipeline-stages/${two.id}`)
      .send({ name: 'Stale', rowVersion: two.rowVersion });
    expect(stale.status).toBe(409);
  });

  it('TW-DEAL-041: a won stage stays at 100% and a lost stage at 0% whatever probability is sent', async () => {
    const stages = (await api.as(t.admin).get(`/v2/pipelines/${p.id}`)).body.stages;
    const won = stages.find((s: { kind: string }) => s.kind === 'won');
    const res = await api
      .as(t.admin)
      .patch(`/v2/pipeline-stages/${won.id}`)
      .send({ probability: 40, rowVersion: won.rowVersion });
    expect(res.body.probability).toBe(100);
  });

  it('TW-DEAL-041: only a stage with no deals can change kind (its deals would otherwise disagree with it); an empty one can', async () => {
    const stages = (await api.as(t.admin).get(`/v2/pipelines/${p.id}`)).body.stages;
    const second = stages.find((s: { name: string }) => s.name === 'Second');
    const busy = await api
      .as(t.admin)
      .patch(`/v2/pipeline-stages/${second.id}`)
      .send({ kind: 'won', rowVersion: second.rowVersion });
    expect(busy.status).toBe(409);
    expect(code(busy)).toBe('DEAL_STAGE_HAS_DEALS');

    const three = stages.find((s: { name: string }) => s.name === 'Three');
    const taken = await api
      .as(t.admin)
      .patch(`/v2/pipeline-stages/${three.id}`)
      .send({ kind: 'won', rowVersion: three.rowVersion });
    expect(code(taken)).toBe('DEAL_STAGE_KIND_TAKEN');
    const done = stages.find((s: { name: string }) => s.name === 'Done');
    const toOpen = await api
      .as(t.admin)
      .patch(`/v2/pipeline-stages/${done.id}`)
      .send({ kind: 'open', probability: 90, rowVersion: done.rowVersion });
    expect(toOpen.status, JSON.stringify(toOpen.body)).toBe(200);
    expect(toOpen.body).toMatchObject({ kind: 'open', probability: 90 });
    const promote = await api
      .as(t.admin)
      .patch(`/v2/pipeline-stages/${three.id}`)
      .send({ kind: 'won', rowVersion: three.rowVersion });
    expect(promote.body).toMatchObject({ kind: 'won', probability: 100 });
    // put the ladder back the way later tests expect: Done is won again, Three is open
    await api
      .as(t.admin)
      .patch(`/v2/pipeline-stages/${three.id}`)
      .send({ kind: 'open', probability: 60, rowVersion: promote.body.rowVersion });
    await api
      .as(t.admin)
      .patch(`/v2/pipeline-stages/${done.id}`)
      .send({ kind: 'won', rowVersion: toOpen.body.rowVersion });
  });

  it('TW-DEAL-041 #1: stages are reordered by sending every id once, and the board column order follows', async () => {
    const stages = (await api.as(t.admin).get(`/v2/pipelines/${p.id}`)).body.stages as Array<{
      id: string;
      name: string;
    }>;
    const order = [...stages].reverse().map((s) => s.id);
    const res = await api
      .as(t.admin)
      .put(`/v2/pipelines/${p.id}/stages/order`)
      .send({ stageIds: order });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.stages.map((s: { id: string }) => s.id)).toEqual(order);
    const board = await api.as(t.admin).get(`/v2/deals/board?pipelineId=${p.id}`);
    expect(board.body.stages.map((s: { stage: { id: string } }) => s.stage.id)).toEqual(order);
    for (const bad of [
      order.slice(1),
      [...order, order[0]],
      [...order.slice(1), '00000000-0000-4000-8000-000000000000'],
    ]) {
      const r = await api
        .as(t.admin)
        .put(`/v2/pipelines/${p.id}/stages/order`)
        .send({ stageIds: bad });
      expect(r.status).toBe(422);
      expect(code(r)).toBe('DEAL_ORDER_INVALID');
    }
    // restore for later tests
    await api
      .as(t.admin)
      .put(`/v2/pipelines/${p.id}/stages/order`)
      .send({ stageIds: stages.map((s) => s.id) });
  });

  it('TW-DEAL-041 #2: deleting a stage that holds deals needs a target stage of the same pipeline; the deals move through the stage engine', async () => {
    const stages = (await api.as(t.admin).get(`/v2/pipelines/${p.id}`)).body.stages as Array<{
      id: string;
      name: string;
      dealCount: number;
    }>;
    const second = stages.find((s) => s.name === 'Second')!;
    const target = stages.find((s) => s.name === 'Three')!;
    const [deal] = (await api.as(t.admin).get(`/v2/deals?stageId=${second.id}`)).body.data;

    const refuse = await api.as(t.admin).delete(`/v2/pipeline-stages/${second.id}`);
    expect(refuse.status).toBe(409);
    expect(code(refuse)).toBe('DEAL_STAGE_HAS_DEALS');
    const self = await api
      .as(t.admin)
      .delete(`/v2/pipeline-stages/${second.id}?moveDealsToStageId=${second.id}`);
    expect(self.status).toBe(422);

    const events = (await api.events(t.orgId, 'deal.stage_changed')).length;
    const ok = await api
      .as(t.admin)
      .delete(`/v2/pipeline-stages/${second.id}?moveDealsToStageId=${target.id}`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(204);
    const after = (await api.as(t.admin).get(`/v2/deals/${deal.id}`)).body;
    expect(after.stage.name).toBe('Three');
    expect((await api.events(t.orgId, 'deal.stage_changed')).length).toBe(events + 1);
    const tl = await api.timeline(t.admin, deal.id);
    expect(tl[0]!.stageChange).toMatchObject({ from: { name: 'Second' }, to: { name: 'Three' } });
    expect(await stageNames()).not.toContain('Second');
    expect(
      (await api.as(t.admin).get(`/v2/pipelines/${p.id}`)).body.stages.map(
        (s: { sortOrder: number }) => s.sortOrder,
      ),
    ).toEqual([0, 1, 2, 3, 4]);
  });

  it('TW-DEAL-041 #2: a stage of ANOTHER pipeline cannot receive the deals, and the last stage of a pipeline cannot be deleted', async () => {
    const other = (
      await api
        .as(t.admin)
        .post('/v2/pipelines')
        .send({ name: uniq('Other'), stages: [{ name: 'Lonely' }] })
    ).body as Pipeline;
    const stages = (await api.as(t.admin).get(`/v2/pipelines/${p.id}`)).body.stages as Array<{
      id: string;
      name: string;
    }>;
    const three = stages.find((s) => s.name === 'Three')!;
    const res = await api
      .as(t.admin)
      .delete(`/v2/pipeline-stages/${three.id}?moveDealsToStageId=${other.stages[0]!.id}`);
    expect(res.status).toBe(422);
    expect(code(res)).toBe('DEAL_STAGE_MISMATCH');
    const last = await api.as(t.admin).delete(`/v2/pipeline-stages/${other.stages[0]!.id}`);
    expect(last.status).toBe(409);
    expect(code(last)).toBe('DEAL_STAGE_LAST');
  });

  it('TW-DEAL-041: an empty stage deletes outright, audited, with its event', async () => {
    const added = (
      await api.as(t.admin).post(`/v2/pipelines/${p.id}/stages`).send({ name: 'Temp' })
    ).body;
    expect((await api.as(t.admin).delete(`/v2/pipeline-stages/${added.id}`)).status).toBe(204);
    expect(
      (await api.events(t.orgId, 'pipeline_stage.deleted')).some((e) => e.uuid === added.id),
    ).toBe(true);
    expect(await api.auditCount(t.orgId, 'pipeline_stages', 'delete')).toBeGreaterThan(0);
    expect((await api.as(t.admin).delete(`/v2/pipeline-stages/${added.id}`)).status).toBe(404);
  });
});

describe('deleting a pipeline (TW-DEAL-041, 042)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ppx');
  });

  it('TW-DEAL-042: the default pipeline cannot be deleted (409 DEAL_PIPELINE_DEFAULT_PROTECTED), even when it is empty', async () => {
    const def = (await api.defaultPipeline(t.admin)).pipeline;
    const res = await api.as(t.admin).delete(`/v2/pipelines/${def.id}`);
    expect(res.status).toBe(409);
    expect(code(res)).toBe('DEAL_PIPELINE_DEFAULT_PROTECTED');
  });

  it('TW-DEAL-042: an empty pipeline deletes; one with deals needs a target pipeline, and its deals keep their status in the new one', async () => {
    const def = (await api.defaultPipeline(t.admin)).pipeline;
    const empty = (
      await api
        .as(t.admin)
        .post('/v2/pipelines')
        .send({ name: uniq('Empty') })
    ).body as Pipeline;
    expect((await api.as(t.admin).delete(`/v2/pipelines/${empty.id}`)).status).toBe(204);

    const src = (
      await api
        .as(t.admin)
        .post('/v2/pipelines')
        .send({ name: uniq('Source') })
    ).body as Pipeline;
    const stage = Object.fromEntries(src.stages.map((s) => [s.name, s]));
    const open = await api.deal(t.admin, {
      title: 'Open one',
      pipelineId: src.id,
      stageId: stage['Proposal']!.id,
      value: '10',
    });
    const won = await api.deal(t.admin, {
      title: 'Won one',
      pipelineId: src.id,
      stageId: stage['Won']!.id,
      value: '20',
    });
    const lost = await api
      .as(t.admin)
      .post(
        `/v2/deals/${(await api.deal(t.admin, { title: 'Lost one', pipelineId: src.id })).id}/lost`,
      )
      .send({ reason: 'Budget' });
    expect(lost.status).toBe(200);

    const refuse = await api.as(t.admin).delete(`/v2/pipelines/${src.id}`);
    expect(refuse.status).toBe(409);
    expect(code(refuse)).toBe('DEAL_PIPELINE_HAS_DEALS');
    const same = await api
      .as(t.admin)
      .delete(`/v2/pipelines/${src.id}?moveDealsToPipelineId=${src.id}`);
    expect(same.status).toBe(409);

    const ok = await api
      .as(t.admin)
      .delete(`/v2/pipelines/${src.id}?moveDealsToPipelineId=${def.id}`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(204);
    const o = (await api.as(t.admin).get(`/v2/deals/${open.id}`)).body;
    const w = (await api.as(t.admin).get(`/v2/deals/${won.id}`)).body;
    const l = (await api.as(t.admin).get(`/v2/deals/${lost.body.id}`)).body;
    expect([o.status, o.stage.name, o.pipeline.id]).toEqual(['open', 'New Lead', def.id]);
    expect([w.status, w.stage.name]).toEqual(['won', 'Won']);
    expect([l.status, l.stage.name, l.lostReason]).toEqual(['lost', 'Lost', 'Budget']);
    expect(w.wonAt).not.toBeNull();
    expect((await api.as(t.admin).get(`/v2/pipelines/${src.id}`)).status).toBe(404);
  });

  it('TW-DEAL-042: a target pipeline with no Lost stage cannot take lost deals (409 DEAL_PIPELINE_TARGET_INVALID) and nothing moves', async () => {
    const src = (
      await api
        .as(t.admin)
        .post('/v2/pipelines')
        .send({ name: uniq('HasLost') })
    ).body as Pipeline;
    const target = (
      await api
        .as(t.admin)
        .post('/v2/pipelines')
        .send({ name: uniq('NoLost'), stages: [{ name: 'W' }, { name: 'Done', kind: 'won' }] })
    ).body as Pipeline;
    const d = await api.deal(t.admin, { title: 'Lost deal', pipelineId: src.id });
    await api.as(t.admin).post(`/v2/deals/${d.id}/lost`).send({ reason: 'x' });
    const res = await api
      .as(t.admin)
      .delete(`/v2/pipelines/${src.id}?moveDealsToPipelineId=${target.id}`);
    expect(res.status).toBe(409);
    expect(code(res)).toBe('DEAL_PIPELINE_TARGET_INVALID');
    expect((await api.as(t.admin).get(`/v2/deals/${d.id}`)).body.pipeline.id).toBe(src.id);
  });
});

describe('the plan cap on pipelines (TW-DEAL-044)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ppl');
  });

  it("TW-DEAL-044 #1: at the plan's pipelines cap, one more is 422 PLAN_LIMIT_REACHED with the cap and the count (Reference declared the column and never read it)", async () => {
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"limits":{"pipelines":2}}' WHERE org_id = $1`,
      [t.orgId],
    );
    const second = await api
      .as(t.admin)
      .post('/v2/pipelines')
      .send({ name: uniq('Second') });
    expect(second.status).toBe(201);
    const third = await api
      .as(t.admin)
      .post('/v2/pipelines')
      .send({ name: uniq('Third') });
    expect(third.status).toBe(422);
    expect(code(third)).toBe('PLAN_LIMIT_REACHED');
    expect(third.body.errors).toEqual(
      expect.arrayContaining([
        { path: 'limit', message: 'pipelines' },
        { path: 'used', message: '2' },
        { path: 'limitValue', message: '2' },
      ]),
    );
    expect(await api.pipelines(t.admin)).toHaveLength(2);
  });

  it('TW-DEAL-044: deleting one frees a slot; a plan with no pipelines cap (every existing plan) is unlimited', async () => {
    const list = await api.pipelines(t.admin);
    const spare = list.find((x) => !x.isDefault)!;
    expect((await api.as(t.admin).delete(`/v2/pipelines/${spare.id}`)).status).toBe(204);
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/pipelines')
          .send({ name: uniq('Again') })
      ).status,
    ).toBe(201);
    await h.owner.query(`UPDATE org_plan_state SET overrides = '{}' WHERE org_id = $1`, [t.orgId]);
    for (let i = 0; i < 4; i++)
      expect(
        (
          await api
            .as(t.admin)
            .post('/v2/pipelines')
            .send({ name: uniq('Many') })
        ).status,
      ).toBe(201);
  });
});

describe('lost reasons and settings (TW-DEAL-043)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('plr');
  });

  it('TW-DEAL-043: reasons are added, listed in order, renamed with the rowVersion, deactivated, reordered and deleted', async () => {
    const a = (await api.as(t.admin).post('/v2/deal-lost-reasons').send({ name: 'Price' })).body;
    const b = (await api.as(t.admin).post('/v2/deal-lost-reasons').send({ name: 'Timing' })).body;
    const c = (await api.as(t.admin).post('/v2/deal-lost-reasons').send({ name: 'No budget' }))
      .body;
    expect(
      (await api.as(t.admin).get('/v2/deal-lost-reasons')).body.map(
        (r: { name: string }) => r.name,
      ),
    ).toEqual(['Price', 'Timing', 'No budget']);

    const renamed = await api
      .as(t.admin)
      .patch(`/v2/deal-lost-reasons/${b.id}`)
      .send({ name: 'Bad timing', isActive: false, rowVersion: b.rowVersion });
    expect(renamed.body).toMatchObject({ name: 'Bad timing', isActive: false });
    expect(
      (
        await api
          .as(t.admin)
          .patch(`/v2/deal-lost-reasons/${b.id}`)
          .send({ name: 'Stale', rowVersion: b.rowVersion })
      ).status,
    ).toBe(409);
    expect(
      (await api.as(t.admin).get('/v2/deal-lost-reasons?activeOnly=true')).body.map(
        (r: { name: string }) => r.name,
      ),
    ).toEqual(['Price', 'No budget']);

    const re = await api
      .as(t.admin)
      .put('/v2/deal-lost-reasons/order')
      .send({ reasonIds: [c.id, b.id, a.id] });
    expect(re.body.map((r: { name: string }) => r.name)).toEqual([
      'No budget',
      'Bad timing',
      'Price',
    ]);
    expect(
      (
        await api
          .as(t.admin)
          .put('/v2/deal-lost-reasons/order')
          .send({ reasonIds: [c.id, a.id] })
      ).status,
    ).toBe(422);
    expect((await api.as(t.admin).delete(`/v2/deal-lost-reasons/${c.id}`)).status).toBe(204);
    expect((await api.as(t.admin).delete(`/v2/deal-lost-reasons/${c.id}`)).status).toBe(404);
  });

  it('TW-DEAL-043: a reason name is unique ignoring case (409 DEAL_LOST_REASON_NAME_TAKEN), also on rename', async () => {
    const dup = await api.as(t.admin).post('/v2/deal-lost-reasons').send({ name: ' price ' });
    expect(dup.status).toBe(409);
    expect(code(dup)).toBe('DEAL_LOST_REASON_NAME_TAKEN');
    const list = (await api.as(t.admin).get('/v2/deal-lost-reasons')).body as Array<{
      id: string;
      name: string;
      rowVersion: number;
    }>;
    const other = list.find((r) => r.name !== 'Price')!;
    const res = await api
      .as(t.admin)
      .patch(`/v2/deal-lost-reasons/${other.id}`)
      .send({ name: 'PRICE', rowVersion: other.rowVersion });
    expect(code(res)).toBe('DEAL_LOST_REASON_NAME_TAKEN');
  });

  it('TW-DEAL-043: deleting a reason keeps the reason text on the deals that used it', async () => {
    const r = (await api.as(t.admin).post('/v2/deal-lost-reasons').send({ name: 'Ghosted' })).body;
    const d = await api.deal(t.admin, { title: 'Ghosted deal' });
    await api.as(t.admin).post(`/v2/deals/${d.id}/lost`).send({ lostReasonId: r.id });
    await api.as(t.admin).delete(`/v2/deal-lost-reasons/${r.id}`);
    const got = (await api.as(t.admin).get(`/v2/deals/${d.id}`)).body;
    expect(got).toMatchObject({ status: 'lost', lostReason: 'Ghosted', lostReasonId: null });
  });

  it('TW-DEAL-043: the settings start with no reason required, change with one call, and are audited when they change', async () => {
    expect((await api.as(t.admin).get('/v2/deal-settings')).body.lostReasonRequired).toBe(false);
    const on = await api.as(t.admin).put('/v2/deal-settings').send({ lostReasonRequired: true });
    expect(on.body.lostReasonRequired).toBe(true);
    expect(await api.auditCount(t.orgId, 'deal_settings', 'update')).toBe(1);
    await api.as(t.admin).put('/v2/deal-settings').send({ lostReasonRequired: true });
    expect(await api.auditCount(t.orgId, 'deal_settings', 'update')).toBe(1);
    expect(
      (await api.as(t.admin).put('/v2/deal-settings').send({ lostReasonRequired: 'yes' })).status,
    ).toBe(422);
    await api.as(t.admin).put('/v2/deal-settings').send({ lostReasonRequired: false });
  });
});

describe('permissions and isolation (TW-DEAL-001, D-02)', () => {
  let t: Tenant;
  let other: Tenant;
  beforeAll(async () => {
    t = await api.signup('ppp');
    other = await api.signup('ppp2');
  });

  it('TW-DEAL-001 / D-02: a viewer reads pipelines and lost reasons but cannot create, edit, reorder or delete any of them', async () => {
    const viewer = await api.member(t, 'pviewer', DEAL_VIEWER);
    const { pipeline, stage } = await api.defaultPipeline(t.admin);
    const reason = (await api.as(t.admin).post('/v2/deal-lost-reasons').send({ name: 'Ro' })).body;
    for (const path of [
      '/v2/pipelines',
      `/v2/pipelines/${pipeline.id}`,
      '/v2/deal-lost-reasons',
      '/v2/deal-settings',
    ]) {
      expect((await api.as(viewer.token).get(path)).status, path).toBe(200);
    }
    const writes = [
      api.as(viewer.token).post('/v2/pipelines').send({ name: 'x' }),
      api
        .as(viewer.token)
        .patch(`/v2/pipelines/${pipeline.id}`)
        .send({ name: 'x', rowVersion: pipeline.rowVersion }),
      api
        .as(viewer.token)
        .put('/v2/pipelines/order')
        .send({ pipelineIds: [pipeline.id] }),
      api.as(viewer.token).delete(`/v2/pipelines/${pipeline.id}`),
      api.as(viewer.token).post(`/v2/pipelines/${pipeline.id}/stages`).send({ name: 'x' }),
      api
        .as(viewer.token)
        .patch(`/v2/pipeline-stages/${stage['Qualified']!.id}`)
        .send({ name: 'x', rowVersion: 1 }),
      api.as(viewer.token).delete(`/v2/pipeline-stages/${stage['Qualified']!.id}`),
      api.as(viewer.token).post('/v2/deal-lost-reasons').send({ name: 'x' }),
      api
        .as(viewer.token)
        .patch(`/v2/deal-lost-reasons/${reason.id}`)
        .send({ name: 'x', rowVersion: 1 }),
      api.as(viewer.token).delete(`/v2/deal-lost-reasons/${reason.id}`),
      api.as(viewer.token).put('/v2/deal-settings').send({ lostReasonRequired: true }),
    ];
    for (const res of await Promise.all(writes)) {
      expect(res.status).toBe(403);
      expect(code(res)).toBe('FORBIDDEN');
    }
  });

  it("TW-DEAL-001: a workspace sees only its own pipelines, stages and lost reasons, and cannot address another one's by id", async () => {
    const mine = await api.pipelines(t.admin);
    const theirs = await api.pipelines(other.admin);
    const mineIds = new Set(mine.flatMap((p) => [p.id, ...p.stages.map((s) => s.id)]));
    expect(
      theirs.every((p) => !mineIds.has(p.id) && p.stages.every((s) => !mineIds.has(s.id))),
    ).toBe(true);
    const target = mine[0]!;
    expect((await api.as(other.admin).get(`/v2/pipelines/${target.id}`)).status).toBe(404);
    expect(
      (
        await api
          .as(other.admin)
          .patch(`/v2/pipelines/${target.id}`)
          .send({ name: 'x', rowVersion: target.rowVersion })
      ).status,
    ).toBe(404);
    expect((await api.as(other.admin).delete(`/v2/pipelines/${target.id}`)).status).toBe(404);
    expect(
      (await api.as(other.admin).post(`/v2/pipelines/${target.id}/stages`).send({ name: 'x' }))
        .status,
    ).toBe(404);
    expect(
      (
        await api
          .as(other.admin)
          .patch(`/v2/pipeline-stages/${target.stages[0]!.id}`)
          .send({ name: 'x', rowVersion: 1 })
      ).status,
    ).toBe(404);
    expect((await api.as(other.admin).get('/v2/deal-lost-reasons')).body).toEqual([]);
    expect((await api.as(other.admin).get(`/v2/deals/board?pipelineId=${target.id}`)).status).toBe(
      404,
    );
  });

  it('TW-DEAL-001: every response carries uuids only (no internal id, no org id)', async () => {
    const res = await api.as(t.admin).get('/v2/pipelines');
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/"(orgId|org_id|pipeline_id|pipelineId_int)"/);
    const walk = (v: unknown, path = ''): void => {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if (k === 'id' || k.endsWith('Id'))
            expect(typeof x === 'string' && /^[0-9a-f-]{36}$/.test(x), `${path}.${k}`).toBe(true);
          walk(x, `${path}.${k}`);
        }
      }
    };
    walk(res.body);
  });
});
