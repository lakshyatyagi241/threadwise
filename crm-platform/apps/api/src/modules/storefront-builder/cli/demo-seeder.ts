/* eslint-disable @typescript-eslint/no-explicit-any -- the owner connection is a bare `pg` client: its rows are untyped */
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { RequestContextStore, type RequestContext } from '../../../common/context/request-context';
import { DatabaseService } from '../../../infra/db/database.service';
import { CONTACT_RESOLVER, type ContactResolverPort } from '../../crm/contact-resolver.port';
import { PaymentsService } from '../../crm';
import { StoreOrderSalesService } from '../../store-orders-sales';
import { ORDERS_GATEWAY, type OrderLine, type OrdersGateway } from '../_shims/tokens';
import {
  DEMO_COMPANY_PREFIX,
  DEMO_COUPON_CODES,
  DEMO_CURRENCY,
  DEMO_MARKER,
  DEMO_SHIPPING,
  buildDemoPlan,
  demoPhones,
  summarisePlan,
  type DemoCustomer,
  type DemoOrder,
  type DemoPlan,
  type ExistingContact,
} from './demo-plan';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SOURCE_TAG = 'Store customer';

/** The owner connection (a `pg` Client or Pool wrapper): bypasses RLS, used for lookups, back-dating and `--reset`. Dev only. */
export interface OwnerSql {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export interface SeedTarget {
  orgId: number;
  orgSlug: string;
  storefrontId: number;
  storefrontUuid: string;
  storefrontName: string | null;
  /** The storefront was created by this run (the org had none). */
  storefrontCreated: boolean;
}

export type Log = (line: string) => void;

export interface SeedResult {
  plan: ReturnType<typeof summarisePlan>;
  created: {
    products: number;
    coupons: number;
    customers: number;
    orders: number;
    contacts: number;
  };
  skipped: { products: number; coupons: number; customers: number; orders: number };
  billing: { salesOrders: number; invoices: number; payments: number; refunds: number };
  failures: string[];
}

const digits = (s: string): string => s.replace(/\D+/g, '');

// ---- target -------------------------------------------------------------------------------------------------------------

/**
 * Which workspace and shop to fill: `--storefront <uuid>` names a shop (and so its workspace); `--org <slug|id>` names the workspace
 * (its first shop, or a new "Demo Store"); with neither, the first workspace that already has a shop, else the first workspace.
 */
export async function resolveTarget(
  owner: OwnerSql,
  opts: { org?: string; storefront?: string; log?: Log },
): Promise<SeedTarget | null> {
  const shopCols = `s.id, s.uuid, s.shop_name, o.id AS org_id, o.slug AS org_slug`;
  if (opts.storefront) {
    const r = await owner.query(
      `SELECT ${shopCols} FROM wa_storefronts s JOIN organizations o ON o.id = s.org_id WHERE s.uuid = $1::uuid`,
      [opts.storefront],
    );
    return r.rows[0] ? targetOf(r.rows[0], false) : null;
  }
  let org: { id: number | string; slug: string } | undefined;
  if (opts.org) {
    const r = /^\d+$/.test(opts.org)
      ? await owner.query(`SELECT id, slug FROM organizations WHERE id = $1`, [Number(opts.org)])
      : await owner.query(
          `SELECT id, slug FROM organizations WHERE slug = $1 OR lower(slug) = lower($1) ORDER BY (slug = $1) DESC LIMIT 1`,
          [opts.org],
        );
    org = r.rows[0];
  } else {
    const r = await owner.query(
      `SELECT o.id, o.slug FROM organizations o
       ORDER BY EXISTS (SELECT 1 FROM wa_storefronts s WHERE s.org_id = o.id) DESC, o.id LIMIT 1`,
    );
    org = r.rows[0];
  }
  if (!org) return null;
  const shop = await owner.query(
    `SELECT ${shopCols} FROM wa_storefronts s JOIN organizations o ON o.id = s.org_id WHERE s.org_id = $1 ORDER BY s.id LIMIT 1`,
    [org.id],
  );
  if (shop.rows[0]) return targetOf(shop.rows[0], false);
  // The slug is unique across the platform: "demo-store" when free, else the workspace's own.
  const taken = await owner.query(`SELECT 1 FROM wa_storefronts WHERE slug = 'demo-store'`);
  const slug = taken.rows.length > 0 ? `demo-store-${org.id}` : 'demo-store';
  const made = await owner.query(
    `INSERT INTO wa_storefronts (org_id, shop_name, slug, theme_key, enabled, currency_code, shipping_json)
     VALUES ($1, 'Demo Store', $2, 'aurora', true, $3, $4::jsonb)
     RETURNING id, uuid, shop_name`,
    [org.id, slug, DEMO_CURRENCY, JSON.stringify(DEMO_SHIPPING)],
  );
  const row = made.rows[0];
  opts.log?.(`created the storefront "Demo Store" for ${org.slug}`);
  return targetOf({ ...row, org_id: org.id, org_slug: org.slug }, true);
}

const targetOf = (r: Record<string, any>, created: boolean): SeedTarget => ({
  orgId: Number(r.org_id),
  orgSlug: String(r.org_slug),
  storefrontId: Number(r.id),
  storefrontUuid: String(r.uuid),
  storefrontName: r.shop_name ?? null,
  storefrontCreated: created,
});

// ---- the existing contacts the plan can reuse -------------------------------------------------------------------------

/**
 * Up to four contacts the workspace already has, to be customers. Stable across runs: a previous run's choices (the demo customers that
 * are not in the seed's own number block) come first, so a re-run never picks different people. Fresh picks are the first contacts
 * with a name and a usable number that have no store order and no saved customer profile.
 */
export async function existingContactsFor(
  owner: OwnerSql,
  orgId: number,
): Promise<ExistingContact[]> {
  const mine = await owner.query(
    `SELECT c.name, c.normalized_phone AS phone, c.email::text AS email
     FROM wa_customer_profiles p JOIN contacts c ON c.org_id = p.org_id AND c.id = p.contact_id
     WHERE p.org_id = $1 AND p.company LIKE $2 AND NOT (c.normalized_phone = ANY($3::text[]))
     ORDER BY p.id LIMIT 4`,
    [orgId, `${DEMO_COMPANY_PREFIX}%`, demoPhones()],
  );
  if (mine.rows.length > 0) return mine.rows.map(toExisting);
  const fresh = await owner.query(
    `SELECT c.name, c.normalized_phone AS phone, c.email::text AS email
     FROM contacts c
     WHERE c.org_id = $1 AND c.normalized_phone ~ '^\\+[1-9][0-9]{9,14}$' AND coalesce(c.name, '') <> ''
       AND NOT (c.normalized_phone = ANY($2::text[]))
       AND NOT EXISTS (SELECT 1 FROM wa_orders o WHERE o.org_id = c.org_id AND o.contact_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM wa_customer_profiles p WHERE p.org_id = c.org_id AND p.phone = regexp_replace(c.normalized_phone, '\\D', '', 'g'))
     ORDER BY c.id OFFSET 1 LIMIT 4`,
    [orgId, demoPhones()],
  );
  return fresh.rows.map(toExisting);
}

const toExisting = (r: Record<string, any>): ExistingContact => ({
  name: String(r.name),
  phone: String(r.phone),
  email: r.email ?? null,
});

// ---- the seed -----------------------------------------------------------------------------------------------------------

export interface SeedOptions {
  seed?: number;
  now?: Date;
  log?: Log;
}

/** Builds the plan the seed would run for this workspace (reads the owner connection for the contacts it may reuse). */
export async function planFor(
  owner: OwnerSql,
  target: SeedTarget,
  opts: SeedOptions = {},
): Promise<DemoPlan> {
  return buildDemoPlan({
    seed: opts.seed,
    now: opts.now ?? new Date(),
    existingContacts: await existingContactsFor(owner, target.orgId),
  });
}

/**
 * Writes the demo data through the real paths: orders through the storefront's SQL orders gateway (the contact link is made there, in
 * the order's transaction), WhatsApp cart orders the way the catalog cart writes them, then `StoreOrderSalesService.syncOrder` for each
 * order, which is exactly what the outbox consumer runs: contact catch-up, confirmed sales order, timeline, invoice or receipt and the
 * ledger payment. Idempotent: every row has a stable key, a re-run only adds what is missing.
 *
 * The seed does NOT emit the order events (nothing is sent to the demo buyers); the consumer's step is called directly.
 */
export async function runSeed(
  app: INestApplicationContext,
  owner: OwnerSql,
  target: SeedTarget,
  opts: SeedOptions = {},
): Promise<SeedResult> {
  const log = opts.log ?? (() => undefined);
  const plan = await planFor(owner, target, opts);
  const db = app.get(DatabaseService, { strict: false });
  const gateway = app.get<OrdersGateway>(ORDERS_GATEWAY, { strict: false });
  const resolver = app.get<ContactResolverPort>(CONTACT_RESOLVER, { strict: false });
  const sales = app.get(StoreOrderSalesService, { strict: false });
  const payments = app.get(PaymentsService, { strict: false });
  const orgId = target.orgId;

  const result: SeedResult = {
    plan: summarisePlan(plan),
    created: { products: 0, coupons: 0, customers: 0, orders: 0, contacts: 0 },
    skipped: { products: 0, coupons: 0, customers: 0, orders: 0 },
    billing: { salesOrders: 0, invoices: 0, payments: 0, refunds: 0 },
    failures: [],
  };
  const ctx: RequestContext = {
    requestId: `store-demo-${randomUUID()}`,
    orgId,
    actorType: 'system',
    actorId: null,
    userId: null,
  };
  const tx = <T>(fn: (t: Tx) => Promise<T>) => db.txAs({ orgId, userId: null }, fn);
  const contactsBefore = await countContacts(owner, orgId);

  await RequestContextStore.run(ctx, async () => {
    // 1. products
    const productIds = new Map<string, { id: number; name: string; sku: string; image: string }>();
    for (const [i, p] of plan.products.entries()) {
      const row = await tx(async (t) => {
        const ins = await t.execute(sql`
          INSERT INTO wa_products (org_id, storefront_id, sku, name, slug, description, price_minor, compare_price_minor, weight_grams,
                                   category, tags_json, status, availability, currency_code, image_url, in_stock, stock_qty, sort_order)
          VALUES (${orgId}, ${target.storefrontId}, ${p.sku}, ${p.name}, ${p.slug}, ${p.description}, ${p.priceMinor},
                  ${p.comparePriceMinor}, ${p.weightGrams}, ${p.category}, ${JSON.stringify([DEMO_MARKER, 'demo'])}::jsonb, ${p.status},
                  ${p.stockQty === 0 ? 'out of stock' : 'in stock'}, ${DEMO_CURRENCY}, ${p.image}, ${p.stockQty !== 0}, ${p.stockQty}, ${i})
          ON CONFLICT (org_id, slug) DO NOTHING
          RETURNING id`);
        if (ins.rows.length > 0)
          return { id: Number((ins.rows[0] as { id: number | string }).id), created: true };
        const have = await t.execute(
          sql`SELECT id, tags_json ? ${DEMO_MARKER} AS demo FROM wa_products WHERE org_id = ${orgId} AND slug = ${p.slug}`,
        );
        const r = have.rows[0] as { id: number | string; demo: boolean };
        if (!r.demo)
          log(
            `  warning: a product with the slug ${p.slug} exists and is not a demo product: left alone`,
          );
        return { id: Number(r.id), created: false };
      });
      productIds.set(p.key, { id: row.id, name: p.name, sku: p.sku, image: p.image });
      if (row.created) result.created.products++;
      else result.skipped.products++;
    }

    // 2. coupons
    for (const c of plan.coupons) {
      const made = await tx(async (t) => {
        const res = await t.execute(sql`
          INSERT INTO wa_coupons (org_id, storefront_id, code, type, amount, min_subtotal_minor, max_discount_minor, free_shipping, active,
                                  starts_at, expires_at, usage_limit, used_count)
          VALUES (${orgId}, ${c.storeScoped ? target.storefrontId : null}, ${c.code}, ${c.type}, ${c.amount}, ${c.minSubtotalMinor},
                  ${c.maxDiscountMinor}, ${c.freeShipping}, true, ${c.startsAt?.toISOString() ?? null}::timestamptz,
                  ${c.expiresAt?.toISOString() ?? null}::timestamptz, ${c.usageLimit}, ${c.usedCount})
          ON CONFLICT (org_id, code) DO NOTHING RETURNING id`);
        return res.rows.length > 0;
      });
      if (made) result.created.coupons++;
      else result.skipped.coupons++;
    }

    // 3. customers: a saved profile each, linked to its contact (the contact is found, or created by the resolver)
    for (const c of plan.customers) {
      const made = await tx(async (t) => {
        const link = await resolver.findOrCreateByPhone(t, orgId, {
          phone: c.phone,
          name: c.name,
          email: c.email,
          address: c.address,
          source: 'store',
          tag: SOURCE_TAG,
        });
        const contactId = link.outcome === 'skipped' ? null : link.contactId;
        const res = await t.execute(sql`
          INSERT INTO wa_customer_profiles (org_id, phone, name, company, address, contact_id)
          VALUES (${orgId}, ${digits(c.phone)}, ${c.name}, ${c.company}, ${c.address}, ${contactId})
          ON CONFLICT (org_id, phone) DO NOTHING RETURNING id`);
        return res.rows.length > 0;
      });
      if (made) result.created.customers++;
      else result.skipped.customers++;
    }

    // 4. orders, oldest first (so numbers and dates run the same way)
    const customers = new Map(plan.customers.map((c) => [c.key, c]));
    const placedAt = new Map<number, Date>();
    for (const o of plan.orders) {
      try {
        const done = await seedOrder({
          o,
          plan,
          customers,
          productIds,
          target,
          db,
          gateway,
          resolver,
          sales,
          payments,
          result,
          tx,
          orgId,
        });
        if (done) {
          result.created.orders++;
          placedAt.set(done, o.placedAt);
        } else {
          result.skipped.orders++;
        }
      } catch (err) {
        const msg = `${o.key}: ${err instanceof Error ? err.message : String(err)}`;
        result.failures.push(msg);
        log(`  failed ${msg}`);
      }
    }

    // 5. dates: the rows were written now; move them to when the orders were placed (dev connection, see backdate())
    if (placedAt.size > 0) {
      try {
        await backdate(owner, orgId, plan, placedAt);
      } catch (err) {
        result.failures.push(`backdate: ${err instanceof Error ? err.message : String(err)}`);
        log(`  could not back-date the rows: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  result.created.contacts = Math.max(0, (await countContacts(owner, orgId)) - contactsBefore);
  const bill = await owner.query(
    `SELECT count(*) FILTER (WHERE o.sales_order_id IS NOT NULL)::int AS so,
            count(*) FILTER (WHERE o.invoice_id IS NOT NULL)::int AS inv
     FROM wa_orders o WHERE o.org_id = $1 AND o.meta_json ->> 'demo' = $2`,
    [orgId, DEMO_MARKER],
  );
  const pay = await owner.query(
    `SELECT count(*) FILTER (WHERE p.kind = 'payment')::int AS pay, count(*) FILTER (WHERE p.kind = 'refund')::int AS refund
     FROM payments p JOIN wa_orders o ON o.org_id = p.org_id AND o.invoice_id = p.invoice_id
     WHERE p.org_id = $1 AND o.meta_json ->> 'demo' = $2`,
    [orgId, DEMO_MARKER],
  );
  result.billing = {
    salesOrders: bill.rows[0].so,
    invoices: bill.rows[0].inv,
    payments: pay.rows[0].pay,
    refunds: pay.rows[0].refund,
  };
  return result;
}

const countContacts = async (owner: OwnerSql, orgId: number): Promise<number> =>
  Number(
    (await owner.query(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [orgId]))
      .rows[0].n,
  );

interface OrderCtx {
  o: DemoOrder;
  plan: DemoPlan;
  customers: Map<string, DemoCustomer>;
  productIds: Map<string, { id: number; name: string; sku: string; image: string }>;
  target: SeedTarget;
  db: DatabaseService;
  gateway: OrdersGateway;
  resolver: ContactResolverPort;
  sales: StoreOrderSalesService;
  payments: PaymentsService;
  result: SeedResult;
  tx: <T>(fn: (t: Tx) => Promise<T>) => Promise<T>;
  orgId: number;
}

const tokenOf = (seed: number, key: string): string =>
  createHash('sha1').update(`${seed}:${key}`).digest('hex');

/** One order, end to end. Returns the order's number, or null when it already exists. */
async function seedOrder(c: OrderCtx): Promise<number | null> {
  const { o, orgId } = c;
  const customer = c.customers.get(o.customerKey)!;
  const exists = await c.tx(async (t) => {
    const r = await t.execute(
      sql`SELECT id FROM wa_orders WHERE org_id = ${orgId} AND meta_json ->> 'demo_key' = ${o.key}`,
    );
    return r.rows.length > 0;
  });
  if (exists) return null;

  const lines: OrderLine[] = o.lines.map((l) => {
    const p = c.productIds.get(l.productKey)!;
    return {
      product_id: p.id,
      name: p.name,
      qty: l.qty,
      price_minor: l.unitMinor,
      image: p.image,
      retailer_id: p.sku,
    };
  });
  const paidVia = o.gateway
    ? { paid_via: o.gateway, gateway_slug: o.gateway, gateway_payment_id: o.gatewayPaymentId }
    : null;
  const baseMeta = { demo: DEMO_MARKER, demo_key: o.key, demo_seed: c.plan.seed };
  // A refunded order is paid first (the bridge bills it), and cancelled and refunded after.
  const firstStatus = o.payState === 'refunded' ? 'paid' : o.status;

  const placed = await c.tx(async (t) => {
    let id: number;
    let uuid: string;
    if (o.source === 'storefront') {
      const p = await c.gateway.create(t, orgId, {
        storefrontId: c.target.storefrontId,
        customerPhone: customer.phone,
        customerName: customer.name,
        customerEmail: customer.email,
        customerAddress: customer.address,
        items: lines,
        totalMinor: o.totalMinor,
        shippingMinor: o.shippingMinor,
        discountMinor: o.discountMinor,
        couponCode: o.couponCode,
        currencyCode: DEMO_CURRENCY,
        paymentMethod: o.paymentMethod,
        rtoScore: o.rtoScore,
        rtoBand: o.rtoBand,
        recoveryToken: tokenOf(c.plan.seed, o.key),
        notes: o.notes,
      });
      id = p.id;
      uuid = p.uuid;
    } else {
      ({ id, uuid } = await insertCartOrder(c, t, customer, lines));
    }
    // The columns the storefront checkout does not write (tax) and the state the scenario wants.
    await t.execute(sql`
      UPDATE wa_orders
      SET status = ${firstStatus}, payment_link = ${o.paymentLink},
          tax_minor = ${o.taxMinor}, tax_inclusive = false,
          tax_lines_json = ${o.taxRatePercent ? JSON.stringify([{ label: 'GST', rate: o.taxRatePercent }]) : null}::jsonb,
          created_at = ${o.placedAt.toISOString()}::timestamptz,
          meta_json = coalesce(meta_json, '{}'::jsonb) || ${JSON.stringify({
            ...baseMeta,
            ...(o.paymentLink ? { gateway_slug: 'razorpay' } : {}),
            ...(paidVia ?? {}),
          })}::jsonb
      WHERE org_id = ${orgId} AND id = ${id}`);
    return { id, uuid };
  });

  // The bridge's own step (what the outbox consumer runs): contact, sales order, timeline, invoice, payment.
  const synced = await c.sales.syncOrder(orgId, { uuid: placed.uuid });
  if (synced.salesOrder === 'created') c.result.billing.salesOrders++;

  if (o.payState === 'refunded') {
    await c.tx(async (t) => {
      const pay = await t.execute(sql`
        SELECT p.id FROM payments p JOIN wa_orders w ON w.org_id = p.org_id AND w.invoice_id = p.invoice_id
        WHERE p.org_id = ${orgId} AND w.id = ${placed.id} AND p.kind = 'payment' ORDER BY p.id LIMIT 1`);
      const payRow = pay.rows[0] as { id: number | string } | undefined;
      if (payRow) {
        const payment = await c.payments.findPayment(t, orgId, Number(payRow.id));
        if (payment) {
          await c.payments.refundIn(t, orgId, null, payment, payment.amountMinor, {
            reason: 'Order cancelled and refunded (demo data)',
            paidAt: new Date(Math.min(o.placedAt.getTime() + 2 * DAY, Date.now())),
          });
        }
      }
      await t.execute(sql`
        UPDATE wa_orders
        SET status = 'cancelled',
            meta_json = coalesce(meta_json, '{}'::jsonb) || ${JSON.stringify({ refunded: { minor: o.totalMinor, reason: 'cancelled by the buyer' } })}::jsonb
        WHERE org_id = ${orgId} AND id = ${placed.id}`);
    });
    await c.sales.syncOrder(orgId, { uuid: placed.uuid });
  }
  return placed.id;
}

/** A WhatsApp catalog cart as the catalog cart writes it (`waba-orders.service`): items in `items_json` with `quantity`, and one `wa_order_items` row per line. */
async function insertCartOrder(
  c: OrderCtx,
  t: Tx,
  customer: DemoCustomer,
  lines: OrderLine[],
): Promise<{ id: number; uuid: string }> {
  const { o, orgId } = c;
  const phone = digits(customer.phone);
  const link = await c.resolver.findOrCreateByPhone(t, orgId, {
    phone,
    name: customer.name,
    email: customer.email,
    address: customer.address,
    source: 'whatsapp_order',
    tag: SOURCE_TAG,
  });
  const contactId = link.outcome === 'skipped' ? null : link.contactId;
  const items = lines.map((l) => ({
    retailer_id: l.retailer_id,
    product_id: l.product_id,
    name: l.name,
    image_url: l.image,
    quantity: l.qty,
    price_minor: l.price_minor,
    currency: DEMO_CURRENCY,
  }));
  const res = await t.execute(sql`
    INSERT INTO wa_orders (org_id, source, customer_phone, customer_name, customer_email, customer_address, items_json, total_minor,
                           shipping_minor, discount_minor, currency_code, payment_method, status, notes, meta_json, contact_id, rto_score, rto_band)
    VALUES (${orgId}, 'waba', ${phone}, ${customer.name}, ${customer.email}, ${customer.address}, ${JSON.stringify(items)}::jsonb,
            ${o.totalMinor}, ${o.shippingMinor}, ${o.discountMinor}, ${DEMO_CURRENCY}, ${o.paymentMethod}, 'new', ${o.notes},
            ${JSON.stringify({ catalog_id: 'demo-catalog' })}::jsonb, ${contactId}, ${o.rtoScore}, ${o.rtoBand})
    RETURNING id, uuid`);
  const row = res.rows[0] as { id: number | string; uuid: string };
  for (const it of items) {
    await t.execute(sql`
      INSERT INTO wa_order_items (org_id, order_id, product_id, retailer_id, name, image_url, quantity, price_minor, currency_code)
      VALUES (${orgId}, ${Number(row.id)}, ${it.product_id}, ${it.retailer_id}, ${it.name}, ${it.image_url}, ${it.quantity},
              ${it.price_minor}, ${it.currency})`);
  }
  return { id: Number(row.id), uuid: row.uuid };
}

// ---- dates --------------------------------------------------------------------------------------------------------------

/**
 * Every write above stamps "now". The demo is meant to look like 45 days of trading, so the rows that carry a date are moved to the
 * time the order was placed: the order, its sales order, its invoice (issue date, due date, paid date), its ledger entries, its
 * timeline entries, and the contacts and profiles the seed created. Issued invoices and the ledger are frozen by design (triggers), so
 * this runs on the owner connection, in one transaction, with only those guards switched off and back on. Nothing here is reachable
 * from the app.
 */
export async function backdate(
  owner: OwnerSql,
  orgId: number,
  plan: DemoPlan,
  placedAt: Map<number, Date>,
): Promise<void> {
  const guards: Array<[string, string]> = [
    ['payments', 'trg_payments_immutable'],
    ['invoices', 'trg_invoices_freeze'],
    ['wa_orders', 'trg_wa_orders_touch'],
  ];
  await owner.query('BEGIN');
  try {
    for (const [table, trg] of guards)
      await owner.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trg}`);
    const now = Date.now();
    for (const [orderId, at] of placedAt) {
      const t = at.toISOString();
      const paidAt = new Date(Math.min(at.getTime() + 20 * 60 * 1000, now)).toISOString();
      const refundAt = new Date(Math.min(at.getTime() + 2 * DAY, now)).toISOString();
      const o = (
        await owner.query(
          `SELECT contact_id, invoice_id, sales_order_id, status FROM wa_orders WHERE org_id = $1 AND id = $2`,
          [orgId, orderId],
        )
      ).rows[0];
      if (!o) continue;
      await owner.query(
        `UPDATE wa_orders SET created_at = $3::timestamptz, updated_at = $4::timestamptz WHERE org_id = $1 AND id = $2`,
        [orgId, orderId, t, paidAt],
      );
      if (o.sales_order_id) {
        await owner.query(
          `UPDATE sales_orders SET created_at = $3::timestamptz, confirmed_at = CASE WHEN confirmed_at IS NULL THEN NULL ELSE $3::timestamptz END,
                  cancelled_at = CASE WHEN cancelled_at IS NULL THEN NULL ELSE $4::timestamptz END
           WHERE org_id = $1 AND id = $2`,
          [orgId, o.sales_order_id, t, refundAt],
        );
      }
      if (o.invoice_id) {
        await owner.query(
          `UPDATE invoices SET created_at = $3::timestamptz, issued_at = $3::timestamptz,
                  due_date = ($3::timestamptz AT TIME ZONE 'UTC')::date + (due_date - issue_date),
                  issue_date = ($3::timestamptz AT TIME ZONE 'UTC')::date
           WHERE org_id = $1 AND id = $2`,
          [orgId, o.invoice_id, t],
        );
        await owner.query(
          `UPDATE payments SET created_at = $3::timestamptz, paid_at = $3::timestamptz WHERE org_id = $1 AND invoice_id = $2 AND kind = 'payment'`,
          [orgId, o.invoice_id, paidAt],
        );
        await owner.query(
          `UPDATE payments SET created_at = $3::timestamptz, paid_at = $3::timestamptz WHERE org_id = $1 AND invoice_id = $2 AND kind = 'refund'`,
          [orgId, o.invoice_id, refundAt],
        );
        await owner.query(
          `UPDATE invoices SET paid_at = $3::timestamptz WHERE org_id = $1 AND id = $2 AND paid_at IS NOT NULL`,
          [orgId, o.invoice_id, paidAt],
        );
        await owner.query(
          `UPDATE invoice_logs SET created_at = $3::timestamptz WHERE org_id = $1 AND invoice_id = $2`,
          [orgId, o.invoice_id, paidAt],
        );
      }
      if (o.contact_id) {
        await owner.query(
          `UPDATE contact_activities SET created_at = $4::timestamptz, occurred_at = $4::timestamptz
           WHERE org_id = $1 AND contact_id = $2 AND activity_type = 'store_order' AND title = $3`,
          [orgId, o.contact_id, `Store order #${orderId}`, t],
        );
        await owner.query(
          `UPDATE contact_activities SET created_at = $4::timestamptz, occurred_at = $4::timestamptz
           WHERE org_id = $1 AND contact_id = $2 AND activity_type = 'store_order' AND title = $3`,
          [orgId, o.contact_id, `Store order #${orderId} paid`, paidAt],
        );
      }
    }
    // The contacts and profiles the seed made exist since a little before their first order (a customer with no order: about a month).
    for (const c of plan.customers) {
      const times = plan.orders
        .filter((o) => o.customerKey === c.key)
        .map((o) => o.placedAt.getTime());
      const since = new Date(
        (times.length > 0 ? Math.min(...times) : plan.now.getTime() - 30 * DAY) - HOUR,
      );
      await owner.query(
        `UPDATE wa_customer_profiles SET created_at = $3::timestamptz
         WHERE org_id = $1 AND phone = $2 AND company LIKE $4 AND created_at > $3::timestamptz`,
        [orgId, digits(c.phone), since.toISOString(), `${DEMO_COMPANY_PREFIX}%`],
      );
      if (!c.existingContact) {
        const last = new Date(
          Math.max(
            since.getTime(),
            ...plan.orders.filter((o) => o.customerKey === c.key).map((o) => o.placedAt.getTime()),
          ),
        );
        await owner.query(
          `UPDATE contacts SET created_at = $3::timestamptz, last_activity_at = CASE WHEN last_activity_at IS NULL THEN NULL ELSE $4::timestamptz END
           WHERE org_id = $1 AND normalized_phone = $2 AND created_at > $3::timestamptz`,
          [orgId, c.phone, since.toISOString(), last.toISOString()],
        );
      }
    }
    for (const [table, trg] of guards)
      await owner.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trg}`);
    await owner.query('COMMIT');
  } catch (err) {
    await owner.query('ROLLBACK');
    throw err;
  }
}

// ---- reset --------------------------------------------------------------------------------------------------------------

export interface ResetResult {
  orders: number;
  salesOrders: number;
  invoices: number;
  payments: number;
  customers: number;
  coupons: number;
  products: number;
  contacts: number;
  activities: number;
}

/**
 * Deletes exactly what the seed made in this workspace and nothing else:
 *   - the orders carrying the demo marker (`meta_json.demo`), their lines, and what the bridge made from them: sales orders, invoices
 *     with their lines and logs, ledger entries (the ledger is append-only by trigger, so that one guard is switched off for the
 *     transaction), and their "Store order #N" timeline entries;
 *   - the five demo coupons (by code), the demo products (by slug, only with the demo tag), the demo customer profiles (company
 *     starts with "Demo · "), and the contacts the seed created (a number in the seed's own block, no order that is not a demo one).
 * Contacts that existed before the seed are never deleted. Refuses when a demo invoice has a credit note (somebody worked on it).
 */
export async function runReset(owner: OwnerSql, orgId: number): Promise<ResetResult> {
  const out: ResetResult = {
    orders: 0,
    salesOrders: 0,
    invoices: 0,
    payments: 0,
    customers: 0,
    coupons: 0,
    products: 0,
    contacts: 0,
    activities: 0,
  };
  await owner.query('BEGIN');
  try {
    const orders = (
      await owner.query(
        `SELECT id, contact_id, invoice_id, sales_order_id FROM wa_orders WHERE org_id = $1 AND meta_json ->> 'demo' = $2`,
        [orgId, DEMO_MARKER],
      )
    ).rows as Array<{
      id: number | string;
      contact_id: number | string | null;
      invoice_id: number | string | null;
      sales_order_id: number | string | null;
    }>;
    const orderIds = orders.map((r) => Number(r.id));
    if (orderIds.length > 0) {
      const inv = (
        await owner.query(
          `SELECT DISTINCT id FROM invoices WHERE org_id = $1 AND (id = ANY($2::bigint[]) OR wa_order_id = ANY($3::bigint[]))`,
          [
            orgId,
            orders
              .map((r) => r.invoice_id)
              .filter((v) => v !== null)
              .map(Number),
            orderIds,
          ],
        )
      ).rows.map((r: { id: number | string }) => Number(r.id));
      const so = (
        await owner.query(
          `SELECT DISTINCT id FROM sales_orders WHERE org_id = $1 AND (id = ANY($2::bigint[]) OR id IN (SELECT sales_order_id FROM invoices WHERE org_id = $1 AND id = ANY($3::bigint[])))`,
          [
            orgId,
            orders
              .map((r) => r.sales_order_id)
              .filter((v) => v !== null)
              .map(Number),
            inv,
          ],
        )
      ).rows.map((r: { id: number | string }) => Number(r.id));
      if (inv.length > 0) {
        const cn = await owner.query(
          `SELECT count(*)::int AS n FROM credit_notes WHERE org_id = $1 AND invoice_id = ANY($2::bigint[])`,
          [orgId, inv],
        );
        if (cn.rows[0].n > 0)
          throw new Error(
            'a demo invoice has a credit note: refusing to delete it (void or remove the credit note first)',
          );
        await owner.query(`ALTER TABLE payments DISABLE TRIGGER trg_payments_immutable`);
        out.payments +=
          (
            await owner.query(
              `DELETE FROM payments WHERE org_id = $1 AND invoice_id = ANY($2::bigint[]) AND kind = 'refund'`,
              [orgId, inv],
            )
          ).rowCount ?? 0;
        out.payments +=
          (
            await owner.query(
              `DELETE FROM payments WHERE org_id = $1 AND invoice_id = ANY($2::bigint[])`,
              [orgId, inv],
            )
          ).rowCount ?? 0;
        await owner.query(`ALTER TABLE payments ENABLE TRIGGER trg_payments_immutable`);
        await owner.query(
          `DELETE FROM invoice_logs WHERE org_id = $1 AND invoice_id = ANY($2::bigint[])`,
          [orgId, inv],
        );
        out.invoices =
          (
            await owner.query(`DELETE FROM invoices WHERE org_id = $1 AND id = ANY($2::bigint[])`, [
              orgId,
              inv,
            ])
          ).rowCount ?? 0;
      }
      if (so.length > 0) {
        out.salesOrders =
          (
            await owner.query(
              `DELETE FROM sales_orders WHERE org_id = $1 AND id = ANY($2::bigint[])`,
              [orgId, so],
            )
          ).rowCount ?? 0;
      }
      // "Store order #N" / "Store order #N paid" on the contacts' timelines
      const titles = orderIds.flatMap((id) => [`Store order #${id}`, `Store order #${id} paid`]);
      out.activities =
        (
          await owner.query(
            `DELETE FROM contact_activities WHERE org_id = $1 AND activity_type = 'store_order' AND title = ANY($2::text[])`,
            [orgId, titles],
          )
        ).rowCount ?? 0;
      await owner.query(
        `DELETE FROM wa_order_items WHERE org_id = $1 AND order_id = ANY($2::bigint[])`,
        [orgId, orderIds],
      );
      out.orders =
        (
          await owner.query(`DELETE FROM wa_orders WHERE org_id = $1 AND id = ANY($2::bigint[])`, [
            orgId,
            orderIds,
          ])
        ).rowCount ?? 0;
    }
    out.coupons =
      (
        await owner.query(`DELETE FROM wa_coupons WHERE org_id = $1 AND code = ANY($2::text[])`, [
          orgId,
          [...DEMO_COUPON_CODES],
        ])
      ).rowCount ?? 0;
    out.products =
      (
        await owner.query(
          `DELETE FROM wa_products WHERE org_id = $1 AND tags_json ? $2 AND slug LIKE 'demo-%'`,
          [orgId, DEMO_MARKER],
        )
      ).rowCount ?? 0;
    out.customers =
      (
        await owner.query(
          `DELETE FROM wa_customer_profiles WHERE org_id = $1 AND company LIKE $2`,
          [orgId, `${DEMO_COMPANY_PREFIX}%`],
        )
      ).rowCount ?? 0;
    out.contacts =
      (
        await owner.query(
          `DELETE FROM contacts c WHERE c.org_id = $1 AND c.normalized_phone = ANY($2::text[]) AND c.source IN ('store', 'whatsapp_order')
         AND NOT EXISTS (SELECT 1 FROM wa_orders o WHERE o.org_id = c.org_id AND o.contact_id = c.id)`,
          [orgId, demoPhones()],
        )
      ).rowCount ?? 0;
    await owner.query('COMMIT');
  } catch (err) {
    await owner.query('ROLLBACK');
    throw err;
  }
  return out;
}

// ---- summary ------------------------------------------------------------------------------------------------------------

export interface DemoCounts {
  products: number;
  coupons: number;
  customers: number;
  orders: number;
  ordersByStatus: Record<string, number>;
  ordersBySource: Record<string, number>;
  paymentStates: Record<string, number>;
  salesOrders: number;
  invoices: number;
  receipts: number;
  taxInvoices: number;
  payments: number;
  refunds: number;
  linkedContacts: number;
  repeatBuyers: number;
}

/** What is in the workspace now, by the demo marker (the check after a seed and after a reset). */
export async function countDemo(owner: OwnerSql, orgId: number): Promise<DemoCounts> {
  const one = async (text: string, params: unknown[] = [orgId]) =>
    Number((await owner.query(text, params)).rows[0].n);
  const group = async (col: string) => {
    const r = await owner.query(
      `SELECT ${col} AS k, count(*)::int AS n FROM wa_orders WHERE org_id = $1 AND meta_json ->> 'demo' = $2 GROUP BY 1 ORDER BY 1`,
      [orgId, DEMO_MARKER],
    );
    return Object.fromEntries(r.rows.map((x: { k: string; n: number }) => [x.k, x.n]));
  };
  const demoOrder = `meta_json ->> 'demo' = '${DEMO_MARKER}'`;
  const pay = await owner.query(
    `SELECT CASE WHEN o.status = 'paid' OR coalesce(o.meta_json ->> 'paid_via', '') <> '' THEN 'paid'
                 WHEN o.payment_method = 'cod' THEN 'cod' WHEN coalesce(o.payment_link, '') <> '' THEN 'awaiting' ELSE 'unpaid' END AS k,
            count(*)::int AS n
     FROM wa_orders o WHERE o.org_id = $1 AND o.${demoOrder} GROUP BY 1 ORDER BY 1`,
    [orgId],
  );
  return {
    products: await one(
      `SELECT count(*)::int AS n FROM wa_products WHERE org_id = $1 AND tags_json ? '${DEMO_MARKER}'`,
    ),
    coupons: await one(
      `SELECT count(*)::int AS n FROM wa_coupons WHERE org_id = $1 AND code = ANY($2::text[])`,
      [orgId, [...DEMO_COUPON_CODES]],
    ),
    customers: await one(
      `SELECT count(*)::int AS n FROM wa_customer_profiles WHERE org_id = $1 AND company LIKE $2`,
      [orgId, `${DEMO_COMPANY_PREFIX}%`],
    ),
    orders: await one(
      `SELECT count(*)::int AS n FROM wa_orders WHERE org_id = $1 AND ${demoOrder}`,
    ),
    ordersByStatus: await group('status'),
    ordersBySource: await group('source'),
    paymentStates: Object.fromEntries(pay.rows.map((x: { k: string; n: number }) => [x.k, x.n])),
    salesOrders: await one(
      `SELECT count(*)::int AS n FROM wa_orders WHERE org_id = $1 AND ${demoOrder} AND sales_order_id IS NOT NULL`,
    ),
    invoices: await one(
      `SELECT count(*)::int AS n FROM wa_orders WHERE org_id = $1 AND ${demoOrder} AND invoice_id IS NOT NULL`,
    ),
    receipts: await one(
      `SELECT count(*)::int AS n FROM invoices i JOIN wa_orders o ON o.org_id = i.org_id AND o.invoice_id = i.id WHERE o.org_id = $1 AND o.${demoOrder} AND i.doc_type = 'receipt'`,
    ),
    taxInvoices: await one(
      `SELECT count(*)::int AS n FROM invoices i JOIN wa_orders o ON o.org_id = i.org_id AND o.invoice_id = i.id WHERE o.org_id = $1 AND o.${demoOrder} AND i.doc_type = 'tax_invoice'`,
    ),
    payments: await one(
      `SELECT count(*)::int AS n FROM payments p JOIN wa_orders o ON o.org_id = p.org_id AND o.invoice_id = p.invoice_id WHERE p.org_id = $1 AND o.${demoOrder} AND p.kind = 'payment'`,
    ),
    refunds: await one(
      `SELECT count(*)::int AS n FROM payments p JOIN wa_orders o ON o.org_id = p.org_id AND o.invoice_id = p.invoice_id WHERE p.org_id = $1 AND o.${demoOrder} AND p.kind = 'refund'`,
    ),
    linkedContacts: await one(
      `SELECT count(DISTINCT contact_id)::int AS n FROM wa_orders WHERE org_id = $1 AND ${demoOrder} AND contact_id IS NOT NULL`,
    ),
    repeatBuyers: await one(
      `SELECT count(*)::int AS n FROM (SELECT contact_id FROM wa_orders WHERE org_id = $1 AND ${demoOrder} AND contact_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x`,
    ),
  };
}
