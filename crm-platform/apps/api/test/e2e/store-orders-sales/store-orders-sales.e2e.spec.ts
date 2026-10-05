import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The harness first: it loads the app graph in the order the application itself does (a domain barrel first hits an import cycle).
import { Api, bearer, startHarness, type Harness } from '../contacts-attributes-tags/support';
import { RequestContextStore } from '../../../src/common/context/request-context';

/**
 * Store orders inside the CRM, end to end with real Postgres: a public checkout order is a contact, a sales order and a timeline entry;
 * a paid order is an invoice or receipt settled in the ledger; every step is idempotent. The outbox consumer is the worker's job, so
 * the test calls the service it calls (`syncOrder`) the way the drain would.
 */
process.env.STORE_PROVIDER_MODE = 'fixture';
process.env.BAILEYS_NODE_TOKEN = 'node-token-1';

let h: Harness;
let api: Api;
let bridge: Server;
let sales: import('../../../src/modules/store-orders-sales/store-order-sales.service').StoreOrderSalesService;

let ipSeq = 0;
const ip = () => `10.88.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

beforeAll(async () => {
  bridge = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"success":true}');
    });
  });
  await new Promise<void>((r) => bridge.listen(0, '127.0.0.1', r));
  process.env.BAILEYS_SERVER_URL = `http://127.0.0.1:${(bridge.address() as AddressInfo).port}`;
  h = await startHarness();
  api = new Api(h);
  const mod = await import('../../../src/modules/store-orders-sales/store-order-sales.service');
  sales = h.app.get(mod.StoreOrderSalesService, { strict: false });
}, 240_000);

afterAll(async () => {
  await h?.stop();
  await new Promise((r) => bridge?.close(r));
});

const q = async (sql: string, params: unknown[] = []) => (await h.owner.query(sql, params)).rows;
const n = async (sql: string, params: unknown[] = []) => Number((await q(sql, params))[0].n);

async function merchant(label: string) {
  const t = await api.signup(label);
  const dev = await q(
    `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active)
     VALUES ($1, 'Counter phone', '91', '9812345678', 'connected', true) RETURNING uuid`,
    [t.orgId],
  );
  const res = await api
    .as(t.admin)
    .post('/v2/store/shops')
    .send({ shopName: 'Media City Threads', deviceId: dev[0].uuid });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const product = await q(
    `INSERT INTO wa_products (org_id, name, slug, price_minor, stock_qty, in_stock, status, currency_code)
     VALUES ($1,'Tea','tea-' || $2,10000,NULL,true,'active','INR') RETURNING uuid`,
    [t.orgId, Math.random().toString(36).slice(2, 7)],
  );
  return { t, slug: res.body.slug as string, product: product[0].uuid as string };
}

async function checkout(m: { slug: string; product: string }, phone = '+91 98765 43210') {
  const res = await api
    .http()
    .post(`/v2/store-public/${m.slug}/checkout`)
    .set('x-forwarded-for', ip())
    .send({
      name: 'Asha',
      phone,
      email: 'asha@example.com',
      address: '12 Main St',
      items: [{ id: m.product, qty: 2 }],
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const order = (await q(`SELECT * FROM wa_orders WHERE id = $1`, [res.body.orderNo]))[0];
  return order as {
    id: number;
    uuid: string;
    contact_id: number | null;
    total_minor: string;
    [k: string]: unknown;
  };
}

describe('a public checkout order is a contact', () => {
  it('links the buyer to a new contact (source store, tagged), and the same number again to the same contact', async () => {
    const m = await merchant('link');
    const first = await checkout(m);
    expect(first.contact_id).not.toBeNull();
    const contact = (
      await q(`SELECT * FROM contacts WHERE org_id = $1 AND id = $2`, [m.t.orgId, first.contact_id])
    )[0];
    expect(contact).toMatchObject({ source: 'store', name: 'Asha' });
    expect(contact.email).toBe('asha@example.com');
    expect(contact.address).toBe('12 Main St');
    const ident = await q(
      `SELECT value FROM contact_identities WHERE org_id = $1 AND contact_id = $2 AND kind = 'phone'`,
      [m.t.orgId, first.contact_id],
    );
    expect(ident[0].value).toBe('+919876543210');
    expect(
      await n(
        `SELECT count(*)::int AS n FROM contact_tags ct JOIN tags t ON t.org_id = ct.org_id AND t.id = ct.tag_id
         WHERE ct.org_id = $1 AND ct.contact_id = $2 AND t.name = 'Store customer'`,
        [m.t.orgId, first.contact_id],
      ),
    ).toBe(1);

    const second = await checkout(m, '919876543210');
    expect(second.contact_id).toBe(first.contact_id);
    expect(await n(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [m.t.orgId])).toBe(
      1,
    );
    // the contact.created event of the new contact is on the outbox, once
    expect(
      await n(
        `SELECT count(*)::int AS n FROM event_outbox WHERE org_id = $1 AND event_type = 'contact.created'`,
        [m.t.orgId],
      ),
    ).toBe(1);
  });
});

describe('store order -> sales order -> receipt', () => {
  it('creates the sales order and the timeline entry once, then an issued, paid receipt when the order is paid', async () => {
    const m = await merchant('sales');
    const order = await checkout(m);
    const id = Number(order.id);

    const r1 = await sales.syncOrder(m.t.orgId, { uuid: order.uuid });
    expect(r1).toMatchObject({ contact: 'linked', salesOrder: 'created', invoice: 'none' });
    const again = await sales.syncOrder(m.t.orgId, { uuid: order.uuid });
    expect(again.salesOrder).toBe('existing');

    const so = await q(`SELECT * FROM sales_orders WHERE org_id = $1`, [m.t.orgId]);
    expect(so).toHaveLength(1);
    expect(so[0]).toMatchObject({
      status: 'confirmed',
      reference: `Store order #${id}`,
      currency: 'INR',
      buyer_name: 'Asha',
      contact_id: order.contact_id,
    });
    expect(Number(so[0].total_minor)).toBe(Number(order.total_minor));
    expect(
      (await q(`SELECT sales_order_id FROM wa_orders WHERE id = $1`, [id]))[0].sales_order_id,
    ).toBe(so[0].id);
    expect(
      await n(
        `SELECT count(*)::int AS n FROM contact_activities WHERE org_id = $1 AND contact_id = $2 AND title = $3`,
        [m.t.orgId, order.contact_id, `Store order #${id}`],
      ),
    ).toBe(1);
    expect(await n(`SELECT count(*)::int AS n FROM invoices WHERE org_id = $1`, [m.t.orgId])).toBe(
      0,
    );

    // paid -> a RECEIPT (no tax captured), issued, settled by a ledger entry, linked both ways
    await q(`UPDATE wa_orders SET status = 'paid' WHERE id = $1`, [id]);
    const r2 = await sales.syncOrder(m.t.orgId, { uuid: order.uuid });
    expect(r2).toMatchObject({ invoice: 'invoiced', payment: 'recorded' });
    const inv = await q(`SELECT * FROM invoices WHERE org_id = $1`, [m.t.orgId]);
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({
      doc_type: 'receipt',
      status: 'issued',
      payment_status: 'paid',
      source: 'own',
      contact_id: order.contact_id,
    });
    expect(Number(inv[0].total_minor)).toBe(Number(order.total_minor));
    expect(Number(inv[0].wa_order_id)).toBe(id);
    expect(inv[0].invoice_number).toMatch(/^RCT-/);
    const linked = (
      await q(`SELECT invoice_id, sales_order_id FROM wa_orders WHERE id = $1`, [id])
    )[0];
    expect(linked.invoice_id).toBe(inv[0].id);
    expect(
      await n(`SELECT count(*)::int AS n FROM invoice_logs WHERE org_id = $1 AND invoice_id = $2`, [
        m.t.orgId,
        inv[0].id,
      ]),
    ).toBeGreaterThan(0);
    const pay = await q(`SELECT * FROM payments WHERE org_id = $1`, [m.t.orgId]);
    expect(pay).toHaveLength(1);
    expect(pay[0]).toMatchObject({ method: 'storefront', source: 'storefront', kind: 'payment' });
    expect(Number(pay[0].amount_minor)).toBe(Number(order.total_minor));
    // the invoice is made through the sales order: its quantities are billed
    expect(
      await n(
        `SELECT count(*)::int AS n FROM sales_order_items WHERE org_id = $1 AND qty_invoiced = qty`,
        [m.t.orgId],
      ),
    ).toBe(1);

    // redelivery of every event: nothing is made twice
    await sales.syncOrder(m.t.orgId, { uuid: order.uuid });
    await sales.syncOrder(m.t.orgId, { id });
    expect(await n(`SELECT count(*)::int AS n FROM invoices WHERE org_id = $1`, [m.t.orgId])).toBe(
      1,
    );
    expect(await n(`SELECT count(*)::int AS n FROM payments WHERE org_id = $1`, [m.t.orgId])).toBe(
      1,
    );
    expect(
      await n(`SELECT count(*)::int AS n FROM sales_orders WHERE org_id = $1`, [m.t.orgId]),
    ).toBe(1);
    expect(
      await n(
        `SELECT count(*)::int AS n FROM contact_activities WHERE org_id = $1 AND activity_type = 'store_order'`,
        [m.t.orgId],
      ),
    ).toBe(2); // placed + paid, once each
  });

  it('createInvoiceForOrder bills an unpaid order on request and answers with the same invoice the second time', async () => {
    const m = await merchant('manual');
    const order = await checkout(m);
    const first = await sales.createInvoiceForOrder(m.t.orgId, order.uuid);
    expect(first).toMatchObject({ outcome: 'invoiced', docType: 'receipt' });
    expect(first.invoiceNumber).toMatch(/^RCT-/);
    expect(first.salesOrderNumber).toMatch(/^SO-/);
    const second = await sales.createInvoiceForOrder(m.t.orgId, order.uuid);
    expect(second).toMatchObject({ outcome: 'existing', invoiceId: first.invoiceId });
    expect(await n(`SELECT count(*)::int AS n FROM invoices WHERE org_id = $1`, [m.t.orgId])).toBe(
      1,
    );
    // unpaid: no payment
    expect(await n(`SELECT count(*)::int AS n FROM payments WHERE org_id = $1`, [m.t.orgId])).toBe(
      0,
    );
    expect(
      (await q(`SELECT payment_status FROM invoices WHERE org_id = $1`, [m.t.orgId]))[0]
        .payment_status,
    ).toBe('unpaid');
  });

  it('a tax amount captured on the order makes a TAX INVOICE with that tax', async () => {
    const m = await merchant('tax');
    const order = await checkout(m);
    // 20000 goods + 10% captured tax: total 22000
    await q(
      `UPDATE wa_orders SET tax_minor = 2000, total_minor = 22000, status = 'paid' WHERE id = $1`,
      [order.id],
    );
    const r = await sales.syncOrder(m.t.orgId, { uuid: order.uuid });
    expect(r.invoice).toBe('invoiced');
    const inv = (await q(`SELECT * FROM invoices WHERE org_id = $1`, [m.t.orgId]))[0];
    expect(inv.doc_type).toBe('tax_invoice');
    expect(Number(inv.tax_minor)).toBe(2000);
    expect(Number(inv.total_minor)).toBe(22000);
  });

  it('a cancelled order has no sales order, and one cancelled later has its sales order cancelled', async () => {
    const m = await merchant('cancel');
    const never = await checkout(m);
    await q(`UPDATE wa_orders SET status = 'cancelled' WHERE id = $1`, [never.id]);
    expect((await sales.syncOrder(m.t.orgId, { uuid: never.uuid })).salesOrder).toBe(
      'skipped_cancelled',
    );
    expect(
      await n(`SELECT count(*)::int AS n FROM sales_orders WHERE org_id = $1`, [m.t.orgId]),
    ).toBe(0);

    const later = await checkout(m, '+91 98765 11111');
    await sales.syncOrder(m.t.orgId, { uuid: later.uuid });
    await q(`UPDATE wa_orders SET status = 'cancelled' WHERE id = $1`, [later.id]);
    expect((await sales.syncOrder(m.t.orgId, { uuid: later.uuid })).salesOrder).toBe('cancelled');
    expect(
      (await q(`SELECT status FROM sales_orders WHERE org_id = $1`, [m.t.orgId]))[0].status,
    ).toBe('cancelled');
  });
});

describe('the other order writers link a contact too', () => {
  it('a mirrored Shopify order is linked to the buyer contact by phone; a re-import keeps it; a number-less order stays unlinked', async () => {
    const t = await api.signup('mirror');
    const { STORE_MIRROR } = await import('../../../src/modules/shopify-woocommerce/_shims/tokens');
    const mirror = h.app.get(STORE_MIRROR, { strict: false }) as {
      upsertOrder: (tx: unknown, orgId: number, kind: 'shopify', o: unknown) => Promise<number>;
    };
    const { DatabaseService } = await import('../../../src/infra/db/database.service');
    const db = h.app.get(DatabaseService, { strict: false });
    const order = (phone: string | null, storeId: string) => ({
      storeId,
      phone,
      name: 'Mira',
      email: 'mira@example.com',
      items: [{ title: 'Mug', qty: 1, price: '10.00', sku: null }],
      totalMinor: 1000,
      currency: 'USD',
      status: 'new',
      meta: {},
    });
    const first = await db.txAs({ orgId: t.orgId, userId: null }, (tx) =>
      mirror.upsertOrder(tx, t.orgId, 'shopify', order('15550101010', 'S-1')),
    );
    const linked = (await q(`SELECT contact_id FROM wa_orders WHERE id = $1`, [first]))[0];
    expect(linked.contact_id).not.toBeNull();
    const contact = (
      await q(`SELECT source, name FROM contacts WHERE id = $1`, [linked.contact_id])
    )[0];
    expect(contact).toMatchObject({ source: 'shopify', name: 'Mira' });
    // the same buyer's second order and a re-import of the first: one contact
    const second = await db.txAs({ orgId: t.orgId, userId: null }, (tx) =>
      mirror.upsertOrder(tx, t.orgId, 'shopify', order('15550101010', 'S-2')),
    );
    await db.txAs({ orgId: t.orgId, userId: null }, (tx) =>
      mirror.upsertOrder(tx, t.orgId, 'shopify', order('15550101010', 'S-1')),
    );
    expect(
      (await q(`SELECT contact_id FROM wa_orders WHERE id = $1`, [second]))[0].contact_id,
    ).toBe(linked.contact_id);
    expect(await n(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [t.orgId])).toBe(1);
    const none = await db.txAs({ orgId: t.orgId, userId: null }, (tx) =>
      mirror.upsertOrder(tx, t.orgId, 'shopify', order(null, 'S-3')),
    );
    expect(
      (await q(`SELECT contact_id FROM wa_orders WHERE id = $1`, [none]))[0].contact_id,
    ).toBeNull();
  });

  it('saving a customer profile links its contact, and a second save keeps the link', async () => {
    const t = await api.signup('profile');
    const { CustomerProfilesService } =
      await import('../../../src/modules/whatsapp-cloud-api-waba/customer-profiles.service');
    const svc = h.app.get(CustomerProfilesService, { strict: false });
    const save = (name: string) =>
      RequestContextStore.run(
        {
          requestId: 'test',
          orgId: t.orgId,
          actorType: 'user',
          actorId: t.adminUserId,
          userId: t.adminUserId,
        },
        () => svc.save({ phone: '+1 555 010 2020', name, company: null, address: '9 Elm Rd' }),
      );
    await save('Pat');
    const row = (
      await q(`SELECT contact_id FROM wa_customer_profiles WHERE org_id = $1`, [t.orgId])
    )[0];
    expect(row.contact_id).not.toBeNull();
    expect(
      (await q(`SELECT address, name FROM contacts WHERE id = $1`, [row.contact_id]))[0],
    ).toEqual({
      address: '9 Elm Rd',
      name: 'Pat',
    });
    await save('Patricia');
    expect(
      (await q(`SELECT contact_id FROM wa_customer_profiles WHERE org_id = $1`, [t.orgId]))[0]
        .contact_id,
    ).toBe(row.contact_id);
    expect(await n(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [t.orgId])).toBe(1);
  });
});

describe('tenancy and the contact side', () => {
  it('one workspace never reaches another workspace order, and the contact lists its own store orders', async () => {
    const a = await merchant('ta');
    const b = await merchant('tb');
    const order = await checkout(a);
    // workspace B asks for A's order: not found, nothing created
    const r = await sales.syncOrder(b.t.orgId, { uuid: order.uuid });
    expect(r.order).toBe('not_found');
    expect(
      await n(`SELECT count(*)::int AS n FROM sales_orders WHERE org_id = $1`, [b.t.orgId]),
    ).toBe(0);
    await expect(sales.createInvoiceForOrder(b.t.orgId, order.uuid)).rejects.toMatchObject({
      status: 404,
    });

    await sales.syncOrder(a.t.orgId, { uuid: order.uuid });
    const contactUuid = (
      await q(`SELECT uuid FROM contacts WHERE org_id = $1 AND id = $2`, [
        a.t.orgId,
        order.contact_id,
      ])
    )[0].uuid;
    const list = await RequestContextStore.run(
      {
        requestId: 'test',
        orgId: a.t.orgId,
        actorType: 'user',
        actorId: a.t.adminUserId,
        userId: a.t.adminUserId,
        grants: new Map([
          ['record.contacts.read', { effect: 'allow' as const, scope: 'all' as const }],
        ]),
      },
      () => sales.listForContact(contactUuid),
    );
    expect(list.hasMore).toBe(false);
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({
      orderNo: Number(order.id),
      status: 'new',
      currency: 'INR',
      itemCount: 1,
    });
    expect(list.data[0]!.total).toBe('200.00');
    expect(list.data[0]!.salesOrder?.number).toMatch(/^SO-/);
  });
});

describe('GET /v2/contacts/:id/store-orders', () => {
  it('serves the contact its own orders, and never another workspace, another contact scope or a caller without contact read', async () => {
    const a = await merchant('ea');
    const b = await merchant('eb');
    const order = await checkout(a);
    await sales.syncOrder(a.t.orgId, { uuid: order.uuid });
    const contactUuid = (
      await q(`SELECT uuid FROM contacts WHERE org_id = $1 AND id = $2`, [
        a.t.orgId,
        order.contact_id,
      ])
    )[0].uuid as string;
    const path = `/v2/contacts/${contactUuid}/store-orders`;

    // the owner workspace reads them
    const ok = await api.http().get(path).set(bearer(a.t.admin));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.hasMore).toBe(false);
    expect(ok.body.data).toHaveLength(1);
    expect(ok.body.data[0]).toMatchObject({
      id: order.uuid,
      orderNo: Number(order.id),
      source: 'storefront',
      status: 'new',
      currency: 'INR',
      total: '200.00',
    });
    expect(ok.body.data[0].salesOrder.number).toMatch(/^SO-/);
    // internal ids never leave the system
    expect(JSON.stringify(ok.body)).not.toContain('"contact_id"');

    // another workspace: the contact does not exist for it (404, not 403, and no order data)
    const cross = await api.http().get(path).set(bearer(b.t.admin));
    expect(cross.status).toBe(404);
    expect(JSON.stringify(cross.body)).not.toContain(order.uuid);
    const bContact = (await api.seedContacts(b.t, [{ name: 'Bee', phone: '+919811100001' }]))[0]!;
    const empty = await api
      .http()
      .get(`/v2/contacts/${bContact}/store-orders`)
      .set(bearer(b.t.admin));
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ data: [], hasMore: false });

    // no token, a bad uuid and a bad limit
    expect((await api.http().get(path)).status).toBe(401);
    expect(
      (await api.http().get('/v2/contacts/not-a-uuid/store-orders').set(bearer(a.t.admin))).status,
    ).toBe(400);
    expect((await api.http().get(`${path}?limit=0`).set(bearer(a.t.admin))).status).toBe(422);
    expect((await api.http().get(`${path}?limit=51`).set(bearer(a.t.admin))).status).toBe(422);

    // a member without contacts.read is refused; one with an `own` grant reaches only contacts it owns
    const nobody = await api.member(a.t, 'nogrant', [['record.deals.read']]);
    expect((await api.http().get(path).set(bearer(nobody.token))).status).toBe(403);
    const own = await api.member(a.t, 'owngrant', [['record.contacts.read', 'own']]);
    expect((await api.http().get(path).set(bearer(own.token))).status).toBe(404);
    await q(`UPDATE contacts SET owner_id = $1 WHERE org_id = $2 AND uuid = $3`, [
      own.userId,
      a.t.orgId,
      contactUuid,
    ]);
    const mine = await api.http().get(path).set(bearer(own.token));
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body.data).toHaveLength(1);
  });
});
