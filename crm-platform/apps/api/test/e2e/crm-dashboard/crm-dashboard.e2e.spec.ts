import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DealsApi,
  startHarness,
  type Grant,
  type Harness,
  type Pipeline,
  type Tenant,
} from '../deals-pipelines/support';

/**
 * The CRM dashboard (`GET /v2/crm/dashboard`) end to end against a real Postgres: every figure is checked against seeded rows to the
 * cent, then the record scopes (own vs all), tenant isolation, permissions, the plan gate, the empty workspace and the filters.
 * Rows are written with the owner connection (arranging only); everything asserted goes through HTTP.
 */
let h: Harness;
let api: DealsApi;

beforeAll(async () => {
  h = await startHarness();
  api = new DealsApi(h);
  await h.owner.query(
    `INSERT INTO currencies (name, code, symbol, exchange_rate) VALUES ('US Dollar','USD','$',1), ('Euro','EUR','E',0.9) ON CONFLICT (code) DO UPDATE SET exchange_rate = EXCLUDED.exchange_rate`,
  );
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const DAY = 86_400_000;
const NOW = Date.now();
/** An instant `d` days before now. */
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();
const ymdOf = (iso: string) => iso.slice(0, 10);
const FULL: Grant[] = [
  ['record.deals.read'],
  ['record.contacts.read'],
  ['record.tasks.read'],
  ['record.payments.read'],
];
const OWN: Grant[] = FULL.map(([k]) => [k!, 'own'] as Grant);

interface Totals {
  byCurrency: Array<{ currency: string; amount: string }>;
  converted?: { currency: string; amount: string } | null;
  unconverted?: string[];
}
interface Dash {
  period: {
    range: string;
    timezone: string;
    fromDate: string;
    toDate: string;
    days: number;
    today: string;
    previous: { fromDate: string; toDate: string };
  };
  convertedTo: string | null;
  deals: null | {
    open: { count: number; value: Totals; forecast: Totals };
    won: {
      count: number;
      value: Totals;
      previousCount: number;
      previousValue: Totals;
      averageSize: Totals;
      averageCycleDays: number | null;
    };
    lost: { count: number; previousCount: number };
    winRate: number;
    previousWinRate: number;
    overdueCloseCount: number;
    funnel: {
      pipeline: { id: string; name: string } | null;
      cohortSize: number;
      stages: Array<{
        id: string;
        name: string;
        kind: string;
        reached: number;
        reachedValue: Totals;
        conversionFromPrevious: number | null;
        openCount: number;
        openValue: Totals;
      }>;
    };
    trend: {
      bucket: string;
      points: Array<{ start: string; wonCount: number; wonValue: Totals; lostCount: number }>;
    };
    leaderboard: Array<{
      owner: { id: string; name: string } | null;
      wonCount: number;
      wonValue: Totals;
      lostCount: number;
      openCount: number;
      activities: number;
    }>;
  };
  contacts: null | {
    totalContacts: number;
    newContacts: { current: number; previous: number };
    newLeads: { current: number; previous: number };
    sources: Array<{
      source: string | null;
      leads: number;
      withDeal: number;
      withWonDeal: number;
      dealRate: number;
      wonRate: number;
      wonValue: Totals;
    }>;
  };
  tasks: null | {
    open: number;
    overdue: number;
    dueToday: number;
    byAssignee: Array<{
      assignee: { id: string; name: string } | null;
      open: number;
      overdue: number;
      dueToday: number;
    }>;
    upcoming: Array<{ title: string; overdue: boolean }>;
  };
  invoices: null | {
    outstanding: Totals;
    overdue: Totals;
    openInvoices: number;
    collected: Totals;
    previousCollected: Totals;
    paidInvoices: number;
    aging: Array<{ currency: string; buckets: Array<{ bucket: string; amount: string }> }>;
    recentPayments: Array<{ amount: string; currency: string }>;
  };
  activity: null | Array<{ kind: string; type: string; subject: string | null }>;
}

const get = async (token: string, qs = 'range=30d'): Promise<Dash> => {
  const res = await api.as(token).get(`/v2/crm/dashboard?${qs}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Dash;
};
const amount = (t: Totals, currency: string) =>
  t.byCurrency.find((x) => x.currency === currency)?.amount;

describe('the CRM dashboard against seeded data', () => {
  let t: Tenant;
  let alice: { token: string; userId: number };
  let bob: { token: string; userId: number };
  let aliceUuid: string;
  let bobUuid: string;
  let pipeline: Pipeline;
  let stage: Record<string, { id: string; probability: number }>;
  let currency: string;

  beforeAll(async () => {
    t = await api.signup('crmd');
    alice = await api.member(t, 'alice', FULL);
    bob = await api.member(t, 'bob', OWN);
    aliceUuid = await api.userUuid(alice.userId);
    bobUuid = await api.userUuid(bob.userId);
    const def = await api.defaultPipeline(t.admin);
    pipeline = def.pipeline;
    stage = def.stage;

    const seed = (stageName: string, rows: Parameters<DealsApi['seedDeals']>[3]) =>
      api.seedDeals(t, pipeline.id, stage[stageName]!.id, rows);
    // open
    const [d1] = await seed('New Lead', [
      { title: 'D1 open A', valueMinor: 10_000, ownerId: alice.userId, createdAt: ago(0.1) },
    ]);
    const [d2] = await seed('Qualified', [
      { title: 'D2 open A', valueMinor: 20_000, ownerId: alice.userId, createdAt: ago(0.1) },
    ]);
    await seed('Proposal', [
      { title: 'D3 open B', valueMinor: 30_000, ownerId: bob.userId, createdAt: ago(0.1) },
    ]);
    // won
    const [d4, d5, d8] = [
      ...(await seed('Won', [
        {
          title: 'D4 won A',
          valueMinor: 40_000,
          ownerId: alice.userId,
          status: 'won',
          createdAt: ago(12),
          wonAt: ago(2),
        },
        {
          title: 'D5 won B',
          valueMinor: 60_000,
          ownerId: bob.userId,
          status: 'won',
          createdAt: ago(5),
          wonAt: ago(3),
        },
        {
          title: 'D8 won B EUR',
          valueMinor: 1_000,
          currency: 'EUR',
          ownerId: bob.userId,
          status: 'won',
          createdAt: ago(3),
          wonAt: ago(1),
        },
      ])),
    ];
    // won before the window (previous period), lost in and before it
    await seed('Won', [
      {
        title: 'D7 won A old',
        valueMinor: 100_000,
        ownerId: alice.userId,
        status: 'won',
        createdAt: ago(45),
        wonAt: ago(40),
      },
    ]);
    const [d6] = await seed('Lost', [
      {
        title: 'D6 lost A',
        valueMinor: 5_000,
        ownerId: alice.userId,
        status: 'lost',
        createdAt: ago(10),
        lostAt: ago(4),
      },
    ]);
    await seed('Lost', [
      {
        title: 'D9 lost B old',
        valueMinor: 7_000,
        ownerId: bob.userId,
        status: 'lost',
        createdAt: ago(50),
        lostAt: ago(40),
      },
    ]);

    // D1 is late on its expected close date
    await h.owner.query(`UPDATE deals SET expected_close_date = $2 WHERE id = $1`, [
      d1,
      ymdOf(ago(1)),
    ]);
    // the deal timeline: D6 went through Qualified before it was lost; notes and calls by people
    const act = (
      dealId: number | undefined,
      userId: number | null,
      type: string,
      at: string,
      meta?: unknown,
    ) =>
      h.owner.query(
        `INSERT INTO deal_activities (org_id, deal_id, user_id, type, meta, created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6::timestamptz)`,
        [t.orgId, dealId, userId, type, meta ? JSON.stringify(meta) : null, at],
      );
    await act(d6, alice.userId, 'stage_change', ago(9), {
      from: null,
      to: { id: stage['Qualified']!.id, name: 'Qualified' },
    });
    await act(d6, alice.userId, 'stage_change', ago(4), {
      from: { id: stage['Qualified']!.id, name: 'Qualified' },
      to: { id: stage['Lost']!.id, name: 'Lost' },
    });
    await act(d2, alice.userId, 'note', ago(1));
    await act(d2, alice.userId, 'call', ago(1));
    await act(d1, bob.userId, 'note', ago(40)); // outside the window
    await act(d1, null, 'note', ago(1)); // nobody
    void d4;
    void d5;
    void d8;

    // contacts: leads by source, linked to deals
    const ids = await api.seedContacts(t, [
      { name: 'C1 meta A', ownerId: alice.userId, source: 'meta', createdAt: ago(1) },
      { name: 'C2 meta A', ownerId: alice.userId, source: 'meta', createdAt: ago(2) },
      { name: 'C3 meta B', ownerId: bob.userId, source: 'meta', createdAt: ago(3) },
      { name: 'C4 hook B', ownerId: bob.userId, source: 'webhook', createdAt: ago(4) },
      { name: 'C5 plain A', ownerId: alice.userId, source: null, createdAt: ago(5) },
      { name: 'C6 old meta A', ownerId: alice.userId, source: 'meta', createdAt: ago(40) },
    ]);
    const contactId = async (uuid: string) =>
      Number((await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [uuid])).rows[0].id);
    await h.owner.query(`UPDATE deals SET contact_id = $2 WHERE id = $1`, [
      d4,
      await contactId(ids[0]!),
    ]);
    await h.owner.query(`UPDATE deals SET contact_id = $2 WHERE id = $1`, [
      d5,
      await contactId(ids[2]!),
    ]);
    await h.owner.query(`UPDATE deals SET contact_id = $2 WHERE id = $1`, [
      d1,
      await contactId(ids[1]!),
    ]);

    // tasks: A has one overdue, one later today and one next week; B one next week; one unassigned overdue; one done
    const dayEnd = new Date(Math.floor(NOW / DAY) * DAY + DAY - 1000).toISOString();
    const task = (title: string, who: number | null, due: string | null, status = 'open') =>
      h.owner.query(
        `INSERT INTO tasks (org_id, title, assignee_id, created_by, due_at, status, done_at) VALUES ($1,$2,$3,$4,$5::timestamptz,$6, CASE WHEN $6 = 'done' THEN now() END)`,
        [t.orgId, title, who, t.adminUserId, due, status],
      );
    await task('A overdue', alice.userId, ago(2));
    await task('A today', alice.userId, dayEnd);
    await task('A later', alice.userId, new Date(NOW + 5 * DAY).toISOString());
    await task('B later', bob.userId, new Date(NOW + 6 * DAY).toISOString());
    await task('Nobody overdue', null, ago(1));
    await task('A done overdue', alice.userId, ago(3), 'done');

    // invoices: A's, with a part payment; B's, past due and unpaid
    const mk = async (ownerUuid: string, extra: Record<string, unknown>) => {
      const created = await api
        .as(t.admin)
        .post('/v2/invoices')
        .send({
          buyerName: 'Acme',
          ownerId: ownerUuid,
          lines: [{ description: 'Work', qty: '1', unitPrice: '100.00' }],
          ...extra,
        });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const issued = await api.as(t.admin).post(`/v2/invoices/${created.body.id}/issue`).send({});
      expect(issued.status, JSON.stringify(issued.body)).toBe(200);
      return issued.body as { id: string; currency: string; amounts: Record<string, string> };
    };
    const invA = await mk(aliceUuid, { dueDate: ymdOf(new Date(NOW + 20 * DAY).toISOString()) });
    const invB = await mk(bobUuid, {
      issueDate: ymdOf(ago(20)),
      dueDate: ymdOf(ago(5)),
    });
    currency = invA.currency;
    const payRes = await api
      .as(t.admin)
      .post(`/v2/invoices/${invA.id}/payments`)
      .send({ amount: '40.00', paidAt: ago(1) });
    expect(payRes.status, JSON.stringify(payRes.body)).toBe(201);
    void invB;
  }, 240_000);

  it('the deal KPIs match the seeded rows to the cent', async () => {
    const d = await get(t.admin);
    expect(d.period).toMatchObject({ range: '30d', timezone: 'UTC', days: 30 });
    expect(d.deals!.open.count).toBe(3);
    expect(amount(d.deals!.open.value, 'USD')).toBe('600.00');
    const weighted = [
      ['New Lead', 10_000],
      ['Qualified', 20_000],
      ['Proposal', 30_000],
    ].reduce(
      (a, [name, v]) => a + Math.round(((v as number) * stage[name as string]!.probability) / 100),
      0,
    );
    expect(amount(d.deals!.open.forecast, 'USD')).toBe((weighted / 100).toFixed(2));
    expect(d.deals!.won.count).toBe(3);
    expect(amount(d.deals!.won.value, 'USD')).toBe('1000.00');
    expect(amount(d.deals!.won.value, 'EUR')).toBe('10.00');
    expect(d.deals!.won.previousCount).toBe(1);
    expect(amount(d.deals!.won.previousValue, 'USD')).toBe('1000.00');
    expect(d.deals!.lost).toEqual({ count: 1, previousCount: 1 });
    expect(d.deals!.winRate).toBe(75);
    expect(d.deals!.previousWinRate).toBe(50);
    expect(amount(d.deals!.won.averageSize, 'USD')).toBe('500.00');
    expect(amount(d.deals!.won.averageSize, 'EUR')).toBe('10.00');
    // (10 + 2 + 2) days over three deals
    expect(d.deals!.won.averageCycleDays).toBe(4.7);
    expect(d.deals!.overdueCloseCount).toBe(1);
  });

  it('the funnel counts the deals created in the period that reached each stage, and the conversion between stages', async () => {
    const f = (await get(t.admin)).deals!.funnel;
    expect(f.pipeline!.id).toBe(pipeline.id);
    expect(f.cohortSize).toBe(7);
    expect(f.stages.map((s) => s.name)).toEqual([
      'New Lead',
      'Qualified',
      'Proposal',
      'Negotiation',
      'Won',
    ]);
    expect(f.stages.map((s) => s.reached)).toEqual([7, 6, 4, 3, 3]);
    expect(f.stages.map((s) => s.conversionFromPrevious)).toEqual([null, 86, 67, 75, 100]);
    expect(f.stages.map((s) => s.openCount)).toEqual([1, 1, 1, 0, 0]);
    expect(amount(f.stages[0]!.openValue, 'USD')).toBe('100.00');
    // reached never rises along the funnel
    for (let i = 1; i < f.stages.length; i++)
      expect(f.stages[i]!.reached).toBeLessThanOrEqual(f.stages[i - 1]!.reached);
  });

  it('the won/lost trend has a point per day, zero days included, and sums to the period totals', async () => {
    const tr = (await get(t.admin)).deals!.trend;
    expect(tr.bucket).toBe('day');
    expect(tr.points).toHaveLength(30);
    expect(tr.points.reduce((a, p) => a + p.wonCount, 0)).toBe(3);
    expect(tr.points.reduce((a, p) => a + p.lostCount, 0)).toBe(1);
    const day = (iso: string) => tr.points.find((p) => p.start === ymdOf(iso))!;
    expect(day(ago(2)).wonCount).toBe(1);
    expect(amount(day(ago(2)).wonValue, 'USD')).toBe('400.00');
    expect(day(ago(4)).lostCount).toBe(1);
    expect(tr.points.filter((p) => p.wonCount === 0 && p.lostCount === 0).length).toBe(26);
    const wide = (await get(t.admin, 'range=90d')).deals!.trend;
    expect(wide.bucket).toBe('week');
  });

  it('the leaderboard ranks owners by converted value and counts their logged activities', async () => {
    const lb = (await get(t.admin, 'range=30d&convertTo=USD')).deals!.leaderboard;
    expect(lb.map((r) => r.owner!.name)).toEqual(['bob', 'alice']);
    const [b, a] = lb;
    expect(b).toMatchObject({ wonCount: 2, lostCount: 0, openCount: 1, activities: 0 });
    expect(b!.wonValue.converted).toEqual({ currency: 'USD', amount: '611.11' });
    expect(amount(b!.wonValue, 'USD')).toBe('600.00');
    expect(a).toMatchObject({ wonCount: 1, lostCount: 1, openCount: 2, activities: 2 });
    expect(a!.wonValue.converted).toEqual({ currency: 'USD', amount: '400.00' });
  });

  it('lead sources: leads, how many reached a deal and a won deal, and the won value', async () => {
    const c = (await get(t.admin)).contacts!;
    expect(c.totalContacts).toBe(6);
    expect(c.newContacts).toEqual({ current: 5, previous: 1 });
    expect(c.newLeads).toEqual({ current: 4, previous: 1 });
    expect(c.sources.map((s) => s.source)).toEqual(['meta', 'webhook']);
    expect(c.sources[0]).toMatchObject({
      leads: 3,
      withDeal: 3,
      withWonDeal: 2,
      dealRate: 100,
      wonRate: 67,
    });
    expect(amount(c.sources[0]!.wonValue, 'USD')).toBe('1000.00');
    expect(c.sources[1]).toMatchObject({
      leads: 1,
      withDeal: 0,
      withWonDeal: 0,
      dealRate: 0,
      wonRate: 0,
    });
  });

  it('tasks: totals, due later today, overdue and per assignee (done tasks are not counted)', async () => {
    const k = (await get(t.admin)).tasks!;
    expect(k).toMatchObject({ open: 5, overdue: 2, dueToday: 1 });
    const by = (name: string | null) =>
      k.byAssignee.find((r) => (r.assignee?.name ?? null) === name)!;
    expect(by('alice')).toMatchObject({ open: 3, overdue: 1, dueToday: 1 });
    expect(by('bob')).toMatchObject({ open: 1, overdue: 0, dueToday: 0 });
    expect(by(null)).toMatchObject({ open: 1, overdue: 1, dueToday: 0 });
    expect(k.upcoming.map((x) => x.title)).toEqual([
      'A overdue',
      'Nobody overdue',
      'A today',
      'A later',
      'B later',
    ]);
    expect(k.upcoming.filter((x) => x.overdue)).toHaveLength(2);
  });

  it('invoices: outstanding, overdue, collected in the period, aging and the last payments', async () => {
    const v = (await get(t.admin)).invoices!;
    expect(amount(v.outstanding, currency)).toBe('160.00'); // 60 left on A's, 100 on B's
    expect(amount(v.overdue, currency)).toBe('100.00');
    expect(v.openInvoices).toBe(2);
    expect(amount(v.collected, currency)).toBe('40.00');
    expect(v.previousCollected.byCurrency).toEqual([]);
    expect(v.paidInvoices).toBe(0);
    const buckets = Object.fromEntries(v.aging[0]!.buckets.map((b) => [b.bucket, b.amount]));
    expect(buckets).toMatchObject({ current: '60.00', d1_30: '100.00' });
    expect(v.recentPayments).toEqual([
      {
        id: expect.any(String),
        amount: '40.00',
        currency,
        paidAt: expect.any(String),
        contact: null,
      },
    ]);
  });

  it('recent activity lists the newest timeline rows with the deal title', async () => {
    const feed = (await get(t.admin)).activity!;
    expect(feed.length).toBeGreaterThan(0);
    expect(feed.length).toBeLessThanOrEqual(10);
    expect(feed.some((a) => a.kind === 'deal' && a.subject === 'D2 open A')).toBe(true);
  });

  it('a member with scope own sees only their own numbers, in every section', async () => {
    const d = await get(bob.token);
    expect(d.deals!.open.count).toBe(1);
    expect(amount(d.deals!.open.value, 'USD')).toBe('300.00');
    expect(d.deals!.won.count).toBe(2);
    expect(amount(d.deals!.won.value, 'USD')).toBe('600.00');
    expect(d.deals!.lost).toEqual({ count: 0, previousCount: 1 });
    expect(d.deals!.leaderboard.map((r) => r.owner!.name)).toEqual(['bob']);
    expect(d.deals!.funnel.cohortSize).toBe(3);
    expect(d.contacts!.totalContacts).toBe(2);
    expect(d.contacts!.newContacts).toEqual({ current: 2, previous: 0 });
    expect(d.contacts!.sources.map((s) => [s.source, s.leads, s.withWonDeal])).toEqual([
      ['meta', 1, 1],
      ['webhook', 1, 0],
    ]);
    // bob owns or created no task of Alice's; he is assigned one
    expect(d.tasks).toMatchObject({ open: 1, overdue: 0, dueToday: 0 });
    expect(d.tasks!.upcoming.map((x) => x.title)).toEqual(['B later']);
    expect(amount(d.invoices!.outstanding, currency)).toBe('100.00');
    expect(d.invoices!.collected.byCurrency).toEqual([]);
    expect(d.invoices!.recentPayments).toEqual([]);
    // the same query as the all-scope member differs
    const alicesView = await get(alice.token);
    expect(alicesView.deals!.open.count).toBe(3);
  });

  it('an owner filter narrows the all-scope view to that person, and a pipeline filter to that pipeline', async () => {
    const mine = await get(t.admin, `range=30d&ownerId=${aliceUuid}`);
    expect(mine.deals!.open.count).toBe(2);
    expect(mine.deals!.won.count).toBe(1);
    expect(mine.tasks!.open).toBe(3);
    expect(mine.contacts!.newContacts.current).toBe(3);
    expect(amount(mine.invoices!.outstanding, currency)).toBe('60.00');

    const other = (
      await api
        .as(t.admin)
        .post('/v2/pipelines')
        .send({ name: 'Second board', stages: [{ name: 'Only stage' }] })
    ).body as Pipeline;
    await api.deal(t.admin, {
      title: 'In second',
      pipelineId: other.id,
      value: '12.50',
      currency: 'USD',
    });
    const second = await get(t.admin, `range=30d&pipelineId=${other.id}`);
    expect(second.deals!.open.count).toBe(1);
    expect(amount(second.deals!.open.value, 'USD')).toBe('12.50');
    expect(second.deals!.won.count).toBe(0);
    expect(second.deals!.funnel.pipeline!.id).toBe(other.id);
    expect(second.deals!.funnel.stages.map((s) => s.name)).toEqual(['Only stage']);
    // all pipelines: the open deal of the second one counts, the funnel stays on the default pipeline
    const all = await get(t.admin);
    expect(all.deals!.open.count).toBe(4);
    expect(all.deals!.funnel.pipeline!.id).toBe(pipeline.id);
    await api.as(t.admin).delete(`/v2/pipelines/${other.id}`);
  });

  it('a team filter keeps the members of that team', async () => {
    const team = await h.owner.query(
      `INSERT INTO teams (org_id, name) VALUES ($1,'Closers') RETURNING id, uuid`,
      [t.orgId],
    );
    await h.owner.query(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [
      t.orgId,
      team.rows[0].id,
      bob.userId,
    ]);
    const d = await get(t.admin, `range=30d&teamId=${team.rows[0].uuid}`);
    expect(d.deals!.open.count).toBe(1);
    expect(d.deals!.leaderboard.map((r) => r.owner!.name)).toEqual(['bob']);
    expect(d.tasks!.open).toBe(1);
  });

  it('the period filter: a custom window moves the closed-deal figures, a window that excludes everything is all zeros', async () => {
    const wide = await get(t.admin, `range=custom&from=${ymdOf(ago(60))}&to=${ymdOf(ago(0))}`);
    expect(wide.period.days).toBe(61);
    expect(wide.deals!.won.count).toBe(4);
    expect(amount(wide.deals!.won.value, 'USD')).toBe('2000.00');
    const old = await get(t.admin, `range=custom&from=${ymdOf(ago(46))}&to=${ymdOf(ago(35))}`);
    expect(old.deals!.won.count).toBe(1);
    expect(old.deals!.lost.count).toBe(1);
    const week = await get(t.admin, 'range=7d');
    expect(week.deals!.won.count).toBe(3);
    expect(week.period.days).toBe(7);
    const month = await get(t.admin, 'range=month');
    expect(month.period.fromDate.endsWith('-01')).toBe(true);
    expect(month.period.toDate).toBe(month.period.today);
  });

  it('the viewer time zone cuts the period: the profile zone wins over the workspace zone', async () => {
    await h.owner.query(
      `INSERT INTO user_profiles (org_id, user_id, timezone) VALUES ($1,$2,'Pacific/Auckland') ON CONFLICT (org_id, user_id) DO UPDATE SET timezone = 'Pacific/Auckland'`,
      [t.orgId, alice.userId],
    );
    const d = await get(alice.token, 'range=7d');
    expect(d.period.timezone).toBe('Pacific/Auckland');
    expect(d.period.toDate).toBe(d.period.today);
    // Auckland is 12 or 13 hours ahead: its today is today or tomorrow in UTC, never earlier
    expect(d.period.today >= ymdOf(new Date().toISOString())).toBe(true);
  });

  it('refuses what is not valid: an unknown pipeline, owner or team is 404; a period over 366 days is 422; a bad range is 422', async () => {
    const zero = '00000000-0000-4000-8000-000000000000';
    for (const qs of [`pipelineId=${zero}`, `ownerId=${zero}`, `teamId=${zero}`]) {
      const res = await api.as(t.admin).get(`/v2/crm/dashboard?${qs}`);
      expect(res.status, qs).toBe(404);
    }
    const long = await api
      .as(t.admin)
      .get(`/v2/crm/dashboard?range=custom&from=${ymdOf(ago(500))}&to=${ymdOf(ago(0))}`);
    expect(long.status).toBe(422);
    expect(long.body.code).toBe('VALIDATION_FAILED');
    expect((await api.as(t.admin).get('/v2/crm/dashboard?range=forever')).status).toBe(422);
    expect(
      (await api.as(t.admin).get('/v2/crm/dashboard?range=custom&from=2026-03-02&to=2026-03-01'))
        .status,
    ).toBe(422);
  });
});

describe('permissions, the plan gate, tenant isolation and the empty workspace', () => {
  it('a member without the deals read capability is refused; one with only deals read gets the deal sections and null for the rest', async () => {
    const t = await api.signup('crmp');
    const none = await api.member(t, 'nodeals', [['record.contacts.read']]);
    expect((await api.as(none.token).get('/v2/crm/dashboard')).status).toBe(403);
    const dealsOnly = await api.member(t, 'dealsonly', [['record.deals.read']]);
    const d = await get(dealsOnly.token);
    expect(d.deals).not.toBeNull();
    expect(d.contacts).toBeNull();
    expect(d.tasks).toBeNull();
    expect(d.invoices).toBeNull();
    expect(d.activity).not.toBeNull();
    const unauth = await api.http().get('/v2/crm/dashboard');
    expect(unauth.status).toBe(401);
  });

  it('a workspace whose plan lacks the sales pipeline is refused with 422 PLAN_FEATURE_LOCKED; one without invoicing loses only the invoices section', async () => {
    const t = await api.signup('crmg');
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"invoicing":false}}' WHERE org_id = $1`,
      [t.orgId],
    );
    const noInv = await get(t.admin);
    expect(noInv.invoices).toBeNull();
    expect(noInv.deals).not.toBeNull();
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"sales_pipeline":false}}' WHERE org_id = $1`,
      [t.orgId],
    );
    const locked = await api.as(t.admin).get('/v2/crm/dashboard');
    expect(locked.status).toBe(422);
    expect(locked.body.code).toBe('PLAN_FEATURE_LOCKED');
  });

  it('tenant isolation: another workspace sees none of the first one, and cannot name its pipeline, owner or team', async () => {
    const a = await api.signup('crmiA');
    const b = await api.signup('crmiB');
    const pa = await api.defaultPipeline(a.admin);
    await api.seedDeals(a, pa.pipeline.id, pa.stage['Won']!.id, [
      { title: 'A won', valueMinor: 99_900, ownerId: a.adminUserId, status: 'won' },
    ]);
    await api.seedContacts(a, [{ name: 'A lead', source: 'meta', ownerId: a.adminUserId }]);
    const mine = await get(a.admin);
    expect(mine.deals!.won.count).toBe(1);
    const theirs = await get(b.admin);
    expect(theirs.deals!.won.count).toBe(0);
    expect(theirs.deals!.open.count).toBe(0);
    expect(theirs.contacts!.newContacts.current).toBe(0);
    expect(theirs.contacts!.sources).toEqual([]);
    const aUser = await api.userUuid(a.adminUserId);
    expect((await api.as(b.admin).get(`/v2/crm/dashboard?ownerId=${aUser}`)).status).toBe(404);
    expect(
      (await api.as(b.admin).get(`/v2/crm/dashboard?pipelineId=${pa.pipeline.id}`)).status,
    ).toBe(404);
  });

  it('an empty workspace answers zeros and empty lists, never an error', async () => {
    const t = await api.signup('crme');
    const d = await get(t.admin);
    expect(d.deals).toMatchObject({
      open: { count: 0 },
      won: { count: 0, averageCycleDays: null, previousCount: 0 },
      lost: { count: 0, previousCount: 0 },
      winRate: 0,
      overdueCloseCount: 0,
      leaderboard: [],
    });
    expect(d.deals!.won.averageSize.byCurrency).toEqual([]);
    expect(d.deals!.funnel.cohortSize).toBe(0);
    expect(
      d.deals!.funnel.stages.every((s) => s.reached === 0 && s.conversionFromPrevious === null),
    ).toBe(true);
    expect(d.deals!.trend.points.every((p) => p.wonCount === 0 && p.lostCount === 0)).toBe(true);
    expect(d.contacts).toMatchObject({ newContacts: { current: 0 }, sources: [] });
    expect(d.tasks).toMatchObject({
      open: 0,
      overdue: 0,
      dueToday: 0,
      byAssignee: [],
      upcoming: [],
    });
    expect(d.invoices).toMatchObject({ openInvoices: 0, paidInvoices: 0, recentPayments: [] });
  });
});
