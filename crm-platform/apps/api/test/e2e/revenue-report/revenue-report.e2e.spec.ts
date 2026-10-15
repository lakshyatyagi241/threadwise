import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { until, startPipeline, type Pipeline } from '../chat-conversations/pipeline-support';
import { DealsApi, type Grant, type Tenant } from '../deals-pipelines/support';

/**
 * The revenue report (`GET /v2/crm/revenue`) and its files end to end against a real Postgres (restricted role, forced RLS), real
 * Redis and the file worker loaded into the same process. Every figure is checked against seeded invoices and payments to the cent;
 * then the record scopes (own vs all), the permissions, the filters, currency conversion, tenant isolation and the CSV and PDF files.
 * Rows are arranged through the API and the owner connection; everything asserted goes through HTTP.
 */
let p: Pipeline;
let api: DealsApi;
let t: Tenant;
let other: Tenant;
let alice: { token: string; userId: number };
let bob: { token: string; userId: number };
let carol: { token: string; userId: number }; // reads everything, no export key
let dave: { token: string; userId: number }; // export key only, no read key
let aliceUuid: string;
let bobUuid: string;
let teamA = '';
let teamB = '';

const DAY = 86_400_000;
const NOW = Date.now();
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();
const ymd = (iso: string) => iso.slice(0, 10);
const A = (token: string) => api.as(token);

const READ_ALL: Grant[] = [['record.payments.read']];

interface Totals {
  byCurrency: Array<{ currency: string; amount: string }>;
  converted?: { currency: string; amount: string } | null;
  unconverted?: string[];
}
interface Pair {
  current: Totals;
  previous: Totals | null;
}
interface Metrics {
  invoiced: Pair;
  credited: Pair;
  paid: Pair;
  outstanding: Pair;
  overdue: Pair;
  collected: Pair;
  refunded: Pair;
}
interface Report {
  period: {
    range: string;
    timezone: string;
    fromDate: string;
    toDate: string;
    days: number;
    today: string;
  };
  comparison: { mode: string; fromDate: string; toDate: string } | null;
  convertedTo: string | null;
  currencies: string[];
  mixedCurrency: boolean;
  summary: {
    metrics: Metrics;
    taxCollected: Pair;
    invoices: {
      issued: { current: number; previous: number | null };
      paidInFull: { current: number; previous: number | null };
    };
    receivables: { outstanding: Totals; overdue: Totals; invoices: number };
    collectedAllTime: Totals;
  };
  rows: {
    groupBy: string;
    truncated: boolean;
    items: Array<{
      key: string;
      label: string | null;
      id: string | null;
      invoices: { current: number; previous: number | null };
      metrics: Metrics;
    }>;
  };
  trend: { bucket: string; points: Array<{ start: string; invoiced: Totals; collected: Totals }> };
  aging: {
    asOf: string;
    currencies: Array<{
      currency: string;
      total: string;
      invoices: number;
      buckets: Array<{ bucket: string; amount: string }>;
    }>;
  };
}

const get = async (token: string, qs = 'range=30d'): Promise<Report> => {
  const res = await A(token).get(`/v2/crm/revenue?${qs}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Report;
};
const amount = (t: Totals | null | undefined, currency: string) =>
  t?.byCurrency.find((x) => x.currency === currency)?.amount;
const row = (r: Report, key: string) => r.rows.items.find((x) => x.key === key)!;

beforeAll(async () => {
  p = await startPipeline(async () => [
    (await import('../../../src/modules/crm/revenue-report/revenue-report-worker.module'))
      .RevenueReportWorkerModule,
  ]);
  api = new DealsApi(p.h);
  await p.h.owner.query(
    `INSERT INTO currencies (name, code, symbol, exchange_rate) VALUES ('US Dollar','USD','$',1), ('Euro','EUR','E',0.9) ON CONFLICT (code) DO UPDATE SET exchange_rate = EXCLUDED.exchange_rate`,
  );
  t = await api.signup('revenue');
  other = await api.signup('revenueother');
  alice = await api.member(t, 'alice', READ_ALL);
  bob = await api.member(t, 'bob', [['record.payments.read', 'own'], ['record.payments.export']]);
  carol = await api.member(t, 'carol', READ_ALL);
  dave = await api.member(t, 'dave', [['record.payments.export']]);
  aliceUuid = await api.userUuid(alice.userId);
  bobUuid = await api.userUuid(bob.userId);

  // two teams, one person on each
  const team = async (name: string, userId: number) => {
    const r = await p.h.owner.query(
      `INSERT INTO teams (org_id, name) VALUES ($1, $2) RETURNING id, uuid`,
      [t.orgId, name],
    );
    await p.h.owner.query(
      `INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1, $2, $3)`,
      [t.orgId, r.rows[0].id, userId],
    );
    return r.rows[0].uuid as string;
  };
  teamA = await team('Sales A', alice.userId);
  teamB = await team('Sales B', bob.userId);

  const [c1, c2] = await api.seedContacts(t, [
    { name: 'Meta Customer', source: 'meta' },
    { name: 'Hook Customer', source: 'webhook' },
  ]);

  const invoice = async (
    ownerUuid: string,
    body: Record<string, unknown>,
  ): Promise<{ id: string }> => {
    const created = await A(t.admin)
      .post('/v2/invoices')
      .send({ buyerName: 'Buyer', ownerId: ownerUuid, currency: 'USD', ...body });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const issued = await A(t.admin).post(`/v2/invoices/${created.body.id}/issue`).send({});
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    return { id: issued.body.id as string };
  };
  const pay = async (invoiceId: string, amount: string, paidAt: string) => {
    const res = await A(t.admin)
      .post(`/v2/invoices/${invoiceId}/payments`)
      .send({ amount, paidAt });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return (res.body as { payment: { id: string } }).payment;
  };

  // I1: alice, a "meta" customer, two lines (the WIDGET sku and a setup line), 150.00, 90.00 paid, then 10.00 refunded
  const i1 = await invoice(aliceUuid, {
    contactId: c1,
    issueDate: ymd(ago(3)),
    dueDate: ymd(ago(-10)),
    lines: [
      { description: 'Widget', sku: 'WIDGET', qty: '1', unitPrice: '100.00', taxRateId: null },
      { description: 'Setup', qty: '1', unitPrice: '50.00', taxRateId: null },
    ],
  });
  const p1 = await pay(i1.id, '90.00', ago(2));
  const refund = await A(t.admin).post(`/v2/payments/${p1.id}/refund`).send({ amount: '10.00' });
  expect(refund.status, JSON.stringify(refund.body)).toBe(200);
  // I2: bob, a "webhook" customer, 200.00, due and unpaid
  await invoice(bobUuid, {
    contactId: c2,
    issueDate: ymd(ago(5)),
    dueDate: ymd(ago(1)),
    lines: [
      { description: 'Widget', sku: 'WIDGET', qty: '1', unitPrice: '200.00', taxRateId: null },
    ],
  });
  // I3: alice, no customer, EUR, paid in full
  const i3 = await invoice(aliceUuid, {
    currency: 'EUR',
    issueDate: ymd(ago(1)),
    lines: [{ description: 'Consulting', qty: '1', unitPrice: '100.00', taxRateId: null }],
  });
  await pay(i3.id, '100.00', ago(0.5));
  // I4: bob, the same "meta" customer, in the comparison window, paid in full
  const i4 = await invoice(bobUuid, {
    contactId: c1,
    issueDate: ymd(ago(40)),
    dueDate: ymd(ago(30)),
    lines: [
      { description: 'Widget', sku: 'WIDGET', qty: '1', unitPrice: '80.00', taxRateId: null },
    ],
  });
  await pay(i4.id, '80.00', ago(35));
  // a draft never counts
  const draft = await A(t.admin)
    .post('/v2/invoices')
    .send({
      buyerName: 'Draft',
      ownerId: aliceUuid,
      currency: 'USD',
      lines: [{ description: 'Draft', qty: '1', unitPrice: '999.00', taxRateId: null }],
    });
  expect(draft.status).toBe(201);
}, 900_000);

afterAll(async () => {
  await p?.stop();
});

describe('the report against seeded invoices and payments', () => {
  it('the period, its comparison and the totals match the rows to the cent', async () => {
    const r = await get(t.admin);
    expect(r.period).toMatchObject({
      range: '30d',
      timezone: 'UTC',
      days: 30,
      fromDate: ymd(ago(29)),
      toDate: ymd(ago(0)),
    });
    expect(r.comparison).toEqual({
      mode: 'previous',
      fromDate: ymd(ago(59)),
      toDate: ymd(ago(30)),
    });
    expect(r.currencies).toEqual(['EUR', 'USD']);
    expect(r.mixedCurrency).toBe(true);
    const m = r.summary.metrics;
    // invoices ISSUED in the period: 150 + 200 USD and 100 EUR; the comparison window holds the 80 USD one
    expect(amount(m.invoiced.current, 'USD')).toBe('350.00');
    expect(amount(m.invoiced.current, 'EUR')).toBe('100.00');
    expect(amount(m.invoiced.previous, 'USD')).toBe('80.00');
    // paid so far, net of the refund; still owed now; the part past due
    expect(amount(m.paid.current, 'USD')).toBe('80.00');
    expect(amount(m.paid.current, 'EUR')).toBe('100.00');
    expect(amount(m.paid.previous, 'USD')).toBe('80.00');
    expect(amount(m.outstanding.current, 'USD')).toBe('270.00');
    expect(amount(m.outstanding.current, 'EUR')).toBe('0.00');
    expect(amount(m.overdue.current, 'USD')).toBe('200.00');
    // money that came in during the period, whichever invoice it settled
    expect(amount(m.collected.current, 'USD')).toBe('90.00');
    expect(amount(m.collected.current, 'EUR')).toBe('100.00');
    expect(amount(m.collected.previous, 'USD')).toBe('80.00');
    expect(amount(m.refunded.current, 'USD')).toBe('10.00');
    expect(r.summary.invoices).toEqual({
      issued: { current: 3, previous: 1 },
      paidInFull: { current: 1, previous: 1 },
    });
    // Reference's "Outstanding": every open invoice as of today, whatever the period
    expect(amount(r.summary.receivables.outstanding, 'USD')).toBe('270.00');
    expect(amount(r.summary.receivables.overdue, 'USD')).toBe('200.00');
    expect(r.summary.receivables.invoices).toBe(2);
    expect(amount(r.summary.collectedAllTime, 'USD')).toBe('170.00');
    // no tax rate on any line
    expect(
      r.summary.taxCollected.current.byCurrency.every(
        (x) => x.amount === '0.00' || x.amount === '0',
      ),
    ).toBe(true);
  });

  it('a draft is not revenue', async () => {
    const r = await get(t.admin, 'range=30d&compare=none');
    expect(amount(r.summary.metrics.invoiced.current, 'USD')).toBe('350.00');
    expect(r.comparison).toBeNull();
    expect(r.summary.metrics.invoiced.previous).toBeNull();
    expect(r.summary.invoices.issued.previous).toBeNull();
  });

  it('by lead source: each customer source is a row, no customer is the empty row, the comparison follows the source', async () => {
    const r = await get(t.admin, 'range=30d&groupBy=source');
    expect(r.rows.groupBy).toBe('source');
    expect(r.rows.items.map((x) => x.key)).toEqual(['webhook', 'meta', '']);
    const meta = row(r, 'meta');
    expect(meta.label).toBe('meta');
    expect(meta.invoices).toEqual({ current: 1, previous: 1 });
    expect(amount(meta.metrics.invoiced.current, 'USD')).toBe('150.00');
    expect(amount(meta.metrics.invoiced.previous, 'USD')).toBe('80.00');
    expect(amount(meta.metrics.collected.current, 'USD')).toBe('90.00');
    expect(amount(meta.metrics.refunded.current, 'USD')).toBe('10.00');
    expect(amount(row(r, 'webhook').metrics.outstanding.current, 'USD')).toBe('200.00');
    const none = row(r, '');
    expect(none.label).toBeNull();
    expect(amount(none.metrics.invoiced.current, 'EUR')).toBe('100.00');
  });

  it('by invoice origin', async () => {
    const r = await get(t.admin, 'range=30d&groupBy=origin');
    expect(r.rows.items.map((x) => x.key)).toEqual(['manual']);
    expect(amount(r.rows.items[0]!.metrics.invoiced.current, 'USD')).toBe('350.00');
  });

  it('by owner: each person with their name and id', async () => {
    const r = await get(t.admin, 'range=30d&groupBy=owner&convertTo=USD');
    // alice's 150.00 + 100.00 EUR (111.11) outranks bob's 200.00
    expect(r.rows.items.map((x) => x.label)).toEqual(['alice', 'bob']);
    expect(row(r, aliceUuid).id).toBe(aliceUuid);
    // alice: 150.00 USD + 100.00 EUR at 0.9 = 111.11
    expect(row(r, aliceUuid).metrics.invoiced.current.converted).toEqual({
      currency: 'USD',
      amount: '261.11',
    });
    expect(amount(row(r, bobUuid).metrics.invoiced.previous, 'USD')).toBe('80.00');
  });

  it('by team: a person on a team lands in that team, the rest in the empty row', async () => {
    const r = await get(t.admin, 'range=30d&groupBy=team');
    expect(r.rows.items.map((x) => [x.label, x.id])).toEqual(
      expect.arrayContaining([
        ['Sales A', teamA],
        ['Sales B', teamB],
      ]),
    );
    expect(amount(row(r, teamA).metrics.invoiced.current, 'USD')).toBe('150.00');
    expect(amount(row(r, teamB).metrics.invoiced.current, 'USD')).toBe('200.00');
  });

  it('by product: a line is a SKU or its description; discount, shipping and rounding follow the lines so rows add up', async () => {
    const r = await get(t.admin, 'range=30d&groupBy=product&currency=USD');
    const widget = row(r, 'WIDGET');
    const setup = row(r, 'setup');
    expect(widget.label).toBe('Widget');
    // 100 of I1's 150 and all of I2's 200
    expect(amount(widget.metrics.invoiced.current, 'USD')).toBe('300.00');
    expect(amount(setup.metrics.invoiced.current, 'USD')).toBe('50.00');
    // I1's 90.00 collected is spread 2/3 and 1/3
    expect(amount(widget.metrics.collected.current, 'USD')).toBe('60.00');
    expect(amount(setup.metrics.collected.current, 'USD')).toBe('30.00');
    // net paid 80.00 and refund 10.00 are spread the same way and still add up
    expect(amount(widget.metrics.paid.current, 'USD')).toBe('53.33');
    expect(amount(setup.metrics.paid.current, 'USD')).toBe('26.67');
    expect(amount(widget.metrics.refunded.current, 'USD')).toBe('6.67');
    expect(amount(setup.metrics.refunded.current, 'USD')).toBe('3.33');
    expect(amount(widget.metrics.invoiced.previous, 'USD')).toBe('80.00');
  });

  it('the trend has a point per day, zero days included, and adds up to the period', async () => {
    const tr = (await get(t.admin)).trend;
    expect(tr.bucket).toBe('day');
    expect(tr.points).toHaveLength(30);
    const day = (iso: string) => tr.points.find((x) => x.start === ymd(iso))!;
    expect(amount(day(ago(3)).invoiced, 'USD')).toBe('150.00');
    expect(amount(day(ago(2)).collected, 'USD')).toBe('90.00');
    const sum = (f: (x: (typeof tr.points)[number]) => Totals, cur: string) =>
      tr.points.reduce((a, x) => a + Number(amount(f(x), cur) ?? 0), 0);
    expect(sum((x) => x.invoiced, 'USD')).toBe(350);
    expect(sum((x) => x.collected, 'EUR')).toBe(100);
    expect((await get(t.admin, 'range=year')).trend.bucket).toBe('month');
  });

  it('receivables aging is per currency over the same scope', async () => {
    const a = (await get(t.admin)).aging;
    expect(a.asOf).toBe(ymd(ago(0)));
    expect(a.currencies.map((c) => c.currency)).toEqual(['USD']);
    const buckets = Object.fromEntries(a.currencies[0]!.buckets.map((b) => [b.bucket, b.amount]));
    expect(buckets).toMatchObject({ current: '70.00', d1_30: '200.00' });
  });

  it('with a target currency the figures are converted, and a currency with no rate is named', async () => {
    const r = await get(t.admin, 'range=30d&convertTo=USD');
    expect(r.convertedTo).toBe('USD');
    expect(r.mixedCurrency).toBe(false);
    expect(r.summary.metrics.invoiced.current.converted).toEqual({
      currency: 'USD',
      amount: '461.11',
    });
    await p.h.owner.query(`UPDATE currencies SET is_active = false WHERE code = 'EUR'`);
    try {
      const gap = await get(t.admin, 'range=30d&convertTo=USD');
      expect(gap.summary.metrics.invoiced.current.converted).toBeNull();
      expect(gap.summary.metrics.invoiced.current.unconverted).toEqual(['EUR']);
    } finally {
      await p.h.owner.query(`UPDATE currencies SET is_active = true WHERE code = 'EUR'`);
    }
  });

  it('filters: one currency, one owner, one team', async () => {
    const eur = await get(t.admin, 'range=30d&currency=EUR');
    expect(eur.summary.metrics.invoiced.current.byCurrency).toEqual([
      { currency: 'EUR', amount: '100.00' },
    ]);
    expect(eur.mixedCurrency).toBe(false);
    const mine = await get(t.admin, `range=30d&ownerId=${bobUuid}`);
    expect(amount(mine.summary.metrics.invoiced.current, 'USD')).toBe('200.00');
    expect(amount(mine.summary.metrics.invoiced.current, 'EUR')).toBeUndefined();
    const team = await get(t.admin, `range=30d&teamId=${teamA}`);
    expect(amount(team.summary.metrics.invoiced.current, 'USD')).toBe('150.00');
    expect(amount(team.summary.metrics.collected.current, 'EUR')).toBe('100.00');
    expect((await A(t.admin).get(`/v2/crm/revenue?ownerId=${other.orgId}-x`)).status).toBe(422);
    expect(
      (await A(t.admin).get('/v2/crm/revenue?ownerId=00000000-0000-4000-8000-000000000000')).status,
    ).toBe(404);
    expect(
      (await A(t.admin).get('/v2/crm/revenue?teamId=00000000-0000-4000-8000-000000000000')).status,
    ).toBe(404);
  });

  it('other periods and a same-dates-last-year comparison', async () => {
    const last = await get(t.admin, 'range=lastMonth');
    expect(last.period.days).toBeGreaterThanOrEqual(28);
    expect(last.period.fromDate.endsWith('-01')).toBe(true);
    const yoy = await get(t.admin, 'range=month&compare=lastYear');
    expect(yoy.comparison!.mode).toBe('lastYear');
    expect(yoy.comparison!.fromDate).toBe(
      `${Number(yoy.period.fromDate.slice(0, 4)) - 1}${yoy.period.fromDate.slice(4)}`,
    );
    const custom = await get(t.admin, `range=custom&from=${ymd(ago(10))}&to=${ymd(ago(0))}`);
    expect(custom.period).toMatchObject({ range: 'custom', days: 11 });
    const bad = await A(t.admin).get(`/v2/crm/revenue?range=custom&from=${ymd(ago(400))}`);
    expect(bad.status).toBe(422);
    expect(
      (await A(t.admin).get('/v2/crm/revenue?range=custom&from=2026-02-02&to=2026-02-01')).status,
    ).toBe(422);
  });

  it('an empty workspace answers with zeros, not errors', async () => {
    const r = await get(other.admin);
    expect(r.rows.items).toEqual([]);
    expect(r.summary.metrics.invoiced.current.byCurrency).toEqual([]);
    expect(r.summary.receivables.invoices).toBe(0);
    expect(r.trend.points.length).toBe(30);
  });
});

describe('record scope, permissions and isolation', () => {
  it('own scope sees only the invoices it owns, and nothing of the others in any figure', async () => {
    const r = await get(bob.token);
    expect(amount(r.summary.metrics.invoiced.current, 'USD')).toBe('200.00');
    expect(amount(r.summary.metrics.invoiced.previous, 'USD')).toBe('80.00');
    expect(amount(r.summary.metrics.invoiced.current, 'EUR')).toBeUndefined();
    expect(amount(r.summary.metrics.collected.current, 'USD')).toBeUndefined();
    expect(r.currencies).toEqual(['USD']);
    expect(r.summary.receivables.invoices).toBe(1);
    const owners = await get(bob.token, 'groupBy=owner');
    expect(owners.rows.items.map((x) => x.label)).toEqual(['bob']);
  });

  it('all scope sees everything', async () => {
    const r = await get(alice.token);
    expect(amount(r.summary.metrics.invoiced.current, 'USD')).toBe('350.00');
  });

  it('needs the payments read key', async () => {
    expect((await A(dave.token).get('/v2/crm/revenue')).status).toBe(403);
    expect((await api.http().get('/v2/crm/revenue')).status).toBe(401);
  });

  it('a workspace whose plan lacks the sales pipeline is refused with 422 PLAN_FEATURE_LOCKED, for the report and its files', async () => {
    const locked = await api.signup('revlocked');
    await p.h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"sales_pipeline":false}}' WHERE org_id = $1`,
      [locked.orgId],
    );
    const res = await A(locked.admin).get('/v2/crm/revenue');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PLAN_FEATURE_LOCKED');
    expect((await A(locked.admin).get('/v2/crm/revenue/exports')).status).toBe(422);
  });
});

describe('the files', () => {
  const request = (token: string, body: Record<string, unknown>) =>
    A(token)
      .post('/v2/crm/revenue/exports')
      .set('idempotency-key', `rev-${Date.now()}-${Math.random()}`)
      .send(body);
  const ready = async (token: string, id: string) =>
    until(
      'export ready',
      async () => {
        const l = await A(token).get('/v2/crm/revenue/exports');
        const e = (l.body.data as Array<{ id: string; status: string; error: string | null }>).find(
          (x) => x.id === id,
        );
        return e?.status === 'ready'
          ? e
          : e?.status === 'failed'
            ? Promise.reject(new Error(`export failed: ${e.error}`))
            : undefined;
      },
      90_000,
    );
  const auditCount = async () =>
    Number(
      (
        await p.h.owner.query(
          `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'revenue-report-exports' AND action = 'export'`,
          [t.orgId],
        )
      ).rows[0].n,
    );

  it('the export key is separate from the read key, and a file needs both', async () => {
    expect((await request(carol.token, { format: 'csv' })).status).toBe(403);
    expect((await request(dave.token, { format: 'csv' })).status).toBe(403);
    expect((await A(carol.token).get('/v2/crm/revenue/exports')).status).toBe(403);
    expect((await A(dave.token).get('/v2/crm/revenue/exports')).status).toBe(200);
    expect((await request(t.admin, { format: 'xlsx' })).status).toBe(422);
    expect((await api.http().post('/v2/crm/revenue/exports').send({ format: 'csv' })).status).toBe(
      401,
    );
  });

  it("the payments CSV is Reference's file: its nine columns first, one line per payment and refund of the period", async () => {
    const before = await auditCount();
    const req = await request(t.admin, { format: 'csv', csvKind: 'payments', range: '30d' });
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    expect(req.body).toMatchObject({ status: 'queued', format: 'csv', csvKind: 'payments' });
    expect(req.body.filters).toMatchObject({
      fromDate: ymd(ago(29)),
      toDate: ymd(ago(0)),
      timezone: 'UTC',
    });
    expect(await auditCount()).toBe(before + 1);
    const done = await ready(t.admin, req.body.id);
    expect(done.status).toBe('ready');

    const file = await A(t.admin).get(`/v2/crm/revenue/exports/${req.body.id}/download`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('text/csv');
    expect(file.headers['content-disposition']).toContain(
      `revenue-payments-${ymd(ago(29))}_${ymd(ago(0))}.csv`,
    );
    const lines = file.text
      .replace(/^\uFEFF/, '')
      .trimEnd()
      .split('\n');
    expect(lines[0]).toBe(
      'Date,Amount,Currency,Method,Source,Invoice,Contact,Company,Reference,Type,Receipt,Owner',
    );
    // the refund (newest), the EUR payment and the 90.00 payment; the 80.00 payment of the comparison window is not in it
    expect(lines).toHaveLength(4);
    const body = lines.slice(1).join('\n');
    expect(body).toContain(',-10.00,USD,');
    expect(body).toContain(',100.00,EUR,');
    expect(body).toContain(',90.00,USD,');
    expect(body).not.toContain(',80.00,');
    expect(body).toContain('Meta Customer');
    expect(body).toContain(',refund,');
    // the person was told by email, once
    const mails = p.h.mail.filter((m) => /revenue report CSV is ready/.test(m.subject ?? ''));
    expect(mails.length).toBeGreaterThanOrEqual(1);
    expect(mails[mails.length - 1]!.text).toContain(`/crm/revenue?export=${req.body.id}`);
  });

  it('a file holds no more than the report shows the person: an own-scope export has only their invoices', async () => {
    const req = await request(bob.token, { format: 'csv', csvKind: 'payments', range: '90d' });
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    await ready(bob.token, req.body.id);
    const csv = (await A(bob.token).get(`/v2/crm/revenue/exports/${req.body.id}/download`)).text;
    const lines = csv
      .replace(/^\uFEFF/, '')
      .trimEnd()
      .split('\n');
    expect(lines).toHaveLength(2); // header + I4's 80.00; nothing of alice's invoices
    expect(lines[1]).toContain(',80.00,USD,');
  });

  it('the summary CSV is the table on screen', async () => {
    const req = await request(t.admin, {
      format: 'csv',
      csvKind: 'summary',
      range: '30d',
      groupBy: 'owner',
      convertTo: 'USD',
    });
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    await ready(t.admin, req.body.id);
    const file = await A(t.admin).get(`/v2/crm/revenue/exports/${req.body.id}/download`);
    const lines = file.text
      .replace(/^\uFEFF/, '')
      .trimEnd()
      .split('\n');
    expect(lines[0]).toContain('Owner,Basis,Currency,Invoices,Invoiced');
    expect(lines.some((l) => l.startsWith('Total,actual,USD,3,350.00'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Total,converted,USD,3,461.11'))).toBe(true);
    expect(lines.some((l) => l.startsWith('alice,actual,EUR,2,100.00'))).toBe(true);
  });

  it('the PDF is a real PDF with the report in it', async () => {
    const req = await request(t.admin, { format: 'pdf', range: '30d', groupBy: 'source' });
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    expect(req.body.csvKind).toBeNull();
    await ready(t.admin, req.body.id);
    const file = await A(t.admin)
      .get(`/v2/crm/revenue/exports/${req.body.id}/download`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(file.headers['content-type']).toContain('application/pdf');
    const text = (file.body as Buffer).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('Revenue report');
    expect(text).toContain('USD 350.00');
    expect(text).toContain('BY LEAD SOURCE');
  });

  it("one at a time per person; a person cannot see or download anyone else's file", async () => {
    await p.h.owner.query(
      `INSERT INTO revenue_report_exports (org_id, requested_by, format, csv_kind, scope, filters, status)
       VALUES ($1, $2, 'csv', 'payments', 'all', '{}'::jsonb, 'running')`,
      [t.orgId, bob.userId],
    );
    const busy = await request(bob.token, { format: 'csv' });
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe('REVENUE_EXPORT_IN_PROGRESS');
    // someone else is not held up by it
    const fine = await request(t.admin, { format: 'csv', range: 'lastMonth' });
    expect(fine.status).toBe(202);
    await ready(t.admin, fine.body.id);
    await p.h.owner.query(
      `UPDATE revenue_report_exports SET status = 'failed' WHERE org_id = $1 AND status = 'running'`,
      [t.orgId],
    );

    const mine = (await A(t.admin).get('/v2/crm/revenue/exports')).body.data as Array<{
      id: string;
    }>;
    const bobsFile = (await A(bob.token).get('/v2/crm/revenue/exports')).body.data as Array<{
      id: string;
    }>;
    expect(bobsFile.every((x) => !mine.some((m) => m.id === x.id))).toBe(true);
    const foreign = await A(bob.token).get(`/v2/crm/revenue/exports/${mine[0]!.id}/download`);
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe('REVENUE_EXPORT_NOT_FOUND');
    // another workspace
    const otherAdmin = await A(other.admin).get(`/v2/crm/revenue/exports/${mine[0]!.id}/download`);
    expect(otherAdmin.status).toBe(404);
    expect((await A(other.admin).get('/v2/crm/revenue/exports')).body.data).toEqual([]);
  });

  it('a file that has expired cannot be downloaded, and the sweep clears it', async () => {
    const list = (await A(t.admin).get('/v2/crm/revenue/exports')).body.data as Array<{
      id: string;
      status: string;
    }>;
    const one = list.find((x) => x.status === 'ready')!;
    await p.h.owner.query(
      `UPDATE revenue_report_exports SET expires_at = now() - interval '1 hour' WHERE uuid = $1`,
      [one.id],
    );
    const gone = await A(t.admin).get(`/v2/crm/revenue/exports/${one.id}/download`);
    expect(gone.status).toBe(409);
    expect(gone.body.code).toBe('REVENUE_EXPORT_NOT_READY');
    const { RevenueExportSweepService } =
      await import('../../../src/modules/crm/revenue-report/revenue-export-sweep.service');
    const out = await p.h.app.get(RevenueExportSweepService).sweep();
    expect(out.expired).toBeGreaterThanOrEqual(1);
    const row = await p.h.owner.query(
      `SELECT status, file_gz IS NULL AS cleared FROM revenue_report_exports WHERE uuid = $1`,
      [one.id],
    );
    expect(row.rows[0]).toEqual({ status: 'expired', cleared: true });
  });

  it('the sweep fails an export whose worker died', async () => {
    const r = await p.h.owner.query(
      `INSERT INTO revenue_report_exports (org_id, requested_by, format, csv_kind, scope, filters, status, started_at)
       VALUES ($1, $2, 'pdf', NULL, 'all', '{}'::jsonb, 'running', now() - interval '3 hours') RETURNING uuid`,
      [t.orgId, carol.userId],
    );
    const { RevenueExportSweepService } =
      await import('../../../src/modules/crm/revenue-report/revenue-export-sweep.service');
    const out = await p.h.app.get(RevenueExportSweepService).sweep();
    expect(out.failed).toBeGreaterThanOrEqual(1);
    const row = await p.h.owner.query(`SELECT status FROM revenue_report_exports WHERE uuid = $1`, [
      r.rows[0].uuid,
    ]);
    expect(row.rows[0].status).toBe('failed');
  });
});
