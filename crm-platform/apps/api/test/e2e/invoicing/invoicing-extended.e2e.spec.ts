import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { RecurringInvoiceSweepService } from '../../../src/modules/crm/invoicing/recurring-invoice-sweep.service';
import { RecurringInvoicesService } from '../../../src/modules/crm/invoicing/recurring-invoices.service';
import {
  DealsApi,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../deals-pipelines/support';

/**
 * The owner-direction extensions of invoicing, end to end through HTTP: credit notes (full and partial, applied to the balance or
 * refunded in cash, the cap), recurring invoices (schedule, idempotent worker generation, catch-up, pause/resume, failures) and
 * sales orders (from an accepted offer, partial invoicing, fulfilment, quantities given back when an invoice is voided).
 */
let h: Harness;
let api: DealsApi;
let sweep: RecurringInvoiceSweepService;

beforeAll(async () => {
  h = await startHarness();
  api = new DealsApi(h);
  sweep = new RecurringInvoiceSweepService(h.app.get(RecurringInvoicesService));
  void DatabaseService;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const code = (res: { body: { code?: string } }) => res.body.code;
const sqlN = async (sql: string, params: unknown[] = []) => Number((await h.owner.query(sql, params)).rows[0].n);
const ymd = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

interface Inv {
  id: string;
  number: string | null;
  status: string;
  paymentStatus: string;
  amounts: Record<string, string>;
  rowVersion: number;
  lines: Array<{ id: string; description: string; qty: string }>;
  salesOrder?: { id: string; number: string } | null;
  recurring?: { id: string; name: string } | null;
}

const LINES = [
  { description: 'Widget', qty: '4', unitPrice: '25.00', taxRateId: null },
  { description: 'Gadget', qty: '1', unitPrice: '100.00', taxRateId: null },
];

async function issuedInvoice(token: string, body: Record<string, unknown> = {}): Promise<Inv> {
  const made = await api.as(token).post('/v2/invoices').send({ buyerName: 'Credit Co', currency: 'USD', lines: LINES, ...body });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const res = await api.as(token).post(`/v2/invoices/${made.body.id}/issue`).send({});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Inv;
}
const getInv = async (token: string, id: string): Promise<Inv> => (await api.as(token).get(`/v2/invoices/${id}`)).body as Inv;
async function payInv(token: string, id: string, amount: string) {
  const res = await api.as(token).post(`/v2/invoices/${id}/payments`).send({ amount, method: 'bank' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}
async function creditNote(token: string, body: Record<string, unknown>) {
  const res = await api.as(token).post('/v2/credit-notes').send({ reason: 'return', settlement: 'balance', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}
const issueCn = (token: string, id: string) => api.as(token).post(`/v2/credit-notes/${id}/issue`).send({});

describe('credit notes', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('icn');
  });

  it('a partial credit by quantity reduces the balance, takes its own CRN number, and an issued note is frozen', async () => {
    const inv = await issuedInvoice(t.admin);
    const cn = await creditNote(t.admin, { invoiceId: inv.id, lines: [{ invoiceLineId: inv.lines[0]!.id, qty: '1' }] });
    expect(cn).toMatchObject({ status: 'draft', number: null });
    expect(cn.amounts.total).toBe('25.00');
    const done = (await issueCn(t.admin, cn.id)).body;
    expect(done.status).toBe('issued');
    expect(done.number).toMatch(/^CRN-/);
    const after = await getInv(t.admin, inv.id);
    expect(after.amounts).toMatchObject({ credited: '25.00', balance: '175.00' });
    // frozen: editing or deleting an issued note is refused
    expect((await api.as(t.admin).patch(`/v2/credit-notes/${cn.id}`).send({ rowVersion: done.rowVersion, note: 'x' })).status).toBe(409);
    expect((await api.as(t.admin).delete(`/v2/credit-notes/${cn.id}`)).status).toBe(409);
    expect((await issueCn(t.admin, cn.id)).status).toBe(409);
  });

  it('credits can never add up to more than the invoice: the line quantity, the invoice total and the credit already given all cap', async () => {
    const inv = await issuedInvoice(t.admin);
    const over = await api.as(t.admin).post('/v2/credit-notes').send({ invoiceId: inv.id, reason: 'return', lines: [{ invoiceLineId: inv.lines[0]!.id, qty: '5' }] });
    expect(over.status).toBe(422);
    const big = await api.as(t.admin).post('/v2/credit-notes').send({ invoiceId: inv.id, reason: 'goodwill', lines: [{ description: 'Goodwill', amount: '999.00' }] });
    expect(big.status).toBe(422);
    expect(code(big)).toBe('CN_EXCEEDS_INVOICE');
    const first = await creditNote(t.admin, { invoiceId: inv.id, lines: [{ invoiceLineId: inv.lines[0]!.id, qty: '3' }] });
    await issueCn(t.admin, first.id);
    const rest = await api.as(t.admin).post('/v2/credit-notes').send({ invoiceId: inv.id, reason: 'return', lines: [{ invoiceLineId: inv.lines[0]!.id, qty: '2' }] });
    expect(rest.status).toBe(422); // one unit of that line is left
    const full = await creditNote(t.admin, { invoiceId: inv.id, full: true });
    expect(full.amounts.total).toBe('125.00'); // everything still creditable: 1 widget + the gadget
    await issueCn(t.admin, full.id);
    const after = await getInv(t.admin, inv.id);
    expect(after.amounts).toMatchObject({ credited: '200.00', balance: '0.00' });
    expect(after.paymentStatus).toBe('paid');
    const nothing = await api.as(t.admin).post('/v2/credit-notes').send({ invoiceId: inv.id, reason: 'return', full: true });
    expect(nothing.status).toBe(422);
    expect(code(nothing)).toBe('CN_NOTHING_TO_CREDIT');
  });

  it('two people issuing credit notes that together exceed the invoice at the same time: exactly one wins (the invoice row is locked)', async () => {
    const inv = await issuedInvoice(t.admin);
    const a = await creditNote(t.admin, { invoiceId: inv.id, full: true });
    // a second full draft cannot be made while the first only exists as a draft? It can (drafts do not reserve), so race the issues
    const b = await creditNote(t.admin, { invoiceId: inv.id, full: true });
    const [ra, rb] = await Promise.all([issueCn(t.admin, a.id), issueCn(t.admin, b.id)]);
    expect([ra.status, rb.status].sort()).toEqual([200, 422]);
    expect((await getInv(t.admin, inv.id)).amounts.credited).toBe('200.00');
  });

  it('a refund settlement returns the cash it must: the over-paid part, newest payment first, through the ledger (negative linked entries)', async () => {
    const inv = await issuedInvoice(t.admin);
    await payInv(t.admin, inv.id, '200');
    const cn = await creditNote(t.admin, { invoiceId: inv.id, settlement: 'refund', lines: [{ invoiceLineId: inv.lines[1]!.id }] });
    const done = (await issueCn(t.admin, cn.id)).body;
    expect(done.refunded).toBe('100.00');
    const after = await getInv(t.admin, inv.id);
    expect(after.amounts).toMatchObject({ paid: '100.00', refunded: '100.00', credited: '100.00', balance: '0.00' });
    expect(after.paymentStatus).toBe('paid');
    const ledger = (await api.as(t.admin).get(`/v2/payments?invoiceId=${inv.id}`)).body.data as Array<{ kind: string; amount: string }>;
    expect(ledger.filter((p) => p.kind === 'refund').map((p) => p.amount)).toEqual(['-100.00']);
    // cash went back: the note cannot be voided (the refund stands in the ledger)
    const v = await api.as(t.admin).post(`/v2/credit-notes/${cn.id}/void`).send({ reason: 'oops' });
    expect(v.status).toBe(409);
    expect(code(v)).toBe('CN_HAS_REFUND');
  });

  it('a balance settlement never moves cash; voiding it (no refund) gives the balance back; the invoice cannot be voided while credit notes stand', async () => {
    const inv = await issuedInvoice(t.admin);
    const cn = await creditNote(t.admin, { invoiceId: inv.id, lines: [{ invoiceLineId: inv.lines[1]!.id }] });
    const done = (await issueCn(t.admin, cn.id)).body;
    expect(done.refunded).toBe('0.00');
    const blocked = await api.as(t.admin).post(`/v2/invoices/${inv.id}/void`).send({ reason: 'x' });
    expect(blocked.status).toBe(409);
    expect(code(blocked)).toBe('INV_HAS_CREDITS');
    const v = await api.as(t.admin).post(`/v2/credit-notes/${cn.id}/void`).send({ reason: 'issued by mistake' });
    expect(v.status).toBe(200);
    expect(v.body.status).toBe('void');
    expect((await getInv(t.admin, inv.id)).amounts).toMatchObject({ credited: '0.00', balance: '200.00' });
    expect((await api.as(t.admin).post(`/v2/credit-notes/${cn.id}/void`).send({ reason: 'again' })).status).toBe(409);
  });

  it('a draft invoice cannot be credited; a draft note can be edited and deleted; the PDF renders; the list filters by invoice', async () => {
    const draft = await api.as(t.admin).post('/v2/invoices').send({ buyerName: 'D', lines: LINES });
    const r = await api.as(t.admin).post('/v2/credit-notes').send({ invoiceId: draft.body.id, reason: 'return', full: true });
    expect(r.status).toBe(409);
    expect(code(r)).toBe('INV_NOT_ISSUED');
    const inv = await issuedInvoice(t.admin);
    const cn = await creditNote(t.admin, { invoiceId: inv.id, lines: [{ invoiceLineId: inv.lines[0]!.id, qty: '1' }] });
    const edited = await api.as(t.admin).patch(`/v2/credit-notes/${cn.id}`).send({ rowVersion: cn.rowVersion, note: 'for the return', lines: [{ invoiceLineId: inv.lines[0]!.id, qty: '2' }] });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.amounts.total).toBe('50.00');
    const stale = await api.as(t.admin).patch(`/v2/credit-notes/${cn.id}`).send({ rowVersion: cn.rowVersion, note: 'x' });
    expect(stale.status).toBe(409);
    const pdf = await api.as(t.admin).get(`/v2/credit-notes/${cn.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const list = (await api.as(t.admin).get(`/v2/credit-notes?invoiceId=${inv.id}`)).body.data as Array<{ id: string }>;
    expect(list.map((x) => x.id)).toEqual([cn.id]);
    expect((await api.as(t.admin).delete(`/v2/credit-notes/${cn.id}`)).status).toBe(204);
    expect((await api.as(t.admin).get(`/v2/credit-notes/${cn.id}`)).status).toBe(404);
  });

  it('a free-form credit can carry a tax rate; a taxed line is credited with its own tax', async () => {
    const rate = (await api.as(t.admin).post('/v2/tax-rates').send({ name: 'VAT10', rate: '10' })).body;
    const inv = await issuedInvoice(t.admin, { lines: [{ description: 'Taxed', qty: '2', unitPrice: '50.00', taxRateId: rate.id }] });
    expect(inv.amounts.total).toBe('110.00');
    const part = await creditNote(t.admin, { invoiceId: inv.id, lines: [{ invoiceLineId: inv.lines[0]!.id, qty: '1' }] });
    expect(part.amounts).toMatchObject({ subtotal: '50.00', tax: '5.00', total: '55.00' });
    const free = await creditNote(t.admin, { invoiceId: inv.id, lines: [{ description: 'Late delivery', amount: '10.00', taxRateId: rate.id }] });
    expect(free.amounts).toMatchObject({ subtotal: '10.00', tax: '1.00', total: '11.00' });
  });

  it('permissions and scope: a reader reads but cannot create, issue or void; an own-scope reader does not see another person\'s credit notes (404)', async () => {
    const inv = await issuedInvoice(t.admin);
    const cn = await creditNote(t.admin, { invoiceId: inv.id, full: true });
    const reader = await api.member(t, 'cnreader', [['record.credit-notes.read']] as Grant[]);
    expect((await api.as(reader.token).get(`/v2/credit-notes/${cn.id}`)).status).toBe(200);
    expect((await api.as(reader.token).post('/v2/credit-notes').send({ invoiceId: inv.id, reason: 'return', full: true })).status).toBe(403);
    expect((await api.as(reader.token).post(`/v2/credit-notes/${cn.id}/issue`).send({})).status).toBe(403);
    expect((await api.as(reader.token).post(`/v2/credit-notes/${cn.id}/void`).send({ reason: 'x' })).status).toBe(403);
    const own = await api.member(t, 'cnown', [['record.credit-notes.read', 'own']] as Grant[]);
    expect((await api.as(own.token).get(`/v2/credit-notes/${cn.id}`)).status).toBe(404);
    expect(((await api.as(own.token).get('/v2/credit-notes')).body.data as unknown[]).length).toBe(0);
  });

  it('tenant isolation, audit and outbox: another workspace cannot see or credit it; the issue wrote one audit row and the credit_note.issued event in its transaction', async () => {
    const other = await api.signup('icn2');
    const inv = await issuedInvoice(t.admin);
    const cn = await creditNote(t.admin, { invoiceId: inv.id, full: true });
    expect((await api.as(other.admin).get(`/v2/credit-notes/${cn.id}`)).status).toBe(404);
    expect((await api.as(other.admin).post('/v2/credit-notes').send({ invoiceId: inv.id, reason: 'return', full: true })).status).toBe(404);
    const before = await api.auditCount(t.orgId, 'credit-notes', 'update');
    await issueCn(t.admin, cn.id);
    expect(await api.auditCount(t.orgId, 'credit-notes', 'update')).toBe(before + 1);
    expect((await api.events(t.orgId, 'credit_note.issued')).some((e) => e.uuid === cn.id)).toBe(true);
  });
});

describe('recurring invoices', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('irc');
  });

  const template = (over: Record<string, unknown> = {}) => ({
    currency: 'USD',
    buyerName: 'Retainer Co',
    buyerEmail: 'r@retainer.test',
    lines: [{ description: 'Retainer', qty: '1', unitPrice: '500.00', taxRateId: null }],
    ...over,
  });
  const create = async (body: Record<string, unknown>) => {
    const res = await api.as(t.admin).post('/v2/recurring-invoices').send({ name: 'Retainer', frequency: 'month', interval: 1, startDate: ymd(0), mode: 'issue', template: template(), ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: string; nextRunDate: string | null; status: string; runCount: number; rowVersion: number; upcoming: string[]; amount: string };
  };
  const runsOf = async (id: string) => (await api.as(t.admin).get(`/v2/recurring-invoices/${id}/runs`)).body.data as Array<{ periodIndex: number; status: string; invoice: { id: string; number: string | null } | null; error: string | null }>;

  it('a schedule is created with its next five dates and the amount the template prices to; a start date further back than 12 periods is refused', async () => {
    const r = await create({ startDate: ymd(5) });
    expect(r.amount).toBe('500.00');
    expect(r.upcoming).toHaveLength(5);
    expect(r.nextRunDate).toBe(ymd(5));
    const old = await api.as(t.admin).post('/v2/recurring-invoices').send({ name: 'Old', frequency: 'day', interval: 1, startDate: ymd(-60), template: template() });
    expect(old.status).toBe(422);
    expect(code(old)).toBe('REC_START_TOO_OLD');
    const empty = await api.as(t.admin).post('/v2/recurring-invoices').send({ name: 'x', frequency: 'month', startDate: ymd(0) });
    expect(empty.status).toBe(422);
  });

  it('the worker generates one invoice per due period, in order, issued and numbered; running it again (or twice at once) makes no second invoice for a period', async () => {
    const r = await create({ startDate: ymd(-2), frequency: 'day', mode: 'issue' });
    const made = await sweep.sweep();
    expect(made).toBeGreaterThanOrEqual(3); // today and the two days it missed
    const runs = await runsOf(r.id);
    expect(runs.map((x) => x.periodIndex)).toEqual([2, 1, 0]);
    expect(runs.every((x) => x.status === 'created' && x.invoice?.number)).toBe(true);
    const nums = runs.map((x) => x.invoice!.number);
    expect(new Set(nums).size).toBe(3);
    await Promise.all([sweep.sweep(), sweep.sweep()]);
    expect(await sqlN(`SELECT count(*)::int AS n FROM recurring_invoice_runs WHERE org_id = $1 AND recurring_id = (SELECT id FROM recurring_invoices WHERE uuid = $2)`, [t.orgId, r.id])).toBe(3);
    expect(await sqlN(`SELECT count(*)::int AS n FROM invoices WHERE org_id = $1 AND recurring_id = (SELECT id FROM recurring_invoices WHERE uuid = $2)`, [t.orgId, r.id])).toBe(3);
    const after = (await api.as(t.admin).get(`/v2/recurring-invoices/${r.id}`)).body;
    expect(after).toMatchObject({ runCount: 3, failureCount: 0, nextRunDate: ymd(1) });
    // each invoice carries its period's date as its issue date and links back to the schedule
    const inv = await getInv(t.admin, runs[2]!.invoice!.id);
    expect(['issued', 'overdue']).toContain(inv.status); // issued on its period date, so an old period is already past its due date
    // the invoice names its schedule, so the page can link back to it
    expect(inv.recurring).toEqual({ id: r.id, name: 'Retainer' });
    expect(inv.salesOrder).toBeNull();
  });

  it('draft mode leaves each generated invoice a draft; issue_send also raises invoice.sent', async () => {
    const d = await create({ startDate: ymd(0), mode: 'draft', name: 'Drafts' });
    const s = await create({ startDate: ymd(0), mode: 'issue_send', name: 'Sent' });
    await sweep.sweep();
    const dr = await runsOf(d.id);
    expect(dr).toHaveLength(1);
    expect((await getInv(t.admin, dr[0]!.invoice!.id)).status).toBe('draft');
    const sr = await runsOf(s.id);
    const sent = await getInv(t.admin, sr[0]!.invoice!.id);
    expect(sent.status).toBe('issued');
    expect((await api.events(t.orgId, 'invoice.sent')).some((e) => e.uuid === sent.id)).toBe(true);
  });

  it('run-now generates the next period ahead of its date; pause stops the worker; resume skips the periods that fell while paused', async () => {
    const r = await create({ startDate: ymd(3), frequency: 'day', name: 'Ahead' });
    const ran = await api.as(t.admin).post(`/v2/recurring-invoices/${r.id}/run`).send({});
    expect(ran.status, JSON.stringify(ran.body)).toBe(200);
    expect(ran.body).toMatchObject({ runCount: 1, nextRunDate: ymd(4) });
    const paused = await api.as(t.admin).post(`/v2/recurring-invoices/${r.id}/pause`).send({});
    expect(paused.body.status).toBe('paused');
    await h.owner.query(`UPDATE recurring_invoices SET next_run_date = $2 WHERE uuid = $1`, [r.id, ymd(-1)]);
    await sweep.sweep();
    expect(await runsOf(r.id)).toHaveLength(1); // paused: untouched
    const resumed = await api.as(t.admin).post(`/v2/recurring-invoices/${r.id}/resume`).send({});
    expect(resumed.body.status).toBe('active');
    expect(resumed.body.nextRunDate >= ymd(0)).toBe(true);
  });

  it('a period that cannot be generated is recorded as failed with the reason and the other schedules go on; the failure does not repeat the period', async () => {
    const rate = (await api.as(t.admin).post('/v2/tax-rates').send({ name: 'Gone', rate: '5' })).body;
    const r = await create({ startDate: ymd(0), name: 'Broken', template: template({ lines: [{ description: 'x', qty: '1', unitPrice: '10.00', taxRateId: rate.id }] }) });
    await h.owner.query(`UPDATE tax_rates SET is_active = false WHERE uuid = $1`, [rate.id]);
    const ok = await create({ startDate: ymd(0), name: 'Fine' });
    await sweep.sweep();
    const failed = await runsOf(r.id);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ status: 'failed', invoice: null });
    expect(failed[0]!.error).toBeTruthy();
    expect((await runsOf(ok.id))[0]!.status).toBe('created');
    const sched = (await api.as(t.admin).get(`/v2/recurring-invoices/${r.id}`)).body;
    expect(sched).toMatchObject({ failureCount: 1, runCount: 0 });
    await sweep.sweep();
    expect(await runsOf(r.id)).toHaveLength(1);
  });

  it('the end date and the run cap end the schedule; an ended schedule cannot be run, paused or resumed', async () => {
    const r = await create({ startDate: ymd(-1), frequency: 'day', maxRuns: 2, name: 'Capped' });
    await sweep.sweep();
    const s = (await api.as(t.admin).get(`/v2/recurring-invoices/${r.id}`)).body;
    expect(s).toMatchObject({ status: 'ended', runCount: 2, nextRunDate: null, upcoming: [] });
    expect((await api.as(t.admin).post(`/v2/recurring-invoices/${r.id}/run`).send({})).status).toBe(409);
    expect((await api.as(t.admin).post(`/v2/recurring-invoices/${r.id}/pause`).send({})).status).toBe(409);
    expect((await api.events(t.orgId, 'recurring_invoice.ended')).some((e) => e.uuid === r.id)).toBe(true);
  });

  it('an edit replaces the template for FUTURE invoices only; a copy from an existing invoice carries its lines; delete keeps the invoices already made', async () => {
    const r = await create({ startDate: ymd(0), name: 'Edit me' });
    await sweep.sweep();
    const first = (await runsOf(r.id))[0]!.invoice!.id;
    const current = (await api.as(t.admin).get(`/v2/recurring-invoices/${r.id}`)).body.rowVersion as number;
    const edited = await api.as(t.admin).patch(`/v2/recurring-invoices/${r.id}`).send({ rowVersion: current, template: template({ lines: [{ description: 'Retainer v2', qty: '1', unitPrice: '650.00', taxRateId: null }] }) });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.amount).toBe('650.00');
    expect((await getInv(t.admin, first)).amounts.total).toBe('500.00');
    const stale = await api.as(t.admin).patch(`/v2/recurring-invoices/${r.id}`).send({ rowVersion: current, name: 'x' });
    expect(stale.status).toBe(409);
    const base = await issuedInvoice(t.admin, { buyerName: 'Copy Co' });
    const copy = await api.as(t.admin).post('/v2/recurring-invoices').send({ name: 'From invoice', frequency: 'week', startDate: ymd(7), fromInvoiceId: base.id });
    expect(copy.status, JSON.stringify(copy.body)).toBe(201);
    expect(copy.body.amount).toBe('200.00');
    expect((await api.as(t.admin).delete(`/v2/recurring-invoices/${r.id}`)).status).toBe(204);
    expect((await getInv(t.admin, first)).status).toBe('issued');
    expect(await sqlN(`SELECT count(*)::int AS n FROM invoices WHERE org_id = $1 AND uuid = $2 AND recurring_id IS NULL`, [t.orgId, first])).toBe(1);
  });

  it('permissions, scope and tenant isolation', async () => {
    const r = await create({ startDate: ymd(9), name: 'Private' });
    const reader = await api.member(t, 'recreader', [['record.recurring-invoices.read']] as Grant[]);
    expect((await api.as(reader.token).get(`/v2/recurring-invoices/${r.id}`)).status).toBe(200);
    expect((await api.as(reader.token).post(`/v2/recurring-invoices/${r.id}/pause`).send({})).status).toBe(403);
    expect((await api.as(reader.token).delete(`/v2/recurring-invoices/${r.id}`)).status).toBe(403);
    const own = await api.member(t, 'recown', [['record.recurring-invoices.read', 'own']] as Grant[]);
    expect((await api.as(own.token).get(`/v2/recurring-invoices/${r.id}`)).status).toBe(404);
    const other = await api.signup('irc2');
    expect((await api.as(other.admin).get(`/v2/recurring-invoices/${r.id}`)).status).toBe(404);
    expect((await api.as(other.admin).post(`/v2/recurring-invoices/${r.id}/run`).send({})).status).toBe(404);
  });
});

describe('sales orders', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('iso');
  });

  const ORDER_LINES = [
    { description: 'Chair', qty: '10', unitPrice: '30.00', taxRateId: null },
    { description: 'Desk', qty: '2', unitPrice: '200.00', taxRateId: null },
  ];
  async function order(body: Record<string, unknown> = {}) {
    const res = await api.as(t.admin).post('/v2/sales-orders').send({ buyerName: 'Order Co', currency: 'USD', shipping: '10.00', lines: ORDER_LINES, ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as {
      id: string;
      number: string;
      status: string;
      rowVersion: number;
      invoicingStatus: string;
      fulfilmentStatus: string;
      amounts: Record<string, string>;
      lines: Array<{ id: string; qty: string; qtyInvoiced: string; qtyToInvoice: string; qtyFulfilled: string }>;
      invoices: Array<{ id: string }>;
    };
  }
  const confirm = (id: string) => api.as(t.admin).post(`/v2/sales-orders/${id}/confirm`).send({});
  const fetchOrder = async (id: string) => (await api.as(t.admin).get(`/v2/sales-orders/${id}`)).body as Awaited<ReturnType<typeof order>>;

  it('an order is a priced draft with its own SO number; only a confirmed one is invoiced or delivered; a confirmed order is frozen', async () => {
    const o = await order();
    expect(o).toMatchObject({ status: 'draft', invoicingStatus: 'not_invoiced', fulfilmentStatus: 'unfulfilled' });
    expect(o.number).toMatch(/^SO-/);
    expect(o.amounts).toMatchObject({ subtotal: '700.00', shipping: '10.00', total: '710.00' });
    const early = await api.as(t.admin).post(`/v2/sales-orders/${o.id}/invoice`).send({ all: true });
    expect(early.status).toBe(409);
    expect(code(early)).toBe('SO_NOT_CONFIRMED');
    expect((await api.as(t.admin).post(`/v2/sales-orders/${o.id}/fulfil`).send({ all: true })).status).toBe(409);
    const ed = await api.as(t.admin).patch(`/v2/sales-orders/${o.id}`).send({ rowVersion: o.rowVersion, notes: 'Deliver to dock 4' });
    expect(ed.status).toBe(200);
    expect((await confirm(o.id)).status).toBe(200);
    const frozen = await api.as(t.admin).patch(`/v2/sales-orders/${o.id}`).send({ rowVersion: ed.body.rowVersion + 1, notes: 'x' });
    expect(frozen.status).toBe(409);
    expect(code(frozen)).toBe('SO_NOT_DRAFT');
    expect((await api.as(t.admin).delete(`/v2/sales-orders/${o.id}`)).status).toBe(409);
    // the database refuses a price change on a confirmed order even around the API
    await expect(h.owner.query(`UPDATE sales_order_items SET unit_price_minor = 1 WHERE order_id = (SELECT id FROM sales_orders WHERE uuid = $1)`, [o.id])).rejects.toThrow(/frozen|check|violates/i);
  });

  it('partial invoicing: each invoice bills exactly the quantities named (shipping once, with the first), the order tracks what is left, and over-billing is refused', async () => {
    const o = await order();
    await confirm(o.id);
    const chair = o.lines[0]!.id;
    const first = await api.as(t.admin).post(`/v2/sales-orders/${o.id}/invoice`).send({ lines: [{ lineId: chair, qty: '4' }] });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.invoice).toMatchObject({ status: 'draft', source: 'sales_order' });
    // the invoice names its order, so the page can link to it (and the order's invoices link back)
    expect((await getInv(t.admin, first.body.invoice.id)).salesOrder).toEqual({ id: o.id, number: o.number });
    expect(first.body.invoice.amounts.total).toBe('130.00'); // 4 x 30.00 + 10.00 shipping
    expect(first.body.order.invoicingStatus).toBe('partially_invoiced');
    expect(first.body.order.lines[0]).toMatchObject({ qtyInvoiced: '4', qtyToInvoice: '6' });
    const over = await api.as(t.admin).post(`/v2/sales-orders/${o.id}/invoice`).send({ lines: [{ lineId: chair, qty: '7' }] });
    expect(over.status).toBe(422);
    expect(code(over)).toBe('SO_QUANTITY_EXCEEDS');
    const rest = await api.as(t.admin).post(`/v2/sales-orders/${o.id}/invoice`).send({ all: true, issue: true });
    expect(rest.status, JSON.stringify(rest.body)).toBe(200);
    expect(rest.body.invoice.amounts.total).toBe('580.00'); // 6 chairs + 2 desks, no second shipping charge
    expect(rest.body.invoice.status).toBe('issued');
    expect(rest.body.order.invoicingStatus).toBe('invoiced');
    expect(rest.body.order.invoices).toHaveLength(2);
    const none = await api.as(t.admin).post(`/v2/sales-orders/${o.id}/invoice`).send({ all: true });
    expect(none.status).toBe(422);
    expect(code(none)).toBe('SO_NOTHING_TO_INVOICE');
    // the two invoices add up to the order
    expect(Number(first.body.invoice.amounts.total) + Number(rest.body.invoice.amounts.total)).toBe(710);
  });

  it('voiding or deleting an order invoice gives its quantities (and shipping) back; the lines of such an invoice cannot be edited', async () => {
    const o = await order();
    await confirm(o.id);
    const a = await api.as(t.admin).post(`/v2/sales-orders/${o.id}/invoice`).send({ all: true, issue: true });
    const inv = a.body.invoice as { id: string; rowVersion: number };
    expect((await fetchOrder(o.id)).invoicingStatus).toBe('invoiced');
    expect((await api.as(t.admin).post(`/v2/invoices/${inv.id}/void`).send({ reason: 'wrong buyer' })).status).toBe(200);
    const back = await fetchOrder(o.id);
    expect(back.invoicingStatus).toBe('not_invoiced');
    expect(back.lines.map((l) => l.qtyToInvoice)).toEqual(['10', '2']);
    const d = await api.as(t.admin).post(`/v2/sales-orders/${o.id}/invoice`).send({ all: true });
    expect(d.status).toBe(200);
    expect(d.body.invoice.amounts.total).toBe('710.00'); // shipping is billable again
    const edit = await api.as(t.admin).patch(`/v2/invoices/${d.body.invoice.id}`).send({ rowVersion: d.body.invoice.rowVersion, lines: [{ description: 'x', unitPrice: '1' }] });
    expect(edit.status).toBe(409);
    expect(code(edit)).toBe('INV_ORDER_LINKED');
    expect((await api.as(t.admin).delete(`/v2/invoices/${d.body.invoice.id}`)).status).toBe(204);
    expect((await fetchOrder(o.id)).invoicingStatus).toBe('not_invoiced');
  });

  it('concurrent invoicing of the same line cannot bill it twice: the order lines are locked and the database caps the quantity', async () => {
    const o = await order({ shipping: null });
    await confirm(o.id);
    const chair = o.lines[0]!.id;
    const res = await Promise.all(
      [1, 2, 3].map(() => api.as(t.admin).post(`/v2/sales-orders/${o.id}/invoice`).send({ lines: [{ lineId: chair, qty: '6' }] })),
    );
    expect(res.map((r) => r.status).sort()).toEqual([200, 422, 422]);
    expect((await fetchOrder(o.id)).lines[0]!.qtyInvoiced).toBe('6');
  });

  it('fulfilment is independent of invoicing and capped at the ordered quantity; an order closes when everything is billed and delivered', async () => {
    const o = await order();
    await confirm(o.id);
    const chair = o.lines[0]!.id;
    const part = await api.as(t.admin).post(`/v2/sales-orders/${o.id}/fulfil`).send({ lines: [{ lineId: chair, qty: '3' }] });
    expect(part.status, JSON.stringify(part.body)).toBe(200);
    expect(part.body).toMatchObject({ fulfilmentStatus: 'partially_fulfilled', invoicingStatus: 'not_invoiced' });
    const over = await api.as(t.admin).post(`/v2/sales-orders/${o.id}/fulfil`).send({ lines: [{ lineId: chair, qty: '8' }] });
    expect(over.status).toBe(422);
    expect(code(over)).toBe('SO_QUANTITY_EXCEEDS');
    await api.as(t.admin).post(`/v2/sales-orders/${o.id}/fulfil`).send({ all: true });
    expect((await fetchOrder(o.id)).status).toBe('confirmed'); // delivered but not billed
    await api.as(t.admin).post(`/v2/sales-orders/${o.id}/invoice`).send({ all: true });
    const closed = await fetchOrder(o.id);
    expect(closed).toMatchObject({ status: 'closed', invoicingStatus: 'invoiced', fulfilmentStatus: 'fulfilled' });
  });

  it('cancel: refused while a live invoice exists; allowed once it is void; a cancelled order cannot be invoiced or reopened', async () => {
    const o = await order();
    await confirm(o.id);
    const a = await api.as(t.admin).post(`/v2/sales-orders/${o.id}/invoice`).send({ all: true, issue: true });
    const live = await api.as(t.admin).post(`/v2/sales-orders/${o.id}/cancel`).send({ reason: 'buyer left' });
    expect(live.status).toBe(409);
    expect(code(live)).toBe('SO_HAS_INVOICES');
    await api.as(t.admin).post(`/v2/invoices/${a.body.invoice.id}/void`).send({ reason: 'cancelled order' });
    const ok = await api.as(t.admin).post(`/v2/sales-orders/${o.id}/cancel`).send({ reason: 'buyer left' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ status: 'cancelled', cancelReason: 'buyer left' });
    const again = await api.as(t.admin).post(`/v2/sales-orders/${o.id}/invoice`).send({ all: true });
    expect(code(again)).toBe('SO_CANCELLED');
    await expect(h.owner.query(`UPDATE sales_orders SET status = 'confirmed' WHERE uuid = $1`, [o.id])).rejects.toThrow(/reopened|check|violates/i);
  });

  it('from an accepted estimate: one live order per offer, with the offer\'s lines, rates and folded discount; a draft offer is refused', async () => {
    const [cid] = await api.seedContacts(t, [{ name: 'Offer Buyer', email: 'o@buyer.test' }]);
    const body = {
      kind: 'estimate', contactId: cid, currency: 'USD', taxRate: '10', discount: { kind: 'amount', value: '10.00' },
      lines: [
        { description: 'A', qty: '1', unitPrice: '100.00' },
        { description: 'B', qty: '2', unitPrice: '50.00', taxRate: '0' },
      ],
    };
    const doc = await api.as(t.admin).post('/v2/sales-docs').send(body);
    expect(doc.status, JSON.stringify(doc.body)).toBe(201);
    const notYet = await api.as(t.admin).post('/v2/sales-orders').send({ quoteId: doc.body.id });
    expect(notYet.status).toBe(409);
    expect(code(notYet)).toBe('SO_QUOTE_NOT_ACCEPTED');
    await api.as(t.admin).post(`/v2/sales-docs/${doc.body.id}/accept`).send({});
    const so = await api.as(t.admin).post('/v2/sales-orders').send({ quoteId: doc.body.id });
    expect(so.status, JSON.stringify(so.body)).toBe(201);
    expect(so.body).toMatchObject({ buyerName: 'Offer Buyer', quote: { id: doc.body.id, kind: 'estimate' } });
    expect(so.body.lines).toHaveLength(2);
    expect(so.body.amounts.discount).toBe('10.00');
    const twice = await api.as(t.admin).post('/v2/sales-orders').send({ quoteId: doc.body.id });
    expect(twice.status).toBe(409);
    expect(code(twice)).toBe('SO_QUOTE_TAKEN');
    // cancelling frees the offer
    await api.as(t.admin).post(`/v2/sales-orders/${so.body.id}/cancel`).send({ reason: 'redo' });
    expect((await api.as(t.admin).post('/v2/sales-orders').send({ quoteId: doc.body.id })).status).toBe(201);
  });

  it('counts, filters, permissions, scope and tenant isolation', async () => {
    const o = await order({ buyerName: 'Filter Me' });
    await confirm(o.id);
    const counts = (await api.as(t.admin).get('/v2/sales-orders/counts')).body;
    expect(counts.confirmed).toBeGreaterThanOrEqual(1);
    expect(counts.toInvoice).toBeGreaterThanOrEqual(1);
    expect(counts.openValue[0]).toMatchObject({ currency: 'USD' });
    const f = (await api.as(t.admin).get('/v2/sales-orders?invoicingStatus=not_invoiced&q=Filter')).body.data as Array<{ id: string }>;
    expect(f.map((x) => x.id)).toContain(o.id);
    const reader = await api.member(t, 'soreader', [['record.sales-orders.read']] as Grant[]);
    expect((await api.as(reader.token).get(`/v2/sales-orders/${o.id}`)).status).toBe(200);
    expect((await api.as(reader.token).post(`/v2/sales-orders/${o.id}/invoice`).send({ all: true })).status).toBe(403);
    expect((await api.as(reader.token).post(`/v2/sales-orders/${o.id}/cancel`).send({ reason: 'x' })).status).toBe(403);
    const own = await api.member(t, 'soown', [['record.sales-orders.read', 'own']] as Grant[]);
    expect((await api.as(own.token).get(`/v2/sales-orders/${o.id}`)).status).toBe(404);
    const other = await api.signup('iso2');
    expect((await api.as(other.admin).get(`/v2/sales-orders/${o.id}`)).status).toBe(404);
    expect((await api.as(other.admin).post(`/v2/sales-orders/${o.id}/invoice`).send({ all: true })).status).toBe(404);
    expect((await api.events(t.orgId, 'sales_order.confirmed')).some((e) => e.uuid === o.id)).toBe(true);
  });
});
