import { sql as sqlTag } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MailError } from '../../../src/infra/providers/auth-registration-security/mail.port';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import { SalesDocsRepository } from '../../../src/modules/crm/sales-docs/sales-docs.repository';
import { SalesDocExpirySweepService } from '../../../src/modules/crm/sales-docs/sales-doc-expiry-sweep.service';
import { SalesDocsService } from '../../../src/modules/crm/sales-docs/sales-docs.service';
import type { SalesDocInvoicePort } from '../../../src/modules/crm/sales-docs/sales-doc-ports';
import {
  DealsApi,
  startHarness,
  uuidRe,
  type Grant,
  type Harness,
  type Tenant,
} from '../deals-pipelines/support';

/**
 * Proposals and estimates end to end through HTTP (TW-PROP-001..030, TW-EST-001..009): plan gate and permissions, numbering,
 * pricing, edit / duplicate / revise / extend, the status machine, sending, the buyer's public page (view, accept, decline, expiry,
 * link revoke and expiry, throttle), the expiry sweep, conversion to a deal and (through the port) to an invoice, and the audit,
 * outbox and tenant properties every write must have. One app, one database; each block works in organizations of its own.
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
const freshIp = () => `10.88.${Math.floor(ipN / 250)}.${ipN++ % 250}`;

interface Doc {
  id: string;
  kind: 'proposal' | 'estimate';
  number: string;
  status: string;
  title: string | null;
  buyer: { name: string | null; email: string | null; phone: string | null };
  buyerName: string | null;
  contact: { id: string; name: string | null } | null;
  company: { id: string; name: string } | null;
  deal: { id: string; title: string } | null;
  owner: { id: string; name: string } | null;
  currency: string;
  taxRate: string;
  discount: { kind: string; value: string } | null;
  totals: Record<string, string>;
  lines: Array<{
    position: number;
    description: string;
    qty: string;
    unitPrice: string;
    netMinor: string;
    taxMinor: string;
    taxRate: string | null;
    effectiveTaxRate: string;
  }>;
  notes: string | null;
  terms: string | null;
  validUntil: string | null;
  overdue: boolean;
  revision: number;
  rowVersion: number;
  link: { active: boolean; viewCount: number };
  actions: Record<string, boolean>;
  invoice: { id: string } | null;
  duplicatedFromId: string | null;
}

const ONE_LINE = [{ description: 'Consulting', qty: '2', unitPrice: '80' }];

async function make(token: string, body: Record<string, unknown> = {}): Promise<Doc> {
  const res = await api
    .as(token)
    .post('/v2/sales-docs')
    .send({ kind: 'proposal', lines: ONE_LINE, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Doc;
}
async function get(token: string, id: string): Promise<Doc> {
  const res = await api.as(token).get(`/v2/sales-docs/${id}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Doc;
}
async function linkOf(token: string, id: string): Promise<string> {
  const res = await api.as(token).get(`/v2/sales-docs/${id}/link`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.token as string;
}
async function sendLink(token: string, id: string): Promise<Doc> {
  const res = await api.as(token).post(`/v2/sales-docs/${id}/send`).send({ channel: 'link' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.document as Doc;
}
const pub = (path: string, method: 'get' | 'post' = 'get') =>
  api.http()[method](`/v2/public/sales-docs/${path}`).set('x-forwarded-for', freshIp());

const sqlN = async (sql: string, params: unknown[] = []) =>
  Number((await h.owner.query(sql, params)).rows[0].n);

const READER: Grant[] = [['record.sales-docs.read']];
const WORKER: Grant[] = [
  ['record.sales-docs.read', 'own'],
  ['record.sales-docs.create'],
  ['record.sales-docs.update', 'own'],
  ['record.sales-docs.send', 'own'],
  ['record.sales-docs.delete', 'own'],
];

describe('plan gate and permissions (TW-PROP-001, D-02)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('spg');
  });

  it('TW-PROP-001 #1: a workspace whose plan lacks the sales pipeline is refused with 422 PLAN_FEATURE_LOCKED (reads included), and the public link keeps working', async () => {
    const d = await sendLink(t.admin, (await make(t.admin)).id);
    const token = await linkOf(t.admin, d.id);
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"sales_pipeline":false}}' WHERE org_id = $1`,
      [t.orgId],
    );
    try {
      for (const path of [
        '/v2/sales-docs',
        '/v2/sales-docs/counts',
        `/v2/sales-docs/${d.id}`,
        '/v2/sales-docs/settings',
      ]) {
        const res = await api.as(t.admin).get(path);
        expect(res.status, path).toBe(422);
        expect(code(res), path).toBe('PLAN_FEATURE_LOCKED');
      }
      expect(
        (await api.as(t.admin).post('/v2/sales-docs').send({ kind: 'proposal', lines: ONE_LINE }))
          .status,
      ).toBe(422);
      // The buyer is not locked out because the seller's plan lapsed.
      expect((await pub(token)).status).toBe(200);
    } finally {
      await h.owner.query(`UPDATE org_plan_state SET overrides = '{}' WHERE org_id = $1`, [
        t.orgId,
      ]);
    }
  });

  it('D-02: a reader can read but not create, edit, send, decide, revise, convert, delete or change settings; no permission at all is 403', async () => {
    const reader = await api.member(t, 'sreader', READER);
    const d = await make(t.admin);
    expect((await api.as(reader.token).get('/v2/sales-docs')).status).toBe(200);
    expect((await api.as(reader.token).get(`/v2/sales-docs/${d.id}`)).status).toBe(200);
    expect((await api.as(reader.token).get(`/v2/sales-docs/${d.id}/events`)).status).toBe(200);
    expect((await api.as(reader.token).get(`/v2/sales-docs/${d.id}/print`)).status).toBe(200);
    const writes = await Promise.all([
      api.as(reader.token).post('/v2/sales-docs').send({ kind: 'proposal', lines: ONE_LINE }),
      api
        .as(reader.token)
        .patch(`/v2/sales-docs/${d.id}`)
        .send({ title: 'x', rowVersion: d.rowVersion }),
      api.as(reader.token).post(`/v2/sales-docs/${d.id}/send`).send({ channel: 'link' }),
      api.as(reader.token).post(`/v2/sales-docs/${d.id}/accept`).send({}),
      api.as(reader.token).post(`/v2/sales-docs/${d.id}/decline`).send({}),
      api.as(reader.token).post(`/v2/sales-docs/${d.id}/revise`).send({}),
      api.as(reader.token).post(`/v2/sales-docs/${d.id}/extend`).send({ validUntil: '2099-01-01' }),
      api.as(reader.token).post(`/v2/sales-docs/${d.id}/duplicate`).send({}),
      api.as(reader.token).get(`/v2/sales-docs/${d.id}/link`),
      api.as(reader.token).post(`/v2/sales-docs/${d.id}/link/revoke`).send({}),
      api.as(reader.token).post(`/v2/sales-docs/${d.id}/convert/deal`).send({}),
      api.as(reader.token).post(`/v2/sales-docs/${d.id}/convert/invoice`).send({}),
      api.as(reader.token).delete(`/v2/sales-docs/${d.id}`),
      api.as(reader.token).patch('/v2/sales-docs/settings').send({ estimatePrefix: 'QQ' }),
      api.as(reader.token).post('/v2/sales-docs/templates').send({ kind: 'proposal', name: 'T' }),
    ]);
    for (const res of writes) expect(res.status, res.text).toBe(403);
    expect((await get(t.admin, d.id)).status).toBe('draft');

    const nobody = await api.member(t, 'snobody', [['record.contacts.read']]);
    for (const path of ['/v2/sales-docs', '/v2/sales-docs/counts', '/v2/sales-docs/settings']) {
      expect((await api.as(nobody.token).get(path)).status, path).toBe(403);
    }
  });

  it('D-02: scope own is "owned by me or created by me"; an outside document is 404, never 403', async () => {
    const a = await api.member(t, 'sown-a', WORKER);
    const b = await api.member(t, 'sown-b', WORKER);
    const aUuid = await api.userUuid(a.userId);
    const bUuid = await api.userUuid(b.userId);
    const byA = await make(a.token, { title: 'by A' });
    const forB = await make(t.admin, { title: 'for B', ownerId: bUuid });
    const handed = await make(a.token, { title: 'A hands to B', ownerId: bUuid });
    const forA = await make(t.admin, { title: 'for A', ownerId: aUuid });

    const titles = async (token: string) =>
      ((await api.as(token).get('/v2/sales-docs?limit=100')).body.data as Doc[])
        .map((d) => d.title)
        .sort();
    expect(await titles(a.token)).toEqual(['A hands to B', 'by A', 'for A']);
    expect(await titles(b.token)).toEqual(['A hands to B', 'for B']);
    expect((await api.as(a.token).get(`/v2/sales-docs/${forB.id}`)).status).toBe(404);
    expect(
      (await api.as(a.token).patch(`/v2/sales-docs/${forB.id}`).send({ title: 'x', rowVersion: 1 }))
        .status,
    ).toBe(404);
    expect(
      (await api.as(a.token).post(`/v2/sales-docs/${forB.id}/send`).send({ channel: 'link' }))
        .status,
    ).toBe(404);
    expect((await api.as(a.token).delete(`/v2/sales-docs/${forB.id}`)).status).toBe(404);
    expect((await api.as(a.token).get(`/v2/sales-docs/${handed.id}`)).status).toBe(200);
    expect((await api.as(a.token).get(`/v2/sales-docs/${byA.id}`)).status).toBe(200);
    expect((await api.as(a.token).get(`/v2/sales-docs/${forA.id}`)).status).toBe(200);
    // counts follow the scope too
    expect((await api.as(a.token).get('/v2/sales-docs/counts')).body.total).toBe(3);
  });

  it('the Agent preset (sign-up) reads, edits and sends its own documents and creates new ones, but cannot convert, delete or change settings', async () => {
    const agent = await api.memberWithRole(t, 'sagent', 'Agent');
    const mine = await make(agent.token, { title: 'agent doc' });
    expect(
      (await api.as(agent.token).post(`/v2/sales-docs/${mine.id}/send`).send({ channel: 'link' }))
        .status,
    ).toBe(200);
    expect(
      (await api.as(agent.token).post(`/v2/sales-docs/${mine.id}/convert/deal`).send({})).status,
    ).toBe(403);
    expect((await api.as(agent.token).delete(`/v2/sales-docs/${mine.id}`)).status).toBe(403);
    expect(
      (await api.as(agent.token).patch('/v2/sales-docs/settings').send({ estimatePrefix: 'ZZ' }))
        .status,
    ).toBe(403);
    const adminDoc = await make(t.admin, { title: 'admin doc' });
    expect((await api.as(agent.token).get(`/v2/sales-docs/${adminDoc.id}`)).status).toBe(404);
  });

  it('tenant isolation: another workspace sees nothing and gets 404 for a known id, on documents, counts, events and the public token', async () => {
    const other = await api.signup('siso');
    const mine = await sendLink(t.admin, (await make(t.admin, { title: 'secret' })).id);
    expect((await api.as(other.admin).get(`/v2/sales-docs/${mine.id}`)).status).toBe(404);
    expect((await api.as(other.admin).get(`/v2/sales-docs/${mine.id}/events`)).status).toBe(404);
    expect(
      (await api.as(other.admin).post(`/v2/sales-docs/${mine.id}/accept`).send({})).status,
    ).toBe(404);
    expect((await api.as(other.admin).delete(`/v2/sales-docs/${mine.id}`)).status).toBe(404);
    expect((await api.as(other.admin).get('/v2/sales-docs')).body.data).toEqual([]);
    expect((await api.as(other.admin).get('/v2/sales-docs/counts')).body.total).toBe(0);
    // linking another workspace's contact is 404, not a silent drop
    const foreign = (await api.seedContacts(other, [{ name: 'Foreign' }]))[0]!;
    const res = await api
      .as(t.admin)
      .post('/v2/sales-docs')
      .send({ kind: 'proposal', lines: ONE_LINE, contactId: foreign });
    expect(res.status).toBe(404);
  });
});

describe('numbering (TW-PROP-008, TW-EST-003, D-06)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('snum');
  });

  it('TW-PROP-008 #1 / TW-EST-003 #1: proposals and estimates number independently from 0001, workspaces independently', async () => {
    const p1 = await make(t.admin);
    const p2 = await make(t.admin);
    const e1 = await make(t.admin, { kind: 'estimate' });
    expect([p1.number, p2.number, e1.number]).toEqual(['PRO-0001', 'PRO-0002', 'EST-0001']);
    expect(p1.kind).toBe('proposal');
    expect(e1.kind).toBe('estimate');
    const other = await api.signup('snum2');
    expect((await make(other.admin)).number).toBe('PRO-0001');
  });

  it('TW-PROP-008 #3 / D-06: deleting the newest document never frees its number', async () => {
    const x = await make(t.admin);
    const y = await make(t.admin);
    expect(y.number).not.toBe(x.number);
    expect((await api.as(t.admin).delete(`/v2/sales-docs/${y.id}`)).status).toBe(204);
    const z = await make(t.admin);
    const n = (d: Doc) => Number(d.number.split('-')[1]);
    expect(n(z)).toBe(n(y) + 1);
  });

  it('concurrent creations from one workspace get distinct, gapless numbers', async () => {
    const t2 = await api.signup('snumc');
    const made = await Promise.all(Array.from({ length: 12 }, () => make(t2.admin)));
    const numbers = made.map((d) => Number(d.number.split('-')[1])).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(
      await sqlN(`SELECT count(DISTINCT number)::int AS n FROM sales_docs WHERE org_id = $1`, [
        t2.orgId,
      ]),
    ).toBe(12);
  });

  it('the prefix, the padding and the starting number are configurable and shape only the next numbers', async () => {
    const t2 = await api.signup('snums');
    const first = await make(t2.admin);
    expect(first.number).toBe('PRO-0001');
    const s0 = await api.as(t2.admin).get('/v2/sales-docs/settings');
    expect(s0.body).toMatchObject({
      proposalPrefix: 'PRO',
      numberPadding: 4,
      proposalLast: 1,
      rowVersion: null,
    });
    const saved = await api.as(t2.admin).patch('/v2/sales-docs/settings').send({
      proposalPrefix: 'quo',
      estimatePrefix: 'est2',
      numberPadding: 6,
      estimateStart: 500,
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({
      proposalPrefix: 'QUO',
      estimatePrefix: 'EST2',
      numberPadding: 6,
      rowVersion: 1,
    });
    expect((await make(t2.admin)).number).toBe('QUO-000002');
    expect((await make(t2.admin, { kind: 'estimate' })).number).toBe('EST2-000500');
    expect((await get(t2.admin, first.id)).number).toBe('PRO-0001');
    // a stale or missing version is a conflict once the row exists
    const stale = await api
      .as(t2.admin)
      .patch('/v2/sales-docs/settings')
      .send({ numberPadding: 3 });
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
    expect(
      (
        await api
          .as(t2.admin)
          .patch('/v2/sales-docs/settings')
          .send({ numberPadding: 3, rowVersion: 1 })
      ).status,
    ).toBe(200);
    // invalid prefixes are 422
    expect(
      (
        await api
          .as(t2.admin)
          .patch('/v2/sales-docs/settings')
          .send({ proposalPrefix: 'a-b', rowVersion: 2 })
      ).status,
    ).toBe(422);
  });
});

describe('create, pricing and links (TW-PROP-005, 006, 025, D-01, D-03, D-12, D-14)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('scr');
  });

  it('TW-PROP-005 #1: a draft with a number, no internal ids and the totals of the one money function', async () => {
    const d = await make(t.admin, {
      title: 'Website',
      currency: 'USD',
      taxRate: '10',
      lines: [
        { description: 'Design', qty: '2', unitPrice: '15.50' },
        { description: 'Build', qty: '1', unitPrice: '9.99' },
      ],
    });
    expect(d.id).toMatch(uuidRe);
    expect(d).toMatchObject({
      status: 'draft',
      currency: 'USD',
      taxRate: '10',
      revision: 1,
      rowVersion: 1,
    });
    expect(d.totals).toMatchObject({
      subtotalMinor: '4099',
      taxMinor: '410',
      totalMinor: '4509',
      total: '45.09',
    });
    expect(d.lines.map((l) => [l.description, l.qty, l.unitPrice, l.netMinor])).toEqual([
      ['Design', '2', '15.50', '3100'],
      ['Build', '1', '9.99', '999'],
    ]);
    expect(d.actions).toMatchObject({ edit: true, send: true, revise: false });
    expect(JSON.stringify(d)).not.toMatch(/"(org_?id|public_?token|token)/i);
    expect((await get(t.admin, d.id)).totals.total).toBe('45.09');
  });

  it('TW-PROP-006: line discounts, a document discount and per-line tax compose; a zero-decimal currency keeps whole units', async () => {
    const d = await make(t.admin, {
      currency: 'USD',
      taxRate: '5',
      discount: { kind: 'percent', value: '10' },
      lines: [
        { description: 'A', qty: '1', unitPrice: '100', taxRate: '18' },
        { description: 'B', qty: '1', unitPrice: '100', discount: { kind: 'amount', value: '20' } },
      ],
    });
    // lines 100 + 80 = 180; discount 18 (10 / 8 by net share: 10, 8); tax 18% of 90 = 16.20, 5% of 72 = 3.60
    expect(d.totals).toMatchObject({
      subtotal: '180.00',
      discount: '18.00',
      tax: '19.80',
      total: '181.80',
    });
    const jpy = await make(t.admin, {
      currency: 'JPY',
      lines: [{ description: 'x', qty: '3', unitPrice: '1500' }],
    });
    expect(jpy.totals).toMatchObject({ totalMinor: '4500', total: '4500' });
  });

  it('TW-PROP-006 / D-10: an amount the currency or the math cannot hold is 422 SALESDOC_AMOUNT_INVALID with one detail per field, and nothing is written', async () => {
    const before = await sqlN(`SELECT count(*)::int AS n FROM sales_docs WHERE org_id = $1`, [
      t.orgId,
    ]);
    const counterBefore = await sqlN(
      `SELECT coalesce(max(last_seq),0)::int AS n FROM sales_doc_counters WHERE org_id = $1`,
      [t.orgId],
    );
    const res = await api
      .as(t.admin)
      .post('/v2/sales-docs')
      .send({
        kind: 'proposal',
        currency: 'JPY',
        taxRate: '100.5',
        lines: [{ description: 'x', qty: '1', unitPrice: '10.5' }],
      });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('SALESDOC_AMOUNT_INVALID');
    expect((res.body.errors as Array<{ path: string }>).map((e) => e.path).sort()).toEqual([
      'lines.0.unitPrice',
      'taxRate',
    ]);
    expect(
      await sqlN(`SELECT count(*)::int AS n FROM sales_docs WHERE org_id = $1`, [t.orgId]),
    ).toBe(before);
    // the number counter did not move (the whole transaction rolled back)
    expect(
      await sqlN(
        `SELECT coalesce(max(last_seq),0)::int AS n FROM sales_doc_counters WHERE org_id = $1`,
        [t.orgId],
      ),
    ).toBe(counterBefore);
  });

  it('TW-PROP-005 #2: shape errors are 422 VALIDATION_FAILED (no lines, a blank description, a negative price, a bad email or phone, a bad date)', async () => {
    const bad: Array<Record<string, unknown>> = [
      { kind: 'proposal', lines: [] },
      { kind: 'proposal' },
      { kind: 'bogus', lines: ONE_LINE },
      { kind: 'proposal', lines: [{ description: '   ', qty: '1', unitPrice: '1' }] },
      { kind: 'proposal', lines: [{ description: 'x', qty: '1', unitPrice: '-1' }] },
      { kind: 'proposal', lines: ONE_LINE, buyerEmail: 'not-an-email' },
      { kind: 'proposal', lines: ONE_LINE, buyerPhone: '12345' },
      { kind: 'proposal', lines: ONE_LINE, validUntil: 'tomorrow' },
      // parity run: shaped like a date but not a day (it used to reach the database and answer 500), a NUL character, a code that is
      // three letters but not ISO 4217
      { kind: 'proposal', lines: ONE_LINE, validUntil: '2026-02-31' },
      { kind: 'proposal', lines: ONE_LINE, validUntil: '2026-13-01' },
      { kind: 'proposal', lines: ONE_LINE, title: 'a\u0000b' },
      { kind: 'proposal', lines: [{ description: 'a\u0000b', qty: '1', unitPrice: '1' }] },
      { kind: 'proposal', lines: ONE_LINE, currency: 'ZZZ' },
      { kind: 'proposal', lines: ONE_LINE, notes: 'n'.repeat(5001) },
    ];
    for (const body of bad) {
      const res = await api.as(t.admin).post('/v2/sales-docs').send(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(code(res)).toBe('VALIDATION_FAILED');
    }
  });

  it('D-01 / TW-PROP-025: the buyer, the company and the phone come from the linked contact unless the body says otherwise; the contact and the deal are linked', async () => {
    const [contactId] = await api.seedContacts(t, [
      { name: 'Priya Nair', email: 'priya@acme.test', phone: '+919876543210' },
    ]);
    const deal = await api.deal(t.admin, { title: 'Acme deal', contactId });
    const d = await make(t.admin, { contactId, dealId: deal.id });
    expect(d.buyer).toEqual({
      name: 'Priya Nair',
      email: 'priya@acme.test',
      phone: '+919876543210',
    });
    expect(d.contact?.id).toBe(contactId);
    expect(d.deal?.id).toBe(deal.id);
    const override = await make(t.admin, {
      contactId,
      buyerName: 'Accounts team',
      buyerPhone: null,
    });
    expect(override.buyer).toEqual({
      name: 'Accounts team',
      email: 'priya@acme.test',
      phone: null,
    });
    // buyer fields are encrypted at rest
    const raw = (
      await h.owner.query(
        `SELECT buyer_name, buyer_email, buyer_phone, notes FROM sales_docs WHERE uuid = $1`,
        [d.id],
      )
    ).rows[0];
    expect(raw.buyer_name).not.toContain('Priya');
    expect(raw.buyer_email).not.toContain('acme');
    expect(raw.buyer_phone).not.toContain('9876');
  });

  it('D-14: an owner must be an active member of the workspace (422), omitted means the caller, null means nobody; a stranger deal or company is 404', async () => {
    const other = await api.signup('scro');
    const stranger = await api.userUuid(other.adminUserId);
    const res = await api
      .as(t.admin)
      .post('/v2/sales-docs')
      .send({ kind: 'proposal', lines: ONE_LINE, ownerId: stranger });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('SALESDOC_OWNER_INVALID');
    expect((await make(t.admin)).owner?.id).toBe(await api.userUuid(t.adminUserId));
    expect((await make(t.admin, { ownerId: null })).owner).toBeNull();
    const nope = '00000000-0000-4000-8000-000000000001';
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/sales-docs')
          .send({ kind: 'proposal', lines: ONE_LINE, dealId: nope })
      ).status,
    ).toBe(404);
    expect(
      (
        await api
          .as(t.admin)
          .post('/v2/sales-docs')
          .send({ kind: 'proposal', lines: ONE_LINE, companyId: nope })
      ).status,
    ).toBe(404);
  });

  it('D-12: the currency defaults to the workspace currency and can be chosen per document', async () => {
    const d = await make(t.admin);
    expect(d.currency).toMatch(/^[A-Z]{3}$/);
    expect((await make(t.admin, { currency: 'eur' })).currency).toBe('EUR');
  });

  it('the same Idempotency-Key replays the first answer and creates one document', async () => {
    const key = `sd-${Date.now()}`;
    const post = () =>
      api
        .as(t.admin)
        .post('/v2/sales-docs')
        .set('Idempotency-Key', key)
        .send({ kind: 'proposal', lines: ONE_LINE, title: 'once' });
    const [a, b] = [await post(), await post()];
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(
      await sqlN(`SELECT count(*)::int AS n FROM sales_docs WHERE org_id = $1 AND title = 'once'`, [
        t.orgId,
      ]),
    ).toBe(1);
  });

  it('templates: the default template of the kind supplies terms, notes and validity; named fields win; a name is unique per kind', async () => {
    const t2 = await api.signup('stpl');
    const tpl = await api.as(t2.admin).post('/v2/sales-docs/templates').send({
      kind: 'proposal',
      name: 'Standard',
      terms: 'Net 30',
      notes: 'Thanks!',
      validDays: 10,
      isDefault: true,
    });
    expect(tpl.status, JSON.stringify(tpl.body)).toBe(201);
    expect(tpl.body).toMatchObject({ kind: 'proposal', isDefault: true, validDays: 10 });
    const dup = await api
      .as(t2.admin)
      .post('/v2/sales-docs/templates')
      .send({ kind: 'proposal', name: 'standard' });
    expect(dup.status).toBe(409);
    expect(code(dup)).toBe('SALESDOC_TEMPLATE_NAME_TAKEN');
    const d = await make(t2.admin);
    expect(d).toMatchObject({ terms: 'Net 30', notes: 'Thanks!' });
    const today = new Date();
    expect(new Date(`${d.validUntil}T00:00:00Z`).getTime()).toBeGreaterThan(
      today.getTime() + 8 * 86_400_000,
    );
    const own = await make(t2.admin, { terms: 'Prepaid', validUntil: '2099-01-01' });
    expect(own).toMatchObject({ terms: 'Prepaid', notes: 'Thanks!', validUntil: '2099-01-01' });
    // an estimate does not get the proposal template
    expect(await make(t2.admin, { kind: 'estimate' })).toMatchObject({ terms: null });
    // a second default clears the first
    const second = await api
      .as(t2.admin)
      .post('/v2/sales-docs/templates')
      .send({ kind: 'proposal', name: 'Rush', isDefault: true });
    expect(second.body.isDefault).toBe(true);
    const list = (await api.as(t2.admin).get('/v2/sales-docs/templates?kind=proposal'))
      .body as Array<{ name: string; isDefault: boolean }>;
    expect(list.filter((x) => x.isDefault).map((x) => x.name)).toEqual(['Rush']);
    // edit with a version (the second default bumped the first one's), delete
    const current = (
      (await api.as(t2.admin).get('/v2/sales-docs/templates?kind=proposal')).body as Array<{
        id: string;
        rowVersion: number;
      }>
    ).find((x) => x.id === tpl.body.id)!;
    expect(current.rowVersion).toBeGreaterThan(tpl.body.rowVersion);
    const upd = await api
      .as(t2.admin)
      .patch(`/v2/sales-docs/templates/${tpl.body.id}`)
      .send({ name: 'Standard v2', rowVersion: current.rowVersion });
    expect(upd.status).toBe(200);
    expect(upd.body.name).toBe('Standard v2');
    expect(
      (
        await api
          .as(t2.admin)
          .patch(`/v2/sales-docs/templates/${tpl.body.id}`)
          .send({ name: 'x', rowVersion: 1 })
      ).status,
    ).toBe(409);
    expect((await api.as(t2.admin).delete(`/v2/sales-docs/templates/${tpl.body.id}`)).status).toBe(
      204,
    );
    expect((await get(t2.admin, d.id)).terms).toBe('Net 30');
  });
});

describe('edit, duplicate, revise, extend (TW-PROP-027, 029, D-05)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('sed');
  });

  it('TW-PROP-027 #1: a draft is edited whole (fields, pricing, lines) and the totals are recomputed; Reference could only change the status', async () => {
    const d = await make(t.admin, { title: 'Draft', taxRate: '10', currency: 'USD' });
    const upd = await api
      .as(t.admin)
      .patch(`/v2/sales-docs/${d.id}`)
      .send({
        title: 'Edited',
        notes: 'hello',
        terms: 'T&C',
        buyerName: 'Bo',
        buyerEmail: 'bo@x.test',
        validUntil: '2099-12-31',
        lines: [
          { description: 'One', qty: '1.5', unitPrice: '10' },
          { description: 'Two', qty: '1', unitPrice: '5.55' },
        ],
        rowVersion: d.rowVersion,
      });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    const u = upd.body as Doc;
    expect(u).toMatchObject({
      title: 'Edited',
      notes: 'hello',
      terms: 'T&C',
      validUntil: '2099-12-31',
      rowVersion: d.rowVersion + 1,
    });
    expect(u.buyer).toMatchObject({ name: 'Bo', email: 'bo@x.test' });
    expect(u.lines.map((l) => l.description)).toEqual(['One', 'Two']);
    // 15.00 + 5.55 = 20.55; tax 10% of each: 1.50 + 0.555 -> 0.56 = 2.06
    expect(u.totals).toMatchObject({ subtotal: '20.55', tax: '2.06', total: '22.61' });
    // a tax-rate-only edit reprices the lines it keeps
    const rate = await api
      .as(t.admin)
      .patch(`/v2/sales-docs/${d.id}`)
      .send({ taxRate: '0', rowVersion: u.rowVersion });
    expect(rate.body.totals).toMatchObject({ tax: '0.00', total: '20.55' });
    expect(rate.body.lines.map((l: { description: string }) => l.description)).toEqual([
      'One',
      'Two',
    ]);
    // null clears
    const cleared = await api
      .as(t.admin)
      .patch(`/v2/sales-docs/${d.id}`)
      .send({ notes: null, terms: null, validUntil: null, rowVersion: rate.body.rowVersion });
    expect(cleared.body).toMatchObject({ notes: null, terms: null, validUntil: null });
  });

  it('TW-PROP-027 / D-10: a stale rowVersion is 409 ROW_VERSION_CONFLICT; a new currency needs the lines in the same call', async () => {
    const d = await make(t.admin, { currency: 'USD' });
    const stale = await api
      .as(t.admin)
      .patch(`/v2/sales-docs/${d.id}`)
      .send({ title: 'x', rowVersion: d.rowVersion + 5 });
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
    const cur = await api
      .as(t.admin)
      .patch(`/v2/sales-docs/${d.id}`)
      .send({ currency: 'EUR', rowVersion: d.rowVersion });
    expect(cur.status).toBe(422);
    const ok = await api
      .as(t.admin)
      .patch(`/v2/sales-docs/${d.id}`)
      .send({ currency: 'EUR', lines: ONE_LINE, rowVersion: d.rowVersion });
    expect(ok.status).toBe(200);
    expect(ok.body.currency).toBe('EUR');
  });

  it('TW-PROP-027 #3: anything but a draft is not edited in place: 409 SALESDOC_NOT_EDITABLE', async () => {
    const d = await sendLink(t.admin, (await make(t.admin)).id);
    const res = await api
      .as(t.admin)
      .patch(`/v2/sales-docs/${d.id}`)
      .send({ title: 'x', rowVersion: d.rowVersion });
    expect(res.status).toBe(409);
    expect(code(res)).toBe('SALESDOC_NOT_EDITABLE');
  });

  it('TW-PROP-029: duplicate makes a new draft with a new number, a new link and the same lines, buyer and terms (optionally as the other kind), and the original is untouched', async () => {
    const d = await make(t.admin, {
      title: 'Original',
      terms: 'Terms',
      notes: 'Notes',
      buyerName: 'Bo',
      buyerEmail: 'bo@x.test',
      taxRate: '10',
    });
    const sent = await sendLink(t.admin, d.id);
    const res = await api.as(t.admin).post(`/v2/sales-docs/${d.id}/duplicate`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const c = res.body as Doc;
    expect(c).toMatchObject({
      status: 'draft',
      kind: 'proposal',
      title: 'Original',
      terms: 'Terms',
      notes: 'Notes',
      duplicatedFromId: d.id,
      revision: 1,
    });
    expect(c.number).not.toBe(d.number);
    expect(c.buyer.name).toBe('Bo');
    expect(c.totals.total).toBe(sent.totals.total);
    expect(await linkOf(t.admin, c.id)).not.toBe(await linkOf(t.admin, d.id));
    expect((await get(t.admin, d.id)).status).toBe('sent');
    const asEstimate = await api
      .as(t.admin)
      .post(`/v2/sales-docs/${d.id}/duplicate`)
      .send({ kind: 'estimate' });
    expect(asEstimate.body.kind).toBe('estimate');
    expect(asEstimate.body.number).toMatch(/^EST-/);
  });

  it('TW-PROP-029: revise takes a sent document back to a draft, keeps the earlier lines as a revision and raises the revision number; accepted documents are final', async () => {
    const d = await make(t.admin, {
      lines: [{ description: 'Old', qty: '1', unitPrice: '100' }],
      currency: 'USD',
    });
    await sendLink(t.admin, d.id);
    const res = await api.as(t.admin).post(`/v2/sales-docs/${d.id}/revise`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'draft', revision: 2 });
    const edited = await api
      .as(t.admin)
      .patch(`/v2/sales-docs/${d.id}`)
      .send({
        lines: [{ description: 'New', qty: '1', unitPrice: '150' }],
        rowVersion: res.body.rowVersion,
      });
    expect(edited.body.totals.total).toBe('150.00');
    const revs = (await api.as(t.admin).get(`/v2/sales-docs/${d.id}/revisions`)).body as Array<{
      revision: number;
      status: string;
      totalMinor: string;
    }>;
    expect(revs).toMatchObject([{ revision: 1, status: 'sent', totalMinor: '10000' }]);
    const one = await api.as(t.admin).get(`/v2/sales-docs/${d.id}/revisions/1`);
    expect(one.status).toBe(200);
    expect(one.body.snapshot.lines.map((l: { description: string }) => l.description)).toEqual([
      'Old',
    ]);
    expect((await api.as(t.admin).get(`/v2/sales-docs/${d.id}/revisions/9`)).status).toBe(404);
    // a draft cannot be revised; an accepted document cannot either
    expect((await api.as(t.admin).post(`/v2/sales-docs/${d.id}/revise`).send({})).status).toBe(409);
    await sendLink(t.admin, d.id);
    await api.as(t.admin).post(`/v2/sales-docs/${d.id}/accept`).send({});
    const refused = await api.as(t.admin).post(`/v2/sales-docs/${d.id}/revise`).send({});
    expect(refused.status).toBe(409);
    expect(code(refused)).toBe('SALESDOC_INVALID_TRANSITION');
  });

  it('D-05: extend gives an open or expired document a new date and reopens an expired one; a past date is 422', async () => {
    const d = await sendLink(t.admin, (await make(t.admin, { validUntil: '2099-01-01' })).id);
    expect(
      (
        await api
          .as(t.admin)
          .post(`/v2/sales-docs/${d.id}/extend`)
          .send({ validUntil: '2020-01-01' })
      ).status,
    ).toBe(422);
    const ext = await api
      .as(t.admin)
      .post(`/v2/sales-docs/${d.id}/extend`)
      .send({ validUntil: '2099-06-01' });
    expect(ext.body).toMatchObject({ status: 'sent', validUntil: '2099-06-01' });
    await h.owner.query(
      `UPDATE sales_docs SET status = 'expired', valid_until = '2020-01-01' WHERE uuid = $1`,
      [d.id],
    );
    const reopened = await api
      .as(t.admin)
      .post(`/v2/sales-docs/${d.id}/extend`)
      .send({ validUntil: '2099-07-01' });
    expect(reopened.body).toMatchObject({ status: 'sent', validUntil: '2099-07-01' });
    const draft = await make(t.admin);
    expect(
      (
        await api
          .as(t.admin)
          .post(`/v2/sales-docs/${draft.id}/extend`)
          .send({ validUntil: '2099-07-01' })
      ).status,
    ).toBe(409);
  });

  it('TW-PROP-013: draft, declined and expired documents can be deleted (audited, salesdoc.deleted); accepted and converted cannot', async () => {
    const d = await make(t.admin);
    const events = await sqlN(
      `SELECT count(*)::int AS n FROM event_outbox WHERE org_id = $1 AND event_type = 'salesdoc.deleted'`,
      [t.orgId],
    );
    expect((await api.as(t.admin).delete(`/v2/sales-docs/${d.id}`)).status).toBe(204);
    expect((await api.as(t.admin).get(`/v2/sales-docs/${d.id}`)).status).toBe(404);
    expect(
      await sqlN(
        `SELECT count(*)::int AS n FROM event_outbox WHERE org_id = $1 AND event_type = 'salesdoc.deleted'`,
        [t.orgId],
      ),
    ).toBe(events + 1);
    expect(await api.auditCount(t.orgId, 'sales_docs', 'delete')).toBeGreaterThanOrEqual(1);
    const acc = await make(t.admin);
    await api.as(t.admin).post(`/v2/sales-docs/${acc.id}/accept`).send({});
    const res = await api.as(t.admin).delete(`/v2/sales-docs/${acc.id}`);
    expect(res.status).toBe(409);
    expect(code(res)).toBe('SALESDOC_NOT_DELETABLE');
    expect((await get(t.admin, acc.id)).status).toBe('accepted');
  });
});

describe('list, filters, counts and the related lists (TW-PROP-003, 025, D-18)', () => {
  let t: Tenant;
  let contactA: string;
  let dealA: string;
  beforeAll(async () => {
    t = await api.signup('sls');
    [contactA] = await api.seedContacts(t, [{ name: 'Zelda Contact' }]);
    dealA = (await api.deal(t.admin, { title: 'Zelda deal', contactId: contactA })).id;
    await make(t.admin, { title: 'Alpha site', currency: 'USD' });
    await make(t.admin, {
      kind: 'estimate',
      title: 'Beta fix',
      currency: 'USD',
      contactId: contactA,
    });
    const sent = await sendLink(
      t.admin,
      (
        await make(t.admin, {
          title: 'Gamma build',
          currency: 'USD',
          dealId: dealA,
          lines: [{ description: 'x', qty: '1', unitPrice: '300' }],
        })
      ).id,
    );
    await api.as(t.admin).post(`/v2/sales-docs/${sent.id}/accept`).send({});
    await sendLink(
      t.admin,
      (
        await make(t.admin, {
          title: 'Delta eur',
          currency: 'EUR',
          lines: [{ description: 'x', qty: '1', unitPrice: '50' }],
        })
      ).id,
    );
  });

  it('TW-PROP-003: newest first, filters on kind, status (a list), text (number, title, contact name) and valid-until', async () => {
    const titles = async (qs: string) =>
      ((await api.as(t.admin).get(`/v2/sales-docs?${qs}`)).body.data as Doc[]).map((d) => d.title);
    expect(await titles('')).toEqual(['Delta eur', 'Gamma build', 'Beta fix', 'Alpha site']);
    expect(await titles('kind=estimate')).toEqual(['Beta fix']);
    expect(await titles('status=accepted')).toEqual(['Gamma build']);
    expect((await titles('status=draft,sent')).sort()).toEqual([
      'Alpha site',
      'Beta fix',
      'Delta eur',
    ]);
    expect(await titles('q=gamma')).toEqual(['Gamma build']);
    expect(await titles('q=PRO-0001')).toEqual(['Alpha site']);
    // a document named for a deal takes the deal's contact, so Zelda's contact has two
    expect(await titles('q=zelda')).toEqual(['Gamma build', 'Beta fix']);
    expect(await titles('q=%25')).toEqual([]);
    expect(await titles('currency=EUR')).toEqual(['Delta eur']);
    expect(await titles('mine=true')).toHaveLength(4);
    expect((await api.as(t.admin).get('/v2/sales-docs?status=bogus')).status).toBe(422);
  });

  it('TW-PROP-022: the valid-until window filter (the calendar reads it) is inclusive', async () => {
    await h.owner.query(
      `UPDATE sales_docs SET valid_until = '2099-03-15' WHERE org_id = $1 AND title = 'Alpha site'`,
      [t.orgId],
    );
    const hit = async (qs: string) =>
      ((await api.as(t.admin).get(`/v2/sales-docs?${qs}`)).body.data as Doc[]).map((d) => d.title);
    expect(await hit('validFrom=2099-03-15&validTo=2099-03-15')).toEqual(['Alpha site']);
    expect(await hit('validFrom=2099-03-16&validTo=2099-04-01')).toEqual([]);
  });

  it('TW-PROP-003: the cursor is a microsecond keyset: pages never repeat or skip, even for documents created in the same millisecond', async () => {
    const t2 = await api.signup('scur');
    const org = t2.orgId;
    for (let i = 0; i < 7; i++) {
      await h.owner.query(
        `INSERT INTO sales_docs (org_id, doc_type, number, seq, created_at) VALUES ($1,'proposal',$2,$3, '2026-10-01 10:00:00.123456+00'::timestamptz + ($4 || ' microseconds')::interval)`,
        [org, `T-${i}`, i + 1, String(i % 2)],
      );
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const res = await api
        .as(t2.admin)
        .get(`/v2/sales-docs?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      for (const d of res.body.data as Doc[]) seen.push(d.number);
      cursor = res.body.page.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect((await api.as(t2.admin).get('/v2/sales-docs?cursor=garbage')).status).toBe(400);
  });

  it('TW-PROP-003 / D-18: counts per status and the open value per currency (sent, viewed, accepted-not-converted)', async () => {
    const res = await api.as(t.admin).get('/v2/sales-docs/counts');
    expect(res.status).toBe(200);
    expect(res.body.byStatus).toEqual({
      draft: 2,
      sent: 1,
      viewed: 0,
      accepted: 1,
      declined: 0,
      expired: 0,
      converted: 0,
    });
    expect(res.body.total).toBe(4);
    expect(res.body.openValue).toEqual([
      { currency: 'EUR', amount: '50.00' },
      { currency: 'USD', amount: '300.00' },
    ]);
    const est = await api.as(t.admin).get('/v2/sales-docs/counts?kind=estimate');
    expect(est.body.total).toBe(1);
  });

  it("TW-PROP-025: a contact's and a deal's documents, behind the permission on the document AND on the contact or deal", async () => {
    const forContact = (await api.as(t.admin).get(`/v2/contacts/${contactA}/sales-docs`)).body
      .data as Doc[];
    expect(forContact.map((d) => d.title)).toEqual(['Gamma build', 'Beta fix']);
    const forDeal = (await api.as(t.admin).get(`/v2/deals/${dealA}/sales-docs`)).body.data as Doc[];
    expect(forDeal.map((d) => d.title)).toEqual(['Gamma build']);
    const noContacts = await api.member(t, 'snoc', [['record.sales-docs.read']]);
    expect((await api.as(noContacts.token).get(`/v2/contacts/${contactA}/sales-docs`)).status).toBe(
      403,
    );
    expect((await api.as(noContacts.token).get(`/v2/deals/${dealA}/sales-docs`)).status).toBe(403);
    const nope = '00000000-0000-4000-8000-000000000002';
    expect((await api.as(t.admin).get(`/v2/contacts/${nope}/sales-docs`)).status).toBe(404);
    expect((await api.as(t.admin).get(`/v2/deals/${nope}/sales-docs`)).status).toBe(404);
    // linked-record filters
    expect(
      ((await api.as(t.admin).get(`/v2/sales-docs?contactId=${contactA}`)).body.data as Doc[]).map(
        (d) => d.title,
      ),
    ).toEqual(['Gamma build', 'Beta fix']);
    expect((await api.as(t.admin).get(`/v2/sales-docs?dealId=${nope}`)).body.data as Doc[]).toEqual(
      [],
    );
  });
});

describe('sending (TW-PROP-011, D-08)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ssn');
  });

  it('TW-PROP-011 #1: link marks a draft sent (stamp, timeline, salesdoc.sent) and returns the share link', async () => {
    const d = await make(t.admin, { title: 'Link send' });
    const res = await api.as(t.admin).post(`/v2/sales-docs/${d.id}/send`).send({ channel: 'link' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.document).toMatchObject({ status: 'sent' });
    expect(res.body.delivery).toEqual({ channel: 'link', status: 'shared', to: null });
    expect(res.body.link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.body.link.path).toBe(`/q/${res.body.link.token}`);
    expect(res.body.link.url).toBe(`http://localhost:3001/q/${res.body.link.token}`);
    expect(res.body.link.active).toBe(true);
    const row = (
      await h.owner.query(`SELECT sent_at, status FROM sales_docs WHERE uuid = $1`, [d.id])
    ).rows[0];
    expect(row.status).toBe('sent');
    expect(row.sent_at).not.toBeNull();
    const ev = (await api.events(t.orgId, 'salesdoc.sent')).find((e) => e.uuid === d.id);
    expect(ev).toMatchObject({ channel: 'link', number: d.number });
    expect(JSON.stringify(ev)).not.toContain(res.body.link.token);
  });

  it('TW-PROP-011: email mails the buyer the link (subject, total, validity) and marks the document sent; the timeline masks the address', async () => {
    const d = await make(t.admin, {
      title: 'Mail me',
      currency: 'USD',
      buyerName: 'Priya',
      buyerEmail: 'priya@buyer.test',
      validUntil: '2099-01-31',
    });
    const before = h.mail.length;
    const res = await api
      .as(t.admin)
      .post(`/v2/sales-docs/${d.id}/send`)
      .send({ channel: 'email', message: 'Looking forward to it' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.delivery).toEqual({ channel: 'email', status: 'sent', to: 'pr***@buyer.test' });
    const mail = h.mail.slice(before);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ to: 'priya@buyer.test' });
    expect(mail[0]!.subject).toContain(d.number);
    expect(mail[0]!.text).toContain(`http://localhost:3001/q/${res.body.link.token}`);
    expect(mail[0]!.text).toContain('Looking forward to it');
    expect(mail[0]!.text).toContain('USD 160.00');
    expect(mail[0]!.text).toContain('2099-01-31');
    const events = (await api.as(t.admin).get(`/v2/sales-docs/${d.id}/events`)).body.data as Array<{
      type: string;
      channel: string | null;
      meta: Record<string, unknown>;
    }>;
    const sent = events.find((e) => e.type === 'sent')!;
    expect(sent.channel).toBe('email');
    expect(JSON.stringify(sent)).not.toContain('priya@buyer.test');
  });

  it('TW-PROP-011 / D-01: no recipient is 422 SALESDOC_NO_RECIPIENT and nothing changes; an override address works', async () => {
    const d = await make(t.admin, { title: 'No buyer' });
    const before = h.mail.length;
    const res = await api
      .as(t.admin)
      .post(`/v2/sales-docs/${d.id}/send`)
      .send({ channel: 'email' });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('SALESDOC_NO_RECIPIENT');
    expect(
      (await api.as(t.admin).post(`/v2/sales-docs/${d.id}/send`).send({ channel: 'whatsapp' }))
        .status,
    ).toBe(422);
    expect(
      (
        await api
          .as(t.admin)
          .post(`/v2/sales-docs/${d.id}/send`)
          .send({ channel: 'email', to: 'nope' })
      ).status,
    ).toBe(422);
    expect(h.mail.length).toBe(before);
    expect((await get(t.admin, d.id)).status).toBe('draft');
    const ok = await api
      .as(t.admin)
      .post(`/v2/sales-docs/${d.id}/send`)
      .send({ channel: 'email', to: 'other@buyer.test' });
    expect(ok.status).toBe(200);
    expect(h.mail.at(-1)!.to).toBe('other@buyer.test');
  });

  it('D-08: a failing mail transport is 502 SALESDOC_SEND_FAILED and the document stays a draft', async () => {
    const svc = h.app.get(SalesDocsService) as unknown as {
      mail: { send: (m: unknown) => Promise<void> };
    };
    const real = svc.mail;
    svc.mail = {
      send: async () => {
        throw new MailError('connection_refused', 'down');
      },
    };
    try {
      const d = await make(t.admin, { buyerEmail: 'x@buyer.test' });
      const res = await api
        .as(t.admin)
        .post(`/v2/sales-docs/${d.id}/send`)
        .send({ channel: 'email' });
      expect(res.status).toBe(502);
      expect(code(res)).toBe('SALESDOC_SEND_FAILED');
      expect(res.body.errors).toEqual([{ path: 'channel', message: 'connection_refused' }]);
      expect((await get(t.admin, d.id)).status).toBe('draft');
      expect(
        await sqlN(
          `SELECT count(*)::int AS n FROM sales_doc_events WHERE doc_id = (SELECT id FROM sales_docs WHERE uuid = $1) AND type = 'sent'`,
          [d.id],
        ),
      ).toBe(0);
    } finally {
      svc.mail = real;
    }
  });

  it('TW-PROP-011: whatsapp marks the document sent and emits salesdoc.delivery_requested for the messaging side (no buyer detail in the event)', async () => {
    const d = await make(t.admin, { title: 'WA', buyerPhone: '+919876543210' });
    const res = await api
      .as(t.admin)
      .post(`/v2/sales-docs/${d.id}/send`)
      .send({ channel: 'whatsapp' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.delivery).toMatchObject({ channel: 'whatsapp', status: 'queued' });
    const ev = (await api.events(t.orgId, 'salesdoc.delivery_requested')).find(
      (e) => e.uuid === d.id,
    );
    expect(ev).toMatchObject({ channel: 'whatsapp' });
    expect(JSON.stringify(ev)).not.toContain('9876');
  });

  it('TW-PROP-011 #4: a sent document can be re-sent (status kept); accepted, declined and expired ones cannot be sent', async () => {
    const d = await sendLink(t.admin, (await make(t.admin)).id);
    const again = await api
      .as(t.admin)
      .post(`/v2/sales-docs/${d.id}/send`)
      .send({ channel: 'link' });
    expect(again.body.document.status).toBe('sent');
    await api.as(t.admin).post(`/v2/sales-docs/${d.id}/accept`).send({});
    const res = await api.as(t.admin).post(`/v2/sales-docs/${d.id}/send`).send({ channel: 'link' });
    expect(res.status).toBe(409);
    expect(code(res)).toBe('SALESDOC_INVALID_TRANSITION');
  });
});

describe("the buyer's public page (TW-PROP-014..016, 018, D-04, D-05, D-11, D-16)", () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('spb');
  });

  async function open(over: Record<string, unknown> = {}) {
    const d = await make(t.admin, {
      title: 'Public one',
      buyerName: 'Priya',
      buyerEmail: 'priya@buyer.test',
      buyerPhone: '+919876543210',
      notes: 'Private notes',
      terms: 'Net 30',
      currency: 'USD',
      taxRate: '10',
      ...over,
    });
    await sendLink(t.admin, d.id);
    return { id: d.id, token: await linkOf(t.admin, d.id) };
  }

  it("TW-PROP-014 #1 / D-16: the page shows the document without the buyer's email or phone, with the privacy headers; the number and totals are there", async () => {
    const { token } = await open();
    const res = await pub(token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'proposal',
      status: 'viewed',
      canDecide: true,
      blockedReason: null,
      decision: null,
      notes: 'Private notes',
      terms: 'Net 30',
      currency: 'USD',
    });
    expect(res.body.buyer).toEqual({ name: 'Priya', company: null });
    expect(res.body.seller.name).toBeTruthy();
    expect(res.body.totals.total).toBe('176.00');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('priya@buyer.test');
    expect(body).not.toContain('9876');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('D-04: the first open of a sent document marks it viewed once (timeline, salesdoc.viewed, first_viewed_at); later opens only count', async () => {
    const { id, token } = await open();
    expect((await get(t.admin, id)).status).toBe('sent');
    await pub(token);
    await pub(token);
    await pub(token);
    const d = await get(t.admin, id);
    expect(d.status).toBe('viewed');
    expect(d.link.viewCount).toBe(3);
    const events = (await api.as(t.admin).get(`/v2/sales-docs/${id}/events`)).body.data as Array<{
      type: string;
      actor: { kind: string };
      ip: string | null;
    }>;
    expect(events.filter((e) => e.type === 'viewed')).toHaveLength(1);
    expect(events.find((e) => e.type === 'viewed')).toMatchObject({ actor: { kind: 'buyer' } });
    expect(
      (await api.events(t.orgId, 'salesdoc.viewed')).filter((e) => e.uuid === id),
    ).toHaveLength(1);
  });

  it('TW-PROP-009: an unknown, a malformed and a draft token are all 404; the page of one workspace is not reachable with the token of nothing', async () => {
    expect((await pub('A'.repeat(43))).status).toBe(404);
    expect((await pub('short')).status).toBe(404);
    expect((await pub('../../etc/passwd')).status).toBe(404);
    const d = await make(t.admin);
    const token = await linkOf(t.admin, d.id);
    const res = await pub(token);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    // the token is stored hashed: the plaintext is nowhere in the row (only an encrypted copy for staff)
    const raw = (
      await h.owner.query(
        `SELECT public_token_hash, public_token_cipher FROM sales_docs WHERE uuid = $1`,
        [d.id],
      )
    ).rows[0];
    expect(raw.public_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(raw.public_token_hash).not.toContain(token);
    expect(raw.public_token_cipher).not.toContain(token);
  });

  it('TW-PROP-015 / D-11: accept records the signer, signature, IP, user agent and time; the page then shows the decision and no buttons', async () => {
    const { id, token } = await open();
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const res = await pub(`${token}/accept`, 'post').set('user-agent', 'TestBrowser/1.0').send({
      signerName: 'Priya Nair',
      signerEmail: 'priya@buyer.test',
      signature: png,
      comment: 'Go ahead',
      consent: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'accepted', replay: false });
    const d = await get(t.admin, id);
    expect(d.status).toBe('accepted');
    const events = (await api.as(t.admin).get(`/v2/sales-docs/${id}/events`)).body.data as Array<
      Record<string, unknown>
    >;
    const acc = events.find((e) => e.type === 'accepted')!;
    expect(acc).toMatchObject({
      actor: { kind: 'buyer', user: null },
      fromStatus: 'sent',
      toStatus: 'accepted',
      signerName: 'Priya Nair',
      signerEmail: 'priya@buyer.test',
      comment: 'Go ahead',
      hasSignature: true,
      userAgent: 'TestBrowser/1.0',
      revision: 1,
    });
    expect(acc.ip).toBeTruthy();
    const one = await api.as(t.admin).get(`/v2/sales-docs/${id}/events/${acc.id}`);
    expect(one.body.signature).toBe(png);
    // encrypted at rest
    const raw = (
      await h.owner.query(
        `SELECT signer_name, signer_email, signature, comment FROM sales_doc_events WHERE uuid = $1`,
        [acc.id],
      )
    ).rows[0];
    for (const v of Object.values(raw)) expect(String(v)).not.toMatch(/Priya|png|Go ahead/);
    const page = await pub(token);
    expect(page.body).toMatchObject({ status: 'accepted', canDecide: false });
    expect(page.body.decision).toMatchObject({ status: 'accepted', signerName: 'Priya Nair' });
    expect(
      (await api.events(t.orgId, 'salesdoc.accepted')).find((e) => e.uuid === id),
    ).toMatchObject({ by: 'buyer', number: d.number });
    expect(
      await sqlN(
        `SELECT count(*)::int AS n FROM sales_docs WHERE uuid = $1 AND accepted_revision = 1 AND decided_at IS NOT NULL`,
        [id],
      ),
    ).toBe(1);
  });

  it('TW-PROP-015 #2: the same decision again is the same answer (replay, one event); the opposite decision is 409 SALESDOC_ALREADY_DECIDED', async () => {
    const { id, token } = await open();
    const first = await pub(`${token}/accept`, 'post').send({ signerName: 'Priya', consent: true });
    const again = await pub(`${token}/accept`, 'post').send({ signerName: 'Priya', consent: true });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({
      status: 'accepted',
      replay: true,
      decidedAt: first.body.decidedAt,
    });
    const decline = await pub(`${token}/decline`, 'post').send({});
    expect(decline.status).toBe(409);
    expect(code(decline)).toBe('SALESDOC_ALREADY_DECIDED');
    expect(
      (await api.events(t.orgId, 'salesdoc.accepted')).filter((e) => e.uuid === id),
    ).toHaveLength(1);
    expect(
      await sqlN(
        `SELECT count(*)::int AS n FROM sales_doc_events WHERE doc_id = (SELECT id FROM sales_docs WHERE uuid = $1) AND type = 'accepted'`,
        [id],
      ),
    ).toBe(1);
  });

  it('TW-PROP-015: accepting needs the signer name (2 to 120 characters) and the consent flag; a bad signature is rejected; nothing changes', async () => {
    const { id, token } = await open();
    const bad: Array<Record<string, unknown>> = [
      {},
      { signerName: 'P', consent: true },
      { signerName: 'Priya' },
      { signerName: 'Priya', consent: false },
      { signerName: 'Priya', consent: true, signerEmail: 'nope' },
      { signerName: 'Priya', consent: true, signature: 'data:text/html;base64,PHNjcmlwdD4=' },
      {
        signerName: 'Priya',
        consent: true,
        signature: `data:image/png;base64,${'A'.repeat(60_001)}`,
      },
    ];
    for (const body of bad) {
      const res = await pub(`${token}/accept`, 'post').send(body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(422);
    }
    expect((await get(t.admin, id)).status).toBe('sent');
  });

  it('TW-PROP-016: decline records the reason and the signer; the opposite is then final; a decline replays', async () => {
    const { id, token } = await open();
    const res = await pub(`${token}/decline`, 'post').send({
      signerName: 'Priya',
      reason: 'Too expensive',
    });
    expect(res.body).toMatchObject({ status: 'declined', replay: false });
    expect((await pub(`${token}/decline`, 'post').send({})).body.replay).toBe(true);
    const accept = await pub(`${token}/accept`, 'post').send({
      signerName: 'Priya',
      consent: true,
    });
    expect(accept.status).toBe(409);
    expect(code(accept)).toBe('SALESDOC_ALREADY_DECIDED');
    const events = (await api.as(t.admin).get(`/v2/sales-docs/${id}/events`)).body.data as Array<
      Record<string, unknown>
    >;
    expect(events.find((e) => e.type === 'declined')).toMatchObject({
      actor: { kind: 'buyer' },
      comment: 'Too expensive',
      toStatus: 'declined',
    });
    expect((await get(t.admin, id)).status).toBe('declined');
    expect(
      (await api.events(t.orgId, 'salesdoc.declined')).find((e) => e.uuid === id),
    ).toMatchObject({ by: 'buyer' });
  });

  it('D-05: past its valid-until date the page reads expired and accepting or declining is 409 SALESDOC_EXPIRED, even before the sweep has run', async () => {
    const { id, token } = await open({ validUntil: '2099-01-01' });
    await h.owner.query(`UPDATE sales_docs SET valid_until = '2020-01-01' WHERE uuid = $1`, [id]);
    const page = await pub(token);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({
      status: 'expired',
      canDecide: false,
      blockedReason: 'expired',
    });
    for (const [path, body] of [
      ['accept', { signerName: 'Priya', consent: true }],
      ['decline', {}],
    ] as const) {
      const res = await pub(`${token}/${path}`, 'post').send(body);
      expect(res.status, path).toBe(409);
      expect(code(res), path).toBe('SALESDOC_EXPIRED');
    }
    expect(['sent', 'viewed']).toContain((await get(t.admin, id)).status);
    expect((await get(t.admin, id)).overdue).toBe(true);
    // staff cannot accept a lapsed price on the buyer's behalf either, and the document does not offer the action
    const staff = await api.as(t.admin).post(`/v2/sales-docs/${id}/accept`).send({});
    expect(staff.status).toBe(409);
    expect(code(staff)).toBe('SALESDOC_EXPIRED');
    expect((await get(t.admin, id)).actions).toMatchObject({
      decide: false,
      extend: true,
      revise: true,
    });
  });

  it('D-16: a revoked link is 410 SALESDOC_LINK_UNAVAILABLE until a new one is made; the old token stays dead; sending again revives a link', async () => {
    const { id, token } = await open();
    expect(
      (await api.as(t.admin).post(`/v2/sales-docs/${id}/link/revoke`).send({})).body.revokedAt,
    ).toBeTruthy();
    const res = await pub(token);
    expect(res.status).toBe(410);
    expect(code(res)).toBe('SALESDOC_LINK_UNAVAILABLE');
    expect(
      (await pub(`${token}/accept`, 'post').send({ signerName: 'Priya', consent: true })).status,
    ).toBe(410);
    expect((await get(t.admin, id)).link.active).toBe(false);
    const fresh = await api.as(t.admin).post(`/v2/sales-docs/${id}/link/regenerate`).send({});
    expect(fresh.status).toBe(200);
    expect(fresh.body.token).not.toBe(token);
    expect(fresh.body.active).toBe(true);
    expect((await pub(token)).status).toBe(404);
    expect((await pub(fresh.body.token)).status).toBe(200);
    // send again after a revoke: the link is made live again with a new token
    await api.as(t.admin).post(`/v2/sales-docs/${id}/link/revoke`).send({});
    const resent = await api
      .as(t.admin)
      .post(`/v2/sales-docs/${id}/send`)
      .send({ channel: 'link' });
    expect(resent.body.link.active).toBe(true);
    expect((await pub(resent.body.link.token)).status).toBe(200);
  });

  it('D-16: a link with its own expiry stops working when it passes; the workspace link lifetime applies to documents sent afterwards', async () => {
    const { id, token } = await open();
    const short = await api
      .as(t.admin)
      .post(`/v2/sales-docs/${id}/link/regenerate`)
      .send({ expiresInDays: 1 });
    expect(short.body.expiresAt).toBeTruthy();
    expect((await pub(short.body.token)).status).toBe(200);
    await h.owner.query(
      `UPDATE sales_docs SET token_expires_at = now() - interval '1 minute' WHERE uuid = $1`,
      [id],
    );
    const gone = await pub(short.body.token);
    expect(gone.status).toBe(410);
    expect(code(gone)).toBe('SALESDOC_LINK_UNAVAILABLE');
    void token;
    const t2 = await api.signup('sttl');
    expect(
      (await api.as(t2.admin).patch('/v2/sales-docs/settings').send({ linkTtlDays: 7 })).status,
    ).toBe(200);
    const d = await make(t2.admin);
    const sent = await api
      .as(t2.admin)
      .post(`/v2/sales-docs/${d.id}/send`)
      .send({ channel: 'link' });
    const exp = new Date(sent.body.link.expiresAt).getTime();
    expect(exp).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect(exp).toBeLessThan(Date.now() + 8 * 86_400_000);
  });

  it('TW-PROP-018: the public routes are throttled per link (decisions) with 429 RATE_LIMITED, and answer 404 before any database work for a junk token', async () => {
    const token = 'T'.repeat(43);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push(
        (await pub(`${token}/accept`, 'post').send({ signerName: 'Priya', consent: true })).status,
      );
    }
    expect(statuses.slice(0, 10).every((s) => s === 404)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    const limited = await pub(`${token}/accept`, 'post').send({
      signerName: 'Priya',
      consent: true,
    });
    expect(code(limited)).toBe('RATE_LIMITED');
  });

  it("TW-PROP-030: the print page is escaped HTML with no script, for the buyer and for staff; the buyer's one is not counted as a view", async () => {
    const { id, token } = await open({ title: '<script>x</script>', notes: '<b>bold</b>' });
    const page = await pub(`${token}/print`);
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");
    expect(page.text).toContain('&lt;script&gt;');
    expect(page.text).not.toContain('<script>');
    expect(page.text).not.toContain('priya@buyer.test');
    expect((await get(t.admin, id)).link.viewCount).toBe(0);
    const staff = await api.as(t.admin).get(`/v2/sales-docs/${id}/print`);
    expect(staff.status).toBe(200);
    expect(staff.text).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(staff.headers['cache-control']).toBe('no-store');
  });
});

describe('staff decisions and the status machine (TW-PROP-010, D-15)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ssm');
  });

  it('TW-PROP-010: staff can record an acceptance or a decline from draft, sent or viewed, in the timeline as theirs with the note; the stamps are set', async () => {
    const d = await sendLink(t.admin, (await make(t.admin)).id);
    const res = await api
      .as(t.admin)
      .post(`/v2/sales-docs/${d.id}/accept`)
      .send({ note: 'Signed copy by email' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'accepted' });
    const events = (await api.as(t.admin).get(`/v2/sales-docs/${d.id}/events`)).body.data as Array<
      Record<string, unknown>
    >;
    expect(events.find((e) => e.type === 'accepted')).toMatchObject({
      actor: { kind: 'user' },
      comment: 'Signed copy by email',
      meta: { recordedByStaff: true },
    });
    const declined = await make(t.admin);
    const dec = await api.as(t.admin).post(`/v2/sales-docs/${declined.id}/decline`).send({});
    expect(dec.body.status).toBe('declined');
    // staff decisions notify like buyer ones (D-15): the event carries who decided
    expect(
      (await api.events(t.orgId, 'salesdoc.accepted')).find((e) => e.uuid === d.id),
    ).toMatchObject({ by: 'staff' });
  });

  it('D-15: the machine refuses what Reference allowed (accept after decline, a decided document sent again or accepted twice) with 409 SALESDOC_INVALID_TRANSITION', async () => {
    const d = await make(t.admin);
    await api.as(t.admin).post(`/v2/sales-docs/${d.id}/decline`).send({});
    for (const [path, body] of [
      ['accept', {}],
      ['decline', {}],
      ['send', { channel: 'link' }],
      ['extend', { validUntil: '2099-01-01' }],
    ] as const) {
      const res = await api.as(t.admin).post(`/v2/sales-docs/${d.id}/${path}`).send(body);
      expect(res.status, path).toBe(409);
      expect(code(res), path).toBe('SALESDOC_INVALID_TRANSITION');
    }
    // a declined document can be revised back to a draft and decided again
    expect((await api.as(t.admin).post(`/v2/sales-docs/${d.id}/revise`).send({})).body.status).toBe(
      'draft',
    );
    expect((await get(t.admin, d.id)).actions).toMatchObject({ edit: true, revise: false });
  });

  it('every write leaves one timeline row, one audit row and one outbox event in the same transaction; a failed write leaves none', async () => {
    const t2 = await api.signup('saud');
    const count = async () => ({
      events: await sqlN(`SELECT count(*)::int AS n FROM sales_doc_events WHERE org_id = $1`, [
        t2.orgId,
      ]),
      audit: await sqlN(
        `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'sales_docs'`,
        [t2.orgId],
      ),
      outbox: await sqlN(
        `SELECT count(*)::int AS n FROM event_outbox WHERE org_id = $1 AND aggregate_module = 'sales_docs'`,
        [t2.orgId],
      ),
    });
    const base = await count();
    const d = await make(t2.admin);
    expect(await count()).toEqual({
      events: base.events + 1,
      audit: base.audit + 1,
      outbox: base.outbox + 1,
    });
    const mid = await count();
    await api.as(t2.admin).post(`/v2/sales-docs/${d.id}/accept`).send({});
    await api.as(t2.admin).post(`/v2/sales-docs/${d.id}/accept`).send({});
    expect(await count()).toEqual({
      events: mid.events + 1,
      audit: mid.audit + 1,
      outbox: mid.outbox + 1,
    });
    const bad = await api
      .as(t2.admin)
      .patch(`/v2/sales-docs/${d.id}`)
      .send({ title: 'x', rowVersion: 99 });
    expect(bad.status).toBe(409);
    expect((await count()).events).toBe(mid.events + 1);
  });
});

/** The sweep lives in the worker module, not in the HTTP app: build it from the same providers the worker would give it. */
const newSweep = () =>
  new SalesDocExpirySweepService(
    h.app.get(DatabaseService),
    h.app.get(OutboxService),
    h.app.get(SalesDocsRepository),
  );

describe('the expiry sweep (TW-PROP-004, D-05)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('ssw');
  });

  it('TW-PROP-004 #1: sent and viewed documents past their date become expired without anyone listing them (timeline, audit, salesdoc.expired once); drafts, decided and future ones are left alone', async () => {
    const mk = async (title: string, over: Record<string, unknown> = {}) =>
      (await make(t.admin, { title, validUntil: '2099-01-01', ...over })).id;
    const sentOld = await sendLink(t.admin, await mk('sent old'));
    const viewedOld = await sendLink(t.admin, await mk('viewed old'));
    await pub(await linkOf(t.admin, viewedOld.id));
    const draftOld = await mk('draft old');
    const acceptedOld = await mk('accepted old');
    await api.as(t.admin).post(`/v2/sales-docs/${acceptedOld}/accept`).send({});
    const future = await sendLink(t.admin, await mk('future'));
    const noDate = await sendLink(t.admin, await mk('no date', { validUntil: null }));
    await h.owner.query(
      `UPDATE sales_docs SET valid_until = '2020-01-01' WHERE uuid = ANY($1::uuid[])`,
      [[sentOld.id, viewedOld.id, draftOld, acceptedOld]],
    );

    const sweep = newSweep();
    const n = await sweep.sweep();
    // the sweep spans every workspace (other blocks leave lapsed documents behind): this one's two are in the count
    expect(n).toBeGreaterThanOrEqual(2);
    expect(await sweep.sweep()).toBe(0);
    const status = async (id: string) => (await get(t.admin, id)).status;
    expect(await status(sentOld.id)).toBe('expired');
    expect(await status(viewedOld.id)).toBe('expired');
    expect(await status(draftOld)).toBe('draft');
    expect(await status(acceptedOld)).toBe('accepted');
    expect(await status(future.id)).toBe('sent');
    expect(await status(noDate.id)).toBe('sent');
    const events = (await api.as(t.admin).get(`/v2/sales-docs/${viewedOld.id}/events`)).body
      .data as Array<Record<string, unknown>>;
    expect(events.find((e) => e.type === 'expired')).toMatchObject({
      actor: { kind: 'system' },
      fromStatus: 'viewed',
      toStatus: 'expired',
    });
    const out = (await api.events(t.orgId, 'salesdoc.expired')).filter((e) =>
      [sentOld.id, viewedOld.id].includes(e.uuid as string),
    );
    expect(out).toHaveLength(2);
    expect(await api.auditCount(t.orgId, 'sales_docs', 'update')).toBeGreaterThanOrEqual(2);
    // the buyer's page reads expired, and extending brings it back
    const page = await pub(await linkOf(t.admin, sentOld.id));
    expect(page.body).toMatchObject({ status: 'expired', canDecide: false });
    const ext = await api
      .as(t.admin)
      .post(`/v2/sales-docs/${viewedOld.id}/extend`)
      .send({ validUntil: '2099-02-02' });
    expect(ext.body.status).toBe('viewed');
  });

  it('TW-PROP-004: a document is valid through the whole of its valid-until day in the workspace time zone', async () => {
    const t2 = await api.signup('sswz');
    await h.owner.query(
      `UPDATE organizations SET settings = settings || '{"timezone":"Pacific/Kiritimati"}'::jsonb WHERE id = $1`,
      [t2.orgId],
    );
    const d = await sendLink(t2.admin, (await make(t2.admin, { validUntil: '2099-01-01' })).id);
    // Kiritimati is UTC+14: when it is already tomorrow there, a UTC clock still says today.
    const now = new Date();
    const utcToday = now.toISOString().slice(0, 10);
    const kiriToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati' }).format(
      now,
    );
    await h.owner.query(`UPDATE sales_docs SET valid_until = $2 WHERE uuid = $1`, [d.id, utcToday]);
    const sweep = newSweep();
    await sweep.sweep(now);
    expect((await get(t2.admin, d.id)).status).toBe(kiriToday > utcToday ? 'expired' : 'sent');
  });
});

describe('conversion (TW-PROP-012, 025, D-07, D-09)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('scv');
  });

  it("TW-PROP-025 / D-07: convert to deal creates a deal with the document's title, total, currency, contact and owner, links it, and refuses a second one", async () => {
    const [contactId] = await api.seedContacts(t, [{ name: 'Priya Nair' }]);
    const d = await make(t.admin, {
      title: 'Big job',
      contactId,
      currency: 'USD',
      lines: [{ description: 'x', qty: '1', unitPrice: '1250.50' }],
    });
    const res = await api.as(t.admin).post(`/v2/sales-docs/${d.id}/convert/deal`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.document.deal.id).toBe(res.body.deal.id);
    const deal = await api.as(t.admin).get(`/v2/deals/${res.body.deal.id}`);
    expect(deal.body).toMatchObject({
      title: `${d.number} Big job`,
      value: '1250.50',
      currency: 'USD',
      status: 'open',
    });
    expect(deal.body.contact?.id).toBe(contactId);
    expect(deal.body.owner?.id).toBe(await api.userUuid(t.adminUserId));
    expect(deal.body.stage).toBeTruthy();
    const again = await api.as(t.admin).post(`/v2/sales-docs/${d.id}/convert/deal`).send({});
    expect(again.status).toBe(409);
    expect(code(again)).toBe('SALESDOC_ALREADY_LINKED_DEAL');
    expect(
      (await api.events(t.orgId, 'salesdoc.converted')).find((e) => e.uuid === d.id),
    ).toMatchObject({ to: 'deal', dealId: res.body.deal.id });
    expect(
      (await api.events(t.orgId, 'deal.created')).some((e) => e.uuid === res.body.deal.id),
    ).toBe(true);
    // a stage from another pipeline is refused like on the deals API
    const other = await make(t.admin);
    const bad = await api
      .as(t.admin)
      .post(`/v2/sales-docs/${other.id}/convert/deal`)
      .send({ stageId: '00000000-0000-4000-8000-000000000003' });
    expect(bad.status).toBe(404);
  });

  const port = () =>
    h.app.get(SalesDocsService) as unknown as { invoicing: SalesDocInvoicePort | undefined };

  it('TW-PROP-012 / D-09: with no invoicing module bound the conversion is 501 SALESDOC_INVOICING_UNAVAILABLE and nothing changes', async () => {
    const real = port().invoicing;
    port().invoicing = undefined;
    try {
      const d = await make(t.admin);
      await api.as(t.admin).post(`/v2/sales-docs/${d.id}/accept`).send({});
      const res = await api.as(t.admin).post(`/v2/sales-docs/${d.id}/convert/invoice`).send({});
      expect(res.status).toBe(501);
      expect(code(res)).toBe('SALESDOC_INVOICING_UNAVAILABLE');
      expect((await get(t.admin, d.id)).status).toBe('accepted');
    } finally {
      port().invoicing = real;
    }
  });

  it('TW-PROP-012 / TW-EST-006: through the real invoicing module the accepted document becomes a draft invoice linked both ways, with the totals the buyer accepted', async () => {
    expect(port().invoicing).toBeDefined();
    const d = await make(t.admin, {
      kind: 'estimate',
      currency: 'USD',
      taxRate: '10',
      lines: [
        { description: 'a', qty: '2', unitPrice: '15.50' },
        { description: 'b', qty: '1', unitPrice: '9.99', taxRate: '0' },
      ],
    });
    await api.as(t.admin).post(`/v2/sales-docs/${d.id}/accept`).send({});
    const res = await api.as(t.admin).post(`/v2/sales-docs/${d.id}/convert/invoice`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('converted');
    const inv = (
      await h.owner.query(
        `SELECT i.uuid, i.quote_id, i.total_minor::text AS total, s.id AS doc_id, s.invoice_id, s.total_minor::text AS doc_total
           FROM sales_docs s JOIN invoices i ON i.org_id = s.org_id AND i.id = s.invoice_id WHERE s.uuid = $1`,
        [d.id],
      )
    ).rows[0];
    expect(inv.uuid).toBe(res.body.invoice.id);
    expect(Number(inv.quote_id)).toBe(Number(inv.doc_id));
    expect(inv.total).toBe(inv.doc_total);
    const again = await api.as(t.admin).post(`/v2/sales-docs/${d.id}/convert/invoice`).send({});
    expect(again.status).toBe(409);
    expect(code(again)).toBe('SALESDOC_ALREADY_CONVERTED');
  });

  describe('through the invoicing port', () => {
    const svc = port;
    let original: SalesDocInvoicePort | undefined;
    const received: Array<{
      idempotencyKey: string;
      lines: number;
      total: bigint;
      buyerEmail: string | null;
      dealId: number | null;
    }> = [];
    let fail = false;
    const fake: SalesDocInvoicePort = {
      async createDraftFromSalesDoc(tx, source) {
        received.push({
          idempotencyKey: source.idempotencyKey,
          lines: source.lines.length,
          total: source.totals.totalMinor,
          buyerEmail: source.buyer.email,
          dealId: source.dealId,
        });
        if (fail) throw new Error('invoicing exploded');
        const n = received.length;
        const res = await tx.execute(
          // A minimal real invoice row, so the document's foreign key (org_id, invoice_id) and the invoice's (org_id, quote_id) are
          // exercised. Only the grand total is used (subtotal = total, no discount or tax): whatever shape the invoicing module gives
          // its totals check, "total = subtotal" holds.
          sqlTag`INSERT INTO invoices (org_id, source, quote_id, currency, subtotal_minor, total_minor)
                 VALUES (${source.orgId}, 'quote', ${source.salesDocId}, ${source.currency},
                         ${source.totals.totalMinor.toString()}::bigint, ${source.totals.totalMinor.toString()}::bigint)
                 RETURNING id, uuid`,
        );
        const row = res.rows[0] as { id: number | string; uuid: string };
        return { invoiceId: Number(row.id), invoiceUuid: row.uuid, invoiceNumber: `S-${n}` };
      },
    };
    beforeAll(() => {
      original = svc().invoicing;
      svc().invoicing = fake;
    });
    afterAll(() => {
      svc().invoicing = original;
    });

    it('an accepted document becomes an invoice draft in one transaction: the document is converted, linked, timelined and announced; twice is 409 SALESDOC_ALREADY_CONVERTED', async () => {
      const [contactId] = await api.seedContacts(t, [
        { name: 'Invoice Contact', email: 'inv@buyer.test' },
      ]);
      const d = await make(t.admin, {
        contactId,
        taxRate: '10',
        lines: [
          { description: 'a', qty: '1', unitPrice: '100' },
          { description: 'b', qty: '2', unitPrice: '50' },
        ],
      });
      await api.as(t.admin).post(`/v2/sales-docs/${d.id}/accept`).send({});
      const res = await api.as(t.admin).post(`/v2/sales-docs/${d.id}/convert/invoice`).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ status: 'converted' });
      expect(res.body.invoice.id).toMatch(uuidRe);
      expect(received.at(-1)).toMatchObject({
        idempotencyKey: `salesdoc:${d.id}:invoice`,
        lines: 2,
        total: 22000n,
        buyerEmail: 'inv@buyer.test',
      });
      expect(
        await sqlN(
          `SELECT count(*)::int AS n FROM sales_docs s JOIN invoices i ON i.org_id = s.org_id AND i.id = s.invoice_id WHERE s.uuid = $1`,
          [d.id],
        ),
      ).toBe(1);
      expect(
        (await api.events(t.orgId, 'salesdoc.converted')).find(
          (e) => e.uuid === d.id && e.to === 'invoice',
        ),
      ).toMatchObject({ invoiceId: res.body.invoice.id });
      const again = await api.as(t.admin).post(`/v2/sales-docs/${d.id}/convert/invoice`).send({});
      expect(again.status).toBe(409);
      expect(code(again)).toBe('SALESDOC_ALREADY_CONVERTED');
      // a converted document is evidence: no edit, revise, delete or decision
      expect((await api.as(t.admin).delete(`/v2/sales-docs/${d.id}`)).status).toBe(409);
      expect((await api.as(t.admin).post(`/v2/sales-docs/${d.id}/revise`).send({})).status).toBe(
        409,
      );
      expect((await api.as(t.admin).post(`/v2/sales-docs/${d.id}/decline`).send({})).status).toBe(
        409,
      );
      const counts = (await api.as(t.admin).get('/v2/sales-docs/counts')).body.byStatus;
      expect(counts.converted).toBeGreaterThanOrEqual(1);
    });

    it('D-09: only an accepted document converts (409 SALESDOC_INVALID_TRANSITION), and a failure inside the port rolls the whole conversion back', async () => {
      const draft = await make(t.admin);
      const refused = await api
        .as(t.admin)
        .post(`/v2/sales-docs/${draft.id}/convert/invoice`)
        .send({});
      expect(refused.status).toBe(409);
      expect(code(refused)).toBe('SALESDOC_INVALID_TRANSITION');
      const d = await make(t.admin);
      await api.as(t.admin).post(`/v2/sales-docs/${d.id}/accept`).send({});
      const invoices = await sqlN(`SELECT count(*)::int AS n FROM invoices WHERE org_id = $1`, [
        t.orgId,
      ]);
      fail = true;
      try {
        const res = await api.as(t.admin).post(`/v2/sales-docs/${d.id}/convert/invoice`).send({});
        expect(res.status).toBe(500);
      } finally {
        fail = false;
      }
      expect((await get(t.admin, d.id)).status).toBe('accepted');
      expect(
        await sqlN(`SELECT count(*)::int AS n FROM invoices WHERE org_id = $1`, [t.orgId]),
      ).toBe(invoices);
      const ok = await api.as(t.admin).post(`/v2/sales-docs/${d.id}/convert/invoice`).send({});
      expect(ok.status).toBe(200);
    });
  });
});
