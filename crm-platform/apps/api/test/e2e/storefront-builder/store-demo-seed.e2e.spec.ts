import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The harness first: it loads the app graph in the order the application itself does (a domain barrel first hits an import cycle).
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * The store demo seed on real Postgres: it fills one workspace through the real write paths (contact links, sales orders, receipts and
 * invoices, the payment ledger), a second run adds nothing, `--reset` removes exactly what it made and leaves the workspace's own rows,
 * a re-seed works, and another workspace is never touched.
 */
process.env.STORE_PROVIDER_MODE = 'fixture';

let h: Harness;
let api: Api;
let seeder: typeof import('../../../src/modules/storefront-builder/cli/demo-seeder');
let a: Tenant;
let b: Tenant;
let target: Awaited<ReturnType<typeof seeder.resolveTarget>>;
const own = { contacts: [] as string[], orderUuid: '' };

const q = async (sql: string, params: unknown[] = []) => (await h.owner.query(sql, params)).rows;
const n = async (sql: string, params: unknown[] = []) => Number((await q(sql, params))[0].n);

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  seeder = await import('../../../src/modules/storefront-builder/cli/demo-seeder');
  a = await api.signup('demoa');
  b = await api.signup('demob');
  // The workspace's own data, which the seed must never touch: six contacts (the seed reuses four of them as customers), a product,
  // a coupon, and a customer profile of its own.
  own.contacts = await api.seedContacts(
    a,
    [1, 2, 3, 4, 5, 6].map((i) => ({
      name: `Existing Person ${i}`,
      phone: `+91981110000${i}`,
      email: `existing${i}@example.test`,
    })),
  );
  await q(
    `INSERT INTO wa_products (org_id, name, slug, price_minor, stock_qty, in_stock, status, currency_code)
     VALUES ($1, 'Own Product', 'own-product', 10000, 5, true, 'active', 'INR')`,
    [a.orgId],
  );
  await q(
    `INSERT INTO wa_coupons (org_id, code, type, amount) VALUES ($1, 'OWN10', 'percent', 10)`,
    [a.orgId],
  );
  await q(
    `INSERT INTO wa_customer_profiles (org_id, phone, name, company) VALUES ($1, '919000099999', 'Own Customer', 'Real Co')`,
    [a.orgId],
  );
  target = await seeder.resolveTarget(h.owner, { org: a.slug });
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

const ownRows = async () => ({
  contacts: await n(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [a.orgId]),
  products: await n(
    `SELECT count(*)::int AS n FROM wa_products WHERE org_id = $1 AND slug = 'own-product'`,
    [a.orgId],
  ),
  coupons: await n(
    `SELECT count(*)::int AS n FROM wa_coupons WHERE org_id = $1 AND code = 'OWN10'`,
    [a.orgId],
  ),
  profiles: await n(
    `SELECT count(*)::int AS n FROM wa_customer_profiles WHERE org_id = $1 AND phone = '919000099999'`,
    [a.orgId],
  ),
});

describe('the store demo seed', () => {
  it('creates a "Demo Store" for a workspace that has no shop, and the target names it', () => {
    expect(target).toMatchObject({
      orgId: a.orgId,
      storefrontCreated: true,
      storefrontName: 'Demo Store',
    });
  });

  it('fills the workspace through the real paths', async () => {
    const before = await ownRows();
    const result = await seeder.runSeed(h.app, h.owner, target!);
    expect(result.failures).toEqual([]);
    expect(result.created).toMatchObject({
      products: 12,
      coupons: 5,
      customers: 14,
      orders: 30,
      contacts: 10,
    });

    const c = await seeder.countDemo(h.owner, a.orgId);
    expect(c).toMatchObject({ products: 12, coupons: 5, customers: 14, orders: 30 });
    for (const s of [
      'new',
      'pending',
      'confirmed',
      'paid',
      'processing',
      'completed',
      'shipped',
      'cancelled',
    ]) {
      expect(c.ordersByStatus[s], s).toBeGreaterThan(0);
    }
    expect(c.ordersBySource.storefront).toBeGreaterThan(0);
    expect(c.ordersBySource.waba).toBeGreaterThan(0);
    // every order is a contact (four are contacts the workspace already had) and some buyers came back
    expect(
      await n(
        `SELECT count(*)::int AS n FROM wa_orders WHERE org_id = $1 AND meta_json ->> 'demo' = 'store-demo' AND contact_id IS NULL`,
        [a.orgId],
      ),
    ).toBe(0);
    expect(c.linkedContacts).toBe(12);
    expect(c.repeatBuyers).toBeGreaterThanOrEqual(2);
    const reused = await n(
      `SELECT count(DISTINCT o.contact_id)::int AS n FROM wa_orders o JOIN contacts k ON k.org_id = o.org_id AND k.id = o.contact_id
       WHERE o.org_id = $1 AND o.meta_json ->> 'demo' = 'store-demo' AND k.normalized_phone LIKE '+9198111%'`,
      [a.orgId],
    );
    expect(reused).toBe(4);
    expect(await ownRows()).toEqual({ ...before, contacts: 16 });
    expect(await n(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [a.orgId])).toBe(
      6 + 10,
    );

    // the bridge ran: a confirmed sales order for every live order, an invoice (a receipt, or a tax invoice where tax was captured) for the
    // paid ones, a ledger payment for each, and a refund for the two refunded orders
    expect(c.salesOrders).toBe(30 - c.ordersByStatus.cancelled! + 2);
    const billed = await q(
      `SELECT o.status, o.meta_json ->> 'paid_via' AS via, o.invoice_id, i.doc_type, i.status AS inv_status, i.total_minor::text AS total
       FROM wa_orders o LEFT JOIN invoices i ON i.org_id = o.org_id AND i.id = o.invoice_id
       WHERE o.org_id = $1 AND o.meta_json ->> 'demo' = 'store-demo' AND o.status IN ('paid', 'completed')`,
      [a.orgId],
    );
    expect(billed.length).toBe(c.ordersByStatus.paid! + c.ordersByStatus.completed!);
    for (const r of billed) {
      expect(r.invoice_id, `${r.status} order has an invoice`).not.toBeNull();
      expect(['receipt', 'tax_invoice']).toContain(r.doc_type);
    }
    expect(c.invoices).toBeGreaterThanOrEqual(billed.length);
    expect(c.receipts).toBeGreaterThan(0);
    expect(c.taxInvoices).toBeGreaterThan(0);
    expect(c.payments).toBeGreaterThanOrEqual(billed.length);
    expect(c.refunds).toBe(2);
    // a paid invoice's ledger adds up to its total
    const unsettled = await q(
      `SELECT i.id FROM invoices i JOIN wa_orders o ON o.org_id = i.org_id AND o.invoice_id = i.id
       WHERE o.org_id = $1 AND o.meta_json ->> 'demo' = 'store-demo' AND o.status IN ('paid', 'completed')
         AND i.total_minor <> (SELECT coalesce(sum(amount_minor), 0) FROM payments p WHERE p.org_id = i.org_id AND p.invoice_id = i.id AND p.kind = 'payment')`,
      [a.orgId],
    );
    expect(unsettled).toEqual([]);
  }, 300_000);

  it('dates the rows over the last 45 days, not all today', async () => {
    const span = (
      await q(
        `SELECT extract(epoch FROM (now() - min(created_at))) / 86400 AS oldest, extract(epoch FROM (now() - max(created_at))) / 86400 AS newest,
              count(DISTINCT created_at::date)::int AS days
       FROM wa_orders WHERE org_id = $1 AND meta_json ->> 'demo' = 'store-demo'`,
        [a.orgId],
      )
    )[0];
    expect(Number(span.oldest)).toBeGreaterThan(30);
    expect(Number(span.oldest)).toBeLessThanOrEqual(45.5);
    expect(Number(span.newest)).toBeLessThan(2);
    expect(span.days).toBeGreaterThan(15);
    const inv = (
      await q(
        `SELECT count(DISTINCT i.issue_date)::int AS days, bool_and(i.issued_at <= now()) AS past
       FROM invoices i JOIN wa_orders o ON o.org_id = i.org_id AND o.invoice_id = i.id WHERE o.org_id = $1 AND o.meta_json ->> 'demo' = 'store-demo'`,
        [a.orgId],
      )
    )[0];
    expect(inv.days).toBeGreaterThan(5);
    expect(inv.past).toBe(true);
    // a timeline entry sits at the order's own time
    const off = await n(
      `SELECT count(*)::int AS n FROM contact_activities ca JOIN wa_orders o ON o.org_id = ca.org_id AND ca.title = 'Store order #' || o.id
       WHERE o.org_id = $1 AND o.meta_json ->> 'demo' = 'store-demo' AND abs(extract(epoch FROM (ca.occurred_at - o.created_at))) > 60`,
      [a.orgId],
    );
    expect(off).toBe(0);
  });

  it('shows up through the store admin API and the contact tab', async () => {
    const list = await api.http().get('/v2/store/orders?limit=100').set(bearer(a.admin));
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.data).toHaveLength(30);
    const paidStates = new Set(
      list.body.data.map((o: { paymentStatus: string }) => o.paymentStatus),
    );
    for (const s of ['paid', 'cod', 'awaiting', 'unpaid']) expect(paidStates.has(s), s).toBe(true);
    const coupons = await api.http().get('/v2/store/coupons?limit=100').set(bearer(a.admin));
    expect(coupons.status).toBe(200);
    expect(coupons.body.data.length).toBeGreaterThanOrEqual(6);
    const customers = await api.http().get('/v2/store/customers?limit=100').set(bearer(a.admin));
    expect(customers.status).toBe(200);
    expect(customers.body.data).toHaveLength(14 + 1);
    // the contact tab of a repeat buyer lists their orders with the sales order and invoice
    const repeat = (
      await q(
        `SELECT k.uuid FROM wa_orders o JOIN contacts k ON k.org_id = o.org_id AND k.id = o.contact_id
       WHERE o.org_id = $1 AND o.meta_json ->> 'demo' = 'store-demo' GROUP BY k.uuid ORDER BY count(*) DESC LIMIT 1`,
        [a.orgId],
      )
    )[0].uuid;
    const tab = await api.http().get(`/v2/contacts/${repeat}/store-orders`).set(bearer(a.admin));
    expect(tab.status, JSON.stringify(tab.body)).toBe(200);
    expect(tab.body.data.length).toBeGreaterThanOrEqual(3);
    expect(tab.body.data.some((o: { invoice: unknown }) => o.invoice !== null)).toBe(true);
    // the other workspace sees none of it
    expect(
      (await api.http().get(`/v2/contacts/${repeat}/store-orders`).set(bearer(b.admin))).status,
    ).toBe(404);
    const other = await api.http().get('/v2/store/orders?limit=100').set(bearer(b.admin));
    expect(other.body.data ?? []).toHaveLength(0);
  });

  it('a second run adds nothing (idempotent)', async () => {
    const before = await seeder.countDemo(h.owner, a.orgId);
    const contacts = await n(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [
      a.orgId,
    ]);
    const again = await seeder.runSeed(h.app, h.owner, target!);
    expect(again.failures).toEqual([]);
    expect(again.created).toEqual({
      products: 0,
      coupons: 0,
      customers: 0,
      orders: 0,
      contacts: 0,
    });
    expect(again.skipped).toEqual({ products: 12, coupons: 5, customers: 14, orders: 30 });
    expect(await seeder.countDemo(h.owner, a.orgId)).toEqual(before);
    expect(await n(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [a.orgId])).toBe(
      contacts,
    );
  }, 300_000);

  it('never writes into another workspace', async () => {
    for (const t of [
      'wa_orders',
      'wa_products',
      'wa_coupons',
      'wa_customer_profiles',
      'contacts',
      'sales_orders',
      'invoices',
      'payments',
    ]) {
      expect(await n(`SELECT count(*)::int AS n FROM ${t} WHERE org_id = $1`, [b.orgId]), t).toBe(
        0,
      );
    }
  });

  it("--reset deletes exactly what the seed made, ledger included, and nothing of the workspace's own", async () => {
    // an order the workspace placed itself, billed by hand: it must survive
    const before = await ownRows();
    const mine = (
      await q(
        `INSERT INTO wa_orders (org_id, source, customer_phone, customer_name, items_json, total_minor, status, contact_id)
       VALUES ($1, 'manual', '+919811100001', 'Existing Person 1', '[]'::jsonb, 5000, 'new', (SELECT id FROM contacts WHERE org_id = $1 AND name = 'Existing Person 1'))
       RETURNING id`,
        [a.orgId],
      )
    )[0].id;
    const otherInvoices = await n(
      `SELECT count(*)::int AS n FROM invoices WHERE org_id = $1 AND wa_order_id IS NULL`,
      [a.orgId],
    );

    const gone = await seeder.runReset(h.owner, a.orgId);
    expect(gone).toMatchObject({
      orders: 30,
      products: 12,
      coupons: 5,
      customers: 14,
      contacts: 10,
    });
    expect(gone.invoices).toBeGreaterThan(0);
    expect(gone.payments).toBeGreaterThan(0);
    expect(gone.salesOrders).toBeGreaterThan(0);

    const c = await seeder.countDemo(h.owner, a.orgId);
    expect(c).toMatchObject({
      products: 0,
      coupons: 0,
      customers: 0,
      orders: 0,
      salesOrders: 0,
      invoices: 0,
      payments: 0,
      refunds: 0,
    });
    expect(await ownRows()).toEqual({ ...before, contacts: 6 });
    expect(await n(`SELECT count(*)::int AS n FROM wa_orders WHERE org_id = $1`, [a.orgId])).toBe(
      1,
    );
    expect(
      await n(`SELECT count(*)::int AS n FROM wa_orders WHERE org_id = $1 AND id = $2`, [
        a.orgId,
        mine,
      ]),
    ).toBe(1);
    expect(
      await n(`SELECT count(*)::int AS n FROM wa_order_items WHERE org_id = $1`, [a.orgId]),
    ).toBe(0);
    expect(
      await n(`SELECT count(*)::int AS n FROM sales_orders WHERE org_id = $1`, [a.orgId]),
    ).toBe(0);
    expect(await n(`SELECT count(*)::int AS n FROM invoices WHERE org_id = $1`, [a.orgId])).toBe(
      otherInvoices,
    );
    expect(await n(`SELECT count(*)::int AS n FROM payments WHERE org_id = $1`, [a.orgId])).toBe(0);
    // the timeline entries of the demo orders are gone from the contacts that were already there
    expect(
      await n(
        `SELECT count(*)::int AS n FROM contact_activities WHERE org_id = $1 AND activity_type = 'store_order'`,
        [a.orgId],
      ),
    ).toBe(0);
    // the guards that were switched off for the delete are back on
    const trg = await q(
      `SELECT tgname, tgenabled FROM pg_trigger WHERE tgname IN ('trg_payments_immutable', 'trg_invoices_freeze', 'trg_wa_orders_touch')`,
    );
    expect(trg).toHaveLength(3);
    expect(trg.every((t) => t.tgenabled === 'O')).toBe(true);
    // a second reset is a no-op
    expect(await seeder.runReset(h.owner, a.orgId)).toMatchObject({
      orders: 0,
      products: 0,
      contacts: 0,
    });
  }, 300_000);

  it('seeds again after a reset and gets the same shape', async () => {
    const again = await seeder.runSeed(h.app, h.owner, target!);
    expect(again.failures).toEqual([]);
    expect(again.created).toMatchObject({
      products: 12,
      coupons: 5,
      customers: 14,
      orders: 30,
      contacts: 10,
    });
    const c = await seeder.countDemo(h.owner, a.orgId);
    expect(c).toMatchObject({ products: 12, coupons: 5, customers: 14, orders: 30, refunds: 2 });
    expect(c.invoices).toBeGreaterThan(0);
  }, 300_000);
});
