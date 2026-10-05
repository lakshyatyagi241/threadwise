import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The harness first: it loads the app graph in the order the application itself does (a domain barrel first hits an import cycle).
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * The store-order backfill (`pnpm --filter @crm/api backfill:store-orders`) end to end with real Postgres: orders that predate the
 * contact link get their contact, sales order and saved profile exactly as a new order would; an unpaid order gets no invoice; unusable
 * numbers and a plan out of contacts are reported per order and never fail the batch; a dry run writes nothing; a second run changes
 * nothing.
 */
process.env.STORE_PROVIDER_MODE = 'fixture';

let h: Harness;
let api: Api;
let backfill: import('../../../src/modules/store-orders-sales/store-order-backfill.service').StoreOrderBackfillService;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  const mod = await import('../../../src/modules/store-orders-sales/store-order-backfill.service');
  backfill = h.app.get(mod.StoreOrderBackfillService, { strict: false });
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const q = async (sql: string, params: unknown[] = []) => (await h.owner.query(sql, params)).rows;
const n = async (sql: string, params: unknown[] = []) => Number((await q(sql, params))[0].n);

async function order(
  t: Tenant,
  o: { phone: string | null; name?: string; status?: string; total?: number; address?: string },
) {
  const r = await q(
    `INSERT INTO wa_orders (org_id, source, customer_phone, customer_name, customer_address, items_json, total_minor, currency_code, status)
     VALUES ($1, 'storefront', $2, $3, $4, '[]'::jsonb, $5, 'INR', $6) RETURNING id`,
    [t.orgId, o.phone, o.name ?? 'Buyer', o.address ?? null, o.total ?? 10000, o.status ?? 'new'],
  );
  return Number(r[0].id);
}

/** Everything the backfill could touch in one workspace, to prove "nothing changed". */
async function snapshot(orgId: number) {
  return {
    contacts: await n(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [orgId]),
    profiles: await n(`SELECT count(*)::int AS n FROM wa_customer_profiles WHERE org_id = $1`, [
      orgId,
    ]),
    salesOrders: await n(`SELECT count(*)::int AS n FROM sales_orders WHERE org_id = $1`, [orgId]),
    invoices: await n(`SELECT count(*)::int AS n FROM invoices WHERE org_id = $1`, [orgId]),
    payments: await n(`SELECT count(*)::int AS n FROM payments WHERE org_id = $1`, [orgId]),
    activities: await n(`SELECT count(*)::int AS n FROM contact_activities WHERE org_id = $1`, [
      orgId,
    ]),
    outbox: await n(`SELECT count(*)::int AS n FROM event_outbox WHERE org_id = $1`, [orgId]),
    unlinked: await n(
      `SELECT count(*)::int AS n FROM wa_orders WHERE org_id = $1 AND contact_id IS NULL`,
      [orgId],
    ),
    orders: await q(
      `SELECT id, contact_id, sales_order_id, invoice_id, status, meta_json FROM wa_orders WHERE org_id = $1 ORDER BY id`,
      [orgId],
    ),
  };
}

describe('store order backfill', () => {
  it('links an old unpaid order to a new Indian contact, a sales order and a saved profile, and no invoice', async () => {
    const t = await api.signup('bf');
    // the dev order that started this: a bare 10-digit local number, no contact link
    const id = await order(t, {
      phone: '7999834066',
      name: 'SHubham',
      address: 'This is test',
    });

    const base = await snapshot(t.orgId);
    expect(base.unlinked).toBe(1);
    const dry = await backfill.run({ orgId: t.orgId, dryRun: true });
    expect(dry).toMatchObject({
      dryRun: true,
      scanned: 1,
      linked: 1,
      contactsCreated: 1,
      salesOrdersCreated: 1,
      invoicesCreated: 0,
      profilesCreated: 1,
    });
    // a dry run writes nothing at all: contacts, sales orders, profiles, timeline, outbox, the order row itself
    expect(await snapshot(t.orgId)).toEqual(base);

    const run = await backfill.run({ orgId: t.orgId, dryRun: false });
    expect(run).toMatchObject({
      dryRun: false,
      scanned: 1,
      linked: 1,
      contactsCreated: 1,
      contactsFound: 0,
      salesOrdersCreated: 1,
      invoicesCreated: 0,
      paymentsRecorded: 0,
      profilesCreated: 1,
      skipped: [],
    });

    const o = (await q(`SELECT * FROM wa_orders WHERE id = $1`, [id]))[0];
    expect(o.contact_id).not.toBeNull();
    expect(o.sales_order_id).not.toBeNull();
    expect(o.invoice_id).toBeNull();
    // read in the platform's default country: an Indian number, not "+7 999..."
    const contact = (
      await q(`SELECT * FROM contacts WHERE org_id = $1 AND id = $2`, [t.orgId, o.contact_id])
    )[0];
    expect(contact).toMatchObject({ source: 'store', name: 'SHubham', address: 'This is test' });
    expect(
      (
        await q(
          `SELECT value FROM contact_identities WHERE org_id = $1 AND contact_id = $2 AND kind = 'phone'`,
          [t.orgId, o.contact_id],
        )
      )[0].value,
    ).toBe('+917999834066');
    const so = (await q(`SELECT * FROM sales_orders WHERE org_id = $1`, [t.orgId]))[0];
    expect(so).toMatchObject({
      status: 'confirmed',
      reference: `Store order #${id}`,
      contact_id: o.contact_id,
    });
    expect(await n(`SELECT count(*)::int AS n FROM invoices WHERE org_id = $1`, [t.orgId])).toBe(0);
    expect(
      (
        await q(
          `SELECT phone, name, address, contact_id FROM wa_customer_profiles WHERE org_id = $1`,
          [t.orgId],
        )
      )[0],
    ).toMatchObject({
      phone: '917999834066',
      name: 'SHubham',
      address: 'This is test',
      contact_id: o.contact_id,
    });
    expect(
      await n(
        `SELECT count(*)::int AS n FROM contact_activities WHERE org_id = $1 AND contact_id = $2 AND title = $3`,
        [t.orgId, o.contact_id, `Store order #${id}`],
      ),
    ).toBe(1);

    // idempotent: a second run (and a dry run) finds nothing and changes nothing
    const before = await snapshot(t.orgId);
    const again = await backfill.run({ orgId: t.orgId, dryRun: false });
    expect(again).toMatchObject({
      scanned: 0,
      linked: 0,
      salesOrdersCreated: 0,
      profilesCreated: 0,
      skipped: [],
    });
    expect(await backfill.run({ orgId: t.orgId, dryRun: true })).toMatchObject({ scanned: 0 });
    expect(await snapshot(t.orgId)).toEqual(before);
  });

  it('bills a paid order like a new one (a receipt, settled), reuses an existing contact, and skips a cancelled order sales order', async () => {
    const t = await api.signup('bfpaid');
    const [existing] = await api.seedContacts(t, [{ name: 'Known Kim', phone: '+919811112222' }]);
    const existingId = Number(
      (await q(`SELECT id FROM contacts WHERE uuid = $1`, [existing]))[0].id,
    );
    const paid = await order(t, {
      phone: '+91 98111 12222',
      name: 'Kim',
      status: 'paid',
      total: 25000,
    });
    const cancelled = await order(t, {
      phone: '919822223333',
      name: 'Cancelled Cy',
      status: 'cancelled',
    });

    const run = await backfill.run({ orgId: t.orgId, dryRun: false });
    expect(run).toMatchObject({
      scanned: 2,
      linked: 2,
      contactsCreated: 1,
      contactsFound: 1,
      salesOrdersCreated: 1,
      invoicesCreated: 1,
      paymentsRecorded: 1,
      skipped: [],
    });
    const p = (await q(`SELECT * FROM wa_orders WHERE id = $1`, [paid]))[0];
    expect(Number(p.contact_id)).toBe(existingId);
    expect(p.sales_order_id).not.toBeNull();
    expect(p.invoice_id).not.toBeNull();
    const inv = (await q(`SELECT * FROM invoices WHERE org_id = $1`, [t.orgId]))[0];
    expect(inv).toMatchObject({ doc_type: 'receipt', status: 'issued', payment_status: 'paid' });
    const c = (await q(`SELECT * FROM wa_orders WHERE id = $1`, [cancelled]))[0];
    expect(c.contact_id).not.toBeNull();
    expect(c.sales_order_id).toBeNull();
    expect(c.invoice_id).toBeNull();
    expect(
      await n(`SELECT count(*)::int AS n FROM sales_orders WHERE org_id = $1`, [t.orgId]),
    ).toBe(1);
  });

  it('reports numbers it cannot read (no phone, junk, too short) instead of guessing, and still processes the rest', async () => {
    const t = await api.signup('bfbad');
    const noPhone = await order(t, { phone: null });
    const junk = await order(t, { phone: 'n/a' });
    const short = await order(t, { phone: '123' });
    const good = await order(t, { phone: '+44 7700 900123', name: 'Londoner' });

    const run = await backfill.run({ orgId: t.orgId, dryRun: false });
    expect(run).toMatchObject({
      scanned: 4,
      linked: 1,
      contactsCreated: 1,
      salesOrdersCreated: 1,
      profilesCreated: 1,
    });
    expect(run.skipped.map((s) => [s.orderId, s.reason]).sort()).toEqual(
      [
        [noPhone, 'no_phone'],
        [junk, 'unusable_phone'],
        [short, 'unusable_phone'],
      ].sort(),
    );
    expect(run.skippedByReason).toEqual({ no_phone: 1, unusable_phone: 2 });
    expect(
      (
        await q(`SELECT contact_id FROM wa_orders WHERE id = ANY($1::bigint[])`, [
          [noPhone, junk, short],
        ])
      ).every((r) => r.contact_id === null),
    ).toBe(true);
    expect(
      (await q(`SELECT contact_id FROM wa_orders WHERE id = $1`, [good]))[0].contact_id,
    ).not.toBeNull();
    // the unreadable ones stay candidates, and stay reported, without changing anything
    const before = await snapshot(t.orgId);
    const again = await backfill.run({ orgId: t.orgId, dryRun: false });
    expect(again).toMatchObject({
      scanned: 3,
      linked: 0,
      skippedByReason: { no_phone: 1, unusable_phone: 2 },
    });
    expect(await snapshot(t.orgId)).toEqual(before);
  });

  it('a plan out of contacts skips the contact (reason plan_limit_reached) but still saves the profile and the sales order, and never fails the batch', async () => {
    const t = await api.signup('bfcap');
    await api.seedContacts(t, [{ name: 'Only Contact', phone: '+919800000001' }]);
    await q(
      `INSERT INTO org_plan_state (org_id, overrides) VALUES ($1, '{"limits":{"contacts":1}}'::jsonb)
       ON CONFLICT (org_id) DO UPDATE SET overrides = '{"limits":{"contacts":1}}'::jsonb`,
      [t.orgId],
    );
    const known = await order(t, { phone: '919800000001', name: 'Known' });
    const blocked = await order(t, {
      phone: '9800000002',
      name: 'Blocked Bo',
      address: '2 Cap Rd',
    });

    const dry = await backfill.run({ orgId: t.orgId, dryRun: true });
    expect(dry).toMatchObject({ scanned: 2, linked: 1, contactsCreated: 0, contactsFound: 1 });
    expect(dry.skippedByReason).toEqual({ plan_limit_reached: 1 });

    const run = await backfill.run({ orgId: t.orgId, dryRun: false });
    expect(run).toMatchObject({ scanned: 2, linked: 1, contactsCreated: 0, contactsFound: 1 });
    expect(run.skipped).toEqual([
      { orgId: t.orgId, orderId: blocked, reason: 'plan_limit_reached', detail: null },
    ]);
    expect(
      (await q(`SELECT contact_id FROM wa_orders WHERE id = $1`, [known]))[0].contact_id,
    ).not.toBeNull();
    const b = (await q(`SELECT * FROM wa_orders WHERE id = $1`, [blocked]))[0];
    expect(b.contact_id).toBeNull();
    expect(await n(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [t.orgId])).toBe(1);
    // the buyer is still a saved customer, so the Customers list shows them
    expect(
      (
        await q(
          `SELECT phone, name, address, contact_id FROM wa_customer_profiles WHERE org_id = $1 AND phone = '919800000002'`,
          [t.orgId],
        )
      )[0],
    ).toMatchObject({ name: 'Blocked Bo', address: '2 Cap Rd', contact_id: null });

    // rerunning retries the blocked order (idempotent: still skipped, nothing duplicated)
    const before = await snapshot(t.orgId);
    const again = await backfill.run({ orgId: t.orgId, dryRun: false });
    expect(again).toMatchObject({
      scanned: 1,
      linked: 0,
      skippedByReason: { plan_limit_reached: 1 },
    });
    expect(await snapshot(t.orgId)).toEqual(before);
  });

  it('only touches the workspace asked for, and scans every workspace when none is given', async () => {
    const a = await api.signup('bfisoa');
    const b = await api.signup('bfisob');
    const oa = await order(a, { phone: '919840000001' });
    const ob = await order(b, { phone: '919840000001' });
    const onlyA = await backfill.run({ orgId: a.orgId, dryRun: false });
    expect(onlyA.scanned).toBe(1);
    expect(
      (await q(`SELECT contact_id FROM wa_orders WHERE id = $1`, [oa]))[0].contact_id,
    ).not.toBeNull();
    expect(
      (await q(`SELECT contact_id FROM wa_orders WHERE id = $1`, [ob]))[0].contact_id,
    ).toBeNull();
    // all workspaces: B's order is picked up, with a contact of B's workspace
    const all = await backfill.run({ dryRun: false });
    expect(all.scanned).toBeGreaterThanOrEqual(1);
    const linked = (await q(`SELECT contact_id FROM wa_orders WHERE id = $1`, [ob]))[0].contact_id;
    expect(linked).not.toBeNull();
    expect((await q(`SELECT org_id FROM contacts WHERE id = $1`, [linked]))[0].org_id).toBe(
      b.orgId,
    );
    expect(
      (
        await q(
          `SELECT org_id FROM contacts WHERE id = (SELECT contact_id FROM wa_orders WHERE id = $1)`,
          [oa],
        )
      )[0].org_id,
    ).toBe(a.orgId);
  });
});
