import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DealsApi, startHarness, type Harness, type Pipeline, type Tenant } from './support';

/**
 * The board and the reports end to end: WD-DEAL-003..007 (columns, filters, KPIs, money, ordering) and WD-DEAL-019/020/040
 * (reports). Volume comes from rows inserted with the owner connection; everything asserted goes through HTTP.
 */
let h: Harness;
let api: DealsApi;

beforeAll(async () => {
  h = await startHarness();
  api = new DealsApi(h);
  await h.owner.query(
    `INSERT INTO currencies (name, code, symbol, exchange_rate) VALUES ('US Dollar','USD','$',1), ('Indian Rupee','INR','Rs',83), ('Euro','EUR','E',0.9) ON CONFLICT (code) DO UPDATE SET exchange_rate = EXCLUDED.exchange_rate`,
  );
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const code = (res: { body: { code?: string } }) => res.body.code;
const titles = (deals: Array<{ title: string }>) => deals.map((d) => d.title);
type Column = {
  stage: { id: string; name: string };
  count: number;
  total: {
    byCurrency: Array<{ currency: string; amount: string }>;
    converted?: { currency: string; amount: string } | null;
  };
  weighted: { byCurrency: Array<{ currency: string; amount: string }> };
  deals: Array<{ id: string; title: string }>;
  page: { nextCursor: string | null; hasMore: boolean; limit: number };
};
const column = (board: { body: { stages: Column[] } }, name: string) =>
  board.body.stages.find((s) => s.stage.name === name)!;

describe('the board (WD-DEAL-003, 004)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('bd');
  });

  it('WD-DEAL-003 #1: the columns are the stages in order, each with its own count and per-currency total', async () => {
    const { stage } = await api.defaultPipeline(t.admin);
    await api.deal(t.admin, { title: 'A', value: '100', currency: 'USD' });
    await api.deal(t.admin, { title: 'B', value: '50.25', currency: 'USD' });
    await api.deal(t.admin, { title: 'C', value: '10', currency: 'EUR' });
    await api.deal(t.admin, {
      title: 'D',
      stageId: stage['Qualified']!.id,
      value: '7',
      currency: 'USD',
    });
    const board = await api.as(t.admin).get('/v2/deals/board');
    expect(board.status, JSON.stringify(board.body)).toBe(200);
    expect(board.body.stages.map((s: Column) => s.stage.name)).toEqual([
      'New Lead',
      'Qualified',
      'Proposal',
      'Negotiation',
      'Won',
      'Lost',
    ]);
    const first = column(board, 'New Lead');
    expect(first.count).toBe(3);
    expect(first.total.byCurrency).toEqual([
      { currency: 'EUR', amount: '10.00' },
      { currency: 'USD', amount: '150.25' },
    ]);
    expect(column(board, 'Qualified').count).toBe(1);
    expect(column(board, 'Proposal')).toMatchObject({
      count: 0,
      deals: [],
      total: { byCurrency: [] },
    });
  });

  it('WD-DEAL-003 #2: a pipeline is chosen with pipelineId and only its stages show; an unknown pipeline is 404 (not a silent fallback)', async () => {
    const p = (
      await api
        .as(t.admin)
        .post('/v2/pipelines')
        .send({ name: 'Second board', stages: [{ name: 'Only stage' }] })
    ).body as Pipeline;
    await api.deal(t.admin, { title: 'In second', pipelineId: p.id });
    const board = await api.as(t.admin).get(`/v2/deals/board?pipelineId=${p.id}`);
    expect(board.body.pipeline).toMatchObject({ id: p.id, name: 'Second board', isDefault: false });
    expect(board.body.stages.map((s: Column) => s.stage.name)).toEqual(['Only stage']);
    expect(titles(board.body.stages[0].deals)).toEqual(['In second']);
    const missing = await api
      .as(t.admin)
      .get('/v2/deals/board?pipelineId=00000000-0000-4000-8000-000000000000');
    expect(missing.status).toBe(404);
  });

  it('WD-DEAL-003 / D-06: a column is paged by cursor; count and totals describe the whole column, not the page', async () => {
    const { pipeline, stage } = await api.defaultPipeline(t.admin);
    const rows = Array.from({ length: 30 }, (_, i) => ({
      title: `Q${String(i + 1).padStart(2, '0')}`,
      valueMinor: 1000,
      sortOrder: (i + 1) * 1024,
    }));
    await api.seedDeals(t, pipeline.id, stage['Proposal']!.id, rows);
    const board = await api.as(t.admin).get('/v2/deals/board?limit=10');
    const col = column(board, 'Proposal');
    expect(col.count).toBe(30);
    expect(col.total.byCurrency).toEqual([{ currency: 'USD', amount: '300.00' }]);
    expect(col.deals).toHaveLength(10);
    expect(col.page).toMatchObject({ hasMore: true, limit: 10 });

    const seen = titles(col.deals);
    let cursor = col.page.nextCursor;
    let pages = 1;
    while (cursor) {
      const next = await api
        .as(t.admin)
        .get(`/v2/deals/board/stages/${stage['Proposal']!.id}/deals?limit=10&cursor=${cursor}`);
      expect(next.status, JSON.stringify(next.body)).toBe(200);
      seen.push(...titles(next.body.data));
      cursor = next.body.page.nextCursor;
      pages++;
    }
    expect(pages).toBe(3);
    expect(seen).toEqual(rows.map((r) => r.title));
  });

  it('WD-DEAL-003 / D-06: cards with the same sort_order (a fresh import) page in a stable order without repeats or gaps', async () => {
    const { pipeline, stage } = await api.defaultPipeline(t.admin);
    await api.seedDeals(
      t,
      pipeline.id,
      stage['Negotiation']!.id,
      Array.from({ length: 13 }, (_, i) => ({ title: `T${i}`, sortOrder: 0 })),
    );
    const first = await api
      .as(t.admin)
      .get(`/v2/deals/board/stages/${stage['Negotiation']!.id}/deals?limit=5`);
    const all = [...first.body.data];
    let cursor = first.body.page.nextCursor;
    while (cursor) {
      const next = await api
        .as(t.admin)
        .get(`/v2/deals/board/stages/${stage['Negotiation']!.id}/deals?limit=5&cursor=${cursor}`);
      all.push(...next.body.data);
      cursor = next.body.page.nextCursor;
    }
    expect(all).toHaveLength(13);
    expect(new Set(all.map((d: { id: string }) => d.id)).size).toBe(13);
    expect(titles(all)).toEqual(Array.from({ length: 13 }, (_, i) => `T${12 - i}`)); // newest first
  });

  it('WD-DEAL-003: a malformed column cursor is 400, a stage of another workspace is 404', async () => {
    const { stage } = await api.defaultPipeline(t.admin);
    expect(
      (
        await api
          .as(t.admin)
          .get(`/v2/deals/board/stages/${stage['New Lead']!.id}/deals?cursor=junk`)
      ).status,
    ).toBe(400);
    const other = await api.signup('bd-other');
    expect(
      (await api.as(other.admin).get(`/v2/deals/board/stages/${stage['New Lead']!.id}/deals`))
        .status,
    ).toBe(404);
  });

  it('WD-DEAL-003: the flat list pages a thousand-way tie at microsecond precision without losing or repeating a deal', async () => {
    const t2 = await api.signup('bd-tie');
    const { pipeline, stage } = await api.defaultPipeline(t2.admin);
    const same = Array.from({ length: 9 }, (_, i) => ({
      title: `tie-${i}`,
      createdAt: '2026-09-01T10:00:00.000001Z',
    }));
    const near = Array.from({ length: 4 }, (_, i) => ({
      title: `near-${i}`,
      createdAt: `2026-09-01T10:00:00.00000${i + 2}Z`,
    }));
    await api.seedDeals(t2, pipeline.id, stage['New Lead']!.id, [...same, ...near]);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const res = await api
        .as(t2.admin)
        .get(`/v2/deals?limit=4${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.data.map((d: { id: string }) => d.id));
      if (!res.body.page.hasMore) break;
      cursor = res.body.page.nextCursor;
    }
    expect(seen).toHaveLength(13);
    expect(new Set(seen).size).toBe(13);
    const asc = await api.as(t2.admin).get('/v2/deals?limit=200&order=asc');
    expect(asc.body.data).toHaveLength(13);
    expect(titles(asc.body.data).slice(-4)).toEqual(['near-0', 'near-1', 'near-2', 'near-3']);
  });
});

describe('board filters (WD-DEAL-004)', () => {
  let t: Tenant;
  let mate: { token: string; userId: number };
  let mateUuid: string;
  beforeAll(async () => {
    t = await api.signup('bf');
    mate = await api.member(t, 'bfmate', [['record.deals.read']]);
    mateUuid = await api.userUuid(mate.userId);
    const [ana] = await api.seedContacts(t, [{ name: 'Ana Perez' }]);
    await api.deal(t.admin, { title: 'Acme annual', value: '100', contactId: ana });
    await api.deal(t.admin, { title: 'Beta', value: '200', ownerId: mateUuid });
    await api.deal(t.admin, { title: 'Growth 100% plan', value: '5', ownerId: null });
    await h.owner.query(`UPDATE deals SET source = 'api' WHERE org_id = $1 AND title = 'Beta'`, [
      t.orgId,
    ]);
  });

  const newLead = async (qs: string) => {
    const res = await api.as(t.admin).get(`/v2/deals/board?${qs}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { col: column(res, 'New Lead'), kpis: res.body.kpis };
  };

  it('WD-DEAL-004 #1: q=acme shows only "Acme annual"; the column count follows the filter, the KPIs do not', async () => {
    const all = await newLead('');
    const some = await newLead('q=acme');
    expect(titles(some.col.deals)).toEqual(['Acme annual']);
    expect(some.col.count).toBe(1);
    expect(some.kpis).toEqual(all.kpis);
    expect(all.kpis.openCount).toBe(3);
  });

  it('WD-DEAL-004 #2: % in the search is text, not a wildcard; the contact name is searched too', async () => {
    expect(titles((await newLead(`q=${encodeURIComponent('100%')}`)).col.deals)).toEqual([
      'Growth 100% plan',
    ]);
    expect((await newLead(`q=${encodeURIComponent('%')}`)).col.count).toBe(1);
    expect(titles((await newLead('q=perez')).col.deals)).toEqual(['Acme annual']);
  });

  it('WD-DEAL-004 #3: owner and source combine; unassigned and contactId are filters too; a uuid not in the workspace matches nothing', async () => {
    expect(titles((await newLead(`ownerId=${mateUuid}`)).col.deals)).toEqual(['Beta']);
    expect(titles((await newLead(`ownerId=${mateUuid}&source=api`)).col.deals)).toEqual(['Beta']);
    expect((await newLead(`ownerId=${mateUuid}&source=manual`)).col.count).toBe(0);
    expect(titles((await newLead('unassigned=true')).col.deals)).toEqual(['Growth 100% plan']);
    expect((await newLead('ownerId=00000000-0000-4000-8000-000000000000')).col.count).toBe(0);
    const [ana] = (
      await h.owner.query(`SELECT uuid FROM contacts WHERE org_id = $1 AND name = 'Ana Perez'`, [
        t.orgId,
      ])
    ).rows;
    expect(titles((await newLead(`contactId=${ana.uuid}`)).col.deals)).toEqual(['Acme annual']);
    const bad = await api.as(t.admin).get(`/v2/deals/board?ownerId=${mateUuid}&unassigned=true`);
    expect(bad.status).toBe(422);
    expect(code(bad)).toBe('VALIDATION_FAILED');
  });

  it('WD-DEAL-004: the flat list takes the same filters plus status, stage, pipeline and currency', async () => {
    const res = await api.as(t.admin).get('/v2/deals?q=acme&status=open&currency=INR');
    expect(titles(res.body.data)).toEqual(['Acme annual']);
    expect((await api.as(t.admin).get('/v2/deals?status=won')).body.data).toEqual([]);
    expect((await api.as(t.admin).get('/v2/deals?status=maybe')).status).toBe(422);
  });
});

describe('order inside a column (WD-DEAL-007, D-07)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('bo');
  });

  const order = async (name: string) =>
    titles(column(await api.as(t.admin).get('/v2/deals/board'), name).deals);

  it('WD-DEAL-007: a new deal goes on top; dropping a card between two others keeps it there after a reload', async () => {
    const { stage } = await api.defaultPipeline(t.admin);
    const a = await api.deal(t.admin, { title: 'A' });
    const b = await api.deal(t.admin, { title: 'B' });
    const c = await api.deal(t.admin, { title: 'C' });
    const d = await api.deal(t.admin, { title: 'D' });
    expect(await order('New Lead')).toEqual(['D', 'C', 'B', 'A']);

    // drag A to sit directly above C
    const res = await api
      .as(t.admin)
      .patch(`/v2/deals/${a.id}/stage`)
      .send({ stageId: stage['New Lead']!.id, beforeDealId: c.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await order('New Lead')).toEqual(['D', 'A', 'C', 'B']);
    // below B, at the very bottom
    await api
      .as(t.admin)
      .patch(`/v2/deals/${d.id}/stage`)
      .send({ stageId: stage['New Lead']!.id, afterDealId: b.id });
    expect(await order('New Lead')).toEqual(['A', 'C', 'B', 'D']);
    // no anchor means on top
    await api.as(t.admin).patch(`/v2/deals/${d.id}/stage`).send({ stageId: stage['New Lead']!.id });
    expect(await order('New Lead')).toEqual(['D', 'A', 'C', 'B']);
  });

  it('WD-DEAL-007: a reorder inside a column is not a stage change: no timeline row, no event, no audit row', async () => {
    const { stage } = await api.defaultPipeline(t.admin);
    const x = await api.deal(t.admin, { title: 'X' });
    const y = await api.deal(t.admin, { title: 'Y' });
    const events = (await api.events(t.orgId, 'deal.stage_changed')).length;
    const audits = await api.auditCount(t.orgId, 'deals', 'update');
    await api
      .as(t.admin)
      .patch(`/v2/deals/${x.id}/stage`)
      .send({ stageId: stage['New Lead']!.id, afterDealId: y.id });
    expect((await api.events(t.orgId, 'deal.stage_changed')).length).toBe(events);
    expect(await api.auditCount(t.orgId, 'deals', 'update')).toBe(audits);
    expect(await api.timeline(t.admin, x.id)).toHaveLength(1);
  });

  it('WD-DEAL-007: dropping into another column at a position places the card there, and the order survives', async () => {
    const { stage } = await api.defaultPipeline(t.admin);
    const target = await api.deal(t.admin, { title: 'Q1', stageId: stage['Qualified']!.id });
    await api.deal(t.admin, { title: 'Q2', stageId: stage['Qualified']!.id });
    const mover = await api.deal(t.admin, { title: 'Mover' });
    await api
      .as(t.admin)
      .patch(`/v2/deals/${mover.id}/stage`)
      .send({ stageId: stage['Qualified']!.id, afterDealId: target.id });
    expect(await order('Qualified')).toEqual(['Q2', 'Q1', 'Mover']);
    expect((await api.as(t.admin).get(`/v2/deals/${mover.id}`)).body.stage.name).toBe('Qualified');
  });

  it('WD-DEAL-007: when the gap between two neighbours has closed the column is renumbered and the drop still lands where it was aimed', async () => {
    const t2 = await api.signup('bo-gap');
    const { pipeline, stage } = await api.defaultPipeline(t2.admin);
    await api.seedDeals(t2, pipeline.id, stage['Proposal']!.id, [
      { title: 'one', sortOrder: 1 },
      { title: 'two', sortOrder: 2 },
      { title: 'three', sortOrder: 3 },
    ]);
    const mover = await api.deal(t2.admin, { title: 'squeezed' });
    const one = (
      await h.owner.query(`SELECT uuid FROM deals WHERE org_id = $1 AND title = 'one'`, [t2.orgId])
    ).rows[0];
    // "one" (1) and "two" (2) have no integer between them
    const res = await api
      .as(t2.admin)
      .patch(`/v2/deals/${mover.id}/stage`)
      .send({ stageId: stage['Proposal']!.id, afterDealId: one.uuid });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const board = await api.as(t2.admin).get('/v2/deals/board');
    expect(titles(column(board, 'Proposal').deals)).toEqual(['one', 'squeezed', 'two', 'three']);
  });
});

describe('KPIs and column money (WD-DEAL-005, 006)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('bk');
  });

  it('WD-DEAL-005 #3: with no deals every tile is zero and the win rate is 0, not NaN', async () => {
    const board = await api.as(t.admin).get('/v2/deals/board');
    expect(board.body.kpis).toEqual({
      openCount: 0,
      openValue: { byCurrency: [] },
      forecast: { byCurrency: [] },
      wonThisMonthCount: 0,
      wonThisMonthValue: { byCurrency: [] },
      winRate: 0,
    });
  });

  it('WD-DEAL-005 #1 / D-04: open 100 (10%) and 200 (50%) plus one won 300: open 300, forecast 110 (open deals only: the won 300 is NOT added), won this month 1', async () => {
    const { stage } = await api.defaultPipeline(t.admin);
    await api.deal(t.admin, { title: 'p10', value: '100', currency: 'USD' });
    await api.deal(t.admin, {
      title: 'p50',
      value: '200',
      currency: 'USD',
      stageId: stage['Proposal']!.id,
    });
    await api.deal(t.admin, {
      title: 'won',
      value: '300',
      currency: 'USD',
      stageId: stage['Won']!.id,
    });
    const board = await api.as(t.admin).get('/v2/deals/board');
    expect(board.body.kpis).toMatchObject({
      openCount: 2,
      openValue: { byCurrency: [{ currency: 'USD', amount: '300.00' }] },
      forecast: { byCurrency: [{ currency: 'USD', amount: '110.00' }] },
      wonThisMonthCount: 1,
      wonThisMonthValue: { byCurrency: [{ currency: 'USD', amount: '300.00' }] },
    });
    // the column weighted value is the open column's value x its probability; terminal columns have none
    expect(column(board, 'New Lead').weighted.byCurrency).toEqual([
      { currency: 'USD', amount: '10.00' },
    ]);
    expect(column(board, 'Proposal').weighted.byCurrency).toEqual([
      { currency: 'USD', amount: '100.00' },
    ]);
    expect(column(board, 'Won').weighted.byCurrency).toEqual([]);
    expect(column(board, 'Won').total.byCurrency).toEqual([{ currency: 'USD', amount: '300.00' }]);
  });

  it('WD-DEAL-005 #2: two won and two lost deals make a 50% win rate', async () => {
    const t2 = await api.signup('bk2');
    const { stage } = await api.defaultPipeline(t2.admin);
    for (const [name, s] of [
      ['w1', 'Won'],
      ['w2', 'Won'],
      ['l1', 'Lost'],
      ['l2', 'Lost'],
    ] as const) {
      await api.deal(t2.admin, { title: name, stageId: stage[s]!.id });
    }
    expect((await api.as(t2.admin).get('/v2/deals/board')).body.kpis.winRate).toBe(50);
  });

  it('WD-DEAL-005 / D-05: convertTo adds one converted figure when every rate is known, and names a currency with no rate instead of treating it as 1.0', async () => {
    const t2 = await api.signup('bk3');
    await api.deal(t2.admin, { title: 'usd', value: '100', currency: 'USD' });
    await api.deal(t2.admin, { title: 'inr', value: '8300', currency: 'INR' });
    const ok = await api.as(t2.admin).get('/v2/deals/board?convertTo=USD');
    expect(column(ok, 'New Lead').total).toMatchObject({
      byCurrency: [
        { currency: 'INR', amount: '8300.00' },
        { currency: 'USD', amount: '100.00' },
      ],
      converted: { currency: 'USD', amount: '200.00' },
      unconverted: [],
    });
    expect(ok.body.kpis.openValue.converted).toEqual({ currency: 'USD', amount: '200.00' });
    await api.deal(t2.admin, { title: 'gbp', value: '50', currency: 'GBP' });
    const partial = await api.as(t2.admin).get('/v2/deals/board?convertTo=USD');
    expect(column(partial, 'New Lead').total).toMatchObject({
      converted: null,
      unconverted: ['GBP'],
    });
    expect(column(partial, 'New Lead').total.byCurrency).toHaveLength(3);
  });

  it("WD-DEAL-005: the KPIs and columns only count what the caller's record scope allows", async () => {
    const t2 = await api.signup('bk4');
    const rep = await api.member(t2, 'bkrep', [
      ['record.deals.read', 'own'],
      ['record.deals.create'],
    ]);
    await api.deal(t2.admin, { title: 'admin deal', value: '100', currency: 'USD' });
    await api.deal(rep.token, { title: 'rep deal', value: '5', currency: 'USD' });
    const adminBoard = await api.as(t2.admin).get('/v2/deals/board');
    const repBoard = await api.as(rep.token).get('/v2/deals/board');
    expect(adminBoard.body.kpis.openCount).toBe(2);
    expect(repBoard.body.kpis.openCount).toBe(1);
    expect(column(repBoard, 'New Lead').count).toBe(1);
    expect(titles(column(repBoard, 'New Lead').deals)).toEqual(['rep deal']);
  });
});

describe('reports (WD-DEAL-019, 020, 040)', () => {
  let t: Tenant;
  let pipelineId: string;
  let stage: Record<string, { id: string }>;
  const tz = 'Pacific/Kiritimati'; // UTC+14: the workspace's "this month" is not the server's

  /** the first instant of the current month in the workspace zone, as the database computes it */
  const monthStart = async () =>
    (
      await h.owner.query(
        `SELECT (date_trunc('month', now() AT TIME ZONE $1) AT TIME ZONE $1) AS ms`,
        [tz],
      )
    ).rows[0].ms as Date;
  const at = (d: Date, seconds: number) => new Date(d.getTime() + seconds * 1000).toISOString();

  beforeAll(async () => {
    t = await api.signup('rp');
    await h.owner.query(`UPDATE organizations SET settings = settings || $2::jsonb WHERE id = $1`, [
      t.orgId,
      JSON.stringify({ timezone: tz }),
    ]);
    const d = await api.defaultPipeline(t.admin);
    pipelineId = d.pipeline.id;
    stage = d.stage;
  });

  it('WD-DEAL-019 #1: 300 of open deals in Qualified (25%) is a stage value of 300 and a weighted 75; won and lost stages report no open deals', async () => {
    await api.seedDeals(t, pipelineId, stage['Qualified']!.id, [
      { title: 'q1', valueMinor: 10000, currency: 'USD' },
      { title: 'q2', valueMinor: 20000, currency: 'USD' },
    ]);
    const res = await api.as(t.admin).get('/v2/deals/reports');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.timezone).toBe(tz);
    const q = res.body.byStage.find((s: { name: string }) => s.name === 'Qualified');
    expect(q).toMatchObject({ count: 2, kind: 'open', probability: 25 });
    expect(q.value.byCurrency).toEqual([{ currency: 'USD', amount: '300.00' }]);
    expect(q.weighted.byCurrency).toEqual([{ currency: 'USD', amount: '75.00' }]);
    for (const name of ['Won', 'Lost'])
      expect(res.body.byStage.find((s: { name: string }) => s.name === name)).toMatchObject({
        count: 0,
        value: { byCurrency: [] },
      });
    expect(res.body.open).toMatchObject({
      count: 2,
      forecast: { byCurrency: [{ currency: 'USD', amount: '75.00' }] },
    });
  });

  it('WD-DEAL-019 #2: 3 won and 1 lost is a 75% win rate; the lost reasons are counted', async () => {
    const t2 = await api.signup('rp2');
    const { pipeline, stage: s } = await api.defaultPipeline(t2.admin);
    await api.seedDeals(t2, pipeline.id, s['Won']!.id, [
      { title: 'w1', status: 'won' },
      { title: 'w2', status: 'won' },
      { title: 'w3', status: 'won' },
    ]);
    await api.seedDeals(t2, pipeline.id, s['Lost']!.id, [
      { title: 'l1', status: 'lost', lostReason: 'Budget' },
    ]);
    const res = await api.as(t2.admin).get('/v2/deals/reports');
    expect(res.body).toMatchObject({
      winRate: 75,
      won: { count: 3 },
      lost: { count: 1 },
      lostReasons: [{ reason: 'Budget', count: 1 }],
    });
  });

  it('WD-DEAL-019 #3: a deal won seven months ago counts in the won total and the leaderboard but not in the six-month trend', async () => {
    const t2 = await api.signup('rp3');
    const { pipeline, stage: s } = await api.defaultPipeline(t2.admin);
    await api.seedDeals(t2, pipeline.id, s['Won']!.id, [
      {
        title: 'ancient',
        status: 'won',
        wonAt: new Date(Date.now() - 215 * 86400_000).toISOString(),
        valueMinor: 5000,
        ownerId: t2.adminUserId,
        currency: 'USD',
      },
    ]);
    const res = await api.as(t2.admin).get('/v2/deals/reports');
    expect(res.body.won.count).toBe(1);
    expect(res.body.won.value.byCurrency).toEqual([{ currency: 'USD', amount: '50.00' }]);
    expect(res.body.leaders).toHaveLength(1);
    expect(res.body.leaders[0]).toMatchObject({ wonCount: 1 });
    expect(res.body.months).toHaveLength(6);
    expect(res.body.months.every((m: { wonCount: number }) => m.wonCount === 0)).toBe(true);
    expect(res.body.won.thisMonth.count).toBe(0);
  });

  it('WD-DEAL-019 / WD-DEAL-005 #4: "won this month" is this month in the WORKSPACE zone: one second before the month starts is last month, one second after is this month', async () => {
    const ms = await monthStart();
    await api.seedDeals(t, pipelineId, stage['Won']!.id, [
      {
        title: 'last month, last second',
        status: 'won',
        wonAt: at(ms, -1),
        valueMinor: 1000,
        currency: 'USD',
      },
      {
        title: 'this month, first second',
        status: 'won',
        wonAt: at(ms, 1),
        valueMinor: 2000,
        currency: 'USD',
      },
    ]);
    const res = await api.as(t.admin).get('/v2/deals/reports');
    expect(res.body.won.thisMonth).toMatchObject({
      count: 1,
      value: { byCurrency: [{ currency: 'USD', amount: '20.00' }] },
    });
    expect(res.body.won.count).toBe(2);
    const board = await api.as(t.admin).get('/v2/deals/board');
    expect(board.body.kpis.wonThisMonthCount).toBe(1);
    const months = res.body.months as Array<{ month: string; wonCount: number }>;
    expect(months).toHaveLength(6);
    expect(months.map((m) => m.month)).toEqual([...months.map((m) => m.month)].sort());
    expect(months[5]!.wonCount).toBe(1);
    expect(months[4]!.wonCount).toBe(1);
  });

  it('WD-DEAL-019 / D-05: money in different currencies is never added up: each is its own total', async () => {
    const t2 = await api.signup('rp4');
    const { pipeline, stage: s } = await api.defaultPipeline(t2.admin);
    await api.seedDeals(t2, pipeline.id, s['New Lead']!.id, [
      { title: 'usd', valueMinor: 10000, currency: 'USD' },
      { title: 'eur', valueMinor: 10000, currency: 'EUR' },
      { title: 'inr', valueMinor: 830000, currency: 'INR' },
    ]);
    const res = await api.as(t2.admin).get('/v2/deals/reports');
    expect(res.body.open.value.byCurrency).toEqual([
      { currency: 'EUR', amount: '100.00' },
      { currency: 'INR', amount: '8300.00' },
      { currency: 'USD', amount: '100.00' },
    ]);
    expect(res.body.open.value.converted).toBeUndefined();
    const usd = await api.as(t2.admin).get('/v2/deals/reports?convertTo=USD');
    // 100 USD + 100 EUR (at 0.9 per USD = 111.11 USD) + 8300 INR (at 83 per USD = 100 USD)
    expect(usd.body.convertedTo).toBe('USD');
    expect(usd.body.open.value.converted).toEqual({ currency: 'USD', amount: '311.11' });
    expect(usd.body.open.value.unconverted).toEqual([]);
    await api.seedDeals(t2, pipeline.id, s['New Lead']!.id, [
      { title: 'gbp', valueMinor: 100, currency: 'GBP' },
    ]);
    const partial = await api.as(t2.admin).get('/v2/deals/reports?convertTo=USD');
    expect(partial.body.open.value).toMatchObject({ converted: null, unconverted: ['GBP'] });
  });

  it('WD-DEAL-019 #5: the leaderboard ranks owners of won deals, the top ten, by converted value when asked', async () => {
    const t2 = await api.signup('rp5');
    const { pipeline, stage: s } = await api.defaultPipeline(t2.admin);
    const members = [];
    for (let i = 0; i < 12; i++)
      members.push((await api.member(t2, `lead${i}`, [['record.deals.read']])).userId);
    for (const [i, id] of members.entries()) {
      await api.seedDeals(t2, pipeline.id, s['Won']!.id, [
        { title: `w${i}`, status: 'won', ownerId: id, valueMinor: (i + 1) * 1000, currency: 'USD' },
      ]);
    }
    const res = await api.as(t2.admin).get('/v2/deals/reports');
    expect(res.body.leaders).toHaveLength(10);
    expect(res.body.leaders[0].value.byCurrency).toEqual([{ currency: 'USD', amount: '120.00' }]);
    expect(res.body.leaders[9].value.byCurrency).toEqual([{ currency: 'USD', amount: '30.00' }]);
    expect(
      res.body.leaders.every((l: { owner: { id: string; name: string } }) =>
        /^[0-9a-f-]{36}$/.test(l.owner.id),
      ),
    ).toBe(true);
  });

  it('WD-DEAL-019: a pipeline, an owner and a date window narrow the numbers (WaDesk had no filters at all)', async () => {
    const t2 = await api.signup('rp6');
    const { pipeline, stage: s } = await api.defaultPipeline(t2.admin);
    const second = (
      await api
        .as(t2.admin)
        .post('/v2/pipelines')
        .send({ name: 'Other numbers', stages: [{ name: 'Open' }, { name: 'Done', kind: 'won' }] })
    ).body as Pipeline;
    const mate = await api.member(t2, 'rp6m', [['record.deals.read']]);
    await api.seedDeals(t2, pipeline.id, s['Won']!.id, [
      {
        title: 'jan',
        status: 'won',
        wonAt: '2026-01-15T12:00:00Z',
        valueMinor: 100,
        currency: 'USD',
        ownerId: mate.userId,
      },
      {
        title: 'mar',
        status: 'won',
        wonAt: '2026-03-15T12:00:00Z',
        valueMinor: 200,
        currency: 'USD',
        ownerId: t2.adminUserId,
      },
    ]);
    await api.seedDeals(t2, second.id, second.stages[1]!.id, [
      {
        title: 'elsewhere',
        status: 'won',
        wonAt: '2026-03-16T12:00:00Z',
        valueMinor: 400,
        currency: 'USD',
      },
    ]);
    const get = (qs: string) => api.as(t2.admin).get(`/v2/deals/reports?${qs}`);
    expect((await get('')).body.won.count).toBe(3);
    expect((await get(`pipelineId=${second.id}`)).body.won.count).toBe(1);
    expect((await get(`ownerId=${await api.userUuid(mate.userId)}`)).body.won.count).toBe(1);
    expect((await get('from=2026-02-01&to=2026-12-31')).body.won.count).toBe(2);
    expect((await get('from=2026-01-01&to=2026-01-31')).body.won.value.byCurrency).toEqual([
      { currency: 'USD', amount: '1.00' },
    ]);
    expect((await get('from=2026-03-01&to=2026-02-01')).status).toBe(422);
    expect((await get('pipelineId=00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await get('from=nonsense')).status).toBe(422);
  });

  it('WD-DEAL-019: the average days to close is the mean of won_at - created_at', async () => {
    const t2 = await api.signup('rp7');
    const { pipeline, stage: s } = await api.defaultPipeline(t2.admin);
    await api.seedDeals(t2, pipeline.id, s['Won']!.id, [
      {
        title: 'fast',
        status: 'won',
        createdAt: '2026-05-01T00:00:00Z',
        wonAt: '2026-05-03T00:00:00Z',
      },
      {
        title: 'slow',
        status: 'won',
        createdAt: '2026-05-01T00:00:00Z',
        wonAt: '2026-05-07T00:00:00Z',
      },
    ]);
    expect((await api.as(t2.admin).get('/v2/deals/reports')).body.won.avgDaysToClose).toBe(4);
    expect(
      (await api.as((await api.signup('rp7b')).admin).get('/v2/deals/reports')).body.won
        .avgDaysToClose,
    ).toBeNull();
  });

  it('WD-DEAL-001 / D-02: reports need record.deals.report, and a rep with scope own reports only on their own deals', async () => {
    const t2 = await api.signup('rp8');
    const none = await api.member(t2, 'rp8n', [['record.deals.read']]);
    expect((await api.as(none.token).get('/v2/deals/reports')).status).toBe(403);
    const rep = await api.member(t2, 'rp8r', [
      ['record.deals.report', 'own'],
      ['record.deals.create'],
      ['record.deals.read', 'own'],
    ]);
    await api.deal(t2.admin, { title: 'not mine', value: '100', currency: 'USD' });
    await api.deal(rep.token, { title: 'mine', value: '7', currency: 'USD' });
    const res = await api.as(rep.token).get('/v2/deals/reports');
    expect(res.status).toBe(200);
    expect(res.body.open).toMatchObject({
      count: 1,
      value: { byCurrency: [{ currency: 'USD', amount: '7.00' }] },
    });
  });

  it("WD-DEAL-019: another workspace's deals never enter a report", async () => {
    const t2 = await api.signup('rp9');
    const res = await api.as(t2.admin).get('/v2/deals/reports');
    expect(res.body.open.count).toBe(0);
    expect(res.body.won.count).toBe(0);
  });
});
