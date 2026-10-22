import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { ContactResolverService } from '../../../src/modules/crm/contacts/contact-resolver.service';
import { ExternalOrderBillingService } from '../../../src/modules/crm/invoicing/external-order-billing.service';
import { contactDefinition, FormsApi, nextIp } from '../forms-builder/support';
import { startHarness, type Harness } from '../contacts-attributes-tags/support';
import { race, statuses } from './support';

/**
 * QA Sheet3 #15, CC-LIM-19: the caps that were hand-rolled outside the shared lock. A tag made on the way (a store buyer, a form
 * submission) and the monthly invoice cap for a store order must hold under parallel requests, like every other cap.
 */
let h: Harness;
let api: FormsApi;
let db: DatabaseService;
beforeAll(async () => {
  h = await startHarness();
  api = new FormsApi(h);
  db = h.app.get(DatabaseService);
}, 240_000);
afterAll(async () => {
  await h?.stop();
});

const q = (text: string, params: unknown[] = []) => h.owner.query(text, params);
const setLimits = (orgId: number, limits: Record<string, number>) =>
  q(
    `UPDATE org_plan_state SET overrides = jsonb_build_object('limits', $2::jsonb) WHERE org_id = $1`,
    [orgId, JSON.stringify(limits)],
  );
const inOrg = <T>(orgId: number, fn: () => Promise<T>) =>
  RequestContextStore.run(
    { requestId: `conc-${orgId}`, orgId, actorType: 'system', actorId: null, userId: null },
    fn,
  );
const count = async (text: string, params: unknown[]) => Number((await q(text, params)).rows[0].n);

describe('CC-LIM-19 tags made on the way', () => {
  it('CC-LIM-19a a store buyer: 8 contacts at once, each with its own new tag, on a cap of 3 tags: never more than 3 tags, every contact still made', async () => {
    const t = await api.signup('l19a');
    await setLimits(t.orgId, { tags: 3 });
    const resolver = h.app.get(ContactResolverService, { strict: false });
    const res = await race(8, (i) =>
      db.txAs({ orgId: t.orgId, userId: null }, (tx) =>
        resolver.findOrCreateByPhone(tx, t.orgId, {
          phone: `+9198111100${String(i).padStart(2, '0')}`,
          name: `Buyer ${i}`,
          tag: `store-${i}`,
          source: 'store',
        } as never),
      ),
    );
    expect(res.every((r) => r.outcome === 'created' || r.outcome === 'found')).toBe(true);
    expect(
      await count(`SELECT count(*)::int AS n FROM tags WHERE org_id = $1`, [t.orgId]),
    ).toBeLessThanOrEqual(3);
    expect(
      await count(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [t.orgId]),
    ).toBeGreaterThanOrEqual(8);
  });

  it('CC-LIM-19b a form that adds 5 tags, 6 visitors at once, on a cap of 3 tags: never more than 3 tags, every submission accepted', async () => {
    const t = await api.workspace('l19b', { tags: 3 });
    const form = await api.liveForm(t.admin, {
      definition: contactDefinition({ after: { tags: ['T1', 'T2', 'T3', 'T4', 'T5'] } }),
    });
    const res = await race(6, (i) =>
      api.submit(
        form.publicKey,
        {
          idempotencyKey: `l19b-${Date.now()}-${i}-0001`,
          answers: {
            name: `Visitor ${i}`,
            email: `visitor${i}-l19b@example.test`,
            phone: `98765 4${String(1000 + i)}`,
          },
          elapsedMs: 12_000,
        },
        { ip: nextIp() },
      ),
    );
    for (const r of res) expect(r.status, JSON.stringify(r.body)).toBe(201);
    const tags = await count(`SELECT count(*)::int AS n FROM tags WHERE org_id = $1`, [t.orgId]);
    expect(tags, JSON.stringify(statuses(res))).toBeLessThanOrEqual(3);
  });
});

describe('CC-LIM-19c monthly invoice cap for store orders', () => {
  it('8 store orders invoiced at once on a cap of 3 invoices a month: 3 invoiced, 5 skipped for the plan, none throws, 3 invoices exist', async () => {
    const t = await api.signup('l19c');
    await setLimits(t.orgId, { invoices_monthly: 3 });
    const billing = h.app.get(ExternalOrderBillingService, { strict: false });
    const input = (waOrderId: number) => ({
      waOrderId,
      reference: `Store order #${waOrderId}`,
      contactId: null,
      buyer: { name: 'Store Buyer', email: null, phone: null, address: null },
      currency: 'USD',
      lines: [{ description: 'Widget', sku: null, qty: '1', unitPriceMinor: 1000n }],
      discountMinor: 0n,
      shippingMinor: 0n,
      tax: null,
      notes: null,
      orderTotalMinor: 1000n,
      docType: 'receipt' as const,
      meta: {},
    });
    const ids = await Promise.all(
      Array.from({ length: 8 }, async () =>
        Number(
          (
            await q(
              `INSERT INTO wa_orders (org_id, source, items_json, total_minor, currency_code) VALUES ($1, 'storefront', '[]'::jsonb, 1000, 'USD') RETURNING id`,
              [t.orgId],
            )
          ).rows[0].id,
        ),
      ),
    );
    const res = await race(8, (i) =>
      inOrg(t.orgId, () =>
        db.txAs({ orgId: t.orgId, userId: null }, async (tx) => {
          const so = await billing.createSalesOrderIn(tx, t.orgId, input(ids[i]!));
          return billing.invoiceSalesOrderIn(tx, t.orgId, so.id, input(ids[i]!));
        }),
      ),
    );
    expect(res.filter((r) => r.outcome === 'invoiced')).toHaveLength(3);
    expect(res.filter((r) => r.outcome === 'skipped')).toHaveLength(5);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM invoices WHERE org_id = $1 AND status = 'issued'`,
        [t.orgId],
      ),
    ).toBe(3);
  });
});
