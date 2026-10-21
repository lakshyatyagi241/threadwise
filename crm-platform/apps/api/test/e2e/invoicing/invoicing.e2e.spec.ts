import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import { InvoiceOverdueSweepService } from '../../../src/modules/crm/invoicing/invoice-overdue-sweep.service';
import {
  DealsApi,
  startHarness,
  uuidRe,
  type Grant,
  type Harness,
  type Tenant,
} from '../deals-pipelines/support';

/**
 * Invoices, payments, tax rates, the public page and the payment webhook end to end through HTTP (TW-INV-001..031, TW-PAY-001..005,
 * TW-PAY-009, TW-PAY-015): plan gate and permissions, drafts and issuing, numbering under concurrency, the frozen invoice, the
 * payment ledger, aging and outstanding, the buyer's page and PDF, the signed webhook, the overdue sweep, conversion from a quote,
 * and the audit, outbox and tenant properties every write must have. One app, one database; each block works in organizations of
 * its own.
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
let ipN = 1;
/** A fresh client address per call, so the per-IP throttle of the public routes does not couple unrelated tests. */
const freshIp = () => `10.99.${Math.floor(ipN / 250)}.${ipN++ % 250}`;
/** The per-minute counters are fixed windows: start a burst only when it cannot straddle a minute boundary. */
async function inSafeWindow(burstMs: number): Promise<void> {
  const left = 60_000 - (Date.now() % 60_000);
  if (left < burstMs + 3_000) await new Promise((r) => setTimeout(r, left + 200));
}
const sqlN = async (sql: string, params: unknown[] = []) =>
  Number((await h.owner.query(sql, params)).rows[0].n);

/** `YYYY-MM-DD` of today (UTC: the test workspaces have no time zone) shifted by whole days. */
const ymd = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

interface Inv {
  id: string;
  number: string | null;
  docType: string;
  source: string;
  status: string;
  storedStatus: string;
  paymentStatus: string;
  overdue: boolean;
  daysOverdue: number | null;
  currency: string;
  amounts: Record<string, string>;
  amountsMinor: Record<string, string>;
  buyerName: string | null;
  contact: { id: string; name: string | null } | null;
  deal: { id: string; title: string } | null;
  owner: { id: string; name: string } | null;
  issueDate: string | null;
  dueDate: string | null;
  rowVersion: number;
  lines: Array<{
    id: string;
    position: number;
    description: string;
    qty: string;
    unitPrice: string;
    hsnSac: string | null;
    taxName: string | null;
    taxRate: string;
    taxInclusive: boolean;
    taxRateId: string | null;
    taxComponents: Array<{ type: string; rate: string; amount: string }> | null;
    amounts: Record<string, string>;
  }>;
  taxSummary: Array<{ name: string; rate: string; inclusive: boolean; base: string; tax: string }>;
  publicLink: { token: string; path: string; active: boolean; expiresAt: string | null } | null;
  seller: {
    name: string | null;
    taxId: string | null;
    bankDetails: Record<string, string> | null;
  } | null;
  viewCount: number;
  sentAt: string | null;
  voidReason: string | null;
  quote: { id: string; number: string; kind: string } | null;
  salesOrder: { id: string; number: string } | null;
  recurring: { id: string; name: string } | null;
  notes: string | null;
}

const LINE = { description: 'Consulting', qty: '2', unitPrice: '50.00' };

async function make(token: string, body: Record<string, unknown> = {}): Promise<Inv> {
  const res = await api
    .as(token)
    .post('/v2/invoices')
    .send({ buyerName: 'Acme Ltd', lines: [LINE], ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Inv;
}
async function issue(token: string, id: string, body: Record<string, unknown> = {}): Promise<Inv> {
  const res = await api.as(token).post(`/v2/invoices/${id}/issue`).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Inv;
}
async function get(token: string, id: string): Promise<Inv> {
  const res = await api.as(token).get(`/v2/invoices/${id}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Inv;
}
async function issued(token: string, body: Record<string, unknown> = {}): Promise<Inv> {
  return issue(token, (await make(token, body)).id);
}
async function pay(
  token: string,
  id: string,
  body: Record<string, unknown>,
): Promise<{ payment: Record<string, string>; invoice: Record<string, string> }> {
  const res = await api.as(token).post(`/v2/invoices/${id}/payments`).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}
async function rate(token: string, body: Record<string, unknown>) {
  const res = await api.as(token).post('/v2/tax-rates').send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as {
    id: string;
    name: string;
    rate: string;
    isDefault: boolean;
    rowVersion: number;
  };
}
const pub = (path: string, method: 'get' | 'post' = 'get') =>
  api.http()[method](`/v2/public/invoices/${path}`).set('x-forwarded-for', freshIp());

const FULL_VIEWER: Grant[] = [
  ['record.invoices.read'],
  ['record.payments.read'],
  ['record.tax-rates.read'],
];
const BILLER: Grant[] = [
  ['record.invoices.read', 'own'],
  ['record.invoices.create'],
  ['record.invoices.update', 'own'],
  ['record.payments.read', 'own'],
  ['record.payments.create', 'own'],
];

describe('plan gate and permissions (TW-INV-024, D-14)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ipg');
  });

  it('TW-INV-024 #1 / D-14: a workspace whose plan lacks the sales pipeline is refused with 422 PLAN_FEATURE_LOCKED on every route, reads included (Reference showed a paywall over data it had already sent)', async () => {
    const inv = await issued(t.admin);
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"sales_pipeline":false}}' WHERE org_id = $1`,
      [t.orgId],
    );
    try {
      for (const [verb, path] of [
        ['get', '/v2/invoices'],
        ['get', '/v2/invoices/counts'],
        ['get', `/v2/invoices/${inv.id}`],
        ['get', '/v2/payments'],
        ['get', '/v2/payments/aging'],
        ['get', '/v2/tax-rates'],
        ['get', '/v2/invoice-settings'],
      ] as const) {
        const res = await api.as(t.admin)[verb](path);
        expect(res.status, path).toBe(422);
        expect(code(res), path).toBe('PLAN_FEATURE_LOCKED');
      }
      expect(
        (
          await api
            .as(t.admin)
            .post('/v2/invoices')
            .send({ buyerName: 'x', lines: [LINE] })
        ).status,
      ).toBe(422);
      // the buyer's page does not depend on the seller's plan
      expect((await pub(inv.publicLink!.token).send()).status).toBe(200);
    } finally {
      await h.owner.query(`UPDATE org_plan_state SET overrides = '{}' WHERE org_id = $1`, [
        t.orgId,
      ]);
    }
  });

  it('D-14: a reader reads but cannot create, edit, issue, void, delete, record a payment, refund or change settings; no permission at all is 403', async () => {
    const inv = await issued(t.admin);
    const reader = await api.member(t, 'reader', FULL_VIEWER);
    expect((await api.as(reader.token).get('/v2/invoices')).status).toBe(200);
    expect((await api.as(reader.token).get(`/v2/invoices/${inv.id}`)).status).toBe(200);
    const p = await pay(t.admin, inv.id, { amount: '10' });
    const denied = await Promise.all([
      api
        .as(reader.token)
        .post('/v2/invoices')
        .send({ buyerName: 'x', lines: [LINE] }),
      api.as(reader.token).patch(`/v2/invoices/${inv.id}`).send({ rowVersion: 1, notes: 'x' }),
      api.as(reader.token).post(`/v2/invoices/${inv.id}/issue`).send({}),
      api.as(reader.token).post(`/v2/invoices/${inv.id}/void`).send({ reason: 'x' }),
      api.as(reader.token).delete(`/v2/invoices/${inv.id}`),
      api.as(reader.token).post(`/v2/invoices/${inv.id}/payments`).send({ amount: '1' }),
      api.as(reader.token).post(`/v2/payments/${p.payment.id}/refund`).send({}),
      api.as(reader.token).patch('/v2/invoice-settings').send({ sellerName: 'x' }),
      api.as(reader.token).post('/v2/tax-rates').send({ name: 'x', rate: '1' }),
    ]);
    denied.forEach((r, i) => {
      expect(r.status, String(i)).toBe(403);
      expect(code(r)).toBe('FORBIDDEN');
    });
    const nobody = await api.member(t, 'nobody', []);
    for (const path of ['/v2/invoices', '/v2/payments', '/v2/tax-rates', '/v2/invoice-settings'])
      expect((await api.as(nobody.token).get(path)).status, path).toBe(403);
  });

  it('the Agent preset (sign-up) bills its own customers: creates drafts, reads and edits its own invoices, records payments on them, reads tax rates; but cannot issue, void, delete, refund or change settings', async () => {
    const agent = await api.memberWithRole(t, 'agent', 'Agent');
    const mine = await make(agent.token);
    expect(mine.owner?.name).toBe('agent');
    expect((await api.as(agent.token).get(`/v2/invoices/${mine.id}`)).status).toBe(200);
    expect((await api.as(agent.token).get('/v2/tax-rates')).status).toBe(200);
    expect(
      (await api.as(agent.token).post('/v2/tax-rates').send({ name: 'x', rate: '1' })).status,
    ).toBe(403);
    expect((await api.as(agent.token).post(`/v2/invoices/${mine.id}/issue`).send({})).status).toBe(
      403,
    );
    expect((await api.as(agent.token).delete(`/v2/invoices/${mine.id}`)).status).toBe(403);
    expect(
      (await api.as(agent.token).patch('/v2/invoice-settings').send({ sellerName: 'x' })).status,
    ).toBe(403);
    // the admin issues it; the agent then records the payment it collected
    await issue(t.admin, mine.id);
    const paid = await pay(agent.token, mine.id, { amount: '25', method: 'cash' });
    expect(paid.invoice.paymentStatus).toBe('partially_paid');
    expect(
      (await api.as(agent.token).post(`/v2/invoices/${mine.id}/void`).send({ reason: 'x' })).status,
    ).toBe(403);
    expect(
      (await api.as(agent.token).post(`/v2/payments/${paid.payment.id}/refund`).send({})).status,
    ).toBe(403);
  });
});

describe('record scope (TW-INV-024: Reference had only "workspace admin")', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('isc');
  });

  it('an `own` reader sees only the invoices it owns or created: the list, the counts, the detail, the payments and the reports', async () => {
    const a = await api.member(t, 'a', BILLER);
    const b = await api.member(t, 'b', BILLER);
    const ia = await make(a.token, { buyerName: 'A-buyer' });
    const ib = await make(b.token, { buyerName: 'B-buyer' });
    const list = (await api.as(a.token).get('/v2/invoices')).body.data as Inv[];
    expect(list.map((x) => x.id)).toContain(ia.id);
    expect(list.map((x) => x.id)).not.toContain(ib.id);
    const peek = await api.as(a.token).get(`/v2/invoices/${ib.id}`);
    expect(peek.status).toBe(404); // not found, never forbidden: it is not revealed to exist
    expect(
      (await api.as(a.token).patch(`/v2/invoices/${ib.id}`).send({ rowVersion: 1, notes: 'x' }))
        .status,
    ).toBe(404);
    expect((await api.as(a.token).get(`/v2/invoices/${ib.id}/events`)).status).toBe(404);
    const counts = (await api.as(a.token).get('/v2/invoices/counts')).body;
    expect(counts.all).toBe(1);
    const all = (await api.as(t.admin).get('/v2/invoices/counts')).body;
    expect(all.all).toBeGreaterThanOrEqual(2);
    // payments on a colleague's invoice are invisible too
    await issue(t.admin, ib.id);
    await pay(t.admin, ib.id, { amount: '5' });
    expect((await api.as(a.token).get('/v2/payments')).body.data).toHaveLength(0);
    expect(
      (await api.as(a.token).post(`/v2/invoices/${ib.id}/payments`).send({ amount: '1' })).status,
    ).toBe(404);
    const rep = (await api.as(a.token).get('/v2/payments/summary')).body;
    expect(rep.collected).toEqual([]);
  });

  it("a `team` scope adds the people on the caller's teams", async () => {
    const lead = await api.member(t, 'lead', [
      ['record.invoices.read', 'team'],
      ['record.invoices.create'],
    ]);
    const mate = await api.member(t, 'mate', BILLER);
    const stranger = await api.member(t, 'stranger', BILLER);
    const team = await h.owner.query(
      `INSERT INTO teams (org_id, name) VALUES ($1,'Sales') RETURNING id`,
      [t.orgId],
    );
    for (const u of [lead.userId, mate.userId])
      await h.owner.query(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [
        t.orgId,
        team.rows[0].id,
        u,
      ]);
    const im = await make(mate.token);
    const is_ = await make(stranger.token);
    const ids = ((await api.as(lead.token).get('/v2/invoices')).body.data as Inv[]).map(
      (x) => x.id,
    );
    expect(ids).toContain(im.id);
    expect(ids).not.toContain(is_.id);
  });
});

describe('tax rates (TW-INV "tax rates", D-04)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('itr');
  });

  it('create, read, edit with rowVersion, and a taken name (any case) is 409 TAX_RATE_NAME_TAKEN', async () => {
    const r = await rate(t.admin, { name: 'VAT 20', type: 'vat', rate: '20' });
    expect(r).toMatchObject({ name: 'VAT 20', rate: '20', isDefault: false });
    const dup = await api.as(t.admin).post('/v2/tax-rates').send({ name: 'vat 20', rate: '5' });
    expect(dup.status).toBe(409);
    expect(code(dup)).toBe('TAX_RATE_NAME_TAKEN');
    const edited = await api
      .as(t.admin)
      .patch(`/v2/tax-rates/${r.id}`)
      .send({ rowVersion: r.rowVersion, rate: '21', inclusive: true });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body).toMatchObject({
      rate: '21',
      inclusive: true,
      rowVersion: r.rowVersion + 1,
    });
    const stale = await api
      .as(t.admin)
      .patch(`/v2/tax-rates/${r.id}`)
      .send({ rowVersion: r.rowVersion, rate: '22' });
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
    expect((await api.as(t.admin).get(`/v2/tax-rates/${r.id}`)).body.rate).toBe('21');
  });

  it('validation: a rate is 0 to 100 with up to four decimals (Quebec QST is 9.975); components of a compound rate add up to it', async () => {
    for (const rateStr of ['101', '-1', 'x', '10.12345']) {
      expect(
        (
          await api
            .as(t.admin)
            .post('/v2/tax-rates')
            .send({ name: `bad${rateStr}`, rate: rateStr })
        ).status,
        rateStr,
      ).toBeGreaterThanOrEqual(400);
    }
    const sum = await api
      .as(t.admin)
      .post('/v2/tax-rates')
      .send({
        name: 'GST bad',
        type: 'gst',
        rate: '18',
        components: [
          { type: 'CGST', rate: '9' },
          { type: 'SGST', rate: '8' },
        ],
      });
    expect(sum.status).toBe(422);
    expect(code(sum)).toBe('TAX_RATE_INVALID');
    const ok = await api
      .as(t.admin)
      .post('/v2/tax-rates')
      .send({
        name: 'GST 18',
        type: 'gst',
        rate: '18',
        components: [
          { type: 'CGST', rate: '9' },
          { type: 'SGST', rate: '9' },
        ],
        defaultHsnSac: '9983',
      });
    expect(ok.status).toBe(201);
    expect(ok.body.components).toEqual([
      { type: 'CGST', rate: '9' },
      { type: 'SGST', rate: '9' },
    ]);
  });

  it('one default per workspace: making another the default demotes the first; a default must be active; deactivating the default un-defaults it', async () => {
    const a = await rate(t.admin, { name: 'Def A', rate: '5', isDefault: true });
    const b = await rate(t.admin, { name: 'Def B', rate: '6' });
    expect(
      (await api.as(t.admin).post(`/v2/tax-rates/${b.id}/default`).send({})).body.isDefault,
    ).toBe(true);
    const list = (await api.as(t.admin).get('/v2/tax-rates')).body.data as Array<{
      id: string;
      isDefault: boolean;
    }>;
    expect(list.filter((x) => x.isDefault).map((x) => x.id)).toEqual([b.id]);
    expect(list[0]!.id).toBe(b.id); // the default is listed first
    // Read the row version BEFORE building the PATCH: supertest starts the app's listener when a request is created, and a second
    // request finishing in between (the GET inside .send(...)) closes it again, so the PATCH then dispatches on a closed server
    // ("Cannot read properties of null (reading 'address')").
    const { rowVersion } = (await api.as(t.admin).get(`/v2/tax-rates/${b.id}`)).body;
    const off = await api
      .as(t.admin)
      .patch(`/v2/tax-rates/${b.id}`)
      .send({ rowVersion, isActive: false });
    expect(off.body).toMatchObject({ isActive: false, isDefault: false });
    expect((await api.as(t.admin).post(`/v2/tax-rates/${b.id}/default`).send({})).status).toBe(422);
    expect(a.id).toBeTruthy();
  });

  it('active=true lists only the rates that can be picked today (active and inside their effective dates)', async () => {
    await rate(t.admin, { name: 'Past', rate: '1', effectiveTo: ymd(-10) });
    await rate(t.admin, { name: 'Future', rate: '1', effectiveFrom: ymd(10) });
    const cur = await rate(t.admin, {
      name: 'Current',
      rate: '1',
      effectiveFrom: ymd(-10),
      effectiveTo: ymd(10),
    });
    const names = (
      (await api.as(t.admin).get('/v2/tax-rates?active=true')).body.data as Array<{ name: string }>
    ).map((x) => x.name);
    expect(names).toContain('Current');
    expect(names).not.toContain('Past');
    expect(names).not.toContain('Future');
    expect(cur.id).toMatch(uuidRe);
  });

  it('a line that uses an inactive or out-of-window rate is 422 INV_TAX_RATE_INVALID; a rate of another workspace is 404', async () => {
    const past = await rate(t.admin, { name: 'Expired', rate: '1', effectiveTo: ymd(-1) });
    const res = await api
      .as(t.admin)
      .post('/v2/invoices')
      .send({ buyerName: 'x', lines: [{ ...LINE, taxRateId: past.id }] });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('INV_TAX_RATE_INVALID');
    const other = await api.signup('itr2');
    const foreign = await rate(other.admin, { name: 'Foreign', rate: '3' });
    const f = await api
      .as(t.admin)
      .post('/v2/invoices')
      .send({ buyerName: 'x', lines: [{ ...LINE, taxRateId: foreign.id }] });
    expect(f.status).toBe(404);
    expect((await api.as(t.admin).get(`/v2/tax-rates/${foreign.id}`)).status).toBe(404);
  });

  it('deleting a rate keeps every invoice written with it exactly as it was (the line carries a snapshot)', async () => {
    const r = await rate(t.admin, { name: 'Temp 7', rate: '7' });
    const inv = await make(t.admin, {
      lines: [{ ...LINE, unitPrice: '100.00', qty: '1', taxRateId: r.id }],
    });
    expect(inv.lines[0]).toMatchObject({ taxName: 'Temp 7', taxRate: '7', taxRateId: r.id });
    expect((await api.as(t.admin).delete(`/v2/tax-rates/${r.id}`)).status).toBe(204);
    const after = await get(t.admin, inv.id);
    expect(after.lines[0]).toMatchObject({ taxName: 'Temp 7', taxRate: '7', taxRateId: null });
    expect(after.amounts.tax).toBe('7.00');
    // regression: the same for an ISSUED invoice, whose lines are frozen: the foreign key's SET NULL must still be allowed to unlink the rate
    const r3 = await rate(t.admin, { name: 'Temp issued 8', rate: '8' });
    const issued = await make(t.admin, {
      lines: [{ ...LINE, unitPrice: '100.00', qty: '1', taxRateId: r3.id }],
    });
    expect((await api.as(t.admin).post(`/v2/invoices/${issued.id}/issue`).send({})).status).toBe(
      200,
    );
    expect((await api.as(t.admin).delete(`/v2/tax-rates/${r3.id}`)).status).toBe(204);
    const issuedAfter = await get(t.admin, issued.id);
    expect(issuedAfter.lines[0]).toMatchObject({
      taxName: 'Temp issued 8',
      taxRate: '8',
      taxRateId: null,
    });
    expect(issuedAfter.amounts.tax).toBe('8.00');
    // the freeze still holds for every other change of a frozen line
    await expect(
      h.owner.query(
        `UPDATE invoice_items SET description = 'x' WHERE invoice_id = (SELECT id FROM invoices WHERE uuid = $1)`,
        [issued.id],
      ),
    ).rejects.toThrow(/frozen/i);
    // editing a rate later does not reprice an invoice either
    const r2 = await rate(t.admin, { name: 'Edit me', rate: '10' });
    const i2 = await make(t.admin, {
      lines: [{ ...LINE, unitPrice: '100.00', qty: '1', taxRateId: r2.id }],
    });
    await api
      .as(t.admin)
      .patch(`/v2/tax-rates/${r2.id}`)
      .send({ rowVersion: r2.rowVersion, rate: '25' });
    expect((await get(t.admin, i2.id)).amounts.tax).toBe('10.00');
  });

  it('audit and outbox: every change writes one audit row and one event in the same transaction', async () => {
    const before = await api.auditCount(t.orgId, 'tax-rates', 'insert');
    const r = await rate(t.admin, { name: 'Audited', rate: '2' });
    expect(await api.auditCount(t.orgId, 'tax-rates', 'insert')).toBe(before + 1);
    expect((await api.events(t.orgId, 'tax_rate.created')).some((e) => e.uuid === r.id)).toBe(true);
    await api.as(t.admin).delete(`/v2/tax-rates/${r.id}`);
    expect(await api.auditCount(t.orgId, 'tax-rates', 'delete')).toBeGreaterThanOrEqual(1);
    expect((await api.events(t.orgId, 'tax_rate.deleted')).some((e) => e.uuid === r.id)).toBe(true);
  });
});

describe('creating and pricing a draft (TW-INV-005/006)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('icr');
  });

  it("TW-INV-006: a draft is priced on the server: no number, no public link, totals in the currency's own decimals", async () => {
    const d = await make(t.admin, {
      currency: 'USD',
      discount: { kind: 'amount', value: '5.00' },
      shipping: '2.50',
      lines: [{ description: 'Widget', qty: '3', unitPrice: '19.99', taxRateId: undefined }],
    });
    expect(d.id).toMatch(uuidRe);
    expect(d).toMatchObject({
      status: 'draft',
      storedStatus: 'draft',
      paymentStatus: 'unpaid',
      number: null,
      publicLink: null,
      seller: null,
      source: 'manual',
    });
    expect(d.amounts).toMatchObject({
      subtotal: '59.97',
      discount: '5.00',
      shipping: '2.50',
      tax: '0.00',
      total: '57.47',
      balance: '0.00',
    });
    expect(d.amountsMinor.total).toBe('5747');
    // with a 10% tax the tax is on the DISCOUNTED amount (Reference charged it on the undiscounted subtotal, D-06)
    const r = await rate(t.admin, { name: 'T10', rate: '10' });
    const taxed = await make(t.admin, {
      discount: { kind: 'amount', value: '5.00' },
      shipping: '2.50',
      lines: [{ description: 'Widget', qty: '3', unitPrice: '19.99', taxRateId: r.id }],
    });
    expect(taxed.amounts).toMatchObject({ subtotal: '59.97', tax: '5.50', total: '62.97' });
  });

  it('TW-INV-006 #2 / D-04: per-currency decimals: JPY has none, KWD has three', async () => {
    const jpy = await make(t.admin, {
      currency: 'jpy',
      lines: [{ description: 'x', qty: '1', unitPrice: '1500' }],
    });
    expect(jpy).toMatchObject({ currency: 'JPY' });
    expect(jpy.amounts.total).toBe('1500');
    const kwd = await make(t.admin, {
      currency: 'KWD',
      lines: [{ description: 'x', qty: '1', unitPrice: '12.500' }],
    });
    expect(kwd.amounts.total).toBe('12.500');
    expect(kwd.amountsMinor.total).toBe('12500');
    const bad = await api
      .as(t.admin)
      .post('/v2/invoices')
      .send({
        buyerName: 'x',
        currency: 'JPY',
        lines: [{ description: 'x', qty: '1', unitPrice: '10.5' }],
      });
    expect(bad.status).toBe(422);
    expect(code(bad)).toBe('INV_AMOUNT_INVALID');
    expect(bad.body.errors[0].path).toBe('lines.0.unitPrice');
  });

  it('tax: the default rate applies to a line that names none, `null` means no tax, an inclusive rate is already inside the price', async () => {
    const def = await rate(t.admin, {
      name: 'Default 18',
      type: 'gst',
      rate: '18',
      isDefault: true,
    });
    const incl = await rate(t.admin, { name: 'Incl 18', rate: '18', inclusive: true });
    const d = await make(t.admin, {
      lines: [
        { description: 'defaulted', qty: '1', unitPrice: '100.00' },
        { description: 'exempt', qty: '1', unitPrice: '100.00', taxRateId: null },
        { description: 'inclusive', qty: '1', unitPrice: '118.00', taxRateId: incl.id },
      ],
    });
    expect(d.lines.map((l) => l.taxRateId)).toEqual([def.id, null, incl.id]);
    expect(d.lines.map((l) => l.amounts.tax)).toEqual(['18.00', '0.00', '18.00']);
    expect(d.lines[2]!.taxInclusive).toBe(true);
    // 100 + 18 (added) + 100 + 118 (tax inside) = 336
    expect(d.amounts).toMatchObject({
      subtotal: '318.00',
      tax: '36.00',
      taxAdded: '18.00',
      total: '336.00',
    });
    expect(d.taxSummary).toHaveLength(2);
  });

  it('India: a compound rate carries CGST + SGST components and the HSN/SAC code of the line (defaulted from the rate)', async () => {
    const gst = await rate(t.admin, {
      name: 'GST 18 IN',
      type: 'gst',
      rate: '18',
      country: 'IN',
      defaultHsnSac: '9983',
      components: [
        { type: 'cgst', rate: '9' },
        { type: 'sgst', rate: '9' },
      ],
    });
    const d = await make(t.admin, {
      currency: 'INR',
      placeOfSupply: 'IN-MH',
      buyerTaxId: '27AAAAA0000A1Z5',
      buyerCountry: 'IN',
      lines: [
        { description: 'Service', qty: '1', unitPrice: '1000.01', taxRateId: gst.id },
        { description: 'Goods', qty: '1', unitPrice: '10.00', taxRateId: gst.id, hsnSac: '8517' },
      ],
    });
    expect(d.lines[0]).toMatchObject({ hsnSac: '9983', taxName: 'GST 18 IN' });
    expect(d.lines[1]!.hsnSac).toBe('8517');
    const parts = d.lines[0]!.taxComponents!;
    expect(parts.map((c) => c.type)).toEqual(['CGST', 'SGST']);
    expect(Number(parts[0]!.amount) + Number(parts[1]!.amount)).toBeCloseTo(
      Number(d.lines[0]!.amounts.tax),
      2,
    );
    // the summary is one row per tax (CGST, SGST), each adding up both lines; the rows add up to the lines' tax
    expect(d.taxSummary.map((g) => g.name)).toEqual(['CGST 9%', 'SGST 9%']);
    expect(d.taxSummary.reduce((a, g) => a + Number(g.tax), 0).toFixed(2)).toBe(
      (Number(d.lines[0]!.amounts.tax) + Number(d.lines[1]!.amounts.tax)).toFixed(2),
    );
  });

  it('reverse charge: no tax is charged on the document', async () => {
    await rate(t.admin, { name: 'EU VAT 21', type: 'vat', rate: '21', isDefault: true });
    const rc = await make(t.admin, {
      reverseCharge: true,
      lines: [{ description: 'x', qty: '1', unitPrice: '100.00' }],
    });
    expect(rc.amounts).toMatchObject({ tax: '0.00', total: '100.00' });
    expect(rc.taxSummary).toEqual([]);
  });

  it('validation: a buyer is required, an owner must be an active member, a contact/company/deal must exist, 100 lines at most', async () => {
    const noBuyer = await api
      .as(t.admin)
      .post('/v2/invoices')
      .send({ lines: [LINE] });
    expect(noBuyer.status).toBe(422);
    expect(noBuyer.body.errors[0].path).toBe('buyerName');
    const ghost = '00000000-0000-4000-8000-000000000000';
    for (const [k, status] of [
      ['contactId', 404],
      ['companyId', 404],
      ['dealId', 404],
    ] as const)
      expect(
        (
          await api
            .as(t.admin)
            .post('/v2/invoices')
            .send({ buyerName: 'x', lines: [LINE], [k]: ghost })
        ).status,
        k,
      ).toBe(status);
    const owner = await api
      .as(t.admin)
      .post('/v2/invoices')
      .send({ buyerName: 'x', lines: [LINE], ownerId: ghost });
    expect(owner.status).toBe(422);
    expect(code(owner)).toBe('INV_OWNER_INVALID');
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/invoices')
          .send({ buyerName: 'x', lines: Array.from({ length: 101 }, () => LINE) })
      ).status,
    ).toBe(422);
    expect(
      (await api.as(t.admin).post('/v2/invoices').send({ buyerName: 'x', lines: [] })).status,
    ).toBe(422);
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/invoices')
          .send({ buyerName: 'x', lines: [{ ...LINE, qty: '0' }] })
      ).status,
    ).toBe(422);
  });

  it('parity run: a date that is not a day, a NUL character and a code that is not ISO 4217 are 422, never a database failure (500)', async () => {
    const bad: Array<Record<string, unknown>> = [
      { issueDate: '2026-02-31' },
      { dueDate: '2026-13-01' },
      { buyerName: 'a\u0000b' },
      { notes: 'a\u0000b' },
      { reference: 'a\u0000b' },
      { currency: 'ZZZ' },
    ];
    for (const extra of bad) {
      const res = await api
        .as(t.admin)
        .post('/v2/invoices')
        .send({ buyerName: 'x', lines: [LINE], ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(422);
    }
    for (const q of ['issuedFrom=2026-02-31', 'dueTo=2026-04-31', 'q=a%00b']) {
      const res = await api.as(t.admin).get(`/v2/invoices?${q}`);
      expect(res.status, q).toBe(422);
    }
    expect((await api.as(t.admin).get('/v2/payments?from=2026-02-31')).status).toBe(422);
  });

  it('a contact brings its name, email, phone and company; a deal brings its contact and company (Reference kept the ids in a JSON blob nothing read)', async () => {
    const [cid] = await api.seedContacts(t, [
      { name: 'Linked Contact', email: 'linked@buyer.test', phone: '+14155550123' },
    ]);
    const inv = await make(t.admin, { buyerName: undefined, contactId: cid });
    expect(inv.buyerName).toBe('Linked Contact');
    expect(inv.contact).toEqual({ id: cid, name: 'Linked Contact' });
    const full = await get(t.admin, inv.id);
    expect(full.contact?.id).toBe(cid);
  });

  it('the new invoice is audited and announced in the same transaction (invoice.created), with a timeline entry', async () => {
    const before = await api.auditCount(t.orgId, 'invoices', 'insert');
    const d = await make(t.admin);
    expect(await api.auditCount(t.orgId, 'invoices', 'insert')).toBe(before + 1);
    const ev = (await api.events(t.orgId, 'invoice.created')).find((e) => e.uuid === d.id);
    expect(ev).toMatchObject({ status: 'draft', currency: 'USD', source: 'manual' });
    const timeline = (await api.as(t.admin).get(`/v2/invoices/${d.id}/events`)).body.data as Array<{
      type: string;
    }>;
    expect(timeline.map((e) => e.type)).toContain('created');
  });

  it('Idempotency-Key: a retried POST replays the first response and creates one invoice', async () => {
    const key = `idem-${Date.now()}`;
    const send = () =>
      api
        .as(t.admin)
        .post('/v2/invoices')
        .set('Idempotency-Key', key)
        .send({ buyerName: 'Once', lines: [LINE] });
    const a = await send();
    const b = await send();
    expect(a.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(
      await sqlN(
        `SELECT count(*)::int AS n FROM invoices WHERE org_id = $1 AND buyer_name = 'Once'`,
        [t.orgId],
      ),
    ).toBe(1);
  });
});

describe('drafts, issuing and the frozen invoice (TW-INV-007/008/025/030/031)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('iis');
  });

  it('a draft is edited whole: lines, discount, currency; a stale rowVersion is 409', async () => {
    const d = await make(t.admin);
    const e = await api
      .as(t.admin)
      .patch(`/v2/invoices/${d.id}`)
      .send({
        rowVersion: d.rowVersion,
        lines: [{ description: 'New', qty: '4', unitPrice: '10.00' }],
        discount: { kind: 'percent', value: '10' },
        notes: 'Thanks',
        reference: 'PO-1',
      });
    expect(e.status, JSON.stringify(e.body)).toBe(200);
    expect(e.body.amounts).toMatchObject({ subtotal: '40.00', discount: '4.00', total: '36.00' });
    expect(e.body.lines).toHaveLength(1);
    expect(e.body.rowVersion).toBeGreaterThan(d.rowVersion);
    const stale = await api
      .as(t.admin)
      .patch(`/v2/invoices/${d.id}`)
      .send({ rowVersion: d.rowVersion, notes: 'again' });
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
    // changing the currency needs the lines again
    const cur = await api
      .as(t.admin)
      .patch(`/v2/invoices/${d.id}`)
      .send({ rowVersion: e.body.rowVersion, currency: 'EUR' });
    expect(cur.status).toBe(422);
  });

  it('TW-INV-007 / TW-INV-008: issuing allocates the next number from the series, sets the dates, mints the public link and freezes the seller block', async () => {
    await api
      .as(t.admin)
      .patch('/v2/invoice-settings')
      .send({
        sellerName: 'Seller Co',
        sellerTaxId: 'TAX-1',
        dueDays: 14,
        bankDetails: { IBAN: 'XX00 1' },
      });
    const a = await issued(t.admin);
    const b = await issued(t.admin);
    const year = new Date().getUTCFullYear();
    expect(a.number).toBe(`INV-${year}-000001`);
    expect(b.number).toBe(`INV-${year}-000002`);
    expect(a).toMatchObject({
      status: 'issued',
      storedStatus: 'issued',
      paymentStatus: 'unpaid',
      issueDate: ymd(0),
      dueDate: ymd(14),
    });
    expect(a.publicLink!.path).toBe(`/i/${a.publicLink!.token}`);
    expect(a.publicLink!.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.seller).toMatchObject({
      name: 'Seller Co',
      taxId: 'TAX-1',
      bankDetails: { IBAN: 'XX00 1' },
    });
    // the seller block is frozen: a later change of the profile does not touch an issued invoice
    await api.as(t.admin).patch('/v2/invoice-settings').send({ sellerName: 'Renamed Co' });
    expect((await get(t.admin, a.id)).seller?.name).toBe('Seller Co');
    expect(
      (await api.events(t.orgId, 'invoice.issued')).filter((e) => e.uuid === a.id),
    ).toHaveLength(1);
    // the public link never appears in an outbox event
    expect(JSON.stringify(await api.events(t.orgId, 'invoice.issued'))).not.toContain(
      a.publicLink!.token,
    );
  });

  it('TW-INV-008 #1 / D-13: concurrent issues in one workspace get consecutive, unique numbers (no gap, no duplicate)', async () => {
    const drafts = await Promise.all(Array.from({ length: 12 }, () => make(t.admin)));
    const results = await Promise.all(
      drafts.map((d) => api.as(t.admin).post(`/v2/invoices/${d.id}/issue`).send({})),
    );
    results.forEach((r) => expect(r.status, JSON.stringify(r.body)).toBe(200));
    const seqs = results
      .map((r) => Number((r.body.number as string).split('-').pop()))
      .sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(12);
    expect(seqs[11]! - seqs[0]!).toBe(11);
  });

  it('D-08: a proforma has its own series (PRO-), separate from tax invoices', async () => {
    const p = await issued(t.admin, { docType: 'proforma' });
    expect(p.number).toMatch(/^PRO-\d{4}-000001$/);
    expect(p.docType).toBe('proforma');
  });

  it('TW-INV-031 / D-02: after issue the lines, amounts, currency, buyer name and number are frozen (409 INV_NOT_DRAFT); the due date, notes, terms, reference and contact details can still change', async () => {
    const i = await issued(t.admin);
    const frozen = await api
      .as(t.admin)
      .patch(`/v2/invoices/${i.id}`)
      .send({ rowVersion: i.rowVersion, lines: [LINE], buyerName: 'Other', currency: 'EUR' });
    expect(frozen.status).toBe(409);
    expect(code(frozen)).toBe('INV_NOT_DRAFT');
    expect((frozen.body.errors as Array<{ path: string }>).map((e) => e.path).sort()).toEqual([
      'buyerName',
      'currency',
      'lines',
    ]);
    const ok = await api
      .as(t.admin)
      .patch(`/v2/invoices/${i.id}`)
      .send({
        rowVersion: i.rowVersion,
        dueDate: ymd(60),
        notes: 'Late fee applies',
        terms: 'Net 60',
        reference: 'PO-9',
        buyerEmail: 'new@buyer.test',
      });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({
      dueDate: ymd(60),
      notes: 'Late fee applies',
      reference: 'PO-9',
    });
    // the database says the same, whoever asks
    await expect(
      h.owner.query(`UPDATE invoices SET total_minor = 1 WHERE uuid = $1`, [i.id]),
    ).rejects.toThrow(/frozen/);
    const again = await api.as(t.admin).post(`/v2/invoices/${i.id}/issue`).send({});
    expect(again.status).toBe(409);
    expect(code(again)).toBe('INV_NOT_DRAFT');
  });

  it('TW-INV-030: an explicit due date or terms in days on the invoice win over the profile default; a due date before the issue date is refused', async () => {
    const withDate = await issued(t.admin, { issueDate: ymd(0), dueDate: ymd(3) });
    expect(withDate.dueDate).toBe(ymd(3));
    const terms = await issued(t.admin, { paymentTermsDays: 45 });
    expect(terms.dueDate).toBe(ymd(45));
    const bad = await api
      .as(t.admin)
      .post('/v2/invoices')
      .send({ buyerName: 'x', lines: [LINE], issueDate: ymd(0), dueDate: ymd(-3) });
    expect(bad.status).toBe(422);
  });

  it('delete: only a draft (audited, invoice.deleted); an issued invoice is voided instead (409 INV_NOT_DELETABLE)', async () => {
    const d = await make(t.admin);
    expect((await api.as(t.admin).delete(`/v2/invoices/${d.id}`)).status).toBe(204);
    expect((await api.as(t.admin).get(`/v2/invoices/${d.id}`)).status).toBe(404);
    expect(await api.auditCount(t.orgId, 'invoices', 'delete')).toBeGreaterThanOrEqual(1);
    expect((await api.events(t.orgId, 'invoice.deleted')).some((e) => e.uuid === d.id)).toBe(true);
    const i = await issued(t.admin);
    const res = await api.as(t.admin).delete(`/v2/invoices/${i.id}`);
    expect(res.status).toBe(409);
    expect(code(res)).toBe('INV_NOT_DELETABLE');
  });

  it('void: keeps its number, needs a reason, is announced, cannot be edited, issued again, paid or voided twice; the buyer sees it as void', async () => {
    const i = await issued(t.admin);
    const v = await api
      .as(t.admin)
      .post(`/v2/invoices/${i.id}/void`)
      .send({ reason: 'Raised in error' });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(v.body).toMatchObject({
      status: 'void',
      number: i.number,
      voidReason: 'Raised in error',
    });
    expect(
      (await api.events(t.orgId, 'invoice.voided')).find((e) => e.uuid === i.id),
    ).toMatchObject({ reason: 'Raised in error' });
    expect(
      (await api.as(t.admin).post(`/v2/invoices/${i.id}/void`).send({ reason: 'x' })).status,
    ).toBe(409);
    const edit = await api
      .as(t.admin)
      .patch(`/v2/invoices/${i.id}`)
      .send({ rowVersion: v.body.rowVersion, notes: 'x' });
    expect(edit.status).toBe(409);
    expect(code(edit)).toBe('INV_ALREADY_VOID');
    const pay_ = await api.as(t.admin).post(`/v2/invoices/${i.id}/payments`).send({ amount: '1' });
    expect(pay_.status).toBe(409);
    expect(code(pay_)).toBe('INV_NOT_ISSUED');
    expect(
      (
        await api
          .as(t.admin)
          .post(`/v2/invoices/${(await make(t.admin)).id}/void`)
          .send({ reason: 'x' })
      ).status,
    ).toBe(409);
    const view = await pub(i.publicLink!.token).send();
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({
      status: 'void',
      payable: false,
      voidReason: 'Raised in error',
    });
  });

  it('duplicate: a new draft with the same buyer and lines, no number or dates', async () => {
    const i = await issued(t.admin, {
      reference: 'PO-DUP',
      lines: [{ description: 'Dup me', qty: '2', unitPrice: '12.34' }],
    });
    const res = await api.as(t.admin).post(`/v2/invoices/${i.id}/duplicate`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      status: 'draft',
      number: null,
      buyerName: i.buyerName,
      reference: 'PO-DUP',
      issueDate: null,
      dueDate: null,
    });
    expect(res.body.id).not.toBe(i.id);
    expect(res.body.amounts.total).toBe(i.amounts.total);
    expect(res.body.lines[0].description).toBe('Dup me');
  });

  it('send: marks it sent and raises invoice.sent (ids only); email and WhatsApp need the buyer contact detail; a draft cannot be sent', async () => {
    const i = await issued(t.admin, { buyerEmail: 'buyer@x.test' });
    const noPhone = await api
      .as(t.admin)
      .post(`/v2/invoices/${i.id}/send`)
      .send({ channel: 'whatsapp' });
    expect(noPhone.status).toBe(422);
    expect(code(noPhone)).toBe('INV_NO_RECIPIENT');
    const ok = await api.as(t.admin).post(`/v2/invoices/${i.id}/send`).send({ channel: 'email' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.sentAt).not.toBeNull();
    const ev = (await api.events(t.orgId, 'invoice.sent')).find((e) => e.uuid === i.id);
    expect(ev).toMatchObject({ channel: 'email', number: i.number });
    expect(JSON.stringify(ev)).not.toContain(i.publicLink!.token);
    expect(
      (
        await api
          .as(t.admin)
          .post(`/v2/invoices/${(await make(t.admin)).id}/send`)
          .send({})
      ).status,
    ).toBe(409);
  });

  it('the public link: copyable by staff, regenerated (the old one stops working at once), revoked, with an optional expiry', async () => {
    const i = await issued(t.admin);
    const old = i.publicLink!.token;
    expect((await pub(old).send()).status).toBe(200);
    const regen = await api
      .as(t.admin)
      .post(`/v2/invoices/${i.id}/public-link/regenerate`)
      .send({ expiresInDays: 30 });
    expect(regen.status).toBe(200);
    const fresh = regen.body.publicLink as { token: string; expiresAt: string };
    expect(fresh.token).not.toBe(old);
    expect(fresh.expiresAt).not.toBeNull();
    expect((await pub(old).send()).status).toBe(404);
    expect((await pub(fresh.token).send()).status).toBe(200);
    const revoked = await api.as(t.admin).post(`/v2/invoices/${i.id}/public-link/revoke`).send({});
    expect(revoked.body.publicLink).toMatchObject({ active: false });
    const gone = await pub(fresh.token).send();
    expect(gone.status).toBe(410);
    expect(code(gone)).toBe('INV_LINK_UNAVAILABLE');
    // an expired link is gone too
    const regen2 = await api
      .as(t.admin)
      .post(`/v2/invoices/${i.id}/public-link/regenerate`)
      .send({});
    await h.owner.query(
      `UPDATE invoices SET token_expires_at = now() - interval '1 minute' WHERE uuid = $1`,
      [i.id],
    );
    expect((await pub(regen2.body.publicLink.token).send()).status).toBe(410);
    expect(
      (
        await api
          .as(t.admin)
          .post(`/v2/invoices/${(await make(t.admin)).id}/public-link/regenerate`)
          .send({})
      ).status,
    ).toBe(409);
  });
});

describe('listing, filters, counts and paging (TW-INV-001)', () => {
  let t: Tenant;
  let ids: Record<string, string> = {};
  beforeAll(async () => {
    t = await api.signup('ils');
    const [c1, c2] = await api.seedContacts(t, [{ name: 'Zed Co' }, { name: 'Yan Co' }]);
    const draft = await make(t.admin, { buyerName: 'Draft Buyer' });
    const open = await issued(t.admin, {
      buyerName: 'Open Buyer',
      contactId: c1,
      reference: 'REF-OPEN',
      dueDate: ymd(30),
      issueDate: ymd(-1),
    });
    const partial = await issued(t.admin, {
      buyerName: 'Partial Buyer',
      contactId: c1,
      dueDate: ymd(30),
      issueDate: ymd(-2),
    });
    await pay(t.admin, partial.id, { amount: '10' });
    const paid = await issued(t.admin, {
      buyerName: 'Paid Buyer',
      contactId: c2,
      dueDate: ymd(30),
      issueDate: ymd(-3),
    });
    await pay(t.admin, paid.id, { amount: '100' });
    const overdue = await issued(t.admin, {
      buyerName: 'Late Buyer',
      contactId: c2,
      issueDate: ymd(-20),
      dueDate: ymd(-5),
      currency: 'EUR',
    });
    const voided = await issued(t.admin, { buyerName: 'Void Buyer' });
    await api.as(t.admin).post(`/v2/invoices/${voided.id}/void`).send({ reason: 'x' });
    ids = {
      draft: draft.id,
      open: open.id,
      partial: partial.id,
      paid: paid.id,
      overdue: overdue.id,
      void: voided.id,
      c1,
      c2,
    };
  });

  const list = async (qs: string) => {
    const res = await api.as(t.admin).get(`/v2/invoices${qs}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as {
      data: Inv[];
      page: { nextCursor: string | null; hasMore: boolean; limit: number };
    };
  };
  const idsOf = (r: { data: Inv[] }) => r.data.map((x) => x.id).sort();

  it('derives the six statuses: draft, issued, partially_paid, paid, overdue (from the due date), void', async () => {
    const all = (await list('?limit=100')).data;
    const by = Object.fromEntries(all.map((x) => [x.id, x.status]));
    expect(by[ids.draft!]).toBe('draft');
    expect(by[ids.open!]).toBe('issued');
    expect(by[ids.partial!]).toBe('partially_paid');
    expect(by[ids.paid!]).toBe('paid');
    expect(by[ids.overdue!]).toBe('overdue');
    expect(by[ids.void!]).toBe('void');
    const late = all.find((x) => x.id === ids.overdue)!;
    expect(late).toMatchObject({ overdue: true, daysOverdue: 5, storedStatus: 'issued' });
  });

  it('TW-INV-001 filters: status (one or several), q (number, buyer, reference), contact, doc type, currency, date ranges, mine', async () => {
    expect(idsOf(await list('?status=issued'))).toEqual([ids.open!]);
    expect(idsOf(await list('?status=issued,partially_paid'))).toEqual(
      [ids.open!, ids.partial!].sort(),
    );
    expect(idsOf(await list('?status=overdue'))).toEqual([ids.overdue!]);
    expect(idsOf(await list('?q=REF-OPEN'))).toEqual([ids.open!]);
    expect(idsOf(await list('?q=late%20buy'))).toEqual([ids.overdue!]);
    expect(idsOf(await list(`?contactId=${ids.c2}`))).toEqual([ids.paid!, ids.overdue!].sort());
    expect(idsOf(await list('?currency=EUR'))).toEqual([ids.overdue!]);
    expect(idsOf(await list('?docType=proforma'))).toEqual([]);
    expect(idsOf(await list(`?dueFrom=${ymd(-6)}&dueTo=${ymd(-4)}`))).toEqual([ids.overdue!]);
    expect(
      idsOf(await list(`?issuedFrom=${ymd(-2)}&issuedTo=${ymd(-1)}&status=issued,partially_paid`)),
    ).toEqual([ids.open!, ids.partial!].sort());
    expect((await list('?mine=true&limit=100')).data.length).toBeGreaterThanOrEqual(6);
    const number = (await get(t.admin, ids.open!)).number!;
    expect(idsOf(await list(`?q=${number}`))).toEqual([ids.open!]);
    expect((await api.as(t.admin).get('/v2/invoices?status=nonsense')).status).toBe(422);
  });

  it('TW-INV-001: cursor pagination in both directions, no overlap, no gap, and a stable order under ties', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r: { data: Inv[]; page: { nextCursor: string | null; hasMore: boolean } } = await list(
        `?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      );
      seen.push(...r.data.map((x) => x.id));
      cursor = r.page.nextCursor;
      pages++;
      expect(r.page.hasMore).toBe(cursor !== null);
    } while (cursor && pages < 20);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(6);
    const asc = (await list('?limit=100&order=asc')).data.map((x) => x.id);
    expect(asc).toEqual([...seen].reverse());
    expect((await api.as(t.admin).get('/v2/invoices?cursor=garbage')).status).toBe(400);
  });

  it('rows created in the same millisecond page correctly (the cursor carries microseconds)', async () => {
    const tt = await api.signup('ilm');
    const base = new Date().toISOString();
    for (let i = 0; i < 6; i++) {
      await h.owner.query(
        `INSERT INTO invoices (org_id, source, currency, buyer_name, created_at) VALUES ($1,'manual','USD',$2, $3::timestamptz + ($4 || ' microseconds')::interval)`,
        [tt.orgId, `tie ${i}`, base, String(i)],
      );
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: { body: { data: Inv[]; page: { nextCursor: string | null } } } = await api
        .as(tt.admin)
        .get(`/v2/invoices?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...res.body.data.map((x) => x.buyerName!));
      cursor = res.body.page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(['tie 5', 'tie 4', 'tie 3', 'tie 2', 'tie 1', 'tie 0']);
  });

  it('TW-INV-001: counts per status for the tabs partition the invoices, and carry the open balance per currency', async () => {
    const c = (await api.as(t.admin).get('/v2/invoices/counts')).body;
    expect(c).toMatchObject({
      all: 6,
      draft: 1,
      issued: 1,
      partiallyPaid: 1,
      paid: 1,
      overdue: 1,
      void: 1,
    });
    expect(c.draft + c.issued + c.partiallyPaid + c.paid + c.overdue + c.void).toBe(c.all);
    const usd = c.outstanding.find((x: { currency: string }) => x.currency === 'USD');
    // open 100.00 + partial 100.00 - 10.00 paid
    expect(usd.amount).toBe('190.00');
    expect(c.overdueAmount).toEqual([{ currency: 'EUR', amount: '100.00' }]);
    const filtered = (await api.as(t.admin).get(`/v2/invoices/counts?contactId=${ids.c1}`)).body;
    expect(filtered.all).toBe(2);
  });

  it('the list rows carry money as strings in major and minor units, and refuse nothing about drafts', async () => {
    const row = (await list('?q=Partial')).data[0]!;
    expect(row.amounts).toMatchObject({ total: '100.00', paid: '10.00', balance: '90.00' });
    expect(row.amountsMinor).toMatchObject({ total: '10000', paid: '1000', balance: '9000' });
    const d = (await list('?status=draft')).data[0]!;
    expect(d.amounts.balance).toBe('0.00'); // a draft owes nothing yet
  });
});

describe('linked records: GET /contacts/:id/invoices and /deals/:id/invoices (TW-INV-028, D-25)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ilk');
  });

  it("a contact's invoices come with the money rolled up per currency; the contact's own record scope applies", async () => {
    const [cid, other] = await api.seedContacts(t, [
      { name: 'Rolled Up' },
      { name: 'Someone Else' },
    ]);
    const a = await issued(t.admin, { contactId: cid });
    const b = await issued(t.admin, { contactId: cid, currency: 'EUR' });
    await issued(t.admin, { contactId: other });
    await pay(t.admin, a.id, { amount: '40' });
    await make(t.admin, { contactId: cid }); // a draft is listed but is not money yet
    const res = await api.as(t.admin).get(`/v2/contacts/${cid}/invoices`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.totals.invoiced).toEqual([
      { currency: 'EUR', amount: '100.00' },
      { currency: 'USD', amount: '100.00' },
    ]);
    expect(res.body.totals.paid).toEqual([{ currency: 'USD', amount: '40.00' }]);
    expect(res.body.totals.outstanding).toEqual([
      { currency: 'EUR', amount: '100.00' },
      { currency: 'USD', amount: '60.00' },
    ]);
    expect(
      (await api.as(t.admin).get(`/v2/contacts/${cid}/invoices?status=paid`)).body.data,
    ).toEqual([]);
    expect(
      (await api.as(t.admin).get(`/v2/contacts/00000000-0000-4000-8000-000000000000/invoices`))
        .status,
    ).toBe(404);
    expect(b.id).toBeTruthy();
    // an `own` reader of contacts cannot see the invoices of a contact it may not see
    const reader = await api.member(t, 'ownc', [
      ['record.invoices.read'],
      ['record.contacts.read', 'own'],
    ]);
    expect((await api.as(reader.token).get(`/v2/contacts/${cid}/invoices`)).status).toBe(404);
  });

  it('a deal brings its contact and company into the invoice, and the deal lists the invoice with the rollup', async () => {
    const [cid] = await api.seedContacts(t, [{ name: 'Deal Contact' }]);
    const { pipeline, stage } = await api.defaultPipeline(t.admin);
    const deal = await api.deal(t.admin, {
      title: 'Big deal',
      pipelineId: pipeline.id,
      stageId: Object.values(stage)[0]!.id,
      contactId: cid,
      value: '500',
      currency: 'USD',
    });
    const inv = await issued(t.admin, { dealId: deal.id, buyerName: 'Deal buyer' });
    expect(inv.deal).toEqual({ id: deal.id, title: 'Big deal' });
    expect(inv.contact?.id).toBe(cid);
    const res = await api.as(t.admin).get(`/v2/deals/${deal.id}/invoices`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.map((x: Inv) => x.id)).toEqual([inv.id]);
    expect(res.body.totals.outstanding).toEqual([{ currency: 'USD', amount: '100.00' }]);
    // deleting the deal keeps the invoice and clears the link
    await h.owner.query(`DELETE FROM deals WHERE uuid = $1`, [deal.id]);
    expect((await get(t.admin, inv.id)).deal).toBeNull();
  });
});

describe('the payment ledger (TW-PAY-001..005, D-11)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ipy');
  });

  it('TW-INV-025 acceptance: payments of 40 and 60 on an invoice of 100 make it partially_paid then paid, with the balance and a receipt number each time', async () => {
    const i = await issued(t.admin);
    const first = await pay(t.admin, i.id, {
      amount: '40.00',
      method: 'bank',
      reference: 'TXN-1',
      note: 'first half',
      paidAt: ymd(-1),
    });
    expect(first.invoice).toMatchObject({
      status: 'partially_paid',
      paymentStatus: 'partially_paid',
      paid: '40.00',
      balance: '60.00',
      credit: '0.00',
    });
    expect(first.payment).toMatchObject({
      kind: 'payment',
      amount: '40.00',
      method: 'bank',
      reference: 'TXN-1',
      source: 'manual',
    });
    expect(first.payment.receiptNumber).toMatch(/^RCT-\d{4}-000001$/);
    const second = await pay(t.admin, i.id, { amount: '60.00' });
    expect(second.invoice).toMatchObject({
      status: 'paid',
      paymentStatus: 'paid',
      balance: '0.00',
    });
    expect(second.payment.receiptNumber).toMatch(/^RCT-\d{4}-000002$/);
    const after = await get(t.admin, i.id);
    expect(after).toMatchObject({ status: 'paid', paymentStatus: 'paid' });
    expect(after.amounts).toMatchObject({ paid: '100.00', balance: '0.00' });
    const events = (await api.events(t.orgId, 'invoice.partially_paid')).filter(
      (e) => e.uuid === i.id,
    );
    expect(events).toHaveLength(1);
    expect((await api.events(t.orgId, 'invoice.paid')).filter((e) => e.uuid === i.id)).toHaveLength(
      1,
    );
    expect(
      (await api.events(t.orgId, 'payment.recorded')).filter((e) => e.invoiceId === i.id),
    ).toHaveLength(2);
    const ledger = (await api.as(t.admin).get(`/v2/invoices/${i.id}/payments`)).body.data as Array<{
      amount: string;
    }>;
    expect(ledger.map((p) => p.amount)).toEqual(['40.00', '60.00']);
    const tl = (
      (await api.as(t.admin).get(`/v2/invoices/${i.id}/events`)).body.data as Array<{
        type: string;
      }>
    ).map((e) => e.type);
    expect(tl).toEqual(
      expect.arrayContaining(['payment_recorded', 'partially_paid', 'paid', 'issued', 'created']),
    );
  });

  it('D-11: more than the balance is 422 PAY_OVERPAYMENT (Reference accepted it silently); allowOverpayment records the excess as a credit', async () => {
    const i = await issued(t.admin);
    const over = await api
      .as(t.admin)
      .post(`/v2/invoices/${i.id}/payments`)
      .send({ amount: '100.01' });
    expect(over.status).toBe(422);
    expect(code(over)).toBe('PAY_OVERPAYMENT');
    expect(over.body.errors[0].message).toContain('100.00');
    expect(
      await sqlN(
        `SELECT count(*)::int AS n FROM payments WHERE org_id = $1 AND invoice_id = (SELECT id FROM invoices WHERE uuid = $2)`,
        [t.orgId, i.id],
      ),
    ).toBe(0);
    const ok = await pay(t.admin, i.id, { amount: '125.00', allowOverpayment: true });
    expect(ok.invoice).toMatchObject({
      paymentStatus: 'paid',
      paid: '125.00',
      balance: '0.00',
      credit: '25.00',
    });
    // an invoice with nothing left to pay refuses any further payment unless it is explicitly an excess
    const more = await api.as(t.admin).post(`/v2/invoices/${i.id}/payments`).send({ amount: '1' });
    expect(more.status).toBe(422);
  });

  it('D-11: another currency is 422 PAY_CURRENCY_MISMATCH (Reference subtracted EUR from USD); the invoice currency is the default', async () => {
    const i = await issued(t.admin);
    const res = await api
      .as(t.admin)
      .post(`/v2/invoices/${i.id}/payments`)
      .send({ amount: '10', currency: 'EUR' });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('PAY_CURRENCY_MISMATCH');
    expect((await pay(t.admin, i.id, { amount: '10', currency: 'usd' })).payment.currency).toBe(
      'USD',
    );
  });

  it("validation: the amount must be positive with at most the currency's decimals; a payment is not dated in the future; a draft cannot be paid", async () => {
    const i = await issued(t.admin);
    for (const amount of ['0', '-5', '1.234', 'abc', '']) {
      const r = await api.as(t.admin).post(`/v2/invoices/${i.id}/payments`).send({ amount });
      expect(r.status, amount).toBeGreaterThanOrEqual(400);
      expect(r.status, amount).toBeLessThan(500);
    }
    const future = await api
      .as(t.admin)
      .post(`/v2/invoices/${i.id}/payments`)
      .send({ amount: '1', paidAt: ymd(3) });
    expect(future.status).toBe(422);
    expect(code(future)).toBe('PAY_FUTURE_DATE');
    const d = await make(t.admin);
    const draft = await api.as(t.admin).post(`/v2/invoices/${d.id}/payments`).send({ amount: '1' });
    expect(draft.status).toBe(409);
    expect(code(draft)).toBe('INV_NOT_ISSUED');
    const jpy = await issued(t.admin, {
      currency: 'JPY',
      lines: [{ description: 'x', qty: '1', unitPrice: '1500' }],
    });
    expect(
      (await api.as(t.admin).post(`/v2/invoices/${jpy.id}/payments`).send({ amount: '10.5' }))
        .status,
    ).toBe(422);
    expect((await pay(t.admin, jpy.id, { amount: '500' })).invoice.balance).toBe('1000');
  });

  it('POST /payments names the invoice in the body (the ledger screen\'s "record payment" button) and rejects an unknown or foreign invoice with 404, not a silently unlinked payment', async () => {
    const i = await issued(t.admin);
    const res = await api.as(t.admin).post('/v2/payments').send({ invoiceId: i.id, amount: '5' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.payment.invoice.id).toBe(i.id);
    const other = await api.signup('ipy2');
    const foreign = await issued(other.admin);
    expect(
      (await api.as(t.admin).post('/v2/payments').send({ invoiceId: foreign.id, amount: '5' }))
        .status,
    ).toBe(404);
    expect((await api.as(t.admin).post('/v2/payments').send({ amount: '5' })).status).toBe(422);
  });

  it('TW-PAY-003 #1: a retried request with the same Idempotency-Key records one payment', async () => {
    const i = await issued(t.admin);
    const key = `pay-${Date.now()}`;
    const send = () =>
      api
        .as(t.admin)
        .post(`/v2/invoices/${i.id}/payments`)
        .set('Idempotency-Key', key)
        .send({ amount: '10' });
    const a = await send();
    const b = await send();
    expect(a.status).toBe(201);
    expect(b.body.payment.id).toBe(a.body.payment.id);
    expect((await get(t.admin, i.id)).amounts.paid).toBe('10.00');
  });

  it('TW-PAY-003 #6: two payments recorded at the same moment are both counted and the invoice ends paid (the invoice row lock serialises the ledger)', async () => {
    const i = await issued(t.admin);
    const [a, b] = await Promise.all([
      api.as(t.admin).post(`/v2/invoices/${i.id}/payments`).send({ amount: '50' }),
      api.as(t.admin).post(`/v2/invoices/${i.id}/payments`).send({ amount: '50' }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(await get(t.admin, i.id)).toMatchObject({ status: 'paid' });
    // two that together exceed the balance: exactly one wins
    const j = await issued(t.admin);
    const [c, d] = await Promise.all([
      api.as(t.admin).post(`/v2/invoices/${j.id}/payments`).send({ amount: '70' }),
      api.as(t.admin).post(`/v2/invoices/${j.id}/payments`).send({ amount: '70' }),
    ]);
    expect([c.status, d.status].sort()).toEqual([201, 422]);
  });

  it('D-11 / TW-PAY-015: a refund is a negative ledger entry linked to its payment; it reopens the invoice and cannot exceed what is left', async () => {
    const i = await issued(t.admin);
    const p = await pay(t.admin, i.id, { amount: '100.00', method: 'card' });
    expect(p.invoice.paymentStatus).toBe('paid');
    const r1 = await api
      .as(t.admin)
      .post(`/v2/payments/${p.payment.id}/refund`)
      .send({ amount: '30.00', reason: 'Goodwill' });
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    expect(r1.body.payment).toMatchObject({
      kind: 'refund',
      amount: '-30.00',
      refundOf: { id: p.payment.id },
      note: 'Goodwill',
    });
    expect(r1.body.invoice).toMatchObject({
      paymentStatus: 'partially_paid',
      paid: '70.00',
      balance: '30.00',
    });
    const orig = (await api.as(t.admin).get(`/v2/payments/${p.payment.id}`)).body;
    expect(orig).toMatchObject({ refunded: '30.00', refundable: '70.00' });
    const tooMuch = await api
      .as(t.admin)
      .post(`/v2/payments/${p.payment.id}/refund`)
      .send({ amount: '70.01' });
    expect(tooMuch.status).toBe(422);
    expect(code(tooMuch)).toBe('PAY_REFUND_EXCEEDS');
    const rest = await api.as(t.admin).post(`/v2/payments/${p.payment.id}/refund`).send({});
    expect(rest.body.payment.amount).toBe('-70.00');
    expect(rest.body.invoice).toMatchObject({
      paymentStatus: 'unpaid',
      paid: '0.00',
      balance: '100.00',
    });
    const none = await api.as(t.admin).post(`/v2/payments/${p.payment.id}/refund`).send({});
    expect(code(none)).toBe('PAY_REFUND_EXCEEDS');
    const ofRefund = await api
      .as(t.admin)
      .post(`/v2/payments/${r1.body.payment.id}/refund`)
      .send({});
    expect(ofRefund.status).toBe(409);
    expect(code(ofRefund)).toBe('PAY_NOT_REFUNDABLE');
    expect(await api.auditCount(t.orgId, 'payments', 'insert')).toBeGreaterThanOrEqual(3);
    expect(
      (await api.events(t.orgId, 'payment.refunded')).filter((e) => e.refundOf === p.payment.id),
    ).toHaveLength(2);
    // a fully refunded invoice can be voided (its net payment is zero); a payment that still holds money cannot
    expect(
      (await api.as(t.admin).post(`/v2/invoices/${i.id}/void`).send({ reason: 'cancelled' }))
        .status,
    ).toBe(200);
  });

  it('the ledger is append-only: there is no route that edits or deletes an entry', async () => {
    const i = await issued(t.admin);
    const p = await pay(t.admin, i.id, { amount: '5' });
    expect((await api.as(t.admin).delete(`/v2/payments/${p.payment.id}`)).status).toBe(404);
    expect(
      (await api.as(t.admin).patch(`/v2/payments/${p.payment.id}`).send({ amount: '999' })).status,
    ).toBe(404);
  });

  it('TW-PAY-001: list with filters (invoice, contact, kind, method, currency, dates, text) and cursor paging', async () => {
    const tt = await api.signup('ipl');
    const [c] = await api.seedContacts(tt, [{ name: 'Payer' }]);
    const a = await issued(tt.admin, { contactId: c });
    const b = await issued(tt.admin, { currency: 'EUR' });
    const p1 = await pay(tt.admin, a.id, { amount: '10', method: 'cash', reference: 'CASH-1' });
    await pay(tt.admin, a.id, {
      amount: '20',
      method: 'bank',
      reference: 'BANK-2',
      paidAt: ymd(-5),
    });
    await pay(tt.admin, b.id, { amount: '30', method: 'card' });
    await api.as(tt.admin).post(`/v2/payments/${p1.payment.id}/refund`).send({ amount: '2' });
    const ls = async (qs: string) =>
      (await api.as(tt.admin).get(`/v2/payments${qs}`)).body.data as Array<{
        amount: string;
        method: string;
        kind: string;
      }>;
    expect((await ls('')).length).toBe(4);
    expect((await ls(`?invoiceId=${a.id}`)).length).toBe(3);
    expect((await ls(`?contactId=${c}`)).length).toBe(3);
    expect((await ls('?kind=refund')).map((p) => p.amount)).toEqual(['-2.00']);
    expect((await ls('?method=cash,card')).map((p) => p.method).sort()).toEqual([
      'card',
      'cash',
      'cash',
    ]);
    expect((await ls('?currency=EUR')).map((p) => p.amount)).toEqual(['30.00']);
    expect((await ls(`?from=${ymd(-6)}&to=${ymd(-4)}`)).map((p) => p.amount)).toEqual(['20.00']);
    expect((await ls('?q=bank-2')).map((p) => p.amount)).toEqual(['20.00']);
    const page1 = (await api.as(tt.admin).get('/v2/payments?limit=3')).body;
    expect(page1.data).toHaveLength(3);
    const page2 = (
      await api.as(tt.admin).get(`/v2/payments?limit=3&cursor=${page1.page.nextCursor}`)
    ).body;
    expect(page2.data).toHaveLength(1);
    expect(page2.page.hasMore).toBe(false);
  });

  it('TW-PAY-015: a receipt for each ledger entry, with the seller, the buyer and where the invoice stands', async () => {
    await api
      .as(t.admin)
      .patch('/v2/invoice-settings')
      .send({ sellerName: 'Receipt Seller', sellerTaxId: 'RS-9' });
    const i = await issued(t.admin);
    const p = await pay(t.admin, i.id, { amount: '25', reference: 'R-1' });
    const r = (await api.as(t.admin).get(`/v2/payments/${p.payment.id}/receipt`)).body;
    expect(r).toMatchObject({
      receiptNumber: p.payment.receiptNumber,
      kind: 'payment',
      amount: '25.00',
      currency: 'USD',
      reference: 'R-1',
      buyerName: 'Acme Ltd',
      seller: { name: 'Receipt Seller', taxId: 'RS-9' },
      invoice: { number: i.number, total: '100.00', paid: '25.00', balance: '75.00' },
    });
  });

  it("a payment brings its invoice's contact so the ledger can be read per customer", async () => {
    const [c] = await api.seedContacts(t, [{ name: 'Ledger Contact' }]);
    const i = await issued(t.admin, { contactId: c });
    const p = await pay(t.admin, i.id, { amount: '5' });
    expect(p.payment.contact).toBeDefined();
    expect(
      (
        (await api.as(t.admin).get(`/v2/payments/${p.payment.id}`)).body as {
          contact: { id: string };
        }
      ).contact.id,
    ).toBe(c);
  });
});

describe('reports: summary, aging by due date, outstanding per contact (TW-PAY-004, D-22)', () => {
  let t: Tenant;
  let c1: string;
  let c2: string;
  beforeAll(async () => {
    t = await api.signup('irp');
    [c1, c2] = (await api.seedContacts(t, [{ name: 'Ann Debtor' }, { name: 'Bob Debtor' }])) as [
      string,
      string,
    ];
    const mk = (days: number, contactId: string, over: Record<string, unknown> = {}) =>
      issued(t.admin, {
        contactId,
        issueDate: ymd(days - 30),
        dueDate: ymd(days),
        lines: [{ description: 'x', qty: '1', unitPrice: '100.00' }],
        ...over,
      });
    await mk(10, c1); // not yet due: current
    await mk(-5, c1); // 5 days past due: 1-30
    await mk(-45, c2); // 31-60
    await mk(-75, c2); // 61-90
    const old = await mk(-100, c2); // 90+
    await pay(t.admin, old.id, { amount: '40' }); // 60 left
    await mk(-5, c1, { currency: 'EUR' }); // a second currency never mixes in
    await mk(-200, c1, { buyerName: 'Fully paid' }).then((i) =>
      pay(t.admin, i.id, { amount: '100' }),
    );
  });

  it('TW-PAY-004 #1 / D-22: buckets by days PAST DUE, per currency, with the right edges (Reference put every invoice in the first bucket)', async () => {
    const r = (await api.as(t.admin).get('/v2/payments/aging')).body;
    expect(r.asOf).toBe(ymd(0));
    const usd = r.currencies.find((c: { currency: string }) => c.currency === 'USD');
    const bucket = (b: string) => usd.buckets.find((x: { bucket: string }) => x.bucket === b);
    expect(usd.buckets.map((b: { bucket: string }) => b.bucket)).toEqual([
      'current',
      'd1_30',
      'd31_60',
      'd61_90',
      'd90_plus',
    ]);
    expect(bucket('current')).toMatchObject({ amount: '100.00', invoices: 1 });
    expect(bucket('d1_30')).toMatchObject({ amount: '100.00', invoices: 1 });
    expect(bucket('d31_60')).toMatchObject({ amount: '100.00', invoices: 1 });
    expect(bucket('d61_90')).toMatchObject({ amount: '100.00', invoices: 1 });
    expect(bucket('d90_plus')).toMatchObject({ amount: '60.00', invoices: 1 });
    expect(usd.total).toBe('460.00');
    const eur = r.currencies.find((c: { currency: string }) => c.currency === 'EUR');
    expect(eur.total).toBe('100.00');
    expect(eur.buckets.find((x: { bucket: string }) => x.bucket === 'd1_30').amount).toBe('100.00');
    // a paid invoice is not in the report at all
    expect(usd.invoices).toBe(5);
  });

  it('the report can be cut to one contact or one currency', async () => {
    const one = (await api.as(t.admin).get(`/v2/payments/aging?contactId=${c2}`)).body;
    expect(one.currencies).toHaveLength(1);
    expect(one.currencies[0].total).toBe('260.00');
    const cur = (await api.as(t.admin).get('/v2/payments/aging?currency=EUR')).body;
    expect(cur.currencies.map((c: { currency: string }) => c.currency)).toEqual(['EUR']);
  });

  it('TW-PAY-004 / TW-PAY-001: the summary has collected, refunded, outstanding and overdue per currency, never summed across them', async () => {
    const s = (await api.as(t.admin).get('/v2/payments/summary')).body;
    expect(s.days).toBe(30);
    expect(s.collected).toEqual([{ currency: 'USD', amount: '140.00' }]);
    expect(s.outstanding).toEqual([
      { currency: 'EUR', amount: '100.00', invoices: 1 },
      { currency: 'USD', amount: '460.00', invoices: 5 },
    ]);
    expect(s.overdue).toEqual([
      { currency: 'EUR', amount: '100.00', invoices: 1 },
      { currency: 'USD', amount: '360.00', invoices: 4 },
    ]);
    expect((await api.as(t.admin).get('/v2/payments/summary?days=0')).status).toBe(422);
  });

  it('TW-PAY-004: outstanding per contact, biggest debt first within a currency, with the overdue part and the oldest due date', async () => {
    const r = (await api.as(t.admin).get('/v2/payments/outstanding')).body;
    const rows = r.data as Array<{
      contact: { name: string } | null;
      currency: string;
      outstanding: string;
      overdue: string;
      invoices: number;
      oldestDueDate: string;
    }>;
    expect(rows.map((x) => `${x.currency}:${x.contact?.name}`)).toEqual([
      'EUR:Ann Debtor',
      'USD:Bob Debtor',
      'USD:Ann Debtor',
    ]);
    const bob = rows.find((x) => x.contact?.name === 'Bob Debtor')!;
    expect(bob).toMatchObject({
      outstanding: '260.00',
      overdue: '260.00',
      invoices: 3,
      oldestDueDate: ymd(-100),
    });
    const ann = rows.find((x) => x.currency === 'USD' && x.contact?.name === 'Ann Debtor')!;
    expect(ann).toMatchObject({ outstanding: '200.00', overdue: '100.00', invoices: 2 });
    const overdueOnly = (
      await api.as(t.admin).get('/v2/payments/outstanding?onlyOverdue=true&currency=USD')
    ).body.data as Array<{ contact: { name: string } }>;
    expect(overdueOnly.map((x) => x.contact.name).sort()).toEqual(['Ann Debtor', 'Bob Debtor']);
    const paged = (await api.as(t.admin).get('/v2/payments/outstanding?limit=2')).body;
    expect(paged.data).toHaveLength(2);
    expect(paged.page.hasMore).toBe(true);
    const next = (
      await api.as(t.admin).get(`/v2/payments/outstanding?limit=2&cursor=${paged.page.nextCursor}`)
    ).body;
    expect(next.data).toHaveLength(1);
    expect(c1).toBeTruthy();
  });
});

describe('the overdue sweep (TW-INV-030, D-02)', () => {
  let t: Tenant;
  let sweep: InvoiceOverdueSweepService;
  beforeAll(async () => {
    t = await api.signup('isw');
    sweep = new InvoiceOverdueSweepService(h.app.get(DatabaseService), h.app.get(OutboxService));
  });

  it('an issued invoice with a balance whose due DATE has passed is announced once with invoice.overdue and stamped; paid, not-yet-due, void and draft ones are not', async () => {
    const mk = (due: number, over: Record<string, unknown> = {}) =>
      issued(t.admin, { issueDate: ymd(due - 10), dueDate: ymd(due), ...over });
    const late = await mk(-3);
    const dueToday = await mk(0);
    const future = await mk(5);
    const paid = await mk(-3);
    await pay(t.admin, paid.id, { amount: '100' });
    const voided = await mk(-3);
    await api.as(t.admin).post(`/v2/invoices/${voided.id}/void`).send({ reason: 'x' });
    const draft = await make(t.admin, { issueDate: ymd(-10), dueDate: ymd(-3) });
    const partial = await mk(-4);
    await pay(t.admin, partial.id, { amount: '10' });

    const n = await sweep.sweep();
    expect(n).toBeGreaterThanOrEqual(2);
    const ev = (await api.events(t.orgId, 'invoice.overdue')).map((e) => e.uuid);
    expect(ev).toContain(late.id);
    expect(ev).toContain(partial.id);
    for (const other of [dueToday, future, paid, voided, draft]) expect(ev).not.toContain(other.id);
    const e = (await api.events(t.orgId, 'invoice.overdue')).find((x) => x.uuid === late.id)!;
    expect(e).toMatchObject({
      currency: 'USD',
      balanceMinor: '10000',
      dueDate: ymd(-3),
      remindersEnabled: true,
    });
    // once: a second pass announces nothing new for the same invoices
    await sweep.sweep();
    expect(
      (await api.events(t.orgId, 'invoice.overdue')).filter((x) => x.uuid === late.id),
    ).toHaveLength(1);
    const timeline = (
      (await api.as(t.admin).get(`/v2/invoices/${late.id}/events`)).body.data as Array<{
        type: string;
      }>
    ).map((x) => x.type);
    expect(timeline).toContain('overdue');
    expect(await get(t.admin, late.id)).toMatchObject({ status: 'overdue', overdue: true });
    // the day it is due is not late; the sweep catches it from the next calendar day
    expect(await get(t.admin, dueToday.id)).toMatchObject({ status: 'issued', overdue: false });
  });

  it('the workspace calendar decides: an invoice due "today" in a zone that is a day behind UTC is not overdue yet', async () => {
    const tt = await api.signup('isz');
    await h.owner.query(
      `UPDATE organizations SET settings = settings || '{"timezone":"Pacific/Pago_Pago"}'::jsonb WHERE id = $1`,
      [tt.orgId],
    );
    const nowInPago = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Pago_Pago' }).format(
      new Date(),
    );
    const i = await issued(tt.admin, { issueDate: nowInPago, dueDate: nowInPago });
    const before = (await api.events(tt.orgId, 'invoice.overdue')).length;
    await sweep.sweep();
    expect((await api.events(tt.orgId, 'invoice.overdue')).length).toBe(before);
    expect(await get(tt.admin, i.id)).toMatchObject({ status: 'issued' });
    // an unknown zone name falls back to UTC instead of failing the sweep for everyone
    await h.owner.query(
      `UPDATE organizations SET settings = settings || '{"timezone":"Mars/Olympus"}'::jsonb WHERE id = $1`,
      [tt.orgId],
    );
    await expect(sweep.sweep()).resolves.toBeGreaterThanOrEqual(0);
  });
});

describe('the buyer\'s page, PDF and "pay now" (TW-INV-016/017, TW-PAY-015, D-15)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ipb');
    await api
      .as(t.admin)
      .patch('/v2/invoice-settings')
      .send({
        sellerName: 'Public Seller',
        sellerAddress: '1 Main St',
        sellerTaxId: 'PS-1',
        brandColor: '#112233',
        paymentInstructions: 'Pay by bank transfer to the account below.',
        bankDetails: { IBAN: 'XX00 9999', BIC: 'XXBICXX' },
        footerNote: 'Thank you',
      });
  });

  it("TW-INV-016: anyone with the token sees the invoice with no login; internal ids, the owner, the creator and the buyer's email and phone are not in it", async () => {
    const i = await issued(t.admin, {
      buyerEmail: 'secret@buyer.test',
      buyerPhone: '+14155550199',
      notes: 'Visible note',
      lines: [{ description: 'Thing', qty: '2', unitPrice: '50.00' }],
    });
    const res = await pub(i.publicLink!.token).send();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.body).toMatchObject({
      number: i.number,
      status: 'issued',
      currency: 'USD',
      payable: true,
      seller: { name: 'Public Seller', taxId: 'PS-1' },
      buyer: { name: 'Acme Ltd' },
      amounts: { total: '100.00', balance: '100.00' },
      brandColor: '#112233',
      footerNote: 'Thank you',
      notes: 'Visible note',
    });
    expect(res.body.paymentOptions.bankTransfer).toMatchObject({
      instructions: expect.stringContaining('bank transfer'),
      details: { IBAN: 'XX00 9999' },
    });
    const text = JSON.stringify(res.body);
    for (const leak of ['secret@buyer.test', '+14155550199', i.id, 'createdBy'])
      expect(text, leak).not.toContain(leak);
    expect(res.body.lines[0]).not.toHaveProperty('id');
  });

  it('TW-INV-016 / D-15: the first view raises invoice.viewed and is counted; later views only count (viewedAt, view count on the invoice)', async () => {
    const i = await issued(t.admin);
    expect((await get(t.admin, i.id)).viewCount).toBe(0);
    await pub(i.publicLink!.token).send();
    await pub(i.publicLink!.token).send();
    const after = await get(t.admin, i.id);
    expect(after.viewCount).toBe(2);
    expect(
      (await api.events(t.orgId, 'invoice.viewed')).filter((e) => e.uuid === i.id),
    ).toHaveLength(1);
    const tl = (
      (await api.as(t.admin).get(`/v2/invoices/${i.id}/events`)).body.data as Array<{
        type: string;
        actor: { kind: string };
      }>
    ).find((e) => e.type === 'viewed');
    expect(tl?.actor.kind).toBe('buyer');
  });

  it('an unknown or malformed token is the same plain 404, whatever it looks like', async () => {
    for (const token of [
      'a'.repeat(43),
      'short',
      'x'.repeat(200),
      "' OR '1'='1",
      '..%2F..%2Fetc%2Fpasswd',
      '%00',
    ]) {
      const res = await pub(token).send();
      expect(res.status, token).toBe(404);
      expect(code(res), token).toBe('NOT_FOUND');
    }
    // a draft has no link at all
    const d = await make(t.admin);
    expect(d.publicLink).toBeNull();
  });

  it('D-15: only the SHA-256 of a token is stored in a searchable column (the encrypted copy lets staff copy the link again)', async () => {
    const i = await issued(t.admin);
    const row = (
      await h.owner.query(
        `SELECT public_token_hash, public_token_cipher FROM invoices WHERE uuid = $1`,
        [i.id],
      )
    ).rows[0];
    expect(row.public_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.public_token_hash).not.toContain(i.publicLink!.token);
    expect(row.public_token_cipher).toMatch(/^v1:/);
    expect(row.public_token_cipher).not.toContain(i.publicLink!.token);
    expect(
      await sqlN(
        `SELECT count(*)::int AS n FROM invoices WHERE org_id = $1 AND public_token_hash = $2`,
        [t.orgId, i.publicLink!.token],
      ),
    ).toBe(0);
  });

  it('TW-INV-017 / D-15: the PDF is a pure render: a real PDF, never a send, counts no view, always the same bytes for an issued invoice', async () => {
    const i = await issued(t.admin);
    const a = await pub(`${i.publicLink!.token}/pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(a.status).toBe(200);
    expect(a.headers['content-type']).toBe('application/pdf');
    expect(a.headers['content-disposition']).toContain(`${i.number}.pdf`);
    expect(a.headers['x-robots-tag']).toContain('noindex');
    const bytes = a.body as Buffer;
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.toString('latin1')).toContain('Public Seller');
    const b = await pub(`${i.publicLink!.token}/pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect((b.body as Buffer).equals(bytes)).toBe(true);
    expect((await get(t.admin, i.id)).viewCount).toBe(0);
    expect(
      await sqlN(
        `SELECT count(*)::int AS n FROM event_outbox WHERE org_id = $1 AND event_type IN ('invoice.sent','invoice.viewed') AND payload->>'uuid' = $2`,
        [t.orgId, i.id],
      ),
    ).toBe(0);
    // the staff download is the same render, behind the permission
    const staff = await api
      .as(t.admin)
      .get(`/v2/invoices/${i.id}/pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(staff.status).toBe(200);
    expect((staff.body as Buffer).equals(bytes)).toBe(true);
    const nobody = await api.member(t, 'nopdf', []);
    expect((await api.as(nobody.token).get(`/v2/invoices/${i.id}/pdf`)).status).toBe(403);
  });

  it('the printable page escapes buyer-supplied text and carries noindex, no-store and a restrictive content security policy', async () => {
    const i = await issued(t.admin, {
      buyerName: '<script>alert(1)</script>',
      notes: '"><img src=x onerror=alert(2)>',
    });
    const res = await pub(`${i.publicLink!.token}/print`).send();
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.text).not.toContain('<script>alert(1)');
    expect(res.text).not.toContain('<img src=x');
    expect(res.text).toContain('&lt;script&gt;');
    expect(res.text).toContain('noindex');
  });

  it('D-15: the public routes are rate limited per address (120 reads a minute); the excess is 429', async () => {
    const i = await issued(t.admin);
    await inSafeWindow(15_000);
    const ip = freshIp();
    const hit = () =>
      api.http().get(`/v2/public/invoices/${i.publicLink!.token}`).set('x-forwarded-for', ip);
    let limited = 0;
    for (let n = 0; n < 125; n++) if ((await hit()).status === 429) limited++;
    expect(limited).toBe(5);
    expect(code(await hit())).toBe('RATE_LIMITED');
    // another address is unaffected
    expect((await pub(i.publicLink!.token).send()).status).toBe(200);
  }, 60_000);

  it('TW-PAY-015 pay now (manual): the buyer gets the bank-transfer instructions, any amount up to the balance; the page never marks anything paid', async () => {
    const i = await issued(t.admin);
    const res = await pub(`${i.publicLink!.token}/pay`, 'post').send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'instructions',
      attemptId: null,
      amount: '100.00',
      currency: 'USD',
      details: { IBAN: 'XX00 9999' },
    });
    expect(res.body.note).toContain('does not confirm payment');
    const partial = await pub(`${i.publicLink!.token}/pay`, 'post').send({ amount: '30' });
    expect(partial.body.amount).toBe('30.00');
    const tooMuch = await pub(`${i.publicLink!.token}/pay`, 'post').send({ amount: '100.01' });
    expect(tooMuch.status).toBe(422);
    expect(await get(t.admin, i.id)).toMatchObject({ status: 'issued', paymentStatus: 'unpaid' });
    // redirect-style parameters change nothing
    const forged = await pub(
      `${i.publicLink!.token}?paid=true&status=success&payment_status=paid`,
    ).send();
    expect(forged.body.status).toBe('issued');
    expect(
      await sqlN(
        `SELECT count(*)::int AS n FROM payments WHERE org_id = $1 AND invoice_id = (SELECT id FROM invoices WHERE uuid = $2)`,
        [t.orgId, i.id],
      ),
    ).toBe(0);
  });

  it('pay now on a paid, void or revoked invoice: 409 PAY_NOTHING_TO_PAY / 410', async () => {
    const i = await issued(t.admin);
    await pay(t.admin, i.id, { amount: '100' });
    const paid = await pub(`${i.publicLink!.token}/pay`, 'post').send({});
    expect(paid.status).toBe(409);
    expect(code(paid)).toBe('PAY_NOTHING_TO_PAY');
    const v = await issued(t.admin);
    await api.as(t.admin).post(`/v2/invoices/${v.id}/void`).send({ reason: 'x' });
    expect((await pub(`${v.publicLink!.token}/pay`, 'post').send({})).status).toBe(409);
    const r = await issued(t.admin);
    await api.as(t.admin).post(`/v2/invoices/${r.id}/public-link/revoke`).send({});
    expect((await pub(`${r.publicLink!.token}/pay`, 'post').send({})).status).toBe(410);
  });

  it('the page of a workspace with no payment details says nothing can be paid online (payable false, kind unavailable)', async () => {
    const tt = await api.signup('ipn');
    const i = await issued(tt.admin);
    const view = await pub(i.publicLink!.token).send();
    expect(view.body).toMatchObject({
      payable: false,
      paymentOptions: { bankTransfer: null, online: false },
    });
    const pay_ = await pub(`${i.publicLink!.token}/pay`, 'post').send({});
    expect(pay_.body.kind).toBe('unavailable');
  });
});

describe('the signed payment webhook (TW-PAY-009, D-18, D-19)', () => {
  let t: Tenant;
  let endpoint: string;
  const SECRET = 'webhook-secret-0123456789abcdef';
  beforeAll(async () => {
    t = await api.signup('iwh');
    await api
      .as(t.admin)
      .patch('/v2/invoice-settings')
      .send({ bankDetails: { IBAN: 'XX' } });
    const gw = await api.as(t.admin).put('/v2/invoice-settings/gateway').send({ mode: 'test' });
    expect(gw.status, JSON.stringify(gw.body)).toBe(200);
    endpoint = gw.body.webhookPath as string;
    expect(endpoint).toMatch(/^\/v2\/public\/webhooks\/invoice-payments\/[0-9a-f-]{36}$/);
  });

  const post = (path: string, raw: string, headers: Record<string, string> = {}) =>
    api
      .http()
      .post(path)
      .set('content-type', 'application/json')
      .set('x-forwarded-for', freshIp())
      .set(headers)
      .send(raw);
  const sign = (raw: string, secret = SECRET, ts = Math.floor(Date.now() / 1000)) => ({
    'x-invoice-signature': `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex')}`,
  });
  const event = (id: string, reference: string, over: Record<string, unknown> = {}) =>
    JSON.stringify({
      id,
      type: 'payment.succeeded',
      data: { reference, amount: '100.00', currency: 'USD', paymentId: `pay_${id}`, ...over },
    });
  /** An invoice, a payment attempt on it (through the public Pay button), and the attempt's reference. */
  async function attempt(over: Record<string, unknown> = {}): Promise<{ inv: Inv; ref: string }> {
    const inv = await issued(t.admin, over);
    const res = await pub(`${inv.publicLink!.token}/pay`, 'post').send({});
    expect(res.body.attemptId, JSON.stringify(res.body)).toMatch(uuidRe);
    return { inv, ref: res.body.attemptId as string };
  }

  it('the connection cannot be enabled without a secret, never returns the secret, and shows its webhook path', async () => {
    const no = await api.as(t.admin).put('/v2/invoice-settings/gateway').send({ enabled: true });
    expect(no.status).toBe(422);
    expect(code(no)).toBe('PAY_GATEWAY_NOT_CONFIGURED');
    const short = await api
      .as(t.admin)
      .put('/v2/invoice-settings/gateway')
      .send({ webhookSecret: 'short' });
    expect(short.status).toBe(422);
    const on = await api
      .as(t.admin)
      .put('/v2/invoice-settings/gateway')
      .send({ webhookSecret: SECRET, enabled: true });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body).toMatchObject({
      configured: true,
      enabled: true,
      hasSecret: true,
      mode: 'test',
    });
    expect(JSON.stringify(on.body)).not.toContain(SECRET);
    expect(
      JSON.stringify((await api.as(t.admin).get('/v2/invoice-settings/gateway')).body),
    ).not.toContain(SECRET);
    const row = (
      await h.owner.query(
        `SELECT webhook_secret_cipher FROM invoice_gateway_connections WHERE org_id = $1`,
        [t.orgId],
      )
    ).rows[0];
    expect(row.webhook_secret_cipher).toMatch(/^v1:/);
    expect(row.webhook_secret_cipher).not.toContain(SECRET);
    // the secret is not in the audit trail either
    expect(
      JSON.stringify(
        (
          await h.owner.query(
            `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'invoice-settings'`,
            [t.orgId],
          )
        ).rows,
      ),
    ).not.toContain(SECRET);
  });

  it('D-18 fail closed: an unknown endpoint, a bad signature, a missing signature, a stale one and a wrong secret are the SAME 401 (no oracle)', async () => {
    const { ref } = await attempt();
    const raw = event('evt-closed', ref);
    const responses = await Promise.all([
      post(
        '/v2/public/webhooks/invoice-payments/00000000-0000-4000-8000-000000000000',
        raw,
        sign(raw),
      ),
      post(endpoint, raw, sign(raw, 'another-secret-0123456789')),
      post(endpoint, raw, {}),
      post(endpoint, raw, sign(raw, SECRET, Math.floor(Date.now() / 1000) - 3600)),
      post(endpoint, raw, { 'x-invoice-signature': 'garbage' }),
      post('/v2/public/webhooks/invoice-payments/not-a-uuid', raw, sign(raw)),
    ]);
    for (const r of responses) {
      expect(r.status).toBe(401);
      expect(code(r)).toBe('PAY_SIGNATURE_INVALID');
    }
    expect(
      new Set(responses.map((r) => JSON.stringify({ ...r.body, requestId: 0, instance: 0 }))).size,
    ).toBe(1);
    expect(
      await sqlN(
        `SELECT count(*)::int AS n FROM payments WHERE org_id = $1 AND source = 'gateway'`,
        [t.orgId],
      ),
    ).toBe(0);
    expect(
      await sqlN(`SELECT count(*)::int AS n FROM invoice_gateway_events WHERE org_id = $1`, [
        t.orgId,
      ]),
    ).toBe(0);
  });

  it('a disabled connection is the same 401 even with a correct signature', async () => {
    const { ref } = await attempt();
    await api.as(t.admin).put('/v2/invoice-settings/gateway').send({ enabled: false });
    const raw = event('evt-disabled', ref);
    const r = await post(endpoint, raw, sign(raw));
    expect(r.status).toBe(401);
    await api.as(t.admin).put('/v2/invoice-settings/gateway').send({ enabled: true });
    expect((await post(endpoint, raw, sign(raw))).status).toBe(200);
  });

  it("a signed payment.succeeded records the payment through the ledger (source gateway, the provider's id as reference), marks the attempt and the invoice, and is announced", async () => {
    const { inv, ref } = await attempt();
    const raw = event('evt-ok', ref);
    const res = await post(endpoint, raw, sign(raw));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ status: 'applied' });
    expect(await get(t.admin, inv.id)).toMatchObject({ status: 'paid', paymentStatus: 'paid' });
    const p = (await api.as(t.admin).get(`/v2/invoices/${inv.id}/payments`)).body.data[0];
    expect(p).toMatchObject({
      source: 'gateway',
      method: 'gateway',
      amount: '100.00',
      reference: 'pay_evt-ok',
    });
    expect(p.receiptNumber).toMatch(/^RCT-/);
    expect(
      await sqlN(
        `SELECT count(*)::int AS n FROM invoice_payment_attempts WHERE org_id = $1 AND status = 'succeeded' AND payment_id IS NOT NULL AND uuid = $2`,
        [t.orgId, ref],
      ),
    ).toBe(1);
    expect((await api.events(t.orgId, 'invoice.paid')).some((e) => e.uuid === inv.id)).toBe(true);
    const tl = (
      (await api.as(t.admin).get(`/v2/invoices/${inv.id}/events`)).body.data as Array<{
        type: string;
        actor: { kind: string };
      }>
    ).find((e) => e.type === 'payment_recorded');
    expect(tl?.actor.kind).toBe('gateway');
  });

  it('TW-PAY-003 #1 / D-18: the same event delivered twice, or a new event for the same provider payment, records one payment', async () => {
    const { inv, ref } = await attempt();
    const raw = event('evt-dup', ref);
    expect((await post(endpoint, raw, sign(raw))).body.status).toBe('applied');
    expect((await post(endpoint, raw, sign(raw))).body.status).toBe('duplicate');
    // another event id carrying the same provider payment id: the ledger's unique key still records it once
    const raw2 = event('evt-dup-2', ref, { paymentId: 'pay_evt-dup' });
    const second = await post(endpoint, raw2, sign(raw2));
    expect(second.status).toBe(200);
    expect(
      await sqlN(
        `SELECT count(*)::int AS n FROM payments WHERE org_id = $1 AND invoice_id = (SELECT id FROM invoices WHERE uuid = $2)`,
        [t.orgId, inv.id],
      ),
    ).toBe(1);
  });

  it('D-18: the amount and the currency are compared with the attempt: a signed event for another amount or currency is rejected, recorded, announced and applied to nothing', async () => {
    const { inv, ref } = await attempt();
    const wrongAmount = event('evt-amt', ref, { amount: '1.00' });
    const r1 = await post(endpoint, wrongAmount, sign(wrongAmount));
    expect(r1.status).toBe(200);
    expect(r1.body.status).toBe('rejected');
    const wrongCurrency = event('evt-cur', ref, { currency: 'EUR' });
    expect((await post(endpoint, wrongCurrency, sign(wrongCurrency))).body.status).toBe('rejected');
    expect(await get(t.admin, inv.id)).toMatchObject({ status: 'issued', paymentStatus: 'unpaid' });
    expect(
      await sqlN(
        `SELECT count(*)::int AS n FROM invoice_gateway_events WHERE org_id = $1 AND outcome = 'rejected' AND event_id IN ('evt-amt','evt-cur')`,
        [t.orgId],
      ),
    ).toBe(2);
    expect(
      (await api.events(t.orgId, 'payment.rejected')).filter(
        (e) => e.reason === 'amount_or_currency_mismatch',
      ).length,
    ).toBeGreaterThanOrEqual(2);
    // the real amount still goes through afterwards
    const good = event('evt-amt-good', ref);
    expect((await post(endpoint, good, sign(good))).body.status).toBe('applied');
  });

  it('a partial online payment (the buyer chose a smaller amount) is applied as such', async () => {
    const inv = await issued(t.admin);
    const res = await pub(`${inv.publicLink!.token}/pay`, 'post').send({ amount: '40' });
    const raw = event('evt-part', res.body.attemptId, { amount: '40.00' });
    expect((await post(endpoint, raw, sign(raw))).body.status).toBe('applied');
    expect(await get(t.admin, inv.id)).toMatchObject({ status: 'partially_paid' });
  });

  it('an unknown reference is acknowledged and ignored; an attempt of ANOTHER workspace is just as unknown (the reference is looked up inside the verified tenant)', async () => {
    const other = await api.signup('iwh2');
    await api
      .as(other.admin)
      .put('/v2/invoice-settings/gateway')
      .send({ webhookSecret: SECRET, enabled: true });
    await api
      .as(other.admin)
      .patch('/v2/invoice-settings')
      .send({ bankDetails: { IBAN: 'Y' } });
    const foreign = await issued(other.admin);
    const fres = await pub(`${foreign.publicLink!.token}/pay`, 'post').send({});
    const raw = event('evt-x', fres.body.attemptId);
    const res = await post(endpoint, raw, sign(raw));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ignored');
    expect(await get(other.admin, foreign.id)).toMatchObject({
      status: 'issued',
      paymentStatus: 'unpaid',
    });
    const nothing = event('evt-nothing', '00000000-0000-4000-8000-000000000000');
    expect((await post(endpoint, nothing, sign(nothing))).body.status).toBe('ignored');
  });

  it('a payment.failed marks the attempt failed and records nothing; a succeeded event for a void invoice is rejected and announced, not applied', async () => {
    const { inv, ref } = await attempt();
    const failed = JSON.stringify({
      id: 'evt-fail',
      type: 'payment.failed',
      data: { reference: ref, amount: '100.00', currency: 'USD', paymentId: 'pay_f' },
    });
    expect((await post(endpoint, failed, sign(failed))).body.status).toBe('applied');
    expect(
      await sqlN(
        `SELECT count(*)::int AS n FROM invoice_payment_attempts WHERE org_id = $1 AND status = 'failed' AND uuid = $2`,
        [t.orgId, ref],
      ),
    ).toBe(1);
    const v = await attempt();
    await api.as(t.admin).post(`/v2/invoices/${v.inv.id}/void`).send({ reason: 'x' });
    const raw = event('evt-void', v.ref);
    expect((await post(endpoint, raw, sign(raw))).body.status).toBe('rejected');
    expect(inv.id).toBeTruthy();
  });

  it('a malformed body that is correctly signed is 400, not a crash; a body that is not JSON likewise', async () => {
    const bad = JSON.stringify({
      id: 'evt-bad',
      type: 'payment.succeeded',
      data: { reference: 'nope' },
    });
    expect((await post(endpoint, bad, sign(bad))).status).toBe(400);
    const notJson = 'not json';
    expect((await post(endpoint, notJson, sign(notJson))).status).toBe(400);
  });

  it('the webhook is rate limited per endpoint and address', async () => {
    await inSafeWindow(25_000);
    const ip = freshIp();
    const raw = '{}';
    let limited = 0;
    for (let n = 0; n < 305; n++) {
      const r = await api
        .http()
        .post(endpoint)
        .set('content-type', 'application/json')
        .set('x-forwarded-for', ip)
        .send(Buffer.from(raw));
      if (r.status === 429) limited++;
    }
    expect(limited).toBe(5);
  }, 90_000);
});

describe('the invoicing profile (TW-INV-021/022, D-09)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ipf');
  });

  it('TW-INV-021: a read returns the defaults and writes nothing (Reference created the settings row on a GET)', async () => {
    const res = await api.as(t.admin).get('/v2/invoice-settings');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      numberingPrefix: 'INV',
      proformaPrefix: 'PRO',
      receiptPrefix: 'RCT',
      numberFormat: '{PREFIX}-{YEAR}-{SEQ}',
      numberPadding: 6,
      yearlyReset: true,
      fiscalYearStartMonth: 1,
      dueDays: null,
      currency: 'USD',
      rowVersion: null,
    });
    expect(
      await sqlN(`SELECT count(*)::int AS n FROM invoice_settings WHERE org_id = $1`, [t.orgId]),
    ).toBe(0);
  });

  it("TW-INV-022 / D-09: PATCH changes only what is sent; nothing else is reset (Reference's checkbox semantics wiped fy_reset on every save)", async () => {
    const a = await api.as(t.admin).patch('/v2/invoice-settings').send({
      sellerName: 'Profile Co',
      yearlyReset: false,
      numberFormat: '{PREFIX}-{SEQ}',
      numberingPrefix: 'acme',
      fiscalYearStartMonth: 4,
    });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body).toMatchObject({
      sellerName: 'Profile Co',
      yearlyReset: false,
      numberingPrefix: 'ACME',
      fiscalYearStartMonth: 4,
    });
    const b = await api
      .as(t.admin)
      .patch('/v2/invoice-settings')
      .send({ dueDays: 30, terms: 'Net 30' });
    expect(b.body).toMatchObject({
      sellerName: 'Profile Co',
      yearlyReset: false,
      numberFormat: '{PREFIX}-{SEQ}',
      numberingPrefix: 'ACME',
      dueDays: 30,
      terms: 'Net 30',
    });
    expect(b.body.rowVersion).toBeGreaterThan(a.body.rowVersion);
    const c = await api
      .as(t.admin)
      .patch('/v2/invoice-settings')
      .send({ terms: null, sellerName: null });
    expect(c.body).toMatchObject({ terms: null, sellerName: null, dueDays: 30 });
    expect(
      await sqlN(`SELECT count(*)::int AS n FROM invoice_settings WHERE org_id = $1`, [t.orgId]),
    ).toBe(1);
    // a stale version is refused
    expect(
      (
        await api
          .as(t.admin)
          .patch('/v2/invoice-settings')
          .send({ terms: 'x', rowVersion: a.body.rowVersion })
      ).status,
    ).toBe(409);
  });

  it('TW-INV-022: validation: a prefix is letters and digits, the format needs {SEQ} and a year when the counter restarts yearly, a colour is a hex colour, due days 0..365, a logo is https', async () => {
    const bad = async (body: Record<string, unknown>) =>
      (await api.as(t.admin).patch('/v2/invoice-settings').send(body)).status;
    expect(await bad({ numberingPrefix: 'I N V' })).toBe(422);
    expect(await bad({ numberingPrefix: 'TOOLONGPREFIX' })).toBe(422);
    expect(await bad({ numberFormat: '{PREFIX}-{YEAR}' })).toBe(422);
    expect(await bad({ numberFormat: '{PREFIX}-{BOGUS}-{SEQ}' })).toBe(422);
    expect(await bad({ brandColor: 'red' })).toBe(422);
    expect(await bad({ dueDays: 400 })).toBe(422);
    expect(await bad({ logoUrl: 'http://insecure.test/x.png' })).toBe(422);
    expect(await bad({ supportEmail: 'not-an-email' })).toBe(422);
    expect(await bad({ yearlyReset: true })).toBe(422); // the stored format {PREFIX}-{SEQ} has no year: a yearly restart would repeat numbers
    expect(await bad({ yearlyReset: true, numberFormat: '{PREFIX}-{YY}-{SEQ}' })).toBe(200);
  });

  it('numbering follows the profile: prefix, format, padding, a fiscal-year start month; a proforma and a receipt have their own prefix', async () => {
    const tt = await api.signup('ipn2');
    await api.as(tt.admin).patch('/v2/invoice-settings').send({
      numberingPrefix: 'ACME',
      numberFormat: '{PREFIX}/{YY}/{SEQ}',
      numberPadding: 4,
      proformaPrefix: 'QUO',
      receiptPrefix: 'REC',
    });
    const a = await issued(tt.admin);
    const yy = String(new Date().getUTCFullYear() % 100).padStart(2, '0');
    expect(a.number).toBe(`ACME/${yy}/0001`);
    expect((await issued(tt.admin, { docType: 'proforma' })).number).toBe(`QUO/${yy}/0001`);
    expect((await pay(tt.admin, a.id, { amount: '10' })).payment.receiptNumber).toBe(
      `REC/${yy}/0001`,
    );
    // the number format of already issued invoices never changes
    await api.as(tt.admin).patch('/v2/invoice-settings').send({ numberingPrefix: 'NEW' });
    expect((await get(tt.admin, a.id)).number).toBe(`ACME/${yy}/0001`);
    expect((await issued(tt.admin)).number).toBe(`NEW/${yy}/0001`);
  });

  it('bank details and the tax id are not written into the audit trail: it records that they changed, not what they say', async () => {
    await api
      .as(t.admin)
      .patch('/v2/invoice-settings')
      .send({ bankDetails: { IBAN: 'SUPER-SECRET-IBAN-123' }, sellerTaxId: 'SECRET-TAX-ID-9' });
    const rows = (
      await h.owner.query(
        `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'invoice-settings'`,
        [t.orgId],
      )
    ).rows;
    const text = JSON.stringify(rows);
    expect(text).not.toContain('SUPER-SECRET-IBAN-123');
    expect(text).not.toContain('SECRET-TAX-ID-9');
    expect(text).toContain('bankDetails');
    expect((await api.events(t.orgId, 'invoice_settings.updated')).length).toBeGreaterThan(0);
  });
});

describe('quote to invoice through the real port (TW-INV-027, D-25)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('iqt');
  });

  it('an accepted estimate becomes a DRAFT invoice with exactly the totals the buyer accepted, linked both ways, carrying its contact and lines; issuing it numbers it', async () => {
    const [cid] = await api.seedContacts(t, [{ name: 'Quote Buyer', email: 'q@buyer.test' }]);
    const doc = await api
      .as(t.admin)
      .post('/v2/sales-docs')
      .send({
        kind: 'estimate',
        contactId: cid,
        currency: 'USD',
        taxRate: '10',
        discount: { kind: 'percent', value: '5' },
        notes: 'Quote notes',
        lines: [
          { description: 'Design', qty: '2.5', unitPrice: '99.99' },
          {
            description: 'Exempt',
            qty: '1',
            unitPrice: '9.99',
            taxRate: '0',
            discount: { kind: 'amount', value: '1.00' },
          },
          { description: 'Thirds', qty: '0.3333', unitPrice: '30.00' },
        ],
      });
    expect(doc.status, JSON.stringify(doc.body)).toBe(201);
    await api.as(t.admin).post(`/v2/sales-docs/${doc.body.id}/accept`).send({});
    const conv = await api
      .as(t.admin)
      .post(`/v2/sales-docs/${doc.body.id}/convert/invoice`)
      .send({});
    expect(conv.status, JSON.stringify(conv.body)).toBe(200);
    expect(conv.body.status).toBe('converted');
    const inv = await get(t.admin, conv.body.invoice.id);
    expect(inv).toMatchObject({
      status: 'draft',
      source: 'quote',
      number: null,
      buyerName: 'Quote Buyer',
      notes: 'Quote notes',
    });
    expect(inv.quote).toEqual({ id: doc.body.id, number: doc.body.number, kind: doc.body.kind }); // `kind` picks the proposal or estimate page
    expect(inv.salesOrder).toBeNull();
    expect(inv.recurring).toBeNull();
    expect(inv.contact?.id).toBe(cid);
    // the figures are the quote's, to the minor unit
    const t_ = doc.body.totals as Record<string, string>;
    expect(inv.amountsMinor).toMatchObject({
      subtotal: t_.subtotalMinor,
      discount: t_.discountMinor,
      tax: t_.taxMinor,
      total: t_.totalMinor,
    });
    expect(inv.lines).toHaveLength(3);
    expect(inv.lines.map((l) => l.description)).toEqual(['Design', 'Exempt', 'Thirds']);
    expect(inv.lines[2]!.qty).toBe('0.3333');
    // it is a normal draft from here on
    const numbered = await issue(t.admin, inv.id);
    expect(numbered.number).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(numbered.amountsMinor.total).toBe(t_.totalMinor);
    const again = await api
      .as(t.admin)
      .post(`/v2/sales-docs/${doc.body.id}/convert/invoice`)
      .send({});
    expect(again.status).toBe(409);
    expect(
      await sqlN(
        `SELECT count(*)::int AS n FROM invoices WHERE org_id = $1 AND quote_id IS NOT NULL`,
        [t.orgId],
      ),
    ).toBe(1);
    expect(
      (await api.events(t.orgId, 'invoice.created')).some(
        (e) => e.uuid === inv.id && e.source === 'quote',
      ),
    ).toBe(true);
  });

  it("the quote's document discount and per-line rates survive: a mixed-rate document converts to the same total", async () => {
    const doc = await api
      .as(t.admin)
      .post('/v2/sales-docs')
      .send({
        kind: 'proposal',
        currency: 'EUR',
        buyerName: 'Mixed',
        taxRate: '21',
        discount: { kind: 'amount', value: '12.34' },
        lines: [
          { description: 'a', qty: '3', unitPrice: '33.33' },
          { description: 'b', qty: '1', unitPrice: '5.55', taxRate: '9' },
          { description: 'c', qty: '7', unitPrice: '0.01', taxRate: '0' },
        ],
      });
    await api.as(t.admin).post(`/v2/sales-docs/${doc.body.id}/accept`).send({});
    const conv = await api
      .as(t.admin)
      .post(`/v2/sales-docs/${doc.body.id}/convert/invoice`)
      .send({});
    const inv = await get(t.admin, conv.body.invoice.id);
    expect(inv.amountsMinor.total).toBe(doc.body.totals.totalMinor);
    expect(inv.amountsMinor.tax).toBe(doc.body.totals.taxMinor);
  });
});

describe('tenant isolation and audit (CONTRIBUTING rules 1 and 6)', () => {
  it('another workspace gets 404 on every read and write by uuid, and its lists never include these rows', async () => {
    const a = await api.signup('iso1');
    const b = await api.signup('iso2');
    const inv = await issued(a.admin);
    const p = await pay(a.admin, inv.id, { amount: '10' });
    const r = await rate(a.admin, { name: 'Iso rate', rate: '3' });
    const reqs = await Promise.all([
      api.as(b.admin).get(`/v2/invoices/${inv.id}`),
      api.as(b.admin).patch(`/v2/invoices/${inv.id}`).send({ rowVersion: 1, notes: 'x' }),
      api.as(b.admin).post(`/v2/invoices/${inv.id}/issue`).send({}),
      api.as(b.admin).post(`/v2/invoices/${inv.id}/void`).send({ reason: 'x' }),
      api.as(b.admin).delete(`/v2/invoices/${inv.id}`),
      api.as(b.admin).post(`/v2/invoices/${inv.id}/payments`).send({ amount: '1' }),
      api.as(b.admin).post(`/v2/invoices/${inv.id}/public-link/regenerate`).send({}),
      api.as(b.admin).get(`/v2/invoices/${inv.id}/events`),
      api.as(b.admin).get(`/v2/invoices/${inv.id}/pdf`),
      api.as(b.admin).get(`/v2/payments/${p.payment.id}`),
      api.as(b.admin).get(`/v2/payments/${p.payment.id}/receipt`),
      api.as(b.admin).post(`/v2/payments/${p.payment.id}/refund`).send({}),
      api.as(b.admin).get(`/v2/tax-rates/${r.id}`),
      api.as(b.admin).patch(`/v2/tax-rates/${r.id}`).send({ rowVersion: 1, rate: '9' }),
      api.as(b.admin).delete(`/v2/tax-rates/${r.id}`),
    ]);
    reqs.forEach((res, i) => expect(res.status, String(i)).toBe(404));
    expect((await api.as(b.admin).get('/v2/invoices')).body.data).toEqual([]);
    expect((await api.as(b.admin).get('/v2/payments')).body.data).toEqual([]);
    expect((await api.as(b.admin).get('/v2/tax-rates')).body.data).toEqual([]);
    expect((await api.as(b.admin).get('/v2/invoices/counts')).body.all).toBe(0);
    expect((await api.as(b.admin).get('/v2/payments/aging')).body.currencies).toEqual([]);
    // the buyer's link works for the buyer only: it names exactly one invoice
    expect((await pub(inv.publicLink!.token).send()).status).toBe(200);
  });

  it("audit and outbox are written in the writer's transaction: a failed write leaves neither", async () => {
    const t = await api.signup('iau');
    const inv = await issued(t.admin);
    const audits = await sqlN(`SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1`, [
      t.orgId,
    ]);
    const events = await sqlN(`SELECT count(*)::int AS n FROM event_outbox WHERE org_id = $1`, [
      t.orgId,
    ]);
    const rejected = await api
      .as(t.admin)
      .post(`/v2/invoices/${inv.id}/payments`)
      .send({ amount: '999999' });
    expect(rejected.status).toBe(422);
    expect(
      await sqlN(`SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1`, [t.orgId]),
    ).toBe(audits);
    expect(
      await sqlN(`SELECT count(*)::int AS n FROM event_outbox WHERE org_id = $1`, [t.orgId]),
    ).toBe(events);
    expect(
      await sqlN(
        `SELECT count(*)::int AS n FROM invoice_logs WHERE org_id = $1 AND event = 'payment_recorded'`,
        [t.orgId],
      ),
    ).toBe(0);
    // and a success leaves exactly one of each kind per write
    await pay(t.admin, inv.id, { amount: '10' });
    expect(
      await sqlN(`SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1`, [t.orgId]),
    ).toBe(audits + 1);
    expect(
      await sqlN(
        `SELECT count(*)::int AS n FROM event_outbox WHERE org_id = $1 AND event_type = 'payment.recorded'`,
        [t.orgId],
      ),
    ).toBe(1);
  });
});
